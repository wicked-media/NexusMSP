from fastapi import APIRouter, Depends, Body
from app.database import db
from app.auth import get_current_user
from app.services.scope_permissions import assert_client_scope, assert_global_scope, scoped_query
from datetime import datetime, timezone
import uuid

router = APIRouter(prefix="/client-reports", tags=["Automated Client Reports"])

@router.get("/templates")
async def get_report_templates(user=Depends(get_current_user)):
    await assert_global_scope(user, operation="client_report.templates.read")
    templates = await db.report_templates.find({}, {"_id": 0}).to_list(50)
    if not templates:
        defaults = [
            {"id": "tpl-weekly", "name": "Weekly Summary", "frequency": "weekly", "sections": ["tickets_summary", "device_health", "sla_compliance", "open_issues"], "enabled": True},
            {"id": "tpl-monthly", "name": "Monthly Executive Report", "frequency": "monthly", "sections": ["tickets_summary", "device_health", "sla_compliance", "financial_summary", "recommendations", "roadmap_progress"], "enabled": True},
            {"id": "tpl-quarterly", "name": "Quarterly Business Review", "frequency": "quarterly", "sections": ["tickets_summary", "device_health", "sla_compliance", "financial_summary", "recommendations", "roadmap_progress", "benchmarking", "csat_scores"], "enabled": False},
        ]
        for t in defaults:
            t["created_at"] = datetime.now(timezone.utc).isoformat()
            await db.report_templates.insert_one(t)
        templates = defaults
    return templates

@router.get("/generate/{client_id}")
async def generate_client_report(client_id: str, user=Depends(get_current_user)):
    await assert_client_scope(user, client_id, operation="client_report.generate", mask_not_found=True)
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        return {"error": "Client not found"}
    
    # Gather metrics
    open_tickets = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["open", "in_progress"]}})
    resolved_tickets = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["resolved", "closed"]}})
    total_tickets = await db.tickets.count_documents({"client_id": client_id})
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0, "name": 1, "status": 1, "cpu_usage": 1, "memory_usage": 1, "disk_usage": 1, "compliance_score": 1}).to_list(200)
    
    online_devices = len([d for d in devices if d.get("status") == "online"])
    avg_compliance = round(sum(d.get("compliance_score", 0) for d in devices) / max(len(devices), 1), 1)
    
    contracts = await db.contracts.find({"client_id": client_id, "status": "active"}, {"_id": 0}).to_list(10)
    total_mrr = sum(c.get("value", 0) for c in contracts)
    
    csat = await db.csat_surveys.find({"client_id": client_id}, {"_id": 0, "score": 1}).to_list(50)
    avg_csat = round(sum(c["score"] for c in csat) / len(csat), 1) if csat else 0
    
    report = {
        "id": f"rpt-{str(uuid.uuid4())[:8]}",
        "client_id": client_id,
        "client_name": client["name"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": user.get("name", "System"),
        "period": "Last 30 Days",
        "sections": {
            "tickets": {
                "total": total_tickets, "open": open_tickets, "resolved": resolved_tickets,
                "resolution_rate": round((resolved_tickets / max(total_tickets, 1)) * 100, 1),
            },
            "devices": {
                "total": len(devices), "online": online_devices, "offline": len(devices) - online_devices,
                "avg_compliance": avg_compliance,
            },
            "financial": {
                "mrr": total_mrr, "contracts": len(contracts),
            },
            "satisfaction": {
                "avg_csat": avg_csat, "responses": len(csat),
            },
        },
    }
    
    await db.generated_reports.insert_one({**report})
    return {k: v for k, v in report.items() if k != "_id"}

@router.get("/history")
async def get_report_history(user=Depends(get_current_user)):
    reports = await db.generated_reports.find(
        scoped_query(user), {"_id": 0}
    ).sort("generated_at", -1).to_list(100)
    return reports
