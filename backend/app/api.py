"""All HTTP endpoints, mounted under /api."""
from __future__ import annotations
from pathlib import Path

import base64
import json
import os
import sys
import time

import requests

from fastapi import APIRouter, Depends, BackgroundTasks, Body, HTTPException, UploadFile, File, Form, Request, Query
from fastapi.responses import Response
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from datetime import date, datetime

from .db import get_session
from .config import settings, DATA_DIR
from .models import Workout, Activity, DailyHealth, Sleep, SyncLog, Insight, IntradayHealth
from .services import analytics, insights, reports, sync, nutrition, weight as weight_svc, recipes, weather as weather_svc, cardio_extras, export as export_svc, push as push_svc, backup as backup_svc, auth as auth_svc, phase2, planner, lab, performance as performance_svc
from .integrations import garmin_client as gc
from .schemas import PasswordBody, MealBody, WeightBody, ShoeBody, RecipeExtractUrl, RestoreBackupBody

router = APIRouter(prefix="/api")


def _direct_loopback(request: Request) -> bool:
    """Forwarded requests are never treated as physical access to this machine."""
    forwarded = any(request.headers.get(name) for name in ("forwarded", "x-forwarded-for", "x-forwarded-host"))
    return not forwarded and request.client is not None and request.client.host in {"127.0.0.1", "::1"}


# Same-origin map-tile proxy with a permanent local cache. Browsers (especially
# installed iOS PWAs) were intermittently unable to reach public tile hosts
# directly, leaving the route map as a grey canvas. The server fetches each
# fixed CARTO tile once and then serves it locally on every subsequent view.
@router.get("/map-tiles-v2/{z}/{x}/{y}.png")
def map_tile(z: int, x: int, y: int):
    if not (0 <= z <= 19 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        raise HTTPException(404, "invalid map tile")
    tile = DATA_DIR / "map_tiles_v2" / str(z) / str(x) / f"{y}.png"
    max_age = 7 * 86400
    if tile.exists() and time.time() - tile.stat().st_mtime < max_age:
        return Response(tile.read_bytes(), media_type="image/png", headers={"Cache-Control": f"public, max-age={max_age}"})
    try:
        url = f"https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        upstream = requests.get(url, timeout=12, headers={
            "User-Agent": "PulseHealthDashboard/0.9 (+https://github.com/abxhr/pulse)",
            "Referer": "https://abxhr-core.tail551b1d.ts.net/",
        })
        upstream.raise_for_status()
        content = upstream.content
        tile.parent.mkdir(parents=True, exist_ok=True)
        tile.write_bytes(content)
        return Response(content, media_type="image/png", headers={"Cache-Control": f"public, max-age={max_age}"})
    except requests.RequestException as exc:
        raise HTTPException(502, f"map tile unavailable: {exc}") from exc


# ---------- single-user authentication ----------
def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    forwarded = request.headers.get("x-forwarded-proto", "")
    secure = request.url.scheme == "https" or forwarded == "https"
    response.set_cookie("pulse_session", token, max_age=90 * 86400, httponly=True,
                        secure=secure, samesite="strict", path="/")


@router.get("/auth/status")
def auth_status(request: Request, db: Session = Depends(get_session)):
    is_configured = auth_svc.configured(db)
    return {"configured": is_configured,
            "authenticated": is_configured and auth_svc.valid_session(db, request.cookies.get("pulse_session")),
            "setup_allowed": _direct_loopback(request)}


@router.post("/auth/setup")
def auth_setup(request: Request, response: Response, payload: PasswordBody, db: Session = Depends(get_session)):
    if auth_svc.configured(db):
        raise HTTPException(409, "Pulse already has an owner password")
    if not _direct_loopback(request):
        raise HTTPException(403, "Initial setup is only allowed from this PC at http://localhost:8080")
    try:
        auth_svc.set_password(db, payload.password)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _set_session_cookie(response, request, auth_svc.create_session(db))
    return {"ok": True}


