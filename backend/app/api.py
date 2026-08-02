"""All HTTP endpoints, mounted under /api."""
from __future__ import annotations
from pathlib import Path

import base64

from fastapi import APIRouter, Depends, BackgroundTasks, Body, HTTPException, UploadFile, File, Form
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from datetime import date

from .db import get_session
from .config import settings
from .models import Workout, Activity, DailyHealth, Sleep, SyncLog, Insight
from .services import analytics, insights, reports, sync, nutrition

router = APIRouter(prefix="/api")


# ---------- status / connectivity ----------
@router.get("/status")
def status(db: Session = Depends(get_session)):
    counts = {
        "daily_health": db.scalar(select(func.count()).select_from(DailyHealth)),
        "sleep": db.scalar(select(func.count()).select_from(Sleep)),
        "activities": db.scalar(select(func.count()).select_from(Activity)),
        "workouts": db.scalar(select(func.count()).select_from(Workout)),
    }
    _token_dir = Path(settings.garmin_token_store)
    garmin_ready = _token_dir.exists() and any(
        f.stat().st_size > 0 for f in _token_dir.glob("*.json")
    )
    ai_providers = insights.available_providers()
    mode = settings.hevy_mode.lower()
    if mode == "pro":
        hevy_ready = bool(settings.hevy_api_key)
    elif mode == "unofficial":
        hevy_ready = bool(settings.hevy_access_token and settings.hevy_refresh_token)
    else:  # csv
        hevy_ready = counts["workouts"] > 0 or any(Path(settings.hevy_import_dir).glob("*.csv"))
    logs = db.execute(select(SyncLog).order_by(SyncLog.started_at.desc()).limit(6)).scalars().all()
    return {
        "connections": {
            "garmin": garmin_ready,
            "hevy": {"mode": mode, "configured": hevy_ready},
            "ai": {"provider": settings.ai_provider, **ai_providers},
        },
        "counts": counts,
        "recent_syncs": [{
            "source": l.source, "status": l.status, "records": l.records,
            "started_at": l.started_at.isoformat(),
            "finished_at": l.finished_at.isoformat() if l.finished_at else None,
            "message": l.message,
        } for l in logs],
    }


# ---------- dashboard ----------
@router.get("/dashboard")
def dashboard(db: Session = Depends(get_session)):
    return {
        "snapshot": analytics.snapshot(db),
        "health_trend": analytics.health_trend(db, 30),
        "sleep_trend": analytics.sleep_trend(db, 30),
        "activities": analytics.recent_activities(db, 8),
        "training_load": analytics.training_load(db, 12),
        "strength": analytics.strength_summary(db, 8),
    }


@router.get("/health/trend")
def health_trend(days: int = 30, db: Session = Depends(get_session)):
    return analytics.health_trend(db, days)


@router.get("/sleep/trend")
def sleep_trend(days: int = 30, db: Session = Depends(get_session)):
    return analytics.sleep_trend(db, days)


@router.get("/activities")
def activities(limit: int = 20, db: Session = Depends(get_session)):
    return analytics.recent_activities(db, limit)


@router.get("/workouts")
def workouts(limit: int = 20, db: Session = Depends(get_session)):
    rows = db.execute(
        select(Workout).order_by(Workout.date.desc()).limit(limit)
    ).scalars().all()
    return [{
        "id": w.id, "date": w.date.isoformat() if w.date else None, "title": w.title,
        "duration_min": round((w.duration_s or 0) / 60, 0), "volume_kg": w.volume_kg,
        "set_count": w.set_count, "exercise_count": w.exercise_count,
        "exercises": w.exercises,
    } for w in rows]


@router.get("/activities/{activity_id}")
def activity_detail(activity_id: str, db: Session = Depends(get_session)):
    a = db.get(Activity, activity_id)
    if not a:
        raise HTTPException(status_code=404, detail="activity not found")
    raw = a.raw or {}
    zones = {
        f"zone_{i}_min": round((raw.get(f"hrTimeInZone_{i}") or 0) / 60, 1) for i in range(1, 6)
    }
    return {
        "id": a.id, "date": a.date.isoformat() if a.date else None,
        "start_time": a.start_time.isoformat() if a.start_time else None,
        "type": a.activity_type, "name": a.name,
        "distance_km": round((a.distance_m or 0) / 1000, 2),
        "duration_min": round((a.duration_s or 0) / 60, 1),
        "moving_duration_min": round((a.moving_duration_s or 0) / 60, 1) if a.moving_duration_s else None,
        "avg_hr": a.avg_hr, "max_hr": a.max_hr,
        "pace_per_km": a.avg_pace_s_per_km, "avg_speed_mps": a.avg_speed_mps,
        "calories": a.calories, "elevation_gain_m": a.elevation_gain_m,
        "avg_cadence": a.avg_cadence, "aerobic_te": a.aerobic_te, "anaerobic_te": a.anaerobic_te,
        "vo2max": a.vo2max, "source": a.source,
        "training_effect_label": raw.get("trainingEffectLabel"),
        "aerobic_te_message": raw.get("aerobicTrainingEffectMessage"),
        "anaerobic_te_message": raw.get("anaerobicTrainingEffectMessage"),
        "lap_count": raw.get("lapCount"),
        "is_pr": raw.get("pr"),
        "min_temperature": raw.get("minTemperature"),
        "max_temperature": raw.get("maxTemperature"),
        "moderate_intensity_min": raw.get("moderateIntensityMinutes"),
        "vigorous_intensity_min": raw.get("vigorousIntensityMinutes"),
        "hr_zones_min": zones,
        "splits": raw.get("splitSummaries") or [],
    }


