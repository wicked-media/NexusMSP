"""Tenant-bound regression coverage for the Control Plane overview."""

import asyncio

from app.routers import control_plane


class _Cursor:
    def __init__(self, rows=None):
        self.rows = rows or []

    def sort(self, *_args):
        return self

    def limit(self, _limit):
        return self

    async def to_list(self, _limit):
        return list(self.rows)


class _CountingCollection:
    def __init__(self, name, captured):
        self.name = name
        self.captured = captured

    async def count_documents(self, query):
        self.captured.setdefault(self.name, []).append(query)
        return 0


class _ClientCollection(_CountingCollection):
    def __init__(self, captured, rows):
        super().__init__("clients", captured)
        self.rows = rows

    def find(self, query, _projection):
        self.captured.setdefault("client_mapping", []).append(query)
        return _Cursor(self.rows)


class _ProviderTenantCollection(_CountingCollection):
    def __init__(self, captured, rows=None):
        super().__init__("m365_tenants", captured)
        self.rows = rows or []

    def find(self, query, _projection):
        self.captured.setdefault("provider_mapping", []).append(query)
        return _Cursor(self.rows)


class _TenantConnections:
    def __init__(self, captured, rows=None):
        self.captured = captured
        self.rows = rows or []

    def find(self, query, _projection):
        self.captured.setdefault("connections", []).append(query)
        return _Cursor(self.rows)


class _Settings:
    async def find_one(self, _query, _projection):
        return None


class _ActivityLogs:
    def __init__(self, captured):
        self.captured = captured

    def find(self, query, _projection):
        self.captured["activity"] = query
        return _Cursor()


