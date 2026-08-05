"""Derived metrics and aggregations for the dashboard, trends, and reports."""
from __future__ import annotations
from datetime import date, timedelta
from collections import defaultdict

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..models import DailyHealth, Sleep, Activity, Workout, Meal


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


_KARVONEN_BANDS = [
    ("Z1 recovery", 0.50, 0.60), ("Z2 aerobic", 0.60, 0.70), ("Z3 tempo", 0.70, 0.80),
    ("Z4 threshold", 0.80, 0.90), ("Z5 max", 0.90, 1.00),
]


def karvonen_zones(db: Session) -> dict | None:
    """Personalized HR zones from the heart-rate-reserve method (Karvonen):
    target = (max - resting) * intensity% + resting. Generic %-of-max bands
    (what most trackers ship by default) systematically under/over-shoot for
    anyone with an unusually low resting HR — this uses your actual measured
    values instead."""
    max_hr = db.execute(select(func.max(Activity.max_hr))).scalar()
    resting = db.execute(
        select(DailyHealth.resting_hr).where(DailyHealth.resting_hr.isnot(None))
        .order_by(DailyHealth.date.desc()).limit(14)
    ).scalars().all()
    if not max_hr or not resting:
        return None
    resting_hr = round(sum(resting) / len(resting))
    hrr = max_hr - resting_hr
    if hrr <= 0:
        return None
    zones = [{
        "name": name, "low_bpm": round(hrr * lo + resting_hr), "high_bpm": round(hrr * hi + resting_hr),
    } for name, lo, hi in _KARVONEN_BANDS]
    return {"max_hr": max_hr, "resting_hr": resting_hr, "zones": zones}


def sessions_by_karvonen_zone(db: Session, days: int = 90) -> list[dict]:
    """Buckets each run by which personalized zone its average HR falls in —
    approximate (avg HR per session, not a true time-in-zone breakdown, since
    we don't store second-by-second HR streams), but zone thresholds are
    genuinely personalized rather than generic %-of-max bands."""
    kz = karvonen_zones(db)
    if not kz:
        return []
    start = date.today() - timedelta(days=days)
    acts = db.execute(
        select(Activity).where(Activity.date >= start, Activity.avg_hr.isnot(None))
    ).scalars().all()
    counts = {z["name"]: 0 for z in kz["zones"]}
    zones = kz["zones"]
    for a in acts:
        if a.avg_hr < zones[0]["low_bpm"]:
            continue  # below Z1 — pre-warmup / very easy, not counted
        for i, z in enumerate(zones):
            is_last = i == len(zones) - 1
            if z["low_bpm"] <= a.avg_hr <= (10**9 if is_last else z["high_bpm"]):
                counts[z["name"]] += 1
                break
    return [{"zone": name, "sessions": n} for name, n in counts.items()]


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
        "nap_h": round((r.nap_seconds or 0) / 3600, 2) if r.nap_seconds else 0,
        "start_time": r.start_time.isoformat() if r.start_time else None,
        "end_time": r.end_time.isoformat() if r.end_time else None,
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


def personalized_sleep_target(db: Session) -> float | None:
    """Garmin adaptively computes your actual nightly sleep need (age, recent
    sleep history, training load, HRV) rather than a flat 8h — pulling that
    instead of a hardcoded default personalizes the debt tracker per-user
    with zero extra input."""
    row = db.execute(
        select(Sleep.sleep_need_min).where(Sleep.sleep_need_min.isnot(None))
        .order_by(Sleep.date.desc()).limit(1)
    ).scalar_one_or_none()
    return round(row / 60, 2) if row else None


def sleep_debt(db: Session, days: int = 14, target_hours: float | None = None) -> dict:
    """Running deficit/surplus vs. nightly sleep need over a trailing window.
    A single bad night is normal; a growing debt across two weeks is the thing
    worth actually flagging."""
    if target_hours is None:
        target_hours = personalized_sleep_target(db) or 8.0
    trend = sleep_trend(db, days)
    nights = [r for r in trend if r["total_h"]]
    daily = [
        {"date": r["date"], "slept_h": r["total_h"], "delta_h": round(r["total_h"] - target_hours, 2)}
        for r in nights
    ]
    debt_h = round(sum(-d["delta_h"] for d in daily), 1) if daily else 0.0
    return {
        "target_hours": target_hours,
        "personalized": personalized_sleep_target(db) is not None,
        "nights_tracked": len(daily),
        "debt_hours": debt_h,  # positive = behind on sleep, negative = ahead
        "avg_hours": _avg([d["slept_h"] for d in daily]),
        "daily": daily,
    }


