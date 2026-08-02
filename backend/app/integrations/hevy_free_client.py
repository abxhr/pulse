"""Automated Hevy sync for FREE accounts via the unofficial `hevy-unofficial`
client (the same private api.hevyapp.com endpoints the Hevy *web app* uses).

This is EXPERIMENTAL and depends on an alpha library + undocumented endpoints
that can change. The CSV import path is the reliable fallback.

One-time setup (login has a reCAPTCHA, so you can't fully script the first login):
  - Grab an access token + refresh token once from a logged-in hevy.com browser
    session (DevTools -> Application -> Cookies / Network), OR run
    `login_via_browser()` once on a machine with a display.
  - Put them in .env as HEVY_ACCESS_TOKEN / HEVY_REFRESH_TOKEN.
After that the client auto-refreshes the tokens, so recurring sync is hands-off.

    pip install 'hevy-unofficial[core]'   # lightweight, no browser
"""
from __future__ import annotations
import logging
from datetime import datetime
from dateutil import parser as dtparser

from ..config import settings
from .hevy_csv import muscle_for

log = logging.getLogger("pulse.hevy_free")


class HevyUnavailable(RuntimeError):
    pass


def _client():
    try:
        from hevy_unofficial import HevyClient
    except ImportError as e:
        raise HevyUnavailable(
            "hevy-unofficial not installed. Run: pip install 'hevy-unofficial[core]'"
        ) from e
    if not (settings.hevy_access_token and settings.hevy_refresh_token):
        raise HevyUnavailable(
            "HEVY_ACCESS_TOKEN / HEVY_REFRESH_TOKEN not set in .env — see hevy_free_client docstring."
        )
    return HevyClient(
        access_token=settings.hevy_access_token,
        refresh_token=settings.hevy_refresh_token,
    )


def _dt(v):
    if not v:
        return None
    try:
        return dtparser.parse(v) if isinstance(v, str) else datetime.fromtimestamp(v)
    except Exception:
        return None


def _normalize(w: dict) -> dict:
    """Best-effort normalization of a private-API workout into our schema.
    Field names are guessed defensively; the raw payload is always retained."""
    start = _dt(w.get("start_time") or w.get("startTime") or w.get("start"))
    end = _dt(w.get("end_time") or w.get("endTime") or w.get("end"))
    exercises, volume, set_count = [], 0.0, 0
    for ex in (w.get("exercises") or []):
        title = ex.get("title") or ex.get("name") or ex.get("exercise_title") or "?"
        sets = []
        for s in (ex.get("sets") or []):
            wt = s.get("weight_kg") or s.get("weightKg") or s.get("weight")
            reps = s.get("reps")
            dist = s.get("distance_meters") or s.get("distance_m") or s.get("distanceMeters")
            volume += (wt or 0) * (reps or 0)
            set_count += 1
            sets.append({
                "type": s.get("type") or s.get("set_type") or "normal",
                "weight_kg": wt, "reps": reps, "distance_m": dist,
                "duration_s": s.get("duration_seconds") or s.get("duration"),
                "rpe": s.get("rpe"),
            })
        exercises.append({
            "title": title,
            "muscle_group": ex.get("muscle_group") or ex.get("primary_muscle_group") or muscle_for(title),
            "equipment": ex.get("equipment"),
            "notes": ex.get("notes"),
            "sets": sets,
        })
    wid = str(w.get("id") or w.get("workout_id") or f"{w.get('title')}|{start}")
    duration = (end - start).total_seconds() if (start and end) else w.get("duration")
    return {
        "id": f"hevy-{wid}", "date": start.date() if start else None,
        "start_time": start, "end_time": end,
        "title": w.get("title"), "description": w.get("description"),
        "duration_s": duration, "volume_kg": round(volume, 1),
        "set_count": set_count, "exercise_count": len(exercises),
        "exercises": exercises, "source": "hevy-api", "raw": w,
    }


def fetch_all_workouts(page_size: int = 50, max_pages: int = 40) -> list[dict]:
    """Pull the full workout history via the unofficial client, paginating defensively."""
    with _client() as client:
        account = client.users.get_account()
        username = account.get("username")
        collected: list[dict] = []
        seen: set = set()
        # Try offset pagination; fall back to a single large fetch if unsupported.
        for page in range(max_pages):
            try:
                batch = client.workouts.list_paged(username=username, limit=page_size, offset=page * page_size)
            except TypeError:
                batch = client.workouts.list_paged(username=username, limit=page_size * max_pages)
                collected = list(batch)
                break
            items = list(batch or [])
            if not items:
                break
            new = [it for it in items if str(it.get("id")) not in seen]
            for it in new:
                seen.add(str(it.get("id")))
            collected.extend(new)
            if len(items) < page_size:
                break
        return [_normalize(w) for w in collected]
