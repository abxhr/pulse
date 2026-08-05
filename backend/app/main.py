"""Pulse backend entry point.

Run (from backend/):   uvicorn app.main:app --reload --port 8000
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import init_db
from .api import router

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("pulse")

scheduler = None


def _clear_stale_syncs() -> None:
    """A sync_log row stuck in 'running' means the process died mid-sync (e.g. a
    restart during a long backfill) — mark it so it doesn't linger forever."""
    from datetime import datetime
    from sqlalchemy import select
    from .db import SessionLocal
    from .models import SyncLog
    db = SessionLocal()
    try:
        stale = db.execute(select(SyncLog).where(SyncLog.status == "running")).scalars().all()
        for s in stale:
            s.status = "interrupted"
            s.finished_at = datetime.utcnow()
            s.message = "Server restarted mid-sync."
        if stale:
            db.commit()
    finally:
        db.close()


def _generate_daily_insight() -> None:
    from .db import SessionLocal
    from .services import insights
    db = SessionLocal()
    try:
        insights.get_or_generate_daily(db)
        log.info("Daily insight generated")
    except Exception as e:
        log.warning("Daily insight generation failed (will retry on next Overview load): %s", e)
    finally:
        db.close()


def _run_backup() -> None:
    from .services import backup
    try:
        backup.run_backup()
    except Exception as e:
        log.warning("Database backup failed: %s", e)


def _run_push_checks() -> None:
    from .db import SessionLocal
    from .services import push
    db = SessionLocal()
    try:
        push.run_checks(db)
    except Exception as e:
        log.warning("Push notification check failed: %s", e)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _clear_stale_syncs()
    global scheduler
    if settings.enable_scheduler:
        from apscheduler.schedulers.background import BackgroundScheduler
        from .services import sync
        scheduler = BackgroundScheduler()
        scheduler.add_job(
            lambda: sync.sync_all(days=settings.quick_sync_days),
            "interval", minutes=settings.sync_interval_minutes, id="pulse_sync",
        )
        scheduler.add_job(_generate_daily_insight, "cron", hour=6, minute=0, id="pulse_daily_insight")
        scheduler.add_job(_run_push_checks, "interval", minutes=15, id="pulse_push_checks")
        scheduler.add_job(_run_backup, "cron", hour=3, minute=30, id="pulse_backup")
        scheduler.start()
        log.info("Scheduler started: quick sync (%sd) every %smin, daily insight at 06:00",
                  settings.quick_sync_days, settings.sync_interval_minutes)
    yield
    if scheduler:
        scheduler.shutdown()


app = FastAPI(title="Pulse", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/api/health")
def healthcheck():
    return {"ok": True, "service": "pulse"}


class _NoCacheHTMLStaticFiles(StaticFiles):
    """StaticFiles that never lets the browser cache index.html without revalidating.

    Vite's hashed /assets/*.js files are safe to cache forever (a new build gets a
    new filename), but index.html references those hashes by name. With no
    Cache-Control header at all, browsers apply heuristic caching to index.html and
    can silently keep serving a stale document (with old asset hashes that 404 after
    a new build) for a long time with zero revalidation — this is what caused the
    old bundle to keep loading in fresh tabs even after the SW fix and a restart.
    """

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if path in ("", "index.html") or response.headers.get("content-type", "").startswith("text/html"):
            response.headers["Cache-Control"] = "no-cache"
        else:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


# Serve the built frontend if present (frontend/dist). This gives you a SINGLE
# process / single URL — ideal for a Raspberry Pi. During dev you can instead run
# Vite separately on :5173. Build it with:  cd frontend && npm run build
_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if settings.serve_frontend and _dist.exists():
    app.mount("/", _NoCacheHTMLStaticFiles(directory=str(_dist), html=True), name="static")
    log.info("Serving frontend from %s", _dist)


def run():
    """Convenience runner: `python -m app.main`. Binds to settings.host/port so
    the app is reachable from your phone at http://<pi-ip>:%s on your LAN."""
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)


if __name__ == "__main__":
    run()
