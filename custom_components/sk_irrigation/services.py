"""Service actions for SK Irrigation Manager."""
from __future__ import annotations

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError
import homeassistant.helpers.config_validation as cv

from .const import DOMAIN, SOURCE_SERVICE
from .engine import ConditionBlocked

SERVICES = ("run_program", "run_group", "run_zone", "stop_all", "skip", "set_rain_delay")


def _engine(hass: HomeAssistant):
    engine = hass.data.get(DOMAIN, {}).get("engine")
    if engine is None:
        raise ServiceValidationError("SK Irrigation Manager is not loaded")
    return engine


def _guard(func, *args):
    try:
        return func(*args)
    except ConditionBlocked as err:
        raise ServiceValidationError(f"Riego no ejecutado: {', '.join(err.reasons)}") from err


def async_register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, "run_program"):
        return

    async def run_program(call: ServiceCall) -> None:
        engine = _engine(hass)
        program = engine.find_program(call.data["program"])
        if not program:
            raise ServiceValidationError(f"Program '{call.data['program']}' not found")
        _guard(engine.enqueue_program, program, SOURCE_SERVICE)

    async def run_group(call: ServiceCall) -> None:
        engine = _engine(hass)
        group = engine.find_group(call.data["group"])
        if not group:
            raise ServiceValidationError(f"Group '{call.data['group']}' not found")
        _guard(engine.enqueue_group, group, call.data["duration"], call.data["concurrency"], SOURCE_SERVICE)

    async def run_zone(call: ServiceCall) -> None:
        engine = _engine(hass)
        zone = engine.find_zone(call.data["zone"])
        if not zone:
            raise ServiceValidationError(f"Zone '{call.data['zone']}' not found")
        _guard(engine.enqueue_zone, zone, call.data["duration"], SOURCE_SERVICE)

    async def stop_all(call: ServiceCall) -> None:
        await _engine(hass).async_stop_all()

    async def skip(call: ServiceCall) -> None:
        _engine(hass).skip(call.data.get("zone"))

    async def set_rain_delay(call: ServiceCall) -> None:
        await _engine(hass).async_set_rain_delay(call.data["hours"])

    hass.services.async_register(DOMAIN, "run_program", run_program,
                                 vol.Schema({vol.Required("program"): cv.string}))
    hass.services.async_register(DOMAIN, "run_group", run_group, vol.Schema({
        vol.Required("group"): cv.string,
        vol.Optional("duration", default=10): vol.All(vol.Coerce(float), vol.Range(min=0.1, max=720)),
        vol.Optional("concurrency", default=1): vol.All(vol.Coerce(int), vol.Range(min=0, max=64)),
    }))
    hass.services.async_register(DOMAIN, "run_zone", run_zone, vol.Schema({
        vol.Required("zone"): cv.string,
        vol.Optional("duration", default=5): vol.All(vol.Coerce(float), vol.Range(min=0.1, max=720)),
    }))
    hass.services.async_register(DOMAIN, "stop_all", stop_all, vol.Schema({}))
    hass.services.async_register(DOMAIN, "skip", skip, vol.Schema({vol.Optional("zone"): cv.string}))
    hass.services.async_register(DOMAIN, "set_rain_delay", set_rain_delay, vol.Schema({
        vol.Required("hours"): vol.All(vol.Coerce(float), vol.Range(min=0, max=24 * 30)),
    }))


def async_unregister_services(hass: HomeAssistant) -> None:
    for name in SERVICES:
        hass.services.async_remove(DOMAIN, name)
