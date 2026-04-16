from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/device-terminal/sessions")
async def get_terminal_sessions(current_user: dict = Depends(get_current_user)):
    sessions = await db.terminal_sessions.find({}, {"_id": 0}).sort("started_at", -1).to_list(50)
    return sessions


@router.post("/device-terminal/sessions")
async def create_terminal_session(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a new terminal session for a device."""
    device_id = data.get("device_id")
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id required")

    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    if device.get("status") == "offline":
        raise HTTPException(status_code=400, detail="Device is offline")

    now = datetime.now(timezone.utc).isoformat()
    session = {
        "id": f"term-{uuid.uuid4().hex[:8]}",
        "device_id": device_id,
        "device_name": device.get("name", "Unknown"),
        "client_name": device.get("client_name", ""),
        "session_type": data.get("session_type", "powershell"),  # powershell, bash, cmd
        "status": "active",
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name", ""),
        "started_at": now,
        "ended_at": None,
        "commands": [],
        "ip_address": device.get("ip_address", ""),
        "os": device.get("os", ""),
    }
    await db.terminal_sessions.insert_one(session)
    return {k: v for k, v in session.items() if k != "_id"}


@router.post("/device-terminal/sessions/{session_id}/execute")
async def execute_command(session_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Execute a command in a terminal session (simulated - would integrate with agent in production)."""
    session = await db.terminal_sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    command = data.get("command", "").strip()
    if not command:
        raise HTTPException(status_code=400, detail="Command required")

    now = datetime.now(timezone.utc).isoformat()

    # Simulate command output (in production, this would route through the agent)
    simulated_outputs = {
        "whoami": f"{session.get('device_name', 'device')}\\admin",
        "hostname": session.get("device_name", "Unknown"),
        "ipconfig": f"IPv4 Address: {session.get('ip_address', '192.168.1.1')}\nSubnet Mask: 255.255.255.0\nDefault Gateway: 192.168.1.1",
        "systeminfo": f"Host Name: {session.get('device_name')}\nOS: {session.get('os', 'Windows')}\nSystem Type: x64-based PC",
        "dir": "Volume in drive C has no label.\n Directory of C:\\\n\n04/16/2026  10:00 AM    <DIR>          Program Files\n04/16/2026  10:00 AM    <DIR>          Users\n04/16/2026  10:00 AM    <DIR>          Windows",
        "ls": "total 12\ndrwxr-xr-x  2 root root 4096 Apr 16 10:00 bin\ndrwxr-xr-x  3 root root 4096 Apr 16 10:00 etc\ndrwxr-xr-x  2 root root 4096 Apr 16 10:00 home",
        "pwd": "/home/admin",
        "uname -a": f"Linux {session.get('device_name', 'server')} 6.5.0-14-generic #14-Ubuntu SMP PREEMPT_DYNAMIC x86_64 GNU/Linux",
        "Get-Process": "Handles  NPM(K)    PM(K)    WS(K)   CPU(s)     Id  SI ProcessName\n-------  ------    -----    -----   ------     --  -- -----------\n    354      22    12456    18920    1.23  1234   1 explorer\n    128      10     5432     8760    0.45  5678   0 svchost",
        "Get-Service": "Status   Name               DisplayName\n------   ----               -----------\nRunning  WinRM              Windows Remote Management\nRunning  Spooler            Print Spooler\nStopped  BITS               Background Intelligent Transfer",
    }

    # Match command (case-insensitive, partial match)
    output = None
    cmd_lower = command.lower().strip()
    for k, v in simulated_outputs.items():
        if cmd_lower == k.lower() or cmd_lower.startswith(k.lower().split()[0]):
            output = v
            break
    if output is None:
        output = f"Command executed: {command}\n[Output would be returned from device agent in production]"

    cmd_entry = {
        "command": command,
        "output": output,
        "exit_code": 0,
        "timestamp": now,
    }

    await db.terminal_sessions.update_one(
        {"id": session_id},
        {"$push": {"commands": cmd_entry}}
    )

    return {"output": output, "exit_code": 0, "timestamp": now}


@router.post("/device-terminal/sessions/{session_id}/end")
async def end_terminal_session(session_id: str, current_user: dict = Depends(get_current_user)):
    session = await db.terminal_sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.terminal_sessions.update_one({"id": session_id}, {"$set": {"status": "ended", "ended_at": datetime.now(timezone.utc).isoformat()}})
    return {"message": "Session ended"}
