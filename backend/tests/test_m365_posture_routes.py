import asyncio
from types import SimpleNamespace

from app.routers import m365
from app.routers.m365 import router


def test_microsoft_mail_and_intune_posture_routes_remain_available():
    paths = {route.path for route in router.routes}

    # This is the complete backend contract consumed by M365CommandCenter.
    # Keep it explicit so a route rename cannot degrade a Control Plane tab
    # into a permanent spinner or a toast-only failure.
    assert {
        "/m365/tenants/health/summary",
        "/m365/connection",
        "/m365/tenants",
        "/m365/search",
        "/m365/exchange/posture",
        "/m365/intune/posture",
        "/m365/collaboration/posture",
        "/m365/licensing/posture",
        "/m365/standards",
        "/m365/gdap",
        "/m365/gdap/role-templates",
        "/m365/mfa-analytics",
        "/m365/secure-score/trend",
        "/m365/ca-templates",
        "/m365/aitm-page",
        "/m365/security/posture",
        "/m365/scripted-alerts",
        "/m365/onboarding",
        "/m365/connection/test",
        "/m365/onboarding/discover",
        "/m365/onboarding/tenants",
        "/m365/onboarding/tenants/{connection_id}/mapping",
        "/m365/sync/readiness",
    }.issubset(paths)


def test_collector_readiness_reports_explicit_streams_without_claiming_live_evidence(monkeypatch):
    class CountCollection:
        def __init__(self, count):
            self.count = count
            self.queries = []

        async def count_documents(self, query):
            self.queries.append(query)
            return self.count

    class Settings:
        async def find_one(self, *_args, **_kwargs):
            return {"value": {}}

    tenant_records = CountCollection(0)
    monkeypatch.setattr(
        m365,
        "db",
        SimpleNamespace(
            settings=Settings(),
            m365_tenants=tenant_records,
            m365_users=CountCollection(2),
            m365_mailboxes=CountCollection(0),
            m365_intune_devices=CountCollection(3),
            m365_teams=CountCollection(0),
            m365_security_alerts=CountCollection(1),
        ),
    )

    response = asyncio.run(m365.microsoft_sync_readiness({"id": "admin-1", "role": "admin"}))

    assert response["connection"] == {
        "configured": False,
        "verified_at": None,
        "last_sync": None,
    }
    assert [stream["id"] for stream in response["streams"]] == [
        "identity", "exchange", "intune", "collaboration", "security",
    ]
    assert [stream["status"] for stream in response["streams"]] == [
        "evidence_active", "connection_required", "evidence_active",
        "connection_required", "evidence_active",
    ]
    assert [stream["records"] for stream in response["streams"]] == [2, 0, 3, 0, 1]
    assert all(stream["permissions"] for stream in response["streams"])


def test_tenant_mapping_retains_an_operator_reason_for_audit(monkeypatch):
    class ConnectionCollection:
        def __init__(self):
            self.updates = []

        async def find_one(self, *_args, **_kwargs):
            return {
                "id": "m365-tenant-1",
                "tenant_id": "entra-tenant-1",
                "tenant_name": "Contoso Australia",
                "default_domain": "contoso.example",
                "client_id": None,
            }

        async def update_one(self, query, update, **_kwargs):
            self.updates.append((query, update))

    class ClientCollection:
        def __init__(self):
            self.updates = []

        async def update_one(self, query, update, **_kwargs):
            self.updates.append((query, update))

    class ProviderTenantCollection:
        async def find_one(self, *_args, **_kwargs):
            return None

    connections = ConnectionCollection()
    clients = ClientCollection()
    events = []

    async def allow_global_scope(*_args, **_kwargs):
        return None

    async def allow_client_scope(*_args, **_kwargs):
        return None

    async def mapped_client(*_args, **_kwargs):
        return {"id": "client-1", "name": "Contoso Pty Ltd"}

    async def record_activity(*args, **_kwargs):
        events.append(args)

    monkeypatch.setattr(m365, "db", SimpleNamespace(
        m365_tenant_connections=connections,
        clients=clients,
        m365_tenants=ProviderTenantCollection(),
    ))
    monkeypatch.setattr(m365, "assert_global_scope", allow_global_scope)
    monkeypatch.setattr(m365, "assert_client_scope", allow_client_scope)
    monkeypatch.setattr(m365, "_mapping_target_client", mapped_client)
    monkeypatch.setattr(m365, "log_activity", record_activity)

    response = asyncio.run(m365.map_tenant_to_client(
        "m365-tenant-1",
        {"client_id": "client-1", "reason": "Primary domain and agreement match the client record."},
        current_user={"id": "tech-1", "name": "Sam", "role": "admin"},
        _={},
    ))

    mapping_update = connections.updates[-1][1]["$set"]
    assert response["success"] is True
    assert response["mapping_reason"] == "Primary domain and agreement match the client record."
    assert mapping_update["mapping_reason"] == "Primary domain and agreement match the client record."
    assert mapping_update["mapping_reason_by"] == "Sam"
    assert "Primary domain and agreement" in events[-1][-1]


