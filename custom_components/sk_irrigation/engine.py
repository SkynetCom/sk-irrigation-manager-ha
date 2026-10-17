"""Irrigation engine: scheduling, queueing and executing runs."""
from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging
import math
from typing import Any

from homeassistant.const import STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_change
from homeassistant.exceptions import TemplateError
from homeassistant.helpers.sun import get_astral_event_date
from homeassistant.helpers.template import Template, result_as_boolean
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    COND_TEMPLATE,
    RAINBIRD_PLATFORM,
    SIGNAL_PROGRAMS_CHANGED,
    SIGNAL_UPDATE,
    SOURCE_MANUAL,
    SOURCE_SCHEDULE,
    START_FIXED,
    STATUS_COMPLETED,
    STATUS_ERROR,
    STATUS_SKIPPED,
    STATUS_STOPPED,
    SUPPORTED_DOMAINS,
)
from .model import (
    describe_condition,
    evaluate_condition,
    PlannedStep,
    PlannedZone,
    build_program_plan,
    estimate_plan_seconds,
    is_active_day,
    new_id,
    next_active_days,
    resolve_concurrency,
)
from .maps import async_cleanup_images
from .store import IrrigationStore

_LOGGER = logging.getLogger(__name__)

EXTERNAL_OFF_GRACE = 15  # seconds before an external "off" ends a zone
WATCHDOG_INTERVAL = 20  # seconds between condition re-checks while watering


class ConditionBlocked(Exception):
    """Raised when conditions prevent a run from being queued."""

    def __init__(self, reasons: list[str]) -> None:
        super().__init__(", ".join(reasons))
        self.reasons = reasons


class ConditionStop(Exception):
    """Raised inside a run when a re-checked condition stops being true."""


@dataclass
class ActiveZone:
    zone_id: str
    entity_id: str
    started: datetime
    ends: datetime
    seconds: int
    skip: asyncio.Event = field(default_factory=asyncio.Event)


@dataclass
class Run:
    id: str
    name: str
    source: str
    steps: list[PlannedStep]
    program_id: str | None = None
    zone_delay: int = 5
    step_delay: int = 10
    created: datetime = field(default_factory=dt_util.now)
    started: datetime | None = None
    planned_end: datetime | None = None
    step_index: int = 0
    active: dict[str, ActiveZone] = field(default_factory=dict)
    done: list[dict] = field(default_factory=list)
    pending: list[str] = field(default_factory=list)
    status: str = "queued"
    recheck: list[dict] = field(default_factory=list)
    stop_reason: str | None = None

    @property
    def zone_count(self) -> int:
        return sum(len(s.zones) for s in self.steps)

    def summary(self) -> dict:
        return {"id": self.id, "name": self.name, "source": self.source, "program_id": self.program_id,
                "zones": self.zone_count, "created": self.created.isoformat()}


