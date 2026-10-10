import unittest
from datetime import date, timedelta
from types import SimpleNamespace as NS

from app.services.performance import (
    activity_points, compute_series, recovery_band, sleep_need_h, strain_from_points,
)


def history(last_hrv, last_rhr=50, slept_h=8.0, days=40):
    end = date(2026, 6, 30)
    health, sleep = {}, {}
    for i in range(days):
        d = end - timedelta(days=i)
        hrv = last_hrv if i == 0 else 60 + (i % 5) - 2          # baseline ~60 +/- 2
        rhr = last_rhr if i == 0 else 50 + (i % 3) - 1
        health[d] = NS(hrv_last_night=hrv, resting_hr=rhr, avg_respiration=None)
        sleep[d] = NS(total_seconds=int(slept_h * 3600), hrv_avg=None, resting_hr=None, avg_respiration=14.0)
    return end, health, sleep


class PerformanceTests(unittest.TestCase):
    def test_strain_curve_is_ordered_and_bounded(self):
        easy = strain_from_points(activity_points({"hrTimeInZone_2": 3600}, 3600))      # 60 min zone 2
        hard = strain_from_points(activity_points({"hrTimeInZone_4": 3600}, 3600))      # 60 min zone 4
        self.assertTrue(7 < easy < 11, easy)
        self.assertTrue(12 < hard < 16, hard)
        self.assertLess(strain_from_points(10_000), 21.01)
        self.assertEqual(strain_from_points(0), 0)

    def test_recovery_responds_to_hrv(self):
        def score(hrv):
            end, h, s = history(hrv)
            return compute_series(h, s, [], end, 1, 8.0)[0]["recovery"]
        hi, mid, lo = score(75), score(60), score(40)
        self.assertGreater(hi, mid)
        self.assertGreater(mid, lo)
        self.assertEqual(recovery_band(hi), "green")
        self.assertEqual(recovery_band(lo), "red")

    def test_not_enough_history_gives_no_score(self):
        end, h, s = history(60, days=4)
        self.assertIsNone(compute_series(h, s, [], end, 1, 8.0)[0]["recovery"])

    def test_sleep_need_grows_with_strain_and_debt(self):
        self.assertEqual(sleep_need_h(8.0, 0, 0), 8.0)
        self.assertGreater(sleep_need_h(8.0, 18, 0), 8.8)
        self.assertEqual(sleep_need_h(8.0, 21, 10), 10.0)   # both extras capped at +1h

    def test_strain_target_follows_recovery_band(self):
        end, h, s = history(75)
        row = compute_series(h, s, [], end, 1, 8.0)[0]
        self.assertEqual(row["strain_target"], [14, 18])
        self.assertEqual(row["sleep_performance"], 100)


if __name__ == "__main__":
    unittest.main()
