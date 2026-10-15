"""Sensors for SK Irrigation Manager."""
from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .entity import SKIrrigationEntity

STATUS_OPTIONS = ["idle", "running", "paused", "rain_delay", "disabled"]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    engine = entry.runtime_data
    async_add_entities([
        StatusSensor(engine), NextRunSensor(engine), RemainingSensor(engine), ActiveZonesSensor(engine),
        CurrentZoneSensor(engine),
    ])


class StatusSensor(SKIrrigationEntity, SensorEntity):
    _attr_translation_key = "status"
    _attr_icon = "mdi:sprinkler-variant"
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = STATUS_OPTIONS

    def __init__(self, engine) -> None:
        super().__init__(engine, "status")

    @property
    def native_value(self) -> str:
        return self.engine.status()

    @property
    def extra_state_attributes(self) -> dict:
        state = self.engine.state_dict()
        current = state["current"]
        zones = self.engine.zones_by_id()
        return {
            "program": current["name"] if current else None,
            "active_zones": [zones[a["zone_id"]]["name"] for a in current["active"] if a["zone_id"] in zones]
            if current else [],
            "queue": [q["name"] for q in state["queue"]],
            "blocking": state["blocking"],
            "budget": state["budget"],
        }


class NextRunSensor(SKIrrigationEntity, SensorEntity):
    _attr_translation_key = "next_run"
    _attr_icon = "mdi:calendar-clock"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, engine) -> None:
        super().__init__(engine, "next_run")

    @property
    def native_value(self) -> datetime | None:
        nxt = self.engine.state_dict()["next"]
        return dt_util.parse_datetime(nxt["at"]) if nxt else None

    @property
    def extra_state_attributes(self) -> dict:
        nxt = self.engine.state_dict()["next"]
        return {"program": nxt["name"] if nxt else None}


class RemainingSensor(SKIrrigationEntity, SensorEntity):
    _attr_translation_key = "remaining"
    _attr_icon = "mdi:timer-sand"
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES

    def __init__(self, engine) -> None:
        super().__init__(engine, "remaining")

    @property
    def native_value(self) -> float:
        run = self.engine.current
        if not run or not run.planned_end:
            return 0
        return round(max(0, (run.planned_end - dt_util.now()).total_seconds()) / 60, 1)


class ActiveZonesSensor(SKIrrigationEntity, SensorEntity):
    _attr_translation_key = "active_zones"
    _attr_icon = "mdi:water"

    def __init__(self, engine) -> None:
        super().__init__(engine, "active_zones")

    @property
    def native_value(self) -> int:
        run = self.engine.current
        return len(run.active) if run else 0


class CurrentZoneSensor(SKIrrigationEntity, SensorEntity):
    """Sprinkler(s) watering right now, with per-sprinkler end time (replaces a helper timer)."""

    _attr_translation_key = "current_zone"
    _attr_icon = "mdi:sprinkler-variant"

    def __init__(self, engine) -> None:
        super().__init__(engine, "current_zone")

    def _active(self) -> list:
        run = self.engine.current
        return sorted(run.active.values(), key=lambda a: a.ends) if run else []

    @property
    def native_value(self) -> str | None:
        zones = self.engine.zones_by_id()
        names = [zones[a.zone_id]["name"] for a in self._active() if a.zone_id in zones]
        return ", ".join(names)[:255] if names else None

    @property
    def extra_state_attributes(self) -> dict:
        active = self._active()
        now = dt_util.now()
        return {
            "entity_ids": [a.entity_id for a in active],
            "ends_at": active[0].ends.isoformat() if active else None,
            "remaining_seconds": int(max(0, (active[0].ends - now).total_seconds())) if active else 0,
            "program": self.engine.current.name if self.engine.current else None,
        }
