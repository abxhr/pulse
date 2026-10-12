"""Nutrition tracking: manual meal entries, daily macro totals vs a target goal."""
from __future__ import annotations
from datetime import date, datetime, timedelta

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..models import Meal, NutritionGoal, NutritionDayStatus

MEAL_TYPES = {"breakfast", "lunch", "dinner", "snack"}


def get_goal(db: Session) -> dict:
    goal = db.get(NutritionGoal, 1)
    if not goal:
        return {"calories": None, "protein_g": None, "carbs_g": None, "fat_g": None, "fiber_g": None}
    return {
        "calories": goal.calories, "protein_g": goal.protein_g,
        "carbs_g": goal.carbs_g, "fat_g": goal.fat_g, "fiber_g": goal.fiber_g,
    }


def set_goal(db: Session, data: dict) -> dict:
    goal = db.get(NutritionGoal, 1)
    if not goal:
        goal = NutritionGoal(id=1)
        db.add(goal)
    for k in ("calories", "protein_g", "carbs_g", "fat_g", "fiber_g"):
        if k in data and data[k] is not None:
            setattr(goal, k, data[k])
    goal.updated_at = datetime.utcnow()
    db.commit()
    return get_goal(db)


def _serialize(m: Meal) -> dict:
    return {
        "id": m.id, "date": m.date.isoformat() if m.date else None,
        "time": m.time.isoformat() if m.time else None,
        "meal_type": m.meal_type, "name": m.name,
        "calories": m.calories, "protein_g": m.protein_g,
        "carbs_g": m.carbs_g, "fat_g": m.fat_g, "fiber_g": m.fiber_g,
        "notes": m.notes, "satiety": m.satiety,
    }


def add_meal(db: Session, data: dict) -> dict:
    d = data.get("date")
    if isinstance(d, str):
        d = date.fromisoformat(d)
    elif d is None:
        d = date.today()
    t = data.get("time")
    if isinstance(t, str):
        t = datetime.fromisoformat(t)
    elif t is None:
        t = datetime.utcnow()
    meal_type = data.get("meal_type")
    if meal_type and meal_type not in MEAL_TYPES:
        meal_type = None
    meal = Meal(
        date=d, time=t, meal_type=meal_type, name=data.get("name") or "Meal",
        calories=data.get("calories"), protein_g=data.get("protein_g"),
        carbs_g=data.get("carbs_g"), fat_g=data.get("fat_g"),
        fiber_g=data.get("fiber_g"), notes=data.get("notes"),
        satiety=data.get("satiety"),
    )
    db.add(meal)
    _mark_incomplete(db, d)
    db.commit()
    db.refresh(meal)
    return _serialize(meal)


def update_meal(db: Session, meal_id: int, data: dict) -> dict | None:
    meal = db.get(Meal, meal_id)
    if not meal:
        return None
    for field in ("name", "calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "notes", "satiety"):
        if field in data:
            setattr(meal, field, data[field])
    if "meal_type" in data and (data["meal_type"] in MEAL_TYPES or data["meal_type"] is None):
        meal.meal_type = data["meal_type"]
    _mark_incomplete(db, meal.date)
    db.commit()
    return _serialize(meal)


def delete_meal(db: Session, meal_id: int) -> bool:
    meal = db.get(Meal, meal_id)
    if not meal:
        return False
    _mark_incomplete(db, meal.date)
    db.delete(meal)
    db.commit()
    return True


def meals_for_date(db: Session, d: date) -> list[dict]:
    rows = db.execute(
        select(Meal).where(Meal.date == d).order_by(Meal.time.asc())
    ).scalars().all()
    return [_serialize(m) for m in rows]


def _totals(meals: list[dict]) -> dict:
    totals = {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0, "fiber_g": 0.0}
    for m in meals:
        for k in totals:
            totals[k] += m.get(k) or 0
    return {k: round(v, 1) for k, v in totals.items()}


def day_summary(db: Session, d: date) -> dict:
    meals = meals_for_date(db, d)
    status = db.get(NutritionDayStatus, d)
    return {
        "date": d.isoformat(), "meals": meals,
        "totals": _totals(meals), "goal": get_goal(db),
        "complete": bool(status and status.complete), "has_entries": bool(meals),
    }


def _mark_incomplete(db: Session, d: date) -> None:
    status = db.get(NutritionDayStatus, d)
    if status:
        status.complete = False
        status.updated_at = datetime.utcnow()


def set_day_complete(db: Session, d: date, complete: bool) -> dict:
    if complete and not db.scalar(select(func.count()).select_from(Meal).where(Meal.date == d)):
        raise ValueError("Log at least one meal before marking the day complete")
    status = db.get(NutritionDayStatus, d)
    if not status:
        status = NutritionDayStatus(date=d)
        db.add(status)
    status.complete, status.updated_at = complete, datetime.utcnow()
    db.commit()
    return day_summary(db, d)


def favorite_meals(db: Session, days: int = 30, limit: int = 8) -> list[dict]:
    """Most-repeated meal names recently - "I eat the same breakfast every day"
    deserves a one-tap re-log, distinct from the full structured Recipe flow."""
    start = date.today() - timedelta(days=days)
    rows = db.execute(
        select(Meal).where(Meal.date >= start).order_by(Meal.time.desc())
    ).scalars().all()
    by_name: dict[str, dict] = {}
    for m in rows:
        key = m.name.strip().lower()
        if key not in by_name:
            by_name[key] = {"name": m.name, "count": 0, "last": _serialize(m)}
        by_name[key]["count"] += 1
    return sorted(by_name.values(), key=lambda x: -x["count"])[:limit]


def days_on_target_streak(db: Session) -> dict:
    """Consecutive days hitting the calorie target (within 10%) with protein at
    or above goal - gamifies adherence instead of just showing raw numbers."""
    goal = get_goal(db)
    if not goal.get("calories"):
        return {"streak": 0, "goal_set": False}
    trend_rows = trend(db, days=60)
    streak = 0
    for row in reversed(trend_rows):
        d = date.fromisoformat(row["date"])
        if d >= date.today():
            continue  # skip today - still accumulating
        totals = row["totals"]
        if not totals.get("calories"):
            break  # no log that day breaks the streak
        cal_ok = abs(totals["calories"] - goal["calories"]) <= goal["calories"] * 0.1
        protein_ok = not goal.get("protein_g") or totals.get("protein_g", 0) >= goal["protein_g"] * 0.9
        if cal_ok and protein_ok:
            streak += 1
        else:
            break
    return {"streak": streak, "goal_set": True}


def protein_timing(db: Session, d: date) -> list[dict]:
    """Protein logged per meal across the day - distribution matters for muscle
    retention during a cut, not just the daily total."""
    meals = meals_for_date(db, d)
    return [
        {"time": m["time"], "name": m["name"], "meal_type": m["meal_type"], "protein_g": m["protein_g"] or 0}
        for m in meals if m["protein_g"]
    ]


def trend(db: Session, days: int = 14) -> list[dict]:
    today = date.today()
    start = today - timedelta(days=days - 1)
    rows = db.execute(
        select(Meal).where(Meal.date >= start).order_by(Meal.date.asc())
    ).scalars().all()
    by_day: dict[date, list[dict]] = {}
    for m in rows:
        by_day.setdefault(m.date, []).append(_serialize(m))
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        status = db.get(NutritionDayStatus, d)
        meals = by_day.get(d, [])
        out.append({"date": d.isoformat(), "totals": _totals(meals), "has_entries": bool(meals),
                    "complete": bool(status and status.complete)})
    return out