def _std(vals: list[float]) -> float | None:
    if len(vals) < 2:
        return None
    m = sum(vals) / len(vals)
    return (sum((v - m) ** 2 for v in vals) / len(vals)) ** 0.5


def anomaly_alerts(db: Session, days: int = 30) -> list[dict]:
    """Flags today's resting HR / HRV as anomalous when they deviate >1.5 SD from
    the trailing baseline (today excluded from the baseline itself, so a bad day
    doesn't dilute its own reference point)."""
    trend = health_trend(db, days + 1)
    if len(trend) < 8:
        return []
    *history, latest = trend
    alerts = []
    for key, label, higher_is_bad in (("resting_hr", "Resting HR", True), ("hrv", "HRV", False)):
        baseline = [r[key] for r in history if r[key] is not None]
        today_val = latest[key]
        if today_val is None or len(baseline) < 7:
            continue
        mean = sum(baseline) / len(baseline)
        sd = _std(baseline)
        if not sd:
            continue
        z = (today_val - mean) / sd
        if abs(z) < 1.5:
            continue
        bad = (z > 0) if higher_is_bad else (z < 0)
        alerts.append({
            "metric": key,
            "label": label,
            "value": today_val,
            "baseline_mean": round(mean, 1),
            "baseline_sd": round(sd, 1),
            "z_score": round(z, 2),
            "direction": "up" if z > 0 else "down",
            "severity": "warn" if bad else "info",
        })
    return alerts


_WHAT_CHANGED_METRICS = [
    ("resting_hr", "Resting HR", "bpm", False),
    ("hrv", "HRV", "ms", True),
    ("readiness", "Readiness", "", True),
    ("stress", "Stress", "", False),
    ("steps", "Steps", "", True),
]


def what_changed(db: Session, days: int = 7) -> dict | None:
    """One-line callout for the single metric that moved the most vs. its own
    trailing average — a cheap way to surface the day's most notable signal
    without the user having to scan every chart themselves."""
    trend = health_trend(db, days + 1)
    if len(trend) < 4:
        return None
    *history, latest = trend
    best = None
    for key, label, unit, higher_is_good in _WHAT_CHANGED_METRICS:
        hist_vals = [r[key] for r in history if r[key] is not None]
        today_val = latest[key]
        if today_val is None or len(hist_vals) < 3:
            continue
        avg = sum(hist_vals) / len(hist_vals)
        if avg == 0:
            continue
        pct = (today_val - avg) / abs(avg) * 100
        if best is None or abs(pct) > abs(best["pct_change"]):
            best = {
                "metric": key, "label": label, "unit": unit,
                "today": today_val, "avg": round(avg, 1),
                "pct_change": round(pct, 1),
                "direction": "up" if pct > 0 else "down",
                "good": (pct > 0) == higher_is_good,
            }
    if not best or abs(best["pct_change"]) < 5:
        return None
    arrow = "up" if best["direction"] == "up" else "down"
    best["summary"] = (
        f"{best['label']} is {arrow} {abs(best['pct_change'])}% vs your {days}-day average "
        f"({best['today']}{best['unit']} vs {best['avg']}{best['unit']})"
    )
    return best


def chronotype(db: Session, days: int = 60) -> dict | None:
    """Classifies sleep-timing tendency from actual bedtime/wake distribution
    rather than asking — useful for deciding whether to fight your schedule or
    lean into it."""
    c = sleep_consistency(db, days)
    bt = c["avg_bedtime_hour"]
    if bt is None or c["nights"] < 7:
        return None
    if bt < 22:
        label, desc = "Early bird", "You naturally wind down early — training/eating late likely costs you sleep quality."
    elif bt < 23.5:
        label, desc = "Average", "Your bedtime sits close to the population average — no strong lean either way."
    elif bt < 25:
        label, desc = "Night owl leaning", "You consistently go down later than average — a late bedtime isn't a discipline problem, it's your rhythm."
    else:
        label, desc = "Strong night owl", "Your bedtime is well past midnight on average — fighting this with an early alarm is a recurring sleep-debt source."
    return {"label": label, "description": desc, "avg_bedtime_hour": bt, "avg_wake_hour": c["avg_wake_hour"]}


