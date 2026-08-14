from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from fastapi.responses import Response
from typing import Optional
from datetime import datetime, timezone
import uuid
import os
from app.database import db, UPLOADS_DIR
from app.auth import get_current_user
from app.services.scope_permissions import assert_record_scope
from app.services.upload_security import ATTACHMENT_EXTENSIONS, safe_original_filename, safe_upload_extension
from app.services.supabase_storage import archive_record_artifact, delete_artifact, read_artifact


async def _enforce_ticket_scope(request: Request, current_user: dict = Depends(get_current_user)):
    ticket_id = request.path_params.get("ticket_id")
    if ticket_id:
        await assert_record_scope(
            current_user, db.tickets, ticket_id, request=request,
            operation=f"ticket_attachment:{request.method.lower()}", resource_name="Ticket",
        )


router = APIRouter(dependencies=[Depends(_enforce_ticket_scope)])

UPLOAD_DIR = UPLOADS_DIR / "ticket_attachments"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.get("/tickets/{ticket_id}/attachments")
async def get_ticket_attachments(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Get all attachments for a ticket"""
    attachments = await db.ticket_attachments.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return attachments


@router.post("/tickets/{ticket_id}/attachments")
async def upload_ticket_attachment(ticket_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """Upload an attachment to a ticket"""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "id": 1, "ticket_number": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 25MB)")

    ext = safe_upload_extension(file.filename, allowed=ATTACHMENT_EXTENSIONS, default="bin")
    filename = f"{ticket_id[:8]}_{uuid.uuid4().hex[:8]}.{ext}"
    attachment_id = str(uuid.uuid4())
    filepath = UPLOAD_DIR / filename
    with open(filepath, "wb") as f:
        f.write(content)

    artifact_path = await archive_record_artifact(
        "ticket-attachments", attachment_id, content, ext, file.content_type or "application/octet-stream"
    )

    attachment = {
        "id": attachment_id,
        "ticket_id": ticket_id,
        "filename": safe_original_filename(file.filename),
        "stored_filename": filename,
        "url": f"/api/uploads/ticket_attachments/{filename}",
        "size": len(content),
        "content_type": file.content_type or "application/octet-stream",
        "uploaded_by": current_user["id"],
        "uploaded_by_name": current_user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if artifact_path:
        attachment["artifact_storage"] = {
            "provider": "supabase",
            "object_path": artifact_path,
            "mirrored_at": datetime.now(timezone.utc).isoformat(),
        }
    await db.ticket_attachments.insert_one(attachment)
    attachment.pop("_id", None)
    return attachment


@router.get("/tickets/{ticket_id}/attachments/{attachment_id}/download")
async def download_ticket_attachment(ticket_id: str, attachment_id: str, current_user: dict = Depends(get_current_user)):
    """Serve a retained attachment only after ticket scope has been enforced."""
    attachment = await db.ticket_attachments.find_one({"id": attachment_id, "ticket_id": ticket_id}, {"_id": 0})
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    object_path = (attachment.get("artifact_storage") or {}).get("object_path")
    if not object_path:
        raise HTTPException(status_code=404, detail="Attachment has not been migrated to private storage")
    artifact = await read_artifact(object_path)
    if not artifact:
        raise HTTPException(status_code=404, detail="Retained attachment is unavailable")
    content, content_type = artifact
    filename = safe_original_filename(attachment.get("filename"), default="attachment")
    return Response(
        content=content,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "private, no-store"},
    )


@router.delete("/tickets/{ticket_id}/attachments/{attachment_id}")
async def delete_ticket_attachment(ticket_id: str, attachment_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a ticket attachment"""
    att = await db.ticket_attachments.find_one({"id": attachment_id, "ticket_id": ticket_id}, {"_id": 0})
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    # Remove file
    filepath = UPLOAD_DIR / safe_original_filename(att.get("stored_filename"), default="missing")
    if os.path.isfile(filepath):
        os.remove(filepath)

    artifact_path = (att.get("artifact_storage") or {}).get("object_path")
    if artifact_path:
        await delete_artifact(artifact_path)

    await db.ticket_attachments.delete_one({"id": attachment_id})
    return {"message": "Attachment deleted"}
