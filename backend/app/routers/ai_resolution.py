from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

@router.get("/ai-resolution/suggestions")
async def get_ai_suggestions(current_user: dict = Depends(get_current_user)):
    """AI auto-resolution: detect issues, match to runbooks, suggest/execute fixes"""
    issues = await db.ai_resolution_queue.find({}, {"_id": 0}).sort("detected_at", -1).to_list(50)
    if not issues:
        issues = await _seed_ai_issues()
    auto_resolved = len([i for i in issues if i.get("status") == "auto_resolved"])
    pending = len([i for i in issues if i.get("status") == "pending_approval"])
    return {
        "issues": issues,
        "summary": {"total": len(issues), "auto_resolved": auto_resolved, "pending_approval": pending, "manual_required": len(issues) - auto_resolved - pending,
                     "time_saved_hours": round(auto_resolved * 0.35, 1), "resolution_rate_pct": round(auto_resolved / len(issues) * 100, 1) if issues else 0}
    }

@router.post("/ai-resolution/{issue_id}/approve")
async def approve_resolution(issue_id: str, current_user: dict = Depends(get_current_user)):
    await db.ai_resolution_queue.update_one({"id": issue_id}, {"$set": {"status": "auto_resolved", "approved_by": current_user.get("name"), "resolved_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "approved"}

@router.post("/ai-resolution/{issue_id}/reject")
async def reject_resolution(issue_id: str, current_user: dict = Depends(get_current_user)):
    issue = await db.ai_resolution_queue.find_one({"id": issue_id}, {"_id": 0})
    if not issue:
        raise HTTPException(status_code=404, detail="AI resolution item not found")

    ticket_id = issue.get("escalation_ticket_id")
    ticket_number = None
    if ticket_id:
        ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "ticket_number": 1})
        ticket_number = (ticket or {}).get("ticket_number")
    else:
        now = datetime.now(timezone.utc).isoformat()
        ticket_id = f"ai-res-{uuid.uuid4().hex[:10]}"
        ticket_number = f"AI-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
        await db.tickets.insert_one({
            "id": ticket_id,
            "ticket_number": ticket_number,
            "title": f"[AI Review Required] {issue.get('issue', 'Resolution requires review')}",
            "description": f"AI recommendation was rejected and requires technician review. Matched runbook: {issue.get('runbook', 'None')}. Proposed action: {issue.get('action', 'None')}.",
            "status": "open",
            "priority": "high" if issue.get("category") in {"security", "backup", "certificate"} else "medium",
            "source": "ai_resolution",
            "client_name": issue.get("client"),
            "device_name": issue.get("device"),
            "ai_resolution_id": issue_id,
            "created_at": now,
            "updated_at": now,
        })
        await db.ai_resolution_queue.update_one({"id": issue_id}, {"$set": {"escalation_ticket_id": ticket_id}})

    await db.ai_resolution_queue.update_one({"id": issue_id}, {"$set": {"status": "manual_required", "rejected_by": current_user.get("name"), "rejected_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "rejected", "ticket_id": ticket_id, "ticket_number": ticket_number}

async def _seed_ai_issues():
    templates = [
        {"issue": "Disk space low on C: drive (92% used)", "device": "TECH-WS-001", "client": "TechStart Inc", "runbook": "Disk Cleanup Automation", "action": "Clear temp files, empty recycle bin, compress old logs", "confidence": 97, "status": "auto_resolved", "category": "disk"},
        {"issue": "Windows Update service stopped", "device": "GLOB-WS-003", "client": "Global Finance Ltd", "runbook": "Service Restart Protocol", "action": "Restart wuauserv, reset SoftwareDistribution folder", "confidence": 95, "status": "auto_resolved", "category": "service"},
        {"issue": "SSL certificate expiring in 7 days", "device": "APEX-SRV-01", "client": "Apex Hospitality", "runbook": "Certificate Renewal", "action": "Auto-renew via Let's Encrypt ACME", "confidence": 92, "status": "pending_approval", "category": "certificate"},
        {"issue": "Print spooler crash loop detected", "device": "HC-WS-REC01", "client": "HealthCare Plus", "runbook": "Spooler Recovery", "action": "Clear print queue, restart spooler, reinstall drivers", "confidence": 88, "status": "auto_resolved", "category": "service"},
        {"issue": "DNS resolution failures intermittent", "device": "NOVA-SRV-01", "client": "NovaTech Research", "runbook": "DNS Diagnostics", "action": "Flush DNS cache, verify forwarders, check connectivity", "confidence": 85, "status": "pending_approval", "category": "network"},
        {"issue": "High memory usage (94%) on database server", "device": "PACIFIC-SRV-01", "client": "Pacific Schools District", "runbook": "Memory Optimization", "action": "Restart IIS app pools, clear SQL cache, schedule memory dump analysis", "confidence": 78, "status": "manual_required", "category": "performance"},
        {"issue": "Backup job failed - VSS writer error", "device": "ATLA-SRV-01", "client": "Atlas Logistics", "runbook": "Backup Recovery", "action": "Restart VSS writers, re-register COM components", "confidence": 82, "status": "auto_resolved", "category": "backup"},
        {"issue": "User account locked out (5 failed attempts)", "device": "GLOB-WS-001", "client": "Global Finance Ltd", "runbook": "Account Lockout Response", "action": "Verify source IP, check for brute force, unlock if legitimate", "confidence": 91, "status": "pending_approval", "category": "security"},
    ]
    issues = []
    for t in templates:
        iss = {"id": f"air-{uuid.uuid4().hex[:8]}", "detected_at": (datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 48))).isoformat(), "resolved_at": (datetime.now(timezone.utc) - timedelta(hours=random.randint(0, 24))).isoformat() if t["status"] == "auto_resolved" else None, **t}
        issues.append(iss)
        await db.ai_resolution_queue.insert_one(iss)
    return [{k: v for k, v in i.items() if k != "_id"} for i in issues]
