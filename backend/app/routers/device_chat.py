from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import Optional
from datetime import datetime, timezone
import uuid
import os
from app.database import db
from app.auth import get_current_user

router = APIRouter()

UPLOAD_DIR = "/app/backend/uploads/chat_attachments"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# In-memory typing status: { device_id: { user_id: { user_name, typing, last_update } } }
_typing_status = {}


@router.get("/devices/{device_id}/chat")
async def get_device_chat(device_id: str, limit: int = 100, current_user: dict = Depends(get_current_user)):
    """Get chat messages for a device"""
    messages = await db.device_chat.find(
        {"device_id": device_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    messages.reverse()
    return messages


@router.post("/devices/{device_id}/chat")
async def send_device_chat(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Send a chat message for a device"""
    msg = {
        "id": str(uuid.uuid4()),
        "device_id": device_id,
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "user_role": current_user.get("role", "tech"),
        "content": data.get("content", ""),
        "message_type": data.get("message_type", "text"),
        "attachments": data.get("attachments", []),
        "reply_to": data.get("reply_to"),
        "read_by": [current_user["id"]],
        "delivered": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "edited": False,
    }
    await db.device_chat.insert_one(msg)
    msg.pop("_id", None)

    # Clear typing for sender
    if device_id in _typing_status and current_user["id"] in _typing_status[device_id]:
        del _typing_status[device_id][current_user["id"]]

    return msg


@router.put("/devices/{device_id}/chat/{message_id}")
async def edit_chat_message(device_id: str, message_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Edit a chat message"""
    msg = await db.device_chat.find_one({"id": message_id, "device_id": device_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Can only edit your own messages")

    await db.device_chat.update_one(
        {"id": message_id},
        {"$set": {"content": data.get("content", msg["content"]), "edited": True, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Message edited"}


@router.delete("/devices/{device_id}/chat/{message_id}")
async def delete_chat_message(device_id: str, message_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a chat message"""
    result = await db.device_chat.delete_one({"id": message_id, "device_id": device_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"message": "Message deleted"}


@router.post("/devices/{device_id}/chat/mark-read")
async def mark_messages_read(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Mark messages as read by current user"""
    message_ids = data.get("message_ids", [])
    if message_ids:
        await db.device_chat.update_many(
            {"id": {"$in": message_ids}, "device_id": device_id},
            {"$addToSet": {"read_by": current_user["id"]}}
        )
    else:
        # Mark all unread
        await db.device_chat.update_many(
            {"device_id": device_id, "read_by": {"$ne": current_user["id"]}},
            {"$addToSet": {"read_by": current_user["id"]}}
        )
    return {"message": "Messages marked as read"}


@router.post("/devices/{device_id}/chat/typing")
async def set_typing_status(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Set typing status for a device chat"""
    is_typing = data.get("typing", False)
    if device_id not in _typing_status:
        _typing_status[device_id] = {}
    if is_typing:
        _typing_status[device_id][current_user["id"]] = {
            "user_id": current_user["id"],
            "user_name": current_user["name"],
            "typing": True,
            "last_update": datetime.now(timezone.utc).isoformat(),
        }
    else:
        _typing_status[device_id].pop(current_user["id"], None)
    return {"typing_users": list(_typing_status.get(device_id, {}).values())}


@router.get("/devices/{device_id}/chat/typing")
async def get_typing_status(device_id: str, current_user: dict = Depends(get_current_user)):
    """Get who is currently typing in a device chat"""
    users = list(_typing_status.get(device_id, {}).values())
    # Filter out stale typing (older than 10 seconds)
    now = datetime.now(timezone.utc)
    active = []
    for u in users:
        try:
            last = datetime.fromisoformat(u["last_update"])
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if (now - last).total_seconds() < 10:
                active.append(u)
        except:
            pass
    return {"typing_users": active}


@router.get("/devices/{device_id}/chat/unread-count")
async def get_unread_count(device_id: str, current_user: dict = Depends(get_current_user)):
    """Get unread message count for a device chat"""
    count = await db.device_chat.count_documents({
        "device_id": device_id,
        "read_by": {"$ne": current_user["id"]},
        "user_id": {"$ne": current_user["id"]},
    })
    return {"unread_count": count}


@router.post("/devices/{device_id}/chat/upload")
async def upload_chat_attachment(device_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """Upload a file attachment for device chat"""
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    filename = f"{device_id}_{uuid.uuid4().hex[:8]}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    return {
        "url": f"/uploads/chat_attachments/{filename}",
        "filename": file.filename,
        "size": len(content),
        "content_type": file.content_type or "application/octet-stream",
    }


@router.get("/devices/{device_id}/chat/export-pdf")
async def export_chat_pdf(device_id: str, current_user: dict = Depends(get_current_user)):
    """Export device chat as PDF"""
    from fpdf import FPDF

    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    messages = await db.device_chat.find({"device_id": device_id}, {"_id": 0}).sort("created_at", 1).to_list(500)

    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0})
    company_name = (branding or {}).get("company_name", "NexusOps")
    hex_c = (branding or {}).get("primary_color", "#3B82F6").lstrip("#")
    pc = (59, 130, 246)
    if len(hex_c) == 6:
        pc = tuple(int(hex_c[i:i+2], 16) for i in (0, 2, 4))

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # Header
    pdf.set_fill_color(*pc)
    pdf.rect(0, 0, 210, 25, 'F')
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_xy(10, 5)
    cn = company_name.encode('latin-1', 'ignore').decode('latin-1')
    pdf.cell(100, 12, cn)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_xy(110, 8)
    dn = (device.get("name", "Device") or "").encode('latin-1', 'ignore').decode('latin-1')
    pdf.cell(90, 6, f"Chat Log: {dn}", align="R")

    pdf.set_y(30)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 5, f"Exported on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} | {len(messages)} messages", ln=True)
    pdf.ln(3)

    for msg in messages:
        name = (msg.get("user_name", "Unknown") or "").encode('latin-1', 'ignore').decode('latin-1')
        content = (msg.get("content", "") or "").encode('latin-1', 'ignore').decode('latin-1')[:500]
        ts = str(msg.get("created_at", ""))[:19].replace("T", " ")
        role = msg.get("user_role", "tech")

        if role == "client":
            pdf.set_fill_color(240, 245, 255)
        else:
            pdf.set_fill_color(245, 250, 245)

        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*pc)
        pdf.cell(100, 5, name, ln=False)
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(150, 150, 150)
        pdf.cell(90, 5, ts, align="R")
        pdf.ln()
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(50, 50, 50)
        pdf.multi_cell(0, 5, content)
        pdf.ln(2)
        pdf.set_draw_color(230, 230, 230)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(2)

    # Footer
    pdf.set_y(-20)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(150, 150, 150)
    pdf.cell(0, 4, f"Confidential - {cn} Device Chat Export", ln=True, align="C")

    from fastapi.responses import Response
    return Response(
        content=bytes(pdf.output()),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="chat_{device.get("name","device")}.pdf"'}
    )
