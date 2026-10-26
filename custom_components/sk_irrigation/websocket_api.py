"""Websocket API used by the SK Irrigation panel."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import COND_TEMPLATE, DOMAIN, SIGNAL_PROGRAMS_CHANGED, VERSION
from .engine import ConditionBlocked, IrrigationEngine
from .maps import async_cleanup_images
from .model import normalize_conditions


def _engine(hass: HomeAssistant) -> IrrigationEngine | None:
    return hass.data.get(DOMAIN, {}).get("engine")


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_data)
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_save)
    websocket_api.async_register_command(hass, ws_import)
    websocket_api.async_register_command(hass, ws_stats)
    websocket_api.async_register_command(hass, ws_history)
    websocket_api.async_register_command(hass, ws_action)
    websocket_api.async_register_command(hass, ws_check_conditions)


def _not_loaded(connection, msg) -> None:
    connection.send_error(msg["id"], "not_loaded", "SK Irrigation is not loaded")


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/data"})
@callback
def ws_data(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    engine = _engine(hass)
    if not engine:
        return _not_loaded(connection, msg)
    connection.send_result(msg["id"], {
        "version": VERSION,
        "config": engine.config,
        "state": engine.state_dict(),
        "candidates": engine.candidates(),
        "is_admin": connection.user.is_admin,
    })


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    engine = _engine(hass)
    if not engine:
        return _not_loaded(connection, msg)

    @callback
    def forward(payload: dict) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    connection.subscriptions[msg["id"]] = engine.async_add_listener(forward)
    connection.send_result(msg["id"])


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/save",
    vol.Required("key"): vol.In(["zones", "groups", "programs", "settings", "layout", "maps"]),
    vol.Required("value"): vol.Any(list, dict),
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    engine = _engine(hass)
    if not engine:
        return _not_loaded(connection, msg)
    await engine.async_save(msg["key"], msg["value"])
    connection.send_result(msg["id"], {"config": engine.config})


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/import",
    vol.Required("config"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_import(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    engine = _engine(hass)
    if not engine:
        return _not_loaded(connection, msg)
    await engine.store.async_replace(msg["config"])
    await async_cleanup_images(hass, engine.config["maps"])
    async_dispatcher_send(hass, SIGNAL_PROGRAMS_CHANGED)
    engine._watch_condition_entities()
    engine.notify(config_changed=True)
    connection.send_result(msg["id"], {"config": engine.config})


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/action",
    vol.Required("action"): vol.In([
        "run_program", "run_group", "run_zone", "stop", "skip", "rain_delay",
        "remove_queued", "set_enabled", "set_program_enabled",
    ]),
    vol.Optional("target"): str,
    vol.Optional("minutes"): vol.Coerce(float),
    vol.Optional("hours"): vol.Coerce(float),
    vol.Optional("concurrency"): vol.Coerce(int),
    vol.Optional("enabled"): bool,
})
@websocket_api.async_response
async def ws_action(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    engine = _engine(hass)
    if not engine:
        return _not_loaded(connection, msg)
    try:
        result = await _run_action(engine, msg, connection.user)
    except ConditionBlocked as err:
        return connection.send_result(msg["id"], {"run": None, "blocked": err.reasons, "state": engine.state_dict()})
    except LookupError as err:
        return connection.send_error(msg["id"], "not_found", str(err))
    connection.send_result(msg["id"], {"run": result, "state": engine.state_dict()})


async def _run_action(engine: IrrigationEngine, msg: dict, user: Any = None) -> Any:
    action = msg["action"]
    ref = msg.get("target")
    result: Any = None

    if action == "run_program":
        program = engine.find_program(ref or "")
        if not program:
            raise LookupError("Program not found")
        run = engine.enqueue_program(program)
        result = run.summary() if run else None
    elif action == "run_group":
        group = engine.find_group(ref or "")
        if not group:
            raise LookupError("Group not found")
        run = engine.enqueue_group(group, msg.get("minutes", 10), msg.get("concurrency", 1))
        result = run.summary() if run else None
    elif action == "run_zone":
        zone = engine.find_zone(ref or "")
        if not zone:
            raise LookupError("Zone not found")
        run = engine.enqueue_zone(zone, msg.get("minutes", 5))
        result = run.summary() if run else None
    elif action == "stop":
        await engine.async_stop_all({"kind": "user", "name": user.name, "id": user.id} if user else None)
    elif action == "skip":
        engine.skip(ref)
    elif action == "rain_delay":
        await engine.async_set_rain_delay(msg.get("hours", 0))
    elif action == "remove_queued":
        engine.remove_queued(ref or "")
    elif action == "set_enabled":
        await engine.async_set_enabled(msg.get("enabled", True))
    elif action == "set_program_enabled":
        await engine.async_set_program_enabled(ref or "", msg.get("enabled", True))
    return result


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/check_conditions",
    vol.Required("conditions"): list,
})
@callback
def ws_check_conditions(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Evaluate conditions as currently drafted in the UI (live ✓ / ✗ badges)."""
    engine = _engine(hass)
    if not engine:
        return _not_loaded(connection, msg)
    # Rendering arbitrary Jinja is admin-only in Home Assistant: other users only
    # get results for templates that are already part of the saved configuration.
    stored = None if connection.user.is_admin else engine.stored_templates()
    out = []
    for raw, cond in zip(msg["conditions"], normalize_conditions(msg["conditions"])):
        if stored is not None and cond["type"] == COND_TEMPLATE and cond["template"].strip() not in stored:
            ok, detail = False, "admin_only"
        else:
            ok, detail = engine.evaluate(cond)
        out.append({"id": raw.get("id") if isinstance(raw, dict) else None, "ok": ok, "detail": detail})
    connection.send_result(msg["id"], out)


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/stats",
    vol.Optional("since"): str,
})
@callback
def ws_stats(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Daily watering totals per program and sprinkler, for the Dashboard report."""
    engine = _engine(hass)
    if not engine:
        return _not_loaded(connection, msg)
    since = msg.get("since") or ""
    days = {k: v for k, v in engine.store.stats.items() if k >= since}
    connection.send_result(msg["id"], {"days": days})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/history"})
@callback
def ws_history(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """The whole stored run history (the pushed state only carries the latest runs)."""
    engine = _engine(hass)
    if not engine:
        return _not_loaded(connection, msg)
    connection.send_result(msg["id"], {"history": engine.store.history})
