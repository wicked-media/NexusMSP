"""Client health: one canonical score, one platform band scale."""

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

from app.routers import clients, health_radar  # noqa: E402
from app.services.client_health_policy import composite_health, health_status, normalise_score  # noqa: E402

USER = {"id": "user-1", "tenant_id": "tenant-1"}
ALL_DIMENSIONS = ["payment", "backup", "security", "m365", "network"]


class _Cursor:
    def __init__(self, rows=None):
        self._rows = rows or []

    async def to_list(self, _limit):
        return list(self._rows)


class _RecentTickets:
    def __init__(self, recent=0):
        self.recent = recent

    async def count_documents(self, _query):
        return self.recent


class _Contracts:
    def find(self, *_args, **_kwargs):
        return _Cursor([])


class _Invoices:
    def find(self, *_args, **_kwargs):
        return _Cursor([])


def _radar_db():
    return SimpleNamespace(
        tickets=_RecentTickets(),
        contracts=_Contracts(),
        invoices=_Invoices(),
    )


def _client():
    return {"id": "client-1", "name": "Acme", "mrr": 0}


def _canonical(score=61, status="needs_attention", missing=None):
    unassessed = score is None
    return {
        "client_id": "client-1",
        "client_name": "Acme",
        "health_score": score,
        "status": status,
        "evidence_state": "not_assessed" if unassessed else "partial_evidence",
        "evidence_coverage_pct": 0 if unassessed else 29,
        "missing_sources": missing if missing is not None else ALL_DIMENSIONS,
        "mrr": 0,
        "metrics": {
            "ticket_health": None if unassessed else 61,
            "device_health": None if unassessed else 100,
            "payment_health": None,
            "backup_health": None,
            "security_health": None,
            "engagement": None,
            "sentiment": None,
            "m365_hygiene": None,
            "network_health": None,
        },
        "details": {
            "open_tickets": 0 if unassessed else 1,
            "critical_tickets": 0,
            "total_tickets": 0 if unassessed else 10,
            "devices": 0 if unassessed else 2,
            "online_devices": 0 if unassessed else 2,
            "overdue_invoices": 0,
        },
    }


def test_policy_refuses_a_score_without_two_independent_dimensions():
    assert composite_health({})[0] is None
    assert composite_health({"devices": (80, 20)})[0] is None
    assert composite_health({"devices": (None, 20), "tickets": (90, 30)})[0] is None
    assert composite_health({"devices": (80, 20), "tickets": (90, 30)})[0] == 86
    assert normalise_score(True) is None
    assert normalise_score("not-a-number") is None
    assert normalise_score(140) == 100


def test_one_platform_scale_defines_every_band():
    assert health_status(None) == "not_assessed"
    assert health_status(85) == "thriving"
    assert health_status(84) == "healthy"
    assert health_status(70) == "healthy"
    assert health_status(69) == "needs_attention"
    assert health_status(50) == "needs_attention"
    assert health_status(49) == "at_risk"
    assert health_status(30) == "at_risk"
    assert health_status(29) == "critical"
    assert health_status(0) == "critical"


def test_directory_adapter_reshapes_the_canonical_score_without_recalculating(monkeypatch):
    seen = {}

    async def fake_compute_health(client, current_user):
        seen["client"] = client
        seen["user"] = current_user
        return _canonical()

    monkeypatch.setattr(clients, "compute_health", fake_compute_health)

    result = asyncio.run(clients._calc_health(_client(), USER))

    assert seen["user"] is USER
    assert result["health_score"] == 61
    assert result["risk_level"] == "needs_attention"
    assert result["breakdown"]["ticket_health"] == 61
    assert "engagement" not in result["breakdown"]
    assert result["assessed_dimensions"] == ["ticket", "device"]
    assert result["total_devices"] == 2


def test_radar_consumes_the_canonical_score_and_status(monkeypatch):
    seen = {}

    async def fake_compute_health(client, current_user):
        seen["user"] = current_user
        return _canonical()

    monkeypatch.setattr(health_radar, "compute_health", fake_compute_health)
    monkeypatch.setattr(health_radar, "db", _radar_db())

    entry = asyncio.run(health_radar._radar_entry(_client(), USER))

    assert seen["user"] is USER
    assert entry["health_score"] == 61
    assert entry["status"] == "needs_attention"
    assert entry["evidence_state"] == "partial_evidence"
    assert entry["assessed_dimensions"] == ["ticket", "device"]
    assert entry["missing_sources"] == ALL_DIMENSIONS


