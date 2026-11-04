"""Live weather and local-time settings for the NexusMSP dashboard."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.database import db


router = APIRouter(tags=["Ambient weather"])

SETTINGS_TYPE = "ambient_weather_clock"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
CACHE_TTL = timedelta(minutes=10)
_weather_cache: dict[str, tuple[datetime, dict[str, Any]]] = {}


WEATHER_CODES: dict[int, tuple[str, str]] = {
    0: ("Clear sky", "clear"), 1: ("Mostly clear", "partly-cloudy"),
    2: ("Partly cloudy", "partly-cloudy"), 3: ("Overcast", "cloudy"),
    45: ("Fog", "fog"), 48: ("Rime fog", "fog"),
    51: ("Light drizzle", "drizzle"), 53: ("Drizzle", "drizzle"), 55: ("Heavy drizzle", "rain"),
    56: ("Freezing drizzle", "sleet"), 57: ("Heavy freezing drizzle", "sleet"),
    61: ("Light rain", "rain"), 63: ("Rain", "rain"), 65: ("Heavy rain", "rain"),
    66: ("Freezing rain", "sleet"), 67: ("Heavy freezing rain", "sleet"),
    71: ("Light snow", "snow"), 73: ("Snow", "snow"), 75: ("Heavy snow", "snow"), 77: ("Snow grains", "snow"),
    80: ("Rain showers", "rain"), 81: ("Moderate showers", "rain"), 82: ("Heavy showers", "rain"),
    85: ("Snow showers", "snow"), 86: ("Heavy snow showers", "snow"),
    95: ("Thunderstorm", "storm"), 96: ("Thunderstorm with hail", "storm"), 99: ("Severe thunderstorm", "storm"),
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _weather_code(code: Any) -> tuple[str, str]:
    try:
        return WEATHER_CODES.get(int(code), ("Conditions unavailable", "cloudy"))
    except (TypeError, ValueError):
        return ("Conditions unavailable", "cloudy")


def _daily_forecast_entries(daily: dict[str, Any], *, limit: int) -> list[dict[str, Any]]:
    """Normalise provider daily weather fields into a stable Nexus payload."""
    dates = daily.get("time") or []
    codes = daily.get("weather_code") or []
    highs = daily.get("temperature_2m_max") or []
    lows = daily.get("temperature_2m_min") or []
    precipitation = daily.get("precipitation_probability_max") or []
    entries = []
    for index, day in enumerate(dates[:limit]):
        label, icon = _weather_code(codes[index] if index < len(codes) else None)
        entries.append({
            "date": day,
            "label": label,
            "icon": icon,
            "high": highs[index] if index < len(highs) else None,
            "low": lows[index] if index < len(lows) else None,
            "precipitation_probability": precipitation[index] if index < len(precipitation) else None,
        })
    return entries


def _hourly_forecast_entries(
    hourly: dict[str, Any],
    *,
    observed_at: str | None,
    limit: int = 12,
) -> list[dict[str, Any]]:
    """Return the current hour and next hours without exposing provider payloads.

    Open-Meteo returns both current and hourly values in the selected location's
    timezone. Their ISO-like timestamps sort chronologically, so filtering on
    the current observation keeps the compact outlook useful late in the day
    without introducing a second timezone conversion path in the API.
    """
    times = hourly.get("time") or []
    codes = hourly.get("weather_code") or []
    temperatures = hourly.get("temperature_2m") or []
    precipitation = hourly.get("precipitation_probability") or []
    wind_speeds = hourly.get("wind_speed_10m") or []
    is_day_values = hourly.get("is_day") or []
    entries = []
    for index, timestamp in enumerate(times):
        if observed_at and isinstance(timestamp, str) and timestamp < observed_at:
            continue
        label, icon = _weather_code(codes[index] if index < len(codes) else None)
        entries.append({
            "time": timestamp,
            "label": label,
            "icon": icon,
            "temperature": temperatures[index] if index < len(temperatures) else None,
            "precipitation_probability": precipitation[index] if index < len(precipitation) else None,
            "wind_speed": wind_speeds[index] if index < len(wind_speeds) else None,
            "is_day": bool(is_day_values[index]) if index < len(is_day_values) else True,
        })
        if len(entries) >= limit:
            break
    return entries


def _public_settings(doc: dict | None) -> dict:
    location = (doc or {}).get("location") or {}
    configured = bool(location.get("name") and location.get("latitude") is not None and location.get("longitude") is not None)
    return {
        "configured": configured,
        "location": location if configured else None,
        "temperature_unit": (doc or {}).get("temperature_unit", "celsius"),
        "updated_at": (doc or {}).get("updated_at"),
        "updated_by": (doc or {}).get("updated_by"),
    }


async def _record_activity(current_user: dict, details: str, metadata: dict | None = None) -> None:
    try:
        await db.activity_logs.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": current_user.get("id", "system"),
            "user_name": current_user.get("name") or current_user.get("email", "System"),
            "action": "weather_clock_settings_updated",
            "entity_type": "ambient_weather_clock",
            "entity_id": SETTINGS_TYPE,
            "entity_name": "Weather & local clock",
            "details": details,
            "metadata": metadata or {},
            "created_at": _now().isoformat(),
        })
    except Exception:
        pass


@router.get("/ambient/weather-settings")
async def get_weather_settings(current_user: dict = Depends(get_current_user)):
    """Return the organisation's non-sensitive weather and clock display preferences."""
    doc = await db.settings.find_one({"type": SETTINGS_TYPE}, {"_id": 0})
    return _public_settings(doc)