@router.get("/workouts/{workout_id}")
def workout_detail(workout_id: str, db: Session = Depends(get_session)):
    w = db.get(Workout, workout_id)
    if not w:
        raise HTTPException(status_code=404, detail="workout not found")
    return {
        "id": w.id, "date": w.date.isoformat() if w.date else None,
        "start_time": w.start_time.isoformat() if w.start_time else None,
        "end_time": w.end_time.isoformat() if w.end_time else None,
        "title": w.title, "description": w.description,
        "duration_min": round((w.duration_s or 0) / 60, 0), "volume_kg": w.volume_kg,
        "set_count": w.set_count, "exercise_count": w.exercise_count,
        "exercises": w.exercises, "source": w.source,
    }


@router.get("/strength")
def strength(weeks: int = 8, db: Session = Depends(get_session)):
    return analytics.strength_summary(db, weeks)


@router.get("/strength/this-week")
def strength_this_week(db: Session = Depends(get_session)):
    return analytics.strength_this_week(db)


@router.get("/training-load")
def training_load(weeks: int = 12, db: Session = Depends(get_session)):
    return analytics.training_load(db, weeks)


# ---------- sync (runs in background; poll /status) ----------
@router.post("/sync/garmin")
def sync_garmin(background: BackgroundTasks, days: int | None = None):
    background.add_task(sync.sync_garmin, days)
    return {"started": "garmin", "days": days or settings.default_backfill_days}


@router.post("/sync/hevy")
def sync_hevy(background: BackgroundTasks):
    background.add_task(sync.sync_hevy)
    return {"started": "hevy", "mode": settings.hevy_mode}


@router.post("/sync/hevy/upload")
async def upload_hevy_csv(file: UploadFile = File(...), db: Session = Depends(get_session)):
    """Upload a Hevy CSV export directly (handy from your phone). Imports immediately."""
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv export from Hevy.")
    dest = Path(settings.hevy_import_dir) / file.filename
    dest.write_bytes(await file.read())
    result = sync.import_csv_file(str(dest), db=db)
    archive = Path(settings.hevy_import_dir) / "archive"
    archive.mkdir(parents=True, exist_ok=True)
    dest.rename(archive / dest.name)
    return result


@router.post("/sync/all")
def sync_all(background: BackgroundTasks, days: int | None = None):
    background.add_task(sync.sync_all, days)
    return {"started": "all", "days": days or settings.default_backfill_days}


# ---------- AI insights ----------
@router.post("/insights")
def create_insight(payload: dict = Body(default={}), db: Session = Depends(get_session)):
    question = payload.get("question")
    history = payload.get("history")
    scope = payload.get("scope", "chat")
    provider = payload.get("provider")
    try:
        return insights.generate_insight(db, question=question, scope=scope, history=history, provider=provider)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI call failed: {e}")


@router.get("/insights/history")
def insight_history(limit: int = 40, db: Session = Depends(get_session)):
    rows = db.execute(
        select(Insight).order_by(Insight.created_at.desc()).limit(limit)
    ).scalars().all()
    return [{
        "id": r.id, "role": r.role, "scope": r.scope, "provider": r.provider,
        "model": r.model, "content": r.content, "created_at": r.created_at.isoformat(),
    } for r in reversed(rows)]


# ---------- nutrition ----------
@router.get("/nutrition/today")
def nutrition_today(db: Session = Depends(get_session)):
    return nutrition.day_summary(db, date.today())


@router.get("/nutrition/day")
def nutrition_day(d: str, db: Session = Depends(get_session)):
    try:
        day = date.fromisoformat(d)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    return nutrition.day_summary(db, day)


@router.get("/nutrition/trend")
def nutrition_trend(days: int = 14, db: Session = Depends(get_session)):
    return nutrition.trend(db, days)


@router.post("/nutrition/meals")
def create_meal(payload: dict = Body(...), db: Session = Depends(get_session)):
    if not payload.get("name"):
        raise HTTPException(status_code=400, detail="name is required")
    return nutrition.add_meal(db, payload)


@router.delete("/nutrition/meals/{meal_id}")
def remove_meal(meal_id: int, db: Session = Depends(get_session)):
    if not nutrition.delete_meal(db, meal_id):
        raise HTTPException(status_code=404, detail="meal not found")
    return {"deleted": meal_id}


@router.post("/nutrition/analyze")
async def analyze_meal(
    notes: str | None = Form(default=None),
    image: UploadFile | None = File(default=None),
    provider: str | None = Form(default=None),
):
    """AI-estimate macros from a meal photo and/or free-text description
    (e.g. weighed ingredients). Returns an estimate to prefill the add-meal form —
    nothing is saved here; the user still confirms via POST /nutrition/meals."""
    image_b64 = media_type = None
    if image is not None and image.filename:
        raw = await image.read()
        if len(raw) > 8 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Image too large (max 8MB).")
        image_b64 = base64.b64encode(raw).decode()
        media_type = image.content_type or "image/jpeg"
    try:
        return insights.analyze_meal(image_b64, media_type, notes, provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {e}")


@router.get("/nutrition/goal")
def get_nutrition_goal(db: Session = Depends(get_session)):
    return nutrition.get_goal(db)


@router.put("/nutrition/goal")
def put_nutrition_goal(payload: dict = Body(...), db: Session = Depends(get_session)):
    return nutrition.set_goal(db, payload)


# ---------- reports ----------
@router.post("/reports/weekly")
def weekly_report(weeks: int = 1, with_ai: bool = True, db: Session = Depends(get_session)):
    return reports.weekly_report(db, weeks=weeks, with_ai=with_ai)