@router.post("/auth/login")
def auth_login(request: Request, response: Response, payload: PasswordBody, db: Session = Depends(get_session)):
    identity = request.client.host if request.client else "unknown"
    allowed, retry_after = auth_svc.login_allowed(identity, settings.login_attempts, settings.login_window_seconds)
    if not allowed:
        raise HTTPException(429, "Too many login attempts", headers={"Retry-After": str(retry_after)})
    if not auth_svc.verify_password(db, payload.password):
        auth_svc.record_login_failure(identity)
        raise HTTPException(401, "Incorrect password")
    auth_svc.clear_login_failures(identity)
    _set_session_cookie(response, request, auth_svc.create_session(db))
    return {"ok": True}


@router.post("/auth/reset")
def auth_reset(request: Request, response: Response, payload: PasswordBody, db: Session = Depends(get_session)):
    """Physical-PC recovery path: invalidates every phone/browser session."""
    if not _direct_loopback(request):
        raise HTTPException(403, "Password reset is only allowed from this PC at http://localhost:8080")
    try: auth_svc.set_password(db, payload.password)
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc
    _set_session_cookie(response, request, auth_svc.create_session(db))
    return {"ok": True}


@router.post("/auth/logout")
def auth_logout(request: Request, response: Response, db: Session = Depends(get_session)):
    auth_svc.revoke_session(db, request.cookies.get("pulse_session"))
    response.delete_cookie("pulse_session", path="/")
    return {"ok": True}


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
    latest_workout = db.scalar(select(func.max(Workout.date)))
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
        "version": settings.app_version,
        "connections": {
            "garmin": garmin_ready,
            "hevy": {"mode": mode, "configured": hevy_ready,
                     "automatic": mode in {"unofficial", "pro"},
                     "latest_workout": latest_workout.isoformat() if latest_workout else None,
                     "stale": latest_workout is None or (date.today() - latest_workout).days > 3},
            "ai": {"provider": settings.ai_provider, **ai_providers},
        },
        "counts": counts,
        "recent_syncs": [{
            "source": l.source, "status": l.status, "records": l.records,
            "started_at": l.started_at.isoformat(),
            "finished_at": l.finished_at.isoformat() if l.finished_at else None,
            "message": l.message,
        } for l in logs],
        "freshness": analytics.data_freshness(db),
    }


@router.get("/hevy/status")
def hevy_status(db: Session = Depends(get_session)):
    mode = settings.hevy_mode.lower()
    latest = db.scalar(select(func.max(Workout.date)))
    last_log = db.execute(select(SyncLog).where(SyncLog.source.ilike("hevy%")).order_by(SyncLog.started_at.desc()).limit(1)).scalar_one_or_none()
    age = (date.today() - latest).days if latest else None
    return {"mode": mode, "automatic": mode in {"unofficial", "pro"},
            "latest_workout": latest.isoformat() if latest else None, "age_days": age,
            "stale": age is None or age > 3,
            "last_sync": last_log.finished_at.isoformat() if last_log and last_log.finished_at else None,
            "last_status": last_log.status if last_log else None,
            "action": None if mode in {"unofficial", "pro"} else
                "CSV mode auto-imports files placed in backend/data/imports, but cannot download exports itself. Run python -m app.hevy_auth once and set HEVY_MODE=unofficial for hands-free sync."}


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
    """Secondary Overview widgets that are a bit heavier to compute - split out
    of /dashboard so the main hero panel stays fast."""
    return {
        "sleep_debt": analytics.sleep_debt(db, target_hours=analytics.personalized_sleep_target(db) or settings.sleep_target_hours),
        "anomalies": analytics.anomaly_alerts(db),
        "what_changed": analytics.what_changed(db),
        "training_load_ratio": analytics.training_load_ratio(db),
        "weather": weather_svc.current_weather(),
        "overtraining_risk": analytics.overtraining_risk(db),
        "adaptive_step_goal": analytics.adaptive_step_goal(db),
        "freshness": analytics.data_freshness(db),
    }


