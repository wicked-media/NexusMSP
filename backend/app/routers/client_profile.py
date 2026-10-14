"""
Client profile assets — profile picture, cover banner, documents.

Endpoints:
  POST /api/clients/{client_id}/profile-picture     — upload profile picture
  POST /api/clients/{client_id}/cover-image          — upload cover banner
  DELETE /api/clients/{client_id}/profile-picture    — remove
  DELETE /api/clients/{client_id}/cover-image        — remove
  PATCH /api/clients/{client_id}/profile             — update extended profile fields
  GET  /api/clients/{client_id}/documents            — list uploaded documents
  POST /api/clients/{client_id}/documents            — upload a document (file)
  POST /api/clients/{client_id}/runbooks             — create/update a runbook (rich text)
  DELETE /api/clients/{client_id}/documents/{doc_id} — delete a document/runbook
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Request
from fastapi.responses import Response
from datetime import datetime, timezone
from pathlib import Path
import re
import uuid
from app.database import db, ROOT_DIR, UPLOADS_DIR
from app.auth import get_current_user
from app.services.scope_permissions import assert_record_scope, platform_tenant_id, tenant_scoped_query
from app.services.upload_quarantine import (
    UploadQuarantineFailure,
    discard_upload,
    inspect_upload,
    release_upload,
)
from app.services.upload_security import (
    safe_original_filename,
    safe_upload_extension,
    upload_is_releasable,
    validate_upload_signature,
)
from app.services.supabase_storage import archive_client_artifact, delete_artifact, read_artifact


async def _enforce_client_profile_scope(request: Request, current_user: dict = Depends(get_current_user)):
    client_id = request.path_params.get("client_id")
    if client_id:
        await assert_record_scope(
            current_user, db.clients, client_id, request=request,
            operation=f"client_profile:{request.method.lower()}", resource_name="Client",
            client_field="id", site_field="site_id",
        )


router = APIRouter(dependencies=[Depends(_enforce_client_profile_scope)])

CLIENT_ASSETS_DIR = UPLOADS_DIR / "clients"
CLIENT_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
# Client documents are private evidence. They must never live under the general
# static uploads mount, even when Supabase artifact storage is not configured.
CLIENT_DOCS_DIR = ROOT_DIR / "private_uploads" / "client_documents"
CLIENT_DOCS_DIR.mkdir(parents=True, exist_ok=True)
# Existing installations may have documents in the historical public upload
# location. They remain available only through the scoped download endpoint
# until a future migration moves them into private retention.
LEGACY_CLIENT_DOCS_DIR = UPLOADS_DIR / "client-documents"

ALLOWED_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "gif"}
ALLOWED_DOC_EXTS = {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "md", "png", "jpg", "jpeg", "webp", "gif", "zip"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
_STORED_DOCUMENT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$")


def _safe_ext(filename: str, allow: set) -> str:
    try:
        return safe_upload_extension(filename, allowed=allow)
    except HTTPException as exc:
        raise HTTPException(status_code=400, detail=f"Invalid file type. Allowed: {', '.join(sorted(allow))}") from exc


def _document_filename(document: dict) -> str | None:
    """Return a locally retained filename without trusting a public URL."""
    candidate = str(document.get("stored_filename") or "").strip()
    if not candidate:
        legacy_url = str(document.get("url") or "").strip()
        legacy_prefix = "/api/uploads/client-documents/"
        if legacy_url.startswith(legacy_prefix):
            candidate = legacy_url[len(legacy_prefix):]
    return candidate if _STORED_DOCUMENT_NAME.fullmatch(candidate) else None


def _client_document_response(document: dict) -> dict:
    """Return client-document metadata without exposing storage internals."""
    response = dict(document)
    response.pop("stored_filename", None)
    response.pop("artifact_storage", None)
    response.pop("url", None)
    if response.get("kind") == "file" and response.get("id") and response.get("client_id"):
        response["download_url"] = f"/api/clients/{response['client_id']}/documents/{response['id']}/download"
    return response


def _local_document_path(document: dict) -> Path | None:
    """Locate a private or legacy local copy after the caller has scoped it."""
    filename = _document_filename(document)
    if not filename:
        return None
    for directory in (CLIENT_DOCS_DIR, LEGACY_CLIENT_DOCS_DIR):
        candidate = directory / filename
        if candidate.is_file():
            return candidate
    return None


async def _ensure_client(client_id: str):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "tenant_id": 1, "name": 1, "artifact_storage": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


async def _write_client_audit(current_user: dict, action: str, client_id: str, client_name: str, metadata: dict | None = None) -> None:
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name") or current_user.get("email") or current_user.get("id"),
        "action": action,
        "entity_type": "client",
        "entity_id": client_id,
        "entity_name": client_name,
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


async def _store_client_image(client_id: str, client: dict, file: UploadFile, image_kind: str, field_name: str, current_user: dict) -> dict:
    ext = _safe_ext(file.filename, ALLOWED_IMAGE_EXTS)
    filename = f"{client_id}-{image_kind}.{ext}"
    filepath = CLIENT_ASSETS_DIR / filename
    for old_ext in ALLOWED_IMAGE_EXTS:
        old_path = CLIENT_ASSETS_DIR / f"{client_id}-{image_kind}.{old_ext}"
        if old_path.exists() and old_path != filepath:
            old_path.unlink()
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 20MB)")
    with open(filepath, "wb") as output:
        output.write(content)
    url = f"/api/uploads/clients/{filename}"
    artifact_path = await archive_client_artifact(
        client_id, image_kind, content, ext, file.content_type or "application/octet-stream"
    )
    update = {field_name: url, "updated_at": datetime.now(timezone.utc).isoformat()}
    if artifact_path:
        update[f"artifact_storage.{image_kind}"] = {
            "provider": "supabase",
            "object_path": artifact_path,
            "content_type": file.content_type or "application/octet-stream",
            "mirrored_at": datetime.now(timezone.utc).isoformat(),
        }
    await db.clients.update_one({"id": client_id}, {"$set": update})
    await _write_client_audit(current_user, f"client_{image_kind}_updated", client_id, client.get("name") or "Client", {"field": field_name})
    return {field_name: url}


@router.post("/clients/{client_id}/profile-picture")
async def upload_profile_picture(client_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    client = await _ensure_client(client_id)
    return await _store_client_image(client_id, client, file, "avatar", "profile_picture_url", current_user)


@router.delete("/clients/{client_id}/profile-picture")
async def delete_profile_picture(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await _ensure_client(client_id)
    for old_ext in ALLOWED_IMAGE_EXTS:
        old_path = CLIENT_ASSETS_DIR / f"{client_id}-avatar.{old_ext}"
        if old_path.exists():
            old_path.unlink()
    artifact_path = (client.get("artifact_storage") or {}).get("avatar", {}).get("object_path")
    if artifact_path:
        await delete_artifact(artifact_path)
    await db.clients.update_one({"id": client_id}, {"$unset": {"profile_picture_url": "", "artifact_storage.avatar": ""}})
    await _write_client_audit(current_user, "client_avatar_removed", client_id, client.get("name") or "Client")
    return {"message": "Profile picture removed"}


@router.post("/clients/{client_id}/logo")
async def upload_client_logo(client_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """Store the client business logo separately from a contact/avatar image."""
    client = await _ensure_client(client_id)
    return await _store_client_image(client_id, client, file, "logo", "logo_url", current_user)


@router.delete("/clients/{client_id}/logo")
async def delete_client_logo(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await _ensure_client(client_id)
    for old_ext in ALLOWED_IMAGE_EXTS:
        old_path = CLIENT_ASSETS_DIR / f"{client_id}-logo.{old_ext}"
        if old_path.exists():
            old_path.unlink()
    artifact_path = (client.get("artifact_storage") or {}).get("logo", {}).get("object_path")
    if artifact_path:
        await delete_artifact(artifact_path)
    await db.clients.update_one({"id": client_id}, {"$unset": {"logo_url": "", "artifact_storage.logo": ""}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}})
    await _write_client_audit(current_user, "client_logo_removed", client_id, client.get("name") or "Client")
    return {"message": "Business logo removed"}


@router.post("/clients/{client_id}/cover-image")
async def upload_cover_image(client_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    await _ensure_client(client_id)
    ext = _safe_ext(file.filename, ALLOWED_IMAGE_EXTS)
    filename = f"{client_id}-cover.{ext}"
    filepath = CLIENT_ASSETS_DIR / filename
    for old_ext in ALLOWED_IMAGE_EXTS:
        old_path = CLIENT_ASSETS_DIR / f"{client_id}-cover.{old_ext}"
        if old_path.exists() and old_path != filepath:
            old_path.unlink()
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 20MB)")
    with open(filepath, "wb") as f:
        f.write(content)
    artifact_path = await archive_client_artifact(
        client_id, "cover", content, ext, file.content_type or "application/octet-stream"
    )
    url = f"/api/uploads/clients/{filename}"
    update = {"cover_image_url": url, "updated_at": datetime.now(timezone.utc).isoformat()}
    if artifact_path:
        update["artifact_storage.cover"] = {
            "provider": "supabase",
            "object_path": artifact_path,
            "content_type": file.content_type or "application/octet-stream",
            "mirrored_at": datetime.now(timezone.utc).isoformat(),
        }
    await db.clients.update_one({"id": client_id}, {"$set": update})
    return {"cover_image_url": url}


@router.delete("/clients/{client_id}/cover-image")
async def delete_cover_image(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await _ensure_client(client_id)
    for old_ext in ALLOWED_IMAGE_EXTS:
        old_path = CLIENT_ASSETS_DIR / f"{client_id}-cover.{old_ext}"
        if old_path.exists():
            old_path.unlink()
    artifact_path = (client.get("artifact_storage") or {}).get("cover", {}).get("object_path")
    if artifact_path:
        await delete_artifact(artifact_path)
    await db.clients.update_one({"id": client_id}, {"$unset": {"cover_image_url": "", "artifact_storage.cover": ""}})
    return {"message": "Cover image removed"}


@router.patch("/clients/{client_id}/profile")
async def update_client_profile(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update extended profile fields on a client."""
    await _ensure_client(client_id)
    allowed = {
        "website", "linkedin_url", "twitter_url", "facebook_url",
        "about", "industry_detail", "founded_year", "employee_count",
        "annual_revenue", "primary_contact_id", "billing_email",
        "support_email", "support_phone", "after_hours_phone",
        "timezone", "preferred_engineer_id", "vip", "color_tag",
        "tags", "custom_fields", "service_tier_id",
        "address", "city", "state", "postal_code", "country",
    }
    patch = {k: v for k, v in data.items() if k in allowed}
    if not patch:
        raise HTTPException(status_code=400, detail="No editable fields supplied")
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.clients.update_one({"id": client_id}, {"$set": patch})
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    return client


