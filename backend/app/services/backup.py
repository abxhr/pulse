"""Nightly SQLite backup with rotation — this file is the only copy of years
of health data, so it gets automated insurance rather than relying on the
user to remember."""
from __future__ import annotations
from datetime import datetime
from pathlib import Path
import logging
import sqlite3

from ..config import settings, DATA_DIR

log = logging.getLogger("pulse.backup")

BACKUP_DIR = DATA_DIR / "backups"
KEEP_DAILY = 14  # two weeks of nightly snapshots is enough to recover from any single bad day


def _db_path() -> Path | None:
    url = settings.database_url
    if not url.startswith("sqlite:///"):
        return None  # not SQLite (e.g. postgres) — nothing to back up this way
    return Path(url.removeprefix("sqlite:///"))


def run_backup() -> Path | None:
    src_path = _db_path()
    if not src_path or not src_path.exists():
        return None
    BACKUP_DIR.mkdir(exist_ok=True)
    dest_path = BACKUP_DIR / f"pulse-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"

    # sqlite3's own backup API instead of a raw file copy — safe to run while
    # the app is live (won't grab a half-written page mid-transaction).
    src = sqlite3.connect(str(src_path))
    dest = sqlite3.connect(str(dest_path))
    try:
        src.backup(dest)
    finally:
        dest.close()
        src.close()

    _rotate()
    log.info("Backed up database to %s", dest_path)
    return dest_path


def _rotate() -> None:
    backups = sorted(BACKUP_DIR.glob("pulse-*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in backups[KEEP_DAILY:]:
        old.unlink()


def list_backups() -> list[dict]:
    if not BACKUP_DIR.exists():
        return []
    backups = sorted(BACKUP_DIR.glob("pulse-*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [
        {"name": p.name, "size_mb": round(p.stat().st_size / 1024 / 1024, 2),
         "created_at": datetime.fromtimestamp(p.stat().st_mtime).isoformat()}
        for p in backups
    ]
