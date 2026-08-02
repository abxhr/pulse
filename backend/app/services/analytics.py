"""Derived metrics and aggregations for the dashboard, trends, and reports."""
from __future__ import annotations
from datetime import date, timedelta
from collections import defaultdict

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..models import DailyHealth, Sleep, Activity, Workout


def _avg(values):
    vals = [v for v in values if v is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def latest_health(db: Session) -> DailyHealth | None:
    """Most recent day with real data. The literal newest date row is often an
    empty shell — Garmin frequently hasn't finished computing resting HR / stress
    / body battery for today (or the last day or two) yet — so prefer a day that
    actually has something, falling back to the bare newest row if truly nothing
    has synced."""
    row = db.execute(
        select(DailyHealth)
        .where(DailyHealth.resting_hr.isnot(None))
        .order_by(DailyHealth.date.desc()).limit(1)
    ).scalar_one_or_none()
    if row:
        return row
    return db.execute(
        select(DailyHealth).order_by(DailyHealth.date.desc()).limit(1)
    ).scalar_one_or_none()


def latest_sleep(db: Session) -> Sleep | None:
    row = db.execute(
        select(Sleep)
        .where(Sleep.sleep_score.isnot(None))
        .order_by(Sleep.date.desc()).limit(1)
    ).scalar_one_or_none()
    if row:
        return row
    return db.execute(
        select(Sleep).order_by(Sleep.date.desc()).limit(1)
    ).scalar_one_or_none()


def snapshot(db: Session) -> dict:
    """Today's headline numbers for the hero panel."""
    h = latest_health(db)
    s = latest_sleep(db)
    return {
        "date": h.date.isoformat() if h else None,
        "training_readiness": h.training_readiness if h else None,
        "training_readiness_label": h.training_readiness_label if h else None,
        "training_status": h.training_status if h else None,
        "body_battery_high": h.body_battery_high if h else None,
        "body_battery_low": h.body_battery_low if h else None,
        "resting_hr": h.resting_hr if h else None,
        "hrv_last_night": h.hrv_last_night if h else None,
        "hrv_status": h.hrv_status if h else None,
        "vo2max": h.vo2max if h else None,
        "steps": h.steps if h else None,
        "step_goal": h.step_goal if h else None,
        "stress": h.avg_stress if h else None,
        "intensity_minutes": h.intensity_minutes if h else None,
        "sleep_score": s.sleep_score if s else None,
        "sleep_seconds": s.total_seconds if s else None,
        "sleep_date": s.date.isoformat() if s else None,
    }


def health_trend(db: Session, days: int = 30) -> list[dict]:
    start = date.today() - timedelta(days=days)
    rows = db.execute(
        select(DailyHealth).where(DailyHealth.date >= start).order_by(DailyHealth.date)
    ).scalars().all()
    return [{
        "date": r.date.isoformat(),
        "resting_hr": r.resting_hr,
        "hrv": r.hrv_last_night,
        "readiness": r.training_readiness,
        "body_battery_high": r.body_battery_high,
        "stress": r.avg_stress,
        "steps": r.steps,
        "vo2max": r.vo2max,
    } for r in rows]


def sleep_trend(db: Session, days: int = 30) -> list[dict]:
    start = date.today() - timedelta(days=days)
    rows = db.execute(
        select(Sleep).where(Sleep.date >= start).order_by(Sleep.date)
    ).scalars().all()
    return [{
        "date": r.date.isoformat(),
        "score": r.sleep_score,
        "total_h": round((r.total_seconds or 0) / 3600, 2),
        "deep_h": round((r.deep_seconds or 0) / 3600, 2),
        "light_h": round((r.light_seconds or 0) / 3600, 2),
        "rem_h": round((r.rem_seconds or 0) / 3600, 2),
        "awake_h": round((r.awake_seconds or 0) / 3600, 2),
        "resting_hr": r.resting_hr,
        "hrv": r.hrv_avg,
    } for r in rows]


def recent_activities(db: Session, limit: int = 12) -> list[dict]:
    rows = db.execute(
        select(Activity).order_by(Activity.start_time.desc()).limit(limit)
    ).scalars().all()
    return [{
        "id": r.id,
        "date": r.date.isoformat() if r.date else None,
        "type": r.activity_type,
        "name": r.name,
        "distance_km": round((r.distance_m or 0) / 1000, 2),
        "duration_min": round((r.duration_s or 0) / 60, 1),
        "avg_hr": r.avg_hr,
        "pace_per_km": r.avg_pace_s_per_km,
        "calories": r.calories,
        "elevation_gain_m": r.elevation_gain_m,
        "aerobic_te": r.aerobic_te,
        "anaerobic_te": r.anaerobic_te,
    } for r in rows]


def training_load(db: Session, weeks: int = 12) -> list[dict]:
    """Weekly run distance + strength volume, bucketed by ISO week."""
    start = date.today() - timedelta(weeks=weeks)
    acts = db.execute(
        select(Activity).where(Activity.date >= start)
    ).scalars().all()
    wkos = db.execute(
        select(Workout).where(Workout.date >= start)
    ).scalars().all()

    buckets: dict[str, dict] = defaultdict(
        lambda: {"run_km": 0.0, "strength_volume": 0.0, "sessions": 0, "run_min": 0.0}
    )
    for a in acts:
        if not a.date:
            continue
        wk = _week_key(a.date)
        if (a.activity_type or "").endswith("running") or a.activity_type == "running":
            buckets[wk]["run_km"] += (a.distance_m or 0) / 1000
            buckets[wk]["run_min"] += (a.duration_s or 0) / 60
        buckets[wk]["sessions"] += 1
    for w in wkos:
        if not w.date:
            continue
        wk = _week_key(w.date)
        buckets[wk]["strength_volume"] += w.volume_kg or 0
        buckets[wk]["sessions"] += 1

    return [{
        "week": k,
        "run_km": round(v["run_km"], 1),
        "run_min": round(v["run_min"], 0),
        "strength_volume": round(v["strength_volume"], 0),
        "sessions": v["sessions"],
    } for k, v in sorted(buckets.items())]


def strength_summary(db: Session, weeks: int = 8) -> dict:
    """Per-muscle-group volume + top exercises by volume over the window."""
    start = date.today() - timedelta(weeks=weeks)
    wkos = db.execute(
        select(Workout).where(Workout.date >= start).order_by(Workout.date)
    ).scalars().all()

    by_muscle: dict[str, float] = defaultdict(float)
    by_exercise: dict[str, dict] = defaultdict(lambda: {"volume": 0.0, "sets": 0, "best_kg": 0.0})
    weekly: dict[str, float] = defaultdict(float)
    total_volume = 0.0

    for w in wkos:
        wk = _week_key(w.date) if w.date else "?"
        weekly[wk] += w.volume_kg or 0
        total_volume += w.volume_kg or 0
        for ex in (w.exercises or []):
            muscle = ex.get("muscle_group") or "other"
            title = ex.get("title") or "?"
            for s in ex.get("sets", []):
                vol = (s.get("weight_kg") or 0) * (s.get("reps") or 0)
                by_muscle[muscle] += vol
                by_exercise[title]["volume"] += vol
                by_exercise[title]["sets"] += 1
                by_exercise[title]["best_kg"] = max(
                    by_exercise[title]["best_kg"], s.get("weight_kg") or 0
                )

    top = sorted(
        ({"exercise": k, **v} for k, v in by_exercise.items()),
        key=lambda x: x["volume"], reverse=True,
    )[:8]
    return {
        "total_volume_kg": round(total_volume, 0),
        "workout_count": len(wkos),
        "by_muscle": [
            {"muscle": k, "volume_kg": round(v, 0)}
            for k, v in sorted(by_muscle.items(), key=lambda x: -x[1])
        ],
        "weekly_volume": [
            {"week": k, "volume_kg": round(v, 0)} for k, v in sorted(weekly.items())
        ],
        "top_exercises": [
            {**t, "volume": round(t["volume"], 0)} for t in top
        ],
    }


def strength_this_week(db: Session) -> dict:
    """Per-muscle-group volume + sets for the current Monday-Sunday week —
    feeds the muscle-heatmap body diagram."""
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    wkos = db.execute(
        select(Workout).where(Workout.date >= monday, Workout.date <= sunday).order_by(Workout.date)
    ).scalars().all()

    by_muscle: dict[str, dict] = defaultdict(lambda: {"volume_kg": 0.0, "sets": 0})
    for w in wkos:
        for ex in (w.exercises or []):
            muscle = ex.get("muscle_group") or "other"
            for s in ex.get("sets", []):
                vol = (s.get("weight_kg") or 0) * (s.get("reps") or 0)
                by_muscle[muscle]["volume_kg"] += vol
                by_muscle[muscle]["sets"] += 1

    max_vol = max((v["volume_kg"] for v in by_muscle.values()), default=0)
    return {
        "week_start": monday.isoformat(), "week_end": sunday.isoformat(),
        "workout_count": len(wkos),
        "by_muscle": [
            {
                "muscle": k, "volume_kg": round(v["volume_kg"], 0), "sets": v["sets"],
                "intensity": round(v["volume_kg"] / max_vol, 3) if max_vol else 0,
            }
            for k, v in sorted(by_muscle.items(), key=lambda x: -x[1]["volume_kg"])
        ],
        "sessions": [
            {"date": w.date.isoformat() if w.date else None, "title": w.title, "id": w.id}
            for w in wkos
        ],
    }


def _week_key(d: date) -> str:
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"
