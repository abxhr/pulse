"""All HTTP endpoints, mounted under /api."""
from __future__ import annotations
from pathlib import Path

import base64
import os
import sys
import time

import requests

from fastapi import APIRouter, Depends, BackgroundTasks, Body, HTTPException, UploadFile, File, Form
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from datetime import date

from .db import get_session
from .config import settings
from .models import Workout, Activity, DailyHealth, Sleep, SyncLog, Insight
from .services import analytics, insights, reports, sync, nutrition, weight as weight_svc, recipes, weather as weather_svc, cardio_extras
from .integrations import garmin_client as gc

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
        hevy_ready = bool(settings.hevy_access_token and settings.hevy_refresh_token) or (
            bool(settings.hevy_email) and Path(settings.hevy_token_store).exists()
        )
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


@router.get("/dashboard/extra")
def dashboard_extra(db: Session = Depends(get_session)):
    """Secondary Overview widgets that are a bit heavier to compute — split out
    of /dashboard so the main hero panel stays fast."""
    return {
        "sleep_debt": analytics.sleep_debt(db, target_hours=settings.sleep_target_hours),
        "anomalies": analytics.anomaly_alerts(db),
        "what_changed": analytics.what_changed(db),
        "training_load_ratio": analytics.training_load_ratio(db),
        "weather": weather_svc.current_weather(),
    }


@router.get("/health/trend")
def health_trend(days: int = 30, db: Session = Depends(get_session)):
    return analytics.health_trend(db, days)


@router.get("/health/intraday")
def health_intraday(d: str | None = None):
    """Hourly stress + body battery for a single day — fetched live from Garmin
    on demand (not stored in bulk; intraday resolution would bloat the DB)."""
    day = date.fromisoformat(d) if d else date.today()
    try:
        client = gc.make_client()
    except gc.GarminUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e))
    result = gc.fetch_intraday_stress(client, day)
    if not result:
        raise HTTPException(status_code=404, detail="no intraday data for this date")
    return result


@router.get("/health/current")
def health_current():
    """Live current stress + body battery reading — bypasses the DB entirely,
    always a fresh call to Garmin, since these change throughout the day and the
    stored daily row only has the day's average/peak stats."""
    try:
        client = gc.make_client()
    except gc.GarminUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e))
    return gc.fetch_current_reading(client)


@router.get("/sleep/trend")
def sleep_trend(days: int = 30, db: Session = Depends(get_session)):
    return analytics.sleep_trend(db, days)


@router.get("/sleep/consistency")
def sleep_consistency(days: int = 30, db: Session = Depends(get_session)):
    return analytics.sleep_consistency(db, days)


@router.get("/sleep/extra")
def sleep_extra(db: Session = Depends(get_session)):
    return {
        "chronotype": analytics.chronotype(db),
        "correlation": analytics.sleep_performance_correlation(db),
        "bedtime_recommendation": analytics.bedtime_recommendation(db, target_hours=settings.sleep_target_hours),
        "why_last_night_bad": analytics.why_last_night_bad(db),
    }


@router.get("/activities")
def activities(limit: int = 20, db: Session = Depends(get_session)):
    return analytics.recent_activities(db, limit)


@router.get("/activities/hr-zones")
def activities_hr_zones(days: int = 30, db: Session = Depends(get_session)):
    return analytics.hr_zone_summary(db, days)


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
    gap_pace = None
    if a.avg_pace_s_per_km and a.distance_m:
        grade = ((a.elevation_gain_m or 0) - (raw.get("elevationLoss") or 0)) / a.distance_m
        cost, flat = gc._minetti_cost(grade), gc._minetti_cost(0)
        gap_pace = round(a.avg_pace_s_per_km * cost / flat) if cost > 0 else None
    return {
        "id": a.id, "date": a.date.isoformat() if a.date else None,
        "start_time": a.start_time.isoformat() if a.start_time else None,
        "type": a.activity_type, "name": a.name,
        "distance_km": round((a.distance_m or 0) / 1000, 2),
        "duration_min": round((a.duration_s or 0) / 60, 1),
        "moving_duration_min": round((a.moving_duration_s or 0) / 60, 1) if a.moving_duration_s else None,
        "avg_hr": a.avg_hr, "max_hr": a.max_hr,
        "pace_per_km": a.avg_pace_s_per_km, "gap_pace_per_km": gap_pace, "avg_speed_mps": a.avg_speed_mps,
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
        "has_route": bool(raw.get("hasPolyline")),
        "shoe_id": a.shoe_id,
        "weather": weather_svc.historical_weather(a.date) if a.date and "run" in (a.activity_type or "") else None,
    }


