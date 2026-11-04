"""Focused CIPP security-boundary regression tests."""

import asyncio
import inspect
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

from app.routers import cipp  # noqa: E402
from app.routers import cipp_hygiene  # noqa: E402
from app.routers import nexus_verify  # noqa: E402
from app.services.secret_store import decrypt_secret  # noqa: E402
from app.services import scope_permissions  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, limit):
        return list(self.rows[:limit])


class _Clients:
    def __init__(self, rows):
        self.rows = rows

    def find(self, _query, _projection=None):
        return _Cursor(self.rows)

    async def find_one(self, query, _projection=None):
        for row in self.rows:
            if _matches(row, query):
                return dict(row)
        return None


class _ScopedClients(_Clients):
    """Small query-aware client collection for platform-boundary tests."""

    def __init__(self, rows):
        super().__init__(rows)
        self.queries = []

    def find(self, query, _projection=None):
        self.queries.append(query)
        return _Cursor([row for row in self.rows if _matches_scoped_query(row, query)])


class _Settings:
    def __init__(self, document=None, *, fail_on_update=False):
        self.document = document or {}
        self.fail_on_update = fail_on_update
        self.updates = []

    async def find_one(self, _query, _projection=None):
        return dict(self.document) if self.document else None

    async def update_one(self, query, update, **kwargs):
        if self.fail_on_update:
            raise AssertionError("A read-only CIPP summary must not mutate connection settings")
        self.updates.append((query, update, kwargs))

    async def delete_one(self, _query):
        return None


class _Actions:
    def __init__(self):
        self.inserted = []

    async def insert_one(self, row):
        self.inserted.append(row)

    def find(self, _query, _projection=None):
        return _Cursor([])


class _DigestHistory:
    def __init__(self, rows):
        self.rows = rows
        self.query = None
        self.inserted = []

    def find(self, query, _projection=None):
        self.query = query
        return _Cursor(self.rows)

    async def insert_one(self, row):
        self.inserted.append(row)


class _Denials:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(row)


class _CountableClients(_Clients):
    async def count_documents(self, _query):
        return len(self.rows)


def _matches(row, query):
    for key, expected in query.items():
        value = row.get(key)
        if isinstance(expected, dict) and "$ne" in expected:
            if value == expected["$ne"]:
                return False
        elif value != expected:
            return False
    return True


def _matches_scoped_query(row, query):
    """Match the limited Mongo query shapes used by tenant_scoped_query."""
    if "$and" in query:
        return all(_matches_scoped_query(row, clause) for clause in query["$and"])
    if "$or" in query:
        return any(_matches_scoped_query(row, clause) for clause in query["$or"])
    return _matches(row, query)


def _request(path="/api/cipp/status"):
    return SimpleNamespace(
        method="GET",
        url=SimpleNamespace(path=path),
        state=SimpleNamespace(correlation_id="corr-cipp-security"),
    )


def _admin():
    return {"id": "admin-1", "name": "Admin", "role": "admin"}


