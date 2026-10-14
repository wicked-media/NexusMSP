import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.routers import diff_features


def test_health_certificate_cannot_bypass_the_tenant_client_guard(monkeypatch):
    """The PDF route must stop before rendering when scope validation denies it."""
    guard = AsyncMock(side_effect=HTTPException(status_code=404, detail="Resource not found"))
    monkeypatch.setattr(diff_features, "assert_tenant_record_scope", guard)
    monkeypatch.setattr(diff_features, "db", SimpleNamespace(clients=object()))
    actor = {"id": "tenant-a-user", "tenant_id": "tenant-a"}

    with pytest.raises(HTTPException) as error:
        asyncio.run(diff_features.health_certificate_pdf("tenant-b-client", actor))

    assert error.value.status_code == 404
    guard.assert_awaited_once()
    assert guard.call_args.args[0] == actor
    assert guard.call_args.args[2] == "tenant-b-client"