def test_directory_and_radar_return_the_same_score_and_band(monkeypatch):
    async def fake_compute_health(_client, _current_user):
        return _canonical(score=72, status="healthy", missing=["backup", "security", "m365", "network"])

    monkeypatch.setattr(clients, "compute_health", fake_compute_health)
    monkeypatch.setattr(health_radar, "compute_health", fake_compute_health)
    monkeypatch.setattr(health_radar, "db", _radar_db())

    directory = asyncio.run(clients._calc_health(_client(), USER))
    radar = asyncio.run(health_radar._radar_entry(_client(), USER))

    assert directory["health_score"] == radar["health_score"] == 72
    assert directory["risk_level"] == radar["status"] == "healthy"


def test_both_surfaces_keep_an_unassessed_client_unassessed(monkeypatch):
    async def fake_compute_health(_client, _current_user):
        return _canonical(score=None, status="not_assessed")

    monkeypatch.setattr(clients, "compute_health", fake_compute_health)
    monkeypatch.setattr(health_radar, "compute_health", fake_compute_health)
    monkeypatch.setattr(health_radar, "db", _radar_db())

    directory = asyncio.run(clients._calc_health(_client(), USER))
    radar = asyncio.run(health_radar._radar_entry(_client(), USER))

    assert directory["health_score"] is None
    assert directory["risk_level"] == radar["status"] == "not_assessed"
    assert radar["health_score"] is None
    assert radar["opportunities"] == []


def test_evidence_action_records_a_scoped_platform_event(monkeypatch):
    calls = {}

    async def fake_scope(user, collection, client_id, **kwargs):
        calls["scope"] = (user, collection, client_id, kwargs)
        return {"id": client_id, "name": "Acme"}

    async def fake_emit(**kwargs):
        calls["event"] = kwargs
        return {"id": "event-1"}

    monkeypatch.setattr(health_radar, "assert_tenant_record_scope", fake_scope)
    monkeypatch.setattr(health_radar, "emit_platform_event", fake_emit)

    result = asyncio.run(health_radar.record_evidence_action(
        {"client_id": "client-1", "source": "device"},
        current_user=USER,
    ))

    assert result == {"recorded": True, "event_id": "event-1"}
    assert calls["scope"][0] is USER
    assert calls["scope"][2] == "client-1"
    assert calls["event"]["subject"] == "client.evidence_action.started"
    assert calls["event"]["client_id"] == "client-1"
    assert calls["event"]["payload"]["evidence_source"] == "device"
    assert calls["event"]["tenant_id"] == "tenant-1"


def test_evidence_action_rejects_unknown_sources_and_out_of_scope_clients(monkeypatch):
    calls = {}

    async def fake_scope(*_args, **_kwargs):
        calls["scope"] = True
        return None

    async def fake_emit(**_kwargs):
        calls["event"] = True
        return {"id": "event-1"}

    monkeypatch.setattr(health_radar, "assert_tenant_record_scope", fake_scope)
    monkeypatch.setattr(health_radar, "emit_platform_event", fake_emit)

    with pytest.raises(HTTPException) as invalid:
        asyncio.run(health_radar.record_evidence_action(
            {"client_id": "client-1", "source": "not_a_source"},
            current_user=USER,
        ))
    assert invalid.value.status_code == 422

    with pytest.raises(HTTPException) as hidden:
        asyncio.run(health_radar.record_evidence_action(
            {"client_id": "other-tenant-client", "source": "device"},
            current_user=USER,
        ))
    assert hidden.value.status_code == 404
    assert "event" not in calls


def test_radar_dashboard_separates_unassessed_clients(monkeypatch):
    async def fake_compute_health(_client, _current_user):
        return _canonical(score=None, status="not_assessed")

    monkeypatch.setattr(health_radar, "compute_health", fake_compute_health)
    db = _radar_db()
    db.clients = SimpleNamespace(find=lambda *_a, **_k: _Cursor([_client()]))
    monkeypatch.setattr(health_radar, "db", db)

    dashboard = asyncio.run(health_radar.get_health_radar_dashboard(current_user=USER))

    assert dashboard["summary"]["total_clients"] == 1
    assert dashboard["summary"]["assessed_count"] == 0
    assert dashboard["summary"]["not_assessed_count"] == 1
    assert dashboard["summary"]["avg_health_score"] is None
    assert dashboard["unassessed_clients"][0]["status"] == "not_assessed"
    assert dashboard["at_risk_clients"] == []
    assert dashboard["healthy_clients"] == []
