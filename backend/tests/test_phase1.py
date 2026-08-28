import unittest
from datetime import date, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import Sleep, DailyHealth, Workout, Meal
from app.services import analytics, auth, nutrition


class PhaseOneRegressionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_garmin_sleep_need_has_safe_floor(self):
        for i, need in enumerate([390, 400, 410, 395, 405]):
            self.db.add(Sleep(date=date.today() - timedelta(days=i), sleep_need_min=need))
        self.db.commit()
        self.assertEqual(analytics.personalized_sleep_target(self.db), 7.0)

    def test_sleep_gap_caps_extreme_single_night(self):
        for i in range(7):
            self.db.add(Sleep(date=date.today() - timedelta(days=i), total_seconds=2 * 3600, sleep_score=50))
        self.db.commit()
        gap = analytics.sleep_debt(self.db, days=7, target_hours=8)
        self.assertEqual(gap["debt_hours"], 21.0)
        self.assertTrue(gap["estimated"])

    def test_activity_categories_are_sport_specific(self):
        self.assertEqual(analytics.activity_category("treadmill_running"), "run")
        self.assertEqual(analytics.activity_category("open_water_swimming"), "swim")
        self.assertEqual(analytics.activity_category("strength_training"), "strength")
        self.assertEqual(analytics.activity_category("kayaking"), "paddle")

    def test_password_and_opaque_session(self):
        auth.set_password(self.db, "a sufficiently long password")
        self.assertTrue(auth.verify_password(self.db, "a sufficiently long password"))
        self.assertFalse(auth.verify_password(self.db, "wrong password"))
        token = auth.create_session(self.db)
        self.assertTrue(auth.valid_session(self.db, token))
        auth.revoke_session(self.db, token)
        self.assertFalse(auth.valid_session(self.db, token))

    def test_nutrition_completeness_resets_after_edit(self):
        today = date.today()
        meal = nutrition.add_meal(self.db, {"date": today.isoformat(), "name": "Lunch", "calories": 500})
        nutrition.set_day_complete(self.db, today, True)
        self.assertTrue(nutrition.day_summary(self.db, today)["complete"])
        nutrition.update_meal(self.db, meal["id"], {"calories": 550})
        self.assertFalse(nutrition.day_summary(self.db, today)["complete"])

    def test_freshness_marks_old_hevy_data_stale(self):
        self.db.add(DailyHealth(date=date.today(), resting_hr=55))
        self.db.add(Workout(id="old", date=date.today() - timedelta(days=10), title="Old"))
        self.db.commit()
        result = analytics.data_freshness(self.db)
        self.assertFalse(result["sources"]["garmin_health"]["stale"])
        self.assertTrue(result["sources"]["hevy"]["stale"])


if __name__ == "__main__":
    unittest.main()
