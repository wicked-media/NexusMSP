import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.routers import clients_contacts
from app.services.client_contacts import editable_contact, contact_delete_pipeline, contact_map_pipeline


def _user():
    return {"id": "tech", "name": "Tech", "tenant_id": "tenant-a"}


def _mutation_context(monkeypatch, client):
    clients = SimpleNamespace(update_one=AsyncMock(return_value=SimpleNamespace(matched_count=1)))
    monkeypatch.setattr(clients_contacts, "db", SimpleNamespace(clients=clients))
    monkeypatch.setattr(clients_contacts, "_client_or_404", AsyncMock(return_value=client))
    monkeypatch.setattr(clients_contacts, "log_activity", AsyncMock())
    return clients


def test_contact_validation_ignores_server_owned_input_and_bounds_values():
    assert editable_contact({
        "name": "  Ada Lovelace  ", "email": " ada@example.com ", "phone": None,
        "role": "technical", "is_primary": False, "id": "forged", "created_at": "forged",
    }) == {
        "name": "Ada Lovelace", "email": "ada@example.com", "phone": "",
        "role": "technical", "is_primary": False,
    }
    for payload in ({"name": 9}, {"name": "A", "role": "owner"}, {"name": "A", "is_primary": "yes"}, {"name": "A" * 241}):
        with pytest.raises(HTTPException) as error:
            editable_contact(payload)
        assert error.value.status_code == 422


def test_add_is_tenant_scoped_primary_safe_and_audited(monkeypatch):
    clients = _mutation_context(monkeypatch, {"id": "client", "contacts": [{"id": "old", "is_primary": True}]})
    result = asyncio.run(clients_contacts.add_client_contact("client", {
        "name": "Ada", "email": "ada@example.com", "role": "technical", "is_primary": True,
        "id": "forged", "created_at": "forged",
    }, _user()))
    query, pipeline = clients.update_one.call_args.args
    assert query["$and"][0]["id"] == "client"
    assert query["$and"][0]["$expr"] == {"$lt": [{"$size": {"$ifNull": ["$contacts", []]}}, 100]}
    assert query["$and"][1] == {"tenant_id": "tenant-a"}
    assert pipeline[0]["$set"]["contacts"]["$concatArrays"][1]["$literal"][0]["id"] == result["id"]
    assert result["is_primary"] is True
    assert "forged" not in result
    assert clients_contacts.log_activity.call_args.args[2:4] == ("client", "client")
    assert clients_contacts.log_activity.call_args.kwargs["changes"]["contact_id"] == result["id"]
    assert clients_contacts.log_activity.call_args.kwargs["metadata"] == {
        "tenant_id": "tenant-a", "contact_id": result["id"],
    }


def test_first_contact_becomes_primary(monkeypatch):
    _mutation_context(monkeypatch, {"id": "client", "contacts": []})
    result = asyncio.run(clients_contacts.add_client_contact("client", {"name": "First"}, _user()))
    assert result["is_primary"] is True


def test_update_uses_atomic_map_and_clears_other_primary(monkeypatch):
    clients = _mutation_context(monkeypatch, {"id": "client", "contacts": [
        {"id": "one", "name": "One", "email": "", "phone": "", "role": "general", "is_primary": True},
        {"id": "two", "name": "Two", "email": "", "phone": "", "role": "general", "is_primary": False},
    ]})
    asyncio.run(clients_contacts.update_client_contact("client", "two", {"is_primary": True}, _user()))
    query, pipeline = clients.update_one.call_args.args
    assert query == {"$and": [{"id": "client", "contacts.id": "two"}, {"tenant_id": "tenant-a"}]}
    text = str(pipeline)
    assert "$map" in text and "is_primary" in text and "updated_at" in text
    assert clients_contacts.log_activity.await_count == 1


def test_delete_is_tenant_scoped_and_audited(monkeypatch):
    clients = _mutation_context(monkeypatch, {"id": "client", "contacts": [{"id": "one", "name": "Ada"}]})
    asyncio.run(clients_contacts.delete_client_contact("client", "one", _user()))
    query, update = clients.update_one.call_args.args
    assert query == {"$and": [{"id": "client", "contacts.id": "one"}, {"tenant_id": "tenant-a"}]}
    assert "$filter" in str(update)
    assert clients_contacts.log_activity.await_count == 1


def test_client_lookup_uses_tenant_query_before_client_scope(monkeypatch):
    clients = SimpleNamespace(find_one=AsyncMock(return_value={"id": "client"}))
    monkeypatch.setattr(clients_contacts, "db", SimpleNamespace(clients=clients))
    scope = AsyncMock()
    monkeypatch.setattr(clients_contacts, "assert_client_scope", scope)
    asyncio.run(clients_contacts._client_or_404("client", _user()))
    assert clients.find_one.call_args.args[0] == {"$and": [{"id": "client"}, {"tenant_id": "tenant-a"}]}
    scope.assert_awaited_once()


def test_primary_pipeline_replaces_only_target_contact():
    pipeline = contact_map_pipeline("two", {"id": "two", "name": "Two", "is_primary": True})
    text = str(pipeline)
    assert "$$contact.id" in text
    assert "two" in text
    assert "$literal" in text


def test_primary_delete_promotes_next_contact_and_last_contact_can_be_removed():
    promote = str(contact_delete_pipeline("one", "two"))
    last = str(contact_delete_pipeline("one", None))
    assert "$filter" in promote and "two" in promote and "is_primary" in promote
    assert "$filter" in last and "$map" not in last


def test_concurrent_target_miss_is_not_audited(monkeypatch):
    clients = _mutation_context(monkeypatch, {"id": "client", "contacts": [{"id": "one", "name": "Ada"}]})
    clients.update_one.return_value = SimpleNamespace(matched_count=0)
    with pytest.raises(HTTPException) as error:
        asyncio.run(clients_contacts.delete_client_contact("client", "one", _user()))
    assert error.value.status_code == 409
    clients_contacts.log_activity.assert_not_awaited()


def test_write_routes_require_contact_permission():
    paths = {
        "/clients/{client_id}/contacts",
        "/clients/{client_id}/contacts/{contact_id}",
    }
    writes = [route for route in clients_contacts.router.routes if route.path in paths and route.methods & {"POST", "PUT", "DELETE"}]
    assert len(writes) == 3
    assert all(route.dependant.dependencies for route in writes)
