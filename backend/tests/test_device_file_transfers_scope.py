"""Regression coverage for tenant partitioning of Nexus Agent file transfers."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import device_file_transfers


class _Devices:
    def __init__(self):
        self.query = None

    async def find_one(self, query, _projection=None):
        self.query = query
        return None


def test_file_transfer_list_masks_foreign_tenant_before_reading_transfers(monkeypatch):
    devices = _Devices()
    monkeypatch.setattr(device_file_transfers, "db", SimpleNamespace(devices=devices))

    with pytest.raises(HTTPException) as denied:
        asyncio.run(device_file_transfers.list_file_transfers(
            "device-from-another-tenant",
            current_user={"id": "tech-1", "tenant_id": "tenant-a", "is_admin": True},
        ))

    assert denied.value.status_code == 404
    assert devices.query == {
        "$and": [{"id": "device-from-another-tenant"}, {"tenant_id": "tenant-a"}]
    }