def _contains(value, expected):
    if value == expected:
        return True
    if isinstance(value, dict):
        return any(_contains(item, expected) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(_contains(item, expected) for item in value)
    return False


def _overview_db(captured, client_rows, connection_rows=None, provider_rows=None):
    return type(
        "ControlPlaneOverviewDB",
        (),
        {
            "settings": _Settings(),
            "clients": _ClientCollection(captured, client_rows),
            "devices": _CountingCollection("devices", captured),
            "tickets": _CountingCollection("tickets", captured),
            "invoices": _CountingCollection("invoices", captured),
            "m365_tenants": _ProviderTenantCollection(captured, provider_rows),
            "m365_users": _CountingCollection("m365_users", captured),
            "m365_tenant_connections": _TenantConnections(captured, connection_rows),
            "yeastar_pbxs": _CountingCollection("yeastar_pbxs", captured),
            "backup_jobs": _CountingCollection("backup_jobs", captured),
            "activity_logs": _ActivityLogs(captured),
        },
    )()


def test_control_plane_overview_scopes_platform_and_provider_evidence(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        control_plane,
        "db",
        _overview_db(
            captured,
            [{"id": "client-a", "cipp_tenant_id": "entra-a"}],
        ),
    )

    result = asyncio.run(
        control_plane.control_plane_overview(
            {"id": "admin-a", "role": "admin", "tenant_id": "platform-a"}
        )
    )

    assert result["stats"]["clients"] == 0
    expected_platform_partition = {"tenant_id": "platform-a"}
    for collection in (
        "clients",
        "client_mapping",
        "devices",
        "tickets",
        "invoices",
        "yeastar_pbxs",
        "backup_jobs",
        "activity",
    ):
        queries = captured[collection]
        for query in queries if isinstance(queries, list) else [queries]:
            assert _contains(query, expected_platform_partition), (
                f"{collection} was not platform scoped: {query}"
            )
            assert not _contains(query, {"tenant_id": "platform-b"})

    # Provider evidence uses the approved Entra mapping, never the platform ID.
    assert _contains(
        captured["m365_tenants"][0], {"tenant_id": {"$in": ["entra-a"]}}
    )
    assert _contains(
        captured["m365_users"][0], {"tenant_id": {"$in": ["entra-a"]}}
    )
    assert not _contains(captured["m365_tenants"][0], expected_platform_partition)
    assert not _contains(captured["m365_users"][0], expected_platform_partition)


def test_control_plane_overview_fails_closed_when_platform_has_no_m365_mapping(monkeypatch):
    captured = {}
    monkeypatch.setattr(control_plane, "db", _overview_db(captured, []))

    result = asyncio.run(
        control_plane.control_plane_overview(
            {"id": "admin-a", "role": "admin", "tenant_id": "platform-a"}
        )
    )

    assert result["stats"]["m365_tenants"] == 0
    assert result["stats"]["m365_users"] == 0
    assert result["compatibility"]["m365_evidence_tenant_count"] == 0
    assert result["compatibility"]["m365_linked_tenant_count"] == 0
    assert _contains(captured["m365_tenants"][0], {"tenant_id": {"$in": []}})
    assert _contains(captured["m365_users"][0], {"tenant_id": {"$in": []}})


def test_microsoft_provider_state_uses_the_same_mapped_provider_boundary(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        control_plane,
        "db",
        _overview_db(
            captured,
            [{"id": "client-a", "cipp_tenant_id": "entra-a"}],
        ),
    )

    state = asyncio.run(
        control_plane._microsoft_provider_state(
            {"id": "admin-a", "role": "admin", "tenant_id": "platform-a"}
        )
    )

    assert not state["graph_evidence_available"]
    assert _contains(
        captured["m365_tenants"][0], {"tenant_id": {"$in": ["entra-a"]}}
    )
    assert not _contains(captured["m365_tenants"][0], {"tenant_id": "platform-a"})


def test_microsoft_provider_state_fails_closed_without_a_mapping(monkeypatch):
    captured = {}
    monkeypatch.setattr(control_plane, "db", _overview_db(captured, []))

    state = asyncio.run(
        control_plane._microsoft_provider_state(
            {"id": "admin-a", "role": "admin", "tenant_id": "platform-a"}
        )
    )

    assert not state["graph_evidence_available"]
    assert _contains(captured["m365_tenants"][0], {"tenant_id": {"$in": []}})


def test_microsoft_provider_state_recognises_encrypted_partner_credentials(monkeypatch):
    captured = {}
    database = _overview_db(captured, [])

    class Settings:
        async def find_one(self, query, _projection):
            if (
                _contains(query, {"key": "m365_connection"})
                and _contains(query, {"platform_tenant_id": "platform-a"})
            ):
                return {
                    "value": {
                        "app_id": "partner-app-id",
                        "partner_tenant_id": "partner-tenant-id",
                        "app_secret_encrypted": "server-only-ciphertext",
                        "last_test_status": "success",
                    },
                }
            return None

    database.settings = Settings()
    monkeypatch.setattr(control_plane, "db", database)

    state = asyncio.run(
        control_plane._microsoft_provider_state(
            {"id": "admin-a", "role": "admin", "tenant_id": "platform-a"}
        )
    )

    assert state["partner_configured"] is True
    assert state["partner_verified"] is True


def test_microsoft_registry_retains_a_supported_non_cipp_client_mapping(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        control_plane,
        "db",
        _overview_db(
            captured,
            [
                {
                    "id": "client-a",
                    "name": "Acme",
                    "m365_tenant_id": "entra-a",
                }
            ],
            [
                {
                    "tenant_id": "entra-a",
                    "tenant_name": "Acme Microsoft 365",
                    "client_id": "client-a",
                    "graph_verified": True,
                    "source": "m365_graph",
                }
            ],
        ),
    )

    registry = asyncio.run(
        control_plane._microsoft_tenant_registry(
            {"cipp_verified": True, "execution_provider": "cipp"},
            {"id": "admin-a", "role": "admin", "tenant_id": "platform-a"},
        )
    )

    assert registry == [
        {
            "id": "entra-a",
            "connection_id": None,
            "name": "Acme Microsoft 365",
            "domain": None,
            "client_id": "client-a",
            "client_name": "Acme",
            "source": "m365_graph",
            "consent_method": None,
            "mapped": True,
            "graph_verified": True,
            "access_status": "connected",
            "provider_reachable": True,
            "action_ready": True,
            "readiness_reasons": [],
        }
    ]


def test_microsoft_registry_fails_closed_without_a_provider_mapping(monkeypatch):
    captured = {}
    monkeypatch.setattr(control_plane, "db", _overview_db(captured, []))

    registry = asyncio.run(
        control_plane._microsoft_tenant_registry(
            {},
            {"id": "admin-a", "role": "admin", "tenant_id": "platform-a"},
        )
    )

    assert registry == []
    assert captured["connections"][0] == {
        "$or": [
            {"tenant_id": {"$in": []}},
            {"tenantId": {"$in": []}},
        ]
    }
    assert _contains(captured["provider_mapping"][0], {"tenant_id": {"$in": []}})
