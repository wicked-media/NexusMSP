"""Regression coverage for Blueprint-to-project ticket-plan integrity."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import blueprints, projects


def _matches(row, query):
    for field, expected in query.items():
        actual = row.get(field)
        if isinstance(expected, dict) and "$in" in expected:
            if actual not in expected["$in"]:
                return False
        elif actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    async def to_list(self, limit):
        return self.rows[:limit]


class _Rows:
    def __init__(self, rows=()):
        self.rows = list(rows)

    async def find_one(self, query, *_args, **_kwargs):
        return next((row for row in self.rows if _matches(row, query)), None)

    def find(self, query, *_args, **_kwargs):
        return _Cursor(row for row in self.rows if _matches(row, query))


class _Plans(_Rows):
    def __init__(self, rows=()):
        super().__init__(rows)
        self.indexes = []

    async def create_index(self, *args, **kwargs):
        self.indexes.append((args, kwargs))

    async def update_one(self, query, update, *_args, **_kwargs):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set", {}))
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)


class _Clients(_Rows):
    async def update_one(self, query, update, *_args, **_kwargs):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set", {}))
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)


def _project():
    return {"id": "project-1", "client_id": "client-1", "name": "Client onboarding", "project_manager": "pm-1"}


def _plan(status="ready"):
    return {
        "id": "plan-1",
        "project_id": "project-1",
        "client_id": "client-1",
        "blueprint_id": "blueprint-1",
        "parent_ticket_id": "parent-1",
        "child_ticket_ids": ["child-1"],
        "child_ticket_count": 1,
        "status": status,
    }


def _parent():
    return {
        "id": "parent-1",
        "client_id": "client-1",
        "project_id": "project-1",
        "project_ticket_plan_id": "plan-1",
        "project_ticket_plan_role": "parent",
        "child_ticket_ids": ["child-1"],
        "child_ticket_count": 1,
    }


def _child(client_id="client-1"):
    return {
        "id": "child-1",
        "parent_id": "parent-1",
        "client_id": client_id,
        "project_id": "project-1",
        "project_ticket_plan_id": "plan-1",
        "project_ticket_plan_role": "child",
    }


def test_ready_ticket_plan_requires_every_scoped_child(monkeypatch):
    tickets = _Rows([_parent(), _child()])
    monkeypatch.setattr(projects, "db", SimpleNamespace(tickets=tickets))

    assert asyncio.run(projects._project_ticket_plan_is_ready(_plan(), _project())) is True

    tickets.rows[1]["client_id"] = "other-client"
    assert asyncio.run(projects._project_ticket_plan_is_ready(_plan(), _project())) is False


def test_launch_refuses_to_lie_about_a_partial_existing_plan(monkeypatch):
    partial_plan = _plan()
    database = SimpleNamespace(
        blueprints=_Rows([{"id": "blueprint-1", "active": True, "name": "Delivery plan"}]),
        project_ticket_plans=_Plans([partial_plan]),
        tickets=_Rows([_parent()]),
    )

    async def project_or_404(*_args, **_kwargs):
        return _project()

    monkeypatch.setattr(projects, "db", database)
    monkeypatch.setattr(projects, "_project_or_404", project_or_404)

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            projects.create_project_ticket_plan(
                "project-1",
                {"blueprint_id": "blueprint-1"},
                {"id": "pm-1", "name": "Project Manager", "role": "technician"},
            )
        )

    assert error.value.status_code == 409
    assert "incomplete" in error.value.detail


def test_failed_plan_is_marked_as_needing_attention(monkeypatch):
    plans = _Plans([_plan(status="provisioning")])
    monkeypatch.setattr(projects, "db", SimpleNamespace(project_ticket_plans=plans))

    asyncio.run(projects._mark_project_ticket_plan_failed("plan-1"))

    assert plans.rows[0]["status"] == "failed"
    assert plans.rows[0]["failure_code"] == "ticket_tree_provisioning_failed"
    assert plans.rows[0]["failed_at"]


def test_bulk_blueprint_push_validates_every_client_before_mutating(monkeypatch):
    clients = _Clients([
        {"id": "client-1", "blueprint_ids": [], "default_blueprint_id": None},
        {"id": "client-2", "blueprint_ids": [], "default_blueprint_id": None},
    ])
    database = SimpleNamespace(
        blueprints=_Rows([{"id": "blueprint-1", "name": "Delivery plan", "active": True}]),
        clients=clients,
    )
    validated = []

    async def assert_client_scope(_user, client_id, **_kwargs):
        validated.append(client_id)
        if client_id == "client-2":
            raise HTTPException(status_code=403, detail="Client is outside your delegated scope")

    monkeypatch.setattr(blueprints, "db", database)
    monkeypatch.setattr(blueprints, "assert_client_scope", assert_client_scope)

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            blueprints.push_blueprint_to_clients(
                "blueprint-1",
                {"client_ids": ["client-1", "client-2"], "make_default": True},
                {"id": "technician-1"},
            )
        )

    assert error.value.status_code == 403
    assert validated == ["client-1", "client-2"]
    assert clients.rows[0]["blueprint_ids"] == []
    assert clients.rows[1]["blueprint_ids"] == []
