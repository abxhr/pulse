"""Saved recipes: CRUD + turning a saved recipe into a logged meal."""
from __future__ import annotations
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Recipe
from . import nutrition


def _serialize(r: Recipe) -> dict:
    return {
        "id": r.id, "name": r.name, "servings": r.servings,
        "ingredients": (r.ingredients or "").split("\n") if r.ingredients else [],
        "instructions": r.instructions,
        "calories": r.calories, "protein_g": r.protein_g, "carbs_g": r.carbs_g,
        "fat_g": r.fat_g, "fiber_g": r.fiber_g,
        "source_type": r.source_type, "source_url": r.source_url, "notes": r.notes,
        "created_at": r.created_at.isoformat(),
    }


def list_recipes(db: Session) -> list[dict]:
    rows = db.execute(select(Recipe).order_by(Recipe.created_at.desc())).scalars().all()
    return [_serialize(r) for r in rows]


def save_recipe(db: Session, data: dict) -> dict:
    ingredients = data.get("ingredients")
    if isinstance(ingredients, list):
        ingredients = "\n".join(ingredients)
    r = Recipe(
        name=data.get("name") or "Recipe",
        servings=data.get("servings") or 1,
        ingredients=ingredients,
        instructions=data.get("instructions"),
        calories=data.get("calories"), protein_g=data.get("protein_g"),
        carbs_g=data.get("carbs_g"), fat_g=data.get("fat_g"), fiber_g=data.get("fiber_g"),
        source_type=data.get("source_type"), source_url=data.get("source_url"),
        notes=data.get("notes"),
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _serialize(r)


def delete_recipe(db: Session, recipe_id: int) -> bool:
    r = db.get(Recipe, recipe_id)
    if not r:
        return False
    db.delete(r)
    db.commit()
    return True


def log_recipe_as_meal(db: Session, recipe_id: int, servings_eaten: float = 1, meal_type: str | None = None) -> dict | None:
    r = db.get(Recipe, recipe_id)
    if not r:
        return None
    mult = servings_eaten
    return nutrition.add_meal(db, {
        "name": r.name,
        "meal_type": meal_type,
        "calories": round((r.calories or 0) * mult, 1),
        "protein_g": round((r.protein_g or 0) * mult, 1),
        "carbs_g": round((r.carbs_g or 0) * mult, 1),
        "fat_g": round((r.fat_g or 0) * mult, 1),
        "fiber_g": round((r.fiber_g or 0) * mult, 1),
        "notes": f"from recipe: {r.name}" + (f" ({servings_eaten}x serving)" if servings_eaten != 1 else ""),
    })
