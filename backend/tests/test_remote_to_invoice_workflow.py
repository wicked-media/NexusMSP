from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import asyncio

import pytest
from fastapi import HTTPException

from app.routers import time_entries
from app.services import remote_runtime


def _matches(row, query):
    """Evaluate the Mongo query shapes the runtime actually issues.

    ``tenant_scoped_query`` wraps every lookup in the caller's tenant
    partition (``{"$and": [filter, {"$or": [...]}]}``), so the fake
    collection must understand boolean operators, ``$exists`` and null
    semantics instead of only flat equality.  The production code is the
    security boundary under test; the double mirrors real MongoDB.
    """
    for key, expected in query.items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict) and any(str(op).startswith("$") for op in expected):
            for op, value in expected.items():
                if op == "$ne":
                    if actual == value:
                        return False
                elif op == "$in":
                    if actual not in value:
                        return False
                elif op == "$exists":
                    if bool(key in row) is not bool(value):
                        return False
                else:
                    raise AssertionError(f"Unsupported fake-DB operator: {op}")
        elif actual != expected:
            return False
    return True


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _limit):
        return deepcopy(self.rows)


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, query, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query, _projection=None):
        return FakeCursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query, update):
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                for field in update.get("$unset", {}):
                    row.pop(field, None)
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, query, update):
        modified = 0
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                for field in update.get("$unset", {}):
                    row.pop(field, None)
                modified += 1
        return SimpleNamespace(matched_count=modified, modified_count=modified)


class FakeDb(SimpleNamespace):
    def __init__(self):
        super().__init__(
            tickets=FakeCollection([{
                "id": "ticket-1",
                "title": "Restore workstation access",
                "client_id": "client-1",
                "client_name": "Northwind Dental",
                "device_id": "device-1",
            }]),
            clients=FakeCollection([{"id": "client-1", "name": "Northwind Dental"}]),
            users=FakeCollection([{"id": "tech-1", "hourly_rate": 120.0}]),
            time_entries=FakeCollection(),
            invoices=FakeCollection(),
            ticket_notes=FakeCollection(),
            ticket_audit_log=FakeCollection(),
            remote_sessions=FakeCollection(),
            nexus_work_sessions=FakeCollection([{
                "id": "work-1",
                "ticket_id": "ticket-1",
                "client_id": "client-1",
                "started_by": "tech-1",
                "status": "active",
            }]),
        )


def test_remote_session_creates_priced_auditable_time(monkeypatch):
    asyncio.run(_test_remote_session_creates_priced_auditable_time(monkeypatch))


