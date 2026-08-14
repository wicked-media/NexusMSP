"""Fail-closed client and object ownership contract tests."""

import asyncio

import pytest
from fastapi import HTTPException

from app.routers import backup_center, mega_features, mission_control, workflow_automation, yeastar
from app.services import scope_permissions


class _InsertCollection:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(dict(row))


class _RecordCollection:
    def __init__(self, record):
        self.record = record

    async def find_one(self, query, projection):
        if self.record and self.record.get("id") == query.get("id"):
            return dict(self.record)
        return None


class _ListCursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args):
        return self

    async def to_list(self, _limit):
        return list(self.rows)


def test_missing_scope_configuration_fails_closed():
    scope = scope_permissions.effective_scope({"id": "tech-1", "role": "technician"})

    assert scope["mode"] == "restricted"
    assert scope["client_ids"] == []
    assert scope["source"] == "fail-closed-unassigned"


def test_administrator_and_explicit_all_scope_remain_supported():
    admin = scope_permissions.effective_scope({"id": "admin-1", "role": "admin"})
    service_manager = scope_permissions.effective_scope({
        "id": "manager-1",
        "role": "service_desk_manager",
        "client_scope_mode": "all",
    })

    assert admin["mode"] == "all"
    assert service_manager["mode"] == "all"


def test_scoped_query_intersects_filters_instead_of_overwriting_them():
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    query = scope_permissions.scoped_query(user, {"status": "open"})

    assert query == {
        "$and": [
            {"status": "open"},
            {"client_id": {"$in": ["client-a"]}},
        ]
    }


def test_scoped_query_enforces_selected_sites_when_present():
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "site_scope_ids": ["site-1"],
    }

    query = scope_permissions.scoped_query(user, {"status": "online"})

    assert query == {
        "$and": [
            {"status": "online"},
            {"client_id": {"$in": ["client-a"]}},
            {"site_id": {"$in": ["site-1"]}},
        ]
    }


def test_similar_ticket_search_is_scoped_to_the_technicians_clients(monkeypatch):
    captured = {}

    class Cursor:
        def limit(self, _limit):
            return self

        async def to_list(self, _limit):
            return []

    class Tickets:
        def find(self, query, _projection):
            captured["query"] = query
            return Cursor()

    async def owned_ticket(*_args, **_kwargs):
        return {"id": "ticket-1", "client_id": "client-a", "title": "Printer offline investigation"}

    monkeypatch.setattr(mega_features.db, "tickets", Tickets())
    monkeypatch.setattr(mega_features, "assert_record_scope", owned_ticket)
    result = asyncio.run(mega_features.ticket_doppelganger("ticket-1", {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }))

    assert result["matches"] == []
    assert captured["query"]["$and"][1] == {"client_id": {"$in": ["client-a"]}}


def test_mission_control_queries_are_client_and_site_scoped():
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "site_scope_ids": ["site-1"],
    }

    operational = mission_control._query(user, {"status": "offline"})
    clients = mission_control._query(
        user,
        {"status": {"$ne": "archived"}},
        field="id",
        site_field=None,
    )

    assert operational == {
        "$and": [
            {"status": "offline"},
            {"client_id": {"$in": ["client-a"]}},
            {"site_id": {"$in": ["site-1"]}},
        ]
    }
    assert clients == {
        "$and": [
            {"status": {"$ne": "archived"}},
            {"id": {"$in": ["client-a"]}},
        ]
    }


def test_foreign_record_is_masked_and_denial_is_audited(monkeypatch):
    denials = _InsertCollection()
    monkeypatch.setattr(scope_permissions.db, "scope_denials", denials)
    user = {
        "id": "tech-1",
        "name": "Restricted Tech",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }
    records = _RecordCollection({"id": "ticket-b", "client_id": "client-b"})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(scope_permissions.assert_record_scope(
            user,
            records,
            "ticket-b",
            operation="ticket.read",
            resource_name="Ticket",
        ))

    assert exc.value.status_code == 404
    assert exc.value.detail == "Resource not found"
    assert denials.rows[0]["client_id"] == "client-b"
    assert denials.rows[0]["operation"] == "ticket.read"


def test_allowed_record_returns_owned_document(monkeypatch):
    monkeypatch.setattr(scope_permissions.db, "scope_denials", _InsertCollection())
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }
    records = _RecordCollection({"id": "device-a", "client_id": "client-a", "name": "Reception"})

    record = asyncio.run(scope_permissions.assert_record_scope(
        user,
        records,
        "device-a",
        operation="device.read",
        resource_name="Device",
    ))

    assert record["name"] == "Reception"


