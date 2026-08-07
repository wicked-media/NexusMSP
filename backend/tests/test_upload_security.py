"""Security contracts for upload naming and client-bound attachment routes."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import client_profile, device_chat, login_wallpaper, ticket_attachments
from app.services.upload_security import IMAGE_EXTENSIONS, safe_original_filename, safe_upload_extension


def _request(parameter: str, value: str):
    return SimpleNamespace(
        path_params={parameter: value},
        method="POST",
        url=SimpleNamespace(path=f"/api/{parameter}/{value}"),
    )


def test_upload_extension_discards_path_components_and_requires_allowlist():
    assert safe_upload_extension(r"..\..\brand.png", allowed=IMAGE_EXTENSIONS) == "png"
    assert safe_original_filename("../../evidence.pdf\r\nX-Test: yes") == "evidence.pdfX-Test: yes"

    with pytest.raises(HTTPException) as exc:
        safe_upload_extension("../../payload.html", allowed=IMAGE_EXTENSIONS)

    assert exc.value.status_code == 400


def test_device_chat_dependency_enforces_device_record_scope(monkeypatch):
    collection = object()
    captured = {}

    async def capture_scope(user, selected_collection, record_id, **kwargs):
        captured.update(user=user, collection=selected_collection, record_id=record_id, kwargs=kwargs)

    monkeypatch.setattr(device_chat, "db", SimpleNamespace(devices=collection))
    monkeypatch.setattr(device_chat, "assert_record_scope", capture_scope)

    asyncio.run(device_chat._enforce_device_scope(_request("device_id", "dev-1"), {"id": "tech-1"}))

    assert captured["collection"] is collection
    assert captured["record_id"] == "dev-1"
    assert captured["kwargs"]["resource_name"] == "Device"


def test_ticket_attachment_dependency_enforces_ticket_record_scope(monkeypatch):
    collection = object()
    captured = {}

    async def capture_scope(user, selected_collection, record_id, **kwargs):
        captured.update(user=user, collection=selected_collection, record_id=record_id, kwargs=kwargs)

    monkeypatch.setattr(ticket_attachments, "db", SimpleNamespace(tickets=collection))
    monkeypatch.setattr(ticket_attachments, "assert_record_scope", capture_scope)

    asyncio.run(ticket_attachments._enforce_ticket_scope(_request("ticket_id", "ticket-1"), {"id": "tech-1"}))

    assert captured["collection"] is collection
    assert captured["record_id"] == "ticket-1"
    assert captured["kwargs"]["resource_name"] == "Ticket"


def test_client_profile_dependency_uses_client_identity_as_scope_boundary(monkeypatch):
    collection = object()
    captured = {}

    async def capture_scope(user, selected_collection, record_id, **kwargs):
        captured.update(user=user, collection=selected_collection, record_id=record_id, kwargs=kwargs)

    monkeypatch.setattr(client_profile, "db", SimpleNamespace(clients=collection))
    monkeypatch.setattr(client_profile, "assert_record_scope", capture_scope)

    asyncio.run(client_profile._enforce_client_profile_scope(_request("client_id", "client-1"), {"id": "tech-1"}))

    assert captured["collection"] is collection
    assert captured["record_id"] == "client-1"
    assert captured["kwargs"]["client_field"] == "id"


def test_client_profile_rejects_active_svg_uploads():
    with pytest.raises(HTTPException):
        client_profile._safe_ext("company-logo.svg", client_profile.ALLOWED_IMAGE_EXTS)


def test_login_wallpaper_changes_require_admin_role():
    asyncio.run(login_wallpaper._require_branding_admin({"id": "admin-1", "role": "admin"}))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(login_wallpaper._require_branding_admin({"id": "tech-1", "role": "technician"}))
    assert exc.value.status_code == 403
