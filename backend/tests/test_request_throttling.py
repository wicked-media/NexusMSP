import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models import UserLogin
from app.routers import auth
from app.services.request_throttling import (
    LoginRateLimitExceeded,
    clear_login_attempts,
    client_address,
    consume_login_attempt,
    ensure_request_throttle_indexes,
)


class FakeCollection:
    def __init__(self):
        self.documents = {}
        self.indexes = []

    async def create_index(self, field, **options):
        self.indexes.append((field, options))

    async def find_one_and_update(self, query, update, **_options):
        key = query["_id"]
        document = self.documents.setdefault(key, {"_id": key, **update["$setOnInsert"]})
        document["count"] = document.get("count", 0) + update["$inc"]["count"]
        return dict(document)

    async def delete_many(self, query):
        for key in query["_id"]["$in"]:
            self.documents.pop(key, None)


def request(ip="203.0.113.8", forwarded=""):
    headers = {"x-forwarded-for": forwarded} if forwarded else {}
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=ip))


def test_client_address_ignores_untrusted_forwarded_header(monkeypatch):
    monkeypatch.setenv("NEXUS_TRUST_PROXY_HEADERS", "false")
    assert client_address(request(forwarded="198.51.100.7")) == "203.0.113.8"


def test_client_address_uses_first_address_from_trusted_proxy(monkeypatch):
    monkeypatch.setenv("NEXUS_TRUST_PROXY_HEADERS", "true")
    assert client_address(request(forwarded="198.51.100.7, 10.0.0.2")) == "198.51.100.7"


def test_login_limiter_is_distributed_private_and_resettable(monkeypatch):
    monkeypatch.setenv("NEXUS_TRUST_PROXY_HEADERS", "false")
    monkeypatch.setenv("NEXUS_LOGIN_IDENTITY_ATTEMPTS", "2")
    monkeypatch.setenv("NEXUS_LOGIN_IP_ATTEMPTS", "10")
    monkeypatch.setenv("NEXUS_LOGIN_WINDOW_SECONDS", "300")
    collection = FakeCollection()
    now = datetime(2026, 8, 7, 1, 2, tzinfo=timezone.utc)
    req = request()

    asyncio.run(consume_login_attempt(req, "Aaron@Example.com", collection=collection, now=now))
    asyncio.run(consume_login_attempt(req, "aaron@example.com", collection=collection, now=now))

    with pytest.raises(LoginRateLimitExceeded) as caught:
        asyncio.run(consume_login_attempt(req, "aaron@example.com", collection=collection, now=now))

    assert 1 <= caught.value.retry_after <= 300
    assert all("aaron@example.com" not in key for key in collection.documents)
    assert all("203.0.113.8" not in key for key in collection.documents)

    asyncio.run(clear_login_attempts(req, "aaron@example.com", collection=collection, now=now))
    asyncio.run(consume_login_attempt(req, "aaron@example.com", collection=collection, now=now))


def test_throttle_ttl_index_is_configured():
    collection = FakeCollection()
    asyncio.run(ensure_request_throttle_indexes(collection))
    assert collection.indexes == [
        ("expires_at", {"expireAfterSeconds": 0, "name": "expire_security_rate_limits"})
    ]


def test_login_route_returns_stable_429_contract(monkeypatch):
    async def blocked(_request, _email):
        raise LoginRateLimitExceeded(retry_after=47)

    async def audit_noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(auth, "consume_login_attempt", blocked)
    monkeypatch.setattr(auth, "_log_auth_event", audit_noop)

    with pytest.raises(HTTPException) as caught:
        asyncio.run(auth.login(
            UserLogin(email="aaron@example.com", password="not-a-real-password"),
            request(),
        ))

    assert caught.value.status_code == 429
    assert caught.value.detail == "Too many sign-in attempts. Try again later."
    assert caught.value.headers == {"Retry-After": "47"}
