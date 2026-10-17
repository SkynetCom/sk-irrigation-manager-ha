"""Data model, normalisation and pure scheduling logic.

This module has no Home Assistant imports so it can be unit tested in
isolation. Everything coming from the UI goes through the ``normalize_*``
helpers, which coerce types and drop unknown keys.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
import heapq
import re
import uuid
from typing import Any

from .const import (
    COND_NUMERIC,
    COND_STATE,
    COND_TEMPLATE,
    COND_TYPES,
    DEFAULT_SETTINGS,
    UNAVAILABLE_STATES,
    DURATION_CUSTOM,
    DURATION_UNIFORM,
    MODE_DATES,
    MODE_EVEN,
    MODE_INTERVAL,
    MODE_MONTHDAYS,
    MODE_ODD,
    MODE_WEEKDAYS,
    SCHEDULE_MODES,
    START_FIXED,
    START_SUNRISE,
    START_SUNSET,
)

_TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
_DATE_RE = re.compile(r"^(\d{4}-)?(\d{2})-(\d{2})$")


def new_id(prefix: str) -> str:
    """Return a short random id."""
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _int(value: Any, default: int, lo: int | None = None, hi: int | None = None) -> int:
    try:
        out = int(round(float(value)))
    except (TypeError, ValueError):
        out = default
    if lo is not None:
        out = max(lo, out)
    if hi is not None:
        out = min(hi, out)
    return out


def _float(value: Any, default: float | None, lo: float | None = None, hi: float | None = None) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    if lo is not None:
        out = max(lo, out)
    if hi is not None:
        out = min(hi, out)
    return out


def _str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value).strip()[:120]


def _opt_entity(value: Any) -> str | None:
    value = _str(value)
    return value if "." in value else None


def _entity_list(value: Any) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    return [e for e in (_opt_entity(v) for v in value) if e]


# --------------------------------------------------------------------------
# Normalisation
# --------------------------------------------------------------------------

def normalize_zone(raw: dict) -> dict:
    return {
        "id": _str(raw.get("id")) or new_id("zone"),
        "name": _str(raw.get("name"), "Zona") or "Zona",
        "entity_id": _opt_entity(raw.get("entity_id")),
        "icon": _str(raw.get("icon"), "mdi:sprinkler") or "mdi:sprinkler",
        "color": _str(raw.get("color"), "#2e9e6b") or "#2e9e6b",
        "enabled": bool(raw.get("enabled", True)),
        "flow_rate": _float(raw.get("flow_rate"), None, 0, 100000),
        "notes": _str(raw.get("notes")),
    }


def normalize_group(raw: dict, zone_ids: set[str]) -> dict:
    zones = [z for z in raw.get("zone_ids", []) if z in zone_ids]
    seen: set[str] = set()
    return {
        "id": _str(raw.get("id")) or new_id("group"),
        "name": _str(raw.get("name"), "Grupo") or "Grupo",
        "color": _str(raw.get("color"), "#1e88e5") or "#1e88e5",
        "icon": _str(raw.get("icon"), "mdi:sprinkler-variant") or "mdi:sprinkler-variant",
        "zone_ids": [z for z in zones if not (z in seen or seen.add(z))],
    }


def normalize_schedule(raw: dict | None) -> dict:
    raw = raw or {}
    mode = raw.get("mode") if raw.get("mode") in SCHEDULE_MODES else MODE_WEEKDAYS
    dates = []
    for d in raw.get("dates", []) or []:
        d = _str(d)
        if _DATE_RE.match(d):
            dates.append(d)
    return {
        "mode": mode,
        "weekdays": sorted({_int(d, 0, 0, 6) for d in raw.get("weekdays", [0, 2, 4]) or []}),
        "interval_days": _int(raw.get("interval_days"), 2, 1, 365),
        "anchor_date": _str(raw.get("anchor_date")) or date.today().isoformat(),
        "month_days": sorted({_int(d, 1, 1, 31) for d in raw.get("month_days", []) or []}),
        "dates": sorted(set(dates)),
        "months": sorted({_int(m, 1, 1, 12) for m in raw.get("months", []) or []}),
    }


def normalize_start_time(raw: Any) -> dict | None:
    if isinstance(raw, str):
        raw = {"type": START_FIXED, "time": raw}
    if not isinstance(raw, dict):
        return None
    stype = raw.get("type", START_FIXED)
    if stype in (START_SUNRISE, START_SUNSET):
        return {"type": stype, "offset": _int(raw.get("offset"), 0, -240, 240)}
    time = _str(raw.get("time"))
    m = _TIME_RE.match(time)
    if not m:
        return None
    return {"type": START_FIXED, "time": f"{int(m.group(1)):02d}:{m.group(2)}"}


def normalize_step(raw: dict, group_ids: set[str], zone_ids: set[str]) -> dict | None:
    group_id = raw.get("group_id")
    if group_id not in group_ids:
        return None
    durations = {}
    for zid, minutes in (raw.get("durations") or {}).items():
        if zid in zone_ids:
            durations[zid] = _float(minutes, 0.0, 0, 600)
    seen: set[str] = set()
    order = [z for z in raw.get("order") or [] if z in zone_ids and not (z in seen or seen.add(z))]
    skip = sorted({z for z in raw.get("skip") or [] if z in zone_ids})
    return {
        "id": _str(raw.get("id")) or new_id("step"),
        "group_id": group_id,
        "concurrency": _int(raw.get("concurrency"), 1, 0, 64),
        "duration_mode": DURATION_CUSTOM if raw.get("duration_mode") == DURATION_CUSTOM else DURATION_UNIFORM,
        "duration": _float(raw.get("duration"), 10.0, 0, 600),
        "durations": durations,
        "order": order,
        "skip": skip,
    }


def step_zone_order(step: dict, group: dict) -> list[str]:
    """Zones of ``group`` in the order chosen for this step (new zones go last)."""
    members = group.get("zone_ids", [])
    ordered = [z for z in step.get("order") or [] if z in members]
    return ordered + [z for z in members if z not in ordered]


def normalize_condition(raw: Any) -> dict | None:
    """A user-built condition: entity state, numeric threshold or Jinja template."""
    if not isinstance(raw, dict):
        return None
    ctype = raw.get("type") if raw.get("type") in COND_TYPES else COND_STATE
    states = raw.get("states", [])
    if isinstance(states, str):
        states = states.split(",")
    return {
        "id": _str(raw.get("id")) or new_id("cond"),
        "type": ctype,
        "label": _str(raw.get("label")),
        "entity_id": _opt_entity(raw.get("entity_id")),
        "attribute": _str(raw.get("attribute")) or None,
        "operator": "not" if raw.get("operator") == "not" else "is",
        "states": [s for s in (_str(x) for x in states) if s],
        "above": _float(raw.get("above"), None, -1e9, 1e9),
        "below": _float(raw.get("below"), None, -1e9, 1e9),
        "template": str(raw.get("template") or "")[:4000],
        "recheck": bool(raw.get("recheck", False)),
        "unavailable": "pass" if raw.get("unavailable") == "pass" else "fail",
    }


def normalize_conditions(raw: Any) -> list[dict]:
    if not isinstance(raw, list):
        return []
    return [c for c in (normalize_condition(r) for r in raw) if c]


def evaluate_condition(cond: dict, value: Any) -> tuple[bool, str]:
    """Evaluate a state/numeric condition against the entity value.

    Returns ``(ok, detail)``; ``detail`` describes the current value so the UI
    and history can explain why a run was skipped.
    """
    entity = cond.get("entity_id") or "?"
    if cond.get("attribute"):
        entity = f"{entity}.{cond['attribute']}"
    if value is None or str(value).strip().lower() in UNAVAILABLE_STATES:
        return cond.get("unavailable") == "pass", f"{entity} = unavailable"
    if cond["type"] == COND_NUMERIC:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return cond.get("unavailable") == "pass", f"{entity} = {value} (no numérico)"
        ok = (cond.get("above") is None or number > cond["above"]) and \
             (cond.get("below") is None or number < cond["below"])
        return ok, f"{entity} = {number:g}"
    match = str(value) in (cond.get("states") or [])
    ok = match if cond.get("operator", "is") == "is" else not match
    return ok, f"{entity} = {value}"


def describe_condition(cond: dict) -> str:
    """Short human label used when the user did not name the condition."""
    if cond.get("label"):
        return cond["label"]
    if cond["type"] == COND_TEMPLATE:
        return "template"
    entity = cond.get("entity_id") or "?"
    if cond["type"] == COND_NUMERIC:
        parts = []
        if cond.get("above") is not None:
            parts.append(f"> {cond['above']:g}")
        if cond.get("below") is not None:
            parts.append(f"< {cond['below']:g}")
        return f"{entity} {' y '.join(parts)}"
    op = "=" if cond.get("operator") == "is" else "≠"
    return f"{entity} {op} {', '.join(cond.get('states') or [])}"


def normalize_program(raw: dict, group_ids: set[str], zone_ids: set[str]) -> dict:
    starts = [s for s in (normalize_start_time(s) for s in raw.get("start_times", []) or []) if s]
    steps = [s for s in (normalize_step(s, group_ids, zone_ids) for s in raw.get("steps", []) or []) if s]
    return {
        "id": _str(raw.get("id")) or new_id("prog"),
        "name": _str(raw.get("name"), "Programa") or "Programa",
        "color": _str(raw.get("color"), "#2e9e6b") or "#2e9e6b",
        "enabled": bool(raw.get("enabled", True)),
        "schedule": normalize_schedule(raw.get("schedule")),
        "start_times": starts,
        "steps": steps,
        "budget": _int(raw.get("budget"), 100, 0, 300),
        "zone_delay_s": _int(raw.get("zone_delay_s"), -1, -1, 3600),
        "step_delay_s": _int(raw.get("step_delay_s"), -1, -1, 3600),
        "ignore_conditions": bool(raw.get("ignore_conditions", False)),
        "on_busy": "skip" if raw.get("on_busy") == "skip" else "queue",
        "conditions": normalize_conditions(raw.get("conditions")),
    }


def normalize_settings(raw: dict | None) -> dict:
    raw = raw or {}
    out = dict(DEFAULT_SETTINGS)
    out["enabled"] = bool(raw.get("enabled", out["enabled"]))
    out["rain_delay_until"] = _str(raw.get("rain_delay_until")) or None
    out["rain_sensors"] = _entity_list(raw.get("rain_sensors"))
    out["weather_entity"] = _opt_entity(raw.get("weather_entity"))
    conds = raw.get("weather_conditions", out["weather_conditions"])
    out["weather_conditions"] = [_str(c) for c in conds] if isinstance(conds, list) else list(out["weather_conditions"])
    out["freeze_sensor"] = _opt_entity(raw.get("freeze_sensor"))
    out["freeze_threshold"] = _float(raw.get("freeze_threshold"), 3.0, -50, 50)
    out["budget_entity"] = _opt_entity(raw.get("budget_entity"))
    out["global_budget"] = _int(raw.get("global_budget"), 100, 0, 300)
    out["master_entity"] = _opt_entity(raw.get("master_entity"))
    out["master_lead_s"] = _int(raw.get("master_lead_s"), 3, 0, 600)
    out["master_lag_s"] = _int(raw.get("master_lag_s"), 3, 0, 600)
    out["max_concurrent"] = _int(raw.get("max_concurrent"), 0, 0, 64)
    out["zone_delay_s"] = _int(raw.get("zone_delay_s"), 5, 0, 3600)
    out["step_delay_s"] = _int(raw.get("step_delay_s"), 10, 0, 3600)
    out["max_zone_minutes"] = _int(raw.get("max_zone_minutes"), 120, 1, 720)
    out["history_size"] = _int(raw.get("history_size"), 60, 5, 500)
    out["notify_service"] = _str(raw.get("notify_service")) or None
    out["conditions"] = normalize_conditions(raw.get("conditions"))
    out["manual_conditions"] = bool(raw.get("manual_conditions", True))
    return out


MAP_KIND_IMAGE = "image"
MAP_KIND_SATELLITE = "satellite"
_MAP_IMAGE_RE = re.compile(r"^/sk_irrigation_files/maps/[A-Za-z0-9_.-]+$|^https?://\S+$|^/local/\S+$")


def _point(raw: Any, kind: str) -> list[float] | None:
    """One vertex: [x, y] as 0..1 fractions of an image, or [lat, lon]."""
    if not isinstance(raw, (list, tuple)) or len(raw) != 2:
        return None
    if kind == MAP_KIND_SATELLITE:
        lat, lon = _float(raw[0], None, -90, 90), _float(raw[1], None, -180, 180)
    else:
        lat, lon = _float(raw[0], None, -0.5, 1.5), _float(raw[1], None, -0.5, 1.5)
    if lat is None or lon is None:
        return None
    return [round(lat, 7), round(lon, 7)]


def normalize_map(raw: dict, zone_ids: set[str]) -> dict:
    """A map view: a background (drone photo or satellite) plus zone outlines."""
    kind = MAP_KIND_SATELLITE if raw.get("kind") == MAP_KIND_SATELLITE else MAP_KIND_IMAGE
    image = _str(raw.get("image"))
    shapes: dict[str, list] = {}
    for zid, parts in (raw.get("shapes") or {}).items():
        if zid not in zone_ids or not isinstance(parts, list):
            continue
        clean = []
        for part in parts[:20]:
            pts = [p for p in (_point(v, kind) for v in (part or [])[:200]) if p]
            if len(pts) >= 3:
                clean.append(pts)
        if clean:
            shapes[zid] = clean
    center = _point(raw.get("center"), MAP_KIND_SATELLITE) if raw.get("center") else None
    return {
        "id": _str(raw.get("id")) or new_id("map"),
        "name": _str(raw.get("name")) or "Map",
        "kind": kind,
        "image": image if _MAP_IMAGE_RE.match(image) else "",
        "image_w": _int(raw.get("image_w"), 0, 0, 20000),
        "image_h": _int(raw.get("image_h"), 0, 0, 20000),
        "center": center,
        "zoom": _int(raw.get("zoom"), 18, 1, 22),
        "max_native_zoom": _int(raw.get("max_native_zoom"), 18, 10, 22),
        "shapes": shapes,
    }


def map_image_files(maps: list[dict]) -> set[str]:
    """File names of uploaded images still referenced by a map."""
    prefix = "/sk_irrigation_files/maps/"
    return {m["image"][len(prefix):] for m in maps if m.get("image", "").startswith(prefix)}


def normalize_all(data: dict) -> dict:
    """Normalise a full configuration document, keeping references valid."""
    zones = [normalize_zone(z) for z in data.get("zones", []) if isinstance(z, dict)]
    zone_ids = {z["id"] for z in zones}
    groups = [normalize_group(g, zone_ids) for g in data.get("groups", []) if isinstance(g, dict)]
    group_ids = {g["id"] for g in groups}
    programs = [
        normalize_program(p, group_ids, zone_ids) for p in data.get("programs", []) if isinstance(p, dict)
    ]
    return {
        "zones": zones,
        "groups": groups,
        "programs": programs,
        "settings": normalize_settings(data.get("settings")),
        "maps": [normalize_map(m, zone_ids) for m in data.get("maps", []) or [] if isinstance(m, dict)][:20],
    }


# --------------------------------------------------------------------------
# Calendar logic
# --------------------------------------------------------------------------

def _parse_date(value: str, fallback: date) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return fallback


def is_active_day(schedule: dict, day: date) -> bool:
    """Return True if a program with ``schedule`` should run on ``day``."""
    months = schedule.get("months") or []
    if months and day.month not in months:
        return False
    mode = schedule.get("mode", MODE_WEEKDAYS)
    if mode == MODE_WEEKDAYS:
        return day.weekday() in (schedule.get("weekdays") or [])
    if mode == MODE_INTERVAL:
        anchor = _parse_date(schedule.get("anchor_date"), day)
        interval = max(1, int(schedule.get("interval_days") or 1))
        return (day - anchor).days % interval == 0 and day >= anchor
    if mode == MODE_MONTHDAYS:
        return day.day in (schedule.get("month_days") or [])
    if mode == MODE_ODD:
        return day.day % 2 == 1 and day.day != 31
    if mode == MODE_EVEN:
        return day.day % 2 == 0
    if mode == MODE_DATES:
        iso = day.isoformat()
        md = iso[5:]
        return any(d == iso or d == md for d in schedule.get("dates") or [])
    return False


def next_active_days(schedule: dict, start: date, limit: int = 400):
    """Yield active days starting at ``start`` (inclusive)."""
    for i in range(limit):
        day = start + timedelta(days=i)
        if is_active_day(schedule, day):
            yield day


# --------------------------------------------------------------------------
# Run planning
# --------------------------------------------------------------------------

@dataclass
class PlannedZone:
    zone_id: str
    seconds: int


@dataclass
class PlannedStep:
    label: str
    concurrency: int
    zones: list[PlannedZone] = field(default_factory=list)


def resolve_concurrency(requested: int, count: int, global_cap: int) -> int:
    limit = count if requested <= 0 else min(requested, count)
    if global_cap > 0:
        limit = min(limit, global_cap)
    return max(1, limit)


def build_program_plan(program: dict, zones: dict, groups: dict, budget_pct: float, max_minutes: int) -> list[PlannedStep]:
    """Convert a program into concrete steps with per-zone seconds."""
    factor = max(0.0, budget_pct) / 100.0 * max(0, program.get("budget", 100)) / 100.0
    steps: list[PlannedStep] = []
    for step in program.get("steps", []):
        group = groups.get(step["group_id"])
        if not group:
            continue
        planned = PlannedStep(label=group["name"], concurrency=step.get("concurrency", 1))
        skip = set(step.get("skip") or [])
        for zid in step_zone_order(step, group):
            zone = zones.get(zid)
            if zid in skip:
                continue
            if not zone or not zone.get("enabled", True) or not zone.get("entity_id"):
                continue
            if step.get("duration_mode") == DURATION_CUSTOM:
                minutes = step.get("durations", {}).get(zid, step.get("duration", 0))
            else:
                minutes = step.get("duration", 0)
            minutes = min(float(minutes or 0), max_minutes)
            seconds = int(round(minutes * 60 * factor))
            if seconds > 0:
                planned.zones.append(PlannedZone(zid, seconds))
        if planned.zones:
            steps.append(planned)
    return steps


def estimate_step_seconds(durations: list[int], limit: int, zone_delay: int) -> int:
    """Makespan of a rolling queue that keeps ``limit`` zones running."""
    if not durations:
        return 0
    slots = [0] * max(1, min(limit, len(durations)))
    heapq.heapify(slots)
    end = 0
    for i, dur in enumerate(durations):
        start = heapq.heappop(slots)
        finish = start + dur
        end = max(end, finish)
        heapq.heappush(slots, finish + zone_delay)
    return end


def estimate_plan_seconds(steps: list[PlannedStep], global_cap: int, zone_delay: int, step_delay: int) -> int:
    total = 0
    for i, step in enumerate(steps):
        limit = resolve_concurrency(step.concurrency, len(step.zones), global_cap)
        total += estimate_step_seconds([z.seconds for z in step.zones], limit, zone_delay)
        if i < len(steps) - 1:
            total += step_delay
    return total
