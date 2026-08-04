"""Body weight tracking + cut/bulk goal planning.

Macro recommendations combine two things:
1. A deterministic TDEE estimate from actual energy balance — your logged calories
   vs. your real weight change (the only estimate that's actually calibrated to
   *your* body, rather than a population formula) — falling back to Garmin's own
   burned-calories estimate when there isn't enough weight+nutrition history yet.
2. A simple least-squares fit on the weight trend to project when you'll hit
   the goal at the current rate.
The AI narrative (services/insights.py) explains and contextualizes these numbers;
it doesn't invent the math.
"""
from __future__ import annotations
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import BodyWeight, CutGoal, Meal, DailyHealth

KCAL_PER_KG_FAT = 7700
MIN_DAYS_FOR_ENERGY_BALANCE = 10


def add_weight(db: Session, d: date, weight_kg: float, body_fat_pct: float | None = None,
                notes: str | None = None, source: str = "manual") -> dict:
    row = db.get(BodyWeight, d)
    if row is None:
        row = BodyWeight(date=d, weight_kg=weight_kg, body_fat_pct=body_fat_pct, notes=notes, source=source)
        db.add(row)
    else:
        row.weight_kg = weight_kg
        row.body_fat_pct = body_fat_pct
        row.notes = notes
        row.source = source
    db.commit()
    return _serialize(row)


def _serialize(r: BodyWeight) -> dict:
    return {
        "date": r.date.isoformat(), "weight_kg": r.weight_kg,
        "body_fat_pct": r.body_fat_pct, "source": r.source, "notes": r.notes,
    }


def delete_weight(db: Session, d: date) -> bool:
    row = db.get(BodyWeight, d)
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def trend(db: Session, days: int = 90) -> list[dict]:
    start = date.today() - timedelta(days=days)
    rows = db.execute(
        select(BodyWeight).where(BodyWeight.date >= start).order_by(BodyWeight.date)
    ).scalars().all()
    out = [_serialize(r) for r in rows]

    # A raw day-to-day weight line is dominated by water/food/sodium noise (1-2kg
    # swings are normal) and makes the trend illegible. Add a 7-day-equivalent EMA
    # (alpha = 2/(7+1)) alongside the raw points so the UI can plot a smoothed line
    # without hiding the actual logged values.
    alpha = 2 / (7 + 1)
    ema = None
    for r in out:
        ema = r["weight_kg"] if ema is None else alpha * r["weight_kg"] + (1 - alpha) * ema
        r["trend_kg"] = round(ema, 2)
    return out


def get_goal(db: Session) -> dict | None:
    g = db.get(CutGoal, 1)
    if not g:
        return None
    return {
        "start_date": g.start_date.isoformat() if g.start_date else None,
        "start_weight_kg": g.start_weight_kg, "target_weight_kg": g.target_weight_kg,
        "weekly_rate_kg": g.weekly_rate_kg, "active": g.active,
    }


def set_goal(db: Session, data: dict) -> dict:
    g = db.get(CutGoal, 1)
    if not g:
        g = CutGoal(id=1)
        db.add(g)
    if data.get("start_weight_kg") is not None:
        g.start_weight_kg = data["start_weight_kg"]
    if data.get("target_weight_kg") is not None:
        g.target_weight_kg = data["target_weight_kg"]
    if data.get("weekly_rate_kg") is not None:
        g.weekly_rate_kg = data["weekly_rate_kg"]
    if not g.start_date:
        g.start_date = date.today()
    g.active = data.get("active", True)
    db.commit()
    return get_goal(db)


