"""Fail-closed client and object ownership contract tests."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.routers import approval_workflows, backup_center, client_portal, control_plane, invoice_smart, invoices, mega_features, mission_control, nexus_verify, permission_elevation, workflow_automation, yeastar
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

    def limit(self, _limit):
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


def test_legacy_portal_links_fail_closed_when_revoked_or_expired():
    future = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()

    assert client_portal._portal_token_is_active({"active": True, "expires_at": future})
    assert not client_portal._portal_token_is_active({"active": False, "expires_at": future})
    assert not client_portal._portal_token_is_active({"active": True, "expires_at": past})
    assert not client_portal._portal_token_is_active({"active": True, "expires_at": "invalid"})


def test_restricted_technician_cannot_administer_another_clients_portal(monkeypatch):
    denials = _InsertCollection()
    monkeypatch.setattr(scope_permissions.db, "scope_denials", denials)
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    protected_calls = [
        lambda: client_portal.get_portal_config("client-b", user),
        lambda: client_portal.update_portal_config("client-b", {}, user),
        lambda: client_portal.generate_portal_token("client-b", {}, user),
        lambda: client_portal.get_portal_users("client-b", user),
        lambda: client_portal.create_portal_user("client-b", {"email": "person@example.com"}, user),
    ]

    for protected_call in protected_calls:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(protected_call())
        assert exc.value.status_code == 404

    assert {entry["operation"] for entry in denials.rows} == {
        "portal.configuration.read",
        "portal.configuration.update",
        "portal.link.create",
        "portal.user.read",
        "portal.user.create",
    }


def test_invoice_list_is_limited_to_the_technicians_clients(monkeypatch):
    captured = {}

    class Invoices:
        def find(self, query, _projection):
            captured["query"] = query
            return _ListCursor([])

    monkeypatch.setattr(invoices, "db", type("InvoiceDB", (), {"invoices": Invoices()})())
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    assert asyncio.run(invoices.get_invoices(current_user=user)) == []
    assert captured["query"] == {"client_id": {"$in": ["client-a"]}}


def test_smart_invoice_action_is_denied_for_a_foreign_client(monkeypatch):
    denials = _InsertCollection()
    monkeypatch.setattr(scope_permissions.db, "scope_denials", denials)
    monkeypatch.setattr(
        invoice_smart,
        "db",
        type("SmartInvoiceDB", (), {"invoices": _RecordCollection({"id": "invoice-b", "client_id": "client-b"})})(),
    )
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    with pytest.raises(HTTPException) as exc:
        asyncio.run(invoice_smart._scoped_invoice("invoice-b", user, "billing.invoice.late_fee.apply"))

    assert exc.value.status_code == 404
    assert denials.rows[0]["operation"] == "billing.invoice.late_fee.apply"


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


def test_microsoft_tenant_registry_only_reads_allowed_client_records(monkeypatch):
    captured = {}

    class Collection:
        def __init__(self, name):
            self.name = name

        def find(self, query, _projection):
            captured[self.name] = query
            return _ListCursor([])

    monkeypatch.setattr(
        control_plane,
        "db",
        type("ControlPlaneDB", (), {
            "clients": Collection("clients"),
            "m365_tenant_connections": Collection("connections"),
            "m365_tenants": Collection("tenants"),
        })(),
    )
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    assert asyncio.run(control_plane._microsoft_tenant_registry({}, user)) == []
    assert captured["clients"] == {"id": {"$in": ["client-a"]}}
    assert captured["connections"] == {"client_id": {"$in": ["client-a"]}}
    assert captured["tenants"] == {
        "$and": [
            {"source": {"$in": ["m365_graph", "m365_partner_center"]}},
            {"client_id": {"$in": ["client-a"]}},
        ]
    }


def test_control_plane_search_scopes_client_bearing_results(monkeypatch):
    captured = {}

    class Collection:
        def __init__(self, name):
            self.name = name

        def find(self, query, _projection):
            captured[self.name] = query
            return _ListCursor([])

    monkeypatch.setattr(
        control_plane,
        "db",
        type("ControlPlaneSearchDB", (), {
            "clients": Collection("clients"),
            "tickets": Collection("tickets"),
            "devices": Collection("devices"),
            "m365_users": Collection("m365_users"),
            "invoices": Collection("invoices"),
            "yeastar_pbxs": Collection("voice"),
            "backup_jobs": Collection("backups"),
            "kb_articles": Collection("knowledge"),
            "products": Collection("products"),
        })(),
    )
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    result = asyncio.run(control_plane.control_plane_search("printer", user))

    assert result["count"] == 0
    assert captured["clients"]["$and"][1] == {"id": {"$in": ["client-a"]}}
    for name in ("tickets", "devices", "m365_users", "invoices", "voice", "backups", "knowledge"):
        assert captured[name]["$and"][1] == {"client_id": {"$in": ["client-a"]}}


def test_generic_approval_list_is_limited_to_the_technicians_clients(monkeypatch):
    captured = {}

    class Approvals:
        def find(self, query, _projection):
            captured["query"] = query
            return _ListCursor([])

    monkeypatch.setattr(
        approval_workflows,
        "db",
        type("ApprovalDB", (), {"approvals": Approvals()})(),
    )
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    assert asyncio.run(approval_workflows.get_approvals(user)) == []
    assert captured["query"] == {
        "$and": [
            {"status": "pending"},
            {"client_id": {"$in": ["client-a"]}},
        ]
    }


def test_restricted_technician_cannot_decide_another_clients_approval(monkeypatch):
    denials = _InsertCollection()
    monkeypatch.setattr(scope_permissions.db, "scope_denials", denials)
    monkeypatch.setattr(
        approval_workflows,
        "db",
        type(
            "ApprovalDB",
            (),
            {
                "approvals": _RecordCollection(
                    {
                        "id": "approval-b",
                        "client_id": "client-b",
                        "status": "pending",
                        "approver_role": "admin",
                    }
                )
            },
        )(),
    )
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    with pytest.raises(HTTPException) as exc:
        asyncio.run(approval_workflows.approve_request("approval-b", {}, user))

    assert exc.value.status_code == 404
    assert denials.rows[0]["operation"] == "approval.decision"


def test_approval_requester_cannot_approve_their_own_request():
    approval = {"requested_by_id": "admin-1", "approver_role": "admin"}
    administrator = {"id": "admin-1", "role": "admin"}

    assert not approval_workflows._may_decide(approval, administrator)


def test_nexus_elevate_list_is_limited_to_the_technicians_clients(monkeypatch):
    captured = []
    caller = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "permissions": {"agent_commands": {"execute": True}},
    }

    class Users:
        async def find_one(self, *_args):
            return dict(caller)

    class Requests:
        def find(self, query, _projection):
            captured.append(query)
            return _ListCursor([])

    monkeypatch.setattr(
        permission_elevation,
        "db",
        type(
            "ElevateDB",
            (),
            {"users": Users(), "nexus_elevate_requests": Requests()},
        )(),
    )

    result = asyncio.run(
        permission_elevation.list_nexus_elevate_requests(
            status=None,
            client_id=None,
            device_id=None,
            limit=150,
            current_user=caller,
        )
    )

    assert result == {"requests": []}
    assert captured[-1] == {"client_id": {"$in": ["client-a"]}}


def test_nexus_elevate_foreign_request_cannot_be_approved(monkeypatch):
    denials = _InsertCollection()
    monkeypatch.setattr(scope_permissions.db, "scope_denials", denials)
    caller = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "permissions": {"agent_commands": {"execute": True}},
    }

    class Users:
        async def find_one(self, *_args):
            return dict(caller)

    monkeypatch.setattr(
        permission_elevation,
        "db",
        type(
            "ElevateDB",
            (),
            {
                "users": Users(),
                "nexus_elevate_requests": _RecordCollection(
                    {
                        "id": "elevation-b",
                        "client_id": "client-b",
                        "status": "pending",
                    }
                ),
            },
        )(),
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            permission_elevation.approve_nexus_elevate_request(
                "elevation-b", {"reason": "Approved after a full review"}, caller
            )
        )

    assert exc.value.status_code == 404
    assert denials.rows[0]["operation"] == "nexus_elevate.request.approve"


def test_nexus_verify_requires_an_independent_authorised_approver():
    record = {
        "created_by_id": "tech-1",
        "verification": {"verified_by_id": "tech-2"},
    }
    standard_technician = {"id": "tech-3", "role": "technician"}
    requester = {"id": "tech-1", "role": "admin"}
    verifier = {"id": "tech-2", "role": "service_desk_manager"}
    independent_manager = {"id": "tech-4", "role": "service_desk_manager"}

    assert not nexus_verify._may_approve_sensitive_request(record, standard_technician)
    assert not nexus_verify._may_approve_sensitive_request(record, requester)
    assert not nexus_verify._may_approve_sensitive_request(record, verifier)
    assert nexus_verify._may_approve_sensitive_request(record, independent_manager)