def _restricted_user():
    return {
        "id": "tech-1",
        "name": "Restricted Tech",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _platform_admin():
    return {**_admin(), "tenant_id": "platform-a"}


def _db(*, clients=None, settings=None, actions=None):
    return SimpleNamespace(
        clients=clients or _Clients([]),
        settings=settings or _Settings(),
        cipp_actions=actions or _Actions(),
    )


def test_cipp_tenant_scope_applies_the_authenticated_platform_partition(monkeypatch):
    clients = _ScopedClients([
        {"id": "client-foreign", "cipp_tenant_id": "tenant-shared", "tenant_id": "platform-b"},
        {"id": "client-local", "cipp_tenant_id": "tenant-shared", "tenant_id": "platform-a"},
    ])
    monkeypatch.setattr(cipp, "db", _db(clients=clients))

    client = asyncio.run(
        cipp._assert_tenant_scope(
            _platform_admin(),
            "tenant-shared",
            "entra.user.read",
            _request("/api/cipp/tenants/tenant-shared/users"),
            require_mapping=True,
        )
    )

    assert client["id"] == "client-local"
    assert clients.queries == [
        {
            "$and": [
                {"cipp_tenant_id": "tenant-shared"},
                {"tenant_id": "platform-a"},
            ]
        }
    ]


def test_cipp_tenant_visibility_uses_the_shared_platform_aware_resolver(monkeypatch):
    calls = []
    database = _db()

    async def resolve(current_user, *, database):
        calls.append((current_user, database))
        return {"tenant-visible"}

    monkeypatch.setattr(cipp, "db", database)
    monkeypatch.setattr(cipp, "visible_m365_provider_tenant_ids", resolve)

    assert asyncio.run(cipp._visible_tenant_ids(_platform_admin())) == {"tenant-visible"}
    assert calls == [(_platform_admin(), database)]


def _route_permissions(router, path, method):
    route = next(
        candidate
        for candidate in router.routes
        if candidate.path == path and method in candidate.methods
    )
    return {
        inspect.getclosurevars(dependency.dependency).nonlocals["permission_id"]
        for dependency in route.dependencies
    }


def test_status_never_returns_provider_key_material(monkeypatch):
    secret = "super-sensitive-cipp-host-key"
    monkeypatch.setattr(
        cipp,
        "db",
        _db(settings=_Settings({"type": "cipp", "base_url": "https://provider.example/api", "api_key_full": secret})),
    )

    response = asyncio.run(cipp.status(_request(), _admin()))

    assert response["configured"] is True
    assert response["base_url"] == "https://provider.example/api"
    assert "api_key_preview" not in response
    assert secret not in str(response)


def test_cipp_connection_saves_an_encrypted_server_only_api_key(monkeypatch):
    settings = _Settings()

    async def record_activity(*_args, **_kwargs):
        return None

    monkeypatch.setattr(cipp, "db", _db(settings=settings))
    monkeypatch.setattr(cipp, "log_activity", record_activity)

    response = asyncio.run(cipp.save_settings(
        {"base_url": "https://provider.example/api", "api_key": "cipp-test-secret"},
        _request("/api/cipp/settings"),
        _admin(),
    ))

    stored = settings.updates[-1][1]
    assert response["message"] == "Microsoft tenant provider settings saved"
    assert "api_key_full" not in stored["$set"]
    assert decrypt_secret(stored["$set"]["api_key_encrypted"]) == "cipp-test-secret"
    assert stored["$unset"] == {"api_key_full": ""}


def test_provider_result_sanitiser_does_not_persist_or_return_credential_values():
    result = cipp._safe_provider_result({
        "accepted": True,
        "password": "temporary-password",
        "accessToken": "provider-token",
        "raw": "potentially-sensitive-provider-body",
    })

    assert result["accepted"] is True
    assert result["password"] == "[redacted]"
    assert result["accessToken"] == "[redacted]"
    assert result["raw"] == "[provider payload omitted]"


def test_restricted_user_cannot_read_global_provider_configuration(monkeypatch):
    denials = _Denials()
    monkeypatch.setattr(cipp, "db", _db())
    monkeypatch.setattr(scope_permissions, "db", SimpleNamespace(scope_denials=denials))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(cipp.status(_request(), _restricted_user()))

    assert exc.value.status_code == 403
    assert denials.rows[0]["operation"] == "entra.provider.status.read"


def test_provider_actions_reject_unmapped_or_ambiguous_tenants_before_the_provider_sink(monkeypatch):
    calls = []

    async def unexpected_provider_call(*_args, **_kwargs):
        calls.append(True)
        return {"unexpected": True}

    monkeypatch.setattr(cipp, "db", _db(clients=_Clients([])))
    monkeypatch.setattr(cipp, "_cipp_call", unexpected_provider_call)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            cipp.create_user(
                "tenant-unmapped",
                {"displayName": "Test User", "userPrincipalName": "test@example.com", "password": "not-a-real-password"},
                _request("/api/cipp/tenants/tenant-unmapped/users"),
                _admin(),
            )
        )

    assert exc.value.status_code == 422
    assert calls == []

    monkeypatch.setattr(
        cipp,
        "db",
        _db(clients=_Clients([{"id": "client-a"}, {"id": "client-b"}])),
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(cipp._assert_tenant_scope(_admin(), "tenant-ambiguous", "entra.user.create", _request(), require_mapping=True))

    assert exc.value.status_code == 422


def test_mapped_provider_action_retains_client_scoped_audit_evidence(monkeypatch):
    actions = _Actions()

    async def provider_call(*_args, **_kwargs):
        return {"accepted": True}

    monkeypatch.setattr(cipp, "db", _db(clients=_Clients([{"id": "client-a", "name": "Client A"}]), actions=actions))
    monkeypatch.setattr(cipp, "_cipp_call", provider_call)

    response = asyncio.run(
        cipp.create_user(
            "tenant-a",
            {"displayName": "Test User", "userPrincipalName": "test@example.com", "password": "not-a-real-password"},
            _request("/api/cipp/tenants/tenant-a/users"),
            _admin(),
        )
    )

    assert response["success"] is True
    assert actions.inserted[0]["client_id"] == "client-a"
    assert actions.inserted[0]["actor_id"] == "admin-1"
    assert actions.inserted[0]["correlation_id"] == "corr-cipp-security"


def test_direct_legacy_client_mapping_is_retired_before_any_data_write(monkeypatch):
    monkeypatch.setattr(cipp, "db", _db())

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            cipp.link_cipp_tenant(
                "client-a",
                {"tenant_id": "tenant-foreign"},
                _request("/api/clients/client-a/link-cipp-tenant"),
                _admin(),
            )
        )

    assert exc.value.status_code == 410
    assert "Microsoft tenant setup" in exc.value.detail