# ---------- Phase 2 command centre (deterministic; never spends AI credits) ----------
@router.get("/command-center")
def command_center(db: Session = Depends(get_session)):
    return phase2.command_center(db)


@router.get("/goals")
def owner_goals(db: Session = Depends(get_session)):
    return phase2.goals(db)


@router.put("/goals")
def update_owner_goals(payload: list[dict] = Body(...), db: Session = Depends(get_session)):
    return phase2.set_goals(db, payload)


@router.get("/check-ins/today")
def checkins_today(db: Session = Depends(get_session)):
    return phase2.today_checkins(db)


@router.post("/check-ins")
def add_checkin(payload: dict = Body(...), db: Session = Depends(get_session)):
    try: return phase2.save_checkin(db, payload)
    except (ValueError, TypeError) as exc: raise HTTPException(400, str(exc)) from exc


@router.get("/anomalies")
def anomaly_inbox(db: Session = Depends(get_session)):
    return phase2.anomaly_inbox(db)


@router.put("/anomalies/{fingerprint}")
def update_anomaly(fingerprint: str, payload: dict = Body(...), db: Session = Depends(get_session)):
    try: return phase2.set_anomaly(db, fingerprint, payload.get("status", "acknowledged"))
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc


@router.get("/hydration/manual")
def manual_hydration(d: date | None = None, db: Session = Depends(get_session)):
    return phase2.water_today(db, d)


@router.post("/hydration/manual")
def add_manual_hydration(payload: dict = Body(...), db: Session = Depends(get_session)):
    try:
        d = date.fromisoformat(payload["date"]) if payload.get("date") else None
        return phase2.log_water(db, int(payload.get("amount_ml", 0)), d)
    except (ValueError, TypeError) as exc: raise HTTPException(400, str(exc)) from exc


# ---------- Phase 3 adaptive planner ----------
@router.get("/planner/week")
def planner_week(start: date | None = None, db: Session = Depends(get_session)):
    return planner.week(db, start)


@router.post("/planner/regenerate")
def regenerate_plan(payload: dict = Body(default={}), db: Session = Depends(get_session)):
    try: return planner.regenerate(db, date.fromisoformat(payload["start"]) if payload.get("start") else None)
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc


@router.put("/planner/sessions/{session_id}")
def update_planned_session(session_id: int, payload: dict = Body(...), db: Session = Depends(get_session)):
    try: return planner.update_session(db, session_id, payload)
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc


@router.get("/planner/settings")
def planner_settings(db: Session = Depends(get_session)):
    return planner.settings(db)


@router.put("/planner/settings")
def update_planner_settings(payload: dict = Body(...), db: Session = Depends(get_session)):
    try: return planner.update_settings(db, payload)
    except (ValueError, TypeError) as exc: raise HTTPException(400, str(exc)) from exc


@router.get("/planner/recovery-forecast")
def planner_recovery_forecast(db: Session = Depends(get_session)):
    return planner.recovery_forecast(db)


# ---------- Phase 4 personal intelligence lab ----------
@router.get("/lab")
def lab_dashboard(db: Session = Depends(get_session)):
    return lab.dashboard(db)


@router.post("/lab/experiments")
def create_experiment(payload: dict = Body(...), db: Session = Depends(get_session)):
    try: return lab.create_experiment(db, payload)
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc


@router.put("/lab/experiments/{experiment_id}")
def update_experiment(experiment_id: int, payload: dict = Body(...), db: Session = Depends(get_session)):
    try: return lab.update_experiment(db, experiment_id, payload)
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc

@router.delete("/lab/experiments/{experiment_id}")
def delete_experiment(experiment_id: int, db: Session = Depends(get_session)):
    if not lab.delete_experiment(db, experiment_id): raise HTTPException(404, "experiment not found")
    return {"deleted": experiment_id}


@router.post("/lab/experiments/{experiment_id}/days")
def log_experiment_day(experiment_id: int, payload: dict = Body(default={}), db: Session = Depends(get_session)):
    try: return lab.log_day(db, experiment_id, payload)
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc


