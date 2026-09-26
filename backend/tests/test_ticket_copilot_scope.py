import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import ai_wave_a


def test_ticket_copilot_checks_parent_scope_before_reading_conversation(monkeypatch):
    async def denied(*_args, **_kwargs):
        raise HTTPException(status_code=404, detail="Resource not found")

    monkeypatch.setattr(ai_wave_a, "assert_tenant_record_scope", denied)
    monkeypatch.setattr(ai_wave_a, "db", SimpleNamespace(tickets=object()))

    with pytest.raises(HTTPException) as error:
        asyncio.run(ai_wave_a.ticket_copilot(
            "foreign-ticket", {"action": "summarize"}, {"id": "tech-1", "tenant_id": "tenant-a"}
        ))

    assert error.value.status_code == 404
