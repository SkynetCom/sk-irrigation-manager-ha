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