def test_manual_tenant_entry_cannot_claim_verified_provider_ownership(monkeypatch):
    class ProviderTenants:
        async def find_one(self, *_args, **_kwargs):
            return {"tenant_id": "entra-foreign", "client_id": "client-foreign"}

    writes = []

    class Connections:
        async def find_one(self, *_args, **_kwargs):
            writes.append("read")
            return None

        async def update_one(self, *_args, **_kwargs):
            writes.append("write")

    async def allow_global_scope(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        m365,
        "db",
        SimpleNamespace(m365_tenants=ProviderTenants(), m365_tenant_connections=Connections()),
    )
    monkeypatch.setattr(m365, "assert_global_scope", allow_global_scope)

    from fastapi import HTTPException
    import pytest

    with pytest.raises(HTTPException) as conflict:
        asyncio.run(m365.add_individual_tenant(
            {
                "tenant_id": "entra-foreign",
                "tenant_name": "Foreign customer",
                "reason": "Staged onboarding",
            },
            current_user={"id": "admin-1", "name": "Admin", "role": "admin"},
            _={},
        ))

    assert conflict.value.status_code == 409
    assert writes == []


def test_tenant_mapping_requires_reason_and_cannot_override_verified_owner(monkeypatch):
    from fastapi import HTTPException
    import pytest

    with pytest.raises(HTTPException) as missing_reason:
        asyncio.run(m365.map_tenant_to_client(
            "m365-tenant-1",
            {"client_id": "client-a"},
            current_user={"id": "admin-1", "role": "admin"},
            _={},
        ))
    assert missing_reason.value.status_code == 400

    class Connections:
        updates = []

        async def find_one(self, *_args, **_kwargs):
            return {
                "id": "m365-tenant-1",
                "tenant_id": "entra-foreign",
                "tenant_name": "Foreign customer",
                "client_id": None,
            }

        async def update_one(self, *_args, **_kwargs):
            self.updates.append(True)

    class ProviderTenants:
        async def find_one(self, *_args, **_kwargs):
            return {"tenant_id": "entra-foreign", "client_id": "client-foreign"}

    async def allow_scope(*_args, **_kwargs):
        return None

    connections = Connections()
    monkeypatch.setattr(
        m365,
        "db",
        SimpleNamespace(m365_tenant_connections=connections, m365_tenants=ProviderTenants()),
    )
    monkeypatch.setattr(m365, "assert_global_scope", allow_scope)
    monkeypatch.setattr(m365, "assert_client_scope", allow_scope)

    with pytest.raises(HTTPException) as conflict:
        asyncio.run(m365.map_tenant_to_client(
            "m365-tenant-1",
            {"client_id": "client-a", "reason": "Customer agreement matches"},
            current_user={"id": "admin-1", "role": "admin"},
            _={},
        ))

    assert conflict.value.status_code == 409
    assert connections.updates == []
