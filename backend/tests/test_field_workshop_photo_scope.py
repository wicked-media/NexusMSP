"""Regression coverage for scope-checked field, workshop and chat artifacts.

Job photos and device chat attachments are customer evidence. They must never
be reachable through the public upload mount and their download routes must
bind lookups to the scoped job or device plus the caller's tenant.
"""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import device_chat, field_enhanced, workshop


class _FakeCollection:
    def __init__(self, result=None):
        self.result = result
        self.queries = []
        self.inserted = []

    async def find_one(self, query, _projection=None):
        self.queries.append(query)
        return self.result

    async def insert_one(self, doc):
        self.inserted.append(doc)
        return SimpleNamespace(inserted_id="fake")


class _FakeUpload:
    content_type = "image/png"
    filename = "photo.png"

    async def read(self):
        return b"\x89PNG\r\n\x1a\n" + b"0" * 32


def _dumped(query):
    return json.dumps(query, sort_keys=True, default=str)


def test_field_photo_download_binds_photo_job_and_tenant_scope(monkeypatch):
    photos = _FakeCollection(result=None)
    monkeypatch.setattr(field_enhanced, "db", SimpleNamespace(field_photos=photos))

    with pytest.raises(HTTPException) as denied:
        asyncio.run(field_enhanced.download_field_photo(
            "job-1",
            "photo-1",
            current_user={"id": "tech-1", "tenant_id": "tenant-a"},
        ))

    assert denied.value.status_code == 404
    dumped = _dumped(photos.queries[0])
    assert '"photo-1"' in dumped
    assert '"job-1"' in dumped
    # The lookup is bounded by the caller's client scope (fail closed for a
    # caller with no client grants), not just by photo and job identifiers.
    assert '"client_id"' in dumped


def test_workshop_photo_download_binds_photo_job_and_tenant_scope(monkeypatch):
    photos = _FakeCollection(result=None)
    monkeypatch.setattr(workshop, "db", SimpleNamespace(workshop_photos=photos))

    with pytest.raises(HTTPException) as denied:
        asyncio.run(workshop.download_workshop_photo(
            "job-2",
            "photo-2",
            current_user={"id": "tech-1", "tenant_id": "tenant-a"},
        ))

    assert denied.value.status_code == 404
    dumped = _dumped(photos.queries[0])
    assert '"photo-2"' in dumped
    assert '"job-2"' in dumped
    # The lookup is bounded by the caller's client scope (fail closed for a
    # caller with no client grants), not just by photo and job identifiers.
    assert '"client_id"' in dumped


def test_field_photo_upload_references_scope_checked_route(monkeypatch, tmp_path):
    photos = _FakeCollection()
    audit = _FakeCollection()
    monkeypatch.setattr(field_enhanced, "db", SimpleNamespace(
        field_jobs=_FakeCollection(result={"id": "job-1", "client_id": "client-a"}),
        field_photos=photos,
        field_audit_log=audit,
    ))
    monkeypatch.setattr(field_enhanced, "PHOTO_DIR", tmp_path)

    photo = asyncio.run(field_enhanced.upload_field_photo(
        "job-1",
        photo_type="general",
        file=_FakeUpload(),
        current_user={"id": "tech-1", "tenant_id": "tenant-a"},
    ))

    assert photo["url"] == f"/api/field-jobs/job-1/photos/{photo['id']}/file"
    assert "/api/uploads/" not in photo["url"]


def test_workshop_photo_upload_references_scope_checked_route(monkeypatch, tmp_path):
    photos = _FakeCollection()
    audit = _FakeCollection()
    monkeypatch.setattr(workshop, "db", SimpleNamespace(
        workshop_jobs=_FakeCollection(result={"id": "job-2", "client_id": "client-a"}),
        workshop_photos=photos,
        workshop_audit_log=audit,
    ))
    monkeypatch.setattr(workshop, "PHOTO_DIR", tmp_path)

    photo = asyncio.run(workshop.upload_workshop_photo(
        "job-2",
        photo_type="general",
        file=_FakeUpload(),
        current_user={"id": "tech-1", "tenant_id": "tenant-a"},
    ))

    assert photo["url"] == f"/api/workshop/jobs/job-2/photos/{photo['id']}/file"
    assert "/api/uploads/" not in photo["url"]


def test_chat_attachment_upload_references_scope_checked_route(monkeypatch, tmp_path):
    monkeypatch.setattr(device_chat, "UPLOAD_DIR", tmp_path)

    attachment = asyncio.run(device_chat.upload_chat_attachment(
        "device-a",
        file=_FakeUpload(),
        current_user={"id": "tech-1", "tenant_id": "tenant-a"},
    ))

    assert attachment["url"].startswith("/api/devices/device-a/chat/attachments/")
    assert "/api/uploads/" not in attachment["url"]


def test_chat_attachment_download_rejects_foreign_device_filename(monkeypatch, tmp_path):
    monkeypatch.setattr(device_chat, "UPLOAD_DIR", tmp_path)
    (tmp_path / "device-b_x.bin").write_bytes(b"foreign-device-evidence")

    with pytest.raises(HTTPException) as denied:
        asyncio.run(device_chat.download_chat_attachment(
            "device-a",
            "device-b_x.bin",
            current_user={"id": "tech-1", "tenant_id": "tenant-a"},
        ))

    assert denied.value.status_code == 404


def test_chat_attachment_download_rejects_traversal_filename(monkeypatch, tmp_path):
    monkeypatch.setattr(device_chat, "UPLOAD_DIR", tmp_path)
    (tmp_path / "device-a_x.bin").write_bytes(b"scoped-evidence")

    with pytest.raises(HTTPException) as denied:
        asyncio.run(device_chat.download_chat_attachment(
            "device-a",
            "../device-a_x.bin",
            current_user={"id": "tech-1", "tenant_id": "tenant-a"},
        ))

    assert denied.value.status_code == 404
