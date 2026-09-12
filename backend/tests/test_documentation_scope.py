"""Regression coverage for client-owned and shared documentation boundaries."""

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

from app.routers import it_docs  # noqa: E402
from app.services import scope_permissions  # noqa: E402


def _matches(row, query):
    for key, expected in query.items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue
        value = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and value not in expected["$in"]:
                return False
            if "$exists" in expected and (key in row) != bool(expected["$exists"]):
                return False
        elif value != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, limit):
        return self.rows[:limit]


class _Rows:
    def __init__(self, rows=()):
        self.rows = [dict(row) for row in rows]
        self.find_queries = []
        self.find_one_queries = []
        self.update_calls = []
        self.delete_calls = []
        self.inserted = []

    def find(self, query, _projection=None):
        self.find_queries.append(query)
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def find_one(self, query, _projection=None):
        self.find_one_queries.append(query)
        for row in self.rows:
            if _matches(row, query):
                return dict(row)
        return None

    async def insert_one(self, row):
        self.inserted.append(dict(row))
        self.rows.append(dict(row))

    async def update_one(self, query, update):
        self.update_calls.append((query, update))
        for row in self.rows:
            if not _matches(row, query):
                continue
            for key, value in update.get("$set", {}).items():
                row[key] = value
            for key, value in update.get("$inc", {}).items():
                row[key] = row.get(key, 0) + value
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_one(self, query):
        self.delete_calls.append(query)
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class _Denials:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(dict(row))


def _restricted_user(*client_ids):
    return {
        "id": "tech-a",
        "name": "Technician A",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": list(client_ids or ("client-a",)),
    }


def _client(client_id, name):
    return {"id": client_id, "name": name}


async def _no_activity(*_args, **_kwargs):
    return None


def _set_scope_denials(monkeypatch):
    denials = _Denials()
    monkeypatch.setattr(scope_permissions, "db", SimpleNamespace(scope_denials=denials))
    return denials


def test_restricted_documentation_list_keeps_global_and_owned_docs_but_not_foreign_templates(monkeypatch):
    docs = _Rows([
        {"id": "global-none", "client_id": None, "is_template": False},
        {"id": "global-empty", "client_id": "", "is_template": False},
        {"id": "global-missing", "is_template": False},
        {"id": "client-a", "client_id": "client-a", "is_template": False},
        {"id": "client-b", "client_id": "client-b", "is_template": False},
        {"id": "template-a", "client_id": "client-a", "is_template": True},
        {"id": "template-b", "client_id": "client-b", "is_template": True},
        {"id": "template-global", "client_id": None, "is_template": True},
    ])
    monkeypatch.setattr(it_docs, "db", SimpleNamespace(documentation=docs, clients=_Rows()))

    regular = asyncio.run(it_docs.get_documentation_pages(current_user=_restricted_user()))
    templates = asyncio.run(it_docs.get_documentation_pages(is_template=True, current_user=_restricted_user()))

    assert {row["id"] for row in regular} == {"global-none", "global-empty", "global-missing", "client-a"}
    assert {row["id"] for row in templates} == {"template-a", "template-global"}
    assert "client-b" not in str(docs.find_queries)
    assert "template-b" not in {row["id"] for row in templates}


def test_foreign_document_detail_is_masked_before_view_count_mutation(monkeypatch):
    docs = _Rows([{"id": "doc-b", "client_id": "client-b", "title": "Client B plan", "view_count": 0}])
    denials = _set_scope_denials(monkeypatch)
    monkeypatch.setattr(it_docs, "db", SimpleNamespace(documentation=docs))

    with pytest.raises(HTTPException) as denied:
        asyncio.run(it_docs.get_documentation_page("doc-b", _restricted_user()))

    assert denied.value.status_code == 404
    assert denied.value.detail == "Resource not found"
    assert docs.update_calls == []
    assert denials.rows[0]["operation"] == "documentation.read"


def test_foreign_client_document_list_and_create_are_denied_before_reads_or_inserts(monkeypatch):
    docs = _Rows()
    clients = _Rows([_client("client-b", "Client B")])
    denials = _set_scope_denials(monkeypatch)
    monkeypatch.setattr(it_docs, "db", SimpleNamespace(documentation=docs, clients=clients))

    with pytest.raises(HTTPException) as listed:
        asyncio.run(it_docs.get_documentation_pages(client_id="client-b", current_user=_restricted_user()))
    with pytest.raises(HTTPException) as created:
        asyncio.run(it_docs.create_documentation_page(
            {"client_id": "client-b", "title": "Foreign", "content": "Never write this."},
            _restricted_user(),
        ))

    assert listed.value.status_code == created.value.status_code == 404
    assert listed.value.detail == created.value.detail == "Resource not found"
    assert docs.find_queries == []
    assert docs.inserted == []
    assert [row["operation"] for row in denials.rows] == [
        "documentation.list.client",
        "documentation.create",
    ]


