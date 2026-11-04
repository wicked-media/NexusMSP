"""Mock-based contract tests for the shared Yeastar transport and catalogue.

These run against a fake PBX, so they pin the behaviour Nexus depends on
without needing a real appliance: token reuse, the provider's eight-token
limit, revocation, scope resolution and parameter filtering.
"""

import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.services.action_permissions import ACTION_PERMISSION_IDS  # noqa: E402
from app.services.yeastar import client, registry  # noqa: E402
from app.services.yeastar.errors import (  # noqa: E402
    CATEGORIES,
    YeastarError,
    http_status_for,
)

PBX = {
    "id": "pbx-1",
    "name": "Acme PBX",
    "client_id": "client-a",
    "pbx_url": "https://acme.example.yeastarcloud.com",
    "client_api_id": "api-user",
    "client_secret": "api-secret",
    "tls_validation": True,
}


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=None, headers=None):
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else ("{}" if payload is not None else "")
        self.headers = headers or {}

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class FakeAsyncClient:
    """Records every call so a test can prove how many reached the PBX."""

    def __init__(self, *, json_responses=None, get_responses=None, stream_chunks=None, status=200):
        self.calls = []
        self.json_responses = list(json_responses or [])
        self.get_responses = list(get_responses or [])
        self.stream_chunks = list(stream_chunks or [b"audio-bytes"])
        self.status = status

    async def post(self, url, **kwargs):
        self.calls.append(("POST", url, kwargs))
        payload = self.json_responses.pop(0) if self.json_responses else {"errcode": 0, "data": []}
        return FakeResponse(status_code=self.status, payload=payload)

    async def get(self, url, **kwargs):
        self.calls.append(("GET", url, kwargs))
        payload = self.get_responses.pop(0) if self.get_responses else {"errcode": 0, "data": []}
        return FakeResponse(status_code=self.status, payload=payload)

    def stream(self, method, url, **kwargs):
        outer = self

        class _Stream:
            def __init__(self):
                self.status_code = 200
                self.headers = {}

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def aiter_bytes(self):
                for chunk in outer.stream_chunks:
                    yield chunk

        outer.calls.append((method, url, kwargs))
        return _Stream()


def _install(monkeypatch, fake):
    async def _pooled(verify):
        assert verify in (True, False)
        return fake

    monkeypatch.setattr(client, "_pooled_client", _pooled)
    client.invalidate_token()
    return fake


def _token_payload(token="tok-1", lifetime=1800):
    return {"errcode": 0, "access_token": token, "access_token_expire_time": lifetime}


# --- URL and credential handling -------------------------------------------


def test_normalise_pbx_url_strips_openapi_and_adds_scheme():
    assert client.normalise_pbx_url("acme.example.com") == "https://acme.example.com"
    assert client.normalise_pbx_url("https://acme.example.com/openapi/") == "https://acme.example.com"
    assert client.normalise_pbx_url("https://acme.example.com/openapi/v1.0") == "https://acme.example.com"
    assert client.normalise_pbx_url("http://10.0.0.5:8088/") == "http://10.0.0.5:8088"


@pytest.mark.parametrize("value", ["", "   ", "ftp://acme.example.com", "not a url"])
def test_normalise_pbx_url_rejects_unusable_values(value):
    with pytest.raises(ValueError):
        client.normalise_pbx_url(value)


def test_credential_detection_supports_both_field_names():
    assert client.pbx_client_id({}) == ""
    assert client.pbx_client_id({"client_api_id": "a"}) == "a"
    assert client.pbx_client_id({"client_id": "b"}) == "b"
    assert client.has_credentials(PBX) is True
    assert client.has_credentials({**PBX, "client_secret": ""}) is False
    assert client.has_credentials({**PBX, "pbx_url": ""}) is False


def test_verify_tls_prefers_the_per_pbx_choice(monkeypatch):
    monkeypatch.delenv("ALLOW_SELF_SIGNED_CERTS", raising=False)
    assert client.verify_tls_for({"tls_validation": True}) is True
    assert client.verify_tls_for({"tls_validation": False}) is False
    # No explicit choice falls back to the deployment default, which is "verify".
    assert client.verify_tls_for({}) is True
    monkeypatch.setenv("ALLOW_SELF_SIGNED_CERTS", "true")
    assert client.verify_tls_for({}) is False


