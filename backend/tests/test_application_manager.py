"""Focused regression coverage for Nexus Application Manager boundaries."""

from __future__ import annotations

import asyncio
import os
import sys
from copy import deepcopy
from datetime import datetime, timezone
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

from app.routers import application_manager  # noqa: E402
from app.services import action_permissions  # noqa: E402
from app.services import scope_permissions  # noqa: E402


def _matches(row: dict, query: dict) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$exists" in expected and bool(key in row) != bool(expected["$exists"]):
                return False
        elif actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict]):
        self.rows = deepcopy(rows)

    def sort(self, key, direction=-1):
        self.rows.sort(key=lambda row: str(row.get(key) or ""), reverse=direction == -1)
        return self

    async def to_list(self, size: int):
        return deepcopy(self.rows[:size])


class _Collection:
    def __init__(self, rows: list[dict] | None = None):
        self.rows = deepcopy(rows or [])
        self.inserted: list[dict] = []
        self.find_queries: list[dict] = []

    def find(self, query: dict, _projection=None):
        self.find_queries.append(deepcopy(query))
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def find_one(self, query: dict, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, document: dict):
        self.rows.append(deepcopy(document))
        self.inserted.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query: dict, update: dict):
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


def _database(*, devices: list[dict], software: list[dict], provider_rows: list[dict], policies: list[dict] | None = None):
    return SimpleNamespace(
        devices=_Collection(devices),
        device_software=_Collection(software),
        third_party_apps=_Collection(provider_rows),
        application_manager_policies=_Collection(policies),
        application_manager_action_plans=_Collection(),
        activity_logs=_Collection(),
        scope_denials=_Collection(),
        tickets=_Collection(),
        settings=_Collection(),
    )


def _restricted_user() -> dict:
    return {
        "id": "tech-a",
        "name": "Technician A",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "site_scope_ids": ["site-a"],
    }


def _request() -> SimpleNamespace:
    return SimpleNamespace(
        method="POST",
        url=SimpleNamespace(path="/api/application-manager/action-plans"),
        state=SimpleNamespace(correlation_id="test-correlation"),
    )