@router.get("/lab/annotations")
def health_annotations(days: int = 180, db: Session = Depends(get_session)):
    return lab.annotations(db, days)


@router.post("/lab/annotations")
def add_health_annotation(payload: dict = Body(...), db: Session = Depends(get_session)):
    try: return lab.add_annotation(db, payload)
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc

@router.delete("/lab/annotations/{annotation_id}")
def delete_health_annotation(annotation_id: int, db: Session = Depends(get_session)):
    if not lab.delete_annotation(db, annotation_id): raise HTTPException(404, "annotation not found")
    return {"deleted": annotation_id}


@router.get("/data-quality")
def data_quality(db: Session = Depends(get_session)):
    return analytics.data_freshness(db)


@router.get("/analytics/calendar")
def activity_calendar_route(days: int = 365, db: Session = Depends(get_session)):
    return analytics.activity_calendar(db, days)


@router.get("/analytics/correlations")
def correlation_miner_route(days: int = 90, db: Session = Depends(get_session)):
    return analytics.correlation_miner(db, days)


@router.get("/health/trend")
def health_trend(days: int = 30, db: Session = Depends(get_session)):
    return analytics.health_trend(db, days)


@router.get("/health/intraday")
def health_intraday(d: str | None = None, db: Session = Depends(get_session)):
    """Hourly stress/body battery, live-refreshed today and cached for resilience."""
    day = date.fromisoformat(d) if d else date.today()
    cached = db.get(IntradayHealth, day)
    result = None
    if day == date.today() or not cached:
        try: result = gc.fetch_intraday_stress(gc.make_client(), day)
        except gc.GarminUnavailable: result = None
    if result:
        row = cached or IntradayHealth(date=day)
        row.avg_stress, row.max_stress, row.hourly = result.get("avg_stress"), result.get("max_stress"), result.get("hourly")
        row.source, row.updated_at = "garmin", datetime.utcnow()
        if not cached: db.add(row)
        db.commit()
        return {**result, "cached": False}
    if cached:
        return {"date": cached.date.isoformat(), "avg_stress": cached.avg_stress, "max_stress": cached.max_stress,
                "hourly": cached.hourly or [], "cached": True, "updated_at": cached.updated_at.isoformat()}
    raise HTTPException(status_code=404, detail="no intraday data for this date")


@router.get("/health/current")
def health_current(db: Session = Depends(get_session)):
    """Live current stress + body battery reading - bypasses the DB entirely,
    always a fresh call to Garmin, since these change throughout the day and the
    stored daily row only has the day's average/peak stats."""
    try:
        client = gc.make_client()
    except gc.GarminUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e))
    live = gc.fetch_current_reading(client)
    if live and (live.get("stress") is not None or live.get("body_battery") is not None):
        return {**live, "source": "live"}
    cached = db.get(IntradayHealth, date.today())
    points = [p for p in (cached.hourly if cached else []) if p.get("avg_stress") is not None or p.get("avg_battery") is not None]
    if points:
        p = points[-1]
        return {"stress": p.get("avg_stress"), "body_battery": p.get("avg_battery"),
                "as_of": f"{date.today().isoformat()}T{p['hour']:02d}:00:00", "source": "hourly cache"}
    return {"stress": None, "body_battery": None, "as_of": None, "source": "unavailable"}


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
        "bedtime_recommendation": analytics.bedtime_recommendation(db, target_hours=analytics.personalized_sleep_target(db) or settings.sleep_target_hours),
        "why_last_night_bad": analytics.why_last_night_bad(db),
    }


@router.get("/activities")
def activities(limit: int = Query(20, ge=1, le=500), db: Session = Depends(get_session)):
    return analytics.recent_activities(db, limit)


@router.get("/activities/hr-zones")
def activities_hr_zones(days: int = 30, db: Session = Depends(get_session)):
    return analytics.hr_zone_summary(db, days)


@router.get("/activities/karvonen-zones")
def karvonen_zones_route(db: Session = Depends(get_session)):
    return analytics.karvonen_zones(db) or {}


