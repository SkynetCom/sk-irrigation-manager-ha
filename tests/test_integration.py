"""Integration tests running the engine inside a real Home Assistant core."""
import asyncio
import io
from datetime import datetime

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util

from conftest import model

DOMAIN = "sk_irrigation"
ZONES = [f"input_boolean.zone_{i}" for i in range(1, 5)]


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


async def _setup(hass: HomeAssistant):
    assert await async_setup_component(hass, "input_boolean", {
        "input_boolean": {**{z.split(".")[1]: {} for z in ZONES}, "rain": {}, "pump": {}},
    })
    hass.states.async_set("sensor.soc", "80")
    hass.states.async_set("sensor.precip", "no_rain")
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
    # layout save creates a sprinkler and its group membership in one write
    await client.send_json({"id": 5, "type": f"{DOMAIN}/save", "key": "layout", "value": {
        "zones": engine.config["zones"] + [{"id": "z9", "name": "New", "entity_id": "input_boolean.rain"}],
        "groups": [{"id": "g9", "name": "Fresh", "zone_ids": ["z9", "z1"]}]}})
    while True:
        msg = await client.receive_json()
        if msg["id"] == 5:
            break
    assert msg["result"]["config"]["groups"][0]["zone_ids"] == ["z9", "z1"]


async def test_candidates_include_area(hass):
    from homeassistant.helpers import area_registry as ar, entity_registry as er
    _, engine = await _setup(hass)
    area = ar.async_get(hass).async_create("Jardín")
    er.async_get(hass).async_update_entity(ZONES[0], area_id=area.id)
    cand = {c["entity_id"]: c for c in engine.candidates()}
    assert cand[ZONES[0]]["area"] == "Jardín"
    assert cand[ZONES[1]]["area"] is None


SOC_RECHECK = {"type": "numeric", "entity_id": "sensor.soc", "above": 20, "recheck": True, "label": "Battery"}


async def test_conditions_block_and_recheck_stops_run(hass):
    _, engine = await _setup(hass)
    await _configure(engine, concurrency=1, minutes=0.05)
    program = dict(engine.find_program("p1"), conditions=[
        {"type": "state", "entity_id": "sensor.precip", "states": ["no_rain"]}])
    await engine.async_save("programs", [program])
    await engine.async_save("settings", {**engine.settings, "conditions": [SOC_RECHECK]})
    # Global + program conditions block the scheduled trigger
    hass.states.async_set("sensor.precip", "rain")
    await engine._trigger_scheduled(engine.find_program("p1"))
    assert engine.current is None and engine.store.history[0]["status"] == "skipped"
    assert "sensor.precip" in engine.store.history[0]["reason"]
    assert engine.state_dict()["program_blocks"]["p1"]
    # ...and manual runs too (manual_conditions defaults to on)
    from custom_components.sk_irrigation.engine import ConditionBlocked
    with pytest.raises(ConditionBlocked):
        engine.enqueue_program(engine.find_program("p1"))
    hass.states.async_set("sensor.precip", "no_rain")
    await engine._trigger_scheduled(engine.find_program("p1"))
    await asyncio.sleep(0.3)
    assert _on(hass) == [ZONES[0]]
    # Battery drops while watering: next sprinkler must not start
    hass.states.async_set("sensor.soc", "15")
    await _wait_idle(hass, engine)
    last = engine.store.history[0]
    assert last["status"] == "stopped" and "Battery" in last["reason"]
    assert [z["zone_id"] for z in last["zones"]] == ["z1"]
    assert _on(hass) == [] and hass.states.get("input_boolean.pump").state == "off"


async def test_template_condition_and_ws_check(hass, hass_ws_client):
    _, engine = await _setup(hass)
    cond = {"id": "c1", "type": "template", "template": "{{ states('sensor.soc') | float(0) > 50 }}"}
    ok, _ = engine.evaluate(model.normalize_condition(cond))
    assert ok
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/check_conditions", "conditions": [
        cond, {"id": "c2", "type": "numeric", "entity_id": "sensor.soc", "below": 50}]})
    msg = await client.receive_json()
    assert [(r["id"], r["ok"]) for r in msg["result"]] == [("c1", True), ("c2", False)]


