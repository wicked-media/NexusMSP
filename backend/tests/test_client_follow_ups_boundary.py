import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.routers import client_follow_ups
from app.services.client_follow_ups import new_follow_up, stable_follow_up_id, update_follow_up, visible_follow_up


def _user():
    return {"id": "tech", "name": "Technician", "tenant_id": "tenant-a"}


def _create_data(**overrides):
    return client_follow_ups.FollowUpCreate(
        title="Review service coverage",
        note="Confirm the reviewed service scope.",
        kind="review",
        priority="high",
        due_at=datetime(2026, 9, 10, 10, 0, tzinfo=timezone.utc),
        owner_id="owner",
        idempotency_key="follow-up-request-001",
        **overrides,
    )


def test_follow_up_identity_is_client_and_tenant_scoped_and_safe_to_return():
    row = new_follow_up(
        tenant_id="tenant-a", client_id="client-a", data=_create_data().model_dump(),
        owner={"id": "owner", "name": "Account owner"}, actor=_user(),
    )
    assert row["id"] == stable_follow_up_id("tenant-a", "client-a", "follow-up-request-001")
    assert row["id"] != stable_follow_up_id("tenant-b", "client-a", "follow-up-request-001")
    assert row["owner_name"] == "Account owner"
    assert row["status"] == "open" and row["version"] == 1
    returned = visible_follow_up(row)
    assert "tenant_id" not in returned and "idempotency_key" not in returned and "_id" not in returned


def test_update_does_not_accept_completion_evidence_before_completion():
    existing = {"id": "follow-up", "status": "open", "version": 1}
    with pytest.raises(HTTPException) as error:
        update_follow_up(existing, {"completion_note": "Done"}, owner=None, actor=_user())
    assert error.value.status_code == 422


def test_list_is_tenant_client_scoped_and_returns_a_safe_register(monkeypatch):
    cursor = SimpleNamespace(to_list=AsyncMock(return_value=[{
        "_id": "internal-follow-up", "id": "follow-up", "tenant_id": "tenant-a",
        "client_id": "client", "idempotency_key": "retry-key", "title": "Review coverage",
        "status": "open", "version": 1,
    }]))
    cursor.sort = Mock(return_value=cursor)
    rows = SimpleNamespace(find=Mock(return_value=cursor))
    monkeypatch.setattr(client_follow_ups, "db", SimpleNamespace(client_follow_ups=rows))
    scope = AsyncMock(return_value={"id": "client"})
    owners = AsyncMock(return_value=[{"id": "tech", "name": "Technician"}])
    monkeypatch.setattr(client_follow_ups, "_client_or_404", scope)
    monkeypatch.setattr(client_follow_ups, "_owners", owners)

    response = asyncio.run(client_follow_ups.list_client_follow_ups("client", _user()))

    scope.assert_awaited_once_with("client", _user(), operation="client.follow_up.read")
    query = rows.find.call_args.args[0]
    assert query == {"$and": [{"client_id": "client"}, {"tenant_id": "tenant-a"}]}
    assert response["owners"] == [{"id": "tech", "name": "Technician"}]
    assert response["follow_ups"] == [{
        "id": "follow-up", "client_id": "client", "title": "Review coverage", "status": "open", "version": 1,
    }]


def test_create_is_tenant_client_scoped_idempotent_and_audited(monkeypatch):
    rows = SimpleNamespace(update_one=AsyncMock(return_value=SimpleNamespace(upserted_id="new")))
    monkeypatch.setattr(client_follow_ups, "db", SimpleNamespace(client_follow_ups=rows))
    monkeypatch.setattr(client_follow_ups, "_client_or_404", AsyncMock(return_value={"id": "client"}))
    monkeypatch.setattr(client_follow_ups, "_owner_or_422", AsyncMock(return_value={"id": "owner", "name": "Account owner"}))
    audit = AsyncMock()
    monkeypatch.setattr(client_follow_ups, "_audit", audit)

    result = asyncio.run(client_follow_ups.create_client_follow_up("client", _create_data(), _user()))
    query, mutation = rows.update_one.call_args.args
    assert query["tenant_id"] == "tenant-a" and query["client_id"] == "client"
    written = mutation["$setOnInsert"]
    assert written["tenant_id"] == "tenant-a" and written["client_id"] == "client"
    assert written["owner_name"] == "Account owner"
    assert result["created"] is True
    audit.assert_awaited_once()
    assert audit.call_args.args[1:3] == ("client_follow_up_created", "client")
    assert audit.call_args.args[3]["follow_up_id"] == result["follow_up"]["id"]


