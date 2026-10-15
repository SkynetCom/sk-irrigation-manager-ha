"""Switches for SK Irrigation Manager: system enable and one per program."""
from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SIGNAL_PROGRAMS_CHANGED
from .entity import SKIrrigationEntity


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    engine = entry.runtime_data
    known: dict[str, ProgramSwitch] = {}

    @callback
    def sync_programs() -> None:
        ids = {p["id"] for p in engine.config["programs"]}
        new = [ProgramSwitch(engine, pid) for pid in ids if pid not in known]
        for ent in new:
            known[ent.program_id] = ent
        if new:
            async_add_entities(new)
        registry = er.async_get(hass)
        for pid in [pid for pid in known if pid not in ids]:
            ent = known.pop(pid)
            if ent.entity_id and registry.async_get(ent.entity_id):
                registry.async_remove(ent.entity_id)

    async_add_entities([SystemSwitch(engine)])
    sync_programs()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_PROGRAMS_CHANGED, sync_programs))


class SystemSwitch(SKIrrigationEntity, SwitchEntity):
    _attr_translation_key = "system"
    _attr_icon = "mdi:water-pump"

    def __init__(self, engine) -> None:
        super().__init__(engine, "system")

    @property
    def is_on(self) -> bool:
        return bool(self.engine.settings.get("enabled", True))

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.engine.async_set_enabled(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.engine.async_set_enabled(False)


class ProgramSwitch(SKIrrigationEntity, SwitchEntity):
    _attr_icon = "mdi:calendar-sync"

    def __init__(self, engine, program_id: str) -> None:
        super().__init__(engine, f"program_{program_id}")
        self.program_id = program_id

    @property
    def _program(self) -> dict | None:
        return next((p for p in self.engine.config["programs"] if p["id"] == self.program_id), None)

    @property
    def name(self) -> str:
        program = self._program
        return f"Programa {program['name']}" if program else "Programa"

    @property
    def available(self) -> bool:
        return self._program is not None

    @property
    def is_on(self) -> bool:
        program = self._program
        return bool(program and program["enabled"])

    @property
    def extra_state_attributes(self) -> dict:
        state = self.engine.state_dict()
        return {
            "program_id": self.program_id,
            "next_run": state["next_runs"].get(self.program_id),
            "running": bool(state["current"] and state["current"]["program_id"] == self.program_id),
            "domain": DOMAIN,
        }

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.engine.async_set_program_enabled(self.program_id, True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.engine.async_set_program_enabled(self.program_id, False)
