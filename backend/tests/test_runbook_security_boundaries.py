"""Regression coverage for the consolidated runbook and workflow boundary."""

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

from app.routers import it_docs, mega_features, runbooks  # noqa: E402
from app.services import scope_permissions  # noqa: E402


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
        self.update_calls = []

    def find(self, query, _projection=None):
        self.find_queries.append(query)
        return _Cursor(self.rows)

    async def find_one(self, query, _projection=None):
        self.find_one_queries.append(query)
        requested_id = query.get("id")
        for row in self.rows:
            if requested_id and row.get("id") != requested_id:
                continue
            source_rule = query.get("source_ticket_id")
            if isinstance(source_rule, dict) and source_rule.get("$exists") is True and not row.get("source_ticket_id"):
                continue
            return dict(row)
        return None

    async def update_one(self, query, update):
        self.update_calls.append((query, update))
        return SimpleNamespace(matched_count=1)


class _InsertRows:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(dict(row))


def _restricted_user():
    return {
        "id": "tech-a",
        "name": "Technician A",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def test_knowledge_library_filters_to_ticket_derived_records_inside_client_scope(monkeypatch):
    rows = _Rows([{
        "id": "runbook-a",
        "client_id": "client-a",
        "source_ticket_id": "ticket-a",
        "published": True,
        "title": "Disk alert recovery",
    }])
    monkeypatch.setattr(it_docs, "db", SimpleNamespace(runbooks=rows))

    result = asyncio.run(it_docs.get_runbooks(q="disk.*", current_user=_restricted_user()))

    assert result[0]["id"] == "runbook-a"
    query = rows.find_queries[0]
    assert "client-a" in str(query)
    assert "source_ticket_id" in str(query)
    assert query["$and"][0]["$or"][0]["title"]["$regex"] == r"disk\.\*"


def test_foreign_knowledge_runbook_is_masked_before_mutation(monkeypatch):
    runbook_rows = _Rows([{
        "id": "runbook-b",
        "client_id": "client-b",
        "source_ticket_id": "ticket-b",
        "published": True,
    }])
    denials = _InsertRows()
    monkeypatch.setattr(mega_features, "db", SimpleNamespace(runbooks=runbook_rows))
    monkeypatch.setattr(scope_permissions, "db", SimpleNamespace(scope_denials=denials))

    with pytest.raises(HTTPException) as denied:
        asyncio.run(mega_features._knowledge_runbook_in_scope(
            "runbook-b",
            _restricted_user(),
            "knowledge_runbook.helpful",
        ))

    assert denied.value.status_code == 404
    assert denied.value.detail == "Resource not found"
    assert denials.rows[0]["operation"] == "knowledge_runbook.helpful"


def test_foreign_ticket_cannot_be_promoted_to_a_knowledge_runbook(monkeypatch):
    tickets = _Rows([{
        "id": "ticket-b",
        "client_id": "client-b",
        "status": "resolved",
    }])
    denials = _InsertRows()
    monkeypatch.setattr(mega_features, "db", SimpleNamespace(tickets=tickets))
    monkeypatch.setattr(scope_permissions, "db", SimpleNamespace(scope_denials=denials))

    with pytest.raises(HTTPException) as denied:
        asyncio.run(mega_features.runbook_from_ticket(
            "ticket-b",
            {"publish": True},
            _restricted_user(),
        ))

    assert denied.value.status_code == 404
    assert denied.value.detail == "Resource not found"
    assert denials.rows[0]["operation"] == "knowledge_runbook.create"


@pytest.mark.parametrize(
    "call",
    [
        lambda: runbooks.get_runbooks({}),
        lambda: runbooks.get_runbook_logs({}),
        lambda: runbooks.get_runbook_templates({}),
        lambda: runbooks.create_runbook({}, {}),
        lambda: runbooks.update_runbook("legacy-runbook", {}, {}),
        lambda: runbooks.delete_runbook("legacy-runbook", {}),
        lambda: runbooks.test_runbook("legacy-runbook", {}),
        lambda: it_docs.create_runbook({}, {}),
        lambda: it_docs.update_runbook("legacy-runbook", {}, {}),
        lambda: it_docs.delete_runbook("legacy-runbook", {}),
        lambda: it_docs.execute_runbook("legacy-runbook", {}, {}),
        lambda: it_docs.get_runbook_executions(current_user={}),
    ],
)
def test_legacy_runbook_mutation_and_execution_routes_fail_closed(call):
    with pytest.raises(HTTPException) as retired:
        asyncio.run(call())

    assert retired.value.status_code == 410
    assert "Workflow Automation" in retired.value.detail
