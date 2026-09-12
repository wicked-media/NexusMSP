"""Security contracts for upload naming and client-bound attachment routes."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import client_profile, device_chat, login_wallpaper, ticket_attachments, tickets
from app.services.action_permissions import ACTION_PERMISSION_IDS, TECHNICIAN_DEFAULTS
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


def test_ticket_attachment_metadata_hides_storage_paths_and_marks_email_eligibility():
    attachment = {
        "id": "attachment-1",
        "ticket_id": "ticket-1",
        "filename": "customer-evidence.pdf",
        "stored_filename": "private-name.pdf",
        "url": "/api/uploads/ticket_attachments/private-name.pdf",
        "artifact_storage": {"provider": "supabase", "object_path": "ticket-attachments/attachment-1.pdf"},
    }

    result = ticket_attachments._attachment_response(attachment)

    assert result["id"] == "attachment-1"
    assert result["email_attachable"] is True
    assert "stored_filename" not in result
    assert "url" not in result
    assert "artifact_storage" not in result


def test_ticket_attachment_local_retention_is_outside_the_public_upload_mount():
    assert ticket_attachments.UPLOAD_DIR != ticket_attachments.LEGACY_UPLOAD_DIR
    assert ticket_attachments.UPLOAD_DIR.parent.name == "private_uploads"


def test_client_documents_local_retention_is_outside_the_public_upload_mount():
    assert client_profile.CLIENT_DOCS_DIR != client_profile.LEGACY_CLIENT_DOCS_DIR
    assert client_profile.CLIENT_DOCS_DIR.parent.name == "private_uploads"


def test_client_document_metadata_hides_storage_paths_and_uses_scoped_download_route():
    document = {
        "id": "document-1",
        "client_id": "client-1",
        "kind": "file",
        "stored_filename": "client-1__document-1.pdf",
        "url": "/api/uploads/client-documents/client-1__document-1.pdf",
        "artifact_storage": {"provider": "supabase", "object_path": "clients/client-1/documents/document-1.pdf"},
    }

    result = client_profile._client_document_response(document)

    assert result["download_url"] == "/api/clients/client-1/documents/document-1/download"
    assert "stored_filename" not in result
    assert "url" not in result
    assert "artifact_storage" not in result


def test_client_document_legacy_filename_requires_the_expected_static_prefix():
    assert client_profile._document_filename({"url": "/api/uploads/client-documents/client-1__document-1.pdf"}) == "client-1__document-1.pdf"
    assert client_profile._document_filename({"url": "/api/uploads/clients/client-1__document-1.pdf"}) is None
    assert client_profile._document_filename({"stored_filename": "../other-client.pdf"}) is None


def test_ticket_attachment_permissions_separate_upload_from_permanent_deletion():
    assert "ticket.attachment.upload" in ACTION_PERMISSION_IDS
    assert "ticket.attachment.delete" in ACTION_PERMISSION_IDS
    assert "ticket.attachment.upload" in TECHNICIAN_DEFAULTS
    assert "ticket.attachment.delete" not in TECHNICIAN_DEFAULTS


def test_ticket_attachment_audit_is_normalised_for_the_ticket_audit_view():
    entry = tickets._ticket_audit_display_entry({
        "id": "audit-1",
        "action": "ticket_attachment_added",
        "entity_name": "evidence.pdf",
        "metadata": {"source": "email_reply"},
    })

    assert entry["details"] == "Attached evidence.pdf · source: email reply"

    download = tickets._ticket_audit_display_entry({
        "id": "audit-2",
        "action": "ticket_attachment_downloaded",
        "entity_name": "evidence.pdf",
    })
    assert download["details"] == "Downloaded evidence.pdf"


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
