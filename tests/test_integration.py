"""Integration tests running the engine inside a real Home Assistant core."""
import asyncio
from datetime import datetime

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util

DOMAIN = "sk_irrigation"
ZONES = [f"input_boolean.zone_{i}" for i in range(1, 5)]


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


async def _setup(hass: HomeAssistant):
    assert await async_setup_component(hass, "input_boolean", {
        "input_boolean": {**{z.split(".")[1]: {} for z in ZONES}, "rain": {}, "pump": {}},
    })
    entry = MockConfigEntry(domain=DOMAIN, data={"sidebar_title": "Riego"}, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry, hass.data[DOMAIN]["engine"]


async def _configure(engine, concurrency=2, minutes=0.05):
    await engine.async_save("zones", [{"id": f"z{i}", "name": f"Z{i}", "entity_id": e} for i, e in enumerate(ZONES, 1)])
    await engine.async_save("groups", [{"id": "g1", "name": "Front", "zone_ids": ["z1", "z2", "z3"]},
                                       {"id": "g2", "name": "Back", "zone_ids": ["z4"]}])
    await engine.async_save("settings", {**engine.settings, "zone_delay_s": 0, "step_delay_s": 0,
                                         "master_entity": "input_boolean.pump", "master_lead_s": 0, "master_lag_s": 0})
    await engine.async_save("programs", [{
        "id": "p1", "name": "Morning", "start_times": ["06:00"],
        "schedule": {"mode": "weekdays", "weekdays": list(range(7))},
        "steps": [{"group_id": "g1", "concurrency": concurrency, "duration": minutes},
                  {"group_id": "g2", "duration_mode": "custom", "duration": minutes, "durations": {"z4": minutes}}],
    }])


def _on(hass):
    return [z for z in ZONES if hass.states.get(z).state == "on"]


async def _wait_idle(hass, engine, timeout=20):
    for _ in range(timeout * 10):
        await asyncio.sleep(0.1)
        if engine.current is None and not engine.queue:
            await hass.async_block_till_done()
            return
    raise AssertionError("run did not finish")


async def test_setup_creates_entities_and_panel(hass):
    entry, engine = await _setup(hass)
    assert hass.states.get("sensor.sk_irrigation_manager_status") is not None
    assert hass.states.get("switch.sk_irrigation_manager_irrigation_system").state == "on"
    assert "sk-irrigation" in hass.data["frontend_panels"]
    await _configure(engine)
    await hass.async_block_till_done()
    assert hass.states.get("switch.sk_irrigation_manager_programa_morning") is not None
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert "sk-irrigation" not in hass.data["frontend_panels"]


async def test_program_runs_with_rolling_concurrency(hass):
    _, engine = await _setup(hass)
    await _configure(engine, concurrency=2, minutes=0.05)  # 3 s per zone
    await hass.services.async_call(DOMAIN, "run_program", {"program": "Morning"}, blocking=True)
    await asyncio.sleep(0.5)
    await hass.async_block_till_done()
    assert sorted(_on(hass)) == ZONES[:2]
    assert hass.states.get("input_boolean.pump").state == "on"
    assert hass.states.get("sensor.sk_irrigation_manager_status").state == "running"
    await asyncio.sleep(3.2)
    await hass.async_block_till_done()
    assert _on(hass) == [ZONES[2]]  # third zone took the free slot
    await _wait_idle(hass, engine)
    assert _on(hass) == []
    assert hass.states.get("input_boolean.pump").state == "off"
    last = engine.store.history[0]
    assert last["status"] == "completed"
    assert [z["zone_id"] for z in last["zones"]] == ["z1", "z2", "z3", "z4"]


async def test_external_off_and_stop(hass):
    _, engine = await _setup(hass)
    await _configure(engine, concurrency=1, minutes=1)
    engine.enqueue_program(engine.find_program("p1"))
    await asyncio.sleep(0.3)
    assert _on(hass) == [ZONES[0]]
    engine.skip()
    await asyncio.sleep(0.3)
    await hass.async_block_till_done()
    assert _on(hass) == [ZONES[1]]
    await hass.services.async_call(DOMAIN, "stop_all", {}, blocking=True)
    await hass.async_block_till_done()
    assert _on(hass) == []
    assert engine.store.history[0]["status"] == "stopped"


async def test_schedule_tick_and_rain_skip(hass):
    _, engine = await _setup(hass)
    await _configure(engine, minutes=0.02)
    tz = dt_util.get_default_time_zone()
    now = datetime.now(tz).replace(hour=6, minute=0, second=0, microsecond=0)
    await engine.async_save("settings", {**engine.settings, "rain_sensors": ["input_boolean.rain"]})
    await hass.services.async_call("input_boolean", "turn_on", {"entity_id": "input_boolean.rain"}, blocking=True)
    await engine._async_tick(now)
    assert engine.current is None and not engine.queue
    assert engine.store.history[0]["status"] == "skipped"
    assert "rain_sensor" in engine.store.history[0]["reason"]
    # Same minute does not fire twice; a new day fires once the sensor is dry.
    await hass.services.async_call("input_boolean", "turn_off", {"entity_id": "input_boolean.rain"}, blocking=True)
    await engine._async_tick(now)
    assert engine.current is None and not engine.queue
    engine._fired.clear()
    await engine._async_tick(now)
    assert engine.current is not None or engine.queue
    await _wait_idle(hass, engine)
    assert engine.store.history[0]["status"] == "completed"
    assert engine.next_run(engine.find_program("p1")) is not None


async def test_websocket_api(hass, hass_ws_client):
    _, engine = await _setup(hass)
    await _configure(engine)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/data"})
    msg = await client.receive_json()
    assert msg["success"]
    assert [z["id"] for z in msg["result"]["config"]["zones"]] == ["z1", "z2", "z3", "z4"]
    assert any(c["entity_id"] == ZONES[0] for c in msg["result"]["candidates"])
    await client.send_json({"id": 2, "type": f"{DOMAIN}/subscribe"})
    assert (await client.receive_json())["success"]
    await client.send_json({"id": 3, "type": f"{DOMAIN}/save", "key": "groups",
                            "value": [{"id": "g1", "name": "Renamed", "zone_ids": ["z2", "z1", "bogus"]}]})
    while True:
        msg = await client.receive_json()
        if msg["id"] == 3:
            break
    assert msg["result"]["config"]["groups"] == [{"id": "g1", "name": "Renamed", "color": "#1e88e5",
                                                  "icon": "mdi:sprinkler-variant", "zone_ids": ["z2", "z1"]}]
    # deleting group g2 removes its step from the program
    assert len(engine.config["programs"][0]["steps"]) == 1
    await client.send_json({"id": 4, "type": f"{DOMAIN}/action", "action": "rain_delay", "hours": 24})
    while True:
        msg = await client.receive_json()
        if msg["id"] == 4:
            break
    assert msg["result"]["state"]["status"] == "rain_delay"
