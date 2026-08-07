"""Audit-scope and cancellation safety tests for guided response sessions."""

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import remediation_playbooks  # noqa: E402


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = {row["id"]: dict(row) for row in (rows or [])}
        self.inserted = []
        self.updated = []

    async def find_one(self, query, projection=None):
        record_id = query.get("id")
        row = self.rows.get(record_id)
        if not row:
            return None
        for key, value in query.items():
            if key != "id" and row.get(key) != value:
                return None
        return dict(row)

    async def insert_one(self, document):
        self.inserted.append(dict(document))
        self.rows[document["id"]] = dict(document)
        return SimpleNamespace(inserted_id=document["id"])

    async def update_one(self, query, update):
        row = await self.find_one(query)
        if not row:
            return SimpleNamespace(modified_count=0)
        changes = dict(update.get("$set") or {})
        self.rows[row["id"]].update(changes)
        self.updated.append((dict(query), changes))
        return SimpleNamespace(modified_count=1)


class FakeDb:
    def __init__(self):
        self.clients = FakeCollection([{"id": "client-1", "name": "Acme Corporation"}])
        self.devices = FakeCollection([
            {"id": "device-1", "name": "AARON-HOME-PC", "client_id": "client-1"},
            {"id": "device-other", "name": "OTHER-PC", "client_id": "client-2"},
        ])
        self.tickets = FakeCollection([
            {"id": "ticket-1", "ticket_number": "TKT-1001", "title": "Canary alert", "client_id": "client-1"},
        ])
        self.playbook_executions = FakeCollection()


async def no_activity(*_args, **_kwargs):
    return None


def test_guided_response_requires_client_and_scope(monkeypatch):
    monkeypatch.setattr(remediation_playbooks, "db", FakeDb())

    with pytest.raises(HTTPException) as missing_client:
        asyncio.run(remediation_playbooks.start_guided_response(
            "template-ransomware-containment",
            {"scope_note": "Confirmed canary integrity signal."},
            current_user={"name": "Test Technician"},
        ))
    assert missing_client.value.status_code == 400

    with pytest.raises(HTTPException) as missing_scope:
        asyncio.run(remediation_playbooks.start_guided_response(
            "template-ransomware-containment",
            {"client_id": "client-1", "scope_note": "short"},
            current_user={"name": "Test Technician"},
        ))
    assert missing_scope.value.status_code == 400


def test_guided_response_rejects_cross_client_asset(monkeypatch):
    monkeypatch.setattr(remediation_playbooks, "db", FakeDb())

    with pytest.raises(HTTPException) as mismatch:
        asyncio.run(remediation_playbooks.start_guided_response(
            "template-ransomware-containment",
            {
                "client_id": "client-1",
                "device_id": "device-other",
                "scope_note": "Confirmed canary signal on the selected endpoint.",
            },
            current_user={"name": "Test Technician"},
        ))
    assert mismatch.value.status_code == 409
    assert "not linked" in mismatch.value.detail.lower()


def test_guided_response_records_linked_context_and_can_be_cancelled(monkeypatch):
    fake_db = FakeDb()
    monkeypatch.setattr(remediation_playbooks, "db", fake_db)
    monkeypatch.setattr(remediation_playbooks, "log_activity", no_activity)

    session = asyncio.run(remediation_playbooks.start_guided_response(
        "template-ransomware-containment",
        {
            "client_id": "client-1",
            "device_id": "device-1",
            "ticket_id": "ticket-1",
            "trigger_reference": "CANARY-ALERT-42",
            "scope_note": "Confirmed canary integrity signal; validation only until authorised.",
        },
        current_user={"name": "Test Technician"},
    ))

    assert session["client_name"] == "Acme Corporation"
    assert session["device_name"] == "AARON-HOME-PC"
    assert session["ticket_number"] == "TKT-1001"
    assert session["trigger_reference"] == "CANARY-ALERT-42"
    assert all(step["outcome"] == "pending" for step in session["steps"])

    cancelled = asyncio.run(remediation_playbooks.cancel_guided_response(
        session["id"],
        {"reason": "Workflow verification only; no customer containment action occurred."},
        current_user={"name": "Test Technician"},
    ))
    assert cancelled["status"] == "cancelled"
    assert cancelled["cancelled_by"] == "Test Technician"
    assert "verification only" in cancelled["cancel_reason"].lower()
    assert all(step["outcome"] == "pending" for step in cancelled["steps"])
