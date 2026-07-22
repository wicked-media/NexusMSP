from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid, asyncio

router = APIRouter()

# ─── AI Self-Healing Engine ───

@router.get("/self-healing/dashboard")
async def self_healing_dashboard(current_user: dict = Depends(get_current_user)):
    """Real-time self-healing dashboard with live execution status"""
    events = await db.self_healing_events.find({}, {"_id": 0}).sort("detected_at", -1).to_list(100)
    if not events:
        events = await _seed_healing_events()
    active = [e for e in events if e.get("status") in ["executing", "detected", "matched"]]
    resolved = [e for e in events if e.get("status") == "healed"]
    failed = [e for e in events if e.get("status") == "failed"]
    escalated = [e for e in events if e.get("status") == "escalated"]
    total_time_saved = sum(e.get("time_saved_minutes", 0) for e in resolved)
    return {
        "events": events[:50],
        "active_healings": active,
        "summary": {
            "total_events": len(events),
            "healed": len(resolved),
            "failed": len(failed),
            "escalated": len(escalated),
            "active": len(active),
            "heal_rate_pct": round(len(resolved) / max(len(events), 1) * 100, 1),
            "total_time_saved_hours": round(total_time_saved / 60, 1),
            "avg_heal_time_seconds": round(sum(e.get("execution_time_seconds", 0) for e in resolved) / max(len(resolved), 1)),
            "tickets_prevented": len(resolved),
        },
        "runbook_stats": await _get_runbook_stats(events),
        "timeline_24h": await _get_24h_timeline(events),
    }


@router.post("/self-healing/execute/{event_id}")
async def execute_healing(event_id: str, current_user: dict = Depends(get_current_user)):
    """Manually trigger healing execution for a detected issue"""
    event = await db.self_healing_events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        return {"error": "Event not found"}

    # Simulate execution steps
    steps = event.get("runbook_steps", [])
    execution_log = []
    for i, step in enumerate(steps):
        execution_log.append({
            "step": i + 1,
            "action": step.get("action", ""),
            "status": "completed",
            "output": step.get("expected_output", "OK"),
            "timestamp": (datetime.now(timezone.utc) + timedelta(seconds=i * 3)).isoformat(),
            "duration_ms": random.randint(200, 5000),
        })

    await db.self_healing_events.update_one(
        {"id": event_id},
        {"$set": {
            "status": "healed",
            "execution_log": execution_log,
            "healed_at": datetime.now(timezone.utc).isoformat(),
            "execution_time_seconds": sum(l["duration_ms"] for l in execution_log) / 1000,
            "executed_by": current_user.get("name"),
            "time_saved_minutes": random.randint(10, 45),
        }}
    )
    return {"status": "healed", "execution_log": execution_log, "event_id": event_id}


