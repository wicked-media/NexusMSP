import asyncio

import pytest
from fastapi import HTTPException

from app.routers.device_discovery import discover_devices


class _Collection:
    async def find_one(self, *args, **kwargs):
        return None


class _Database:
    clients = _Collection()


def test_discovery_rejects_non_private_or_overbroad_networks(monkeypatch):
    monkeypatch.setattr("app.routers.device_discovery.db", _Database())
    async def allowed_scope(*args, **kwargs):
        return None
    monkeypatch.setattr("app.routers.device_discovery.assert_client_scope", allowed_scope)

    with pytest.raises(HTTPException, match="private CIDRs"):
        asyncio.run(
            discover_devices(
                {"client_id": "client-001", "subnet": "0.0.0.0/0"},
                {"id": "admin-001", "role": "admin"},
            )
        )


def test_discovery_rejects_invalid_cidr_before_any_scan(monkeypatch):
    monkeypatch.setattr("app.routers.device_discovery.db", _Database())
    async def allowed_scope(*args, **kwargs):
        return None
    monkeypatch.setattr("app.routers.device_discovery.assert_client_scope", allowed_scope)

    with pytest.raises(HTTPException, match="valid CIDR"):
        asyncio.run(
            discover_devices(
                {"client_id": "client-001", "subnet": "not-a-subnet"},
                {"id": "admin-001", "role": "admin"},
            )
        )
