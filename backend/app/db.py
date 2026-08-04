"""SQLAlchemy engine + session helpers (SQLite, local file)."""
import logging

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import declarative_base, sessionmaker, Session

from .config import settings

log = logging.getLogger("pulse.db")

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


_PENDING_COLUMNS = {
    "daily_health": {"fitness_age": "REAL", "chronological_age": "INTEGER"},
    "sleep": {
        "start_time": "DATETIME", "end_time": "DATETIME", "avg_hr": "INTEGER",
        "awake_count": "INTEGER", "score_feedback": "VARCHAR(64)", "nap_seconds": "INTEGER",
    },
    "activity": {"shoe_id": "INTEGER"},
}


def _migrate_missing_columns() -> None:
    """No migration framework here — SQLite, single user, small schema. `create_all`
    only creates whole missing tables, so newly-added model columns need an explicit
    ALTER TABLE on an existing DB. Defensive: only adds columns that are actually
    missing, safe to run on every startup."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, wanted in _PENDING_COLUMNS.items():
            if not inspector.has_table(table):
                continue  # fresh DB — create_all just built it with every column already
            existing = {c["name"] for c in inspector.get_columns(table)}
            for col, sql_type in wanted.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {sql_type}"))
                    log.info("migrated: added %s.%s", table, col)


def init_db() -> None:
    from . import models  # noqa: F401  (ensure tables are registered)
    Base.metadata.create_all(bind=engine)
    _migrate_missing_columns()


def get_session() -> Session:
    """FastAPI dependency."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
