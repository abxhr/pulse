"""Current weather for the readiness card — Open-Meteo needs no API key, just a
lat/lon (set LATITUDE / LONGITUDE in .env)."""
from __future__ import annotations
import time

import requests

from ..config import settings

_CACHE: dict = {"at": 0, "data": None}
_CACHE_TTL_S = 15 * 60  # weather doesn't need to be fresher than this

_WMO_CODES = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Light showers", 81: "Showers", 82: "Heavy showers",
    85: "Snow showers", 86: "Snow showers",
    95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
}


def current_weather() -> dict | None:
    if settings.latitude is None or settings.longitude is None:
        return None
    if _CACHE["data"] and time.time() - _CACHE["at"] < _CACHE_TTL_S:
        return _CACHE["data"]
    try:
        res = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": settings.latitude, "longitude": settings.longitude,
                "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
                "temperature_unit": "celsius",
            },
            timeout=6,
        )
        res.raise_for_status()
        cur = res.json().get("current") or {}
        code = cur.get("weather_code")
        data = {
            "temperature_c": cur.get("temperature_2m"),
            "humidity_pct": cur.get("relative_humidity_2m"),
            "wind_kmh": cur.get("wind_speed_10m"),
            "condition": _WMO_CODES.get(code, "—"),
            "code": code,
        }
    except Exception:
        return _CACHE["data"]  # serve last-known-good rather than nothing on a transient failure
    _CACHE["at"] = time.time()
    _CACHE["data"] = data
    return data
