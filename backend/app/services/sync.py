"""Sync orchestration: pull from sources, upsert into the local DB, log each run."""
from __future__ import annotations
from datetime import date, datetime, timedelta
from pathlib import Path
import logging

from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal
from ..models import DailyHealth, Sleep, Activity, Workout, SyncLog
from ..integrations import garmin_client as gc
from ..integrations import hevy_client as hc

log = logging.getLogger("pulse.sync")


def _upsert(db: Session, model, pk_field: str, data: dict):
    pk = data[pk_field]
    obj = db.get(model, pk)
    if obj is None:
        obj = model(**data)
        db.add(obj)
    else:
        for k, v in data.items():
            setattr(obj, k, v)
    return obj


def _log_start(db: Session, source: str) -> SyncLog:
    entry = SyncLog(source=source, status="running")
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def _log_finish(db: Session, entry: SyncLog, status: str, records: int, message: str = ""):
    entry.status = status
    entry.records = records
    entry.finished_at = datetime.utcnow()
    entry.message = message[:1000] if message else None
    db.commit()


_STOP_AFTER_EMPTY_DAYS = 60  # give up backfilling once this many consecutive days come back empty


def sync_garmin(days: int | None = None, db: Session | None = None) -> dict:
    days = days or settings.default_backfill_days
    own = db is None
    db = db or SessionLocal()
    entry = _log_start(db, "garmin")
    n = 0
    try:
        client = gc.make_client()
        today = date.today()

        # Activities first: one cheap ranged call (internally paginated), so runs/
        # rides show up immediately instead of waiting on the much slower day-by-day
        # wellness loop below.
        acts = gc.fetch_activities(client, today - timedelta(days=days), today)
        for a in acts:
            if a.get("id"):
                _upsert(db, Activity, "id", a)
        db.commit()

        # Daily health + sleep, one date at a time, newest first. Once we hit a long
        # stretch of consecutive days with nothing at all, we've gone past the start
        # of the device's actual history — stop instead of grinding through empty years.
        consecutive_empty = 0
        for i in range(days):
            day = today - timedelta(days=i)
            health = gc.fetch_daily_health(client, day)
            sleep = gc.fetch_sleep(client, day)
            is_empty = health.get("steps") is None and health.get("resting_hr") is None and not sleep
            consecutive_empty = consecutive_empty + 1 if is_empty else 0

            _upsert(db, DailyHealth, "date", health)
            if sleep:
                _upsert(db, Sleep, "date", sleep)
            n += 1
            if i % 10 == 0:
                db.commit()

            if consecutive_empty >= _STOP_AFTER_EMPTY_DAYS:
                log.info("garmin sync: stopping early at %s after %d empty days", day, consecutive_empty)
                break
        db.commit()
        _log_finish(db, entry, "ok", n + len(acts), f"{n} days, {len(acts)} activities")
        return {"status": "ok", "days": n, "activities": len(acts)}
    except Exception as e:
        db.rollback()
        _log_finish(db, entry, "error", n, str(e))
        log.exception("garmin sync failed")
        return {"status": "error", "message": str(e)}
    finally:
        if own:
            db.close()


def _import_workouts(db: Session, workouts: list[dict]) -> int:
    n = 0
    for data in workouts:
        if data.get("id"):
            _upsert(db, Workout, "id", data)
            n += 1
            if n % 25 == 0:
                db.commit()
    db.commit()
    return n


def import_csv_file(path: str, db: Session | None = None) -> dict:
    """Import a single Hevy CSV export file."""
    from ..integrations import hevy_csv
    own = db is None
    db = db or SessionLocal()
    entry = _log_start(db, "hevy-csv")
    try:
        workouts = hevy_csv.parse_csv(path)
        n = _import_workouts(db, workouts)
        _log_finish(db, entry, "ok", n, f"{n} workouts from {Path(path).name}")
        return {"status": "ok", "workouts": n, "file": Path(path).name}
    except Exception as e:
        db.rollback()
        _log_finish(db, entry, "error", 0, str(e))
        log.exception("csv import failed")
        return {"status": "error", "message": str(e)}
    finally:
        if own:
            db.close()


def import_csv_folder(db: Session | None = None) -> dict:
    """Import every *.csv in the import dir, then move processed files to archive/."""
    own = db is None
    db = db or SessionLocal()
    import_dir = Path(settings.hevy_import_dir)
    archive = import_dir / "archive"
    archive.mkdir(parents=True, exist_ok=True)
    total, files = 0, []
    try:
        for csv_path in sorted(import_dir.glob("*.csv")):
            res = import_csv_file(str(csv_path), db=db)
            total += res.get("workouts", 0)
            files.append(csv_path.name)
            stamped = archive / f"{datetime.utcnow():%Y%m%d-%H%M%S}-{csv_path.name}"
            csv_path.rename(stamped)
        return {"status": "ok", "workouts": total, "files": files}
    finally:
        if own:
            db.close()


def sync_hevy(db: Session | None = None) -> dict:
    """Dispatch on HEVY_MODE: csv (folder import) | unofficial (auto API) | pro (paid API)."""
    own = db is None
    db = db or SessionLocal()
    mode = settings.hevy_mode.lower()
    try:
        if mode == "csv":
            return import_csv_folder(db=db)

        entry = _log_start(db, f"hevy-{mode}")
        if mode == "unofficial":
            from ..integrations import hevy_free_client as hf
            workouts = hf.fetch_all_workouts()
        elif mode == "pro":
            workouts = [hc.normalize_workout(w) for w in hc.iter_workouts()]
        else:
            _log_finish(db, entry, "error", 0, f"unknown HEVY_MODE '{mode}'")
            return {"status": "error", "message": f"unknown HEVY_MODE '{mode}'"}

        n = _import_workouts(db, workouts)
        _log_finish(db, entry, "ok", n, f"{n} workouts via {mode}")
        return {"status": "ok", "workouts": n, "mode": mode}
    except Exception as e:
        db.rollback()
        log.exception("hevy sync failed")
        return {"status": "error", "message": str(e), "mode": mode}
    finally:
        if own:
            db.close()


def sync_all(days: int | None = None) -> dict:
    db = SessionLocal()
    try:
        g = sync_garmin(days, db=db)
        h = sync_hevy(db=db)
        return {"garmin": g, "hevy": h}
    finally:
        db.close()
