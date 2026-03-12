from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== RUSTDESK / REMOTE ACCESS ENDPOINTS ==============

@router.get("/remote/status")
async def get_remote_status(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "rustdesk"}, {"_id": 0})
    return {"configured": bool(settings and settings.get('server_url'))}

@router.post("/remote/settings")
async def save_remote_settings(settings: RustDeskSettings, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "rustdesk"},
        {"$set": {
            "type": "rustdesk",
            "server_url": settings.server_url,
            "api_key": settings.api_key,
            "relay_server": settings.relay_server,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    return {"message": "RustDesk settings saved"}

@router.get("/remote/settings")
async def get_remote_settings(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "rustdesk"}, {"_id": 0})
    if not settings:
        return {"configured": False}
    return {
        "configured": True,
        "server_url": settings.get('server_url'),
        "relay_server": settings.get('relay_server')
    }

@router.get("/remote/agents")
async def get_remote_agents(current_user: dict = Depends(get_current_user)):
    """Get available remote agent downloads"""
    agents = [
        {
            "id": "windows-x64",
            "name": "NexusOps Agent for Windows",
            "platform": "windows",
            "arch": "x64",
            "version": "1.3.2",
            "download_url": "https://github.com/rustdesk/rustdesk/releases/download/1.3.2/rustdesk-1.3.2-x86_64.exe",
            "size": "18.5 MB",
            "instructions": "1. Download and run the installer\n2. Enter your RustDesk ID server address\n3. Note your device ID for remote access"
        },
        {
            "id": "windows-x86",
            "name": "NexusOps Agent for Windows (32-bit)",
            "platform": "windows",
            "arch": "x86",
            "version": "1.3.2",
            "download_url": "https://github.com/rustdesk/rustdesk/releases/download/1.3.2/rustdesk-1.3.2-x86-sciter.exe",
            "size": "12.3 MB",
            "instructions": "1. Download and run the installer\n2. Enter your RustDesk ID server address\n3. Note your device ID for remote access"
        },
        {
            "id": "macos-universal",
            "name": "NexusOps Agent for macOS",
            "platform": "macos",
            "arch": "universal",
            "version": "1.3.2",
            "download_url": "https://github.com/rustdesk/rustdesk/releases/download/1.3.2/rustdesk-1.3.2.dmg",
            "size": "22.1 MB",
            "instructions": "1. Download and open the DMG file\n2. Drag RustDesk to Applications\n3. Open and configure server settings\n4. Grant accessibility permissions when prompted"
        },
        {
            "id": "linux-x64",
            "name": "NexusOps Agent for Linux (Debian/Ubuntu)",
            "platform": "linux",
            "arch": "x64",
            "version": "1.3.2",
            "download_url": "https://github.com/rustdesk/rustdesk/releases/download/1.3.2/rustdesk-1.3.2-x86_64.deb",
            "size": "15.8 MB",
            "instructions": "1. Download the .deb package\n2. Install: sudo dpkg -i rustdesk-*.deb\n3. Run: rustdesk\n4. Configure server settings"
        },
        {
            "id": "linux-rpm",
            "name": "NexusOps Agent for Linux (RHEL/Fedora)",
            "platform": "linux",
            "arch": "x64",
            "version": "1.3.2",
            "download_url": "https://github.com/rustdesk/rustdesk/releases/download/1.3.2/rustdesk-1.3.2-0.x86_64.rpm",
            "size": "16.2 MB",
            "instructions": "1. Download the .rpm package\n2. Install: sudo rpm -i rustdesk-*.rpm\n3. Run: rustdesk\n4. Configure server settings"
        }
    ]
    return agents

@router.post("/remote/sessions")
async def create_remote_session(device_id: str, session_type: str = "remote_desktop", current_user: dict = Depends(get_current_user)):
    """Create a new remote session record"""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    client = await db.clients.find_one({"id": device.get("client_id")}, {"_id": 0})
    session = RemoteSession(
        device_id=device_id,
        device_name=device.get('name'),
        client_id=device.get('client_id'),
        client_name=client.get('name') if client else None,
        user_id=current_user['id'],
        user_name=current_user['name'],
        session_type=session_type,
        rustdesk_id=device.get('rustdesk_id'),
        device_type=device.get('device_type', 'workstation'),
    )
    doc = session.model_dump()
    doc['started_at'] = doc['started_at'].isoformat()
    await db.remote_sessions.insert_one(doc)
    await log_activity(current_user, "remote_connect", "device", device_id, device.get("name", ""), f"Started {session_type} session on {device.get('name', '')}", metadata={"session_id": session.id, "device_type": device.get("device_type", "workstation")})
    
    return session

@router.get("/remote/sessions")
async def get_remote_sessions(
    device_id: Optional[str] = None,
    status: Optional[str] = None,
    user_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if device_id:
        query["device_id"] = device_id
    if status:
        query["status"] = status
    if user_id:
        query["user_id"] = user_id
    
    sessions = await db.remote_sessions.find(query, {"_id": 0}).sort("started_at", -1).to_list(200)
    return sessions

@router.get("/remote/active-sessions")
async def get_active_remote_sessions(current_user: dict = Depends(get_current_user)):
    """Get all currently active remote sessions"""
    sessions = await db.remote_sessions.find({"status": "active"}, {"_id": 0}).sort("started_at", -1).to_list(100)
    # Calculate live duration for active sessions
    now = datetime.now(timezone.utc)
    for s in sessions:
        try:
            started = datetime.fromisoformat(str(s["started_at"]).replace("Z", "+00:00"))
            s["live_duration_minutes"] = int((now - started).total_seconds() / 60)
        except:
            s["live_duration_minutes"] = 0
    return sessions

@router.put("/remote/sessions/{session_id}/end")
async def end_remote_session(session_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    session = await db.remote_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    started_at = datetime.fromisoformat(session['started_at']) if isinstance(session['started_at'], str) else session['started_at']
    duration = int((datetime.now(timezone.utc) - started_at).total_seconds() / 60)
    
    was_locked = data.get("was_locked_before_disconnect")
    lock_action = data.get("lock_action_on_disconnect", "no_change")
    notes = data.get("notes")
    
    await db.remote_sessions.update_one(
        {"id": session_id},
        {"$set": {
            "status": "ended",
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "duration_minutes": duration,
            "notes": notes,
            "was_locked_before_disconnect": was_locked,
            "lock_action_on_disconnect": lock_action,
        }}
    )
    device_name = session.get("device_name", "")
    await log_activity(current_user, "remote_disconnect", "device", session.get("device_id", ""), device_name, f"Ended {session.get('session_type', 'remote')} session on {device_name} ({duration}min). Lock: {lock_action}", metadata={"session_id": session_id, "duration_minutes": duration, "was_locked": was_locked, "lock_action": lock_action})
    return {"message": "Session ended", "duration_minutes": duration}

@router.get("/devices/{device_id}/remote-sessions")
async def get_device_remote_sessions(device_id: str, limit: int = 50, current_user: dict = Depends(get_current_user)):
    """Get remote session history for a specific device"""
    sessions = await db.remote_sessions.find({"device_id": device_id}, {"_id": 0}).sort("started_at", -1).to_list(limit)
    active_count = sum(1 for s in sessions if s.get("status") == "active")
    total_minutes = sum(s.get("duration_minutes", 0) for s in sessions if s.get("status") == "ended")
    return {
        "sessions": sessions,
        "active_count": active_count,
        "total_sessions": len(sessions),
        "total_minutes": total_minutes,
    }

@router.get("/technicians/{tech_id}/remote-sessions")
async def get_technician_remote_sessions(tech_id: str, limit: int = 100, current_user: dict = Depends(get_current_user)):
    """Get remote session history for a specific technician"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin") and current_user["id"] != tech_id):
        raise HTTPException(status_code=403, detail="Admin access required")
    sessions = await db.remote_sessions.find({"user_id": tech_id}, {"_id": 0}).sort("started_at", -1).to_list(limit)
    active_count = sum(1 for s in sessions if s.get("status") == "active")
    total_minutes = sum(s.get("duration_minutes", 0) for s in sessions if s.get("status") == "ended")
    unique_devices = len(set(s.get("device_id") for s in sessions))
    return {
        "sessions": sessions,
        "active_count": active_count,
        "total_sessions": len(sessions),
        "total_minutes": total_minutes,
        "unique_devices": unique_devices,
    }

# ============== DEVICE CHAT ENDPOINTS ==============

@router.get("/devices/{device_id}/chat")
async def get_device_chat(device_id: str, limit: int = 100, current_user: dict = Depends(get_current_user)):
    """Get chat messages for a device"""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    messages = await db.device_chat.find(
        {"device_id": device_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    
    return {"device": device, "messages": list(reversed(messages))}

@router.post("/devices/{device_id}/chat")
async def send_device_chat_message(device_id: str, message_data: DeviceChatMessageCreate, current_user: dict = Depends(get_current_user)):
    """Send a chat message to a device"""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    chat_message = DeviceChatMessage(
        device_id=device_id,
        device_name=device.get('name'),
        client_id=device.get('client_id'),
        client_name=device.get('client_name'),
        user_id=current_user['id'],
        user_name=current_user['name'],
        message=message_data.message,
        message_type=message_data.message_type,
        direction="outbound"
    )
    doc = chat_message.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.device_chat.insert_one(doc)
    
    return chat_message

@router.post("/devices/{device_id}/chat/command")
async def send_device_command(device_id: str, command: str, current_user: dict = Depends(get_current_user)):
    """Send a remote command to a device"""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    # Create command message
    chat_message = DeviceChatMessage(
        device_id=device_id,
        device_name=device.get('name'),
        client_id=device.get('client_id'),
        client_name=device.get('client_name'),
        user_id=current_user['id'],
        user_name=current_user['name'],
        message=command,
        message_type="command",
        direction="outbound",
        metadata={"command": command, "executed": False}
    )
    doc = chat_message.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.device_chat.insert_one(doc)
    
    # Simulate command execution response (in real implementation, this would be handled by the agent)
    response_message = DeviceChatMessage(
        device_id=device_id,
        device_name=device.get('name'),
        client_id=device.get('client_id'),
        client_name=device.get('client_name'),
        user_id="system",
        user_name="System",
        message=f"Command '{command}' queued for execution. Awaiting agent response.",
        message_type="system",
        direction="inbound",
        metadata={"command": command, "status": "queued"}
    )
    resp_doc = response_message.model_dump()
    resp_doc['created_at'] = resp_doc['created_at'].isoformat()
    await db.device_chat.insert_one(resp_doc)
    
    return {"message": "Command sent", "command_id": chat_message.id}

@router.post("/devices/{device_id}/chat/file")
async def send_device_file(device_id: str, filename: str, file_url: str, current_user: dict = Depends(get_current_user)):
    """Send a file to a device"""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    chat_message = DeviceChatMessage(
        device_id=device_id,
        device_name=device.get('name'),
        client_id=device.get('client_id'),
        client_name=device.get('client_name'),
        user_id=current_user['id'],
        user_name=current_user['name'],
        message=f"File sent: {filename}",
        message_type="file",
        direction="outbound",
        metadata={"filename": filename, "file_url": file_url}
    )
    doc = chat_message.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.device_chat.insert_one(doc)
    
    return chat_message

@router.delete("/devices/{device_id}/chat")
async def clear_device_chat(device_id: str, current_user: dict = Depends(get_current_user)):
    """Clear chat history for a device"""
    result = await db.device_chat.delete_many({"device_id": device_id})
    return {"message": f"Cleared {result.deleted_count} messages"}