def test_stale_write_is_not_audited(monkeypatch):
    existing = {
        "id": "follow-up", "client_id": "client", "tenant_id": "tenant-a", "status": "open",
        "version": 3, "title": "Original", "note": "", "kind": "task", "priority": "normal",
        "due_at": "2026-09-10T10:00:00+00:00", "owner_id": "tech", "owner_name": "Technician",
    }
    rows = SimpleNamespace(
        find_one=AsyncMock(return_value=existing),
        update_one=AsyncMock(return_value=SimpleNamespace(matched_count=0)),
    )
    monkeypatch.setattr(client_follow_ups, "db", SimpleNamespace(client_follow_ups=rows))
    monkeypatch.setattr(client_follow_ups, "_client_or_404", AsyncMock(return_value={"id": "client"}))
    audit = AsyncMock()
    monkeypatch.setattr(client_follow_ups, "_audit", audit)

    with pytest.raises(HTTPException) as error:
        asyncio.run(client_follow_ups.update_client_follow_up(
            "client", "follow-up", client_follow_ups.FollowUpUpdate(title="New", expected_version=3), _user(),
        ))
    assert error.value.status_code == 409
    query = rows.update_one.call_args.args[0]
    assert query == {"$and": [{"id": "follow-up", "client_id": "client", "version": 3}, {"tenant_id": "tenant-a"}]}
    audit.assert_not_awaited()


def test_repeat_completion_is_rejected_without_write_or_audit(monkeypatch):
    existing = {"id": "follow-up", "client_id": "client", "tenant_id": "tenant-a", "status": "completed", "version": 2}
    rows = SimpleNamespace(find_one=AsyncMock(return_value=existing), update_one=AsyncMock())
    monkeypatch.setattr(client_follow_ups, "db", SimpleNamespace(client_follow_ups=rows))
    monkeypatch.setattr(client_follow_ups, "_client_or_404", AsyncMock(return_value={"id": "client"}))
    audit = AsyncMock()
    monkeypatch.setattr(client_follow_ups, "_audit", audit)

    with pytest.raises(HTTPException) as error:
        asyncio.run(client_follow_ups.update_client_follow_up(
            "client", "follow-up", client_follow_ups.FollowUpUpdate(status="completed", expected_version=2), _user(),
        ))
    assert error.value.status_code == 409
    rows.update_one.assert_not_awaited()
    audit.assert_not_awaited()


def test_my_follow_ups_are_tenant_client_owner_scoped_and_safely_projected(monkeypatch):
    user = {
        "id": "tech", "name": "Technician", "tenant_id": "tenant-a",
        "client_scope_mode": "restricted", "client_scope_ids": ["client-a"],
    }
    follow_up_cursor = SimpleNamespace(to_list=AsyncMock(return_value=[
        {
            "_id": "internal-own", "id": "owned-follow-up", "tenant_id": "tenant-a",
            "idempotency_key": "retry-secret", "client_id": "client-a", "owner_id": "tech",
            "owner_name": "Technician", "title": "Review service coverage", "note": "Safe note",
            "kind": "review", "priority": "high", "status": "open", "due_at": "2026-09-10T10:00:00+00:00",
            "version": 1, "unexpected_internal": "must not leave the API",
        },
        {
            "_id": "internal-other-owner", "id": "other-owner-follow-up", "tenant_id": "tenant-a",
            "client_id": "client-a", "owner_id": "another-tech", "title": "Private commitment",
        },
        {
            "_id": "internal-other-client", "id": "other-client-follow-up", "tenant_id": "tenant-a",
            "client_id": "client-b", "owner_id": "tech", "title": "Out of scope client",
        },
    ]))
    follow_up_cursor.sort = Mock(return_value=follow_up_cursor)
    client_cursor = SimpleNamespace(to_list=AsyncMock(return_value=[{"id": "client-a", "name": "Allowed client"}]))
    follow_up_rows = SimpleNamespace(find=Mock(return_value=follow_up_cursor))
    client_rows = SimpleNamespace(find=Mock(return_value=client_cursor))
    monkeypatch.setattr(
        client_follow_ups,
        "db",
        SimpleNamespace(client_follow_ups=follow_up_rows, clients=client_rows),
    )

    response = asyncio.run(client_follow_ups.list_my_client_follow_ups(user))

    follow_up_query = follow_up_rows.find.call_args.args[0]
    assert follow_up_query == {
        "$and": [
            {"owner_id": "tech", "client_id": {"$in": ["client-a"]}},
            {"tenant_id": "tenant-a"},
        ],
    }
    assert follow_up_cursor.to_list.await_args.args == (client_follow_ups.MY_FOLLOW_UPS_LIMIT + 1,)

    parent_query = client_rows.find.call_args.args[0]
    assert parent_query == {
        "$and": [
            {"$and": [{"id": {"$in": ["client-a"]}}, {"id": {"$in": ["client-a"]}}]},
            {"tenant_id": "tenant-a"},
        ],
    }
    assert response == {
        "follow_ups": [{
            "id": "owned-follow-up", "client_id": "client-a", "client_name": "Allowed client",
            "title": "Review service coverage", "note": "Safe note", "kind": "review",
            "priority": "high", "status": "open", "due_at": "2026-09-10T10:00:00+00:00",
            "owner_id": "tech", "owner_name": "Technician", "version": 1,
        }],
        "limit": client_follow_ups.MY_FOLLOW_UPS_LIMIT,
        "possibly_truncated": False,
    }


