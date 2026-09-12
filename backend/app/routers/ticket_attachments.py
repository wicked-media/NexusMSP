from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from fastapi.responses import Response
from typing import Optional
from datetime import datetime, timezone
import uuid
import os
from app.database import db, ROOT_DIR, UPLOADS_DIR
from app.auth import get_current_user
from app.services.action_permissions import require_action
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

UPLOAD_DIR = ROOT_DIR / "private_uploads" / "ticket_attachments"
LEGACY_UPLOAD_DIR = UPLOADS_DIR / "ticket_attachments"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _attachment_response(attachment: dict) -> dict:
    """Return safe ticket attachment metadata without storage implementation details."""
    result = {key: value for key, value in attachment.items() if key not in {"_id", "url", "stored_filename", "artifact_storage"}}
    result["email_attachable"] = bool((attachment.get("artifact_storage") or {}).get("object_path"))
    return result


async def store_ticket_attachment(
    *,
    ticket: dict,
    content: bytes,
    filename: str | None,
    content_type: str | None,
    uploaded_by: str,
    uploaded_by_name: str,
    source: str = "manual_upload",
    source_message_id: str | None = None,
) -> dict:
    """Store a ticket attachment through the single approved attachment path."""
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 25MB)")
    ext = safe_upload_extension(filename, allowed=ATTACHMENT_EXTENSIONS, default="bin")
    attachment_id = str(uuid.uuid4())
    stored_filename = f"{str(ticket['id'])[:8]}_{uuid.uuid4().hex[:8]}.{ext}"
    (UPLOAD_DIR / stored_filename).write_bytes(content)

    artifact_path = await archive_record_artifact(
        "ticket-attachments", attachment_id, content, ext, content_type or "application/octet-stream"
    )
    now = datetime.now(timezone.utc).isoformat()
    attachment = {
        "id": attachment_id,
        "ticket_id": ticket["id"],
        "client_id": ticket.get("client_id") or None,
        "filename": safe_original_filename(filename),
        "stored_filename": stored_filename,
        "size": len(content),
        "content_type": content_type or "application/octet-stream",
        "uploaded_by": uploaded_by,
        "uploaded_by_name": uploaded_by_name,
        "source": source,
        "source_message_id": source_message_id,
        "created_at": now,
    }
    if artifact_path:
        attachment["artifact_storage"] = {
            "provider": "supabase",
            "object_path": artifact_path,
            "mirrored_at": now,
        }
    await db.ticket_attachments.insert_one(attachment)
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "ticket_attachment_added",
        "entity_type": "ticket_attachment",
        "entity_id": attachment_id,
        "entity_name": attachment["filename"],
        "ticket_id": ticket["id"],
        "client_id": ticket.get("client_id") or None,
        "user_id": uploaded_by,
        "user_name": uploaded_by_name,
        "metadata": {
            "size": attachment["size"],
            "content_type": attachment["content_type"],
            "source": source,
            "private_artifact": bool(artifact_path),
        },
        "created_at": now,
    })
    return _attachment_response(attachment)


@router.get("/tickets/{ticket_id}/attachments")
async def get_ticket_attachments(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Get all attachments for a ticket"""
    attachments = await db.ticket_attachments.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return [_attachment_response(attachment) for attachment in attachments]


@router.post("/tickets/{ticket_id}/attachments", dependencies=[Depends(require_action("ticket.attachment.upload"))])
async def upload_ticket_attachment(ticket_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """Upload an attachment to a ticket"""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "id": 1, "client_id": 1, "ticket_number": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    return await store_ticket_attachment(
        ticket=ticket,
        content=await file.read(),
        filename=file.filename,
        content_type=file.content_type,
        uploaded_by=current_user["id"],
        uploaded_by_name=current_user["name"],
    )


@router.get("/tickets/{ticket_id}/attachments/{attachment_id}/download")
async def download_ticket_attachment(ticket_id: str, attachment_id: str, current_user: dict = Depends(get_current_user)):
    """Serve a retained attachment only after ticket scope has been enforced."""
    attachment = await db.ticket_attachments.find_one({"id": attachment_id, "ticket_id": ticket_id}, {"_id": 0})
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    object_path = (attachment.get("artifact_storage") or {}).get("object_path")
    if object_path:
        artifact = await read_artifact(object_path)
        if not artifact:
            raise HTTPException(status_code=404, detail="Retained attachment is unavailable")
        content, content_type = artifact
    else:
        # Legacy/local-only files still use this authorised route; do not expose
        # their upload path to the browser as a bypass around ticket scope.
        stored_filename = safe_original_filename(attachment.get("stored_filename"), default="missing")
        local_path = next((path for path in (UPLOAD_DIR / stored_filename, LEGACY_UPLOAD_DIR / stored_filename) if path.is_file()), None)
        if not local_path:
            raise HTTPException(status_code=404, detail="Retained attachment is unavailable")
        content = local_path.read_bytes()
        content_type = attachment.get("content_type") or "application/octet-stream"
    filename = safe_original_filename(attachment.get("filename"), default="attachment")
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "ticket_attachment_downloaded",
        "entity_type": "ticket_attachment",
        "entity_id": attachment_id,
        "entity_name": filename,
        "ticket_id": ticket_id,
        "client_id": attachment.get("client_id"),
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name") or current_user.get("email") or current_user.get("id"),
        "metadata": {
            "filename": filename,
            "source": attachment.get("source"),
            "private_artifact": bool(object_path),
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return Response(
        content=content,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "private, no-store"},
    )


@router.delete("/tickets/{ticket_id}/attachments/{attachment_id}", dependencies=[Depends(require_action("ticket.attachment.delete"))])
async def delete_ticket_attachment(ticket_id: str, attachment_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a ticket attachment"""
    att = await db.ticket_attachments.find_one({"id": attachment_id, "ticket_id": ticket_id}, {"_id": 0})
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    artifact_path = (att.get("artifact_storage") or {}).get("object_path")
    if artifact_path:
        deleted = await delete_artifact(artifact_path)
        if not deleted:
            raise HTTPException(status_code=503, detail="Private artifact storage is unavailable; attachment was not removed")

    # The private artifact is removed first so a transient storage failure leaves
    # the local retention copy and metadata intact for a safe retry.
    stored_filename = safe_original_filename(att.get("stored_filename"), default="missing")
    for filepath in (UPLOAD_DIR / stored_filename, LEGACY_UPLOAD_DIR / stored_filename):
        if os.path.isfile(filepath):
            os.remove(filepath)

    await db.ticket_attachments.delete_one({"id": attachment_id})
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "ticket_attachment_deleted",
        "entity_type": "ticket_attachment",
        "entity_id": attachment_id,
        "entity_name": att.get("filename") or attachment_id,
        "ticket_id": ticket_id,
        "client_id": att.get("client_id"),
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name") or current_user.get("email") or current_user.get("id"),
        "metadata": {
            "filename": att.get("filename"),
            "size": att.get("size"),
            "content_type": att.get("content_type"),
            "source": att.get("source"),
            "private_artifact": bool(artifact_path),
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"message": "Attachment deleted"}
