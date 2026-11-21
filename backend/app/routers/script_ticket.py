from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user
import uuid

router = APIRouter()

@router.get("/script-ticket/scripts")
async def get_script_integrations(current_user: dict = Depends(get_current_user)):
    return await db.script_ticket_integrations.find({}, {"_id": 0}).to_list(100)

@router.post("/script-ticket/scripts")
async def create_script_integration(data: dict, current_user: dict = Depends(get_current_user)):
    script = {**data, "id": f"st-{uuid.uuid4().hex[:8]}", "created_by": current_user.get("name"), "created_at": datetime.now(timezone.utc).isoformat(), "executions": 0, "enabled": True}
    await db.script_ticket_integrations.insert_one(script)
    script.pop("_id", None)
    return script

@router.get("/script-ticket/executions")
async def get_script_executions(current_user: dict = Depends(get_current_user)):
    execs = await db.script_ticket_executions.find({}, {"_id": 0}).sort("executed_at", -1).to_list(50)
    return execs
