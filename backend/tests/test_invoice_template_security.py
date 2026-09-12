"""Focused guardrails for organisation-wide invoice document templates.

Document templates are global commercial configuration, not client records.
These regressions prove that restricted technicians cannot enumerate or alter
them, and that a single MongoDB settings pointer owns the default selection
without the historical clear-all / set-one race.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import invoice_pdf_templates as templates
from app.services import action_permissions, scope_permissions


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$exists" in expected and (key in row) != bool(expected["$exists"]):
                return False
            continue
        if actual != expected:
            return False
    return True


def _project(row: dict[str, Any], projection: dict[str, Any] | None) -> dict[str, Any]:
    if not projection:
        return deepcopy(row)
    included = {key for key, enabled in projection.items() if key != "_id" and enabled}
    if included:
        return {key: deepcopy(row[key]) for key in included if key in row}
    return {key: deepcopy(value) for key, value in row.items() if projection.get(key, 1)}


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, *_args: Any, **_kwargs: Any):
        return self

    async def to_list(self, _limit: int) -> list[dict[str, Any]]:
        return deepcopy(self.rows)


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])
        self.update_many_calls = 0

    async def find_one(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return next((_project(row, _projection) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return _Cursor([_project(row, _projection) for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], *, upsert: bool = False, **_kwargs: Any):
        for row in self.rows:
            if not _matches(row, query):
                continue
            row.update(deepcopy(update.get("$set", {})))
            for field, value in update.get("$inc", {}).items():
                row[field] = row.get(field, 0) + value
            return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)

        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)

        document = {
            key: value
            for key, value in query.items()
            if not key.startswith("$") and not isinstance(value, dict)
        }
        document.update(deepcopy(update.get("$setOnInsert", {})))
        document.update(deepcopy(update.get("$set", {})))
        self.rows.append(document)
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=document.get("id") or document.get("key"))

    async def update_many(self, query: dict[str, Any], update: dict[str, Any], **_kwargs: Any):
        self.update_many_calls += 1
        matched = 0
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                matched += 1
        return SimpleNamespace(matched_count=matched, modified_count=matched)

    async def delete_one(self, query: dict[str, Any]):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            invoice_pdf_templates=_Collection(
                [
                    {
                        "id": "template-a",
                        "name": "Template A",
                        "doc_type": "invoice",
                        "layout": "classic",
                        "is_preset": False,
                        "is_default": False,
                    },
                    {
                        "id": "template-b",
                        "name": "Template B",
                        "doc_type": "invoice",
                        "layout": "executive",
                        "is_preset": False,
                        "is_default": False,
                    },
                ]
            ),
            settings=_Collection(),
            activity_logs=_Collection(),
            scope_denials=_Collection(),
        )


def _restricted_user() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Restricted technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _global_admin() -> dict[str, Any]:
    return {
        "id": "admin-a",
        "name": "Administrator",
        "role": "admin",
        "is_admin": True,
        "client_scope_mode": "all",
    }


def _install(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(templates, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    async def _no_seed() -> None:
        return None

    async def _audit(
        user: dict,
        action: str,
        entity_type: str,
        entity_id: str,
        entity_name: str = "",
        details: str = "",
        changes: dict | None = None,
        metadata: dict | None = None,
    ) -> None:
        await database.activity_logs.insert_one(
            {
                "user_id": user.get("id"),
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "entity_name": entity_name,
                "details": details,
                "changes": changes or {},
                "metadata": metadata or {},
            }
        )

    monkeypatch.setattr(templates, "_ensure_presets_seeded", _no_seed)
    monkeypatch.setattr(templates, "log_activity", _audit)
    return database


def test_document_template_action_is_explicit_and_not_a_technician_or_manager_default():
    action = action_permissions.ACTION_PERMISSION_BY_ID["billing.document_template.manage"]
    assert action["category"] == "Billing"
    assert "legacy" not in action
    assert "billing.document_template.manage" not in action_permissions.TECHNICIAN_DEFAULTS
    assert "billing.document_template.manage" not in action_permissions.SERVICE_DESK_MANAGER_DEFAULTS


def test_restricted_user_cannot_read_or_change_global_templates(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_restricted_user_cannot_read_or_change_global_templates(monkeypatch))


async def _test_restricted_user_cannot_read_or_change_global_templates(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install(monkeypatch)
    user = _restricted_user()

    with pytest.raises(HTTPException) as listed:
        await templates.list_templates(current_user=user)
    assert listed.value.status_code == 403

    with pytest.raises(HTTPException) as defaulted:
        await templates.set_default("template-a", current_user=user)
    assert defaulted.value.status_code == 403
    assert database.settings.rows == []
    assert [item["operation"] for item in database.scope_denials.rows] == [
        "billing.document_template.list",
        "billing.document_template.set_default",
    ]


def test_default_selection_uses_one_atomic_pointer_and_canonical_flags(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_default_selection_uses_one_atomic_pointer_and_canonical_flags(monkeypatch))


async def _test_default_selection_uses_one_atomic_pointer_and_canonical_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install(monkeypatch)
    admin = _global_admin()

    first = await templates.set_default("template-a", current_user=admin)
    second = await templates.set_default("template-b", current_user=admin)
    assert first["template_id"] == "template-a"
    assert second["template_id"] == "template-b"

    pointers = [row for row in database.settings.rows if row["key"] == "invoice_template_default:invoice"]
    assert len(pointers) == 1
    assert pointers[0]["template_id"] == "template-b"
    # The old clear-all then set-one approach is intentionally gone.  The
    # pointer remains the only authoritative default selection.
    assert database.invoice_pdf_templates.update_many_calls == 0

    listed = await templates.list_templates(include_presets=False, current_user=admin)
    assert {template["id"]: template["is_default"] for template in listed} == {
        "template-a": False,
        "template-b": True,
    }
    resolved = await templates._resolve_default_template("invoice")
    assert resolved and resolved["id"] == "template-b"
    audit = database.activity_logs.rows[-1]
    assert audit["action"] == "default_changed"
    assert audit["metadata"]["previous_template_id"] == "template-a"


def test_default_template_cannot_be_deleted_or_retyped(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_default_template_cannot_be_deleted_or_retyped(monkeypatch))


async def _test_default_template_cannot_be_deleted_or_retyped(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install(monkeypatch)
    admin = _global_admin()
    await templates.set_default("template-a", current_user=admin)

    with pytest.raises(HTTPException) as deleted:
        await templates.delete_template("template-a", current_user=admin)
    assert deleted.value.status_code == 409
    assert any(row["id"] == "template-a" for row in database.invoice_pdf_templates.rows)

    with pytest.raises(HTTPException) as retyped:
        await templates.update_template("template-a", {"doc_type": "estimate"}, current_user=admin)
    assert retyped.value.status_code == 409


def test_template_mutations_are_audited_without_recording_full_template_content(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_template_mutations_are_audited_without_recording_full_template_content(monkeypatch))


async def _test_template_mutations_are_audited_without_recording_full_template_content(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install(monkeypatch)
    admin = _global_admin()

    created = await templates.create_template(
        {
            "name": "Commercial Invoice",
            "doc_type": "invoice",
            "blocks": [{"key": "bank_details", "content": "Sensitive bank instruction"}],
        },
        current_user=admin,
    )
    await templates.update_template(
        created["id"],
        {"name": "Commercial Invoice v2", "blocks": [{"key": "bank_details", "content": "Another sensitive instruction"}]},
        current_user=admin,
    )
    await templates.duplicate_template(created["id"], current_user=admin)
    await templates.delete_template(created["id"], current_user=admin)

    actions = [row["action"] for row in database.activity_logs.rows]
    assert actions == ["created", "updated", "duplicated", "deleted"]
    update_audit = database.activity_logs.rows[1]
    assert update_audit["metadata"]["fields"] == ["blocks", "name"]
    assert "Sensitive bank instruction" not in str(database.activity_logs.rows)
    assert "Another sensitive instruction" not in str(database.activity_logs.rows)
