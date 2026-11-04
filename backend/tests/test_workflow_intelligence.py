"""Focused safety coverage for the evidence-led technician hand-off."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import workflow_intelligence
from app.services.workflow_intelligence import build_ticket_next_best_action


def _ticket(**extra):
    return {
        "id": "ticket-a",
        "ticket_number": "INC-101",
        "title": "Outlook does not open",
        "client_id": "client-a",
        "status": "open",
        "assigned_to": "tech-a",
        **extra,
    }


def _device(**extra):
    return {
        "id": "device-a",
        "client_id": "client-a",
        "name": "Sarah-Laptop",
        "status": "online",
        "last_seen": "2026-08-29T00:00:00+00:00",
        **extra,
    }


def test_next_best_action_uses_explicit_sla_evidence_without_calculating_a_breach():
    result = build_ticket_next_best_action(
        _ticket(sla_status="breached"),
        device=_device(),
        generated_at="2026-08-29T00:00:00+00:00",
    )

    assert result["recommendation"]["key"] == "escalate_sla_risk"
    assert result["recommendation"]["priority"] == "critical"
    assert "explicit retained SLA breach" in result["recommendation"]["why"]
    assert result["recommendation"]["handoff"]["executes_action"] is False


def test_next_best_action_never_turns_an_observed_change_into_a_root_cause():
    result = build_ticket_next_best_action(
        _ticket(),
        device=_device(),
        latest_snapshot={"change_count": 4, "changed_categories": ["software"], "captured_at": "2026-08-29T00:00:00+00:00"},
    )

    assert result["recommendation"]["key"] == "review_observed_endpoint_change"
    assert "does not infer causation" in result["recommendation"]["why"]
    assert any(item["source"] == "time_machine" for item in result["evidence"])


def test_next_best_action_withholds_an_unverified_cross_client_device_link():
    result = build_ticket_next_best_action(
        _ticket(device_id="device-b"),
        device=None,
    )

    assert any(item["key"] == "linked_device_unavailable" for item in result["data_gaps"])
    assert all(item["source"] != "device" for item in result["evidence"])


class _Collection:
    def __init__(self, row=None, count=0):
        self.row = row
        self.count = count
        self.find_one_queries = []
        self.count_queries = []

    async def find_one(self, query, _projection=None, **_kwargs):
        self.find_one_queries.append(query)
        return self.row

    async def count_documents(self, query):
        self.count_queries.append(query)
        return self.count


def test_ticket_next_best_action_masks_a_foreign_ticket_before_correlated_reads(monkeypatch):
    scope_calls = []

    async def foreign_scope(_user, _collection, record_id, **kwargs):
        scope_calls.append({"record_id": record_id, **kwargs})
        raise HTTPException(status_code=404, detail="Resource not found")

    class _NoCorrelationRead:
        async def find_one(self, *_args, **_kwargs):
            raise AssertionError("foreign ticket must not load correlated evidence")

        async def count_documents(self, *_args, **_kwargs):
            raise AssertionError("foreign ticket must not count correlated evidence")

    monkeypatch.setattr(workflow_intelligence, "assert_record_scope", foreign_scope)
    monkeypatch.setattr(
        workflow_intelligence,
        "db",
        SimpleNamespace(
            tickets=object(),
            devices=_NoCorrelationRead(),
            nexus_work_sessions=_NoCorrelationRead(),
            device_state_snapshots=_NoCorrelationRead(),
            remote_sessions=_NoCorrelationRead(),
        ),
    )

    with pytest.raises(HTTPException) as denied:
        asyncio.run(workflow_intelligence.ticket_next_best_action("ticket-b", current_user={"id": "tech-a"}))

    assert denied.value.status_code == 404
    assert scope_calls == [{"record_id": "ticket-b", "operation": "workflow_intelligence.next_best_action.read", "resource_name": "Ticket"}]


def test_ticket_next_best_action_scopes_every_correlated_read_to_the_ticket_client(monkeypatch):
    tickets = _Collection(count=2)
    devices = _Collection(row=_device())
    work_sessions = _Collection(row={"id": "work-a", "ticket_id": "ticket-a", "client_id": "client-a", "status": "active"})
    snapshots = _Collection(row={"id": "snapshot-a", "device_id": "device-a", "client_id": "client-a", "change_count": 1})
    remote = _Collection(row={"id": "remote-a", "ticket_id": "ticket-a", "client_id": "client-a", "status": "connected"})

    async def owned_scope(_user, _collection, _record_id, **_kwargs):
        return _ticket(device_id="device-a")

    monkeypatch.setattr(workflow_intelligence, "assert_record_scope", owned_scope)
    monkeypatch.setattr(
        workflow_intelligence,
        "db",
        SimpleNamespace(
            tickets=tickets,
            devices=devices,
            nexus_work_sessions=work_sessions,
            device_state_snapshots=snapshots,
            remote_sessions=remote,
        ),
    )

    result = asyncio.run(workflow_intelligence.ticket_next_best_action("ticket-a", current_user={"id": "tech-a"}))

    assert result["recommendation"]["key"] == "resume_work_session"
    assert devices.find_one_queries == [{"id": "device-a", "client_id": "client-a"}]
    assert work_sessions.find_one_queries == [{"ticket_id": "ticket-a", "client_id": "client-a", "status": "active"}]
    assert snapshots.find_one_queries == [{"device_id": "device-a", "client_id": "client-a"}]
    assert remote.find_one_queries == [{"ticket_id": "ticket-a", "client_id": "client-a"}]
    assert tickets.count_queries == [{
        "client_id": "client-a",
        "$or": [{"device_id": "device-a"}, {"device_ids": "device-a"}],
        "status": {"$in": ["new", "open", "in_progress", "pending"]},
    }]