def _pearson(pairs: list[tuple[float, float]]) -> float | None:
    n = len(pairs)
    if n < 5:
        return None
    xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in pairs)
    dx = sum((x - mx) ** 2 for x in xs) ** 0.5
    dy = sum((y - my) ** 2 for y in ys) ** 0.5
    if dx == 0 or dy == 0:
        return None
    return round(num / (dx * dy), 2)


def sleep_performance_correlation(db: Session, days: int = 90) -> dict:
    """Correlates last night's sleep score with next-day readiness, strength
    volume, and run pace — the actual payoff question for someone optimizing
    training around recovery, not just eyeballing two separate charts."""
    start = date.today() - timedelta(days=days)
    sleep_rows = {r.date: r.sleep_score for r in db.execute(
        select(Sleep).where(Sleep.date >= start, Sleep.sleep_score.isnot(None))
    ).scalars().all()}
    health_rows = {r.date: r.training_readiness for r in db.execute(
        select(DailyHealth).where(DailyHealth.date >= start, DailyHealth.training_readiness.isnot(None))
    ).scalars().all()}
    wkos = db.execute(select(Workout).where(Workout.date >= start)).scalars().all()
    vol_by_day: dict = defaultdict(float)
    for w in wkos:
        if w.date:
            vol_by_day[w.date] += w.volume_kg or 0
    acts = db.execute(
        select(Activity).where(Activity.date >= start, Activity.avg_pace_s_per_km.isnot(None))
    ).scalars().all()
    pace_by_day: dict = {}
    for a in acts:
        if a.date:
            pace_by_day.setdefault(a.date, a.avg_pace_s_per_km)

    readiness_pairs, volume_pairs, pace_pairs = [], [], []
    scatter = []
    for d, score in sleep_rows.items():
        nxt = d + timedelta(days=1)
        r = health_rows.get(nxt)
        v = vol_by_day.get(nxt)
        p = pace_by_day.get(nxt)
        if r is not None:
            readiness_pairs.append((score, r))
        if v:
            volume_pairs.append((score, v))
        if p:
            pace_pairs.append((score, -p))  # lower seconds/km = faster = "better", flip sign for intuitive correlation direction
        if r is not None:
            scatter.append({"date": nxt.isoformat(), "sleep_score": score, "next_day_readiness": r})

    return {
        "readiness_corr": _pearson(readiness_pairs),
        "strength_volume_corr": _pearson(volume_pairs),
        "run_pace_corr": _pearson(pace_pairs),
        "n_nights": len(sleep_rows),
        "scatter": sorted(scatter, key=lambda x: x["date"]),
    }


def bedtime_recommendation(db: Session, target_hours: float = 8.0) -> dict | None:
    """A concrete "go to bed by X" suggestion, not just a debt number — spreads
    clearing half the current deficit over the next 3 nights."""
    debt = sleep_debt(db, target_hours=target_hours)
    c = sleep_consistency(db, 14)
    if debt["debt_hours"] <= 0 or c["avg_bedtime_hour"] is None:
        return None
    extra_per_night = min(debt["debt_hours"] / 2 / 3, 2.0)  # cap the nudge at 2h/night — anything more isn't realistic
    suggested = c["avg_bedtime_hour"] - extra_per_night
    hh = int(suggested % 24)
    mm = int(round((suggested % 24 - hh) * 60))
    period = "PM" if 12 <= hh < 24 else "AM"
    h12 = hh % 12 or 12
    return {
        "debt_hours": debt["debt_hours"],
        "suggested_bedtime": f"{h12}:{mm:02d} {period}",
        "extra_minutes": round(extra_per_night * 60),
        "clears_by_nights": 3,
    }