@router.get("/activities/karvonen-sessions")
def karvonen_sessions_route(days: int = 90, db: Session = Depends(get_session)):
    return analytics.sessions_by_karvonen_zone(db, days)


@router.get("/activities/route-heatmap")
def route_heatmap(db: Session = Depends(get_session)):
    """Every cached route overlaid on one map. Routes are cached lazily (see
    /sync below and single-activity route views) rather than fetched live here
    - fetching dozens of live Garmin calls in one request would be far too slow.
    Registered before /activities/{activity_id} - FastAPI matches path routes
    in registration order, so a literal path here must come first or it'd be
    swallowed by the {activity_id} route with activity_id="route-heatmap"."""
    rows = db.execute(
        select(Activity).where(Activity.route_points.isnot(None))
    ).scalars().all()
    total_runs = db.scalar(
        select(func.count()).select_from(Activity).where(Activity.activity_type.ilike("%run%"))
    )
    return {
        "routes": [{"id": a.id, "date": a.date.isoformat() if a.date else None,
                    "name": a.name, "distance_km": round((a.distance_m or 0) / 1000, 2),
                    "duration_min": round((a.duration_s or 0) / 60, 1),
                    "pace_s_per_km": round(a.avg_pace_s_per_km) if a.avg_pace_s_per_km else None,
                    "avg_hr": a.avg_hr,
                    "points": a.route_points[::max(1, len(a.route_points) // 700)] if a.route_points else []}
                   for a in rows],
        "cached_count": len(rows),
        "total_runs": total_runs,
    }


@router.post("/activities/route-heatmap/sync")
def route_heatmap_sync(batch_size: int = 8, db: Session = Depends(get_session)):
    """Fetches+caches routes for a batch of runs that don't have one yet.
    Call repeatedly from the UI (with a progress bar) until done=True -
    keeps each request fast instead of one giant fetch-everything call."""
    missing = db.execute(
        select(Activity)
        .where(Activity.route_points.is_(None), Activity.activity_type.ilike("%run%"))
        .order_by(Activity.date.desc())
        .limit(batch_size)
    ).scalars().all()
    if not missing:
        return {"fetched": 0, "done": True}
    try:
        client = gc.make_client()
    except gc.GarminUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e))
    fetched = 0
    for a in missing:
        points = gc.fetch_route(client, a.id)
        a.route_points = points or []  # [] marks "checked, no GPS data" so we don't retry forever
        fetched += 1
    db.commit()
    remaining = db.scalar(
        select(func.count()).select_from(Activity)
        .where(Activity.route_points.is_(None), Activity.activity_type.ilike("%run%"))
    )
    return {"fetched": fetched, "done": remaining == 0}


@router.get("/workouts")
def workouts(limit: int = Query(20, ge=1, le=500), db: Session = Depends(get_session)):
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
    points = a.route_points
    if not points:
        try:
            client = gc.make_client()
        except gc.GarminUnavailable as e:
            raise HTTPException(status_code=502, detail=str(e))
        points = gc.fetch_route(client, activity_id)
    if not points:
        raise HTTPException(status_code=404, detail="no route data for this activity")
    if not a.route_points:
        a.route_points = points
        db.commit()
    return {"id": a.id, "date": a.date.isoformat() if a.date else None, "name": a.name,
            "distance_km": round((a.distance_m or 0) / 1000, 2),
            "duration_min": round((a.duration_s or 0) / 60, 1),
            "pace_s_per_km": round(a.avg_pace_s_per_km) if a.avg_pace_s_per_km else None,
            "avg_hr": a.avg_hr, "points": points}


@router.get("/activities/{activity_id}/splits")
def activity_splits_route(activity_id: str, db: Session = Depends(get_session)):
    a = db.get(Activity, activity_id)
    if not a:
        raise HTTPException(status_code=404, detail="activity not found")
    if a.splits:
        return {"splits": a.splits}
    try:
        client = gc.make_client()
    except gc.GarminUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e))
    splits = gc.fetch_splits(client, activity_id)
    if not splits:
        raise HTTPException(status_code=404, detail="no split data for this activity")
    a.splits = splits
    db.commit()
    return {"splits": splits}


