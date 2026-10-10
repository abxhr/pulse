import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import Base, Activity
from app.services.analytics import run_insights, decide_session


def run(i, days_ago, km, mins, hr, z=(0, 0, 0, 0, 0)):
    return Activity(id=str(i), date=date.today() - timedelta(days=days_ago), activity_type="running",
                    distance_m=km * 1000, duration_s=mins * 60, avg_hr=hr,
                    raw={f"hrTimeInZone_{n + 1}": s * 60 for n, s in enumerate(z)})


class RunInsightsTests(unittest.TestCase):
    def test_efficiency_and_split(self):
        eng = create_engine("sqlite://")
        Base.metadata.create_all(eng)
        with Session(eng) as db:
            self.assertIsNone(run_insights(db))
            # same pace, lower HR recently -> efficiency up
            db.add_all([run(1, 40, 10, 60, 160), run(2, 3, 10, 60, 150, z=(20, 30, 0, 5, 5))])
            db.commit()
            r = run_insights(db)
            self.assertGreater(r["efficiency_change_pct"], 0)
            w = r["weeks"][-1]
            self.assertEqual(r["bests"]["5k"]["pace_s_per_km"], 360)
            self.assertEqual(sum(r["pace_bands"].values()), 2)
            self.assertNotIn("half", r["bests"])
            self.assertEqual((w["easy_pct"], w["hard_pct"], w["long_run_pct"]), (83, 17, 100))


class SplitInsightTests(unittest.TestCase):
    def test_bests_and_decoupling_from_splits(self):
        eng = create_engine("sqlite://")
        Base.metadata.create_all(eng)
        laps = [{"distance_m": 1000, "duration_s": 360 - i, "avg_hr": 140 if i < 4 else 154} for i in range(8)]
        with Session(eng) as db:
            a = run(1, 3, 8, 48, 147)
            a.splits = laps
            db.add(a)
            db.commit()
            r = run_insights(db)
            self.assertEqual(r["bests"]["5k"]["source"], "splits")
            self.assertEqual(r["bests"]["5k"]["time_s"], 357 + 356 + 355 + 354 + 353)
            self.assertGreater(r["decoupling"][0]["pct"], 5)
            self.assertEqual(r["splits_coverage"], {"with_splits": 1, "runs": 1})


class DecideTests(unittest.TestCase):
    def test_worst_signal_wins(self):
        self.assertEqual(decide_session(10, 5, 80)[0], "hard")
        self.assertEqual(decide_session(10, -25, 80)[0], "easy")
        self.assertEqual(decide_session(80, 5, 80)[0], "rest")
        self.assertEqual(decide_session(None, None, None)[0], "unknown")


if __name__ == "__main__":
    unittest.main()
