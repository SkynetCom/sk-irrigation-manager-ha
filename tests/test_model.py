"""Unit tests for scheduling and planning logic (no Home Assistant required)."""
from datetime import date

from conftest import model as m


def _cfg():
    return m.normalize_all({
        "zones": [
            {"id": "z1", "name": "A", "entity_id": "switch.a"},
            {"id": "z2", "name": "B", "entity_id": "switch.b"},
            {"id": "z3", "name": "C", "entity_id": "valve.c"},
            {"id": "z4", "name": "Off", "entity_id": "switch.d", "enabled": False},
        ],
        "groups": [
            {"id": "g1", "name": "G1", "zone_ids": ["z1", "z2", "z3", "z4", "ghost"]},
            {"id": "g2", "name": "G2", "zone_ids": ["z3"]},
        ],
        "programs": [{
            "id": "p1", "name": "P",
            "start_times": ["06:00", {"type": "sunset", "offset": -30}, "25:99"],
            "steps": [
                {"group_id": "g1", "concurrency": 2, "duration_mode": "uniform", "duration": 10},
                {"group_id": "g2", "duration_mode": "custom", "duration": 5, "durations": {"z3": 7}},
                {"group_id": "missing"},
            ],
        }],
    })


def test_normalize_drops_bad_references():
    cfg = _cfg()
    assert cfg["groups"][0]["zone_ids"] == ["z1", "z2", "z3", "z4"]
    prog = cfg["programs"][0]
    assert len(prog["steps"]) == 2
    assert prog["start_times"] == [{"type": "fixed", "time": "06:00"}, {"type": "sunset", "offset": -30}]
    assert cfg["settings"]["enabled"] is True


def test_deleting_zone_cascades():
    cfg = _cfg()
    cfg["zones"] = [z for z in cfg["zones"] if z["id"] != "z3"]
    cfg = m.normalize_all(cfg)
    assert "z3" not in cfg["groups"][0]["zone_ids"]
    assert cfg["groups"][1]["zone_ids"] == []


def test_weekdays_and_months():
    s = m.normalize_schedule({"mode": "weekdays", "weekdays": [0, 2], "months": [10]})
    assert m.is_active_day(s, date(2026, 10, 12))  # Monday
    assert not m.is_active_day(s, date(2026, 10, 13))  # Tuesday
    assert not m.is_active_day(s, date(2026, 11, 2))  # Monday but November


def test_interval():
    s = m.normalize_schedule({"mode": "interval", "interval_days": 3, "anchor_date": "2026-10-01"})
    assert m.is_active_day(s, date(2026, 10, 1))
    assert m.is_active_day(s, date(2026, 10, 4))
    assert not m.is_active_day(s, date(2026, 10, 5))
    assert not m.is_active_day(s, date(2026, 9, 28))  # before anchor


def test_monthdays_odd_even_dates():
    md = m.normalize_schedule({"mode": "monthdays", "month_days": [1, 15]})
    assert m.is_active_day(md, date(2026, 3, 15)) and not m.is_active_day(md, date(2026, 3, 16))
    odd = m.normalize_schedule({"mode": "odd"})
    assert m.is_active_day(odd, date(2026, 1, 3)) and not m.is_active_day(odd, date(2026, 1, 31))
    even = m.normalize_schedule({"mode": "even"})
    assert m.is_active_day(even, date(2026, 1, 4))
    dates = m.normalize_schedule({"mode": "dates", "dates": ["12-24", "2026-07-09", "bad"]})
    assert dates["dates"] == ["12-24", "2026-07-09"]
    assert m.is_active_day(dates, date(2030, 12, 24))
    assert m.is_active_day(dates, date(2026, 7, 9)) and not m.is_active_day(dates, date(2027, 7, 9))


