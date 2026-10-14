"""Fail-safe deployment settings shared by API and worker processes."""

from __future__ import annotations

import os


LOCAL_CORS_ORIGINS = (
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
)

_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})
ACCEPTANCE_DATABASE_PREFIX = "nexus_acceptance_"


def _environment_flag_enabled(name: str) -> bool:
    return str(os.environ.get(name) or "").strip().lower() in _TRUE_VALUES


def environment() -> str:
    return str(os.environ.get("APP_ENV") or "development").strip().lower()


def is_production() -> bool:
    return environment() in {"production", "prod"}


def acceptance_environment_enabled() -> bool:
    """Return whether the process is an explicitly isolated acceptance runtime.

    A generic ``APP_ENV=test`` is useful for unit tooling and must not alter a
    developer's normal import path.  The explicit flag is reserved for a
    disposable, externally reachable API environment and enables stricter
    database safeguards.
    """
    return _environment_flag_enabled("NEXUS_TEST_ENVIRONMENT")


def dotenv_loading_enabled() -> bool:
    """Keep disposable acceptance processes independent from local .env files."""
    return not acceptance_environment_enabled()


def validate_runtime_database_name(database_name: str) -> str:
    """Fail closed if an acceptance process is pointed at a normal database.

    This is intentionally a narrow runtime guard rather than a claim that a
    database name alone creates tenancy.  It prevents the acceptance runner
    from inheriting a developer or deployment database through a local .env.
    """
    normalised = str(database_name or "").strip()
    if acceptance_environment_enabled() and not normalised.startswith(ACCEPTANCE_DATABASE_PREFIX):
        raise RuntimeError(
            "NEXUS_TEST_ENVIRONMENT requires DB_NAME to start with "
            f"{ACCEPTANCE_DATABASE_PREFIX!r}; refusing to use a non-disposable database."
        )
    return normalised


def demo_seed_enabled() -> bool:
    """Return whether development-only demonstration data may be generated.

    Existing development launches retain their sample data behaviour.  Test
    and production processes never manufacture records, even if a local
    environment file carries an accidental seed flag.
    """
    if is_production() or acceptance_environment_enabled() or environment() in {"test", "testing"}:
        return False
    raw = os.environ.get("NEXUS_SEED_DEMO_DATA")
    if raw is None:
        return True
    return str(raw).strip().lower() in _TRUE_VALUES


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
