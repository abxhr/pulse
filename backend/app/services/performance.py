"""Recovery, Day Strain and Sleep Performance, derived from Garmin data.

Same ideas as Whoop's core loop, computed from what Garmin already syncs:
  * Recovery 0-100: tonight's HRV, resting HR, respiration and sleep versus
    YOUR own 28-day baselines (z-scores), not population norms.
  * Day Strain 0-21: a saturating (log-like) curve over heart-rate-zone load.
  * Sleep Need / Performance: baseline need + yesterday's strain + sleep debt.
  * Strain target: how hard today can be, given recovery.
Pure functions over plain rows so they are unit-testable; `load` does the I/O.
"""
from __future__ import annotations

import math
import statistics
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Activity, DailyHealth, Sleep

_ZONE_WEIGHTS = (1, 2, 3, 4, 5)
_STRAIN_K = 214.0  # 60 min in zone 2 -> strain ~9; 60 min in zone 4 -> ~14; ~600 pts -> ~20
_BASELINE_DAYS = 28
_MIN_BASELINE = 7


def strain_from_points(points: float) -> float:
    """Saturating map from zone-weighted minutes to the 0-21 Day Strain scale."""
    return round(21 * (1 - math.exp(-max(0.0, points) / _STRAIN_K)), 1)


def activity_points(raw: dict | None, duration_s: float | None) -> float:
    """Zone-weighted minutes for one activity; falls back to a light estimate
    when Garmin stored no per-zone times."""
    raw = raw or {}
    zones = [(raw.get(f"hrTimeInZone_{i}") or 0) / 60 for i in range(1, 6)]
    if any(zones):
        return sum(m * w for m, w in zip(zones, _ZONE_WEIGHTS))
    return (duration_s or 0) / 60 * 2


def _baseline(values: list[float], floor_sd: float) -> tuple[float, float] | None:
    vals = [v for v in values if v is not None]
    if len(vals) < _MIN_BASELINE:
        return None
    return statistics.fmean(vals), max(statistics.pstdev(vals), floor_sd)


def recovery_score(parts: dict) -> tuple[int, list[dict]] | None:
    """parts: {name: (today_value, baseline|None, higher_is_better, weight)}.
    Uses whichever components are present (HRV is required) and renormalises weights."""
    if parts.get("hrv", (None, None))[0] is None or parts["hrv"][1] is None:
        return None
    total_w = comp = 0.0
    factors = []
    for name, (val, base, higher_better, weight) in parts.items():
        if val is None or base is None:
            continue
        mean, sd = base
        z = (val - mean) / sd
        z = z if higher_better else -z
        z = max(-3.0, min(3.0, z))
        comp += z * weight
        total_w += weight
        factors.append({"factor": name, "z": round(z, 2), "value": round(val, 1), "baseline": round(mean, 1)})
    comp /= total_w
    score = round(100 / (1 + math.exp(-(1.1 * comp + 0.4))))  # an average day scores ~60
    return score, sorted(factors, key=lambda f: f["z"])


def recovery_band(score: int | None) -> str | None:
    if score is None:
        return None
    return "green" if score >= 67 else "yellow" if score >= 34 else "red"


_STRAIN_TARGET = {"green": (14, 18), "yellow": (10, 14), "red": (0, 10)}


def strain_target(band: str | None) -> tuple[int, int] | None:
    return _STRAIN_TARGET.get(band)


def sleep_need_h(baseline_h: float, prev_strain: float | None, debt_h: float) -> float:
    """Hours needed tonight: baseline + up to +1h after a max-strain day + 25% of recent debt (<=1h)."""
    return round(baseline_h + min(1.0, (prev_strain or 0) / 21) + min(1.0, max(0.0, debt_h) * 0.25), 2)