def test_summary_is_read_only_for_global_connection_settings(monkeypatch):
    settings = _Settings(
        {"type": "cipp", "base_url": "https://provider.example/api", "api_key_full": "server-only"},
        fail_on_update=True,
    )

    async def provider_call(*_args, **_kwargs):
        return []

    monkeypatch.setattr(
        cipp,
        "db",
        _db(
            clients=_CountableClients([]),
            settings=settings,
            actions=_Actions(),
        ),
    )
    monkeypatch.setattr(cipp, "_cipp_call", provider_call)

    response = asyncio.run(cipp.cipp_summary(_admin()))

    assert response["configured"] is True
    assert settings.updates == []


def test_block_signin_reserves_existing_offboarding_approval_before_provider_write(monkeypatch):
    actions = _Actions()
    calls = []

    async def in_scope(*_args, **_kwargs):
        calls.append("scope")
        return {"id": "client-a"}

    async def reserve(request_id, **kwargs):
        calls.append("reserve")
        assert request_id == "verify-block-1"
        assert kwargs["client_id"] == "client-a"
        assert kwargs["action_type"] == "offboarding"
        assert "sign-in blocked" in kwargs["target"]
        assert kwargs["provider_target"] == {
            "provider": "microsoft_entra",
            "tenant_id": "tenant-a",
            "provider_user_id": "user-a",
        }
        return {"id": "verify-block-1"}

    async def provider_call(*_args, **kwargs):
        calls.append("provider")
        assert kwargs["json_body"]["Enable"] is False
        return {"accepted": True}

    async def complete(record, **kwargs):
        calls.append("complete")
        assert record["id"] == "verify-block-1"
        assert "sign-in blocked" in kwargs["outcome"]

    monkeypatch.setattr(cipp, "db", SimpleNamespace(cipp_actions=actions))
    monkeypatch.setattr(cipp, "_assert_tenant_scope", in_scope)
    monkeypatch.setattr(cipp, "begin_verified_execution", reserve)
    monkeypatch.setattr(cipp, "_cipp_call", provider_call)
    monkeypatch.setattr(cipp, "complete_verified_execution", complete)

    response = asyncio.run(
        cipp.block_signin(
            "tenant-a",
            "user-a",
            _request("/api/cipp/tenants/tenant-a/users/user-a/block-signin"),
            {"verification_request_id": "verify-block-1"},
            _admin(),
        )
    )

    assert response["success"] is True
    assert calls == ["scope", "reserve", "provider", "complete"]
    assert actions.inserted[0]["verification_request_id"] == "verify-block-1"
    assert actions.inserted[0]["client_id"] == "client-a"
    assert nexus_verify.ACTION_POLICIES["offboarding"]["approval"] is True


def test_block_signin_does_not_reach_provider_when_verify_reservation_rejects(monkeypatch):
    provider_calls = []

    async def in_scope(*_args, **_kwargs):
        return {"id": "client-a"}

    async def reject_reservation(*_args, **_kwargs):
        raise HTTPException(status_code=428, detail="A Nexus Verify request is required before this sensitive action can run")

    async def provider_call(*_args, **_kwargs):
        provider_calls.append(True)
        return {"unexpected": True}

    monkeypatch.setattr(cipp, "_assert_tenant_scope", in_scope)
    monkeypatch.setattr(cipp, "begin_verified_execution", reject_reservation)
    monkeypatch.setattr(cipp, "_cipp_call", provider_call)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            cipp.block_signin(
                "tenant-a",
                "user-a",
                _request("/api/cipp/tenants/tenant-a/users/user-a/block-signin"),
                {},
                _admin(),
            )
        )

    assert exc.value.status_code == 428
    assert provider_calls == []


def test_block_signin_releases_verify_reservation_after_provider_failure(monkeypatch):
    calls = []

    async def in_scope(*_args, **_kwargs):
        return {"id": "client-a"}

    async def reserve(*_args, **_kwargs):
        return {"id": "verify-block-2"}

    async def provider_call(*_args, **_kwargs):
        calls.append("provider")
        raise HTTPException(status_code=503, detail="Microsoft tenant provider is unreachable")

    async def release(record, **kwargs):
        calls.append("release")
        assert record["id"] == "verify-block-2"
        assert "unreachable" in kwargs["reason"]

    monkeypatch.setattr(cipp, "_assert_tenant_scope", in_scope)
    monkeypatch.setattr(cipp, "begin_verified_execution", reserve)
    monkeypatch.setattr(cipp, "_cipp_call", provider_call)
    monkeypatch.setattr(cipp, "release_verified_execution", release)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            cipp.block_signin(
                "tenant-a",
                "user-a",
                _request("/api/cipp/tenants/tenant-a/users/user-a/block-signin"),
                {"verification_request_id": "verify-block-2"},
                _admin(),
            )
        )

    assert exc.value.status_code == 503
    assert calls == ["provider", "release"]