def why_last_night_bad(db: Session) -> dict | None:
    """When last night's sleep looks bad relative to baseline, pulls in same-day
    context (late workout, late meal) that might explain it instead of leaving
    the user to guess."""
    rows = db.execute(select(Sleep).order_by(Sleep.date.desc()).limit(15)).scalars().all()
    if len(rows) < 5:
        return None
    latest, *history = rows
    if latest.sleep_score is None:
        return None
    baseline = [r.sleep_score for r in history if r.sleep_score is not None]
    if len(baseline) < 4:
        return None
    mean = sum(baseline) / len(baseline)
    sd = _std(baseline)
    if not sd or latest.sleep_score >= mean - 0.75 * sd:
        return None  # last night wasn't notably bad — nothing to explain

    def _clock(dt) -> str:
        h12 = dt.hour % 12 or 12
        return f"{h12}:{dt.minute:02d} {'PM' if dt.hour >= 12 else 'AM'}"

    d = latest.date
    reasons = []
    wkos = db.execute(select(Workout).where(Workout.date == d)).scalars().all()
    for w in wkos:
        if w.end_time and latest.start_time and w.end_time > latest.start_time - timedelta(hours=3):
            reasons.append(f"Strength session ended late ({_clock(w.end_time)}), close to bedtime")
    meals = db.execute(select(Meal).where(Meal.date == d)).scalars().all()
    for m in meals:
        if m.time and latest.start_time and m.time > latest.start_time - timedelta(hours=2):
            reasons.append(f"Meal logged close to bedtime ({_clock(m.time)}: {m.name})")
    if latest.avg_stress and latest.avg_stress > 30:
        reasons.append(f"Elevated overnight stress (avg {latest.avg_stress})")
    if (latest.awake_count or 0) >= 5:
        reasons.append(f"Restless night — {latest.awake_count} awakenings")

    return {
        "date": d.isoformat(),
        "score": latest.sleep_score,
        "baseline_mean": round(mean, 1),
        "reasons": reasons or ["No obvious same-day cause found in logged data — could be untracked (travel, alcohol, illness)."],
    }


_CORR_TRIVIAL_PAIRS = {
    frozenset(("sleep_hours", "sleep_score")), frozenset(("deep_h", "sleep_score")),
    frozenset(("rem_h", "sleep_score")), frozenset(("rem_h", "sleep_hours")),
    frozenset(("deep_h", "sleep_hours")), frozenset(("deep_h", "rem_h")),
}

_CORR_LABELS = {
    "resting_hr": "Resting HR", "hrv": "HRV", "readiness": "Readiness", "stress": "Stress",
    "steps": "Steps", "body_battery_high": "Body battery", "sleep_score": "Sleep score",
    "sleep_hours": "Sleep hours", "deep_h": "Deep sleep", "rem_h": "REM sleep",
    "awake_count": "Awakenings", "avg_spo2": "SpO2", "avg_respiration": "Respiration",
    "bedtime_hour": "Bedtime", "calories": "Calories eaten", "protein_g": "Protein eaten",
    "run_km": "Run distance", "strength_kg": "Strength volume",
}


