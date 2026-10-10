import unittest
from datetime import date, timedelta
from unittest import mock

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import api
from app.models import Base, Activity, PlannedSession
from app.services.planner import run_compliance, _week_start

from app.services.run_splits import best_window, decoupling_pct


def laps(paces, hrs=None, dist=1000):
    return [{"distance_m": dist, "duration_s": p * dist / 1000, "avg_hr": (hrs or [150] * len(paces))[i]}
            for i, p in enumerate(paces)]


class SplitTests(unittest.TestCase):
    def test_best_window_picks_fastest_consecutive(self):
        s = laps([400, 360, 350, 340, 330, 320, 380])  # fastest 5 consecutive = 360..320
        self.assertEqual(round(best_window(s, 5000)), round((360 + 350 + 340 + 330 + 320) * 5 / 5))
        self.assertIsNone(best_window(laps([300, 300]), 5000))

    def test_decoupling(self):
        steady = laps([360] * 8, [150] * 8)
        self.assertEqual(decoupling_pct(steady), 0.0)
        drift = laps([360] * 8, [140] * 4 + [154] * 4)  # same pace, HR up 10%
        self.assertGreater(decoupling_pct(drift), 5)
        self.assertIsNone(decoupling_pct(laps([360] * 4)))


class SplitsSyncTests(unittest.TestCase):
    def test_garmin_error_does_not_mark_runs_checked(self):
        eng = create_engine("sqlite://")
        Base.metadata.create_all(eng)
        good = [{"distance_m": 1000, "duration_s": 360, "avg_hr": 150}]
        calls = iter([good, RuntimeError("429")])

        def fake_fetch(client, aid, strict=False):
            r = next(calls)
            if isinstance(r, Exception):
                raise r
            return r

        with Session(eng) as db:
            for i in range(3):
                db.add(Activity(id=str(i), date=date.today() - timedelta(days=i), activity_type="running",
                                distance_m=8000, duration_s=2900))
            db.commit()
            with mock.patch.object(api.gc, "make_client", return_value=object()),                  mock.patch.object(api.gc, "fetch_splits", fake_fetch):
                with self.assertRaises(HTTPException) as cm:
                    api.splits_sync(batch_size=8, db=db)
            self.assertEqual(cm.exception.status_code, 502)
            by_id = {a.id: a.splits for a in db.query(Activity)}
            self.assertEqual(by_id["0"], good)   # saved before the failure
            self.assertIsNone(by_id["1"])        # failed run NOT marked as "checked"
            self.assertIsNone(by_id["2"])


class ComplianceTests(unittest.TestCase):
    def test_plan_vs_actual(self):
        eng = create_engine("sqlite://")
        Base.metadata.create_all(eng)
        wk = _week_start() - timedelta(weeks=1)
        with Session(eng) as db:
            self.assertEqual(run_compliance(db), [])
            db.add_all([
                PlannedSession(date=wk, kind="run", title="Easy", target={"distance_km": 8}),
                PlannedSession(date=wk + timedelta(days=2), kind="run", title="Long", target={"distance_km": 12}),
                PlannedSession(date=wk + timedelta(days=4), kind="run", title="Skip me", target={"distance_km": 5}, status="skipped"),
                Activity(id="a", date=wk, activity_type="running", distance_m=9000, duration_s=3000),
            ])
            db.commit()
            (w,) = run_compliance(db, weeks=2)
            self.assertEqual((w["planned_runs"], w["runs_done"], w["planned_km"], w["actual_km"]), (2, 1, 20.0, 9.0))
            self.assertEqual(w["km_pct"], 45)


if __name__ == "__main__":
    unittest.main()