# --- Tokens -----------------------------------------------------------------


def test_token_is_cached_and_the_pbx_is_authenticated_once(monkeypatch):
    fake = _install(monkeypatch, FakeAsyncClient(json_responses=[_token_payload()]))

    async def run():
        return [await client.get_token(PBX) for _ in range(3)]

    tokens = asyncio.run(run())
    assert tokens == ["tok-1", "tok-1", "tok-1"]
    posts = [call for call in fake.calls if call[0] == "POST"]
    assert len(posts) == 1, "a cached token must not spend another of the eight slots"
    assert posts[0][1].endswith("/openapi/v1.0/get_token")


def test_token_is_renewed_once_the_cache_expires(monkeypatch):
    fake = _install(
        monkeypatch,
        FakeAsyncClient(json_responses=[_token_payload("tok-1", 60), _token_payload("tok-2", 1800)]),
    )

    async def run():
        first = await client.get_token(PBX)
        # A 60 second lifetime minus the 60 second safety margin is already
        # stale, so the next call must authenticate again.
        second = await client.get_token(PBX)
        return first, second

    assert asyncio.run(run()) == ("tok-1", "tok-2")
    assert len([call for call in fake.calls if call[0] == "POST"]) == 2


def test_token_limit_error_keeps_its_actionable_message(monkeypatch):
    _install(monkeypatch, FakeAsyncClient(json_responses=[{"errcode": 60002, "errmsg": "too many tokens"}]))

    with pytest.raises(YeastarError) as excinfo:
        asyncio.run(client.get_token(PBX, strict=True))
    assert excinfo.value.category == "authentication"
    assert "eight-token limit" in str(excinfo.value)


def test_rejected_credentials_are_reported_without_leaking_the_secret(monkeypatch):
    _install(monkeypatch, FakeAsyncClient(json_responses=[{"errcode": 10003, "errmsg": "invalid client"}]))

    with pytest.raises(YeastarError) as excinfo:
        asyncio.run(client.get_token(PBX, strict=True))
    message = str(excinfo.value)
    assert "Integrations > API" in message
    assert "api-secret" not in message


def test_non_strict_token_failure_returns_none(monkeypatch):
    _install(monkeypatch, FakeAsyncClient(json_responses=[{"errcode": 10003, "errmsg": "invalid client"}]))
    assert asyncio.run(client.get_token(PBX)) is None


def test_missing_configuration_is_a_configuration_error(monkeypatch):
    _install(monkeypatch, FakeAsyncClient())
    with pytest.raises(YeastarError) as excinfo:
        asyncio.run(client.get_token({"pbx_url": "", "client_id": "", "client_secret": ""}, strict=True))
    assert excinfo.value.category == "configuration"
    assert asyncio.run(client.get_token({})) is None


def test_non_openapi_endpoint_is_diagnosed_as_an_endpoint_problem(monkeypatch):
    _install(monkeypatch, FakeAsyncClient(json_responses=[None]))
    fake = FakeAsyncClient()
    _install(monkeypatch, fake)

    async def boom(url, **kwargs):
        fake.calls.append(("POST", url, kwargs))
        return FakeResponse(status_code=200, payload=None, text="<html>nginx</html>")

    monkeypatch.setattr(fake, "post", boom)
    with pytest.raises(YeastarError) as excinfo:
        asyncio.run(client.get_token(PBX, strict=True))
    assert excinfo.value.category == "endpoint"
    assert "without /openapi" in str(excinfo.value)


def test_revoke_releases_the_token_slot_and_clears_the_cache(monkeypatch):
    fake = FakeAsyncClient(json_responses=[_token_payload()])
    _install(monkeypatch, fake)
    assert asyncio.run(client.get_token(PBX)) == "tok-1"

    assert asyncio.run(client.revoke_token(PBX)) is True
    revokes = [call for call in fake.calls if call[0] == "GET" and call[1].endswith("/openapi/v1.0/del_token")]
    assert len(revokes) == 1
    assert revokes[0][2]["params"]["access_token"] == "tok-1"
    # The slot is forgotten locally, so nothing tries to reuse a dead token.
    assert client.token_cache_key(PBX) not in client._tokens


