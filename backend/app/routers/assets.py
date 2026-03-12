from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
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
    
    alerts = await db.alerts.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    for a in alerts:
        if isinstance(a.get('created_at'), str):
            a['created_at'] = datetime.fromisoformat(a['created_at'])
    return alerts

@router.post("/alerts", response_model=Alert)
async def create_alert(alert_data: dict, current_user: dict = Depends(get_current_user)):
    device = await db.devices.find_one({"id": alert_data['device_id']}, {"_id": 0})
    
    alert = Alert(
        device_id=alert_data['device_id'],
        device_name=device['name'] if device else None,
        client_id=alert_data['client_id'],
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
    result = await db.alerts.update_one({"id": alert_id}, {"$set": alert_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"message": "Alert updated"}

