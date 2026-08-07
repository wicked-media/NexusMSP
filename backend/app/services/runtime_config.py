"""Fail-safe deployment settings shared by API and worker processes."""

from __future__ import annotations

import os


LOCAL_CORS_ORIGINS = (
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
)


def environment() -> str:
    return str(os.environ.get("APP_ENV") or "development").strip().lower()


def is_production() -> bool:
    return environment() in {"production", "prod"}


def cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS")
    origins = [item.strip().rstrip("/") for item in (raw or "").split(",") if item.strip()]
    if not origins:
        if is_production():
            raise RuntimeError("CORS_ORIGINS is required in production")
        return list(LOCAL_CORS_ORIGINS)
    if is_production() and "*" in origins:
        raise RuntimeError("Wildcard CORS is not allowed in production")
    return origins


def background_workers_enabled() -> bool:
    raw = os.environ.get("NEXUS_RUN_BACKGROUND_WORKERS")
    if raw is None:
        return not is_production()
    return raw.strip().lower() in {"1", "true", "yes", "on"}
