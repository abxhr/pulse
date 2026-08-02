"""Parse the free Hevy CSV export (Settings -> Export & Import Data -> Export Workouts).

The export has one row per set, with columns:
  title, start_time, end_time, description, exercise_title, superset_id,
  exercise_notes, set_index, set_type, weight_kg, reps, distance_km,
  duration_seconds, rpe

Rows are grouped into workouts -> exercises -> sets. The CSV has no workout id,
so we derive a stable one from title + start + end (safe for dedupe/upsert).

The CSV also has no muscle group, so we infer one from the exercise name with a
keyword classifier (below) — good enough to drive the per-muscle analytics.
"""
from __future__ import annotations
import csv
import hashlib
from datetime import datetime
from dateutil import parser as dtparser

# Ordered (first match wins). Specific phrases must precede generic ones,
# e.g. "leg curl" -> hamstrings before bare "curl" -> biceps.
_MUSCLE_RULES: list[tuple[tuple[str, ...], str]] = [
    (("treadmill", "running", "jog", "cycling", "spinning", "elliptical", "rowing machine", "stair"), "cardio"),
    (("plank", "crunch", "russian twist", "bicycle", "sit up", "sit-up", "hanging leg",
      "ab wheel", "woodchop", "oblique", "leg raise"), "core"),
    (("calf",), "calves"),
    (("leg curl", "hamstring", "romanian", "rdl", "good morning", "nordic"), "hamstrings"),
    (("squat", "leg press", "leg extension", "lunge", "hack", "step up", "split squat", "bulgarian"), "quadriceps"),
    (("hip thrust", "glute", "hip abduction", "hip adduction", "kickback machine"), "glutes"),
    (("shoulder press", "overhead press", "military", "arnold", "lateral raise", "front raise",
      "rear delt", "face pull", "upright row", "shrug", "delt"), "shoulders"),
    (("chest dip",), "chest"),
    (("tricep", "pushdown", "push down", "skull", "kickback", "close grip", "overhead extension", "dip"), "triceps"),
    (("curl",), "biceps"),
    (("bench press", "chest", "fly", "flye", "pec", "push up", "push-up"), "chest"),
    (("row", "pulldown", "pull up", "pull-up", "pullup", "lat ", "lat p", "deadlift",
      "t bar", "t-bar", "chin up", "chin-up", "back extension"), "back"),
]


def muscle_for(title: str | None) -> str:
    t = (title or "").lower()
    for keys, muscle in _MUSCLE_RULES:
        if any(k in t for k in keys):
            return muscle
    return "other"


def _num(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except (ValueError, TypeError):
        return None


def _dt(v):
    if not v:
        return None
    try:
        return dtparser.parse(v)
    except (ValueError, TypeError):
        return None


def _workout_id(title, start, end) -> str:
    h = hashlib.sha1(f"{title}|{start}|{end}".encode()).hexdigest()[:24]
    return f"csv-{h}"


def parse_csv(path: str) -> list[dict]:
    """Return a list of normalized workout dicts ready to upsert into Workout."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    return parse_rows(rows)


def parse_rows(rows: list[dict]) -> list[dict]:
    workouts: dict[tuple, dict] = {}
    order: list[tuple] = []

    for r in rows:
        title = (r.get("title") or "").strip()
        start = (r.get("start_time") or "").strip()
        end = (r.get("end_time") or "").strip()
        key = (title, start, end)
        if key not in workouts:
            order.append(key)
            workouts[key] = {
                "title": title, "start": start, "end": end,
                "description": (r.get("description") or "").strip() or None,
                "exercises": {},  # exercise_title -> exercise dict
                "ex_order": [],
            }
        w = workouts[key]

        ex_title = (r.get("exercise_title") or "").strip()
        if ex_title not in w["exercises"]:
            w["ex_order"].append(ex_title)
            w["exercises"][ex_title] = {
                "title": ex_title,
                "muscle_group": muscle_for(ex_title),
                "equipment": None,
                "notes": (r.get("exercise_notes") or "").strip() or None,
                "superset_id": (r.get("superset_id") or "").strip() or None,
                "sets": [],
            }
        km = _num(r.get("distance_km"))
        w["exercises"][ex_title]["sets"].append({
            "type": (r.get("set_type") or "normal").strip(),
            "weight_kg": _num(r.get("weight_kg")),
            "reps": _num(r.get("reps")),
            "distance_m": km * 1000 if km is not None else None,
            "duration_s": _num(r.get("duration_seconds")),
            "rpe": _num(r.get("rpe")),
        })

    out = []
    for key in order:
        w = workouts[key]
        start_dt = _dt(w["start"])
        end_dt = _dt(w["end"])
        exercises = [w["exercises"][t] for t in w["ex_order"]]
        volume = 0.0
        set_count = 0
        for ex in exercises:
            for s in ex["sets"]:
                volume += (s["weight_kg"] or 0) * (s["reps"] or 0)
                set_count += 1
        duration = (end_dt - start_dt).total_seconds() if (start_dt and end_dt) else None
        out.append({
            "id": _workout_id(w["title"], w["start"], w["end"]),
            "date": start_dt.date() if start_dt else None,
            "start_time": start_dt,
            "end_time": end_dt,
            "title": w["title"],
            "description": w["description"],
            "duration_s": duration,
            "volume_kg": round(volume, 1),
            "set_count": set_count,
            "exercise_count": len(exercises),
            "exercises": exercises,
            "source": "hevy-csv",
            "raw": {"csv": True},
        })
    return out