def _linreg(points: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Least-squares slope+intercept for [(x, y), ...]. No numpy needed for ~30 points."""
    n = len(points)
    if n < 2:
        return None
    sx = sum(p[0] for p in points)
    sy = sum(p[1] for p in points)
    sxx = sum(p[0] ** 2 for p in points)
    sxy = sum(p[0] * p[1] for p in points)
    denom = n * sxx - sx ** 2
    if denom == 0:
        return None
    slope = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    return slope, intercept


def weight_projection(db: Session, days: int = 28) -> dict | None:
    """Fit a trend line over the recent weigh-ins and project the rate + a goal ETA."""
    rows = trend(db, days)
    if len(rows) < 3:
        return None
    base = date.fromisoformat(rows[0]["date"])
    points = [((date.fromisoformat(r["date"]) - base).days, r["weight_kg"]) for r in rows]
    fit = _linreg(points)
    if not fit:
        return None
    slope, intercept = fit  # kg per day
    today_x = (date.today() - base).days
    current_est = slope * today_x + intercept
    weekly_rate_kg = round(slope * 7, 2)

    goal = get_goal(db)
    eta = None
    if goal and goal.get("target_weight_kg") and abs(slope) > 1e-6:
        days_to_goal = (goal["target_weight_kg"] - current_est) / slope
        if days_to_goal > 0:
            eta = (date.today() + timedelta(days=round(days_to_goal))).isoformat()

    return {
        "weekly_rate_kg": weekly_rate_kg,
        "current_trend_weight_kg": round(current_est, 1),
        "eta_at_goal": eta,
    }


def _energy_balance_tdee(db: Session, days: int = 21) -> float | None:
    """TDEE from actual logged calories vs. actual weight change — the most
    personally-accurate estimate available, once there's enough history.
    Only ever looks at fully-completed days (never "today") — a partial day's
    calories keep changing as it goes, which made this recommendation visibly
    shift every time the page was opened."""
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=days)
    weights = db.execute(
        select(BodyWeight).where(BodyWeight.date >= start, BodyWeight.date <= end).order_by(BodyWeight.date)
    ).scalars().all()
    if len(weights) < 2:
        return None
    span_days = (weights[-1].date - weights[0].date).days
    if span_days < MIN_DAYS_FOR_ENERGY_BALANCE:
        return None
    weight_change_kg = weights[-1].weight_kg - weights[0].weight_kg

    meals = db.execute(
        select(Meal).where(Meal.date >= weights[0].date, Meal.date <= weights[-1].date)
    ).scalars().all()
    by_day: dict = {}
    for m in meals:
        by_day.setdefault(m.date, 0.0)
        by_day[m.date] += m.calories or 0
    logged_days = len(by_day)
    if logged_days < MIN_DAYS_FOR_ENERGY_BALANCE:
        return None  # not enough nutrition logging to trust this estimate
    avg_calories_in = sum(by_day.values()) / logged_days

    calories_out_total = avg_calories_in * span_days - weight_change_kg * KCAL_PER_KG_FAT
    return round(calories_out_total / span_days)


def _garmin_calories_tdee(db: Session, days: int = 14) -> float | None:
    """Fallback: Garmin's own total-calories-burned estimate, averaged over fully-
    completed days only (excludes today, which is still accumulating and would
    otherwise make this shift every time the page loads)."""
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=days)
    rows = db.execute(
        select(DailyHealth).where(
            DailyHealth.date >= start, DailyHealth.date <= end, DailyHealth.calories_total.isnot(None)
        )
    ).scalars().all()
    if not rows:
        return None
    return round(sum(r.calories_total for r in rows) / len(rows))


def _tdee_confidence(db: Session, tdee_source: str | None) -> dict:
    """How much data actually backs the current TDEE number — so the user can
    judge how much to trust it, and see it visibly firm up over time instead
    of just trusting an opaque figure."""
    if tdee_source == "energy_balance":
        end = date.today() - timedelta(days=1)
        start = end - timedelta(days=21)
        meals = db.execute(select(Meal).where(Meal.date >= start, Meal.date <= end)).scalars().all()
        logged_days = len({m.date for m in meals})
        target = 21
        label = "high" if logged_days >= target else "medium" if logged_days >= MIN_DAYS_FOR_ENERGY_BALANCE else "low"
        return {
            "method": "your logged calories + weight change — the most personally-accurate estimate",
            "logged_days": logged_days, "days_for_higher_confidence": max(0, target - logged_days),
            "confidence": label,
        }
    if tdee_source == "garmin_estimate":
        return {
            "method": "Garmin's burned-calories estimate — used until enough weight+nutrition history builds up",
            "logged_days": None, "days_for_higher_confidence": None, "confidence": "medium",
        }
    return {"method": None, "logged_days": None, "days_for_higher_confidence": None, "confidence": "none"}


def refeed_nudge(db: Session) -> dict | None:
    """Evidence-based cuts benefit from periodic maintenance weeks — nudges every
    ~6 weeks into a sustained cut, not a hard rule, just a reminder to consider it."""
    goal = get_goal(db)
    if not goal or not goal.get("start_date") or (goal.get("weekly_rate_kg") or 0) >= 0:
        return None
    weeks_in = (date.today() - date.fromisoformat(goal["start_date"])).days // 7
    if weeks_in < 6 or weeks_in % 6 != 0:
        return None
    return {
        "weeks_in": weeks_in,
        "message": f"You're {weeks_in} weeks into this cut — consider a maintenance/refeed week "
                   "to support training performance and adherence before continuing.",
    }


def macro_recommendation(db: Session) -> dict:
    weights = trend(db, 90)
    current_weight = weights[-1]["weight_kg"] if weights else None
    goal = get_goal(db)

    tdee = _energy_balance_tdee(db)
    tdee_source = "energy_balance" if tdee else None
    if not tdee:
        tdee = _garmin_calories_tdee(db)
        tdee_source = "garmin_estimate" if tdee else None

    if not tdee or not current_weight:
        return {
            "ready": False,
            "reason": "Log your weight daily and your meals for a couple of weeks — "
                      "need enough history to estimate your maintenance calories accurately.",
            "current_weight_kg": current_weight,
            "tdee_estimate": tdee,
            "tdee_source": tdee_source,
        }

    weekly_rate_kg = (goal or {}).get("weekly_rate_kg") or -0.4  # default: gentle sustainable cut
    daily_delta = round(weekly_rate_kg * KCAL_PER_KG_FAT / 7)
    target_calories = max(1200, round(tdee + daily_delta))  # floor for safety

    protein_g = round(current_weight * (2.0 if weekly_rate_kg < 0 else 1.8))
    fat_g = round((target_calories * 0.27) / 9)
    remaining = target_calories - protein_g * 4 - fat_g * 9
    carbs_g = max(0, round(remaining / 4))

    return {
        "ready": True,
        "current_weight_kg": current_weight,
        "tdee_estimate": tdee,
        "tdee_source": tdee_source,
        "weekly_rate_kg": weekly_rate_kg,
        "target_calories": target_calories,
        "protein_g": protein_g,
        "carbs_g": carbs_g,
        "fat_g": fat_g,
        "tdee_confidence": _tdee_confidence(db, tdee_source),
        "refeed_nudge": refeed_nudge(db),
        "projection": weight_projection(db),
    }
