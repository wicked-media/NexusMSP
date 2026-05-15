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
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from datetime import datetime, timezone
from typing import Optional
import uuid
from app.database import db, UPLOADS_DIR
from app.auth import get_current_user

router = APIRouter()

CLIENT_ASSETS_DIR = UPLOADS_DIR / "clients"
CLIENT_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
CLIENT_DOCS_DIR = UPLOADS_DIR / "client-documents"
CLIENT_DOCS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "gif", "svg"}
ALLOWED_DOC_EXTS = {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "md", "png", "jpg", "jpeg", "webp", "gif", "svg", "zip"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


def _safe_ext(filename: str, allow: set) -> str:
    ext = (filename or "").rsplit(".", 1)[-1].lower()
    if ext not in allow:
        raise HTTPException(status_code=400, detail=f"Invalid file type. Allowed: {', '.join(sorted(allow))}")
    return ext


async def _ensure_client(client_id: str):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.post("/clients/{client_id}/profile-picture")
async def upload_profile_picture(client_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    await _ensure_client(client_id)
    ext = _safe_ext(file.filename, ALLOWED_IMAGE_EXTS)
    filename = f"{client_id}-avatar.{ext}"
    filepath = CLIENT_ASSETS_DIR / filename
    # Clean any existing avatar of a different extension
    for old_ext in ALLOWED_IMAGE_EXTS:
        old_path = CLIENT_ASSETS_DIR / f"{client_id}-avatar.{old_ext}"
        if old_path.exists() and old_path != filepath:
            old_path.unlink()
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 20MB)")
    with open(filepath, "wb") as f:
        f.write(content)
    url = f"/api/uploads/clients/{filename}"
    await db.clients.update_one({"id": client_id}, {"$set": {"profile_picture_url": url, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"profile_picture_url": url}


@router.delete("/clients/{client_id}/profile-picture")
async def delete_profile_picture(client_id: str, current_user: dict = Depends(get_current_user)):
    await _ensure_client(client_id)
    for old_ext in ALLOWED_IMAGE_EXTS:
        old_path = CLIENT_ASSETS_DIR / f"{client_id}-avatar.{old_ext}"
        if old_path.exists():
            old_path.unlink()
    await db.clients.update_one({"id": client_id}, {"$unset": {"profile_picture_url": ""}})
    return {"message": "Profile picture removed"}


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
    url = f"/api/uploads/clients/{filename}"
    await db.clients.update_one({"id": client_id}, {"$set": {"cover_image_url": url, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"cover_image_url": url}


@router.delete("/clients/{client_id}/cover-image")
async def delete_cover_image(client_id: str, current_user: dict = Depends(get_current_user)):
    await _ensure_client(client_id)
    for old_ext in ALLOWED_IMAGE_EXTS:
        old_path = CLIENT_ASSETS_DIR / f"{client_id}-cover.{old_ext}"
        if old_path.exists():
            old_path.unlink()
    await db.clients.update_one({"id": client_id}, {"$unset": {"cover_image_url": ""}})
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
    docs = await db.client_documents.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@router.post("/clients/{client_id}/documents")
async def upload_client_document(
    client_id: str,
    file: UploadFile = File(...),
    title: str = Form(""),
    category: str = Form("general"),
    current_user: dict = Depends(get_current_user),
):
    await _ensure_client(client_id)
    ext = _safe_ext(file.filename, ALLOWED_DOC_EXTS)
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 20MB)")
    doc_id = str(uuid.uuid4())
    filename = f"{client_id}__{doc_id}.{ext}"
    filepath = CLIENT_DOCS_DIR / filename
    with open(filepath, "wb") as f:
        f.write(content)
    doc = {
        "id": doc_id,
        "client_id": client_id,
        "kind": "file",
        "title": title or file.filename,
        "original_filename": file.filename,
        "extension": ext,
        "category": category,
        "size_bytes": len(content),
        "url": f"/api/uploads/client-documents/{filename}",
        "uploaded_by": current_user.get("id"),
        "uploaded_by_name": current_user.get("name"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.client_documents.insert_one({**doc})
    return doc


@router.post("/clients/{client_id}/runbooks")
async def upsert_client_runbook(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Create or update a runbook / SOP for a client (Hudu-style rich-text doc)."""
    await _ensure_client(client_id)
    doc_id = data.get("id") or str(uuid.uuid4())
    existing = await db.client_documents.find_one({"id": doc_id, "client_id": client_id}, {"_id": 0})
    base = {
        "id": doc_id,
        "client_id": client_id,
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
        await db.client_documents.update_one({"id": doc_id}, {"$set": base})
        return {**existing, **base}
    base["created_at"] = base["updated_at"]
    base["created_by"] = current_user.get("id")
    base["created_by_name"] = current_user.get("name")
    await db.client_documents.insert_one({**base})
    return base


@router.delete("/clients/{client_id}/documents/{doc_id}")
async def delete_client_document(client_id: str, doc_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.client_documents.find_one({"id": doc_id, "client_id": client_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    # If file, remove from disk
    if doc.get("kind") == "file" and doc.get("url"):
        try:
            filename = doc["url"].rsplit("/", 1)[-1]
            filepath = CLIENT_DOCS_DIR / filename
            if filepath.exists():
                filepath.unlink()
        except Exception:
            pass
    await db.client_documents.delete_one({"id": doc_id})
    return {"message": "Document deleted"}


# ─── Notes ──────────────────────────────────────────────────────────────
@router.get("/clients/{client_id}/notes")
async def list_client_notes(client_id: str, current_user: dict = Depends(get_current_user)):
    await _ensure_client(client_id)
    notes = await db.client_notes.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return notes


@router.post("/clients/{client_id}/notes")
async def add_client_note(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await _ensure_client(client_id)
    note = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "body": data.get("body", ""),
        "pinned": bool(data.get("pinned", False)),
        "author_id": current_user.get("id"),
        "author_name": current_user.get("name"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.client_notes.insert_one({**note})
    return note


@router.delete("/clients/{client_id}/notes/{note_id}")
async def delete_client_note(client_id: str, note_id: str, current_user: dict = Depends(get_current_user)):
    res = await db.client_notes.delete_one({"id": note_id, "client_id": client_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted"}