async def test_unavailable_sprinkler_is_skipped(hass):
    _, engine = await _setup(hass)
    await _configure(engine, concurrency=1, minutes=0.03)
    hass.states.async_set(ZONES[0], "unavailable")
    engine.enqueue_program(engine.find_program("p1"))
    await _wait_idle(hass, engine)
    last = engine.store.history[0]
    assert last["status"] == "completed"
    assert last["zones"][0] == {**last["zones"][0], "zone_id": "z1", "seconds": 0, "skipped": "unavailable"}
    assert [z["zone_id"] for z in last["zones"]][1:] == ["z2", "z3", "z4"]


async def test_estimates_and_instant_condition_push(hass):
    _, engine = await _setup(hass)
    await _configure(engine, concurrency=2, minutes=1)
    est = engine.state_dict()["program_estimates"]["p1"]
    assert est == 2 * 60 + 60  # 3 zones x1 min with 2 slots = 2 min, then g2 1 min (no delays)
    await engine.async_save("settings", {**engine.settings, "conditions": [SOC_RECHECK]})
    pushes = []
    engine.async_add_listener(lambda payload: pushes.append(payload["state"]["blocking"]))
    hass.states.async_set("sensor.soc", "10")
    await asyncio.sleep(1.3)
    assert pushes and any("Battery" in r for r in pushes[-1][0:1])


async def test_cards_registered_as_lovelace_resource(hass):
    assert await async_setup_component(hass, "lovelace", {})
    resources = hass.data["lovelace"].resources
    await resources.async_load()
    resources.loaded = True
    # an outdated entry from a previous version gets its version bumped, not duplicated
    await resources.async_create_item({"res_type": "module", "url": "/sk_irrigation_static/sk-irrigation-cards.js?v=0.0.1"})
    entry, _ = await _setup(hass)
    from custom_components.sk_irrigation import CARDS_URL
    urls = [i["url"] for i in resources.async_items()]
    assert urls == [CARDS_URL]
    from custom_components.sk_irrigation import CARDS_GLOBAL_URL
    assert CARDS_GLOBAL_URL in hass.data["frontend_extra_module_url"].urls
    # deleting the integration removes the resource
    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert [i["url"] for i in resources.async_items()] == []


async def test_map_image_upload_serve_and_cleanup(hass, hass_client, tmp_path):
    hass.config.config_dir = str(tmp_path)
    _, engine = await _setup(hass)
    client = await hass_client()
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    resp = await client.post("/api/sk_irrigation/map_image", data={"file": io.BytesIO(png)})
    assert resp.status == 200
    url = (await resp.json())["url"]
    assert url.startswith("/sk_irrigation_files/maps/") and url.endswith(".png")
    served = await client.get(url)
    assert served.status == 200 and await served.read() == png
    # not an image -> rejected
    bad = await client.post("/api/sk_irrigation/map_image", data={"file": io.BytesIO(b"<script>")})
    assert bad.status == 415

    await engine.async_save("zones", [{"id": "z1", "name": "Z1", "entity_id": ZONES[0]}])
    await engine.async_save("maps", [{"id": "m1", "name": "Plan", "kind": "image", "image": url,
                                      "shapes": {"z1": [[[0.1, 0.1], [0.1, 0.3], [0.3, 0.3]]]}}])
    assert engine.config["maps"][0]["shapes"]["z1"]
    name = url.rsplit("/", 1)[1]
    assert (tmp_path / DOMAIN / "maps" / name).exists()
    # deleting the map deletes its image
    await engine.async_save("maps", [])
    assert not (tmp_path / DOMAIN / "maps" / name).exists()


async def test_daily_stats_and_ws(hass, hass_ws_client):
    _, engine = await _setup(hass)
    await _configure(engine)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/action", "action": "run_program", "target": "p1"})
    assert (await client.receive_json())["success"]
    await _wait_idle(hass, engine)
    await client.send_json({"id": 2, "type": f"{DOMAIN}/stats"})
    res = await client.receive_json()
    days = res["result"]["days"]
    assert len(days) == 1
    prog = next(iter(days.values()))["p1"]
    assert prog["ok"] >= 1 and set(prog["z"]) == {"z1", "z2", "z3", "z4"}
