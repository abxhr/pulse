"""Deterministic "will I be OK for the race?" engine. No LLM: the Coach narrates this, it never
invents it. Works from the active race goal, the last 12 weeks of runs, today's recovery call
and any injuries.

The core question is long-run coverage: how far can the longest run realistically grow before
the taper, compared with what a race of that distance needs?"""
from __future__ import annotations
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Activity
from . import analytics, cardio_extras, injury

LEVELS = ("underprepared", "stretch", "on_track", "ready")
LABELS = {"underprepared": "Not prepared to run it continuously", "stretch": "Stretch - finishable with a run/walk plan",
          "on_track": "On track", "ready": "Ready"}
_STEP = 1.15          # max growth of the long run per weekly step
_HORIZON_DAYS = 28    # how much of the bridge plan to spell out day by day
# ponytail: no cut-back weeks in the ladder; add one every 4th step if horizons beyond ~8 weeks matter.


def peak_target(dist_km: float) -> float:
    """Longest run a runner of this race normally wants in the bank before the taper."""
    return round(min(32.0, dist_km * 0.8), 1) if dist_km >= 15 else round(dist_km * 1.2, 1)


def project_ladder(longest_km: float, days_left: int, dist_km: float) -> dict:
    """Long runs that can still be fitted before the taper, growing <=15% per weekly step.
    Offsets are days from today; the last long run sits on the final day of the build."""
    target = peak_target(dist_km)
    taper = min(10 if dist_km >= 21 else 5, max(0, days_left) // 2)
    build_days = max(0, days_left - taper)
    offsets, o = [], build_days - 1
    while o >= 1:
        offsets.append(o)
        o -= 7
    prev, ladder = max(longest_km, 3.0), []
    for off in sorted(offsets):
        prev = min(prev * _STEP, target)
        ladder.append({"offset": off, "km": round(prev, 1)})
    peak = max([longest_km] + [s["km"] for s in ladder])
    return {"ladder": ladder, "taper_days": taper, "build_days": build_days, "target_km": target,
            "projected_peak_km": round(peak, 1), "ratio": round(peak / target, 2) if target else 1.0}


def verdict_for(ratio: float, lower_body_injury: bool = False) -> str:
    level = 3 if ratio >= 0.9 else 2 if ratio >= 0.7 else 1 if ratio >= 0.5 else 0
    if lower_body_injury: level = max(0, level - 1)
    return LEVELS[level]


def _runs(db: Session, since: date) -> list[Activity]:
    rows = db.execute(select(Activity).where(Activity.date >= since).order_by(Activity.date)).scalars().all()
    return [a for a in rows if "run" in (a.activity_type or "").lower() and (a.distance_m or 0) >= 1000]


def _weekly_km(runs: list[Activity], today: date, weeks: int = 6) -> list[dict]:
    monday = today - timedelta(days=today.weekday())
    out = []
    for i in range(weeks - 1, -1, -1):
        start = monday - timedelta(weeks=i)
        km = sum(a.distance_m for a in runs if start <= a.date < start + timedelta(days=7)) / 1000
        out.append({"week_start": start.isoformat(), "km": round(km, 1)})
    return out


def _bridge_plan(today: date, days_left: int, ladder: dict, dist_km: float, easy_km: float, ran_today: bool) -> list[dict]:
    longs = {s["offset"]: s["km"] for s in ladder["ladder"]}
    build_days, rows, last_run = ladder["build_days"], [], -9
    for o in range(0, min(days_left, _HORIZON_DAYS) + 1):
        d = (today + timedelta(days=o)).isoformat()
        if o == days_left:
            row = ("race", f"Race day: {dist_km:g} km", dist_km, "Start slower than feels necessary; walk through every aid point.")
        elif o in longs:
            row = ("run", f"Long run {longs[o]:g} km", longs[o], "Conversational pace. This is the last big run; do not extend it.")
            last_run = o
        elif o == 0 and ran_today:
            row = ("run", "Run done today", None, "Counts toward the week. Recover.")
        elif o == days_left - 1:
            row = ("rest", "Rest", None, "Easy walk and mobility only. Carb-load, hydrate, lay kit out.")
        elif o - 1 in longs:
            row = ("rest", "Rest or walk", None, "Absorb the long run.")
        elif o >= build_days:  # taper
            if (days_left - o) % 2 == 1 and days_left - o >= 3:
                row = ("run", f"Easy shakeout {min(4.0, easy_km):g} km", min(4.0, easy_km), "Relaxed, a few 20 s strides at most.")
                last_run = o
            else:
                row = ("rest", "Rest", None, "Taper: keep legs fresh.")
        elif o - last_run >= 2 and o + 1 not in longs:
            row = ("run", f"Easy run {easy_km:g} km", easy_km, "Zone 2, finish feeling you could do more.")
            last_run = o
        else:
            row = ("rest", "Rest", None, "")
        rows.append({"date": d, "offset": o, "kind": row[0], "title": row[1], "distance_km": row[2], "details": row[3]})
    return rows


def assess(db: Session, today: date | None = None) -> dict | None:
    today = today or date.today()
    race = cardio_extras.get_active_race(db)
    if not race: return None
    days_left = (date.fromisoformat(race["race_date"]) - today).days
    if days_left < 0: return None
    dist = race["distance_km"]

    runs = _runs(db, today - timedelta(days=84))
    runs6 = [a for a in runs if a.date >= today - timedelta(days=42)]
    longest6 = max([a.distance_m / 1000 for a in runs6] or [0.0])
    longest12 = max([a.distance_m / 1000 for a in runs] or [0.0])
    last_run = runs[-1].date if runs else None
    since_last = (today - last_run).days if last_run else None
    weekly = _weekly_km(runs, today)
    avg4 = round(sum(w["km"] for w in weekly[-5:-1]) / 4, 1)
    per_week = round(len(runs6) / 6, 1)

    # a long run more than 3 weeks old is not a long run you can build from
    base = longest6 if since_last is not None and since_last <= 21 else longest6 * 0.85
    ladder = project_ladder(base, days_left, dist)
    cons = injury.constraints(db)
    verdict = verdict_for(ladder["ratio"], cons["running_at_risk"])
    call = analytics.todays_call(db)

    easy_km = round(min(8.0, max(3.0, (avg4 / max(per_week, 2)) if avg4 else 4.0)), 1)
    plan = _bridge_plan(today, days_left, ladder, dist, easy_km, any(a.date == today for a in runs))

    flags = []
    if longest6 < dist * 0.5:
        flags.append(f"Longest run in 6 weeks is {longest6:.1f} km, {longest6 / dist * 100:.0f}% of the {dist:g} km distance.")
    if since_last is not None and since_last > 7:
        flags.append(f"Last run was {since_last} days ago.")
    if not runs:
        flags.append("No runs recorded in the last 12 weeks (check Garmin sync).")
    if days_left < 14 and ladder["ratio"] < 0.7:
        flags.append(f"Only {days_left} days left: fitness cannot be built now, only protected.")
    if cons["running_at_risk"]:
        flags.append("A lower-body injury is active, which puts the race itself at risk.")
    elif cons["avoid_upper_loading"]:
        flags.append("Upper-body injury: running is not restricted, but gym upper/grip work should stay out of the week.")
    if call["call"] in ("rest", "easy"):
        flags.append(f"Today's recovery call is '{call['call']}': {call['reasons'][0]}")

    est = None
    half = ((analytics.race_predictions(db) or {}).get("predictions") or {}).get("half_marathon")
    if half:
        scale = (dist / 21.0975) ** 1.06
        pad = {"ready": 0.0, "on_track": 0.05, "stretch": 0.15, "underprepared": 0.3}[verdict]
        est = {"low_s": round(half["low_seconds"] * scale * (1 + pad / 2)), "high_s": round(half["high_seconds"] * scale * (1 + pad)),
               "note": "VO2max-based estimate, widened for the undertrained long run." if pad else "VO2max-based estimate."}

    return {
        "race": race | {"days_left": days_left, "weeks_left": round(days_left / 7, 1)},
        "verdict": verdict, "label": LABELS[verdict],
        "headline": (f"Current longest run is {longest6:.1f} km (last 6 weeks). The best you can safely reach before race day is {ladder['projected_peak_km']:g} km; "
                     f"a {dist:g} km race normally wants ~{ladder['target_km']:g} km."),
        "facts": {"longest_6w_km": round(longest6, 1), "longest_12w_km": round(longest12, 1), "weekly_km_avg_4w": avg4,
                  "runs_per_week_6w": per_week, "last_run": last_run.isoformat() if last_run else None,
                  "days_since_last_run": since_last, "weekly_km": weekly, **{k: ladder[k] for k in ("target_km", "projected_peak_km", "taper_days")}},
        "todays_call": call, "injuries": cons["injuries"], "flags": flags,
        "estimated_finish": est, "bridge_plan": plan,
        "plan_horizon_days": min(days_left, _HORIZON_DAYS),
    }
