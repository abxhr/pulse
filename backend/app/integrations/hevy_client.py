"""Hevy API integration (https://api.hevyapp.com). Requires Hevy Pro + API key
from https://hevy.com/settings?developer. Auth via the `api-key` header."""
from __future__ import annotations
from datetime import date
from typing import Any, Iterator
import logging
import requests

from ..config import settings

log = logging.getLogger("pulse.hevy")


class HevyUnavailable(RuntimeError):
    pass


def _headers() -> dict:
    if not settings.hevy_api_key:
        raise HevyUnavailable("HEVY_API_KEY not set in .env")
    return {"api-key": settings.hevy_api_key, "Accept": "application/json"}


def _get(path: str, params: dict | None = None) -> dict:
    url = f"{settings.hevy_base_url}{path}"
    r = requests.get(url, headers=_headers(), params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def iter_workouts(page_size: int = 10) -> Iterator[dict]:
    """Paginate through all workouts (newest first)."""
    page = 1
    while True:
        data = _get("/v1/workouts", {"page": page, "pageSize": page_size})
        workouts = data.get("workouts", [])
        for w in workouts:
            yield w
        page_count = data.get("page_count", page)
        if page >= page_count or not workouts:
            break
        page += 1


def normalize_workout(w: dict) -> dict:
    """Flatten a Hevy workout into our schema."""
    from dateutil import parser
    start = w.get("start_time")
    end = w.get("end_time")
    start_dt = parser.parse(start) if start else None
    end_dt = parser.parse(end) if end else None

    exercises = []
    volume = 0.0
    set_count = 0
    for ex in w.get("exercises", []):
        sets = []
        for s in ex.get("sets", []):
            wt = s.get("weight_kg") or 0
            reps = s.get("reps") or 0
            volume += (wt or 0) * (reps or 0)
            set_count += 1
            sets.append({
                "type": s.get("type"),
                "weight_kg": s.get("weight_kg"),
                "reps": s.get("reps"),
                "distance_m": s.get("distance_meters"),
                "duration_s": s.get("duration_seconds"),
                "rpe": s.get("rpe"),
            })
        exercises.append({
            "title": ex.get("title"),
            "muscle_group": ex.get("primary_muscle_group")
            or ex.get("muscle_group"),
            "equipment": ex.get("equipment"),
            "notes": ex.get("notes"),
            "sets": sets,
        })

    duration = None
    if start_dt and end_dt:
        duration = (end_dt - start_dt).total_seconds()

    return {
        "id": str(w.get("id")),
        "date": start_dt.date() if start_dt else None,
        "start_time": start_dt,
        "end_time": end_dt,
        "title": w.get("title"),
        "description": w.get("description"),
        "duration_s": duration,
        "volume_kg": round(volume, 1),
        "set_count": set_count,
        "exercise_count": len(exercises),
        "exercises": exercises,
        "source": "hevy",
        "raw": w,
    }


def workout_count() -> int | None:
    try:
        return _get("/v1/workouts/count").get("workout_count")
    except Exception as e:
        log.warning("workout_count failed: %s", e)
        return None