async def _test_remote_session_creates_priced_auditable_time(monkeypatch):
    fake_db = FakeDb()
    monkeypatch.setattr(remote_runtime, "db", fake_db)
    monkeypatch.setattr(remote_runtime, "remote_policy", lambda *_args: _async_value({
        "auto_create_time_entry": True,
        "auto_ticket_note": True,
    }))
    monkeypatch.setattr(remote_runtime, "log_activity", lambda *_args, **_kwargs: _async_value(None))
    monkeypatch.setattr(remote_runtime, "emit_platform_event", lambda **_kwargs: _async_value(None))

    session = {
        "id": "remote-1",
        "status": "active",
        "user_id": "tech-1",
        "user_name": "Alex Tech",
        "ticket_id": "ticket-1",
        "client_id": "client-1",
        "client_name": "Northwind Dental",
        "device_id": "device-1",
        "device_name": "Reception-PC",
        "provider": "rustdesk",
        "opened_at": (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat(),
    }
    user = {"id": "tech-1", "name": "Alex Tech", "role": "technician"}
    result = await remote_runtime.end_remote_session_record(
        session=session,
        user=user,
        data={"notes": "Resolved the client issue", "billable": True},
    )

    entry = fake_db.time_entries.rows[0]
    assert result["time_entry_id"] == entry["id"]
    assert entry["remote_session_id"] == "remote-1"
    assert entry["hourly_rate"] == 120.0
    assert entry["total_amount"] >= 60.0
    assert entry["invoiced"] is False
    assert entry["source"] == "nexus_remote"
    assert entry["source_reference"] == "remote-1"
    assert entry["idempotency_key"] == "nexus_remote:remote-1"
    assert fake_db.ticket_notes.rows[0]["remote_session_id"] == "remote-1"
    assert fake_db.ticket_audit_log.rows[0]["action"] == "remote_session_ended"


def test_work_session_remote_handoff_has_one_canonical_time_owner(monkeypatch):
    asyncio.run(_test_work_session_remote_handoff_has_one_canonical_time_owner(monkeypatch))


async def _test_work_session_remote_handoff_has_one_canonical_time_owner(monkeypatch):
    fake_db = FakeDb()
    monkeypatch.setattr(remote_runtime, "db", fake_db)
    monkeypatch.setattr(remote_runtime, "ensure_remote_runtime_indexes", lambda: _async_value(None))
    monkeypatch.setattr(remote_runtime, "remote_policy", lambda *_args: _async_value({
        "require_ticket_reference": False,
        "require_consent": True,
        "auto_create_time_entry": True,
        "auto_ticket_note": True,
    }))
    monkeypatch.setattr(remote_runtime, "provider_is_active", lambda _provider: _async_value(True))
    monkeypatch.setattr(remote_runtime, "provider_device_id", lambda _device, _provider: _async_value("842931675"))
    monkeypatch.setattr(remote_runtime, "native_device_readiness", lambda *_args: _async_value({"ready": True, "unattended_ready": False}))
    monkeypatch.setattr(remote_runtime, "issue_grant", lambda **_kwargs: _async_value({"expires_at": "2026-09-30T00:00:00+00:00"}))
    monkeypatch.setattr(remote_runtime, "revoke_grant", lambda **_kwargs: _async_value(None))
    monkeypatch.setattr(remote_runtime, "_connection_handoff", lambda _provider, _remote_id: _async_value({
        "launch_mode": "native_client",
        "connection_url": "rustdesk://842931675",
        "web_client_url": None,
        "relay_server": None,
    }))
    monkeypatch.setattr(remote_runtime, "log_activity", lambda *_args, **_kwargs: _async_value(None))
    monkeypatch.setattr(remote_runtime, "emit_platform_event", lambda **_kwargs: _async_value(None))

    device = {"id": "device-1", "client_id": "client-1", "name": "Reception-PC", "device_type": "workstation", "nexus_agent_id": "842931675"}
    user = {"id": "tech-1", "name": "Alex Tech", "email": "alex@example.test", "role": "technician"}
    started = await remote_runtime.start_remote_session(
        device=device,
        user=user,
        data={
            "provider": "nexus",
            "mode": "view",
            "ticket_id": "ticket-1",
            "work_session_id": "work-1",
            "consent_confirmed": True,
            "consent_method": "attended_prompt",
            # A browser must not be able to force a second billable record.
            "create_time_entry": True,
        },
    )

    remote_session = started["session"]
    assert remote_session["work_session_id"] == "work-1"
    assert remote_session["time_entry_owner"] == "nexus_work_session"
    assert remote_session["create_time_entry"] is False

    ended = await remote_runtime.end_remote_session_record(
        session={
            **remote_session,
            "status": "active",
            "opened_at": (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat(),
        },
        user=user,
        # A stale browser payload at close must remain unable to create time.
        data={"notes": "Restored Outlook sign-in", "billable": True, "create_time_entry": True},
    )

    assert ended["time_entry_id"] is None
    assert ended["time_entry_suppressed_by"] == "nexus_work_session"
    assert fake_db.time_entries.rows == []
    assert "Time remains in the linked Nexus Work Session" in fake_db.ticket_notes.rows[0]["content"]


def test_work_session_remote_handoff_rejects_another_technician(monkeypatch):
    asyncio.run(_test_work_session_remote_handoff_rejects_another_technician(monkeypatch))


async def _test_work_session_remote_handoff_rejects_another_technician(monkeypatch):
    fake_db = FakeDb()
    monkeypatch.setattr(remote_runtime, "db", fake_db)
    monkeypatch.setattr(remote_runtime, "ensure_remote_runtime_indexes", lambda: _async_value(None))
    monkeypatch.setattr(remote_runtime, "remote_policy", lambda *_args: _async_value({
        "require_ticket_reference": False,
        "require_consent": True,
        "auto_create_time_entry": True,
        "auto_ticket_note": True,
    }))
    monkeypatch.setattr(remote_runtime, "native_device_readiness", lambda *_args: _async_value({"ready": True, "unattended_ready": False}))

    with pytest.raises(HTTPException) as exc:
        await remote_runtime.start_remote_session(
            device={"id": "device-1", "client_id": "client-1", "name": "Reception-PC", "nexus_agent_id": "agent-1"},
            user={"id": "tech-2", "name": "Jamie Tech", "role": "technician"},
            data={
                "provider": "nexus",
                "mode": "view",
                "ticket_id": "ticket-1",
                "work_session_id": "work-1",
                "consent_confirmed": True,
            },
        )

    assert exc.value.status_code == 403
    assert "another technician" in str(exc.value.detail).lower()


def test_remote_authorisation_does_not_create_time_until_connection_is_confirmed(monkeypatch):
    asyncio.run(_test_remote_authorisation_does_not_create_time_until_connection_is_confirmed(monkeypatch))


async def _test_remote_authorisation_does_not_create_time_until_connection_is_confirmed(monkeypatch):
    fake_db = FakeDb()
    monkeypatch.setattr(remote_runtime, "db", fake_db)
    monkeypatch.setattr(remote_runtime, "remote_policy", lambda *_args: _async_value({
        "auto_create_time_entry": True,
        "auto_ticket_note": True,
    }))
    monkeypatch.setattr(remote_runtime, "log_activity", lambda *_args, **_kwargs: _async_value(None))
    monkeypatch.setattr(remote_runtime, "emit_platform_event", lambda **_kwargs: _async_value(None))

    result = await remote_runtime.end_remote_session_record(
        session={
            "id": "remote-authorised-only",
            "status": "authorised",
            "user_id": "tech-1",
            "user_name": "Alex Tech",
            "ticket_id": "ticket-1",
            "client_id": "client-1",
            "client_name": "Northwind Dental",
            "device_id": "device-1",
            "device_name": "Reception-PC",
            "provider": "rustdesk",
            # The launch request itself may be old; it still must not become
            # a billable support session without a confirmed connection.
            "started_at": (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat(),
            "create_time_entry": True,
        },
        user={"id": "tech-1", "name": "Alex Tech", "role": "technician"},
        data={"notes": "The native client did not open", "billable": True},
    )

    assert result["duration_minutes"] == 0
    assert result["time_entry_id"] is None
    assert result["time_entry_suppressed_by"] == "launch_not_confirmed"
    assert fake_db.time_entries.rows == []
    assert "No service time was recorded" in fake_db.ticket_notes.rows[0]["content"]
    assert fake_db.ticket_audit_log.rows[-1]["action"] == "remote_session_ended"
    assert "connection not confirmed" in fake_db.ticket_audit_log.rows[-1]["details"]


def test_remote_connection_confirmation_is_explicit_and_audited(monkeypatch):
    asyncio.run(_test_remote_connection_confirmation_is_explicit_and_audited(monkeypatch))


async def _test_remote_connection_confirmation_is_explicit_and_audited(monkeypatch):
    fake_db = FakeDb()
    session = {
        "id": "remote-confirm-1",
        "status": "authorised",
        "user_id": "tech-1",
        "user_name": "Alex Tech",
        "ticket_id": "ticket-1",
        "client_id": "client-1",
        "device_id": "device-1",
        "device_name": "Reception-PC",
        "provider": "rustdesk",
        "correlation_id": "corr-1",
    }
    fake_db.remote_sessions.rows.append(dict(session))
    monkeypatch.setattr(remote_runtime, "db", fake_db)
    monkeypatch.setattr(remote_runtime, "log_activity", lambda *_args, **_kwargs: _async_value(None))
    monkeypatch.setattr(remote_runtime, "emit_platform_event", lambda **_kwargs: _async_value(None))

    opened = await remote_runtime.mark_remote_session_opened(
        session,
        {"id": "tech-1", "name": "Alex Tech", "role": "technician"},
    )

    assert opened["status"] == "active"
    assert opened["opened_confirmation"] == "technician_attested"
    assert fake_db.remote_sessions.rows[0]["opened_by"] == "tech-1"
    assert fake_db.ticket_audit_log.rows[-1]["action"] == "remote_session_connected"

    with pytest.raises(HTTPException) as exc:
        await remote_runtime.heartbeat_remote_session(
            session,
            {"id": "tech-1", "name": "Alex Tech", "role": "technician"},
        )
    assert exc.value.status_code == 409


def test_invoice_generation_is_priced_linked_and_not_repeatable(monkeypatch):
    asyncio.run(_test_invoice_generation_is_priced_linked_and_not_repeatable(monkeypatch))


async def _test_invoice_generation_is_priced_linked_and_not_repeatable(monkeypatch):
    fake_db = FakeDb()
    fake_db.time_entries.rows.append({
        "id": "time-1",
        "ticket_id": "ticket-1",
        "ticket_title": "Restore workstation access",
        "client_id": "client-1",
        "client_name": "Northwind Dental",
        "user_id": "tech-1",
        "user_name": "Alex Tech",
        "description": "Remote remediation",
        "minutes": 30,
        "hourly_rate": 120.0,
        "total_amount": 0.0,
        "billable": True,
        "invoiced": False,
        "remote_session_id": "remote-1",
        "date": "2026-08-06",
    })
    monkeypatch.setattr(time_entries, "db", fake_db)
    monkeypatch.setattr(time_entries, "log_activity", lambda *_args, **_kwargs: _async_value(None))
    ticket_audits = []

    async def _ticket_audit(ticket_id, _user, action, details):
        ticket_audits.append({"ticket_id": ticket_id, "action": action, "details": details})

    monkeypatch.setattr(time_entries, "ticket_audit", _ticket_audit)
    user = {"id": "admin-1", "name": "Aaron", "role": "admin", "is_admin": True}

    invoice = await time_entries.generate_invoice_from_time(
        {"client_name": "Northwind Dental"},
        current_user=user,
    )

    assert invoice["client_id"] == "client-1"
    assert invoice["invoice_number"].startswith("INV-")
    assert invoice["total_amount"] == 60.0
    assert invoice["subtotal"] == 60.0
    assert invoice["total"] == 60.0
    assert invoice["amount_due"] == 60.0
    assert invoice["payment_status"] == "unpaid"
    assert invoice["line_items"][0]["unit_price"] == 120.0
    assert invoice["line_items"][0]["total"] == 60.0
    assert invoice["ticket_ids"] == ["ticket-1"]
    assert invoice["ticket_id"] == "ticket-1"
    assert invoice["source_refs"][0]["remote_session_id"] == "remote-1"
    assert fake_db.time_entries.rows[0]["invoice_id"] == invoice["id"]
    assert ticket_audits[0]["ticket_id"] == "ticket-1"
    assert ticket_audits[0]["action"] == "invoice_linked"

    with pytest.raises(HTTPException) as exc:
        await time_entries.generate_invoice_from_time(
            {"client_name": "Northwind Dental"},
            current_user=user,
        )
    assert exc.value.status_code == 404


async def _async_value(value):
    return value
