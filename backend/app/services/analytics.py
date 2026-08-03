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


def latest_vo2max(db: Session) -> DailyHealth | None:
    """VO2max only updates on days with a qualifying run, so pull the most recent
    day that actually has one rather than whatever day snapshot() otherwise picks."""
    return db.execute(
        select(DailyHealth)
        .where(DailyHealth.vo2max.isnot(None))
        .order_by(DailyHealth.date.desc()).limit(1)
    ).scalar_one_or_none()


def latest_fitness_age(db: Session) -> DailyHealth | None:
    return db.execute(
        select(DailyHealth)
        .where(DailyHealth.fitness_age.isnot(None))
        .order_by(DailyHealth.date.desc()).limit(1)
    ).scalar_one_or_none()


def snapshot(db: Session) -> dict:
    """Today's headline numbers for the hero panel."""
    h = latest_health(db)
    s = latest_sleep(db)
    fa = latest_fitness_age(db)
    v = latest_vo2max(db)
    return {
        "fitness_age": fa.fitness_age if fa else None,
        "chronological_age": fa.chronological_age if fa else None,
        "vo2max_date": v.date.isoformat() if v else None,
        "date": h.date.isoformat() if h else None,
        "training_readiness": h.training_readiness if h else None,
        "training_readiness_label": h.training_readiness_label if h else None,
        "training_status": h.training_status if h else None,
        "body_battery_high": h.body_battery_high if h else None,
        "body_battery_low": h.body_battery_low if h else None,
        "resting_hr": h.resting_hr if h else None,
        "hrv_last_night": h.hrv_last_night if h else None,
        "hrv_status": h.hrv_status if h else None,
        "vo2max": v.vo2max if v else None,
        "steps": h.steps if h else None,
        "step_goal": h.step_goal if h else None,
        "stress": h.avg_stress if h else None,
        "intensity_minutes": h.intensity_minutes if h else None,
        "sleep_score": s.sleep_score if s else None,
        "sleep_seconds": s.total_seconds if s else None,
        "sleep_date": s.date.isoformat() if s else None,
        "calories_total": h.calories_total if h else None,
        "calories_active": h.calories_active if h else None,
        "calories_resting": (h.calories_total - h.calories_active)
            if h and h.calories_total is not None and h.calories_active is not None else None,
    }


def health_trend(db: Session, days: int = 30) -> list[dict]:
    start = date.today() - timedelta(days=days)
    rows = db.execute(
        select(DailyHealth).where(DailyHealth.date >= start).order_by(DailyHealth.date)
    ).scalars().all()
    return [{
        "date": r.date.isoformat(),
        "resting_hr": r.resting_hr,
        "max_hr": r.max_hr,
        "min_hr": r.min_hr,
        "hrv": r.hrv_last_night,
        "readiness": r.training_readiness,
        "body_battery_high": r.body_battery_high,
        "stress": r.avg_stress,
        "steps": r.steps,
        "vo2max": r.vo2max,
    } for r in rows]


def hr_zone_summary(db: Session, days: int = 30) -> dict:
    """Time-in-HR-zone across recent activities — sourced from each activity's raw
    Garmin payload (hrTimeInZone_1..5), which we already store but don't aggregate."""
    start = date.today() - timedelta(days=days)
    rows = db.execute(
        select(Activity).where(Activity.date >= start)
    ).scalars().all()
    zone_min = [0.0] * 5
    n = 0
    for a in rows:
        raw = a.raw or {}
        if not any(f"hrTimeInZone_{i}" in raw for i in range(1, 6)):
            continue
        n += 1
        for i in range(1, 6):
            zone_min[i - 1] += (raw.get(f"hrTimeInZone_{i}") or 0) / 60
    return {
        "activities_with_hr": n,
        "zones_min": [round(v, 1) for v in zone_min],
    }


def _bedtime_hour(dt) -> float | None:
    """Hour-of-day as a decimal, normalized so a typical bedtime (evening through
    past-midnight) stays on one continuous scale instead of wrapping at 24."""
    if not dt:
        return None
    h = dt.hour + dt.minute / 60
    return h if h >= 12 else h + 24


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
        "avg_hr": r.avg_hr,
        "awake_count": r.awake_count,
        "avg_spo2": r.avg_spo2,
        "avg_respiration": r.avg_respiration,
        "avg_stress": r.avg_stress,
        "body_battery_change": r.body_battery_change,
        "bedtime_hour": _bedtime_hour(r.start_time),
        "wake_hour": r.end_time.hour + r.end_time.minute / 60 if r.end_time else None,
        "score_feedback": r.score_feedback,
    } for r in rows]


def sleep_consistency(db: Session, days: int = 30) -> dict:
    """How stable bedtime/wake time are — a big lever on actual sleep quality that
    the raw score alone doesn't capture."""
    trend = sleep_trend(db, days)
    bedtimes = [r["bedtime_hour"] for r in trend if r["bedtime_hour"] is not None]
    wakes = [r["wake_hour"] for r in trend if r["wake_hour"] is not None]

    def _std(vals):
        if len(vals) < 2:
            return None
        m = sum(vals) / len(vals)
        return round((sum((v - m) ** 2 for v in vals) / len(vals)) ** 0.5, 2)

    return {
        "nights": len(trend),
        "avg_bedtime_hour": _avg(bedtimes),
        "avg_wake_hour": _avg(wakes),
        "bedtime_variability_h": _std(bedtimes),
        "wake_variability_h": _std(wakes),
        "nights_data": trend,
    }


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


_RACE_DISTANCES = {
    "5k": (5000, 0.98), "10k": (10000, 0.95),
    "half_marathon": (21097.5, 0.88), "marathon": (42195, 0.82),
}


def race_predictions(db: Session) -> dict | None:
    """Predicted race times from current VO2max, using the standard ACSM running
    VO2-cost equation (VO2 = 0.2*v + 3.5) combined with Daniels'-style %VO2max
    sustainability by race duration. A well-known approximation, not a lab test —
    framed as a ballpark, not gospel."""
    v = latest_vo2max(db)
    if not v or not v.vo2max:
        return None
    out = {}
    for name, (dist_m, pct) in _RACE_DISTANCES.items():
        vo2_race = v.vo2max * pct
        v_m_per_min = (vo2_race - 3.5) / 0.2
        if v_m_per_min <= 0:
            continue
        time_sec = round(dist_m / v_m_per_min * 60)
        out[name] = {"seconds": time_sec, "pace_per_km": round(time_sec / (dist_m / 1000))}
    return {"vo2max": v.vo2max, "vo2max_date": v.date.isoformat(), "predictions": out}


def _week_key(d: date) -> str:
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"