def test_allowed_client_with_foreign_site_is_denied_and_audited(monkeypatch):
    denials = _InsertCollection()
    monkeypatch.setattr(scope_permissions.db, "scope_denials", denials)
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "site_scope_ids": ["site-a"],
    }

    with pytest.raises(HTTPException) as exc:
        asyncio.run(scope_permissions.assert_client_scope(
            user,
            "client-a",
            site_id="site-b",
            operation="device.read",
            mask_not_found=True,
        ))

    assert exc.value.status_code == 404
    assert denials.rows[0]["client_id"] == "client-a"
    assert denials.rows[0]["site_id"] == "site-b"
    assert denials.rows[0]["operation"] == "device.read"


def test_restricted_technician_cannot_run_a_global_operation(monkeypatch):
    denials = _InsertCollection()
    monkeypatch.setattr(scope_permissions.db, "scope_denials", denials)
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    with pytest.raises(HTTPException) as exc:
        asyncio.run(scope_permissions.assert_global_scope(
            user,
            operation="billing.global_reconcile",
        ))

    assert exc.value.status_code == 403
    assert denials.rows[0]["operation"] == "billing.global_reconcile"


def test_restricted_technician_cannot_access_ycm_fleet_controls(monkeypatch):
    denials = _InsertCollection()
    monkeypatch.setattr(scope_permissions.db, "scope_denials", denials)
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    protected_calls = [
        lambda: yeastar.get_ycm_overview(user),
        lambda: yeastar.save_ycm_settings({"base_url": "https://ycm.yeastar.com"}, user),
        lambda: yeastar.test_ycm_connection(user),
        lambda: yeastar.discover_ycm_cloud_pbxs(user),
        lambda: yeastar.claim_ycm_discovery("ycm:pbx-1", {"client_id": "client-b"}, user),
    ]

    for protected_call in protected_calls:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(protected_call())
        assert exc.value.status_code == 403

    assert {entry["operation"] for entry in denials.rows} == {
        "voice.ycm.overview",
        "voice.ycm.settings.update",
        "voice.ycm.connection.test",
        "voice.ycm.discovery.run",
        "voice.ycm.discovery.claim",
    }


def test_voice_pbx_list_is_limited_to_the_technicians_clients(monkeypatch):
    captured = {}

    class PBXs:
        def find(self, query, _projection):
            captured["query"] = query
            return _ListCursor([])

    monkeypatch.setattr(yeastar, "db", type("VoiceDB", (), {"yeastar_pbxs": PBXs()})())
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    assert asyncio.run(yeastar.list_yeastar_pbxs(user)) == []
    assert captured["query"] == {"client_id": {"$in": ["client-a"]}}


def test_restricted_technician_cannot_read_or_change_legacy_voice_credentials(monkeypatch):
    denials = _InsertCollection()
    monkeypatch.setattr(scope_permissions.db, "scope_denials", denials)
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    for protected_call in [
        lambda: yeastar.get_yeastar_settings(user),
        lambda: yeastar.save_yeastar_settings({}, user),
    ]:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(protected_call())
        assert exc.value.status_code == 403

    assert {entry["operation"] for entry in denials.rows} == {
        "voice.legacy_settings.read",
        "voice.legacy_settings.update",
    }


def test_backup_verification_overview_is_limited_to_the_technicians_clients(monkeypatch):
    captured = {}

    class Verifications:
        def find(self, query, _projection):
            captured["query"] = query
            return _ListCursor([])

    monkeypatch.setattr(backup_center, "db", type("BackupDB", (), {"backup_verifications": Verifications()})())
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    result = asyncio.run(backup_center.backup_verify_overview(user))

    assert result["tests"] == []
    assert captured["query"] == {"client_id": {"$in": ["client-a"]}}


def test_restricted_technician_cannot_request_a_foreign_restore_verification(monkeypatch):
    denials = _InsertCollection()
    monkeypatch.setattr(scope_permissions.db, "scope_denials", denials)
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    with pytest.raises(HTTPException) as exc:
        asyncio.run(backup_center.run_verification({"client_id": "client-b"}, user))

    assert exc.value.status_code == 404
    assert denials.rows[0]["operation"] == "backup.verification.request"


def test_foreign_automation_run_is_masked_before_approval_or_compensation(monkeypatch):
    denials = _InsertCollection()
    monkeypatch.setattr(scope_permissions.db, "scope_denials", denials)
    monkeypatch.setattr(
        workflow_automation,
        "db",
        type("AutomationDB", (), {
            "workflow_runs": _RecordCollection({
                "id": "RUN-FOREIGN",
                "client_id": "client-b",
                "status": "awaiting_approval",
            })
        })(),
    )
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    with pytest.raises(HTTPException) as exc:
        asyncio.run(workflow_automation._run_in_scope(
            "RUN-FOREIGN",
            user,
            "automation.run.approve",
        ))

    assert exc.value.status_code == 404
    assert denials.rows[0]["operation"] == "automation.run.approve"
