"""Mock-based contract tests for the YCM fleet transport.

YCM is a fleet-wide OAuth client rather than a per-customer PBX, so these tests
pin the behaviour the voice routes depend on: one token per API application,
a settings payload that can be returned to the browser without its secret, and
the same categorised failures as the PBX client.
"""

import asyncio
import os
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.services.yeastar import ycm  # noqa: E402
from app.services.yeastar.errors import YeastarError  # noqa: E402

SETTINGS = {
    "client_id": "ycm-client",
    "client_secret": "ycm-secret",
    "base_url": "https://ycm.yeastar.com",
    "user_agent": "NexusMSP-tests",
}


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload
        self.content = b"{}" if payload is not None else b""

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class FakeAsyncClient:
    """Records every fleet call and answers as an async context manager."""

    def __init__(self, *, token_payloads=None, get_payloads=None, post_status=200, get_status=200):
        self.calls = []
        self.token_payloads = list(token_payloads or [])
        self.get_payloads = list(get_payloads or [])
        self.post_status = post_status
        self.get_status = get_status

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, **kwargs):
        self.calls.append(("POST", url, kwargs))
        payload = self.token_payloads.pop(0) if self.token_payloads else {"access_token": "tok-1", "expires_in": 1800}
        return FakeResponse(status_code=self.post_status, payload=payload)

    async def get(self, url, **kwargs):
        self.calls.append(("GET", url, kwargs))
        payload = self.get_payloads.pop(0) if self.get_payloads else {"errcode": 0, "data": []}
        return FakeResponse(status_code=self.get_status, payload=payload)


def _install(monkeypatch, fake):
    monkeypatch.setattr(ycm, "_client", lambda timeout: fake)
    ycm.invalidate_ycm_token()
    return fake


# --- Address handling -------------------------------------------------------


def test_normalise_ycm_url_accepts_a_bare_host_and_strips_the_path():
    assert ycm.normalise_ycm_url("ycm.yeastar.com") == "https://ycm.yeastar.com"
    assert ycm.normalise_ycm_url("https://ycm.example.com/dm/open_api/") == "https://ycm.example.com/dm/open_api"
    assert ycm.normalise_ycm_url("") == ycm.DEFAULT_BASE_URL


@pytest.mark.parametrize("value", ["http://ycm.yeastar.com", "ftp://ycm.yeastar.com", "not a url", "   "])
def test_normalise_ycm_url_rejects_unusable_values(value):
    with pytest.raises(ValueError):
        ycm.normalise_ycm_url(value)


# --- Settings that are safe to return --------------------------------------


def test_safe_settings_never_returns_the_client_secret():
    safe = ycm.safe_ycm_settings({**SETTINGS, "last_test_status": "verified"})
    assert "client_secret" not in safe
    assert "ycm-secret" not in str(safe)
    assert safe["configured"] is True
    assert safe["base_url"] == "https://ycm.yeastar.com"
    assert safe["last_test_status"] == "verified"


def test_safe_settings_describes_an_unconfigured_connection():
    safe = ycm.safe_ycm_settings(None)
    assert safe["configured"] is False
    assert safe["client_id"] == ""
    assert safe["base_url"] == ycm.DEFAULT_BASE_URL
    assert safe["last_test_status"] == "not_tested"


def test_items_understands_the_envelopes_ycm_returns():
    rows = [{"id": "pbx-1"}, {"id": "pbx-2"}]
    assert ycm.ycm_items(rows) == rows
    assert ycm.ycm_items({"data": rows}) == rows
    assert ycm.ycm_items({"data": {"items": rows}}) == rows
    assert ycm.ycm_items({"data": {"list": rows}}) == rows
    assert ycm.ycm_items({"instances": rows}) == rows
    assert ycm.ycm_items({"data": ["not a record", {"id": "pbx-1"}]}) == [{"id": "pbx-1"}]
    assert ycm.ycm_items(None) == []
    assert ycm.ycm_items("text") == []
    assert ycm.ycm_items({"data": "text"}) == []


# --- Tokens -----------------------------------------------------------------


def test_one_token_is_minted_for_repeated_fleet_calls(monkeypatch):
    fake = _install(monkeypatch, FakeAsyncClient())

    async def run():
        return [await ycm.get_ycm_token(SETTINGS) for _ in range(3)]

    assert asyncio.run(run()) == ["tok-1", "tok-1", "tok-1"]
    posts = [call for call in fake.calls if call[0] == "POST"]
    assert len(posts) == 1, "a cached fleet token must not be minted again"
    assert posts[0][1] == "https://ycm.yeastar.com/dm/open_api/oauth/token"
    assert posts[0][2]["data"] == {
        "grant_type": "client_credentials",
        "client_id": "ycm-client",
        "client_secret": "ycm-secret",
    }
    assert posts[0][2]["headers"]["User-Agent"] == "NexusMSP-tests"


