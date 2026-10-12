import json
import unittest
from datetime import date, timedelta
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import Activity, Insight, PlannedSession
from app.services import agent, cardio_extras, injury, planner, race_readiness


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


class RaceReadinessTests(unittest.TestCase):
    def test_ladder_grows_at_most_15pct_and_caps_at_target(self):
        out = race_readiness.project_ladder(longest_km=10, days_left=60, dist_km=25)
        kms = [s["km"] for s in out["ladder"]]
        self.assertEqual(out["target_km"], 20.0)
        self.assertEqual(kms, sorted(kms))
        self.assertLessEqual(kms[0], 11.5)
        self.assertEqual(max(kms), 20.0)

    def test_nine_days_with_a_6k_long_run_is_underprepared(self):
        out = race_readiness.project_ladder(6.0, 9, 25)
        self.assertLessEqual(out["projected_peak_km"], 7.0)
        self.assertEqual(race_readiness.verdict_for(out["ratio"]), "underprepared")

    def test_lower_body_injury_downgrades_one_level(self):
        self.assertEqual(race_readiness.verdict_for(0.95), "ready")
        self.assertEqual(race_readiness.verdict_for(0.95, lower_body_injury=True), "on_track")

    def test_assess_end_to_end(self):
        db = _db()
        self.assertIsNone(race_readiness.assess(db))
        today = date.today()
        cardio_extras.set_race_goal(db, "Birthday 25k", today + timedelta(days=9), "custom", None, 25.0)
        db.add(Activity(id="r1", date=today - timedelta(days=3), activity_type="running", distance_m=6000, duration_s=2100))
        db.commit()
        out = race_readiness.assess(db)
        self.assertEqual(out["race"]["distance_km"], 25.0)
        self.assertEqual(out["verdict"], "underprepared")
        self.assertEqual(out["bridge_plan"][-1]["kind"], "race")
        self.assertEqual(out["bridge_plan"][-2]["kind"], "rest")
        self.assertEqual(len(out["bridge_plan"]), 10)


class InjuryPlannerTests(unittest.TestCase):
    def test_region_and_defaults(self):
        self.assertEqual(injury.region("wrist (TFCC)"), "upper")
        self.assertEqual(injury.region("left achilles"), "lower")

    def test_wrist_injury_makes_strength_sessions_wrist_safe(self):
        db = _db()
        injury.add(db, {"area": "wrist (TFCC)", "side": "right"})
        titles = {s["title"] for s in planner._template(db, date.today()) if s["kind"] == "strength"}
        self.assertFalse(titles & {"Upper strength", "Full-body retention"})
        self.assertIn("Lower-body strength", titles)

    def test_logging_an_injury_rewrites_the_existing_week(self):
        db = _db()
        planner.ensure_week(db)
        before = {r.title for r in db.query(PlannedSession).filter(PlannedSession.kind == "strength")}
        self.assertIn("Upper strength", before)
        injury.add(db, {"area": "wrist (TFCC)", "side": "right"})
        after = {r.title for r in db.query(PlannedSession).filter(PlannedSession.kind == "strength", PlannedSession.date >= date.today())}
        self.assertNotIn("Upper strength", after)


class FakeProviderTests(unittest.TestCase):
    """Drive the real tool executor through run_turn with a scripted model."""

    def setUp(self):
        self.db = _db()

    def _run(self, script):
        def loop(ctx, system, history):
            yield from script(ctx, system, history)
        with mock.patch.object(agent, "_openai_loop", loop), mock.patch.object(agent.insights, "_resolve_provider", lambda p: "openai"), \
                mock.patch.object(agent.insights, "available_providers", lambda: {"openai": True, "anthropic": False}):
            return list(agent.run_turn(self.db, "hi", page="today"))

    def test_write_tool_blocks_and_persistence(self):
        def script(ctx, system, history):
            self.assertIn("STANDING CONTEXT", system)
            yield {"t": "text", "d": "Logged."}
            ctx.run("log_water", {"amount_ml": 500})
            yield from agent._drain(ctx)
        events = self._run(script)
        self.assertEqual(events[-1]["t"], "end")
        self.assertTrue(events[-1]["mutated"])
        row = self.db.get(Insight, events[-1]["id"])
        self.assertEqual([b["type"] for b in row.blocks], ["text", "done"])
        self.assertIn("500 ml", row.content)

    def test_destructive_tool_becomes_a_confirm_button_not_an_action(self):
        cardio_extras.set_race_goal(self.db, "R", date.today() + timedelta(days=5), "10k", None)
        ctx = agent.Ctx(self.db)
        out = json.loads(ctx.run("clear_race_goal", {}))
        self.assertEqual(out["status"], "awaiting_owner_confirmation")
        self.assertIsNotNone(cardio_extras.get_active_race(self.db))   # nothing was deleted
        self.assertFalse(ctx.ui_shown)                                  # a button must not suppress the compose step
        ctx.run("offer_actions", {"actions": [{"label": "Clear race", "tool": "clear_race_goal"}, {"label": "x", "tool": "overview"}]})
        self.assertEqual(len([e for e in ctx.events if e["type"] == "actions"]), 1)  # duplicate button dropped, read tool refused

    def test_execute_runs_confirm_tool_and_rejects_reads(self):
        cardio_extras.set_race_goal(self.db, "R", date.today() + timedelta(days=5), "10k", None)
        self.assertTrue(agent.execute(self.db, "clear_race_goal", {})["ok"])
        self.assertIsNone(cardio_extras.get_active_race(self.db))
        with self.assertRaises(ValueError): agent.execute(self.db, "overview", {})

    def test_schedule_sessions_replaces_planned_day_and_survives_regenerate(self):
        today = date.today()
        planner.ensure_week(self.db)
        ctx = agent.Ctx(self.db)
        out = json.loads(ctx.run("schedule_sessions", {"sessions": [{"date": today.isoformat(), "kind": "run", "title": "Long run 7 km", "distance_km": 7}]}))
        self.assertEqual(out["scheduled"], 1)
        rows = self.db.query(PlannedSession).filter(PlannedSession.date == today).all()
        self.assertEqual([r.title for r in rows], ["Long run 7 km"])
        planner.regenerate(self.db)
        self.assertTrue(self.db.query(PlannedSession).filter(PlannedSession.source == "coach").count() == 1)

    def test_set_race_goal_snaps_standard_distance(self):
        ctx = agent.Ctx(self.db)
        ctx.run("set_race_goal", {"name": "Half", "race_date": (date.today() + timedelta(days=30)).isoformat(), "distance_km": 21.1})
        self.assertEqual(cardio_extras.get_active_race(self.db)["distance_type"], "half_marathon")
        ctx.run("set_race_goal", {"name": "25k", "race_date": (date.today() + timedelta(days=30)).isoformat(), "distance_km": 25})
        r = next(x for x in cardio_extras.list_races(self.db) if x["name"] == "25k")
        self.assertEqual((r["distance_type"], r["distance_km"]), ("custom", 25.0))
        self.assertEqual(len(cardio_extras.list_races(self.db)), 2)   # adding a race keeps the earlier one

    def test_series_rejects_unknown_metric_and_reports_error(self):
        ctx = agent.Ctx(self.db)
        self.assertIn("unknown metric", json.loads(ctx.run("get_series", {"metric": "bogus"}))["error"])
        self.assertIn("error", json.loads(ctx.run("show_chart", {"metric": "hrv"})))  # no data -> no empty chart


if __name__ == "__main__":
    unittest.main()