@router.get("/activities/{activity_id}/route")
def activity_route(activity_id: str, db: Session = Depends(get_session)):
    a = db.get(Activity, activity_id)
    if not a:
        raise HTTPException(status_code=404, detail="activity not found")
    try:
        client = gc.make_client()
    except gc.GarminUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e))
    points = gc.fetch_route(client, activity_id)
    if not points:
        raise HTTPException(status_code=404, detail="no route data for this activity")
    return {"points": points}


@router.get("/activities/{activity_id}/splits")
def activity_splits_route(activity_id: str, db: Session = Depends(get_session)):
    a = db.get(Activity, activity_id)
    if not a:
        raise HTTPException(status_code=404, detail="activity not found")
    try:
        client = gc.make_client()
    except gc.GarminUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e))
    splits = gc.fetch_splits(client, activity_id)
    if not splits:
        raise HTTPException(status_code=404, detail="no split data for this activity")
    return {"splits": splits}


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


@router.post("/workouts/{workout_id}/push-to-garmin")
def push_workout_to_garmin(workout_id: str, db: Session = Depends(get_session)):
    """Upload this workout to Garmin Connect as a structured strength workout and
    push it to your watch. Exercise matching against Garmin's catalog is best-effort —
    the response reports which exercises matched exactly vs. fell back to a broad
    category guess, so sets/reps/weight are always preserved either way."""
    w = db.get(Workout, workout_id)
    if not w:
        raise HTTPException(status_code=404, detail="workout not found")
    if not w.exercises:
        raise HTTPException(status_code=400, detail="this workout has no exercise data")
    try:
        client = gc.make_client()
    except gc.GarminUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e))
    from .integrations import garmin_workout as gw
    try:
        return gw.push_workout(client, w.title or "Pulse Workout", w.exercises)
    except Exception as e:
        log_msg = f"Failed to push workout to Garmin: {e}"
        raise HTTPException(status_code=502, detail=log_msg)


@router.get("/strength")
def strength(weeks: int = 8, db: Session = Depends(get_session)):
    return analytics.strength_summary(db, weeks)


@router.get("/strength/this-week")
def strength_this_week(db: Session = Depends(get_session)):
    return analytics.strength_this_week(db)


@router.get("/training-load")
def training_load(weeks: int = 12, db: Session = Depends(get_session)):
    return analytics.training_load(db, weeks)


@router.get("/training/race-predictions")
def race_predictions(db: Session = Depends(get_session)):
    return analytics.race_predictions(db) or {}


@router.get("/training/race-goal")
def get_race_goal(db: Session = Depends(get_session)):
    return cardio_extras.taper_plan(db) or {}


@router.post("/training/race-goal")
def post_race_goal(body: dict = Body(...), db: Session = Depends(get_session)):
    return cardio_extras.set_race_goal(
        db, body["name"], date.fromisoformat(body["race_date"]), body["distance_type"],
        body.get("target_time_s"),
    )


@router.delete("/training/race-goal")
def delete_race_goal(db: Session = Depends(get_session)):
    cardio_extras.clear_race_goal(db)
    return {"ok": True}


@router.get("/training/overload-warnings")
def overload_warnings(weeks: int = 8, db: Session = Depends(get_session)):
    return cardio_extras.overload_warnings(db, weeks)


