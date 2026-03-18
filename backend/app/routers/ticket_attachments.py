from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import Optional
from datetime import datetime, timezone
import uuid
import os
from app.database import db
from app.auth import get_current_user

router = APIRouter()

UPLOAD_DIR = "/app/backend/uploads/ticket_attachments"
os.makedirs(UPLOAD_DIR, exist_ok=True)


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

    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    filename = f"{ticket_id[:8]}_{uuid.uuid4().hex[:8]}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    attachment = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "filename": file.filename,
        "stored_filename": filename,
        "url": f"/uploads/ticket_attachments/{filename}",
        "size": len(content),
        "content_type": file.content_type or "application/octet-stream",
        "uploaded_by": current_user["id"],
        "uploaded_by_name": current_user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ticket_attachments.insert_one(attachment)
    attachment.pop("_id", None)
    return attachment


@router.delete("/tickets/{ticket_id}/attachments/{attachment_id}")
async def delete_ticket_attachment(ticket_id: str, attachment_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a ticket attachment"""
    att = await db.ticket_attachments.find_one({"id": attachment_id, "ticket_id": ticket_id}, {"_id": 0})
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    # Remove file
    filepath = os.path.join(UPLOAD_DIR, att.get("stored_filename", ""))
    if os.path.isfile(filepath):
        os.remove(filepath)

    await db.ticket_attachments.delete_one({"id": attachment_id})
    return {"message": "Attachment deleted"}