def test_revoke_without_a_token_reports_nothing_released(monkeypatch):
    _install(monkeypatch, FakeAsyncClient())
    assert asyncio.run(client.revoke_token(PBX)) is False


# --- Calls ------------------------------------------------------------------


def test_api_call_sends_the_token_and_returns_the_payload(monkeypatch):
    fake = FakeAsyncClient(json_responses=[_token_payload()], get_responses=[{"errcode": 0, "data": [{"number": "101"}]}])
    _install(monkeypatch, fake)

    payload = asyncio.run(client.api_call(PBX, "extension/list", strict=True))
    assert payload["data"] == [{"number": "101"}]
    get = [call for call in fake.calls if call[0] == "GET"][0]
    assert get[1] == "https://acme.example.yeastarcloud.com/openapi/v1.0/extension/list"
    assert get[2]["params"]["access_token"] == "tok-1"


def test_api_call_uses_the_requested_api_version(monkeypatch):
    fake = FakeAsyncClient(json_responses=[_token_payload()])
    _install(monkeypatch, fake)
    asyncio.run(client.api_call(PBX, "cdr/list", version="2.0", strict=True))
    get = [call for call in fake.calls if call[0] == "GET"][0]
    assert "/openapi/v2.0/cdr/list" in get[1]


def test_api_call_fails_soft_unless_the_caller_asks_otherwise(monkeypatch):
    fake = FakeAsyncClient(json_responses=[_token_payload()], get_responses=[{"errcode": 0}], status=500)
    _install(monkeypatch, fake)
    assert asyncio.run(client.api_call(PBX, "system/information")) is None
    client.invalidate_token()
    monkeypatch.setattr(fake, "get", fake.get)
    with pytest.raises(YeastarError) as excinfo:
        asyncio.run(client.api_call(PBX, "system/information", strict=True))
    assert excinfo.value.category == "http"


def test_provider_error_envelope_is_raised_when_strict(monkeypatch):
    fake = FakeAsyncClient(json_responses=[_token_payload()], get_responses=[{"errcode": 10004, "errmsg": "token expired"}])
    _install(monkeypatch, fake)
    with pytest.raises(YeastarError) as excinfo:
        asyncio.run(client.api_call(PBX, "extension/list", strict=True))
    assert excinfo.value.category == "authentication"
    assert excinfo.value.errcode == 10004


def test_dispatch_only_forwards_declared_parameters(monkeypatch):
    fake = FakeAsyncClient(json_responses=[_token_payload()])
    _install(monkeypatch, fake)
    operation = registry.get_operation("extension.search")
    assert operation is not None

    asyncio.run(
        client.dispatch_operation(
            PBX,
            operation,
            params={"search": "101", "page": 1, "delete_everything": "yes"},
            strict=True,
        )
    )
    get = [call for call in fake.calls if call[0] == "GET"][0]
    assert get[2]["params"]["search"] == "101"
    assert "delete_everything" not in get[2]["params"]


def test_fetch_bytes_relays_artifact_content(monkeypatch):
    _install(monkeypatch, FakeAsyncClient(json_responses=[_token_payload()], stream_chunks=[b"abc", b"def"]))
    content, content_type = asyncio.run(client.fetch_bytes(PBX, "recording/download", params={"id": "7"}, max_bytes=1024))
    assert content == b"abcdef"
    assert content_type == "application/octet-stream"


def test_fetch_bytes_refuses_an_oversized_artifact(monkeypatch):
    _install(monkeypatch, FakeAsyncClient(json_responses=[_token_payload()], stream_chunks=[b"x" * 64]))
    with pytest.raises(YeastarError) as excinfo:
        asyncio.run(client.fetch_bytes(PBX, "recording/download", max_bytes=16))
    assert excinfo.value.category == "configuration"


# --- Scope resolution -------------------------------------------------------