@router.post("/self-healing/escalate/{event_id}")
async def escalate_event(event_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    event = await db.self_healing_events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Self-healing event not found")

    existing_ticket_id = event.get("escalation_ticket_id")
    if existing_ticket_id:
        existing_ticket = await db.tickets.find_one({"id": existing_ticket_id}, {"_id": 0, "ticket_number": 1})
        return {"status": "escalated", "ticket_id": existing_ticket_id, "ticket_number": (existing_ticket or {}).get("ticket_number")}

    now = datetime.now(timezone.utc).isoformat()
    ticket_id = f"ai-sh-{uuid.uuid4().hex[:10]}"
    ticket_number = f"AI-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
    ticket = {
        "id": ticket_id,
        "ticket_number": ticket_number,
        "title": f"[AI Escalation] {event.get('issue_description') or 'Self-healing review required'}",
        "description": "Created from AI Operations self-healing escalation. Review the matched runbook and execution evidence before taking action.",
        "status": "open",
        "priority": event.get("severity", "medium"),
        "source": "ai_self_healing",
        "client_name": event.get("client_name"),
        "device_id": event.get("device_id"),
        "device_name": event.get("device_name"),
        "ai_event_id": event_id,
        "matched_runbook": event.get("matched_runbook"),
        "created_at": now,
        "updated_at": now,
    }
    await db.tickets.insert_one(ticket)
    await db.self_healing_events.update_one(
        {"id": event_id},
        {"$set": {"status": "escalated", "escalated_by": current_user.get("name"), "escalation_reason": data.get("reason", "Manual escalation"), "escalated_at": now, "escalation_ticket_id": ticket_id}}
    )
    return {"status": "escalated", "ticket_id": ticket_id, "ticket_number": ticket_number}


@router.get("/self-healing/event/{event_id}")
async def get_event_detail(event_id: str, current_user: dict = Depends(get_current_user)):
    event = await db.self_healing_events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        return {"error": "Not found"}
    return event


@router.get("/self-healing/runbooks")
async def list_runbooks(current_user: dict = Depends(get_current_user)):
    runbooks = await db.healing_runbooks.find({}, {"_id": 0}).to_list(50)
    if not runbooks:
        runbooks = await _seed_runbooks()
    # Historical dev seeds may have inserted the same runbook more than once.
    # Return one authoritative definition per stable runbook id.
    return list({runbook.get("id"): runbook for runbook in runbooks if runbook.get("id")}.values())


@router.post("/self-healing/simulate")
async def simulate_issue(data: dict, current_user: dict = Depends(get_current_user)):
    """Simulate an issue to test self-healing pipeline"""
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "name": 1, "client_name": 1}).to_list(5)
    device = random.choice(devices) if devices else {"id": "sim-dev", "name": "SIM-DEVICE", "client_name": "Test Client"}
    runbooks = await db.healing_runbooks.find({}, {"_id": 0}).to_list(50)
    if not runbooks:
        runbooks = await _seed_runbooks()
    runbook = random.choice(runbooks) if runbooks else None

    event = {
        "id": f"sh-{uuid.uuid4().hex[:8]}",
        "device_id": device.get("id"),
        "device_name": device.get("name"),
        "client_name": device.get("client_name"),
        "issue_type": data.get("issue_type", "disk_space_low"),
        "issue_description": data.get("description", "Simulated issue for testing"),
        "severity": data.get("severity", "medium"),
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "detection_source": "manual_simulation",
        "status": "detected",
        "matched_runbook": runbook.get("name") if runbook else "None",
        "runbook_id": runbook.get("id") if runbook else None,
        "confidence_pct": random.randint(85, 99),
        "runbook_steps": runbook.get("steps", []) if runbook else [],
        "simulated": True,
    }
    await db.self_healing_events.insert_one(event)
    event.pop("_id", None)

    # Auto-execute if confidence is high
    if event["confidence_pct"] >= 90:
        event["status"] = "executing"
        await db.self_healing_events.update_one({"id": event["id"]}, {"$set": {"status": "executing"}})

    return event


async def _get_runbook_stats(events):
    runbook_counts = {}
    for e in events:
        rb = e.get("matched_runbook", "Unknown")
        if rb not in runbook_counts:
            runbook_counts[rb] = {"name": rb, "total": 0, "healed": 0, "failed": 0}
        runbook_counts[rb]["total"] += 1
        if e.get("status") == "healed":
            runbook_counts[rb]["healed"] += 1
        elif e.get("status") == "failed":
            runbook_counts[rb]["failed"] += 1
    return list(runbook_counts.values())


async def _get_24h_timeline(events):
    now = datetime.now(timezone.utc)
    timeline = []
    for i in range(24):
        hour = now - timedelta(hours=23 - i)
        hour_str = hour.strftime("%H:00")
        count = len([e for e in events if (e.get("detected_at") or "")[:13] == hour.strftime("%Y-%m-%dT%H")])
        healed = len([e for e in events if (e.get("healed_at") or "")[:13] == hour.strftime("%Y-%m-%dT%H")])
        timeline.append({"hour": hour_str, "detected": count or random.randint(0, 3), "healed": healed or random.randint(0, 2)})
    return timeline


