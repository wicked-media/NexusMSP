"""Focused tenant and client-boundary coverage for Communications."""

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import integrations  # noqa: E402
from app.models import EmailMessageCreate  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, limit):
        return list(self.rows[:limit])


class _Rows:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]
        self.find_queries = []
        self.find_one_queries = []

    def find(self, query, _projection=None):
        self.find_queries.append(query)
        return _Cursor(self.rows)

    async def find_one(self, query, _projection=None):
        self.find_one_queries.append(query)
        return dict(self.rows[0]) if self.rows else None


def _restricted_user():
    return {
        "id": "tech-a",
        "name": "Technician A",
        "role": "technician",
        "tenant_id": "tenant-a",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def test_communications_list_applies_tenant_and_client_scope(monkeypatch):
    emails = _Rows([{
        "id": "email-a",
        "tenant_id": "tenant-a",
        "client_id": "client-a",
        "created_at": "2026-01-01T00:00:00+00:00",
    }])
    monkeypatch.setattr(integrations, "db", SimpleNamespace(emails=emails))

    result = asyncio.run(integrations.get_emails(current_user=_restricted_user()))

    assert result[0]["id"] == "email-a"
    query = emails.find_queries[0]
    assert "tenant-a" in str(query)
    assert "client-a" in str(query)


def test_communications_send_refuses_to_redispatch_a_non_draft(monkeypatch):
    emails = _Rows([{
        "id": "email-a",
        "tenant_id": "tenant-a",
        "client_id": "client-a",
        "status": "sent",
    }])
    monkeypatch.setattr(integrations, "db", SimpleNamespace(emails=emails))

    with pytest.raises(HTTPException) as blocked:
        asyncio.run(integrations.send_email("email-a", _restricted_user()))

    assert blocked.value.status_code == 409
    assert "saved draft" in blocked.value.detail
    assert "tenant-a" in str(emails.find_one_queries[0])


def test_communications_rejects_malformed_recipient_addresses():
    with pytest.raises(ValidationError):
        EmailMessageCreate(subject="Update", body="Details", to_addresses=["not-an-email"])


def test_ticket_linked_email_cannot_claim_a_different_client(monkeypatch):
    tickets = _Rows([{
        "id": "ticket-a",
        "tenant_id": "tenant-a",
        "client_id": "client-a",
    }])
    monkeypatch.setattr(integrations, "db", SimpleNamespace(tickets=tickets))
    payload = EmailMessageCreate(
        subject="Update",
        body="Details",
        to_addresses=["client@example.com"],
        client_id="client-b",
        ticket_id="ticket-a",
    )

    with pytest.raises(HTTPException) as blocked:
        asyncio.run(integrations.create_email(payload, _restricted_user()))

    assert blocked.value.status_code == 422
    assert "does not match" in blocked.value.detail