def test_scoped_resolution_never_reaches_another_clients_pbx(monkeypatch):
    out_of_scope_pbx = {"id": "pbx-b", "client_id": "client-b", "name": "Other PBX"}

    class FakePbxs:
        async def find_one(self, query, projection=None):
            return dict(out_of_scope_pbx) if query.get("id") == "pbx-b" else None

    class FakeDb:
        yeastar_pbxs = FakePbxs()
        settings = type("S", (), {"find_one": staticmethod(lambda *a, **k: _never())})()

    monkeypatch.setattr(client, "db", FakeDb())

    async def deny(user, client_id, **kwargs):
        raise HTTPException(status_code=403, detail="out of scope")

    monkeypatch.setattr(client, "assert_client_scope", deny)
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(client.resolve_pbx({"id": "tech", "role": "technician"}, "pbx-b"))
    assert excinfo.value.status_code == 403


async def _never():
    return None


def test_legacy_singleton_is_reserved_for_all_client_actors():
    assert client.caller_may_use_legacy_settings({"is_admin": True}) is True
    assert client.caller_may_use_legacy_settings({"role": "admin"}) is True
    assert client.caller_may_use_legacy_settings({"role": "technician"}) is False
    assert client.caller_may_use_legacy_settings({"role": "technician", "client_scope_mode": "selected"}) is False


def test_resolution_fails_closed_when_nothing_is_in_scope(monkeypatch):
    class Empty:
        async def find_one(self, *args, **kwargs):
            return None

    class FakeDb:
        yeastar_pbxs = Empty()
        settings = Empty()

    monkeypatch.setattr(client, "db", FakeDb())
    with pytest.raises(YeastarError) as excinfo:
        asyncio.run(client.resolve_pbx({"role": "technician"}))
    assert excinfo.value.category == "configuration"
    # ...even when the caller asks for the legacy path, because it is not global.
    assert asyncio.run(client.resolve_pbx_optional({"role": "technician"}, include_legacy=True)) is None


# --- Catalogue integrity ----------------------------------------------------


def test_every_gated_operation_names_a_real_permission():
    missing = registry.REQUIRED_ACTIONS - ACTION_PERMISSION_IDS
    assert not missing, f"catalogue gates on permissions that do not exist: {sorted(missing)}"


def test_every_write_is_gated_and_every_identifier_is_unique():
    ids = [operation.id for operation in registry.OPERATIONS]
    assert len(ids) == len(set(ids)), "duplicate operation ids"
    ungated = [operation.id for operation in registry.OPERATIONS if operation.is_write and not operation.action]
    assert not ungated, f"writes without an action gate: {ungated}"
    assert registry.get_operation("not.a.real.operation") is None


def test_operations_only_use_supported_methods_and_versions():
    for operation in registry.OPERATIONS:
        assert operation.method in registry.ALLOWED_METHODS, operation.id
        assert operation.version in {"1.0", "2.0"}, operation.id


def test_proxied_operations_never_reach_the_generic_dispatcher():
    proxied = {operation.id for operation in registry.OPERATIONS if operation.proxied}
    dispatched = {operation.id for operation in registry.dispatcher_operations()}
    assert proxied, "the catalogue is expected to contain artifact-download interfaces"
    assert not (proxied & dispatched)


def test_catalogue_exposes_no_secret_material():
    for group in registry.catalogue():
        for operation in group["operations"]:
            assert set(operation) == {"id", "method", "summary", "access", "destructive", "proxied", "required_action", "params"}


def test_error_taxonomy_stays_closed():
    assert CATEGORIES == {
        "configuration",
        "authentication",
        "connection",
        "timeout",
        "tls",
        "endpoint",
        "http",
        "api",
        "not_found",
        "unknown",
    }
    assert YeastarError("x", "nonsense").category == "unknown"


@pytest.mark.parametrize(
    ("category", "expected"),
    [
        ("not_found", 404),
        ("configuration", 400),
        ("authentication", 400),
        ("timeout", 504),
        ("connection", 502),
        ("api", 502),
    ],
)
def test_error_categories_map_to_api_status(category, expected):
    assert http_status_for(YeastarError("x", category)) == expected