@router.post("/activities/splits/sync")
def splits_sync(batch_size: int = Query(8, ge=1, le=25), db: Session = Depends(get_session)):
    """Caches splits for a batch of runs that don't have them yet - same
    call-until-done contract as the route heatmap sync."""
    pending = (Activity.splits.is_(None), Activity.activity_type.in_(("running", "trail_running", "track_running")))
    missing = db.execute(
        select(Activity).where(*pending).order_by(Activity.date.desc()).limit(batch_size)
    ).scalars().all()
    if not missing:
        return {"fetched": 0, "done": True}
    try:
        client = gc.make_client()
    except gc.GarminUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e))
    for a in missing:
        try:
            a.splits = gc.fetch_splits(client, a.id, strict=True) or []  # [] = checked, nothing there
        except Exception as e:  # Garmin error/rate limit: keep progress, leave the rest unmarked to retry
            db.commit()
            raise HTTPException(status_code=502, detail=f"Garmin request failed: {e}")
    db.commit()
    remaining = db.scalar(select(func.count()).select_from(Activity).where(*pending))
    return {"fetched": len(missing), "done": remaining == 0, "remaining": remaining}


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
    push it to your watch. Exercise matching against Garmin's catalog is best-effort -
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


@router.get("/strength/muscle-recency")
def muscle_recency_route(db: Session = Depends(get_session)):
    return analytics.muscle_recency(db)


@router.get("/training-load")
def training_load(weeks: int = 12, db: Session = Depends(get_session)):
    return analytics.training_load(db, weeks)


@router.get("/training/race-predictions")
def race_predictions(db: Session = Depends(get_session)):
    return analytics.race_predictions(db) or {}


@router.get("/performance")
def performance(days: int = Query(30, ge=7, le=120), db: Session = Depends(get_session)):
    return performance_svc.load(db, days)


@router.get("/training/plan-compliance")
def plan_compliance(weeks: int = Query(6, ge=1, le=26), db: Session = Depends(get_session)):
    return planner.run_compliance(db, weeks)


@router.get("/training/todays-call")
def todays_call(db: Session = Depends(get_session)):
    return analytics.todays_call(db)


@router.get("/training/run-insights")
def run_insights(weeks: int = 12, db: Session = Depends(get_session)):
    return analytics.run_insights(db, weeks) or {}


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


@router.get("/training/stress-balance")
def training_stress_balance_route(days: int = 180, db: Session = Depends(get_session)):
    return analytics.training_stress_balance(db, days)


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
def add_shoe(body: ShoeBody, db: Session = Depends(get_session)):
    return cardio_extras.add_shoe(
        db, body.name, body.start_date or date.today(), body.target_km,
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
    """Re-exec the server process in place - picks up a fresh .env, clears any
    stuck-in-memory state, without needing to touch the machine."""
    background.add_task(_restart_process)
    return {"status": "restarting"}


# ---------- sync (runs in background; poll /status) ----------
# The plain endpoints default to a fast "quick sync" (last quick_sync_days) so the
# Sync button and the 30-min scheduler stay quick. Pass ?full=true for a deep
# backfill over the full default_backfill_days window (slow - years of history).
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
    safe_name = Path(file.filename or "").name
    if not safe_name.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv export from Hevy.")
    raw = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"CSV is too large (max {settings.max_upload_mb} MB).")
    import_dir = Path(settings.hevy_import_dir).resolve()
    dest = import_dir / f"{datetime.utcnow():%Y%m%d-%H%M%S-%f}-{safe_name}"
    dest.write_bytes(raw)
    result = sync.import_csv_file(str(dest), db=db)
    if result.get("status") != "ok":
        dest.unlink(missing_ok=True)
        raise HTTPException(422, "CSV could not be imported")
    archive = Path(settings.hevy_import_dir) / "archive"
    archive.mkdir(parents=True, exist_ok=True)
    dest.replace(archive / dest.name)
    return result


