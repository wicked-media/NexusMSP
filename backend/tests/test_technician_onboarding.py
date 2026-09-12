"""Focused contracts for account-owned technician onboarding evidence."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import auth, technician_onboarding
from app.services.technician_onboarding import TECHNICIAN_ONBOARDING_STEPS


def _get_path(document: dict, path: str):
    value = document
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None, False
        value = value[part]
    return value, True


def _set_path(document: dict, path: str, value):
    target = document
    parts = path.split(".")
    for part in parts[:-1]:
        target = target.setdefault(part, {})
    target[parts[-1]] = deepcopy(value)


def _matches(document: dict, query: dict) -> bool:
    for path, expected in (query or {}).items():
        value, exists = _get_path(document, path)
        if isinstance(expected, dict):
            if "$ne" in expected and exists and value == expected["$ne"]:
                return False
            if "$exists" in expected and bool(expected["$exists"]) != exists:
                return False
        elif not exists or value != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = deepcopy(rows)

    def sort(self, *_args):
        return self

    async def to_list(self, limit):
        return deepcopy(self.rows[:limit])


class _Users:
    def __init__(self, rows):
        self.rows = deepcopy(rows)

    async def find_one(self, query, _projection=None):
        row = next((candidate for candidate in self.rows if _matches(candidate, query)), None)
        return deepcopy(row) if row else None

    def find(self, query, _projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def update_one(self, query, update, **_kwargs):
        row = next((candidate for candidate in self.rows if _matches(candidate, query)), None)
        if not row:
            return SimpleNamespace(matched_count=0, modified_count=0)
        for path, value in update.get("$set", {}).items():
            _set_path(row, path, value)
        for path, value in update.get("$push", {}).items():
            values, exists = _get_path(row, path)
            if not exists or not isinstance(values, list):
                _set_path(row, path, [value])
            else:
                values.append(deepcopy(value))
        return SimpleNamespace(matched_count=1, modified_count=1)


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(users=_Users([
            {"id": "tech-a", "name": "Alex Technician", "email": "alex@nexus.example", "role": "technician", "is_active": True},
            {"id": "admin-a", "name": "Ada Admin", "email": "ada@nexus.example", "role": "admin", "is_admin": True, "is_active": True},
        ]))


def _technician():
    return {"id": "tech-a", "name": "Alex Technician", "role": "technician"}


def _admin():
    return {"id": "admin-a", "name": "Ada Admin", "role": "admin", "is_admin": True}


def test_me_initialises_account_owned_checklist_and_auth_flags(monkeypatch):
    database = _Database()
    monkeypatch.setattr(technician_onboarding, "db", database)
    monkeypatch.setattr(auth, "db", database)

    result = asyncio.run(technician_onboarding.get_my_technician_onboarding(current_user=_technician()))
    flags = asyncio.run(auth._technician_onboarding_flags(_technician()))

    onboarding = result["onboarding"]
    assert onboarding["must_complete_before_operational_work"] is True
    assert onboarding["is_compliant"] is False
    assert [step["id"] for step in onboarding["steps"]] == [step["id"] for step in TECHNICIAN_ONBOARDING_STEPS]
    assert onboarding["audit_log"][0]["evidence_type"] == "system_initialized"
    assert flags == {"onboarding_required": True, "is_onboarding_compliant": False}


def test_auth_me_exposes_gate_flags_without_leaking_onboarding_evidence(monkeypatch):
    database = _Database()
    monkeypatch.setattr(auth, "db", database)

    result = asyncio.run(auth.get_me(current_user=_technician()))

    assert result["onboarding_required"] is True
    assert result["is_onboarding_compliant"] is False
    assert "technician_onboarding" not in result


def test_step_completion_is_attested_audited_and_idempotent(monkeypatch):
    database = _Database()
    events = []

    async def _audit(*args, **kwargs):
        events.append({"args": args, "kwargs": kwargs})

    monkeypatch.setattr(technician_onboarding, "db", database)
    monkeypatch.setattr(technician_onboarding, "log_activity", _audit)

    first = asyncio.run(
        technician_onboarding.complete_my_technician_onboarding_step(
            "ticket-lifecycle", {"acknowledged": True}, current_user=_technician()
        )
    )
    second = asyncio.run(
        technician_onboarding.complete_my_technician_onboarding_step(
            "ticket-lifecycle", {"acknowledged": True}, current_user=_technician()
        )
    )

    first_step = next(step for step in first["onboarding"]["steps"] if step["id"] == "ticket-lifecycle")
    second_step = next(step for step in second["onboarding"]["steps"] if step["id"] == "ticket-lifecycle")
    assert first["changed"] is True
    assert second["changed"] is False
    assert first_step["evidence"]["type"] == "technician_attestation"
    assert second_step["completed_at"] == first_step["completed_at"]
    assert len(events) == 1


def test_final_completion_marks_the_account_compliant(monkeypatch):
    database = _Database()

    async def _audit(*_args, **_kwargs):
        return None

    monkeypatch.setattr(technician_onboarding, "db", database)
    monkeypatch.setattr(technician_onboarding, "log_activity", _audit)

    for step in TECHNICIAN_ONBOARDING_STEPS:
        result = asyncio.run(
            technician_onboarding.complete_my_technician_onboarding_step(
                step["id"], {"acknowledged": True}, current_user=_technician()
            )
        )

    onboarding = result["onboarding"]
    assert onboarding["status"] == "compliant"
    assert onboarding["is_compliant"] is True
    assert onboarding["must_complete_before_operational_work"] is False
    assert onboarding["completed_steps"] == onboarding["total_required_steps"]
    assert onboarding["completed_at"]


def test_step_requires_acknowledgement_and_foreign_profile_is_denied(monkeypatch):
    database = _Database()
    monkeypatch.setattr(technician_onboarding, "db", database)

    with pytest.raises(HTTPException) as acknowledgement_error:
        asyncio.run(
            technician_onboarding.complete_my_technician_onboarding_step(
                "ticket-lifecycle", {"acknowledged": False}, current_user=_technician()
            )
        )
    assert acknowledgement_error.value.status_code == 400

    with pytest.raises(HTTPException) as scope_error:
        asyncio.run(
            technician_onboarding.get_technician_onboarding("admin-a", current_user=_technician())
        )
    assert scope_error.value.status_code == 403


def test_admin_team_view_is_compact_and_does_not_expose_evidence(monkeypatch):
    database = _Database()
    monkeypatch.setattr(technician_onboarding, "db", database)

    result = asyncio.run(technician_onboarding.list_technician_onboarding(current_user=_admin()))

    assert result["summary"]["total"] == 2
    assert result["summary"]["required"] == 2
    assert {row["technician_id"] for row in result["technicians"]} == {"tech-a", "admin-a"}
    assert all("audit_log" not in row and "steps" not in row for row in result["technicians"])


def test_admin_team_view_deduplicates_legacy_user_ids(monkeypatch):
    database = _Database()
    database.users.rows.append({
        "id": "tech-a",
        "name": "Alex Technician (legacy duplicate)",
        "email": "alex@nexus.example",
        "role": "technician",
        "is_active": True,
    })
    monkeypatch.setattr(technician_onboarding, "db", database)

    result = asyncio.run(technician_onboarding.list_technician_onboarding(current_user=_admin()))

    assert result["summary"]["total"] == 2
    assert {row["technician_id"] for row in result["technicians"]} == {"tech-a", "admin-a"}
    assert sum(row["technician_id"] == "tech-a" for row in result["technicians"]) == 1
