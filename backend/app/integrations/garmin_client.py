"""Garmin Connect integration.

Auth model: you authenticate ONCE via `python -m app.auth_garmin` (handles MFA).
That writes long-lived OAuth tokens to settings.garmin_token_store. This module
then loads those cached tokens — your Garmin password is never held by the server.

The garminconnect library returns Garmin's raw JSON, whose shapes drift over time,
so every extractor below is defensive (.get chains, try/except) and we always keep
the raw payload in the DB so nothing is lost.
"""
from __future__ import annotations
from datetime import date, datetime, timedelta, timezone
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


def fetch_daily_health(client, day: date, include_fitness_age: bool = False) -> dict:
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
            "resting_hr": _sane(stats.get("restingHeartRate"), "avg_hr"),
            "max_hr": _sane(stats.get("maxHeartRate"), "max_hr"),
            "min_hr": _sane(stats.get("minHeartRate"), "avg_hr"),
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

    if include_fitness_age:
        try:
            fa = client.get_fitnessage_data(ds) or {}
            out["raw"]["fitness_age"] = fa
            out["fitness_age"] = fa.get("fitnessAge")
            out["chronological_age"] = fa.get("chronologicalAge")
        except Exception as e:
            log.debug("fitness_age %s: %s", ds, e)

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

    def _ms(key):
        """Garmin's '...Local' timestamps are epoch ms with the local offset already
        baked in — interpreting as UTC gives the correct wall-clock time directly.
        (Using fromtimestamp() here would apply the *server's* timezone on top,
        double-shifting it.)"""
        ms = dto.get(key)
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).replace(tzinfo=None) if ms else None

    # SpO2/respiration summaries live under their own nested DTOs, not the
    # (usually-null) top-level averageSpO2Value/averageRespirationValue fields.
    spo2 = s.get("wellnessSpO2SleepSummaryDTO") or {}
    resp_epochs = [
        e["respirationAverageValue"] for e in (s.get("wellnessEpochRespirationAveragesList") or [])
        if (e.get("respirationAverageValue") or 0) > 0
    ]
    avg_respiration = round(sum(resp_epochs) / len(resp_epochs), 1) if resp_epochs else s.get("averageRespirationValue")

    return {
        "date": day,
        "total_seconds": total,
        "deep_seconds": dto.get("deepSleepSeconds"),
        "light_seconds": dto.get("lightSleepSeconds"),
        "rem_seconds": dto.get("remSleepSeconds"),
        "awake_seconds": dto.get("awakeSleepSeconds"),
        "sleep_score": _g(dto, "sleepScores", "overall", "value"),
        "sleep_quality": _g(dto, "sleepScores", "overall", "qualifierKey"),
        "resting_hr": _sane(s.get("restingHeartRate"), "avg_hr"),
        "avg_spo2": spo2.get("averageSPO2") or s.get("averageSpO2Value"),
        "lowest_spo2": spo2.get("lowestSPO2") or s.get("lowestSpO2Value"),
        "avg_respiration": avg_respiration,
        "avg_stress": dto.get("avgSleepStress"),
        "hrv_avg": s.get("avgOvernightHrv"),
        "start_time": _ms("sleepStartTimestampLocal"),
        "end_time": _ms("sleepEndTimestampLocal"),
        "avg_hr": _sane(dto.get("avgHeartRate"), "avg_hr"),
        "awake_count": dto.get("awakeCount"),
        "score_feedback": dto.get("sleepScoreFeedback"),
        "nap_seconds": dto.get("napTimeSeconds"),
        "sleep_need_min": _g(dto, "sleepNeed", "actual"),
        "body_battery_change": s.get("bodyBatteryChange"),
        "raw": {"sleep": {k: v for k, v in s.items() if k != "sleepMovement"}},
    }


_RUN_TYPES = {"running", "trail_running", "treadmill_running", "track_running"}


# Physiologically/sensor-implausible bounds — same principle as the pace fix
# below: a glitched sensor reading is worse than no reading, since a bad
# number silently pollutes every average/chart/PR check downstream while a
# missing one is at least visibly absent. Bounds are deliberately generous
# (anything a real human could plausibly produce) so genuine outlier efforts
# aren't discarded, only sensor garbage.
_PLAUSIBLE = {
    "avg_hr": (30, 230), "max_hr": (30, 230),
    "avg_cadence": (20, 250),
    "elevation_gain_m": (0, 9000),  # negative gain is a barometer glitch, not real
}


