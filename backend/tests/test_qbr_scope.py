"""Scope regressions for legacy Living QBR direct-ID routes."""

import asyncio

import pytest
from fastapi import HTTPException

from app.routers import qbr


class _QbrCollection:
    def __init__(self, document):
        self.document = document
        self.queries = []

    async def find_one(self, query, *_args, **_kwargs):
        self.queries.append(query)
        return self.document


def test_saved_qbr_direct_lookup_reapplies_client_scope(monkeypatch):
    collection = _QbrCollection({"id": "qbr-1", "tenant_id": "tenant-a", "client_id": "client-a"})
    monkeypatch.setattr(qbr.db, "qbrs", collection)
    checked = {}

    async def assert_scope(user, client_id, **kwargs):
        checked.update(user=user, client_id=client_id, **kwargs)

    monkeypatch.setattr(qbr, "assert_client_scope", assert_scope)

    document = asyncio.run(qbr.get_qbr("qbr-1", {"id": "tech-1", "tenant_id": "tenant-a", "client_scope_mode": "restricted", "client_scope_ids": ["client-a"]}))

    assert document["id"] == "qbr-1"
    assert checked["client_id"] == "client-a"
    assert checked["mask_not_found"] is True
    assert collection.queries == [{"$and": [{"id": "qbr-1"}, {"tenant_id": "tenant-a"}]}]


def test_saved_qbr_direct_lookup_masks_out_of_scope_client(monkeypatch):
    collection = _QbrCollection({"id": "qbr-1", "tenant_id": "tenant-a", "client_id": "client-b"})
    monkeypatch.setattr(qbr.db, "qbrs", collection)

    async def reject_scope(*_args, **_kwargs):
        raise HTTPException(status_code=404, detail="Resource not found")

    monkeypatch.setattr(qbr, "assert_client_scope", reject_scope)

    with pytest.raises(HTTPException, match="Resource not found"):
        asyncio.run(qbr.get_qbr("qbr-1", {"id": "tech-1", "tenant_id": "tenant-a", "client_scope_mode": "restricted", "client_scope_ids": ["client-a"]}))