class IrrigationEngine:
    """Owns the configuration and drives the valves."""

    def __init__(self, hass: HomeAssistant, store: IrrigationStore) -> None:
        self.hass = hass
        self.store = store
        self._listeners: set[Callable[[dict], None]] = set()
        self._unsubs: list[Callable[[], None]] = []
        self._fired: set[str] = set()
        self.queue: list[Run] = []
        self.current: Run | None = None
        self._task: asyncio.Task | None = None
        self._ticker: asyncio.Task | None = None
        self._master_on = False
        self._cond_unsub: Callable[[], None] | None = None
        self._cond_notify_handle = None

    # ------------------------------------------------------------------ data
    @property
    def config(self) -> dict:
        return self.store.config

    @property
    def settings(self) -> dict:
        return self.store.config["settings"]

    def zones_by_id(self) -> dict:
        return {z["id"]: z for z in self.config["zones"]}

    def groups_by_id(self) -> dict:
        return {g["id"]: g for g in self.config["groups"]}

    def find_program(self, ref: str) -> dict | None:
        ref_l = str(ref).strip().lower()
        for p in self.config["programs"]:
            if p["id"] == ref or p["name"].lower() == ref_l:
                return p
        return None

    def find_group(self, ref: str) -> dict | None:
        ref_l = str(ref).strip().lower()
        for g in self.config["groups"]:
            if g["id"] == ref or g["name"].lower() == ref_l:
                return g
        return None

    def find_zone(self, ref: str) -> dict | None:
        ref_l = str(ref).strip().lower()
        for z in self.config["zones"]:
            if ref in (z["id"], z["entity_id"]) or z["name"].lower() == ref_l:
                return z
        return None

    # ------------------------------------------------------------ lifecycle
    async def async_start(self) -> None:
        self._unsubs.append(async_track_time_change(self.hass, self._async_tick, second=0))
        self._watch_condition_entities()
        # A run that was interrupted by a restart leaves valves open: close them.
        if self.store.interrupted:
            _LOGGER.warning("Previous run was interrupted, closing all zones")
            await self._all_off()
            self.store.set_interrupted(False)

    async def async_stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        if self._cond_unsub:
            self._cond_unsub()
            self._cond_unsub = None
        if self._cond_notify_handle:
            self._cond_notify_handle.cancel()
        self.queue.clear()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        if self._ticker:
            self._ticker.cancel()

    # ------------------------------------------------------------ listeners
    @callback
    def async_add_listener(self, cb: Callable[[dict], None]) -> Callable[[], None]:
        self._listeners.add(cb)

        @callback
        def remove() -> None:
            self._listeners.discard(cb)

        return remove

    @callback
    def notify(self, config_changed: bool = False) -> None:
        payload = {"state": self.state_dict()}
        if config_changed:
            payload["config"] = self.config
        for cb in list(self._listeners):
            try:
                cb(payload)
            except Exception:  # noqa: BLE001
                _LOGGER.exception("Listener failed")
        async_dispatcher_send(self.hass, SIGNAL_UPDATE)

    # ------------------------------------------------------------ config
    async def async_save(self, key: str, value: Any) -> None:
        before = {p["id"] for p in self.config["programs"]}
        await self.store.async_update(key, value)
        if key == "maps":
            await async_cleanup_images(self.hass, self.config["maps"])
        after = {p["id"] for p in self.config["programs"]}
        if key == "programs" or before != after:
            async_dispatcher_send(self.hass, SIGNAL_PROGRAMS_CHANGED)
        self._watch_condition_entities()
        self.notify(config_changed=True)

    @callback
    def _watch_condition_entities(self) -> None:
        """Push state as soon as any entity used by skip/custom conditions changes."""
        s = self.settings
        ids = set(s.get("rain_sensors", []))
        ids.update(e for e in (s.get("weather_entity"), s.get("freeze_sensor"), s.get("budget_entity")) if e)
        conditions = list(s.get("conditions", []))
        for program in self.config["programs"]:
            conditions.extend(program.get("conditions", []))
        ids.update(c["entity_id"] for c in conditions if c.get("entity_id"))
        if self._cond_unsub:
            self._cond_unsub()
            self._cond_unsub = None
        if ids:
            self._cond_unsub = async_track_state_change_event(self.hass, sorted(ids), self._on_condition_entity)

    @callback
    def _on_condition_entity(self, event: Event) -> None:
        # Debounce bursts (e.g. several Sol-Ark sensors updating together).
        if self._cond_notify_handle:
            self._cond_notify_handle.cancel()
        self._cond_notify_handle = self.hass.loop.call_later(1, self._flush_condition_notify)

    @callback
    def _flush_condition_notify(self) -> None:
        self._cond_notify_handle = None
        self.notify()

    async def async_set_enabled(self, enabled: bool) -> None:
        settings = dict(self.settings, enabled=enabled)
        await self.async_save("settings", settings)

    async def async_set_program_enabled(self, program_id: str, enabled: bool) -> None:
        programs = [dict(p, enabled=enabled) if p["id"] == program_id else p for p in self.config["programs"]]
        await self.async_save("programs", programs)

    async def async_set_rain_delay(self, hours: float) -> None:
        until = dt_util.now() + timedelta(hours=hours) if hours > 0 else None
        settings = dict(self.settings, rain_delay_until=until.isoformat() if until else None)
        await self.async_save("settings", settings)

    # ------------------------------------------------------------ conditions
    def budget_percent(self) -> float:
        entity = self.settings.get("budget_entity")
        if entity:
            st = self.hass.states.get(entity)
            try:
                return max(0.0, float(st.state)) if st else float(self.settings["global_budget"])
            except (TypeError, ValueError):
                pass
        return float(self.settings.get("global_budget", 100))

    def evaluate(self, cond: dict) -> tuple[bool, str]:
        """Evaluate one custom condition against the live HA state."""
        if cond["type"] == COND_TEMPLATE:
            if not cond.get("template", "").strip():
                return True, ""
            try:
                rendered = Template(cond["template"], self.hass).async_render(parse_result=False)
            except TemplateError as err:
                return False, f"error: {err}"
            return result_as_boolean(rendered), f"= {rendered}"
        if not cond.get("entity_id"):
            return True, ""
        st = self.hass.states.get(cond["entity_id"])
        if st is None:
            value = None
        elif cond.get("attribute"):
            value = st.attributes.get(cond["attribute"])
        else:
            value = st.state
        return evaluate_condition(cond, value)

    def condition_failures(self, conditions: list[dict], recheck_only: bool = False) -> list[str]:
        out = []
        for cond in conditions or []:
            if recheck_only and not cond.get("recheck"):
                continue
            ok, detail = self.evaluate(cond)
            if not ok:
                label = describe_condition(cond)
                out.append(f"condition:{label}" + (f" ({detail})" if detail and detail not in label else ""))
        return out

    def blocking_reasons(self) -> list[str]:
        """Return the list of conditions that currently prevent scheduled runs."""
        s = self.settings
        reasons: list[str] = []
        if not s.get("enabled", True):
            reasons.append("system_disabled")
        until = s.get("rain_delay_until")
        if until:
            parsed = dt_util.parse_datetime(until)
            if parsed and parsed > dt_util.now():
                reasons.append("rain_delay")
        for entity in s.get("rain_sensors", []):
            st = self.hass.states.get(entity)
            if st and st.state in (STATE_ON, "wet", "rain", "raining", "true"):
                reasons.append(f"rain_sensor:{entity}")
        weather = s.get("weather_entity")
        if weather:
            st = self.hass.states.get(weather)
            if st and st.state in (s.get("weather_conditions") or []):
                reasons.append(f"weather:{st.state}")
        freeze = s.get("freeze_sensor")
        if freeze:
            st = self.hass.states.get(freeze)
            try:
                temp = float(st.state) if st else None
            except (TypeError, ValueError):
                temp = None
            if temp is not None and temp <= float(s.get("freeze_threshold", 3)):
                reasons.append(f"freeze:{temp}")
        reasons.extend(self.condition_failures(s.get("conditions", [])))
        return reasons

    # ------------------------------------------------------------ scheduling
    def start_datetimes(self, program: dict, day) -> list[datetime]:
        out = []
        tz = dt_util.get_default_time_zone()
        for start in program.get("start_times", []):
            if start["type"] == START_FIXED:
                hh, mm = start["time"].split(":")
                out.append(datetime(day.year, day.month, day.day, int(hh), int(mm), tzinfo=tz))
            else:
                event = get_astral_event_date(self.hass, start["type"], day)
                if event is None:
                    continue
                local = dt_util.as_local(event) + timedelta(minutes=start.get("offset", 0))
                out.append(local.replace(second=0, microsecond=0))
        return sorted(out)

    def next_run(self, program: dict, now: datetime | None = None) -> datetime | None:
        if not program.get("enabled") or not program.get("start_times") or not program.get("steps"):
            return None
        now = now or dt_util.now()
        for day in next_active_days(program["schedule"], now.date()):
            for start in self.start_datetimes(program, day):
                if start > now:
                    return start
        return None

    async def _async_tick(self, now: datetime) -> None:
        now = dt_util.as_local(now).replace(second=0, microsecond=0)
        today = now.date()
        for program in self.config["programs"]:
            if not program.get("enabled") or not program.get("steps"):
                continue
            if not is_active_day(program["schedule"], today):
                continue
            for start in self.start_datetimes(program, today):
                if start != now:
                    continue
                key = f"{program['id']}@{start.isoformat()}"
                if key in self._fired:
                    continue
                self._fired.add(key)
                await self._trigger_scheduled(program)
        if len(self._fired) > 500:
            self._fired = set(list(self._fired)[-100:])
        # keep countdowns / next-run sensors fresh
        self.notify()

    async def _trigger_scheduled(self, program: dict) -> None:
        reasons = [] if program.get("ignore_conditions") else self.blocking_reasons()
        if not self.settings.get("enabled", True):
            reasons = reasons or ["system_disabled"]
        reasons += self.condition_failures(program.get("conditions", []))
        if reasons:
            _LOGGER.info("Program %s skipped: %s", program["name"], ", ".join(reasons))
            self._record_skip(program["name"], program["id"], SOURCE_SCHEDULE, reasons)
            return
        if program.get("on_busy") == "skip" and (self.current or self.queue):
            self._record_skip(program["name"], program["id"], SOURCE_SCHEDULE, ["busy"])
            return
        recheck = ([] if program.get("ignore_conditions") else self.settings.get("conditions", [])) \
            + program.get("conditions", [])
        self.enqueue_program(program, SOURCE_SCHEDULE, recheck=recheck)

    def _record_skip(self, name: str, program_id: str | None, source: str, reasons: list[str]) -> None:
        self.store.add_history({
            "id": new_id("run"), "name": name, "program_id": program_id,
            "source": source, "status": STATUS_SKIPPED, "reason": ", ".join(reasons),
            "start": dt_util.now().isoformat(), "end": dt_util.now().isoformat(), "zones": [],
        })
        self._notify_service(f"⏭ {name}: omitido ({', '.join(reasons)})")
        self.notify()

    def _manual_check(self, name: str, source: str, program: dict | None = None) -> list[dict]:
        """Apply custom conditions to manual/service runs; returns the re-check list."""
        if not self.settings.get("manual_conditions", True):
            return []
        conditions = self.settings.get("conditions", []) + (program.get("conditions", []) if program else [])
        reasons = self.condition_failures(conditions)
        if reasons:
            self._record_skip(name, program["id"] if program else None, source, reasons)
            raise ConditionBlocked(reasons)
        return conditions

    # ------------------------------------------------------------ enqueue
    def _delays(self, program: dict | None) -> tuple[int, int]:
        zd = self.settings["zone_delay_s"]
        sd = self.settings["step_delay_s"]
        if program:
            if program.get("zone_delay_s", -1) >= 0:
                zd = program["zone_delay_s"]
            if program.get("step_delay_s", -1) >= 0:
                sd = program["step_delay_s"]
        return zd, sd

    def enqueue_program(self, program: dict, source: str = SOURCE_MANUAL,
                        recheck: list[dict] | None = None) -> Run | None:
        if source != SOURCE_SCHEDULE:
            recheck = self._manual_check(program["name"], source, program)
        steps = build_program_plan(program, self.zones_by_id(), self.groups_by_id(),
                                   self.budget_percent(), self.settings["max_zone_minutes"])
        if not steps:
            _LOGGER.warning("Program %s has nothing to water", program["name"])
            return None
        zd, sd = self._delays(program)
        run = Run(id=new_id("run"), name=program["name"], source=source, steps=steps,
                  program_id=program["id"], zone_delay=zd, step_delay=sd, recheck=recheck or [])
        return self._enqueue(run)

    def enqueue_group(self, group: dict, minutes: float, concurrency: int = 1,
                      source: str = SOURCE_MANUAL) -> Run | None:
        zones = self.zones_by_id()
        seconds = int(min(minutes, self.settings["max_zone_minutes"]) * 60)
        planned = [PlannedZone(z, seconds) for z in group["zone_ids"]
                   if z in zones and zones[z]["enabled"] and zones[z]["entity_id"]]
        if not planned or seconds <= 0:
            return None
        recheck = self._manual_check(group["name"], source)
        zd, sd = self._delays(None)
        run = Run(id=new_id("run"), name=group["name"], source=source,
                  steps=[PlannedStep(group["name"], concurrency, planned)], zone_delay=zd, step_delay=sd,
                  recheck=recheck)
        return self._enqueue(run)

    def enqueue_zone(self, zone: dict, minutes: float, source: str = SOURCE_MANUAL) -> Run | None:
        seconds = int(min(minutes, self.settings["max_zone_minutes"]) * 60)
        if seconds <= 0 or not zone.get("entity_id"):
            return None
        recheck = self._manual_check(zone["name"], source)
        run = Run(id=new_id("run"), name=zone["name"], source=source,
                  steps=[PlannedStep(zone["name"], 1, [PlannedZone(zone["id"], seconds)])], recheck=recheck)
        return self._enqueue(run)

    def _enqueue(self, run: Run) -> Run:
        self.queue.append(run)
        self._kick()
        self.notify()
        return run

    def _kick(self) -> None:
        if self._task is None or self._task.done():
            self._task = self.hass.async_create_background_task(self._worker(), "sk_irrigation_worker")
        if self._ticker is None or self._ticker.done():
            self._ticker = self.hass.async_create_background_task(self._progress_ticker(), "sk_irrigation_ticker")

    async def _progress_ticker(self) -> None:
        """Push state every few seconds while running so entities stay fresh."""
        while self.current or self.queue:
            await asyncio.sleep(5)
            self.notify()

    # ------------------------------------------------------------ control
    async def async_stop_all(self) -> None:
        self.queue.clear()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        await self._all_off()
        self.notify()

    def remove_queued(self, run_id: str) -> None:
        self.queue = [r for r in self.queue if r.id != run_id]
        self.notify()

    def skip(self, zone_id: str | None = None) -> None:
        if not self.current:
            return
        for active in self.current.active.values():
            if zone_id is None or active.zone_id == zone_id:
                active.skip.set()

    # ------------------------------------------------------------ execution
    async def _worker(self) -> None:
        while self.queue:
            run = self.queue.pop(0)
            self.current = run
            run.status = "running"
            run.started = dt_util.now()
            total = estimate_plan_seconds(run.steps, self.settings["max_concurrent"], run.zone_delay, run.step_delay)
            run.planned_end = run.started + timedelta(seconds=total + self._master_overhead())
            run.pending = [z.zone_id for s in run.steps for z in s.zones]
            self.store.set_interrupted(True)
            self._notify_service(f"💧 {run.name}: inicio ({math.ceil(total / 60)} min)")
            self.notify()
            status, reason = STATUS_COMPLETED, ""
            try:
                await self._execute(run)
            except asyncio.CancelledError:
                status, reason = STATUS_STOPPED, "stopped"
                await self._finish(run, status, reason)
                raise
            except ConditionStop as err:
                _LOGGER.warning("Run %s stopped by condition: %s", run.name, err)
                status, reason = STATUS_STOPPED, str(err)
            except Exception as err:  # noqa: BLE001
                _LOGGER.exception("Run %s failed", run.name)
                status, reason = STATUS_ERROR, str(err)
            await self._finish(run, status, reason)

    def _master_overhead(self) -> int:
        if not self.settings.get("master_entity"):
            return 0
        return self.settings["master_lead_s"] + self.settings["master_lag_s"]

    async def _finish(self, run: Run, status: str, reason: str) -> None:
        for active in list(run.active.values()):
            await self._turn(active.entity_id, False)
            self._record_zone(run, active, dt_util.now())
        run.active.clear()
        await self._master(False)
        end = dt_util.now()
        self.store.add_history({
            "id": run.id, "name": run.name, "program_id": run.program_id, "source": run.source,
            "status": status, "reason": reason, "start": run.started.isoformat() if run.started else None,
            "end": end.isoformat(), "zones": run.done,
        })
        self.store.set_interrupted(False)
        self.current = None
        icon = "✅" if status == STATUS_COMPLETED else "⛔"
        self._notify_service(f"{icon} {run.name}: {status}")
        self.notify()

    async def _execute(self, run: Run) -> None:
        cap = self.settings["max_concurrent"]
        zones = self.zones_by_id()
        if any(s.zones for s in run.steps):
            await self._master(True)
        watchdog = None
        if any(c.get("recheck") for c in run.recheck):
            watchdog = asyncio.ensure_future(self._watchdog(run))
        try:
            await self._execute_steps(run, zones, cap)
        finally:
            if watchdog:
                watchdog.cancel()
        if run.stop_reason:
            raise ConditionStop(run.stop_reason)

    def _check_recheck(self, run: Run) -> None:
        if not run.stop_reason:
            failures = self.condition_failures(run.recheck, recheck_only=True)
            if failures:
                run.stop_reason = ", ".join(failures)
        if run.stop_reason:
            raise ConditionStop(run.stop_reason)

    async def _watchdog(self, run: Run) -> None:
        """Stop the run as soon as a re-checked condition stops being true."""
        while True:
            await asyncio.sleep(WATCHDOG_INTERVAL)
            failures = self.condition_failures(run.recheck, recheck_only=True)
            if failures:
                run.stop_reason = ", ".join(failures)
                for active in run.active.values():
                    active.skip.set()
                return

    async def _execute_steps(self, run: Run, zones: dict, cap: int) -> None:
        for index, step in enumerate(run.steps):
            run.step_index = index
            limit = resolve_concurrency(step.concurrency, len(step.zones), cap)
            pending = list(step.zones)
            tasks: set[asyncio.Task] = set()
            try:
                while pending or tasks:
                    while pending and len(tasks) < limit and not run.stop_reason:
                        self._check_recheck(run)
                        planned = pending.pop(0)
                        zone = zones.get(planned.zone_id)
                        if not zone or not zone.get("entity_id"):
                            continue
                        tasks.add(asyncio.ensure_future(self._water_zone(run, zone, planned.seconds)))
                    if tasks:
                        done, tasks = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                        for t in done:
                            if t.exception():
                                _LOGGER.error("Zone failed: %s", t.exception())
                    elif run.stop_reason:
                        break
            except BaseException:
                for t in tasks:
                    t.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                raise
            if run.stop_reason:
                return
            if index < len(run.steps) - 1 and run.step_delay:
                await asyncio.sleep(run.step_delay)

    async def _water_zone(self, run: Run, zone: dict, seconds: int) -> None:
        entity_id = zone["entity_id"]
        now = dt_util.now()
        st = self.hass.states.get(entity_id)
        if st is None or st.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            _LOGGER.warning("%s is unavailable, skipping %s", entity_id, zone["name"])
            if zone["id"] in run.pending:
                run.pending.remove(zone["id"])
            run.done.append({"zone_id": zone["id"], "start": now.isoformat(), "seconds": 0,
                             "planned": seconds, "skipped": "unavailable"})
            self.notify()
            return
        active = ActiveZone(zone["id"], entity_id, now, now + timedelta(seconds=seconds), seconds)
        run.active[zone["id"]] = active
        if zone["id"] in run.pending:
            run.pending.remove(zone["id"])

        @callback
        def _state_changed(event: Event) -> None:
            new = event.data.get("new_state")
            if new is None:
                return
            if (dt_util.now() - active.started).total_seconds() < EXTERNAL_OFF_GRACE:
                return
            if new.state not in (STATE_ON, "open", "opening", STATE_UNKNOWN, STATE_UNAVAILABLE):
                _LOGGER.info("%s closed externally, moving on", entity_id)
                active.skip.set()

        unsub = async_track_state_change_event(self.hass, [entity_id], _state_changed)
        self.notify()
        try:
            await self._turn(entity_id, True, seconds)
            try:
                await asyncio.wait_for(active.skip.wait(), timeout=seconds)
            except asyncio.TimeoutError:
                pass
        finally:
            unsub()
            await self._turn(entity_id, False)
            run.active.pop(zone["id"], None)
            self._record_zone(run, active, dt_util.now())
            self.notify()
        if run.zone_delay:
            await asyncio.sleep(run.zone_delay)

    def _record_zone(self, run: Run, active: ActiveZone, end: datetime) -> None:
        if any(d["zone_id"] == active.zone_id and d["start"] == active.started.isoformat() for d in run.done):
            return
        watered = int(max(0, (end - active.started).total_seconds()))
        run.done.append({"zone_id": active.zone_id, "start": active.started.isoformat(),
                         "seconds": watered, "planned": active.seconds})
        self.store.update_zone_stat(active.zone_id, end.isoformat(), watered)

    # ------------------------------------------------------------ hardware
    def _platform(self, entity_id: str) -> str | None:
        entry = er.async_get(self.hass).async_get(entity_id)
        return entry.platform if entry else None

    async def _turn(self, entity_id: str | None, on: bool, seconds: int | None = None) -> None:
        if not entity_id:
            return
        domain = entity_id.split(".")[0]
        try:
            if on and seconds and self._platform(entity_id) == RAINBIRD_PLATFORM \
                    and self.hass.services.has_service("rainbird", "start_irrigation"):
                # Rain Bird closes the zone after its own default time unless told otherwise.
                await self.hass.services.async_call(
                    "rainbird", "start_irrigation",
                    {"entity_id": entity_id, "duration": max(1, math.ceil(seconds / 60))}, blocking=True)
                return
            if domain == "valve":
                await self.hass.services.async_call(
                    "valve", "open_valve" if on else "close_valve", {"entity_id": entity_id}, blocking=True)
            elif domain in SUPPORTED_DOMAINS:
                await self.hass.services.async_call(
                    domain, "turn_on" if on else "turn_off", {"entity_id": entity_id}, blocking=True)
        except Exception:  # noqa: BLE001
            _LOGGER.exception("Could not switch %s %s", entity_id, "on" if on else "off")
            if on:
                raise

    async def _master(self, on: bool) -> None:
        entity = self.settings.get("master_entity")
        if not entity or on == self._master_on:
            return
        if not on and self.settings["master_lag_s"]:
            await asyncio.sleep(self.settings["master_lag_s"])
        await self._turn(entity, on)
        self._master_on = on
        if on and self.settings["master_lead_s"]:
            await asyncio.sleep(self.settings["master_lead_s"])

    async def _all_off(self) -> None:
        for zone in self.config["zones"]:
            if zone.get("entity_id"):
                st = self.hass.states.get(zone["entity_id"])
                if st is None or st.state in (STATE_ON, "open", "opening"):
                    await self._turn(zone["entity_id"], False)
        self._master_on = True
        await self._master(False)

    def _notify_service(self, message: str) -> None:
        service = self.settings.get("notify_service")
        if not service:
            return
        domain, _, name = service.partition(".")
        if not name:
            domain, name = "notify", domain
        self.hass.async_create_task(self.hass.services.async_call(
            domain, name, {"title": "SK Irrigation", "message": message}, blocking=False))

    # ------------------------------------------------------------ state
    def candidates(self) -> list[dict]:
        """Every HA entity that can drive a sprinkler, with its native HA area."""
        reg = er.async_get(self.hass)
        devices = dr.async_get(self.hass)
        areas = ar.async_get(self.hass)
        out = []
        for state in self.hass.states.async_all(SUPPORTED_DOMAINS):
            entry = reg.async_get(state.entity_id)
            if entry and entry.platform == DOMAIN:
                continue  # our own program/system switches are not sprinklers
            area_id = entry.area_id if entry else None
            if entry and not area_id and entry.device_id:
                device = devices.async_get(entry.device_id)
                area_id = device.area_id if device else None
            area = areas.async_get_area(area_id) if area_id else None
            out.append({
                "entity_id": state.entity_id,
                "name": state.attributes.get("friendly_name", state.entity_id),
                "domain": state.domain,
                "platform": entry.platform if entry else None,
                "icon": state.attributes.get("icon"),
                "area": area.name if area else None,
            })
        return sorted(out, key=lambda c: (c["platform"] != RAINBIRD_PLATFORM, c["domain"], c["name"].lower()))

    def state_dict(self) -> dict:
        now = dt_util.now()
        run = self.current
        next_runs = {}
        upcoming = None
        for program in self.config["programs"]:
            nxt = self.next_run(program, now)
            next_runs[program["id"]] = nxt.isoformat() if nxt else None
            if nxt and (upcoming is None or nxt < upcoming[1]):
                upcoming = (program, nxt)
        current = None
        if run:
            current = {
                **run.summary(),
                "started": run.started.isoformat() if run.started else None,
                "planned_end": run.planned_end.isoformat() if run.planned_end else None,
                "step_index": run.step_index,
                "steps": [{"label": s.label, "concurrency": s.concurrency,
                           "zones": [{"zone_id": z.zone_id, "seconds": z.seconds} for z in s.zones]}
                          for s in run.steps],
                "active": [{"zone_id": a.zone_id, "entity_id": a.entity_id, "started": a.started.isoformat(),
                            "ends": a.ends.isoformat(), "seconds": a.seconds} for a in run.active.values()],
                "pending": list(run.pending),
                "done": run.done,
            }
        zones_by_id, groups_by_id = self.zones_by_id(), self.groups_by_id()
        program_estimates = {}
        for p in self.config["programs"]:
            zd, sd = self._delays(p)
            plan = build_program_plan(p, zones_by_id, groups_by_id, self.budget_percent(), self.settings["max_zone_minutes"])
            program_estimates[p["id"]] = estimate_plan_seconds(plan, self.settings["max_concurrent"], zd, sd)
        program_blocks = {
            p["id"]: self.condition_failures(p["conditions"]) for p in self.config["programs"] if p.get("conditions")
        }
        return {
            "now": now.isoformat(),
            "program_blocks": program_blocks,
            "program_estimates": program_estimates,
            "status": self.status(),
            "current": current,
            "queue": [r.summary() for r in self.queue],
            "blocking": self.blocking_reasons(),
            "budget": self.budget_percent(),
            "next_runs": next_runs,
            "next": {"program_id": upcoming[0]["id"], "name": upcoming[0]["name"], "at": upcoming[1].isoformat()}
            if upcoming else None,
            "zone_stats": self.store.zone_stats,
            "history": self.store.history[:40],
        }

    def status(self) -> str:
        if self.current:
            return "running"
        if not self.settings.get("enabled", True):
            return "disabled"
        if "rain_delay" in self.blocking_reasons():
            return "rain_delay"
        if self.blocking_reasons():
            return "paused"
        return "idle"