def test_reset_and_offboard_bind_the_verify_proof_to_the_exact_microsoft_path(monkeypatch):
    actions = _Actions()
    reservations = []

    async def in_scope(*_args, **_kwargs):
        return {"id": "client-a"}

    async def reserve(request_id, **kwargs):
        reservations.append((request_id, kwargs["action_type"], kwargs["provider_target"]))
        return {"id": request_id}

    async def provider_call(*_args, **_kwargs):
        return {"accepted": True}

    async def complete(*_args, **_kwargs):
        return None

    monkeypatch.setattr(cipp, "db", SimpleNamespace(cipp_actions=actions))
    monkeypatch.setattr(cipp, "_assert_tenant_scope", in_scope)
    monkeypatch.setattr(cipp, "begin_verified_execution", reserve)
    monkeypatch.setattr(cipp, "_cipp_call", provider_call)
    monkeypatch.setattr(cipp, "complete_verified_execution", complete)

    async def scenario():
        await cipp.reset_password(
            "tenant-a", "user-a", _request("/api/cipp/tenants/tenant-a/users/user-a/reset-password"),
            {"verification_request_id": "verify-reset"}, _admin(),
        )
        await cipp.offboard_user(
            "tenant-b", "user-b", _request("/api/cipp/tenants/tenant-b/users/user-b/offboard"),
            {"verification_request_id": "verify-offboard"}, _admin(),
        )

    asyncio.run(scenario())

    assert reservations == [
        ("verify-reset", "password_reset", {"provider": "microsoft_entra", "tenant_id": "tenant-a", "provider_user_id": "user-a"}),
        ("verify-offboard", "offboarding", {"provider": "microsoft_entra", "tenant_id": "tenant-b", "provider_user_id": "user-b"}),
    ]


def test_hygiene_digest_routes_require_m365_management_action_permission():
    assert _route_permissions(cipp_hygiene.router, "/cipp/hygiene-digest/send", "POST") == {"m365.tenant.manage"}
    assert _route_permissions(cipp_hygiene.router, "/cipp/digests", "GET") == {"m365.tenant.manage"}


def test_hygiene_digest_controls_reject_restricted_scope_before_accessing_global_data(monkeypatch):
    operations = []

    async def reject_global(_user, **kwargs):
        operations.append(kwargs["operation"])
        raise HTTPException(status_code=403, detail="Global scope required")

    monkeypatch.setattr(cipp_hygiene, "assert_global_scope", reject_global)

    with pytest.raises(HTTPException) as send_error:
        asyncio.run(
            cipp_hygiene.send_hygiene_digest(
                _request("/api/cipp/hygiene-digest/send"),
                {},
                _restricted_user(),
            )
        )
    with pytest.raises(HTTPException) as history_error:
        asyncio.run(
            cipp_hygiene.list_digests(
                _request("/api/cipp/digests"),
                _restricted_user(),
            )
        )

    assert send_error.value.status_code == 403
    assert history_error.value.status_code == 403
    assert operations == ["m365.hygiene.digest.send", "m365.hygiene.digest.history.read"]


def test_hygiene_digest_history_uses_scoped_query_after_global_guard(monkeypatch):
    history = _DigestHistory([{"generated_at": "2026-09-04T00:00:00+00:00"}])
    scoped_calls = []

    async def allow_global(*_args, **_kwargs):
        return {"mode": "all"}

    def scoped(user, query=None, **_kwargs):
        scoped_calls.append((user, query))
        return {"audit_scope": "global"}

    monkeypatch.setattr(cipp_hygiene, "db", SimpleNamespace(cipp_digests=history))
    monkeypatch.setattr(cipp_hygiene, "assert_global_scope", allow_global)
    monkeypatch.setattr(cipp_hygiene, "scoped_query", scoped)

    response = asyncio.run(cipp_hygiene.list_digests(_request("/api/cipp/digests"), _admin()))

    assert response == [{"generated_at": "2026-09-04T00:00:00+00:00"}]
    assert scoped_calls == [(_admin(), None)]
    assert history.query == {
        "$and": [
            {"audit_scope": "global"},
            {
                "$or": [
                    {"tenant_id": "nexus-local"},
                    {"tenant_id": {"$exists": False}},
                    {"tenant_id": None},
                    {"tenant_id": ""},
                ]
            },
        ]
    }