def correlation_miner(db: Session, days: int = 90, top_n: int = 6) -> list[dict]:
    """Scans every pair of tracked daily metrics for the strongest correlations,
    instead of only ever checking the one hardcoded pair (sleep -> next-day
    readiness). Surfaces genuinely non-obvious relationships — e.g. "your
    resting HR runs higher on days you eat less protein" — that nobody
    thought to build a dedicated chart for."""
    start = date.today() - timedelta(days=days)
    by_date: dict = defaultdict(dict)

    for r in health_trend(db, days):
        d = r["date"]
        for k in ("resting_hr", "hrv", "readiness", "stress", "steps", "body_battery_high"):
            if r.get(k) is not None:
                by_date[d][k] = r[k]

    for r in sleep_trend(db, days):
        d = r["date"]
        if r.get("score") is not None:
            by_date[d]["sleep_score"] = r["score"]
        if r.get("total_h"):
            by_date[d]["sleep_hours"] = r["total_h"]
        for k in ("deep_h", "rem_h", "awake_count", "avg_spo2", "avg_respiration", "bedtime_hour"):
            if r.get(k) is not None:
                by_date[d][k] = r[k]

    meals = db.execute(select(Meal).where(Meal.date >= start)).scalars().all()
    meal_totals: dict = defaultdict(lambda: {"calories": 0.0, "protein_g": 0.0})
    for m in meals:
        meal_totals[m.date.isoformat()]["calories"] += m.calories or 0
        meal_totals[m.date.isoformat()]["protein_g"] += m.protein_g or 0
    for d, totals in meal_totals.items():
        if totals["calories"]:
            by_date[d]["calories"] = totals["calories"]
        if totals["protein_g"]:
            by_date[d]["protein_g"] = totals["protein_g"]

    acts = db.execute(select(Activity).where(Activity.date >= start)).scalars().all()
    for a in acts:
        if a.date and "run" in (a.activity_type or ""):
            d = a.date.isoformat()
            by_date[d]["run_km"] = by_date[d].get("run_km", 0) + (a.distance_m or 0) / 1000
    wkos = db.execute(select(Workout).where(Workout.date >= start)).scalars().all()
    for w in wkos:
        if w.date:
            d = w.date.isoformat()
            by_date[d]["strength_kg"] = by_date[d].get("strength_kg", 0) + (w.volume_kg or 0)

    metrics = sorted({k for day in by_date.values() for k in day})
    results = []
    for i, a in enumerate(metrics):
        for b in metrics[i + 1:]:
            if frozenset((a, b)) in _CORR_TRIVIAL_PAIRS:
                continue  # same underlying signal by construction — not an insight
            pairs = [(day[a], day[b]) for day in by_date.values() if a in day and b in day]
            if len(pairs) < 15:
                continue  # too few overlapping days for the correlation to mean anything
            r = _pearson(pairs)
            if r is not None and abs(r) >= 0.3:
                results.append({
                    "a": _CORR_LABELS.get(a, a), "b": _CORR_LABELS.get(b, b),
                    "r": r, "n": len(pairs),
                })
    results.sort(key=lambda x: -abs(x["r"]))
    return results[:top_n]


def adaptive_step_goal(db: Session) -> dict | None:
    """A step target that scales with your own trailing activity level instead
    of a flat 10k — 10k is arbitrary and doesn't know if you're mid-taper or
    mid-base-building. Targets 5% above your trailing 14-day average, so it
    rises as you get more active and eases during legitimately lighter weeks
    instead of reading as failure."""
    trend = health_trend(db, 14)
    steps = [r["steps"] for r in trend if r["steps"] is not None]
    if len(steps) < 7:
        return None
    avg = sum(steps) / len(steps)
    target = round(avg * 1.05 / 500) * 500
    target = max(4000, min(20000, target))
    return {"target": target, "trailing_avg": round(avg), "fixed_default": 10000}


def overtraining_risk(db: Session) -> dict | None:
    """Composite illness/overtraining risk — a single weighted score instead
    of separate single-metric anomaly checks. The real value of combining
    signals: each one alone might sit within normal noise, but several
    *mildly* off at once (HRV a bit low, RHR a bit up, behind on sleep, load
    spiking) is a much stronger signal than any single metric crossing a
    threshold in isolation."""
    trend = health_trend(db, 31)
    if len(trend) < 10:
        return None
    *history, latest = trend
    factors = []
    score = 0.0

    hrv_hist = [r["hrv"] for r in history if r["hrv"] is not None]
    if latest["hrv"] is not None and len(hrv_hist) >= 7:
        mean, sd = sum(hrv_hist) / len(hrv_hist), _std(hrv_hist)
        if sd:
            z = (latest["hrv"] - mean) / sd
            pts = max(0, min(30, -z * 15))  # low HRV vs baseline is bad
            if pts > 3:
                factors.append({"factor": "HRV below baseline", "points": round(pts)})
            score += pts

    rhr_hist = [r["resting_hr"] for r in history if r["resting_hr"] is not None]
    if latest["resting_hr"] is not None and len(rhr_hist) >= 7:
        mean, sd = sum(rhr_hist) / len(rhr_hist), _std(rhr_hist)
        if sd:
            z = (latest["resting_hr"] - mean) / sd
            pts = max(0, min(20, z * 10))  # elevated resting HR is bad
            if pts > 3:
                factors.append({"factor": "Resting HR elevated", "points": round(pts)})
            score += pts

    debt = sleep_debt(db, days=7)
    if debt["nights_tracked"] >= 4 and debt["debt_hours"] > 0:
        pts = max(0, min(25, debt["debt_hours"] * 2.5))
        if pts > 3:
            factors.append({"factor": "Sleep debt", "points": round(pts)})
        score += pts

    load = training_load_ratio(db)
    if load and load["ratio"] > 1.3:
        pts = max(0, min(25, (load["ratio"] - 1.3) * 50))
        if pts > 3:
            factors.append({"factor": "Training load spike (ACWR)", "points": round(pts)})
        score += pts

    score = round(min(100, score))
    label = "Low risk" if score < 25 else "Moderate risk" if score < 50 else "Elevated risk" if score < 75 else "High risk"
    return {"score": score, "label": label, "factors": sorted(factors, key=lambda f: -f["points"])}


