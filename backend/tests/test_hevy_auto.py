import unittest
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings
from app.integrations import hevy_free_client as hf
from app.models import Base, SyncLog, Workout
from app.services import hevy_mode, sync


def csv_row(day, start, title="Pull", dur=3600):
    return Workout(id=f"csv-{title}-{start:%H%M}", date=day, start_time=start, title=title,
                   duration_s=dur, volume_kg=1000.0, source="hevy-csv")


class HevyModeTests(unittest.TestCase):
    def test_auto_picks_best_available_source(self):
        with mock.patch.object(settings, "hevy_mode", "auto"):
            with mock.patch.object(settings, "hevy_api_key", "k"):
                self.assertEqual(hevy_mode.effective_mode(), "pro")
            with mock.patch.object(settings, "hevy_api_key", None), mock.patch.object(hevy_mode, "saved_labels", return_value=["default"]):
                self.assertEqual(hevy_mode.effective_mode(), "unofficial")
            with mock.patch.object(settings, "hevy_api_key", None), mock.patch.object(hevy_mode, "saved_labels", return_value=[]), \
                 mock.patch.object(settings, "hevy_access_token", None):
                self.assertEqual(hevy_mode.effective_mode(), "csv")

    def test_explicit_mode_is_respected(self):
        with mock.patch.object(settings, "hevy_mode", "csv"), mock.patch.object(hevy_mode, "saved_labels", return_value=["default"]):
            self.assertEqual(hevy_mode.effective_mode(), "csv")


class DedupeTests(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://")
        Base.metadata.create_all(eng)
        self.db = Session(eng)

    def tearDown(self):
        self.db.close()

    def api(self, wid, start, title="Pull", dur=3600):
        return {"id": f"hevy-{wid}", "date": start.date(), "start_time": start, "title": title,
                "duration_s": dur, "volume_kg": 1234.0, "source": "hevy-api", "exercises": []}

    def test_api_workout_updates_the_matching_csv_row_instead_of_duplicating(self):
        d = date(2026, 8, 27)
        self.db.add(csv_row(d, datetime(2026, 8, 27, 16, 2)))   # CSV: minute precision
        self.db.commit()
        n = sync._import_workouts(self.db, [self.api("abc", datetime(2026, 8, 27, 16, 2, 41))], match_existing=True)
        rows = self.db.query(Workout).all()
        self.assertEqual((n, len(rows)), (1, 1))
        self.assertEqual(rows[0].id, "csv-Pull-1602")           # id kept, so nothing that references it breaks
        self.assertEqual(rows[0].source, "hevy-api")
        self.assertEqual(rows[0].volume_kg, 1234.0)

    def test_matches_by_title_and_duration_when_start_times_disagree(self):
        d = date(2026, 8, 27)
        self.db.add(csv_row(d, datetime(2026, 8, 27, 16, 2), dur=3600))
        self.db.commit()
        sync._import_workouts(self.db, [self.api("x", datetime(2026, 8, 27, 12, 2), dur=3650)], match_existing=True)  # clock off by 4h
        self.assertEqual(self.db.query(Workout).count(), 1)

    def test_genuinely_new_or_different_sessions_are_added(self):
        d = date(2026, 8, 27)
        self.db.add(csv_row(d, datetime(2026, 8, 27, 7, 0), title="Pull"))
        self.db.commit()
        sync._import_workouts(self.db, [self.api("new", datetime(2026, 8, 27, 18, 30), title="Legs", dur=1800)], match_existing=True)
        self.assertEqual(self.db.query(Workout).count(), 2)

    def test_reimporting_the_same_api_workout_is_idempotent(self):
        w = self.api("same", datetime(2026, 8, 28, 9, 0))
        sync._import_workouts(self.db, [w], match_existing=True)
        sync._import_workouts(self.db, [dict(w, volume_kg=2000.0)], match_existing=True)
        (row,) = self.db.query(Workout).all()
        self.assertEqual(row.volume_kg, 2000.0)


class CatchupTests(unittest.TestCase):
    def test_window_widens_to_cover_the_gap_since_the_last_good_sync(self):
        eng = create_engine("sqlite://")
        Base.metadata.create_all(eng)
        with Session(eng) as db:
            self.assertEqual(sync.catchup_days(db), settings.default_backfill_days)  # never synced -> full backfill
            db.add(SyncLog(source="garmin", status="ok", finished_at=datetime.utcnow() - timedelta(days=20)))
            db.commit()
            self.assertEqual(sync.catchup_days(db), 22)
            db.add(SyncLog(source="garmin", status="ok", finished_at=datetime.utcnow() - timedelta(minutes=30)))
            db.commit()
            self.assertEqual(sync.catchup_days(db), settings.quick_sync_days)


class FreeClientTests(unittest.TestCase):
    def test_datetimes_become_naive_local_time(self):
        dt = hf._dt("2026-08-27T12:02:00+00:00")
        self.assertIsNone(dt.tzinfo)
        self.assertEqual(dt, datetime(2026, 8, 27, 12, 2, tzinfo=__import__("datetime").timezone.utc).astimezone().replace(tzinfo=None))

    def test_incremental_fetch_stops_once_the_feed_is_older_than_since(self):
        newest_first = [{"id": str(i), "title": "W", "start_time": f"2026-0{9 if i < 3 else 1}-15T10:00:00"} for i in range(200)]
        pulled = []

        def feed(*a, **k):
            for w in newest_first:
                pulled.append(w["id"])
                yield w

        client = SimpleNamespace(users=SimpleNamespace(get_account=lambda: {"username": "me"}),
                                 workouts=SimpleNamespace(iter_paged=feed))
        ctx = mock.MagicMock()
        ctx.__enter__.return_value = client
        with mock.patch.object(hf, "_client", return_value=ctx):
            out = hf.fetch_all_workouts(since=date(2026, 8, 1))
        self.assertLess(len(pulled), 40)           # stopped early, did not walk all 200
        self.assertGreaterEqual(len(out), 3)       # but kept the 3 recent ones


if __name__ == "__main__":
    unittest.main()


class ConnectEndpointTests(unittest.TestCase):
    def test_connect_is_local_only_launches_the_login_helper_once(self):
        from fastapi import HTTPException
        from app import api

        with mock.patch.object(api, "_direct_loopback", return_value=False):
            with self.assertRaises(HTTPException) as cm:
                api.hevy_connect(SimpleNamespace())
            self.assertEqual(cm.exception.status_code, 403)

        proc = mock.MagicMock()
        proc.poll.return_value = None                       # still running
        api._hevy_login["proc"] = None
        with mock.patch.object(api, "_direct_loopback", return_value=True), \
             mock.patch("subprocess.Popen", return_value=proc) as popen, mock.patch("builtins.open", mock.mock_open()):
            first = api.hevy_connect(SimpleNamespace())
            second = api.hevy_connect(SimpleNamespace())    # already open: must not spawn another
        self.assertTrue(first["started"])
        self.assertFalse(second["started"])
        self.assertEqual(popen.call_count, 1)
        self.assertEqual(popen.call_args.args[0][1:], ["-m", "app.hevy_auth"])   # fixed argv, no user input
        api._hevy_login["proc"] = None
