"""Push a stored Hevy strength workout to Garmin Connect (and from there, your watch).

Garmin's exercise taxonomy doesn't line up with Hevy's free-text exercise names,
so matching is best-effort: try an exact/fuzzy match against Garmin's ~1500-exercise
catalog first, and fall back to a broad category guess (from the same muscle-group
classifier the app already uses) so every exercise still uploads with the right
sets/reps/weight even when the specific movement can't be pinned down exactly.
"""
from __future__ import annotations
import logging
import re

import garminconnect.exercises as gex
from garminconnect.workout import StrengthWorkout, WorkoutSegment, create_strength_set

log = logging.getLogger("pulse.garmin_workout")

# muscle_group (from hevy_csv.muscle_for) -> a reasonable broad Garmin category
_MUSCLE_TO_CATEGORY = {
    "chest": "BENCH_PRESS", "back": "ROW", "shoulders": "SHOULDER_PRESS",
    "biceps": "CURL", "triceps": "TRICEPS_EXTENSION", "quadriceps": "SQUAT",
    "hamstrings": "LEG_CURL", "glutes": "HIP_RAISE", "calves": "CALF_RAISE",
    "core": "CORE", "cardio": "CARDIO", "other": "TOTAL_BODY",
}

_EQUIPMENT_WORDS = {"barbell", "dumbbell", "cable", "machine", "smith", "kettlebell", "band", "bodyweight"}


def _clean(title: str) -> str:
    return re.sub(r"\s*\([^)]*\)", "", title or "").strip()


def resolve_exercise(title: str, muscle_group: str | None) -> dict:
    """Best-effort match of a free-text exercise name to Garmin's catalog.
    Always returns a usable {category, exercise, matched} dict."""
    base = _clean(title)

    exact = gex.resolve(title) or gex.resolve(base)
    if exact:
        return {"category": exact["category"], "exercise": exact["exercise"], "matched": True}

    candidates = gex.find(base) or gex.find(base.split(" ")[0] if base else "")
    if candidates:
        title_words = set(base.lower().split())
        equip_words = title_words & _EQUIPMENT_WORDS

        def score(c):
            name_words = set(c["name"].lower().split())
            overlap = len(title_words & name_words)
            equip_match = 1 if (equip_words & name_words) else 0
            return (equip_match, overlap)

        best = max(candidates, key=score)
        return {"category": best["category"], "exercise": best["exercise"], "matched": True}

    category = _MUSCLE_TO_CATEGORY.get((muscle_group or "").lower(), "TOTAL_BODY")
    return {"category": category, "exercise": "", "matched": False}


def build_workout(title: str, exercises: list[dict]) -> tuple[StrengthWorkout, list[dict]]:
    """Build a Garmin StrengthWorkout from stored exercise/set data.
    Returns (workout, match_report) — the report tells the caller which
    exercises matched exactly vs. fell back to a category guess."""
    steps = []
    report = []
    step_order = 1
    for ex in exercises:
        ex_title = ex.get("title") or "Exercise"
        sets = ex.get("sets") or []
        if not sets:
            continue
        match = resolve_exercise(ex_title, ex.get("muscle_group"))
        report.append({"title": ex_title, **match})

        # Group consecutive sets with the same reps/weight into one "N sets" block;
        # Garmin's editor works in blocks, not a flat set-by-set list.
        i = 0
        while i < len(sets):
            s = sets[i]
            reps = round(s.get("reps") or 8)
            weight = s.get("weight_kg")
            run = 1
            while i + run < len(sets) and round(sets[i + run].get("reps") or 8) == reps \
                    and sets[i + run].get("weight_kg") == weight:
                run += 1
            steps.append(create_strength_set(
                match["category"], step_order=step_order, sets=run, reps=reps,
                rest_seconds=90, exercise_name=match["exercise"], weight_kg=weight,
            ))
            step_order += 3
            i += run

    workout = StrengthWorkout(
        workoutName=title or "Pulse Workout",
        estimatedDurationInSecs=0,
        workoutSegments=[
            WorkoutSegment(
                segmentOrder=1,
                sportType={"sportTypeId": 5, "sportTypeKey": "strength_training"},
                workoutSteps=steps,
            )
        ],
    )
    return workout, report


def push_workout(client, title: str, exercises: list[dict]) -> dict:
    workout, report = build_workout(title, exercises)
    uploaded = client.upload_strength_workout(workout)
    workout_id = uploaded.get("workoutId") or uploaded.get("id")
    push_result = None
    if workout_id:
        try:
            push_result = client.push_workout_to_device(workout_id=workout_id)
        except Exception as e:
            log.warning("push_workout_to_device failed (workout still uploaded): %s", e)
    return {
        "workout_id": workout_id,
        "pushed_to_device": push_result is not None,
        "exercise_matches": report,
    }