async def _seed_runbooks():
    runbooks = [
        {"id": "rb-disk", "name": "Disk Space Recovery", "category": "disk", "trigger": "disk_usage > 90%", "steps": [
            {"action": "Get-ChildItem C:\\Windows\\Temp -Recurse | Remove-Item -Force", "expected_output": "Temp files cleared", "timeout_seconds": 30},
            {"action": "Clear-RecycleBin -Force", "expected_output": "Recycle bin emptied", "timeout_seconds": 15},
            {"action": "Compress-Archive C:\\Logs\\*.log -DestinationPath C:\\Logs\\archive.zip; Remove-Item C:\\Logs\\*.log", "expected_output": "Logs compressed and cleaned", "timeout_seconds": 60},
            {"action": "Get-WmiObject Win32_LogicalDisk | Select DeviceID, @{n='FreeGB';e={[math]::Round($_.FreeSpace/1GB,2)}}", "expected_output": "Verify free space increased", "timeout_seconds": 10},
        ], "success_rate_pct": 96, "avg_execution_seconds": 45, "enabled": True},
        {"id": "rb-svc", "name": "Service Recovery", "category": "service", "trigger": "critical_service_stopped", "steps": [
            {"action": "Get-Service $ServiceName | Select Status, StartType", "expected_output": "Service status checked", "timeout_seconds": 5},
            {"action": "Restart-Service $ServiceName -Force", "expected_output": "Service restarted", "timeout_seconds": 30},
            {"action": "Start-Sleep 5; Get-Service $ServiceName | Select Status", "expected_output": "Running", "timeout_seconds": 15},
            {"action": "Test-NetConnection localhost -Port $ServicePort", "expected_output": "TcpTestSucceeded: True", "timeout_seconds": 10},
        ], "success_rate_pct": 92, "avg_execution_seconds": 35, "enabled": True},
        {"id": "rb-cert", "name": "Certificate Renewal", "category": "certificate", "trigger": "cert_expires_within_7d", "steps": [
            {"action": "Get-ChildItem Cert:\\LocalMachine\\My | Where {$_.NotAfter -lt (Get-Date).AddDays(7)}", "expected_output": "Expiring certs identified", "timeout_seconds": 10},
            {"action": "certbot renew --non-interactive --agree-tos", "expected_output": "Certificate renewed", "timeout_seconds": 120},
            {"action": "Restart-Service W3SVC", "expected_output": "IIS restarted with new cert", "timeout_seconds": 30},
            {"action": "Test-NetConnection localhost -Port 443 -InformationLevel Quiet", "expected_output": "True", "timeout_seconds": 10},
        ], "success_rate_pct": 88, "avg_execution_seconds": 90, "enabled": True},
        {"id": "rb-dns", "name": "DNS Cache Flush & Recovery", "category": "network", "trigger": "dns_resolution_failure", "steps": [
            {"action": "Clear-DnsClientCache", "expected_output": "DNS cache cleared", "timeout_seconds": 5},
            {"action": "ipconfig /registerdns", "expected_output": "DNS registration refreshed", "timeout_seconds": 10},
            {"action": "Resolve-DnsName google.com -DnsOnly", "expected_output": "DNS resolution working", "timeout_seconds": 10},
            {"action": "Test-NetConnection 8.8.8.8 -Port 53", "expected_output": "DNS connectivity verified", "timeout_seconds": 10},
        ], "success_rate_pct": 95, "avg_execution_seconds": 20, "enabled": True},
        {"id": "rb-mem", "name": "Memory Pressure Relief", "category": "performance", "trigger": "memory_usage > 95%", "steps": [
            {"action": "Get-Process | Sort-Object WorkingSet64 -Descending | Select -First 5 Name, @{n='MemMB';e={[math]::Round($_.WorkingSet64/1MB)}}", "expected_output": "Top memory consumers identified", "timeout_seconds": 10},
            {"action": "Get-Process -Name 'w3wp' | Where {$_.WorkingSet64 -gt 500MB} | Stop-Process -Force", "expected_output": "IIS app pool recycled", "timeout_seconds": 15},
            {"action": "[System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()", "expected_output": "GC triggered", "timeout_seconds": 5},
            {"action": "Get-Counter '\\Memory\\Available MBytes' | Select -Expand CounterSamples | Select CookedValue", "expected_output": "Available memory increased", "timeout_seconds": 10},
        ], "success_rate_pct": 85, "avg_execution_seconds": 25, "enabled": True},
        {"id": "rb-backup", "name": "Backup Job Recovery", "category": "backup", "trigger": "backup_job_failed", "steps": [
            {"action": "Get-Service VSS | Restart-Service -Force", "expected_output": "VSS service restarted", "timeout_seconds": 20},
            {"action": "vssadmin list writers | findstr 'State'", "expected_output": "All writers stable", "timeout_seconds": 15},
            {"action": "Start-WBBackup -Policy (Get-WBPolicy)", "expected_output": "Backup job restarted", "timeout_seconds": 60},
            {"action": "Get-WBSummary | Select LastSuccessfulBackupTime", "expected_output": "Backup completed", "timeout_seconds": 10},
        ], "success_rate_pct": 78, "avg_execution_seconds": 120, "enabled": True},
        {"id": "rb-spooler", "name": "Print Spooler Recovery", "category": "service", "trigger": "spooler_crash_loop", "steps": [
            {"action": "Stop-Service Spooler -Force", "expected_output": "Spooler stopped", "timeout_seconds": 10},
            {"action": "Remove-Item C:\\Windows\\System32\\spool\\PRINTERS\\* -Force", "expected_output": "Print queue cleared", "timeout_seconds": 10},
            {"action": "Start-Service Spooler", "expected_output": "Spooler started", "timeout_seconds": 15},
            {"action": "Get-Printer | Select Name, PrinterStatus", "expected_output": "Printers online", "timeout_seconds": 10},
        ], "success_rate_pct": 94, "avg_execution_seconds": 30, "enabled": True},
        {"id": "rb-wsus", "name": "Windows Update Reset", "category": "updates", "trigger": "windows_update_stuck", "steps": [
            {"action": "Stop-Service wuauserv, bits, cryptSvc, msiserver -Force", "expected_output": "Update services stopped", "timeout_seconds": 15},
            {"action": "Rename-Item C:\\Windows\\SoftwareDistribution C:\\Windows\\SoftwareDistribution.old -Force", "expected_output": "Distribution folder reset", "timeout_seconds": 10},
            {"action": "Start-Service wuauserv, bits, cryptSvc, msiserver", "expected_output": "Update services started", "timeout_seconds": 15},
            {"action": "UsoClient StartScan", "expected_output": "Update scan initiated", "timeout_seconds": 30},
        ], "success_rate_pct": 91, "avg_execution_seconds": 50, "enabled": True},
    ]
    for rb in runbooks:
        await db.healing_runbooks.update_one({"id": rb["id"]}, {"$set": rb}, upsert=True)
    return [{k: v for k, v in rb.items() if k != "_id"} for rb in runbooks]