def test_build_plan_budget_custom_and_disabled():
    cfg = _cfg()
    zones = {z["id"]: z for z in cfg["zones"]}
    groups = {g["id"]: g for g in cfg["groups"]}
    plan = m.build_program_plan(cfg["programs"][0], zones, groups, budget_pct=50, max_minutes=120)
    assert [z.zone_id for z in plan[0].zones] == ["z1", "z2", "z3"]  # z4 disabled
    assert plan[0].zones[0].seconds == 300  # 10 min * 50%
    assert plan[1].zones[0].seconds == 210  # custom 7 min * 50%
    assert plan[0].concurrency == 2


def test_custom_zero_skips_zone():
    cfg = _cfg()
    cfg["programs"][0]["steps"][1]["durations"]["z3"] = 0
    zones = {z["id"]: z for z in cfg["zones"]}
    groups = {g["id"]: g for g in cfg["groups"]}
    plan = m.build_program_plan(cfg["programs"][0], zones, groups, 100, 120)
    assert len(plan) == 1


def test_rolling_concurrency_estimate():
    # 2 slots: A(10) and B(5) start together, C(5) starts when B ends.
    assert m.estimate_step_seconds([10, 5, 5], 2, 0) == 10
    assert m.estimate_step_seconds([10, 5, 5], 1, 0) == 20
    assert m.estimate_step_seconds([10, 5, 5], 1, 2) == 24
    assert m.estimate_step_seconds([10, 5, 5], 3, 0) == 10


def test_resolve_concurrency_with_global_cap():
    assert m.resolve_concurrency(0, 5, 0) == 5
    assert m.resolve_concurrency(0, 5, 2) == 2
    assert m.resolve_concurrency(4, 3, 0) == 3
    assert m.resolve_concurrency(1, 3, 2) == 1


def test_plan_total_includes_step_delay():
    steps = [m.PlannedStep("a", 1, [m.PlannedZone("z1", 60)]), m.PlannedStep("b", 1, [m.PlannedZone("z2", 60)])]
    assert m.estimate_plan_seconds(steps, 0, 5, 30) == 150


def test_step_order_and_skip():
    cfg = _cfg()
    step = cfg["programs"][0]["steps"][0]
    step.update({"order": ["z3", "z1", "ghost"], "skip": ["z2"]})
    cfg = m.normalize_all(cfg)
    step = cfg["programs"][0]["steps"][0]
    assert step["order"] == ["z3", "z1"] and step["skip"] == ["z2"]
    zones = {z["id"]: z for z in cfg["zones"]}
    groups = {g["id"]: g for g in cfg["groups"]}
    plan = m.build_program_plan(cfg["programs"][0], zones, groups, 100, 120)
    # chosen order first, skipped zone dropped, disabled zone (z4) still excluded
    assert [z.zone_id for z in plan[0].zones] == ["z3", "z1"]


def test_order_keeps_new_group_members():
    group = {"zone_ids": ["a", "b", "c"]}
    assert m.step_zone_order({"order": ["c", "x"]}, group) == ["c", "a", "b"]


def test_condition_state_numeric_unavailable():
    rain = m.normalize_condition({"type": "state", "entity_id": "sensor.desc", "states": "no_rain"})
    assert m.evaluate_condition(rain, "no_rain")[0]
    assert not m.evaluate_condition(rain, "light_rain")[0]
    assert not m.evaluate_condition(rain, "unavailable")[0]  # default: unavailable blocks
    not_rain = m.normalize_condition({"entity_id": "sensor.desc", "operator": "not", "states": ["rain", "storm"]})
    assert m.evaluate_condition(not_rain, "sunny")[0] and not m.evaluate_condition(not_rain, "storm")[0]
    mm = m.normalize_condition({"type": "numeric", "entity_id": "sensor.mm", "below": 5, "unavailable": "pass"})
    assert m.evaluate_condition(mm, "4.9")[0] and not m.evaluate_condition(mm, "5")[0]
    assert m.evaluate_condition(mm, "unknown")[0]  # like float(0) in a template
    soc = m.normalize_condition({"type": "numeric", "entity_id": "sensor.soc", "above": 20})
    assert m.evaluate_condition(soc, 21)[0] and not m.evaluate_condition(soc, "20")[0]
    assert "sensor.soc > 20" == m.describe_condition(soc)
    cfg = m.normalize_all({"settings": {"conditions": [{"type": "numeric", "entity_id": "sensor.soc", "above": 20}]}})
    assert cfg["settings"]["conditions"][0]["above"] == 20.0


