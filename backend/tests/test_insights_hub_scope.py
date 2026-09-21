"""Focused safety coverage for Insights Hub read models and actions."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import mega_features, nexus_second_brain


def _restricted_user():
    return {
        "id": "tech-1",
        "name": "Scoped Technician",
        "role": "technician",
        "tenant_id": "tenant-a",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


class _Cursor:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, _limit):
        return self

    async def to_list(self, _limit):
        return list(self.rows)


class _FindCollection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.queries = []

    def find(self, query, _projection=None):
        self.queries.append(query)
        return _Cursor(self.rows)


class _CountCollection(_FindCollection):
    def __init__(self, rows=None):
        super().__init__(rows)
        self.count_queries = []
        self.find_one_queries = []

    async def count_documents(self, query):
        self.count_queries.append(query)
        return 0

    async def find_one(self, query, *args, **kwargs):
        self.find_one_queries.append(query)
        return None


def _scope_clause(query):
    if query.get("client_id") == {"$in": ["client-a"]}:
        return True
    clauses = query.get("$and", [])
    return {"client_id": {"$in": ["client-a"]}} in clauses


def _tenant_clause(query):
    if query.get("tenant_id") == "tenant-a":
        return True
    clauses = query.get("$and", [])
    return {"tenant_id": "tenant-a"} in clauses


def _client_identity_clause(query):
    if query.get("id") == {"$in": ["client-a"]}:
        return True
    clauses = query.get("$and", [])
    return {"id": {"$in": ["client-a"]}} in clauses


def test_fleet_and_finance_insight_reads_are_limited_to_client_scope(monkeypatch):
    devices = _FindCollection()
    invoices = _FindCollection()
    tickets = _FindCollection()
    monkeypatch.setattr(
        mega_features,
        "db",
        SimpleNamespace(devices=devices, invoices=invoices, tickets=tickets),
    )
    user = _restricted_user()

    asyncio.run(mega_features.health_trajectory(current_user=user))
    asyncio.run(mega_features.battery_wall(current_user=user))
    asyncio.run(mega_features.aged_ar_heatmap(current_user=user))
    asyncio.run(mega_features.patch_anomalies(current_user=user))
    asyncio.run(mega_features.skills_xp(current_user=user))
    asyncio.run(mega_features.cognitive_load(current_user=user))

    assert all(_scope_clause(query) for query in devices.queries)
    assert _scope_clause(invoices.queries[0])
    assert all(_scope_clause(query) for query in tickets.queries)


def test_cognitive_load_uses_one_row_per_technician_identity(monkeypatch):
    tickets = _FindCollection([
        {
            "id": "ticket-a", "client_id": "client-a", "assignee_id": "tech-a",
            "assignee_name": "Alex", "priority": "high", "status": "open",
        },
    ])
    users = _FindCollection([
        {"id": "tech-a", "name": "Alex", "email": "alex@example.test", "role": "technician"},
        {"id": "tech-a", "name": "Alex", "email": "alex@example.test", "role": "technician"},
    ])
    monkeypatch.setattr(mega_features, "db", SimpleNamespace(tickets=tickets, users=users))

    result = asyncio.run(mega_features.cognitive_load(current_user=_restricted_user()))

    assert [row["tech_id"] for row in result["team"]] == ["tech-a"]
    assert result["team"][0]["open_tickets"] == 1
    assert users.queries[0]["$or"] == [{"id": {"$in": ["tech-a"]}}, {"name": {"$in": ["Alex"]}}]


def test_morning_brief_counts_only_authorised_operational_records(monkeypatch):
    tickets = _CountCollection()
    backups = _CountCollection()
    alerts = _CountCollection()

    class _Database(SimpleNamespace):
        async def list_collection_names(self):
            return ["backup_jobs"]

    async def _brief(*_args, **_kwargs):
        return "Morning brief"

    monkeypatch.setattr(
        mega_features,
        "db",
        _Database(tickets=tickets, backup_jobs=backups, huntress_alerts=alerts),
    )
    monkeypatch.setattr(mega_features, "_llm", _brief)

    result = asyncio.run(mega_features.morning_brief(_restricted_user()))

    assert result["text"] == "Morning brief"
    assert all(_scope_clause(query) for query in tickets.count_queries)
    assert _scope_clause(backups.count_queries[0])
    assert _scope_clause(alerts.count_queries[0])


def test_insurance_evidence_uses_the_callers_scope_for_every_evidence_source(monkeypatch):
    devices = _FindCollection()
    drills = _CountCollection()
    reports = _CountCollection()
    alerts = _CountCollection()
    monkeypatch.setattr(
        mega_features,
        "db",
        SimpleNamespace(
            devices=devices,
            backup_drills=drills,
            compliance_reports=reports,
            huntress_alerts=alerts,
        ),
    )

    asyncio.run(mega_features.insurance_vault(current_user=_restricted_user()))

    assert _scope_clause(devices.queries[0])
    assert _scope_clause(drills.find_one_queries[0])
    assert _scope_clause(reports.find_one_queries[0])
    assert _scope_clause(alerts.count_queries[0])


def test_patch_broadcast_requires_global_scope_before_reading_or_dispatching(monkeypatch):
    calls = {}

    async def _reject_global(user, **kwargs):
        calls.update({"user": user, **kwargs})
        raise HTTPException(status_code=403, detail="Global scope required")

    monkeypatch.setattr(mega_features, "assert_global_scope", _reject_global)
    monkeypatch.setattr(mega_features, "db", SimpleNamespace())

    with pytest.raises(HTTPException) as exc:
        asyncio.run(mega_features.broadcast_patch_anomalies(None, _restricted_user()))

    assert exc.value.status_code == 403
    assert calls["operation"] == "patch_anomaly.broadcast"


def test_second_brain_overview_and_search_scope_every_client_owned_source(monkeypatch):
    tickets = _FindCollection()
    runbooks = _FindCollection()
    articles = _FindCollection()
    clients = _FindCollection()
    audit = _FindCollection()
    relationships = _FindCollection()
    decisions = _FindCollection()
    monkeypatch.setattr(
        nexus_second_brain,
        "db",
        SimpleNamespace(
            tickets=tickets,
            runbooks=runbooks,
            kb_articles=articles,
            clients=clients,
            audit_logs=audit,
            context_relationships=relationships,
            second_brain_decisions=decisions,
        ),
    )
    user = _restricted_user()

    asyncio.run(nexus_second_brain.second_brain_overview(user))
    asyncio.run(nexus_second_brain.second_brain_search({"query": "printer"}, user))

    assert all(_scope_clause(query) for query in tickets.queries)
    assert all(_scope_clause(query) for query in runbooks.queries)
    assert all(_scope_clause(query) for query in articles.queries)
    assert all(_scope_clause(query) for query in audit.queries)
    assert all(_scope_clause(query) for query in relationships.queries)
    assert _client_identity_clause(clients.queries[0])
    assert all(_tenant_clause(query) for query in tickets.queries)
    assert all(_tenant_clause(query) for query in runbooks.queries)
    assert all(_tenant_clause(query) for query in articles.queries)
    assert all(_tenant_clause(query) for query in clients.queries)
    assert all(_tenant_clause(query) for query in audit.queries)
    assert all(_tenant_clause(query) for query in relationships.queries)
    assert decisions.queries[0] == {"user_id": "tech-1", "tenant_id": "tenant-a"}


def test_second_brain_search_prefers_recent_evidence_when_match_scores_are_equal(monkeypatch):
    tickets = _FindCollection([
        {
            "id": "ticket-old", "title": "Printer offline", "description": "Printer offline",
            "client_id": "client-a", "updated_at": "2024-01-01T00:00:00+00:00",
        },
        {
            "id": "ticket-new", "title": "Printer offline", "description": "Printer offline",
            "client_id": "client-a", "updated_at": "2026-01-01T00:00:00+00:00",
        },
    ])
    empty = _FindCollection()
    monkeypatch.setattr(
        nexus_second_brain,
        "db",
        SimpleNamespace(
            tickets=tickets,
            runbooks=empty,
            kb_articles=empty,
            clients=empty,
            audit_logs=empty,
            context_relationships=empty,
        ),
    )

    result = asyncio.run(nexus_second_brain.second_brain_search({"query": "printer"}, _restricted_user()))

    assert [item["id"] for item in result["results"]] == ["ticket-new", "ticket-old"]


def test_second_brain_search_never_indexes_arbitrary_audit_details(monkeypatch):
    empty = _FindCollection()
    audit = _FindCollection([{
        "id": "audit-1",
        "action": "remote_session_started",
        "target_name": "Reception PC",
        "details": {"provider_diagnostic": "needle-value"},
        "tenant_id": "tenant-a",
        "client_id": "client-a",
    }])
    monkeypatch.setattr(
        nexus_second_brain,
        "db",
        SimpleNamespace(
            tickets=empty,
            runbooks=empty,
            kb_articles=empty,
            clients=empty,
            audit_logs=audit,
            context_relationships=empty,
        ),
    )

    result = asyncio.run(nexus_second_brain.second_brain_search({"query": "needle-value"}, _restricted_user()))

    assert result["results"] == []


def test_second_brain_decision_is_bound_to_visible_recommendation_and_tenant(monkeypatch):
    recommendation_id = "recommendation-123456abcdef"
    calls = {"updates": [], "audit": [], "events": []}

    class _Decisions:
        async def find_one(self, *_args, **_kwargs):
            return None

        async def update_one(self, query, update, upsert=False):
            calls["updates"].append((query, update, upsert))

    class _Audit:
        async def insert_one(self, row):
            calls["audit"].append(dict(row))

    async def _visible(_user):
        return {recommendation_id}

    async def _event(**kwargs):
        calls["events"].append(kwargs)

    monkeypatch.setattr(nexus_second_brain, "_visible_recommendation_ids", _visible)
    monkeypatch.setattr(nexus_second_brain, "emit_platform_event", _event)
    monkeypatch.setattr(
        nexus_second_brain,
        "db",
        SimpleNamespace(second_brain_decisions=_Decisions(), audit_logs=_Audit()),
    )
    request = SimpleNamespace(headers={}, state=SimpleNamespace(correlation_id="insights-test"))

    result = asyncio.run(nexus_second_brain.decide_recommendation(
        recommendation_id,
        request,
        {"status": "accepted", "reason": ""},
        _restricted_user(),
    ))

    assert result["recommendation_id"] == recommendation_id
    assert calls["updates"][0][0] == {
        "user_id": "tech-1",
        "tenant_id": "tenant-a",
        "recommendation_id": recommendation_id,
    }
    assert calls["updates"][0][1]["$set"]["tenant_id"] == "tenant-a"
    assert calls["audit"][0]["tenant_id"] == "tenant-a"
    assert calls["events"][0]["partition_key"] == "tenant-a"


def test_second_brain_rejects_an_unknown_or_malformed_recommendation_without_audit(monkeypatch):
    monkeypatch.setattr(nexus_second_brain, "db", SimpleNamespace())
    request = SimpleNamespace(headers={}, state=SimpleNamespace(correlation_id="insights-test"))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(nexus_second_brain.decide_recommendation(
            "not-a-recommendation",
            request,
            {"status": "accepted"},
            _restricted_user(),
        ))

    assert exc.value.status_code == 404