@router.get("/training/repeat-routes")
def repeat_routes(db: Session = Depends(get_session)):
    return cardio_extras.repeat_routes(db)


@router.get("/shoes")
def list_shoes(db: Session = Depends(get_session)):
    return cardio_extras.list_shoes(db)


@router.post("/shoes")
def add_shoe(body: dict = Body(...), db: Session = Depends(get_session)):
    return cardio_extras.add_shoe(
        db, body["name"], date.fromisoformat(body.get("start_date") or date.today().isoformat()),
        float(body.get("target_km") or 700),
    )


@router.post("/shoes/{shoe_id}/retire")
def retire_shoe(shoe_id: int, db: Session = Depends(get_session)):
    if not cardio_extras.retire_shoe(db, shoe_id):
        raise HTTPException(status_code=404, detail="shoe not found")
    return {"ok": True}


@router.post("/activities/{activity_id}/shoe")
def assign_shoe(activity_id: str, body: dict = Body(...), db: Session = Depends(get_session)):
    if not cardio_extras.assign_shoe(db, activity_id, body.get("shoe_id")):
        raise HTTPException(status_code=404, detail="activity not found")
    return {"ok": True}


# ---------- system ----------
def _restart_process():
    time.sleep(0.4)  # give uvicorn a moment to flush the response
    os.execv(sys.executable, [sys.executable, "-m", "app.main"])


@router.post("/system/restart")
def restart_server(background: BackgroundTasks):
    """Re-exec the server process in place — picks up a fresh .env, clears any
    stuck-in-memory state, without needing to touch the machine."""
    background.add_task(_restart_process)
    return {"status": "restarting"}


# ---------- sync (runs in background; poll /status) ----------
# The plain endpoints default to a fast "quick sync" (last quick_sync_days) so the
# Sync button and the 30-min scheduler stay quick. Pass ?full=true for a deep
# backfill over the full default_backfill_days window (slow — years of history).
@router.post("/sync/garmin")
def sync_garmin(background: BackgroundTasks, days: int | None = None, full: bool = False):
    n = days or (settings.default_backfill_days if full else settings.quick_sync_days)
    background.add_task(sync.sync_garmin, n)
    return {"started": "garmin", "days": n}


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
def sync_all(background: BackgroundTasks, days: int | None = None, full: bool = False):
    n = days or (settings.default_backfill_days if full else settings.quick_sync_days)
    background.add_task(sync.sync_all, n)
    return {"started": "all", "days": n}


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


@router.get("/insights/daily")
def daily_insight(db: Session = Depends(get_session)):
    """Cached once-a-day briefing for the Overview page — generated automatically
    if today's doesn't exist yet, otherwise returns the cached one instantly."""
    try:
        return insights.get_or_generate_daily(db)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI call failed: {e}")


@router.post("/insights/daily/refresh")
def refresh_daily_insight(db: Session = Depends(get_session)):
    try:
        return insights.get_or_generate_daily(db, force=True)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI call failed: {e}")


@router.get("/insights/weekly")
def weekly_digest(db: Session = Depends(get_session)):
    """Cached once-a-week proactive digest — a standing check-in rather than
    only ever responding to on-demand chat questions."""
    try:
        return insights.get_or_generate_weekly(db)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI call failed: {e}")


@router.post("/insights/weekly/refresh")
def refresh_weekly_digest(db: Session = Depends(get_session)):
    try:
        return insights.get_or_generate_weekly(db, force=True)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI call failed: {e}")


@router.get("/insights/memory")
def get_coach_memory(db: Session = Depends(get_session)):
    return {"notes": insights.get_memory(db)}


@router.put("/insights/memory")
def put_coach_memory(body: dict = Body(...), db: Session = Depends(get_session)):
    return {"notes": insights.set_memory(db, body.get("notes") or "")}


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


@router.get("/nutrition/favorites")
def nutrition_favorites(db: Session = Depends(get_session)):
    return nutrition.favorite_meals(db)


