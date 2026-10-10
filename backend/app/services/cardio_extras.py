"""Race goals, shoe mileage tracking, training-load overload warnings, and
repeat-route detection for the Cardio page."""
from __future__ import annotations
from datetime import date, timedelta
from collections import defaultdict
from types import SimpleNamespace

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import RaceGoal, Shoe, Activity
from .analytics import training_load

_RACE_LABELS = {"5k": "5K", "10k": "10K", "half_marathon": "Half Marathon", "marathon": "Marathon"}


def _serialize_race(g: RaceGoal) -> dict:
    return {
        "id": g.id, "name": g.name, "race_date": g.race_date.isoformat(),
        "distance_type": g.distance_type, "distance_label": _RACE_LABELS.get(g.distance_type, g.distance_type),
        "target_time_s": g.target_time_s,
    }


def get_active_race(db: Session) -> dict | None:
    g = db.execute(select(RaceGoal).where(RaceGoal.active.is_(True)).order_by(RaceGoal.race_date)).scalars().first()
    return _serialize_race(g) if g else None


def set_race_goal(db: Session, name: str, race_date: date, distance_type: str, target_time_s: int | None) -> dict:
    db.execute(RaceGoal.__table__.update().values(active=False))
    g = RaceGoal(name=name, race_date=race_date, distance_type=distance_type, target_time_s=target_time_s, active=True)
    db.add(g)
    db.commit()
    return _serialize_race(g)


def clear_race_goal(db: Session) -> None:
    db.execute(RaceGoal.__table__.update().values(active=False))
    db.commit()


def taper_plan(db: Session) -> dict | None:
    """Days-to-race badge + a standard 3-week taper (progressively cutting weekly
    volume vs. your recent peak) once inside the taper window."""
    race = get_active_race(db)
    if not race:
        return None
    race_date = date.fromisoformat(race["race_date"])
    days_left = (race_date - date.today()).days
    if days_left < 0:
        return None

    load = training_load(db, weeks=8)
    recent_km = [w["run_km"] for w in load[-6:-1] if w["run_km"]] or [w["run_km"] for w in load if w["run_km"]]
    peak_km = max(recent_km) if recent_km else 0

    weeks_out = days_left // 7
    taper_pct = None
    if weeks_out <= 0:
        taper_pct = 0.35  # race week
    elif weeks_out == 1:
        taper_pct = 0.6
    elif weeks_out == 2:
        taper_pct = 0.8

    return {
        **race,
        "days_left": days_left,
        "in_taper": taper_pct is not None,
        "peak_weekly_km": round(peak_km, 1),
        "target_weekly_km": round(peak_km * taper_pct, 1) if taper_pct else None,
        "taper_pct": taper_pct,
    }


def overload_warnings(db: Session, weeks: int = 8) -> list[dict]:
    """Flags weeks where run volume jumped >10% over the prior week - the
    classic acute-overuse-injury threshold from running literature."""
    load = training_load(db, weeks=weeks)
    out = []
    for i in range(1, len(load)):
        prev, cur = load[i - 1]["run_km"], load[i]["run_km"]
        if prev and cur and prev >= 10:
            pct = (cur - prev) / prev * 100
            if pct > 10:
                out.append({
                    "week": load[i]["week"], "prev_km": prev, "current_km": cur,
                    "pct_increase": round(pct, 1),
                    "kind": "volume_jump",
                })
        elif cur >= 8 and prev < 3:
            out.append({"week": load[i]["week"], "prev_km": prev, "current_km": cur,
                        "pct_increase": None, "kind": "return_after_gap"})
    return out


def _route_key(lat: float, lon: float) -> tuple[float, float]:
    # ~111m grid at the equator - coarse enough to cluster the "same loop"
    # despite GPS jitter, fine enough not to merge genuinely different routes.
    return (round(lat, 3), round(lon, 3))


def repeat_routes(db: Session, min_runs: int = 3) -> list[dict]:
    rows = db.execute(
        select(Activity.date, Activity.distance_m, Activity.avg_pace_s_per_km,
               Activity.raw["startLatitude"].as_float(), Activity.raw["startLongitude"].as_float())
        .where(Activity.distance_m > 500, Activity.avg_pace_s_per_km.isnot(None))
    ).all()
    groups: dict = defaultdict(list)
    for day, dist, pace, lat, lon in rows:
        if lat is None or lon is None:
            continue
        groups[_route_key(lat, lon)].append(SimpleNamespace(date=day, distance_m=dist, avg_pace_s_per_km=pace))

    out = []
    for key, runs in groups.items():
        if len(runs) < min_runs:
            continue
        # keep runs within 15% of the group's median distance - same starting
        # point doesn't guarantee the same loop length
        dists = sorted(a.distance_m for a in runs)
        median = dists[len(dists) // 2]
        same_loop = [a for a in runs if abs(a.distance_m - median) / median < 0.15]
        if len(same_loop) < min_runs:
            continue
        best = min(same_loop, key=lambda a: a.avg_pace_s_per_km)
        avg_pace = sum(a.avg_pace_s_per_km for a in same_loop) / len(same_loop)
        out.append({
            "runs": len(same_loop),
            "distance_km": round(median / 1000, 2),
            "best_pace_s_per_km": round(best.avg_pace_s_per_km),
            "best_date": best.date.isoformat() if best.date else None,
            "avg_pace_s_per_km": round(avg_pace),
            "last_run_date": max((a.date for a in same_loop if a.date), default=None),
        })
    out.sort(key=lambda r: -r["runs"])
    return [{**r, "last_run_date": r["last_run_date"].isoformat() if r["last_run_date"] else None} for r in out[:10]]


def _serialize_shoe(s: Shoe, total_km: float) -> dict:
    return {
        "id": s.id, "name": s.name, "start_date": s.start_date.isoformat(),
        "target_km": s.target_km, "retired": s.retired,
        "total_km": round(total_km, 1),
        "pct_used": round(min(100, total_km / s.target_km * 100), 1) if s.target_km else None,
    }


def list_shoes(db: Session) -> list[dict]:
    shoes = db.execute(select(Shoe).order_by(Shoe.retired, Shoe.start_date.desc())).scalars().all()
    totals = dict(db.execute(
        select(Activity.shoe_id, func.coalesce(func.sum(Activity.distance_m), 0.0))
        .where(Activity.shoe_id.isnot(None)).group_by(Activity.shoe_id)
    ).all())
    return [_serialize_shoe(s, totals.get(s.id, 0.0) / 1000) for s in shoes]


def add_shoe(db: Session, name: str, start_date: date, target_km: float) -> dict:
    s = Shoe(name=name, start_date=start_date, target_km=target_km)
    db.add(s)
    db.commit()
    return _serialize_shoe(s, 0.0)


def retire_shoe(db: Session, shoe_id: int) -> bool:
    s = db.get(Shoe, shoe_id)
    if not s:
        return False
    s.retired = True
    db.commit()
    return True


def assign_shoe(db: Session, activity_id: str, shoe_id: int | None) -> bool:
    a = db.get(Activity, activity_id)
    if not a:
        return False
    a.shoe_id = shoe_id
    db.commit()
    return True