@router.put("/ambient/weather-settings")
async def update_weather_settings(payload: dict, current_user: dict = Depends(get_current_user)):
    """Save the dashboard location and temperature unit used by every technician."""
    location = payload.get("location") or {}
    name = str(location.get("name") or "").strip()
    timezone_name = str(location.get("timezone") or "").strip()
    unit = str(payload.get("temperature_unit") or "celsius").lower()

    if not name or len(name) > 140:
        raise HTTPException(status_code=422, detail="Choose a valid location before saving.")
    if unit not in {"celsius", "fahrenheit"}:
        raise HTTPException(status_code=422, detail="Temperature unit must be celsius or fahrenheit.")
    try:
        latitude, longitude = float(location.get("latitude")), float(location.get("longitude"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="The selected location is missing coordinates.")
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise HTTPException(status_code=422, detail="The selected location has invalid coordinates.")
    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        raise HTTPException(status_code=422, detail="The selected location has an invalid timezone.")

    clean_location = {
        "name": name, "admin1": str(location.get("admin1") or "").strip(),
        "country": str(location.get("country") or "").strip(), "latitude": latitude,
        "longitude": longitude, "timezone": timezone_name,
    }
    document = {
        "type": SETTINGS_TYPE, "location": clean_location, "temperature_unit": unit,
        "updated_at": _now().isoformat(), "updated_by": current_user.get("id"),
        "updated_by_name": current_user.get("name") or current_user.get("email"),
    }
    await db.settings.update_one({"type": SETTINGS_TYPE}, {"$set": document}, upsert=True)
    _weather_cache.clear()
    await _record_activity(current_user, f"Updated the dashboard weather location to {name}.", {"location": name, "timezone": timezone_name, "temperature_unit": unit})
    return _public_settings(document)


@router.get("/ambient/weather-search")
async def search_weather_locations(q: str = Query(..., min_length=2, max_length=120), current_user: dict = Depends(get_current_user)):
    """Search public place data for the weather/location settings picker."""
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(GEOCODING_URL, params={"name": q.strip(), "count": 8, "language": "en", "format": "json"})
            response.raise_for_status()
            results = response.json().get("results") or []
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Location search is unavailable. Please try again shortly.")
    return {"results": [
        {"id": str(item.get("id") or f"{item.get('latitude')}:{item.get('longitude')}") , "name": item.get("name"),
         "admin1": item.get("admin1") or "", "country": item.get("country") or "", "latitude": item.get("latitude"),
         "longitude": item.get("longitude"), "timezone": item.get("timezone") or "GMT"}
        for item in results if item.get("name") and item.get("latitude") is not None and item.get("longitude") is not None
    ]}


@router.get("/ambient/weather")
async def get_weather(current_user: dict = Depends(get_current_user)):
    """Return current weather plus compact and expandable outlooks.

    ``forecast`` remains the existing three-day strip contract. ``outlook``
    and ``hourly`` are additive, bounded views for the expanded weather panel.
    """
    settings = await db.settings.find_one({"type": SETTINGS_TYPE}, {"_id": 0})
    public_settings = _public_settings(settings)
    if not public_settings["configured"]:
        return {
            **public_settings,
            "current": None,
            "forecast": [],
            "outlook": [],
            "hourly": [],
            "freshness": None,
        }

    location = public_settings["location"]
    cache_key = ":".join((
        str(location["latitude"]),
        str(location["longitude"]),
        location["timezone"],
        public_settings["temperature_unit"],
    ))
    cached = _weather_cache.get(cache_key)
    if cached and _now() - cached[0] < CACHE_TTL:
        return cached[1]
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(FORECAST_URL, params={
                "latitude": location["latitude"], "longitude": location["longitude"],
                "current": "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
                "hourly": "temperature_2m,weather_code,is_day,precipitation_probability,wind_speed_10m",
                "timezone": location["timezone"], "temperature_unit": public_settings["temperature_unit"],
                "wind_speed_unit": "kmh", "forecast_days": 7,
            })
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Weather is temporarily unavailable. Please try again shortly.")

    current_raw = data.get("current") or {}
    current_label, current_icon = _weather_code(current_raw.get("weather_code"))
    daily = data.get("daily") or {}
    outlook = _daily_forecast_entries(daily, limit=7)
    fetched_at = _now()
    freshness = {
        # This is the provider's local observation timestamp, not an inferred
        # "live" indicator. The UI can show it alongside the fetch timestamp.
        "observed_at": current_raw.get("time"),
        "retrieved_at": fetched_at.isoformat(),
        "expires_at": (fetched_at + CACHE_TTL).isoformat(),
    }

    result = {
        **public_settings,
        "current": {"temperature": current_raw.get("temperature_2m"), "apparent_temperature": current_raw.get("apparent_temperature"), "wind_speed": current_raw.get("wind_speed_10m"), "is_day": bool(current_raw.get("is_day", 1)), "label": current_label, "icon": current_icon, "observed_at": current_raw.get("time")},
        # Preserve this original field for the compact dashboard strip.
        "forecast": outlook[:3],
        "outlook": outlook,
        "hourly": _hourly_forecast_entries(
            data.get("hourly") or {},
            observed_at=current_raw.get("time"),
        ),
        "units": {"temperature": (data.get("current_units") or {}).get("temperature_2m", "°C"), "wind_speed": (data.get("current_units") or {}).get("wind_speed_10m", "km/h")},
        "freshness": freshness,
        # Backwards-compatible alias retained for existing callers.
        "refreshed_at": freshness["retrieved_at"],
    }
    _weather_cache[cache_key] = (fetched_at, result)
    return result