# ─── Documents & Runbooks ───────────────────────────────────────────────
@router.get("/clients/{client_id}/documents")
async def list_client_documents(client_id: str, current_user: dict = Depends(get_current_user)):
    await _ensure_client(client_id)
    docs = await db.client_documents.find(tenant_scoped_query(current_user, {"client_id": client_id}), {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_client_document_response(document) for document in docs]


@router.post("/clients/{client_id}/documents")
async def upload_client_document(
    client_id: str,
    file: UploadFile = File(...),
    title: str = Form(""),
    category: str = Form("general"),
    current_user: dict = Depends(get_current_user),
):
    client = await _ensure_client(client_id)
    ext = _safe_ext(file.filename, ALLOWED_DOC_EXTS)
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 20MB)")
    validate_upload_signature(content, ext)
    doc_id = str(uuid.uuid4())
    filename = f"{client_id}__{doc_id}.{ext}"
    filepath = CLIENT_DOCS_DIR / filename
    try:
        clean_upload = await inspect_upload(
            database=db,
            content=content,
            filename=file.filename,
            content_type=file.content_type,
            tenant_id=client.get("tenant_id") or current_user.get("tenant_id"),
            client_id=client_id,
            target_type="client_document",
            target_id=doc_id,
            actor_id=str(current_user.get("id") or "unknown"),
            actor_name=str(current_user.get("name") or current_user.get("email") or current_user.get("id") or "unknown"),
        )
    except UploadQuarantineFailure as exc:
        if exc.rejected:
            raise HTTPException(status_code=422, detail="Upload rejected by malware scanner") from exc
        raise HTTPException(status_code=503, detail="Upload scanning is temporarily unavailable") from exc

    doc = {
        "id": doc_id,
        "client_id": client_id,
        "tenant_id": platform_tenant_id(current_user),
        "kind": "file",
        "title": title or file.filename,
        "original_filename": file.filename,
        "extension": ext,
        "category": category,
        "size_bytes": len(content),
        "stored_filename": filename,
        "content_type": file.content_type or "application/octet-stream",
        "uploaded_by": current_user.get("id"),
        "uploaded_by_name": current_user.get("name"),
        "security_scan": clean_upload.metadata(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    artifact_path = None
    inserted = False
    try:
        filepath.write_bytes(content)
        artifact_path = await archive_client_artifact(
            client_id, f"documents-{doc_id}", content, ext, file.content_type or "application/octet-stream"
        )
        if artifact_path:
            doc["artifact_storage"] = {
                "provider": "supabase",
                "object_path": artifact_path,
                "content_type": file.content_type or "application/octet-stream",
                "mirrored_at": datetime.now(timezone.utc).isoformat(),
            }
        await db.client_documents.insert_one({**doc})
        inserted = True
        await _write_client_audit(
            current_user,
            "client_document_uploaded",
            client_id,
            client.get("name") or "Client",
            {"document_id": doc_id, "category": category, "size": len(content), "scan_status": "clean"},
        )
    except Exception:
        filepath.unlink(missing_ok=True)
        if artifact_path:
            await delete_artifact(artifact_path)
        if inserted:
            await db.client_documents.delete_one(tenant_scoped_query(current_user, {"id": doc_id, "client_id": client_id}))
        await discard_upload(db, clean_upload)
        raise
    await release_upload(db, clean_upload)
    return _client_document_response(doc)


@router.get("/clients/{client_id}/documents/{doc_id}/download")
async def download_client_document(client_id: str, doc_id: str, current_user: dict = Depends(get_current_user)):
    """Return a retained client document only after client scope has been enforced."""
    doc = await db.client_documents.find_one(tenant_scoped_query(current_user, {"id": doc_id, "client_id": client_id, "kind": "file"}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Client document not found")
    if not upload_is_releasable(doc):
        raise HTTPException(status_code=423, detail="Client document has not passed security scanning")
    object_path = (doc.get("artifact_storage") or {}).get("object_path")
    if object_path:
        artifact = await read_artifact(object_path)
        if not artifact:
            raise HTTPException(status_code=404, detail="Retained client document is unavailable")
        content, content_type = artifact
    else:
        local_path = _local_document_path(doc)
        if not local_path:
            raise HTTPException(status_code=404, detail="Retained client document is unavailable")
        if local_path.stat().st_size > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="Client document exceeds the allowed size")
        content = local_path.read_bytes()
        content_type = doc.get("content_type") or "application/octet-stream"
    filename = safe_original_filename(doc.get("original_filename") or doc.get("title"), default="client-document")
    return Response(
        content=content,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "private, no-store"},
    )


@router.post("/clients/{client_id}/runbooks")
async def upsert_client_runbook(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Create or update a runbook / SOP for a client (Hudu-style rich-text doc)."""
    await _ensure_client(client_id)
    doc_id = data.get("id") or str(uuid.uuid4())
    existing = await db.client_documents.find_one(tenant_scoped_query(current_user, {"id": doc_id, "client_id": client_id}), {"_id": 0})
    base = {
        "id": doc_id,
        "client_id": client_id,
        "tenant_id": platform_tenant_id(current_user),
        "kind": "runbook",
        "title": data.get("title", "Untitled Runbook"),
        "category": data.get("category", "runbook"),
        "body": data.get("body", ""),       # HTML or markdown
        "tags": data.get("tags", []),
        "pinned": bool(data.get("pinned", False)),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": current_user.get("id"),
        "updated_by_name": current_user.get("name"),
    }
    if existing:
        await db.client_documents.update_one(tenant_scoped_query(current_user, {"id": doc_id, "client_id": client_id}), {"$set": base})
        return {**existing, **base}
    base["created_at"] = base["updated_at"]
    base["created_by"] = current_user.get("id")
    base["created_by_name"] = current_user.get("name")
    await db.client_documents.insert_one({**base})
    return base


@router.delete("/clients/{client_id}/documents/{doc_id}")
async def delete_client_document(client_id: str, doc_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.client_documents.find_one(tenant_scoped_query(current_user, {"id": doc_id, "client_id": client_id}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    # Remove both the current private local copy and a legacy local copy. The
    # filename parser rejects paths, so record data cannot escape these roots.
    if doc.get("kind") == "file":
        filename = _document_filename(doc)
        if filename:
            for directory in (CLIENT_DOCS_DIR, LEGACY_CLIENT_DOCS_DIR):
                filepath = directory / filename
                if filepath.is_file():
                    filepath.unlink()
    artifact_path = (doc.get("artifact_storage") or {}).get("object_path")
    if artifact_path:
        await delete_artifact(artifact_path)
    await db.client_documents.delete_one(tenant_scoped_query(current_user, {"id": doc_id, "client_id": client_id}))
    return {"message": "Document deleted"}


# ─── Notes ──────────────────────────────────────────────────────────────
@router.get("/clients/{client_id}/notes")
async def list_client_notes(client_id: str, current_user: dict = Depends(get_current_user)):
    await _ensure_client(client_id)
    notes = await db.client_notes.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return notes


@router.post("/clients/{client_id}/notes")
async def add_client_note(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    client = await _ensure_client(client_id)
    body = str(data.get("body") or "").strip()
    title = str(data.get("title") or "").strip()
    if len(body) < 4:
        raise HTTPException(status_code=400, detail="Account alert details must contain at least 4 characters")
    if len(title) > 120:
        raise HTTPException(status_code=400, detail="Account alert headline cannot exceed 120 characters")
    note = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "title": title,
        "body": body,
        "pinned": bool(data.get("pinned", False)),
        "show_on_open": bool(data.get("show_on_open", data.get("pinned", False))),
        "alert_level": data.get("alert_level") if data.get("alert_level") in {"critical", "warning", "info"} else "info",
        "expires_at": data.get("expires_at") or None,
        "author_id": current_user.get("id"),
        "author_name": current_user.get("name"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "acknowledgements": [],
    }
    await db.client_notes.insert_one({**note})
    await _write_client_audit(current_user, "client_account_alert_created", client_id, client.get("name") or "Client", {"note_id": note["id"], "alert_level": note["alert_level"], "title": title})
    return note


@router.delete("/clients/{client_id}/notes/{note_id}")
async def delete_client_note(client_id: str, note_id: str, current_user: dict = Depends(get_current_user)):
    client = await _ensure_client(client_id)
    note = await db.client_notes.find_one({"id": note_id, "client_id": client_id}, {"_id": 0})
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    res = await db.client_notes.delete_one({"id": note_id, "client_id": client_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    await _write_client_audit(current_user, "client_account_alert_deleted", client_id, client.get("name") or "Client", {"note_id": note_id, "alert_level": note.get("alert_level"), "title": note.get("title") or note.get("body", "")[:100]})
    return {"message": "Note deleted"}


@router.put("/clients/{client_id}/notes/{note_id}")
async def update_client_note(client_id: str, note_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    client = await _ensure_client(client_id)
    allowed = {"title", "body", "pinned", "show_on_open", "alert_level", "expires_at"}
    update = {key: value for key, value in data.items() if key in allowed}
    if "body" in update:
        update["body"] = str(update["body"] or "").strip()
        if len(update["body"]) < 4:
            raise HTTPException(status_code=400, detail="Account alert details must contain at least 4 characters")
    if "title" in update:
        update["title"] = str(update["title"] or "").strip()
        if len(update["title"]) > 120:
            raise HTTPException(status_code=400, detail="Account alert headline cannot exceed 120 characters")
    if "alert_level" in update and update["alert_level"] not in {"critical", "warning", "info"}:
        raise HTTPException(status_code=400, detail="Invalid account alert level")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    update["updated_by"] = current_user.get("name", "")
    result = await db.client_notes.update_one({"id": note_id, "client_id": client_id}, {"$set": update})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Note not found")
    note = await db.client_notes.find_one({"id": note_id, "client_id": client_id}, {"_id": 0})
    await _write_client_audit(current_user, "client_account_alert_updated", client_id, client.get("name") or "Client", {"note_id": note_id, "alert_level": note.get("alert_level"), "title": note.get("title") or note.get("body", "")[:100]})
    return note


@router.post("/clients/{client_id}/notes/{note_id}/acknowledge")
async def acknowledge_client_alert(client_id: str, note_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await _ensure_client(client_id)
    note = await db.client_notes.find_one({"id": note_id, "client_id": client_id}, {"_id": 0})
    if not note:
        raise HTTPException(status_code=404, detail="Account alert not found")
    acknowledgement = {
        "id": str(uuid.uuid4()), "user_id": current_user.get("id", ""), "user_name": current_user.get("name", ""),
        "acknowledged_at": datetime.now(timezone.utc).isoformat(), "context": data.get("context", "client_workspace"),
    }
    result = await db.client_notes.update_one(
        {"id": note_id, "client_id": client_id, "acknowledgements.user_id": {"$ne": acknowledgement["user_id"]}},
        {"$push": {"acknowledgements": acknowledgement}},
    )
    if not result.modified_count:
        return {"message": "Acknowledgement was already recorded", "acknowledgement": None}
    await db.activity_logs.insert_one({
        "id": str(uuid.uuid4()), "user_id": current_user.get("id", ""), "user_name": current_user.get("name", ""),
        "action": "client_alert_acknowledged", "entity_type": "client", "entity_id": client_id,
        "entity_name": note.get("body", "Account alert")[:100], "details": "Technician acknowledged a critical account alert.",
        "created_at": acknowledgement["acknowledged_at"],
    })
    return {"message": "Acknowledgement recorded", "acknowledgement": acknowledgement}