def test_documentation_update_cannot_rehome_an_owned_doc_to_a_foreign_client(monkeypatch):
    docs = _Rows([{"id": "doc-a", "client_id": "client-a", "client_name": "Client A", "title": "Owned", "content": "Safe"}])
    clients = _Rows([_client("client-b", "Client B")])
    _set_scope_denials(monkeypatch)
    monkeypatch.setattr(it_docs, "db", SimpleNamespace(documentation=docs, clients=clients))

    with pytest.raises(HTTPException) as denied:
        asyncio.run(it_docs.update_documentation_page(
            "doc-a",
            {"client_id": "client-b", "title": "Foreign target"},
            _restricted_user(),
        ))

    assert denied.value.status_code == 404
    assert denied.value.detail == "Resource not found"
    assert docs.update_calls == []
    assert docs.rows[0]["client_id"] == "client-a"


def test_documentation_update_allows_a_move_only_when_both_clients_are_in_scope(monkeypatch):
    docs = _Rows([{"id": "doc-a", "client_id": "client-a", "client_name": "Client A", "title": "Owned", "content": "Safe"}])
    clients = _Rows([_client("client-a", "Client A"), _client("client-b", "Client B")])
    _set_scope_denials(monkeypatch)
    monkeypatch.setattr(it_docs, "db", SimpleNamespace(documentation=docs, clients=clients))
    monkeypatch.setattr(it_docs, "log_activity", _no_activity)

    response = asyncio.run(it_docs.update_documentation_page(
        "doc-a",
        {"client_id": "client-b", "title": "Re-homed"},
        _restricted_user("client-a", "client-b"),
    ))

    assert response == {"message": "Documentation updated"}
    assert docs.rows[0]["client_id"] == "client-b"
    assert docs.rows[0]["client_name"] == "Client B"
    assert docs.rows[0]["title"] == "Re-homed"


def test_documentation_move_cannot_keep_a_parent_from_the_old_client(monkeypatch):
    docs = _Rows([
        {"id": "parent-a", "client_id": "client-a", "title": "Client A parent", "content": "Parent"},
        {"id": "doc-a", "client_id": "client-a", "client_name": "Client A", "title": "Owned", "content": "Safe", "parent_id": "parent-a"},
    ])
    clients = _Rows([_client("client-a", "Client A"), _client("client-b", "Client B")])
    _set_scope_denials(monkeypatch)
    monkeypatch.setattr(it_docs, "db", SimpleNamespace(documentation=docs, clients=clients))

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(it_docs.update_documentation_page(
            "doc-a",
            {"client_id": "client-b"},
            _restricted_user("client-a", "client-b"),
        ))

    assert rejected.value.status_code == 422
    assert rejected.value.detail == "Parent documentation must belong to the same client scope"
    assert docs.update_calls == []
    assert next(row for row in docs.rows if row["id"] == "doc-a")["client_id"] == "client-a"


def test_global_docs_remain_readable_but_restricted_technicians_cannot_mutate_or_publish_them(monkeypatch):
    docs = _Rows([{"id": "global", "client_id": "", "title": "Shared SOP", "content": "Read me", "view_count": 0}])
    denials = _set_scope_denials(monkeypatch)
    monkeypatch.setattr(it_docs, "db", SimpleNamespace(documentation=docs, clients=_Rows()))

    read = asyncio.run(it_docs.get_documentation_page("global", _restricted_user()))
    with pytest.raises(HTTPException) as updated:
        asyncio.run(it_docs.update_documentation_page("global", {"title": "No"}, _restricted_user()))
    with pytest.raises(HTTPException) as created:
        asyncio.run(it_docs.create_documentation_page(
            {"client_id": "   ", "title": "Global", "content": "No publish"},
            _restricted_user(),
        ))
    with pytest.raises(HTTPException) as deleted:
        asyncio.run(it_docs.delete_documentation_page("global", _restricted_user()))

    assert read["id"] == "global"
    assert docs.rows[0]["view_count"] == 1
    assert updated.value.status_code == created.value.status_code == deleted.value.status_code == 403
    assert docs.rows[0]["title"] == "Shared SOP"
    assert [row["operation"] for row in denials.rows] == [
        "documentation.update.global",
        "documentation.create",
        "documentation.delete.global",
    ]


def test_documentation_delete_masks_a_foreign_record(monkeypatch):
    docs = _Rows([{"id": "doc-b", "client_id": "client-b", "title": "Client B plan"}])
    _set_scope_denials(monkeypatch)
    monkeypatch.setattr(it_docs, "db", SimpleNamespace(documentation=docs))

    with pytest.raises(HTTPException) as denied:
        asyncio.run(it_docs.delete_documentation_page("doc-b", _restricted_user()))

    assert denied.value.status_code == 404
    assert denied.value.detail == "Resource not found"
    assert docs.delete_calls == []
