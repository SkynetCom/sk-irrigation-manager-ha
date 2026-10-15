"""Base entity for SK Irrigation Manager."""
from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity

from .const import DOMAIN, NAME, SIGNAL_UPDATE, VERSION
from .engine import IrrigationEngine


class SKIrrigationEntity(Entity):
    """Entity bound to the engine and refreshed on every engine update."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, engine: IrrigationEngine, key: str) -> None:
        self.engine = engine
        self._attr_unique_id = f"{DOMAIN}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, "controller")},
            name=NAME,
            manufacturer="SK",
            model="Irrigation Manager",
            sw_version=VERSION,
            entry_type=DeviceEntryType.SERVICE,
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATE, self.async_write_ha_state))