def test_my_follow_ups_fail_closed_when_technician_has_no_client_scope(monkeypatch):
    rows = SimpleNamespace(find=Mock())
    clients = SimpleNamespace(find=Mock())
    monkeypatch.setattr(client_follow_ups, "db", SimpleNamespace(client_follow_ups=rows, clients=clients))
    user = {
        "id": "tech", "name": "Technician", "tenant_id": "tenant-a",
        "client_scope_mode": "restricted", "client_scope_ids": [],
    }

    response = asyncio.run(client_follow_ups.list_my_client_follow_ups(user))

    assert response == {
        "follow_ups": [],
        "limit": client_follow_ups.MY_FOLLOW_UPS_LIMIT,
        "possibly_truncated": False,
    }
    rows.find.assert_not_called()
    clients.find.assert_not_called()


def test_my_follow_ups_bound_the_portfolio_and_report_truncation(monkeypatch):
    rows_payload = [
        {
            "id": f"follow-up-{index}", "tenant_id": "tenant-a", "client_id": "client-a",
            "owner_id": "tech", "title": f"Commitment {index}", "status": "open",
        }
        for index in range(client_follow_ups.MY_FOLLOW_UPS_LIMIT + 1)
    ]
    follow_up_cursor = SimpleNamespace(to_list=AsyncMock(return_value=rows_payload))
    follow_up_cursor.sort = Mock(return_value=follow_up_cursor)
    client_cursor = SimpleNamespace(to_list=AsyncMock(return_value=[{"id": "client-a", "name": "Client A"}]))
    follow_up_rows = SimpleNamespace(find=Mock(return_value=follow_up_cursor))
    client_rows = SimpleNamespace(find=Mock(return_value=client_cursor))
    monkeypatch.setattr(
        client_follow_ups,
        "db",
        SimpleNamespace(client_follow_ups=follow_up_rows, clients=client_rows),
    )
    user = {"id": "tech", "name": "Technician", "tenant_id": "tenant-a", "client_scope_mode": "all"}

    response = asyncio.run(client_follow_ups.list_my_client_follow_ups(user))

    assert len(response["follow_ups"]) == client_follow_ups.MY_FOLLOW_UPS_LIMIT
    assert response["possibly_truncated"] is True
    assert response["follow_ups"][-1]["id"] == f"follow-up-{client_follow_ups.MY_FOLLOW_UPS_LIMIT - 1}"


def test_write_routes_have_dedicated_follow_up_permission():
    writes = [
        route for route in client_follow_ups.router.routes
        if route.path.startswith("/clients/{client_id}/follow-ups") and route.methods & {"POST", "PUT"}
    ]
    assert len(writes) == 2
    assert all(route.dependant.dependencies for route in writes)
