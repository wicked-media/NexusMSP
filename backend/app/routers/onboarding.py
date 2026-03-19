from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.post("/onboarding/start")
async def start_onboarding(data: dict, current_user: dict = Depends(get_current_user)):
    """Start a new client onboarding wizard session."""
    onboarding_id = str(uuid.uuid4())[:8]
    doc = {
        "id": onboarding_id,
        "status": "in_progress",
        "current_step": 1,
        "total_steps": 6,
        "steps": {
            "1_client": {"status": "pending", "data": {}},
            "2_contacts": {"status": "pending", "data": {}},
            "3_devices": {"status": "pending", "data": {}},
            "4_contracts": {"status": "pending", "data": {}},
            "5_monitoring": {"status": "pending", "data": {}},
            "6_services": {"status": "pending", "data": {}},
        },
        "client_id": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", ""),
    }
    await db.onboarding_sessions.insert_one(doc)
    # Return without _id (MongoDB adds it in-place)
    doc.pop("_id", None)
    return doc


@router.get("/onboarding/sessions")
async def get_onboarding_sessions(current_user: dict = Depends(get_current_user)):
    """Get all onboarding sessions."""
    sessions = await db.onboarding_sessions.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return sessions


@router.get("/onboarding/{session_id}")
async def get_onboarding(session_id: str, current_user: dict = Depends(get_current_user)):
    """Get a specific onboarding session."""
    s = await db.onboarding_sessions.find_one({"id": session_id}, {"_id": 0})
    if not s:
        return {"error": "Session not found"}
    return s


@router.put("/onboarding/{session_id}/step/{step_num}")
async def complete_step(session_id: str, step_num: int, data: dict, current_user: dict = Depends(get_current_user)):
    """Complete a step in the onboarding wizard."""
    session = await db.onboarding_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        return {"error": "Session not found"}

    step_key = f"{step_num}_{'client' if step_num == 1 else 'contacts' if step_num == 2 else 'devices' if step_num == 3 else 'contracts' if step_num == 4 else 'monitoring' if step_num == 5 else 'services'}"
    step_data = data.get("step_data", {})

    updates = {
        f"steps.{step_key}.status": "completed",
        f"steps.{step_key}.data": step_data,
        f"steps.{step_key}.completed_at": datetime.now(timezone.utc).isoformat(),
        "current_step": step_num + 1 if step_num < 6 else 6,
    }

    # Step 1: Create client
    if step_num == 1:
        client_id = str(uuid.uuid4())[:8]
        client = {
            "id": client_id,
            "name": step_data.get("name", ""),
            "email": step_data.get("email", ""),
            "phone": step_data.get("phone", ""),
            "company": step_data.get("company", ""),
            "address": step_data.get("address", ""),
            "industry": step_data.get("industry", ""),
            "tier": step_data.get("tier", "standard"),
            "status": "active",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "onboarded": True,
            "onboarding_id": session_id,
        }
        await db.clients.insert_one(client)
        updates["client_id"] = client_id

    # Step 2: Create contacts
    elif step_num == 2:
        client_id = session.get("client_id")
        contacts = step_data.get("contacts", [])
        for c in contacts:
            contact = {
                "id": str(uuid.uuid4())[:8],
                "client_id": client_id,
                "name": c.get("name", ""),
                "email": c.get("email", ""),
                "phone": c.get("phone", ""),
                "role": c.get("role", "primary"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.client_contacts.insert_one(contact)

    # Step 3: Register devices
    elif step_num == 3:
        client_id = session.get("client_id")
        client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
        devices = step_data.get("devices", [])
        for d in devices:
            device = {
                "id": str(uuid.uuid4())[:8],
                "hostname": d.get("hostname", ""),
                "device_type": d.get("type", "workstation"),
                "os": d.get("os", ""),
                "ip_address": d.get("ip", ""),
                "client_id": client_id,
                "client_name": (client or {}).get("name", ""),
                "status": "online",
                "monitoring_enabled": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.devices.insert_one(device)

    # Step 4: Create contract
    elif step_num == 4:
        client_id = session.get("client_id")
        if step_data.get("create_contract"):
            contract = {
                "id": str(uuid.uuid4())[:8],
                "client_id": client_id,
                "name": step_data.get("contract_name", "Service Agreement"),
                "type": step_data.get("contract_type", "managed"),
                "value": step_data.get("monthly_value", 0),
                "billing_cycle": step_data.get("billing_cycle", "monthly"),
                "start_date": step_data.get("start_date", datetime.now(timezone.utc).date().isoformat()),
                "status": "active",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.contracts.insert_one(contract)

    # Step 6: Final - mark complete
    if step_num == 6:
        updates["status"] = "completed"
        updates["completed_at"] = datetime.now(timezone.utc).isoformat()

    await db.onboarding_sessions.update_one({"id": session_id}, {"$set": updates})

    updated = await db.onboarding_sessions.find_one({"id": session_id}, {"_id": 0})
    return updated


@router.delete("/onboarding/{session_id}")
async def delete_onboarding(session_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an onboarding session."""
    await db.onboarding_sessions.delete_one({"id": session_id})
    return {"message": "Session deleted"}