def compute_series(health: dict, sleep: dict, acts: list, end: date, days: int, base_need_h: float) -> list[dict]:
    """health/sleep: {date: row}; acts: Activity-like rows. One dict per day, oldest first."""
    strain_by_day: dict[date, float] = {}
    pts_by_day: dict[date, float] = {}
    for a in acts:
        pts_by_day[a.date] = pts_by_day.get(a.date, 0.0) + activity_points(a.raw, a.duration_s)
    for d, p in pts_by_day.items():
        strain_by_day[d] = strain_from_points(p)

    out = []
    for i in range(days - 1, -1, -1):
        d = end - timedelta(days=i)
        prior = [d - timedelta(days=k) for k in range(1, _BASELINE_DAYS + 1)]
        h, s = health.get(d), sleep.get(d)

        def hist(get):
            return [get(health.get(p), sleep.get(p)) for p in prior]

        hrv = (h.hrv_last_night if h else None) or (s.hrv_avg if s else None)
        rhr = (h.resting_hr if h else None) or (s.resting_hr if s else None)
        resp = (s.avg_respiration if s else None) or (h.avg_respiration if h else None)
        slept_h = (s.total_seconds / 3600) if s and s.total_seconds else None

        # sleep need for the night ending today: yesterday's strain + 7-night debt
        recent = [sleep.get(d - timedelta(days=k)) for k in range(1, 8)]
        debt = sum(max(0.0, base_need_h - r.total_seconds / 3600) for r in recent if r and r.total_seconds)
        need = sleep_need_h(base_need_h, strain_by_day.get(d - timedelta(days=1)), debt)
        perf = round(min(1.0, slept_h / need) * 100) if slept_h else None

        parts = {
            "hrv": (hrv, _baseline(hist(lambda hh, ss: (hh.hrv_last_night if hh else None) or (ss.hrv_avg if ss else None)), 4.0), True, 0.5),
            "resting_hr": (rhr, _baseline(hist(lambda hh, ss: (hh.resting_hr if hh else None) or (ss.resting_hr if ss else None)), 1.5), False, 0.2),
            "respiration": (resp, _baseline(hist(lambda hh, ss: (ss.avg_respiration if ss else None)), 0.5), False, 0.1),
            "sleep": (perf, (85.0, 10.0), True, 0.2),  # performance %, judged against a typical 85 +/- 10
        }
        rec = recovery_score(parts)
        score, factors = rec if rec else (None, [])
        band = recovery_band(score)
        tgt = strain_target(band)
        out.append({
            "date": d.isoformat(), "recovery": score, "band": band, "factors": factors,
            "strain": strain_by_day.get(d, 0.0 if h else None), "strain_target": list(tgt) if tgt else None,
            "slept_h": round(slept_h, 2) if slept_h else None, "sleep_need_h": need, "sleep_performance": perf,
        })
    return out


def load(db: Session, days: int = 30) -> dict:
    from .analytics import personalized_sleep_target  # local: avoids an import cycle

    end = date.today()
    start = end - timedelta(days=days + _BASELINE_DAYS + 1)
    health = {r.date: r for r in db.execute(select(DailyHealth).where(DailyHealth.date >= start)).scalars()}
    sleep = {r.date: r for r in db.execute(select(Sleep).where(Sleep.date >= start)).scalars()}
    acts = db.execute(select(Activity).where(Activity.date >= start - timedelta(days=1))).scalars().all()
    base = personalized_sleep_target(db) or 8.0
    series = compute_series(health, sleep, acts, end, days, base)
    # tonight's need: baseline + today's strain + the last 7 nights' shortfall
    last7 = [sleep.get(end - timedelta(days=k)) for k in range(0, 7)]
    debt = sum(max(0.0, base - r.total_seconds / 3600) for r in last7 if r and r.total_seconds)
    today_strain = series[-1]["strain"] if series else None
    tonight = {"need_h": sleep_need_h(base, today_strain, debt), "base_h": round(base, 2),
               "strain_h": round(min(1.0, (today_strain or 0) / 21), 2), "debt_h": round(min(1.0, debt * 0.25), 2)}
    # today's recovery is unknown until Garmin has last night's HRV: fall back to the latest scored day
    scored = [r for r in series if r["recovery"] is not None]
    return {"today": series[-1] if series else None, "latest_scored": scored[-1] if scored else None,
            "tonight": tonight, "series": series}