@router.get("/nutrition/streak")
def nutrition_streak(db: Session = Depends(get_session)):
    return nutrition.days_on_target_streak(db)


@router.get("/nutrition/protein-timing")
def nutrition_protein_timing(d: str | None = None, db: Session = Depends(get_session)):
    day = date.fromisoformat(d) if d else date.today()
    return nutrition.protein_timing(db, day)


@router.get("/nutrition/hydration")
def nutrition_hydration(d: str | None = None):
    day = date.fromisoformat(d) if d else date.today()
    try:
        client = gc.make_client()
    except gc.GarminUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e))
    data = gc.fetch_hydration(client, day)
    if not data:
        raise HTTPException(status_code=404, detail="no hydration data for this date")
    return data


@router.get("/nutrition/barcode/{upc}")
def nutrition_barcode(upc: str):
    """Look up packaged-food macros by barcode via Open Food Facts (free, no key)."""
    try:
        res = requests.get(f"https://world.openfoodfacts.org/api/v0/product/{upc}.json", timeout=6)
        res.raise_for_status()
        data = res.json()
    except Exception:
        raise HTTPException(status_code=502, detail="barcode lookup failed")
    if data.get("status") != 1:
        raise HTTPException(status_code=404, detail="product not found")
    p = data["product"]
    nutr = p.get("nutriments", {})
    return {
        "name": p.get("product_name") or p.get("generic_name") or "Unknown product",
        "brand": p.get("brands"),
        "serving_size": p.get("serving_size"),
        "calories": nutr.get("energy-kcal_serving") or nutr.get("energy-kcal_100g"),
        "protein_g": nutr.get("proteins_serving") or nutr.get("proteins_100g"),
        "carbs_g": nutr.get("carbohydrates_serving") or nutr.get("carbohydrates_100g"),
        "fat_g": nutr.get("fat_serving") or nutr.get("fat_100g"),
        "fiber_g": nutr.get("fiber_serving") or nutr.get("fiber_100g"),
        "per": "serving" if nutr.get("energy-kcal_serving") else "100g",
    }


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