@router.post("/sync/all")
def sync_all(background: BackgroundTasks, days: int | None = None, full: bool = False):
    n = days or (settings.default_backfill_days if full else settings.quick_sync_days)
    background.add_task(sync.sync_all, n)
    return {"started": "all", "days": n}


# ---------- AI insights ----------
@router.get("/ai/probe")
def ai_probe():
    return insights.provider_probe()


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
    """Cached once-a-day briefing for the Overview page - generated automatically
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
    """Cached once-a-week proactive digest - a standing check-in rather than
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


@router.put("/nutrition/day/complete")
def nutrition_day_complete(payload: dict = Body(...), db: Session = Depends(get_session)):
    d = date.fromisoformat(payload.get("date") or date.today().isoformat())
    try: return nutrition.set_day_complete(db, d, bool(payload.get("complete")))
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc


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
def create_meal(payload: MealBody, db: Session = Depends(get_session)):
    return nutrition.add_meal(db, payload.model_dump(mode="json", exclude_none=True))


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
    (e.g. weighed ingredients). Returns an estimate to prefill the add-meal form -
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
    the user to review/edit - POST /recipes to actually save it."""
    source_type = "text"
    combined_text_parts = [text] if text else []

    if url:
        try:
            url = str(RecipeExtractUrl(url=url).url)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
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
def log_weight(payload: WeightBody, db: Session = Depends(get_session)):
    return weight_svc.add_weight(db, payload.date or date.today(), payload.weight_kg, payload.body_fat_pct, payload.notes)


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


@router.get("/weight/goal-history")
def weight_goal_history(db: Session = Depends(get_session)):
    return weight_svc.goal_history(db)


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


# ---------- data export ----------
@router.get("/export/json")
def export_json(db: Session = Depends(get_session)):
    data = export_svc.full_export(db)
    return Response(
        content=json.dumps(data, indent=2), media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=pulse-export.json"},
    )


@router.get("/backups")
def list_backups():
    return backup_svc.list_backups()


@router.post("/backups/run")
def run_backup_now():
    path = backup_svc.run_backup()
    if not path:
        raise HTTPException(status_code=400, detail="backup not applicable (non-SQLite database)")
    return {"ok": True, "file": path.name}


@router.post("/backups/restore")
def restore_backup(request: Request, body: RestoreBackupBody):
    if not _direct_loopback(request):
        raise HTTPException(403, "Backup restore is only allowed directly from this PC")
    try:
        emergency = backup_svc.restore_backup(body.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "restored": body.name, "pre_restore_backup": emergency.name}


@router.get("/export/csv/{table}")
def export_csv(table: str, db: Session = Depends(get_session)):
    try:
        csv_text = export_svc.csv_export(db, table)
    except ValueError:
        raise HTTPException(status_code=404, detail="unknown table")
    return Response(
        content=csv_text, media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=pulse-{table}.csv"},
    )


# ---------- push notifications ----------
@router.get("/push/vapid-public-key")
def push_vapid_public_key():
    return {"key": settings.vapid_public_key}


@router.post("/push/subscribe")
def push_subscribe(body: dict = Body(...), db: Session = Depends(get_session)):
    sub = body.get("subscription") or body
    keys = sub.get("keys", {})
    push_svc.add_subscription(db, sub["endpoint"], keys.get("p256dh", ""), keys.get("auth", ""))
    return {"ok": True}


@router.post("/push/unsubscribe")
def push_unsubscribe(body: dict = Body(...), db: Session = Depends(get_session)):
    push_svc.remove_subscription(db, body.get("endpoint", ""))
    return {"ok": True}


@router.post("/push/test")
def push_test(db: Session = Depends(get_session)):
    """Manual trigger for the settings UI's 'Send test notification' button."""
    sent = push_svc.send_to_all(db, "Pulse", "Push notifications are working.", tag="test")
    return {"sent": sent}
