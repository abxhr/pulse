"""Export the user's own logged data (meals, weigh-ins, activities, workouts)
independent of the raw SQLite file - for backup or external analysis."""
from __future__ import annotations
import csv
import io

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Meal, BodyWeight, Activity, Workout


def full_export(db: Session) -> dict:
    meals = db.execute(select(Meal)).scalars().all()
    weights = db.execute(select(BodyWeight)).scalars().all()
    acts = db.execute(select(Activity)).scalars().all()
    wkos = db.execute(select(Workout)).scalars().all()
    return {
        "meals": [
            {"id": m.id, "date": m.date.isoformat(), "time": m.time.isoformat() if m.time else None,
             "meal_type": m.meal_type, "name": m.name, "calories": m.calories, "protein_g": m.protein_g,
             "carbs_g": m.carbs_g, "fat_g": m.fat_g, "fiber_g": m.fiber_g, "satiety": m.satiety, "notes": m.notes}
            for m in meals
        ],
        "weights": [
            {"date": w.date.isoformat(), "weight_kg": w.weight_kg, "body_fat_pct": w.body_fat_pct,
             "source": w.source, "notes": w.notes}
            for w in weights
        ],
        "activities": [
            {"id": a.id, "date": a.date.isoformat() if a.date else None, "type": a.activity_type,
             "name": a.name, "distance_m": a.distance_m, "duration_s": a.duration_s,
             "avg_hr": a.avg_hr, "avg_pace_s_per_km": a.avg_pace_s_per_km, "calories": a.calories}
            for a in acts
        ],
        "workouts": [
            {"id": w.id, "date": w.date.isoformat() if w.date else None, "title": w.title,
             "duration_s": w.duration_s, "volume_kg": w.volume_kg, "set_count": w.set_count}
            for w in wkos
        ],
    }


_CSV_TABLES = {"meals", "weights", "activities", "workouts"}


def csv_export(db: Session, table: str) -> str:
    if table not in _CSV_TABLES:
        raise ValueError(f"unknown table: {table}")
    rows = full_export(db)[table]
    buf = io.StringIO()
    if rows:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return buf.getvalue()