# ---------- recipes ----------
@router.post("/recipes/extract")
async def extract_recipe(
    text: str | None = Form(default=None),
    url: str | None = Form(default=None),
    provider: str | None = Form(default=None),
    images: list[UploadFile] = File(default=[]),
):
    """Extract a structured recipe + per-serving macros from screenshots, a
    YouTube/TikTok/Instagram URL, and/or pasted text. Returns the extraction for
    the user to review/edit — POST /recipes to actually save it."""
    source_type = "text"
    combined_text_parts = [text] if text else []

    if url:
        from .integrations import recipe_sources
        try:
            if "instagram.com" in url:
                source_type = "instagram"
                info = recipe_sources.fetch_instagram_content(url)
                if info.get("title"):
                    combined_text_parts.append(f"Post title: {info['title']}")
                combined_text_parts.append(f"Caption: {info['caption']}")
            elif "tiktok.com" in url:
                source_type = "tiktok"
                info = recipe_sources.fetch_tiktok_content(url)
                combined_text_parts.append(f"TikTok caption: {info['title']}")
            else:
                source_type = "youtube"
                info = recipe_sources.fetch_youtube_content(url)
                if info.get("title"):
                    combined_text_parts.append(f"Video title: {info['title']}")
                if info.get("description"):
                    combined_text_parts.append(f"Description: {info['description']}")
                if info.get("transcript"):
                    combined_text_parts.append(f"Transcript: {info['transcript'][:6000]}")
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

    images_b64: list[tuple[str, str]] = []
    for img in images:
        if not img.filename:
            continue
        raw = await img.read()
        if len(raw) > 8 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"{img.filename} is too large (max 8MB).")
        images_b64.append((base64.b64encode(raw).decode(), img.content_type or "image/jpeg"))
        if source_type == "text":
            source_type = "screenshot"

    combined_text = "\n\n".join(combined_text_parts)
    try:
        result = insights.analyze_recipe(images_b64, combined_text, provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI extraction failed: {e}")
    result["source_type"] = source_type
    result["source_url"] = url
    return result


@router.get("/recipes")
def list_recipes(db: Session = Depends(get_session)):
    return recipes.list_recipes(db)


@router.post("/recipes")
def create_recipe(payload: dict = Body(...), db: Session = Depends(get_session)):
    if not payload.get("name"):
        raise HTTPException(status_code=400, detail="name is required")
    return recipes.save_recipe(db, payload)


@router.delete("/recipes/{recipe_id}")
def remove_recipe(recipe_id: int, db: Session = Depends(get_session)):
    if not recipes.delete_recipe(db, recipe_id):
        raise HTTPException(status_code=404, detail="recipe not found")
    return {"deleted": recipe_id}


@router.post("/recipes/{recipe_id}/log-as-meal")
def log_recipe(recipe_id: int, payload: dict = Body(default={}), db: Session = Depends(get_session)):
    result = recipes.log_recipe_as_meal(
        db, recipe_id, payload.get("servings_eaten", 1), payload.get("meal_type"),
    )
    if not result:
        raise HTTPException(status_code=404, detail="recipe not found")
    return result


@router.get("/nutrition/goal")
def get_nutrition_goal(db: Session = Depends(get_session)):
    return nutrition.get_goal(db)


@router.put("/nutrition/goal")
def put_nutrition_goal(payload: dict = Body(...), db: Session = Depends(get_session)):
    return nutrition.set_goal(db, payload)


@router.put("/nutrition/meals/{meal_id}")
def update_meal(meal_id: int, payload: dict = Body(...), db: Session = Depends(get_session)):
    if not nutrition.update_meal(db, meal_id, payload):
        raise HTTPException(status_code=404, detail="meal not found")
    return {"updated": meal_id}


# ---------- weight / cut ----------
@router.get("/weight/trend")
def weight_trend(days: int = 90, db: Session = Depends(get_session)):
    return weight_svc.trend(db, days)


@router.post("/weight")
def log_weight(payload: dict = Body(...), db: Session = Depends(get_session)):
    if payload.get("weight_kg") is None:
        raise HTTPException(status_code=400, detail="weight_kg is required")
    d = date.fromisoformat(payload["date"]) if payload.get("date") else date.today()
    return weight_svc.add_weight(db, d, payload["weight_kg"], payload.get("body_fat_pct"), payload.get("notes"))


@router.delete("/weight/{d}")
def delete_weight(d: str, db: Session = Depends(get_session)):
    if not weight_svc.delete_weight(db, date.fromisoformat(d)):
        raise HTTPException(status_code=404, detail="no weigh-in for that date")
    return {"deleted": d}


@router.get("/weight/goal")
def get_cut_goal(db: Session = Depends(get_session)):
    return weight_svc.get_goal(db)


@router.put("/weight/goal")
def put_cut_goal(payload: dict = Body(...), db: Session = Depends(get_session)):
    return weight_svc.set_goal(db, payload)


@router.get("/weight/recommendation")
def macro_recommendation(db: Session = Depends(get_session)):
    return weight_svc.macro_recommendation(db)


# ---------- reports ----------
@router.post("/reports/weekly")
def weekly_report(weeks: int = 1, with_ai: bool = True, db: Session = Depends(get_session)):
    return reports.weekly_report(db, weeks=weeks, with_ai=with_ai)


@router.get("/reports/scheduled")
def scheduled_report(db: Session = Depends(get_session)):
    """Auto-generated weekly report, cached once per ISO week."""
    try:
        return reports.get_or_generate_scheduled(db)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"report generation failed: {e}")


@router.post("/reports/scheduled/refresh")
def refresh_scheduled_report(db: Session = Depends(get_session)):
    try:
        return reports.get_or_generate_scheduled(db, force=True)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"report generation failed: {e}")


@router.get("/reports/comparison")
def comparison_report(weeks: int = 4, db: Session = Depends(get_session)):
    return reports.comparison_report(db, weeks)
