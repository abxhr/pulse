"""Automated Hevy sync for FREE accounts via the unofficial `hevy-unofficial`
client (the same private api.hevyapp.com endpoints the Hevy *web app* uses).

This is EXPERIMENTAL and depends on an alpha library + undocumented endpoints
that can change. The CSV import path is the reliable fallback.

One-time setup - run once, interactively, in your own terminal:
    pip install 'hevy-unofficial[core]'
    python -m playwright install chromium   # one-time browser binary download
    cd backend && python -m app.hevy_auth   # opens a real browser, you log in there

That saves session tokens to backend/data/hevy_tokens.json (gitignored). The
client auto-refreshes them and re-persists the refreshed pair after that, so
recurring sync is genuinely hands-off - no token to manually rotate.

Legacy fallback: paste HEVY_ACCESS_TOKEN / HEVY_REFRESH_TOKEN into .env directly
(grabbed from hevy.com's DevTools) if you'd rather not run the browser flow.
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
        from hevy_unofficial import HevyClient, CredentialStore
    except ImportError as e:
        raise HevyUnavailable(
            "hevy-unofficial not installed. Run: pip install 'hevy-unofficial[core]'"
        ) from e

    if settings.hevy_email:
        store = CredentialStore(path=settings.hevy_token_store)
        cached = store.get(settings.hevy_email)
        if cached:
            return HevyClient(
                access_token=cached.tokens.access_token,
                refresh_token=cached.tokens.refresh_token,
                user_id=cached.tokens.user_id,
                credential_email=settings.hevy_email,
                credential_store=store,  # refreshed tokens get re-persisted here automatically
            )

    if settings.hevy_access_token and settings.hevy_refresh_token:
        return HevyClient(
            access_token=settings.hevy_access_token,
            refresh_token=settings.hevy_refresh_token,
        )

    raise HevyUnavailable(
        "No Hevy login found. Run `python -m app.hevy_auth` once (opens a browser to log "
        "in), or set HEVY_ACCESS_TOKEN/HEVY_REFRESH_TOKEN in .env as a fallback."
    )


def _username(account: dict) -> str | None:
    """Defensive extraction - the private API's response shape isn't documented,
    so try every key that plausibly holds the username."""
    for key in ("username", "user_name", "handle", "userName"):
        if account.get(key):
            return account[key]
    user = account.get("user") or {}
    for key in ("username", "user_name", "handle", "userName"):
        if user.get(key):
            return user[key]
    return None


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


def fetch_all_workouts(page_size: int = 50, max_pages: int = 200) -> list[dict]:
    """Pull the full workout history via the unofficial client's real API
    (client.users / client.workouts are pre-built resource instances)."""
    with _client() as client:
        account = client.users.get_account()
        username = _username(account)
        if not username:
            raise HevyUnavailable(
                f"Couldn't find a username in the account response (got keys: {list(account.keys())}). "
                "The private API's response shape may have changed - falling back to CSV import is safest."
            )

        seen: set = set()
        collected: list[dict] = []
        for w in client.workouts.iter_paged(username, page_size=page_size, max_pages=max_pages):
            wid = str(w.get("id") or w.get("workout_id") or "")
            if wid and wid in seen:
                continue
            seen.add(wid)
            collected.append(w)
        return [_normalize(w) for w in collected]
