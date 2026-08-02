"""Garmin Connect integration.

Auth model: you authenticate ONCE via `python -m app.auth_garmin` (handles MFA).
That writes long-lived OAuth tokens to settings.garmin_token_store. This module
then loads those cached tokens — your Garmin password is never held by the server.

The garminconnect library returns Garmin's raw JSON, whose shapes drift over time,
so every extractor below is defensive (.get chains, try/except) and we always keep
the raw payload in the DB so nothing is lost.
"""
from __future__ import annotations
from datetime import date, timedelta
from typing import Any
import logging

from ..config import settings

log = logging.getLogger("pulse.garmin")


class GarminUnavailable(RuntimeError):
    pass


def _client():
    try:
        from garminconnect import Garmin
    except ImportError as e:  # pragma: no cover
        raise GarminUnavailable("garminconnect not installed") from e
    try:
        g = Garmin()
        g.login(settings.garmin_token_store)  # load cached tokens
        return g
    except Exception as e:
        raise GarminUnavailable(
            f"Garmin login failed ({e}). Run `python -m app.auth_garmin` first."
        ) from e


def _g(d: dict | None, *keys, default=None):
    """Safe nested get: _g(obj, 'a', 'b') -> obj['a']['b'] or default."""
    cur: Any = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
        if cur is None:
            return default
    return cur


def fetch_daily_health(client, day: date) -> dict:
    """Pull and normalize all-day wellness metrics for one date."""
    ds = day.isoformat()
    out: dict[str, Any] = {"date": day, "raw": {}}

    try:
        stats = client.get_stats(ds) or {}
        out["raw"]["stats"] = stats
        out.update({
            "steps": stats.get("totalSteps"),
            "step_goal": stats.get("dailyStepGoal"),
            "floors_climbed": stats.get("floorsAscended"),
            "distance_m": stats.get("totalDistanceMeters"),
            "calories_total": stats.get("totalKilocalories"),
            "calories_active": stats.get("activeKilocalories"),
            "resting_hr": stats.get("restingHeartRate"),
            "max_hr": stats.get("maxHeartRate"),
            "min_hr": stats.get("minHeartRate"),
            "avg_stress": stats.get("averageStressLevel"),
            "max_stress": stats.get("maxStressLevel"),
            "body_battery_high": stats.get("bodyBatteryHighestValue"),
            "body_battery_low": stats.get("bodyBatteryLowestValue"),
            "avg_spo2": stats.get("averageSpo2"),
            "avg_respiration": stats.get("avgWakingRespirationValue"),
            "intensity_minutes": (stats.get("moderateIntensityMinutes") or 0)
            + (stats.get("vigorousIntensityMinutes") or 0) * 2,
        })
    except Exception as e:
        log.warning("stats %s failed: %s", ds, e)

    try:
        tr = client.get_training_readiness(ds) or []
        if isinstance(tr, list) and tr:
            tr0 = tr[0]
            out["raw"]["training_readiness"] = tr0
            out["training_readiness"] = tr0.get("score")
            out["training_readiness_label"] = tr0.get("level")
            out["acute_load"] = tr0.get("acuteLoad")
    except Exception as e:
        log.debug("training_readiness %s: %s", ds, e)

    try:
        ts = client.get_training_status(ds) or {}
        out["raw"]["training_status"] = ts
        latest = _g(ts, "mostRecentTrainingStatus", "latestTrainingStatusData")
        if isinstance(latest, dict) and latest:
            first = next(iter(latest.values()), {})
            out["training_status"] = first.get("trainingStatusFeedbackPhrase") or first.get("trainingStatus")
    except Exception as e:
        log.debug("training_status %s: %s", ds, e)

    try:
        hrv = client.get_hrv_data(ds) or {}
        summ = _g(hrv, "hrvSummary") or {}
        out["raw"]["hrv"] = hrv
        out["hrv_last_night"] = summ.get("lastNightAvg")
        out["hrv_status"] = summ.get("status")
    except Exception as e:
        log.debug("hrv %s: %s", ds, e)

    try:
        mm = client.get_max_metrics(ds) or []
        if isinstance(mm, list) and mm:
            out["raw"]["max_metrics"] = mm[0]
            out["vo2max"] = _g(mm[0], "generic", "vo2MaxValue")
    except Exception as e:
        log.debug("max_metrics %s: %s", ds, e)

    return out


