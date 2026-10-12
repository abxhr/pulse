import unittest
from datetime import date, timedelta

from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import Activity, Base, Shoe
from app.schemas import RaceGoalBody, WaterBody
from app.services import cardio_extras
from app.services.cardio_extras import list_shoes, repeat_routes


def run(i, days_ago, km, lat, lon, pace=330, shoe=None):
    return Activity(id=str(i), date=date.today() - timedelta(days=days_ago), activity_type="running",
                    distance_m=km * 1000, duration_s=km * pace, avg_pace_s_per_km=pace, shoe_id=shoe,
                    raw={"startLatitude": lat, "startLongitude": lon})


class CardioExtrasTests(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://")
        Base.metadata.create_all(eng)
        self.db = Session(eng)

    def tearDown(self):
        self.db.close()

    def test_several_races_coexist_and_the_soonest_is_tracked(self):
        today = date.today()
        cardio_extras.set_race_goal(self.db, "Birthday run", today + timedelta(days=9), "custom", None, 25.0)
        cardio_extras.set_race_goal(self.db, "Burj2Burj", today + timedelta(days=60), "half_marathon", None)
        self.assertEqual([r["name"] for r in cardio_extras.list_races(self.db)], ["Birthday run", "Burj2Burj"])
        self.assertEqual(cardio_extras.get_active_race(self.db)["name"], "Birthday run")
        # re-saving a name updates it instead of duplicating
        cardio_extras.set_race_goal(self.db, "burj2burj", today + timedelta(days=70), "half_marathon", None)
        self.assertEqual(len(cardio_extras.list_races(self.db)), 2)
        # once the birthday run is past, the next one takes over; removal is per race
        first = cardio_extras.list_races(self.db)[0]["id"]
        cardio_extras.clear_race_goal(self.db, first)
        self.assertEqual([r["name"] for r in cardio_extras.list_races(self.db)], ["Burj2Burj"])

    def test_shoe_totals_are_summed_in_sql(self):
        self.db.add(Shoe(id=1, name="A", start_date=date.today(), target_km=700))
        self.db.add_all([run(1, 1, 10, 1, 1, shoe=1), run(2, 2, 5.5, 1, 1, shoe=1), run(3, 3, 8, 1, 1)])
        self.db.commit()
        (shoe,) = list_shoes(self.db)
        self.assertEqual(shoe["total_km"], 15.5)

    def test_repeat_routes_cluster_by_start_and_keep_the_fastest(self):
        self.db.add_all([run(1, 1, 5.0, 51.5001, -0.1201, pace=340), run(2, 2, 5.1, 51.5002, -0.1202, pace=320),
                         run(3, 3, 5.0, 51.5003, -0.1203, pace=350), run(4, 4, 12.0, 51.5001, -0.1201),  # different length
                         run(5, 5, 5.0, 40.0, 10.0)])                                                       # elsewhere
        self.db.commit()
        (route,) = repeat_routes(self.db)
        self.assertEqual(route["runs"], 3)
        self.assertEqual(route["best_pace_s_per_km"], 320)

    def test_bad_request_bodies_are_rejected_not_500s(self):
        with self.assertRaises(ValidationError):
            RaceGoalBody(name="", race_date="2026-10-01", distance_type="10k")
        with self.assertRaises(ValidationError):
            RaceGoalBody(name="City 10K", race_date="not-a-date", distance_type="10k")
        with self.assertRaises(ValidationError):
            RaceGoalBody(name="City 10K", race_date="2026-10-01", distance_type="ultra")
        with self.assertRaises(ValidationError):
            WaterBody(amount_ml=-5)
        self.assertEqual(RaceGoalBody(name="City 10K", race_date="2026-10-01", distance_type="10k").target_time_s, None)


if __name__ == "__main__":
    unittest.main()
