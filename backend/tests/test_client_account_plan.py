import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError
from fastapi import HTTPException
from app.services.client_account_plan import editable_account_plan
from app.routers import client_studio


class StakeholderRows:
    """Small async collection double that exposes persistence queries to tests."""

    def __init__(self):
        self.find_query = None
        self.inserted = None
        self.updated_query = None
        self.deleted_query = None

    def find(self, query, *_args, **_kwargs):
        self.find_query = query
        return self

    async def to_list(self, _limit):
        return []

    async def insert_one(self, record):
        self.inserted = record

    async def update_one(self, query, _update):
        self.updated_query = query
        return SimpleNamespace(matched_count=1)

    async def delete_one(self, query):
        self.deleted_query = query
        return SimpleNamespace(deleted_count=1)


def test_metadata_cannot_be_written_by_browser():
    assert editable_account_plan({
        "goals": ["Review service coverage"], "tenant_id": "foreign",
        "client_id": "foreign", "updated_by": "another user", "generated_by_ai": True,
    }) == {"goals": ["Review service coverage"]}


@pytest.mark.parametrize("data", [
    {"goals": "wrong"}, {"risks": [{}]}, {"people": ["x"] * 101},
    {"next_actions": ["x" * 4001]}, {"opportunities": [{"title": "x", "value": -1}]},
    {"opportunities": [{"title": "x", "value": float("nan")}]},
    {"opportunities": [{"title": "x", "value": True}]}, {"tenant_id": "x"},
])
def test_invalid_content_rejected(data):
    with pytest.raises(HTTPException) as error:
        editable_account_plan(data)
    assert error.value.status_code == 422


def test_opportunities_keep_only_editable_values():
    assert editable_account_plan({"opportunities": [{"title": "Backup", "value": None, "tenant_id": "bad"}]}) == {
        "opportunities": [{"title": "Backup", "value": None}]}


def test_read_and_write_use_actor_tenant(monkeypatch):
    rows = SimpleNamespace(find_one=AsyncMock(return_value=None), update_one=AsyncMock())
    monkeypatch.setattr(client_studio, "db", SimpleNamespace(client_account_plans=rows))
    monkeypatch.setattr(client_studio, "_client_or_404", AsyncMock(return_value={"id": "c"}))
    audit = AsyncMock()
    monkeypatch.setattr(client_studio, "_write_client_studio_audit", audit)
    user = {"id": "u", "name": "Technician", "tenant_id": "tenant-a"}
    asyncio.run(client_studio.get_account_plan("c", user))
    asyncio.run(client_studio.save_account_plan("c", {"goals": ["Review"], "tenant_id": "tenant-b", "updated_by": "fake"}, user))
    query = {"$and": [{"client_id": "c"}, {"tenant_id": "tenant-a"}]}
    assert rows.find_one.call_args.args[0] == query
    assert rows.update_one.call_args.args[0] == query
    written = rows.update_one.call_args.args[1]["$set"]
    assert written["tenant_id"] == "tenant-a"
    assert written["updated_by"] == "Technician"
    audit.assert_awaited_once()


def test_invalid_plan_never_reaches_write(monkeypatch):
    rows = SimpleNamespace(update_one=AsyncMock())
    monkeypatch.setattr(client_studio, "db", SimpleNamespace(client_account_plans=rows))
    monkeypatch.setattr(client_studio, "_client_or_404", AsyncMock())
    with pytest.raises(HTTPException):
        asyncio.run(client_studio.save_account_plan("c", {"goals": [{}]}, {"id": "u"}))
    rows.update_one.assert_not_awaited()


def test_stakeholder_reads_and_writes_stay_in_actor_tenant(monkeypatch):
    rows = StakeholderRows()
    monkeypatch.setattr(client_studio, "db", SimpleNamespace(client_stakeholders=rows))
    monkeypatch.setattr(client_studio, "_client_or_404", AsyncMock(return_value={"id": "client-a"}))
    monkeypatch.setattr(client_studio, "_write_client_studio_audit", AsyncMock())
    user = {"id": "technician-a", "name": "Technician", "tenant_id": "tenant-a"}
    expected_client_query = {"$and": [{"client_id": "client-a"}, {"tenant_id": "tenant-a"}]}

    assert asyncio.run(client_studio.list_stakeholders("client-a", user)) == []
    assert rows.find_query == expected_client_query

    created = asyncio.run(client_studio.create_stakeholder(
        "client-a",
        client_studio.StakeholderCreatePayload(name="Avery", role="champion", relationship_strength=72),
        user,
    ))
    assert created["tenant_id"] == "tenant-a"
    assert rows.inserted["tenant_id"] == "tenant-a"


def test_stakeholder_direct_updates_and_deletes_use_tenant_scoped_filters(monkeypatch):
    rows = StakeholderRows()
    monkeypatch.setattr(client_studio, "db", SimpleNamespace(client_stakeholders=rows))
    monkeypatch.setattr(
        client_studio,
        "assert_tenant_record_scope",
        AsyncMock(return_value={"id": "stakeholder-a", "client_id": "client-a", "tenant_id": "tenant-a"}),
    )
    monkeypatch.setattr(client_studio, "_write_client_studio_audit", AsyncMock())
    user = {"id": "technician-a", "name": "Technician", "tenant_id": "tenant-a"}
    expected = {"$and": [{"id": "stakeholder-a", "client_id": "client-a"}, {"tenant_id": "tenant-a"}]}

    asyncio.run(client_studio.update_stakeholder("stakeholder-a", client_studio.StakeholderUpdatePayload(notes="Reviewed"), None, user))
    assert rows.updated_query == expected

    asyncio.run(client_studio.delete_stakeholder("stakeholder-a", None, user))
    assert rows.deleted_query == expected


def test_stakeholder_payload_rejects_invalid_roles_and_unexpected_fields():
    with pytest.raises(ValidationError):
        client_studio.StakeholderCreatePayload(name="Avery", role="owner")
    with pytest.raises(ValidationError):
        client_studio.StakeholderCreatePayload(name="Avery", tenant_id="other-tenant")
    with pytest.raises(ValidationError):
        client_studio.StakeholderUpdatePayload(name="   ")
