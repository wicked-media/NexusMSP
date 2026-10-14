"""The deprecated bulk-actions API must not bypass governed Managed Assets work."""

import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import bulk_actions  # noqa: E402


@pytest.mark.parametrize(
    "call",
    [
        lambda: bulk_actions.execute_bulk_action({"device_ids": ["device-a"], "action": "restart"}, {}),
        lambda: bulk_actions.get_available_actions({}),
        lambda: bulk_actions.get_bulk_action_history({}),
    ],
)
def test_legacy_bulk_action_routes_fail_closed(call):
    with pytest.raises(HTTPException) as retired:
        asyncio.run(call())

    assert retired.value.status_code == 410
    assert retired.value.detail == "Legacy bulk device actions are retired. Use the Managed Assets bulk-action workflow."