def fetch_sleep(client, day: date) -> dict | None:
    ds = day.isoformat()
    try:
        s = client.get_sleep_data(ds) or {}
    except Exception as e:
        log.debug("sleep %s: %s", ds, e)
        return None
    dto = s.get("dailySleepDTO") or {}
    if not dto:
        return None
    total = dto.get("sleepTimeSeconds")
    return {
        "date": day,
        "total_seconds": total,
        "deep_seconds": dto.get("deepSleepSeconds"),
        "light_seconds": dto.get("lightSleepSeconds"),
        "rem_seconds": dto.get("remSleepSeconds"),
        "awake_seconds": dto.get("awakeSleepSeconds"),
        "sleep_score": _g(dto, "sleepScores", "overall", "value"),
        "sleep_quality": _g(dto, "sleepScores", "overall", "qualifierKey"),
        "resting_hr": s.get("restingHeartRate"),
        "avg_spo2": s.get("averageSpO2Value"),
        "lowest_spo2": s.get("lowestSpO2Value"),
        "avg_respiration": s.get("averageRespirationValue"),
        "avg_stress": dto.get("avgSleepStress"),
        "hrv_avg": _g(s, "hrvData") and None or s.get("avgOvernightHrv"),
        "body_battery_change": s.get("bodyBatteryChange"),
        "raw": {"sleep": {k: v for k, v in s.items() if k != "sleepMovement"}},
    }


_RUN_TYPES = {"running", "trail_running", "treadmill_running", "track_running"}


def fetch_activities(client, start: date, end: date) -> list[dict]:
    try:
        acts = client.get_activities_by_date(start.isoformat(), end.isoformat()) or []
    except Exception as e:
        log.warning("activities failed: %s", e)
        return []
    out = []
    for a in acts:
        dist = a.get("distance")
        dur = a.get("duration")
        atype = _g(a, "activityType", "typeKey")
        pace = None
        if dist and dur and dist > 0:
            pace = dur / (dist / 1000.0)  # seconds per km
        out.append({
            "id": str(a.get("activityId")),
            "date": _parse_day(a.get("startTimeLocal")),
            "start_time": _parse_dt(a.get("startTimeLocal")),
            "activity_type": atype,
            "name": a.get("activityName"),
            "distance_m": dist,
            "duration_s": dur,
            "moving_duration_s": a.get("movingDuration"),
            "avg_hr": a.get("averageHR"),
            "max_hr": a.get("maxHR"),
            "avg_pace_s_per_km": pace,
            "avg_speed_mps": a.get("averageSpeed"),
            "calories": a.get("calories"),
            "elevation_gain_m": a.get("elevationGain"),
            "avg_cadence": a.get("averageRunningCadenceInStepsPerMinute") or a.get("averageBikingCadenceInRevPerMinute"),
            "aerobic_te": a.get("aerobicTrainingEffect"),
            "anaerobic_te": a.get("anaerobicTrainingEffect"),
            "vo2max": a.get("vO2MaxValue"),
            "source": "garmin",
            "raw": a,
        })
    return out


def _parse_dt(s):
    from dateutil import parser
    try:
        return parser.parse(s) if s else None
    except Exception:
        return None


def _parse_day(s):
    dt = _parse_dt(s)
    return dt.date() if dt else None


def make_client():
    """Public entry: returns a logged-in client or raises GarminUnavailable."""
    return _client()
