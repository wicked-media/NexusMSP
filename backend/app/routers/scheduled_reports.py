from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/scheduled-reports")
async def get_scheduled_reports(current_user: dict = Depends(get_current_user)):
    reports = await db.scheduled_reports.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return reports


@router.post("/scheduled-reports")
async def create_scheduled_report(data: dict, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    report = {
        "id": f"sr-{uuid.uuid4().hex[:8]}",
        "name": data.get("name", "Untitled Report"),
        "report_type": data.get("report_type", "executive_summary"),
        "frequency": data.get("frequency", "weekly"),  # daily, weekly, monthly
        "day_of_week": data.get("day_of_week", "monday"),
        "day_of_month": data.get("day_of_month", 1),
        "time": data.get("time", "08:00"),
        "timezone": data.get("timezone", "Australia/Sydney"),
        "recipients": data.get("recipients", []),
        "client_ids": data.get("client_ids", []),  # empty = all clients
        "include_sections": data.get("include_sections", ["summary", "tickets", "devices", "sla", "billing"]),
        "format": data.get("format", "pdf"),
        "enabled": data.get("enabled", True),
        "last_sent": None,
        "send_count": 0,
        "created_by": current_user.get("name", ""),
        "created_at": now,
        "updated_at": now,
    }
    await db.scheduled_reports.insert_one(report)
    return {k: v for k, v in report.items() if k != "_id"}


@router.put("/scheduled-reports/{report_id}")
async def update_scheduled_report(report_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    sr = await db.scheduled_reports.find_one({"id": report_id})
    if not sr:
        raise HTTPException(status_code=404, detail="Scheduled report not found")
    update = {k: v for k, v in data.items() if k not in ("id", "_id", "created_at", "created_by")}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.scheduled_reports.update_one({"id": report_id}, {"$set": update})
    return {"message": "Scheduled report updated"}


@router.delete("/scheduled-reports/{report_id}")
async def delete_scheduled_report(report_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.scheduled_reports.delete_one({"id": report_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Scheduled report not found")
    return {"message": "Scheduled report deleted"}


@router.post("/scheduled-reports/{report_id}/toggle")
async def toggle_scheduled_report(report_id: str, current_user: dict = Depends(get_current_user)):
    sr = await db.scheduled_reports.find_one({"id": report_id}, {"_id": 0})
    if not sr:
        raise HTTPException(status_code=404, detail="Scheduled report not found")
    new_state = not sr.get("enabled", False)
    await db.scheduled_reports.update_one({"id": report_id}, {"$set": {"enabled": new_state}})
    return {"enabled": new_state}


@router.post("/scheduled-reports/{report_id}/send-now")
async def send_report_now(report_id: str, current_user: dict = Depends(get_current_user)):
    """Manually trigger a scheduled report to send immediately."""
    sr = await db.scheduled_reports.find_one({"id": report_id}, {"_id": 0})
    if not sr:
        raise HTTPException(status_code=404, detail="Scheduled report not found")

    now = datetime.now(timezone.utc).isoformat()
    # Log the send
    log = {
        "id": f"srl-{uuid.uuid4().hex[:8]}",
        "report_id": report_id,
        "report_name": sr.get("name", ""),
        "recipients": sr.get("recipients", []),
        "status": "sent",
        "sent_at": now,
        "triggered_by": current_user.get("name", ""),
    }
    await db.scheduled_report_logs.insert_one(log)
    await db.scheduled_reports.update_one({"id": report_id}, {"$set": {"last_sent": now}, "$inc": {"send_count": 1}})

    return {"message": f"Report sent to {len(sr.get('recipients', []))} recipients", "log_id": log["id"]}


@router.get("/scheduled-reports/{report_id}/logs")
async def get_report_logs(report_id: str, current_user: dict = Depends(get_current_user)):
    logs = await db.scheduled_report_logs.find({"report_id": report_id}, {"_id": 0}).sort("sent_at", -1).to_list(50)
    return logs


@router.get("/scheduled-reports/stats/overview")
async def get_scheduled_report_stats(current_user: dict = Depends(get_current_user)):
    all_sr = await db.scheduled_reports.find({}, {"_id": 0}).to_list(200)
    total = len(all_sr)
    active = len([s for s in all_sr if s.get("enabled")])
    total_sent = sum(s.get("send_count", 0) for s in all_sr)
    return {"total": total, "active": active, "total_sent": total_sent}
