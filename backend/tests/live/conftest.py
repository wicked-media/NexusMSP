"""Guard for the live-stack probe directory.

Tests in ``tests/live/`` dial a running Nexus API (``REACT_APP_BACKEND_URL``)
and are excluded from the unit gate.  The parent conftest's ignore hook keeps
them out of directory-driven runs, but an explicitly named module can still be
collected, where it would fail at setup with connection errors instead of a
clear explanation.  This directory-level conftest converts every such run into
an explicit skip unless the operator has opted in to live integration probes,
matching the fail-closed contract of ``tests/conftest.py``.

Note: ``pytestmark`` in a conftest is not inherited by test modules, so the
skip is applied through ``pytest_collection_modifyitems`` instead.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

_LIVE_INTEGRATION_OPT_IN_ENV = "NEXUS_RUN_LIVE_INTEGRATION_TESTS"

_SKIP_REASON = (
    "Live Nexus API probe. Set "
    f"{_LIVE_INTEGRATION_OPT_IN_ENV}=1 with an isolated test environment "
    "(REACT_APP_BACKEND_URL, NEXUS_TEST_ENVIRONMENT=1, NEXUS_TEST_ADMIN_PASSWORD) to run it."
)


def _live_enabled() -> bool:
    return os.getenv(_LIVE_INTEGRATION_OPT_IN_ENV, "").strip().lower() in {"1", "true", "yes"}


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip live probes in this directory unless explicitly enabled."""
    if _live_enabled():
        return
    skip = pytest.mark.skip(reason=_SKIP_REASON)
    for item in items:
        if "live" in Path(str(item.path)).parts:
            item.add_marker(skip)