def test_maps_normalisation():
    cfg = m.normalize_all({
        "zones": [{"id": "z1", "name": "A", "entity_id": "switch.a"}],
        "maps": [
            {"id": "m1", "name": "Plan", "kind": "image", "image": "/sk_irrigation_files/maps/abc.jpg", "image_w": 1600, "image_h": 1000,
             "shapes": {
                 "z1": [[[0.1, 0.1], [0.1, 0.2], [0.2, 0.2]], [[0.5, 0.5], [0.6, 0.6]]],  # 2nd part has < 3 points
                 "ghost": [[[0.1, 0.1], [0.1, 0.2], [0.2, 0.2]]],
             }},
            {"id": "m2", "kind": "satellite", "center": [9.6493, -85.1497], "image": "javascript:alert(1)",
             "shapes": {"z1": [[[9.649, -85.149], [9.6491, -85.1489], [9.6492, -85.149], ["x", 1]]]}},
        ],
    })
    plan, sat = cfg["maps"]
    assert plan["shapes"] == {"z1": [[[0.1, 0.1], [0.1, 0.2], [0.2, 0.2]]]}
    assert plan["image"] == "/sk_irrigation_files/maps/abc.jpg"
    assert sat["kind"] == "satellite" and sat["image"] == "" and sat["center"] == [9.6493, -85.1497]
    assert len(sat["shapes"]["z1"][0]) == 3
    assert m.map_image_files(cfg["maps"]) == {"abc.jpg"}
    # a deleted sprinkler disappears from every map
    cfg2 = m.normalize_all({**cfg, "zones": []})
    assert cfg2["maps"][0]["shapes"] == {}


def test_daily_stats_accumulate():
    stats = {}
    m.add_run_to_stats(stats, {"program_id": "p1", "status": "completed", "start": "2026-10-17T04:00:00-06:00",
                               "zones": [{"zone_id": "z1", "seconds": 300}, {"zone_id": "z2", "seconds": 120.4}]})
    m.add_run_to_stats(stats, {"program_id": "p1", "status": "stopped", "start": "2026-10-17T18:00:00-06:00",
                               "zones": [{"zone_id": "z1", "seconds": 60}]})
    m.add_run_to_stats(stats, {"program_id": "p1", "status": "skipped", "start": "2026-10-18T04:00:00-06:00",
                               "reason": "condition:Lluvia ayer < 5 mm (sensor.precipitation_yesterday = 21.3)", "zones": []})
    m.add_run_to_stats(stats, {"program_id": "p1", "status": "skipped", "start": "2026-10-18T18:00:00-06:00",
                               "reason": "condition:Batería > 20 % (sensor.soc = 12)", "zones": []})
    m.add_run_to_stats(stats, {"program_id": None, "status": "completed", "start": "2026-10-18T10:00:00-06:00",
                               "zones": [{"zone_id": "z3", "seconds": 600}]})
    day1 = stats["2026-10-17"]["p1"]
    assert day1["z"] == {"z1": 360, "z2": 120} and day1["ok"] == 1 and day1["stop"] == 1
    assert stats["2026-10-18"]["p1"]["rain"] == 1 and stats["2026-10-18"]["p1"]["cond"] == 1
    assert stats["2026-10-18"][m.STATS_MANUAL]["z"] == {"z3": 600}
    m.prune_stats(stats, date(2036, 10, 18), keep_days=3653)
    assert "2026-10-17" not in stats and "2026-10-18" in stats