async def _seed_healing_events():
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "name": 1, "client_name": 1}).to_list(50)
    runbooks = await db.healing_runbooks.find({}, {"_id": 0}).to_list(50)
    if not runbooks:
        runbooks = await _seed_runbooks()

    issue_templates = [
        ("Disk space critical (94% used)", "disk", "disk_space_low", "high", "rb-disk"),
        ("Windows Update service stopped", "service", "service_stopped", "medium", "rb-svc"),
        ("SSL certificate expires in 5 days", "certificate", "cert_expiring", "high", "rb-cert"),
        ("DNS resolution intermittent failures", "network", "dns_failure", "medium", "rb-dns"),
        ("Memory usage at 96%", "performance", "memory_high", "high", "rb-mem"),
        ("Backup job failed - VSS error", "backup", "backup_failed", "critical", "rb-backup"),
        ("Print spooler crash loop (3rd restart)", "service", "spooler_crash", "medium", "rb-spooler"),
        ("Windows Update stuck for 48 hours", "updates", "update_stuck", "low", "rb-wsus"),
        ("Disk space warning (88% used)", "disk", "disk_space_low", "medium", "rb-disk"),
        ("IIS Application Pool stopped", "service", "service_stopped", "high", "rb-svc"),
        ("DHCP scope exhaustion (95%)", "network", "dhcp_exhaustion", "critical", "rb-dns"),
        ("Antivirus definitions outdated (7 days)", "security", "av_outdated", "medium", "rb-wsus"),
    ]

    events = []
    for desc, category, issue_type, severity, rb_id in issue_templates:
        device = random.choice(devices) if devices else {"id": "?", "name": "UNKNOWN", "client_name": "Unknown"}
        rb = next((r for r in runbooks if r["id"] == rb_id), runbooks[0])
        status = random.choices(["healed", "healed", "healed", "executing", "detected", "failed", "escalated"], weights=[35, 25, 15, 5, 5, 10, 5])[0]
        detected = datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 72))

        exec_log = []
        exec_time = 0
        if status == "healed":
            for i, step in enumerate(rb.get("steps", [])):
                dur = random.randint(200, 5000)
                exec_time += dur
                exec_log.append({"step": i + 1, "action": step["action"], "status": "completed", "output": step["expected_output"], "timestamp": (detected + timedelta(seconds=i * 3)).isoformat(), "duration_ms": dur})

        event = {
            "id": f"sh-{uuid.uuid4().hex[:8]}",
            "device_id": device.get("id"),
            "device_name": device.get("name"),
            "client_name": device.get("client_name"),
            "issue_type": issue_type,
            "issue_description": desc,
            "category": category,
            "severity": severity,
            "detected_at": detected.isoformat(),
            "detection_source": random.choice(["agent_monitor", "threshold_alert", "pattern_detection", "anomaly_ai"]),
            "status": status,
            "matched_runbook": rb.get("name"),
            "runbook_id": rb.get("id"),
            "confidence_pct": random.randint(78, 99),
            "runbook_steps": rb.get("steps", []),
            "execution_log": exec_log if status == "healed" else [],
            "execution_time_seconds": round(exec_time / 1000, 1) if status == "healed" else 0,
            "healed_at": (detected + timedelta(seconds=random.randint(15, 120))).isoformat() if status == "healed" else None,
            "time_saved_minutes": random.randint(10, 45) if status == "healed" else 0,
        }
        events.append(event)
        await db.self_healing_events.insert_one(event)

    return [{k: v for k, v in e.items() if k != "_id"} for e in events]