def _sane(value, key):
    if value is None:
        return None
    lo, hi = _PLAUSIBLE[key]
    return value if lo <= value <= hi else None


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
        # Below ~300m the recorded distance is almost always a GPS/footpod glitch
        # (treadmill runs without a footpod, indoor activities logged with near-zero
        # distance) rather than a real short effort — dividing by it produces
        # nonsense paces like "1192:19/km". Leave pace unset rather than lie.
        min_distance = 1000 if atype == "treadmill_running" else 300
        if atype in _RUN_TYPES and dist and dur and dist >= min_distance:
            candidate = dur / (dist / 1000.0)
            # Running pace outside 2:30–15:00/km indicates bad distance/type data.
            if 150 <= candidate <= 900:
                pace = candidate
        out.append({
            "id": str(a.get("activityId")),
            "date": _parse_day(a.get("startTimeLocal")),
            "start_time": _parse_dt(a.get("startTimeLocal")),
            "activity_type": atype,
            "name": a.get("activityName"),
            "distance_m": dist,
            "duration_s": dur,
            "moving_duration_s": a.get("movingDuration"),
            "avg_hr": _sane(a.get("averageHR"), "avg_hr"),
            "max_hr": _sane(a.get("maxHR"), "max_hr"),
            "avg_pace_s_per_km": pace,
            "avg_speed_mps": a.get("averageSpeed"),
            "calories": a.get("calories"),
            "elevation_gain_m": _sane(a.get("elevationGain"), "elevation_gain_m"),
            "avg_cadence": _sane(
                a.get("averageRunningCadenceInStepsPerMinute") or a.get("averageBikingCadenceInRevPerMinute"),
                "avg_cadence",
            ),
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


def fetch_current_reading(client) -> dict:
    """The most recent actual stress + body battery reading Garmin has synced —
    NOT the same as the daily summary's avg_stress/body_battery_high, which are
    statistics for the whole day (average / peak-so-far) and barely change hour
    to hour. This is the true 'right now' value, at whatever resolution Garmin's
    device last pushed to the cloud (typically every few minutes when worn)."""
    today = date.today()
    try:
        d = client.get_all_day_stress(today.isoformat()) or {}
    except Exception as e:
        log.debug("current_reading: %s", e)
        return {"stress": None, "body_battery": None, "as_of": None}

    def _latest(points, value_index=None):
        valid = [p for p in points if p and (p[1] if value_index is None else p[value_index]) is not None]
        if not valid:
            return None, None
        last = valid[-1]
        val = last[1] if value_index is None else last[value_index]
        return val, datetime.fromtimestamp(last[0] / 1000)

    stress_val, stress_ts = _latest(d.get("stressValuesArray") or [])
    bb_pts = [p for p in (d.get("bodyBatteryValuesArray") or []) if len(p) >= 3 and p[1] == "MEASURED"]
    bb_val, bb_ts = (bb_pts[-1][2], datetime.fromtimestamp(bb_pts[-1][0] / 1000)) if bb_pts else (None, None)

    as_of = max((t for t in (stress_ts, bb_ts) if t), default=None)
    return {
        "stress": stress_val if (stress_val is None or stress_val >= 0) else None,
        "body_battery": bb_val,
        "as_of": as_of.isoformat() if as_of else None,
    }


def fetch_intraday_stress(client, day: date) -> dict | None:
    """Hourly-bucketed stress + body battery for one day — fetched on demand
    (Garmin returns ~3-minute resolution; we average into hourly buckets so the
    chart stays readable instead of a 480-point noise cloud)."""
    ds = day.isoformat()
    try:
        d = client.get_all_day_stress(ds) or {}
    except Exception as e:
        log.debug("all_day_stress %s: %s", ds, e)
        return None

    stress_pts = d.get("stressValuesArray") or []
    bb_pts = d.get("bodyBatteryValuesArray") or []

    hourly: dict[int, dict] = {h: {"stress": [], "battery": []} for h in range(24)}
    for ts_ms, val in stress_pts:
        if val is None or val < 0:  # negative = no data / not measurable
            continue
        h = datetime.fromtimestamp(ts_ms / 1000).hour
        hourly[h]["stress"].append(val)
    for point in bb_pts:
        # [timestamp, status, level, version] — keep only measured points
        if len(point) < 3 or point[1] != "MEASURED" or point[2] is None:
            continue
        h = datetime.fromtimestamp(point[0] / 1000).hour
        hourly[h]["battery"].append(point[2])

    def _avg(vals):
        return round(sum(vals) / len(vals), 1) if vals else None

    return {
        "date": day.isoformat(),
        "max_stress": d.get("maxStressLevel"),
        "avg_stress": d.get("avgStressLevel"),
        "hourly": [
            {"hour": h, "avg_stress": _avg(v["stress"]), "avg_battery": _avg(v["battery"])}
            for h, v in sorted(hourly.items())
        ],
    }


def fetch_route(client, activity_id: str) -> list[dict] | None:
    """GPS polyline for one activity — fetched on demand (not stored in bulk sync)
    since most users only ever look at a handful of route maps."""
    try:
        details = client.get_activity_details(activity_id, maxpoly=2000)
    except Exception as e:
        log.debug("activity_details %s: %s", activity_id, e)
        return None
    poly = _g(details, "geoPolylineDTO", "polyline")
    if not poly:
        return None
    return [
        {"lat": p["lat"], "lon": p["lon"]}
        for p in poly
        if p.get("lat") is not None and p.get("lon") is not None
    ]


def _minetti_cost(grade: float) -> float:
    """Energy cost of running (J/kg/m) at a given gradient — Minetti et al. 2002,
    the standard basis for grade-adjusted pace calculators. grade is a decimal
    (0.05 = 5% incline)."""
    i = max(-0.45, min(0.45, grade))  # model is only validated in this range
    return 155.4 * i**5 - 30.4 * i**4 - 43.3 * i**3 + 46.3 * i**2 + 19.5 * i + 3.6


def fetch_splits(client, activity_id: str) -> list[dict] | None:
    """Per-km/mile splits for one activity — fetched on demand like the route,
    not stored in bulk sync. Includes grade-adjusted pace (GAP): the flat-ground
    pace that would cost the same effort, via the Minetti running-cost model —
    raw pace alone is misleading on hilly splits."""
    try:
        data = client.get_activity_splits(activity_id)
    except Exception as e:
        log.debug("activity_splits %s: %s", activity_id, e)
        return None
    splits = data.get("lapDTOs") if isinstance(data, dict) else None
    if not splits:
        return None
    flat_cost = _minetti_cost(0)
    out = []
    for i, s in enumerate(splits):
        dist, dur = s.get("distance"), s.get("duration")
        pace = (dur / (dist / 1000)) if dist and dur else None
        gap = None
        if pace and dist:
            gain, loss = s.get("elevationGain") or 0, s.get("elevationLoss") or 0
            grade = (gain - loss) / dist
            cost = _minetti_cost(grade)
            gap = round(pace * cost / flat_cost) if cost > 0 else pace
        out.append({
            "index": i + 1,
            "distance_m": dist,
            "duration_s": dur,
            "pace_s_per_km": pace,
            "gap_s_per_km": gap,
            "avg_hr": s.get("averageHR"),
            "elevation_gain_m": s.get("elevationGain"),
            "elevation_loss_m": s.get("elevationLoss"),
        })
    return out


def fetch_hydration(client, day: date) -> dict | None:
    """Garmin's logged/estimated fluid intake — captured on the device/app but
    not previously surfaced anywhere in Pulse."""
    try:
        d = client.get_hydration_data(day.isoformat())
    except Exception as e:
        log.debug("hydration %s: %s", day, e)
        return None
    if not d:
        return None
    return {
        "intake_ml": d.get("valueInML"),
        "goal_ml": d.get("goalInML"),
        "sweat_loss_ml": d.get("sweatLossInML"),
    }


def make_client():
    """Public entry: returns a logged-in client or raises GarminUnavailable."""
    return _client()