def training_stress_balance(db: Session, days: int = 180) -> list[dict]:
    """Banister impulse-response model (the same math behind TrainingPeaks'
    Performance Management Chart): daily training load exponentially decayed
    into Fitness (CTL, 42-day time constant), Fatigue (ATL, 7-day time
    constant), and Form (TSB = CTL - ATL). Positive form means you're fresh
    and ready for a hard effort or a race; deeply negative form for weeks is
    the classic overtraining signature — a single number that actually
    integrates the whole training history instead of just this week's ACWR."""
    lookback = days + 60  # extra history so day-1's EWMA isn't starting from zero
    start = date.today() - timedelta(days=lookback)
    acts = db.execute(select(Activity).where(Activity.date >= start)).scalars().all()
    wkos = db.execute(select(Workout).where(Workout.date >= start)).scalars().all()

    daily_load: dict = defaultdict(float)
    for a in acts:
        if a.date:
            daily_load[a.date] += (a.distance_m or 0) / 1000 * 10
    for w in wkos:
        if w.date:
            daily_load[w.date] += (w.volume_kg or 0) / 100

    if not daily_load:
        return []

    first_day = min(daily_load.keys())
    total_days = (date.today() - first_day).days + 1
    ctl_alpha, atl_alpha = 2 / 43, 2 / 8
    ctl = atl = 0.0
    series = []
    for i in range(total_days):
        d = first_day + timedelta(days=i)
        load = daily_load.get(d, 0.0)
        ctl = load * ctl_alpha + ctl * (1 - ctl_alpha)
        atl = load * atl_alpha + atl * (1 - atl_alpha)
        if d >= date.today() - timedelta(days=days):
            series.append({
                "date": d.isoformat(), "load": round(load, 1),
                "fitness": round(ctl, 1), "fatigue": round(atl, 1), "form": round(ctl - atl, 1),
            })
    return series


def training_load_ratio(db: Session) -> dict | None:
    """Acute:chronic workload ratio (7-day load ÷ 28-day-average-as-a-week) — the
    standard sports-science injury-risk heuristic. >1.5 means recent load has
    spiked well past what the body's adapted to; <0.8 means detraining."""
    start = date.today() - timedelta(days=28)
    acts = db.execute(select(Activity).where(Activity.date >= start)).scalars().all()
    wkos = db.execute(select(Workout).where(Workout.date >= start)).scalars().all()

    def _load_for(d0: date, d1: date) -> float:
        # A simple composite: running distance (km) weighted like a light session,
        # plus strength volume scaled down to a comparable magnitude.
        load = 0.0
        for a in acts:
            if a.date and d0 <= a.date <= d1:
                load += (a.distance_m or 0) / 1000 * 10
        for w in wkos:
            if w.date and d0 <= w.date <= d1:
                load += (w.volume_kg or 0) / 100
        return load

    today = date.today()
    acute = _load_for(today - timedelta(days=6), today)
    chronic_total = _load_for(today - timedelta(days=27), today)
    chronic_weekly_avg = chronic_total / 4
    if chronic_weekly_avg <= 0:
        return None
    ratio = round(acute / chronic_weekly_avg, 2)
    if ratio < 0.8:
        zone = "undertraining"
    elif ratio <= 1.3:
        zone = "sweet_spot"
    elif ratio <= 1.5:
        zone = "caution"
    else:
        zone = "high_risk"
    return {
        "acute_7d": round(acute, 0),
        "chronic_28d_weekly_avg": round(chronic_weekly_avg, 0),
        "ratio": ratio,
        "zone": zone,
    }