def test_overview_only_correlates_inventory_and_update_evidence_for_authorised_devices(monkeypatch):
    now = datetime.now(timezone.utc)
    database = _database(
        devices=[
            {"id": "device-a", "client_id": "client-a", "client_name": "Client A", "site_id": "site-a", "name": "CLIENT-A-01"},
            {"id": "device-b", "client_id": "client-b", "client_name": "Client B", "site_id": "site-b", "name": "CLIENT-B-01"},
        ],
        software=[
            {"device_id": "device-a", "name": "Google Chrome", "version": "127.0", "publisher": "Google", "source": "nexus-agent", "last_inventory_at": now.isoformat()},
            {"device_id": "device-b", "name": "Forbidden App", "version": "1", "publisher": "Other", "source": "nexus-agent", "last_inventory_at": now.isoformat()},
        ],
        provider_rows=[
            {"device_id": "device-a", "client_id": "client-a", "app_name": "Google Chrome", "installed_version": "127.0", "latest_version": "127.0", "status": "current", "source": "provider", "observed_at": now.isoformat()},
            {"device_id": "device-b", "client_id": "client-b", "app_name": "Forbidden App", "status": "outdated", "source": "provider", "observed_at": now.isoformat()},
        ],
    )
    monkeypatch.setattr(application_manager, "db", database)
    monkeypatch.setattr(action_permissions, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    result = asyncio.run(application_manager.application_manager_overview(
        request=_request(),
        client_id="client-a",
        device_id=None,
        current_user=_restricted_user(),
    ))

    assert result["summary"]["devices"] == 1
    assert result["summary"]["applications"] == 1
    assert [item["app_name"] for item in result["applications"]] == ["Google Chrome"]
    assert result["applications"][0]["update"]["state"] == "current"
    assert all("client-a" in str(query) for query in database.devices.find_queries)


def test_overview_never_calls_a_partially_observed_application_current(monkeypatch):
    now = datetime.now(timezone.utc)
    database = _database(
        devices=[
            {"id": "device-a", "client_id": "client-a", "client_name": "Client A", "site_id": "site-a", "name": "CLIENT-A-01"},
            {"id": "device-c", "client_id": "client-a", "client_name": "Client A", "site_id": "site-a", "name": "CLIENT-A-02"},
        ],
        software=[
            {"device_id": "device-a", "name": "Zoom", "version": "6.0", "publisher": "Zoom", "source": "nexus-agent", "last_inventory_at": now.isoformat()},
            {"device_id": "device-c", "name": "Zoom", "version": "6.0", "publisher": "Zoom", "source": "nexus-agent", "last_inventory_at": now.isoformat()},
        ],
        provider_rows=[
            {"device_id": "device-a", "client_id": "client-a", "app_name": "Zoom", "status": "current", "source": "provider", "observed_at": now.isoformat()},
        ],
    )
    monkeypatch.setattr(application_manager, "db", database)
    monkeypatch.setattr(action_permissions, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    result = asyncio.run(application_manager.application_manager_overview(
        request=_request(),
        client_id=None,
        device_id=None,
        current_user=_restricted_user(),
    ))

    app = result["applications"][0]
    assert app["update"]["state"] == "partially_observed"
    assert app["update"]["observed_installations"] == 1
    assert app["update"]["total_installations"] == 2


def test_action_plan_is_scoped_idempotent_and_never_becomes_an_execution(monkeypatch):
    database = _database(
        devices=[
            {"id": "device-a", "client_id": "client-a", "site_id": "site-a", "name": "CLIENT-A-01"},
            {"id": "device-b", "client_id": "client-b", "site_id": "site-b", "name": "CLIENT-B-01"},
        ],
        software=[],
        provider_rows=[],
    )
    activity: list[dict] = []

    async def record_activity(*args, **kwargs):
        activity.append({"args": args, "kwargs": kwargs})

    monkeypatch.setattr(application_manager, "db", database)
    monkeypatch.setattr(action_permissions, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    monkeypatch.setattr(application_manager, "log_activity", record_activity)
    payload = application_manager.ApplicationActionPlanPayload(
        action_type="update",
        application_name="Google Chrome",
        publisher="Google",
        device_ids=["device-a"],
        reason="Apply the vendor security update in the approved maintenance window.",
        idempotency_key="application-plan-test-key",
    )

    created = asyncio.run(application_manager.create_application_action_plan(payload, _request(), _restricted_user()))
    repeated = asyncio.run(application_manager.create_application_action_plan(payload, _request(), _restricted_user()))

    assert created["idempotent"] is False
    assert repeated["idempotent"] is True
    assert len(database.application_manager_action_plans.inserted) == 1
    assert created["plan"]["execution_state"] == "not_configured"
    assert created["plan"]["approval_state"] == "not_requested"
    assert created["plan"]["targets"] == [{"device_id": "device-a", "device_name": "CLIENT-A-01"}]
    assert len(activity) == 1

    foreign_payload = application_manager.ApplicationActionPlanPayload(
        action_type="uninstall",
        application_name="Forbidden App",
        device_ids=["device-b"],
        reason="This should never reach a foreign endpoint.",
        idempotency_key="application-plan-foreign-key",
    )
    with pytest.raises(HTTPException) as denied:
        asyncio.run(application_manager.create_application_action_plan(foreign_payload, _request(), _restricted_user()))
    assert denied.value.status_code == 404
    assert len(database.application_manager_action_plans.inserted) == 1


def test_global_policy_can_be_updated_without_creating_a_conflicting_second_record(monkeypatch):
    database = _database(devices=[], software=[], provider_rows=[])
    activity: list[dict] = []

    async def record_activity(*args, **kwargs):
        activity.append({"args": args, "kwargs": kwargs})

    admin = {"id": "admin-a", "name": "Admin A", "role": "admin", "is_admin": True}
    monkeypatch.setattr(application_manager, "db", database)
    monkeypatch.setattr(action_permissions, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    monkeypatch.setattr(application_manager, "log_activity", record_activity)
    created = asyncio.run(application_manager.create_application_policy(
        application_manager.ApplicationPolicyPayload(
            application_name="Google Chrome",
            publisher="Google",
            approval_state="review",
            rollout_ring="Pilot",
        ),
        _request(),
        admin,
    ))
    policy_id = created["policy"]["id"]
    updated = asyncio.run(application_manager.update_application_policy(
        policy_id,
        application_manager.ApplicationPolicyPayload(
            application_name="Google Chrome",
            publisher="Google",
            approval_state="approved",
            rollout_ring="Standard",
        ),
        _request(),
        admin,
    ))

    assert len(database.application_manager_policies.rows) == 1
    assert updated["policy"]["id"] == policy_id
    assert updated["policy"]["approval_state"] == "approved"
    assert updated["policy"]["enforcement_state"] == "not_deployed"
    assert len(activity) == 2