def test_invalidate_forces_a_new_token(monkeypatch):
    fake = _install(monkeypatch, FakeAsyncClient(token_payloads=[{"access_token": "tok-1"}, {"access_token": "tok-2"}]))

    async def run():
        first = await ycm.get_ycm_token(SETTINGS)
        ycm.invalidate_ycm_token()
        second = await ycm.get_ycm_token(SETTINGS)
        return first, second

    assert asyncio.run(run()) == ("tok-1", "tok-2")
    assert len([call for call in fake.calls if call[0] == "POST"]) == 2


def test_rejected_credentials_are_reported_without_the_secret(monkeypatch):
    _install(monkeypatch, FakeAsyncClient(post_status=401))

    with pytest.raises(YeastarError) as excinfo:
        asyncio.run(ycm.get_ycm_token(SETTINGS, strict=True))
    message = str(excinfo.value)
    assert excinfo.value.category == "authentication"
    assert "Check the YCM API application" in message
    assert "ycm-secret" not in message


def test_a_rejected_credential_is_raised_even_when_not_strict(monkeypatch):
    # Returning None would report a wrong secret as "not configured", which
    # hides an operator error behind a missing-credential message.
    _install(monkeypatch, FakeAsyncClient(post_status=403))
    with pytest.raises(YeastarError) as excinfo:
        asyncio.run(ycm.get_ycm_token(SETTINGS))
    assert excinfo.value.category == "authentication"


def test_missing_credentials_are_a_configuration_error(monkeypatch):
    fake = _install(monkeypatch, FakeAsyncClient())

    async def run():
        return await ycm.get_ycm_token({"client_id": "", "client_secret": ""})

    assert asyncio.run(run()) is None
    with pytest.raises(YeastarError) as excinfo:
        asyncio.run(ycm.get_ycm_token({}, strict=True))
    assert excinfo.value.category == "configuration"
    assert fake.calls == [], "missing credentials must not reach the network"


def test_unreachable_ycm_degrades_unless_strict(monkeypatch):
    fake = _install(monkeypatch, FakeAsyncClient())

    async def boom(url, **kwargs):
        raise ycm.httpx.ConnectError("no route")

    monkeypatch.setattr(fake, "post", boom)
    assert asyncio.run(ycm.get_ycm_token(SETTINGS)) is None
    with pytest.raises(YeastarError) as excinfo:
        asyncio.run(ycm.get_ycm_token(SETTINGS, strict=True))
    assert excinfo.value.category == "connection"


# --- Fleet reads ------------------------------------------------------------


def test_api_get_sends_a_bearer_token_and_the_configured_user_agent(monkeypatch):
    rows = [{"id": "pbx-1", "name": "Acme Cloud PBX"}]
    fake = _install(monkeypatch, FakeAsyncClient(get_payloads=[{"data": rows}]))

    payload = asyncio.run(ycm.ycm_api_get("v2/cloud_pbx/instances", SETTINGS))

    assert ycm.ycm_items(payload) == rows
    gets = [call for call in fake.calls if call[0] == "GET"]
    assert len(gets) == 1
    assert gets[0][1] == "https://ycm.yeastar.com/dm/open_api/v2/cloud_pbx/instances"
    assert gets[0][2]["headers"]["Authorization"] == "Bearer tok-1"
    assert gets[0][2]["headers"]["User-Agent"] == "NexusMSP-tests"


def test_api_get_maps_a_server_error_to_an_http_failure(monkeypatch):
    _install(monkeypatch, FakeAsyncClient(get_status=500))
    with pytest.raises(YeastarError) as excinfo:
        asyncio.run(ycm.ycm_api_get("v2/cloud_pbx/instances", SETTINGS))
    assert excinfo.value.category == "http"
    assert str(excinfo.value) == "YCM fleet request failed with HTTP 500."


def test_a_non_object_fleet_payload_is_wrapped(monkeypatch):
    _install(monkeypatch, FakeAsyncClient(get_payloads=[[{"id": "pbx-1"}]]))
    assert asyncio.run(ycm.ycm_api_get("v2/cloud_pbx/instances", SETTINGS)) == {"data": [{"id": "pbx-1"}]}
