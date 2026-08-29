import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import Activity, BodyWeight, CutGoal, DailyHealth, PlannedSession, Workout
from app.services import planner


class Phase3PlannerTests(unittest.TestCase):
    def setUp(self):
        self.engine=create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db=sessionmaker(bind=self.engine)()
        for i in range(28):
            d=date.today()-timedelta(days=27-i)
            self.db.add(DailyHealth(date=d,resting_hr=55,hrv_last_night=70,training_readiness=75,calories_total=2500,steps=9000))
        self.db.add(BodyWeight(date=date.today()-timedelta(days=20),weight_kg=77))
        self.db.add(BodyWeight(date=date.today(),weight_kg=75))
        self.db.add(CutGoal(id=1,start_date=date.today()-timedelta(days=20),start_weight_kg=77,target_weight_kg=70,weekly_rate_kg=-.4,active=True))
        self.db.commit()

    def tearDown(self): self.db.close(); self.engine.dispose()

    def test_week_is_stable_and_has_training_mix(self):
        first=planner.week(self.db); second=planner.week(self.db)
        self.assertEqual([x["id"] for x in first["sessions"]],[x["id"] for x in second["sessions"]])
        kinds=[x["kind"] for x in first["sessions"]]
        self.assertEqual(kinds.count("run"),3); self.assertEqual(kinds.count("strength"),3)
        run_dates={x["date"] for x in first["sessions"] if x["kind"]=="run"}
        lift_dates={x["date"] for x in first["sessions"] if x["kind"]=="strength"}
        self.assertFalse(run_dates & lift_dates)

    def test_actual_activity_auto_completes_matching_plan(self):
        week=planner.week(self.db); run=next(x for x in week["sessions"] if x["kind"]=="run")
        self.db.add(Activity(id="test-run",date=date.fromisoformat(run["date"]),activity_type="running",distance_m=5000,source="garmin"));self.db.commit()
        updated=planner.week(self.db)
        matched=next(x for x in updated["sessions"] if x["id"]==run["id"])
        self.assertTrue(matched["auto_completed"]);self.assertEqual(matched["status"],"completed")

    def test_manual_status_and_reschedule(self):
        item=planner.week(self.db)["sessions"][0]
        tomorrow=date.today()+timedelta(days=1)
        planner.update_session(self.db,item["id"],{"status":"skipped","date":tomorrow.isoformat()})
        row=self.db.get(PlannedSession,item["id"])
        self.assertEqual(row.status,"skipped");self.assertEqual(row.date,tomorrow)

    def test_recovery_forecast_is_seven_days(self):
        values=planner.recovery_forecast(self.db)
        self.assertEqual(len(values),7)
        self.assertTrue(all("form" in x and "readiness" in x for x in values))

    def test_settings_are_bounded(self):
        cfg=planner.update_settings(self.db,{"run_days":99,"strength_days":0,"long_run_weekday":9})
        self.assertEqual(cfg["run_days"],6);self.assertEqual(cfg["strength_days"],1);self.assertEqual(cfg["long_run_weekday"],6)


if __name__=="__main__":unittest.main()
