"""Shared safety gates for Nexus integration tests.

Live API tests require a deliberately supplied, non-production test account.
Keeping that credential outside the repository prevents test fixtures from
becoming a source of deployable secrets.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import pytest


_LIVE_API_ENV = "REACT_APP_BACKEND_URL"
# A legacy live probe *reads* REACT_APP_BACKEND_URL to find its API stack.  A
# deterministic unit test that merely clears the variable for hermetic
# behaviour is not a probe, so the content match keys on the env-read
# signature rather than any mention of the variable name.
_LIVE_PROBE_ENV_READ = re.compile(
    r"(environ\.get|getenv)\(\s*[\"']REACT_APP_BACKEND_URL[\"']"
    r"|environ\[\s*[\"']REACT_APP_BACKEND_URL[\"']"
)
_LIVE_INTEGRATION_OPT_IN_ENV = "NEXUS_RUN_LIVE_INTEGRATION_TESTS"
_TEST_ENVIRONMENT_OPT_IN_ENV = "NEXUS_TEST_ENVIRONMENT"


def _environment_flag_enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def _live_integration_tests_enabled() -> bool:
    """Return whether an operator deliberately enabled mutable live API probes."""
    return _environment_flag_enabled(_LIVE_INTEGRATION_OPT_IN_ENV)


def _is_legacy_live_api_probe(path: Path) -> bool:
    """Identify legacy modules that make HTTP calls to an external API stack.

    Those probes intentionally remain in the repository for an isolated
    integration environment.  They are not unit tests and must never be
    collected just because a developer ran ``pytest`` against their normal
    local data.
    """
    if path.suffix != ".py" or not path.name.startswith("test_"):
        return False
    # tests/live/ is the dedicated home for live-stack probes: the directory is
    # the marker, so a probe cannot leak into the unit gate by omitting the
    # legacy URL constant from its source.
    if "live" in path.parts:
        return True
    try:
        return bool(_LIVE_PROBE_ENV_READ.search(path.read_text(encoding="utf-8")))
    except OSError:
        return False


def pytest_sessionstart(session: pytest.Session) -> None:
    """Fail closed when an operator explicitly requests live integration probes."""
    if not _live_integration_tests_enabled():
        return

    missing = []
    if not os.getenv(_LIVE_API_ENV):
        missing.append(_LIVE_API_ENV)
    if not _environment_flag_enabled(_TEST_ENVIRONMENT_OPT_IN_ENV):
        missing.append(f"{_TEST_ENVIRONMENT_OPT_IN_ENV}=1")
    if not os.getenv("NEXUS_TEST_ADMIN_PASSWORD"):
        missing.append("NEXUS_TEST_ADMIN_PASSWORD")
    if missing:
        raise pytest.UsageError(
            "Live Nexus integration tests require an explicitly configured "
            "non-production environment. Missing: "
            + ", ".join(missing)
        )


def pytest_ignore_collect(collection_path: Path, config: pytest.Config) -> bool | None:
    """Keep legacy live-stack probes out of ordinary local/CI unit runs.

    Pytest's collection hook runs before a test module is imported.  This is
    important because a few historical probes raise at module import if their
    API URL is absent.  A plain ``pytest`` therefore remains deterministic and
    cannot accidentally call a local or production-like Nexus instance.
    """
    if _live_integration_tests_enabled():
        return None
    if _is_legacy_live_api_probe(Path(collection_path)):
        return True
    return None


def pytest_report_header(config: pytest.Config) -> str | None:
    if _live_integration_tests_enabled():
        return "Live Nexus integration probes: explicitly enabled."
    return (
        "Live Nexus API probes: excluded. Set "
        f"{_LIVE_INTEGRATION_OPT_IN_ENV}=1 with an isolated test environment to run them."
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip credential-backed integration modules unless CI supplies the secret.

    Unit tests remain runnable without credentials.  Modules that call the API
    using ``NEXUS_TEST_ADMIN_PASSWORD`` are only collected for a configured test
    environment, never against an accidentally authenticated local instance.
    """
    if os.getenv("NEXUS_TEST_ADMIN_PASSWORD"):
        return

    skipped_paths: set[Path] = set()
    for item in items:
        path = Path(str(item.path))
        if path in skipped_paths:
            continue
        try:
            requires_test_credential = "NEXUS_TEST_ADMIN_PASSWORD" in path.read_text(encoding="utf-8")
        except OSError:
            requires_test_credential = False
        if requires_test_credential:
            skipped_paths.add(path)

    if not skipped_paths:
        return

    reason = "Set NEXUS_TEST_ADMIN_PASSWORD to run credential-backed integration tests."
    for item in items:
        if Path(str(item.path)) in skipped_paths:
            item.add_marker(pytest.mark.skip(reason=reason))
