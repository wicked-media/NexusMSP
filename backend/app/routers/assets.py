from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.services.scope_permissions import assert_client_scope, assert_record_scope, scoped_query
from app.models import *

router = APIRouter()

# ============== ALERTS ENDPOINTS ==============

@router.get("/alerts", response_model=List[Alert])
async def get_alerts(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if status:
        query["status"] = status
    if severity:
        query["severity"] = severity
    
    alerts = await db.alerts.find(
        scoped_query(current_user, query), {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    for a in alerts:
        if isinstance(a.get('created_at'), str):
            a['created_at'] = datetime.fromisoformat(a['created_at'])
    return alerts

@router.post("/alerts", response_model=Alert)
async def create_alert(alert_data: dict, current_user: dict = Depends(get_current_user)):
    device = await db.devices.find_one({"id": alert_data['device_id']}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await assert_client_scope(
        current_user,
        device.get("client_id"),
        operation="alert.create",
        mask_not_found=True,
    )
    requested_client_id = str(alert_data.get("client_id") or "").strip()
    if requested_client_id and requested_client_id != str(device.get("client_id") or ""):
        raise HTTPException(status_code=422, detail="Alert client must match the managed device")
    
    alert = Alert(
        device_id=alert_data['device_id'],
        device_name=device['name'] if device else None,
        client_id=device.get("client_id", ""),
        client_name=device['client_name'] if device else None,
        alert_type=alert_data['alert_type'],
        severity=alert_data.get('severity', 'warning'),
        message=alert_data['message']
    )
    doc = alert.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.alerts.insert_one(doc)
    await db.devices.update_one({"id": alert_data['device_id']}, {"$inc": {"alerts_count": 1}})
    return alert

@router.put("/alerts/{alert_id}")
async def update_alert(alert_id: str, alert_data: dict, current_user: dict = Depends(get_current_user)):
    await assert_record_scope(
        current_user,
        db.alerts,
        alert_id,
        operation="alert.update",
        resource_name="Alert",
    )
    alert_data.pop("client_id", None)
    alert_data.pop("device_id", None)
    result = await db.alerts.update_one({"id": alert_id}, {"$set": alert_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"message": "Alert updated"}

