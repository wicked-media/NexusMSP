"""Focused contract tests for the dashboard weather provider boundary."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from app.routers import ambient_weather


class _Settings:
    def __init__(self, document):
        self.document = document
        self.queries = []

    async def find_one(self, query, *_args, **_kwargs):
        self.queries.append(query)
        return self.document


class _Database:
    def __init__(self, document):
        self.settings = _Settings(document)


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


def _install_weather_provider(monkeypatch, payload):
    calls = []

    class _Client:
        def __init__(self, *_args, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def get(self, url, params=None, **_kwargs):
            calls.append({"url": url, "params": dict(params or {})})
            return _Response(payload)

    monkeypatch.setattr(ambient_weather.httpx, "AsyncClient", _Client)
    return calls


def _configured_settings():
    return {
        "type": ambient_weather.SETTINGS_TYPE,
        "location": {
            "name": "Sydney",
            "admin1": "New South Wales",
            "country": "Australia",
            "latitude": -33.8688,
            "longitude": 151.2093,
            "timezone": "Australia/Sydney",
        },
        "temperature_unit": "celsius",
    }


def _provider_payload():
    dates = [
        "2026-08-29",
        "2026-08-30",
        "2026-08-31",
        "2026-09-01",
        "2026-09-02",
        "2026-09-03",
        "2026-09-04",
    ]
    times = [f"2026-08-{29 + index // 24:02d}T{index % 24:02d}:00" for index in range(24)]
    return {
        "current": {
            "temperature_2m": 19.4,
            "apparent_temperature": 18.7,
            "weather_code": 2,
            "is_day": 1,
            "wind_speed_10m": 17.6,
            "time": "2026-08-29T11:00",
        },
        "current_units": {"temperature_2m": "°C", "wind_speed_10m": "km/h"},
        "daily": {
            "time": dates,
            "weather_code": [0, 1, 2, 3, 61, 95, 45],
            "temperature_2m_max": [20, 21, 22, 23, 24, 25, 26],
            "temperature_2m_min": [10, 11, 12, 13, 14, 15, 16],
            "precipitation_probability_max": [0, 5, 10, 20, 40, 80, 25],
        },
        "hourly": {
            "time": times,
            "weather_code": [0] * 24,
            "temperature_2m": list(range(10, 34)),
            "is_day": [1] * 24,
            "precipitation_probability": list(range(24)),
            "wind_speed_10m": list(range(20, 44)),
        },
    }


def test_weather_preserves_compact_forecast_and_adds_bounded_expanded_outlook(monkeypatch):
    """Expanded weather data is additive, bounded, and has a truthful timestamp."""
    fixed_now = datetime(2026, 8, 29, 1, 30, tzinfo=timezone.utc)
    monkeypatch.setattr(ambient_weather, "db", _Database(_configured_settings()))
    monkeypatch.setattr(ambient_weather, "_now", lambda: fixed_now)
    ambient_weather._weather_cache.clear()
    calls = _install_weather_provider(monkeypatch, _provider_payload())

    first = asyncio.run(ambient_weather.get_weather(current_user={"id": "tech-1"}))
    second = asyncio.run(ambient_weather.get_weather(current_user={"id": "tech-1"}))

    assert len(first["forecast"]) == 3  # Original compact strip contract.
    assert len(first["outlook"]) == 7
    assert first["outlook"][4]["icon"] == "rain"
    assert len(first["hourly"]) == 12
    assert first["hourly"][0]["time"] == "2026-08-29T11:00"
    assert first["hourly"][-1]["time"] == "2026-08-29T22:00"
    assert first["freshness"] == {
        "observed_at": "2026-08-29T11:00",
        "retrieved_at": fixed_now.isoformat(),
        "expires_at": "2026-08-29T01:40:00+00:00",
    }
    assert first["refreshed_at"] == first["freshness"]["retrieved_at"]
    assert second == first
    assert len(calls) == 1
    assert calls[0]["params"]["forecast_days"] == 7
    assert "weather_code" in calls[0]["params"]["hourly"]


def test_unconfigured_weather_has_a_stable_empty_expanded_contract(monkeypatch):
    monkeypatch.setattr(ambient_weather, "db", _Database(None))
    ambient_weather._weather_cache.clear()

    result = asyncio.run(ambient_weather.get_weather(current_user={"id": "tech-1"}))

    assert result["configured"] is False
    assert result["current"] is None
    assert result["forecast"] == []
    assert result["outlook"] == []
    assert result["hourly"] == []
    assert result["freshness"] is None
