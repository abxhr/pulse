import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import DailyHealth, Sleep
from app.services import phase2


class Phase2Tests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()

    def tearDown(self): self.db.close()

    def test_default_goals_are_ranked(self):
        rows = phase2.goals(self.db)
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[0]["key"], "health")
        self.assertEqual([r["priority"] for r in rows], [1, 2, 3, 4, 5])

    def test_checkin_is_upserted_and_bounded(self):
        first = phase2.save_checkin(self.db, {"phase": "morning", "energy": 2, "soreness": 4, "context_mode": "travel"})
        second = phase2.save_checkin(self.db, {"phase": "morning", "energy": 5, "context_mode": "normal"})
        self.assertEqual(first["phase"], "morning")
        self.assertEqual(second["energy"], 5)
        self.assertEqual(len(phase2.today_checkins(self.db)), 1)

    def test_water_accumulates(self):
        phase2.log_water(self.db, 250)
        total = phase2.log_water(self.db, 500)
        self.assertEqual(total["total_ml"], 750)
        with self.assertRaises(ValueError): phase2.log_water(self.db, 6000)

    def test_subjective_context_downgrades_plan(self):
        for i in range(10):
            d = date.today() - timedelta(days=9-i)
            self.db.add(DailyHealth(date=d, resting_hr=55, hrv_last_night=70, training_readiness=90, steps=10000))
            self.db.add(Sleep(date=d, total_seconds=8*3600, sleep_score=85, sleep_need_min=480))
        self.db.commit()
        baseline = phase2.daily_plan(self.db)["readiness_score"]
        phase2.save_checkin(self.db, {"phase":"morning", "energy":1, "soreness":5, "context_mode":"sick"})
        adjusted = phase2.daily_plan(self.db)
        self.assertLess(adjusted["readiness_score"], baseline)
        self.assertIn(adjusted["intensity"], {"rest", "easy"})

    def test_anomaly_state_persists(self):
        phase2.set_anomaly(self.db, "abc", "acknowledged")
        self.assertEqual(self.db.get(__import__("app.models", fromlist=["AnomalyState"]).AnomalyState, "abc").status, "acknowledged")


if __name__ == "__main__": unittest.main()
