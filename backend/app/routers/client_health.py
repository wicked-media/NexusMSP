"""Client Health Score Dashboard - Enhanced with trends, alerts, and deep drilldowns"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid

router = APIRouter()


async def _compute_health(client):
    """Compute comprehensive health score for a client"""
    cid = client["id"]

    # Ticket metrics
    open_tickets = await db.tickets.count_documents({"client_id": cid, "status": {"$in": ["open", "in_progress"]}})
    total_tickets = await db.tickets.count_documents({"client_id": cid})
    critical_tickets = await db.tickets.count_documents({"client_id": cid, "priority": "critical", "status": {"$in": ["open", "in_progress"]}})
    resolved_tickets = await db.tickets.count_documents({"client_id": cid, "status": {"$in": ["resolved", "closed"]}})

    # Device metrics
    devices = await db.devices.count_documents({"client_id": cid})
    online_devices = await db.devices.count_documents({"client_id": cid, "status": "online"})

    # Invoice/payment metrics
    overdue_invoices = await db.invoices.count_documents({"client_id": cid, "status": "overdue"})
    paid_invoices = await db.invoices.count_documents({"client_id": cid, "status": "paid"})
    total_invoices = await db.invoices.count_documents({"client_id": cid})

    # Contracts / MRR
    contracts = await db.contracts.find({"client_id": cid, "status": "active"}, {"_id": 0, "value": 1, "end_date": 1}).to_list(20)
    mrr = sum(c.get("value", 0) for c in contracts)
    expiring_contracts = sum(1 for c in contracts if c.get("end_date") and c["end_date"] < (datetime.now(timezone.utc) + timedelta(days=60)).isoformat())

    # Backup metrics
    backup_failures = await db.backup_jobs.count_documents({"client_id": cid, "status": "failed"})
    backup_total = await db.backup_jobs.count_documents({"client_id": cid})
    backup_success_rate = round(((backup_total - backup_failures) / max(backup_total, 1)) * 100)

    # Security metrics
    security_alerts = await db.security_alerts.count_documents({"client_id": cid, "status": {"$in": ["open", "active"]}})

    # Sentiment
    sentiment = await db.client_sentiments.find_one({"client_id": cid}, {"_id": 0, "score": 1})
    sentiment_score = (sentiment or {}).get("score", 65)

    # M365 hygiene (CIPP) — only when linked; reads from cipp_hygiene_cache (6h TTL managed by cipp_hygiene router)
    m365_score = None
    m365_top_risks = []
    if client.get("cipp_tenant_id"):
        cached = await db.cipp_hygiene_cache.find_one({"tenant_id": client["cipp_tenant_id"]}, {"_id": 0})
        if cached and cached.get("hygiene"):
            h = cached["hygiene"]
            m365_score = h.get("score")
            m365_top_risks = [r["factor"] for r in (h.get("risks") or [])[:3]]

    # ===== SCORING =====
    # Ticket Health (25 pts)
    ticket_health = max(0, 100 - (open_tickets * 8) - (critical_tickets * 25))

    # Device Uptime (20 pts)
    device_health = round((online_devices / max(devices, 1)) * 100) if devices > 0 else 80

    # Payment Health (20 pts)
    payment_health = 100 if overdue_invoices == 0 else max(0, 100 - overdue_invoices * 25)

    # Backup Health (15 pts)
    backup_health = backup_success_rate if backup_total > 0 else 80

    # Security Posture (10 pts)
    security_health = max(0, 100 - security_alerts * 20)

    # Engagement (10 pts)
    engagement = min(100, total_tickets * 3 + paid_invoices * 8)

    # When we have an M365 hygiene score, rebalance the composite to give it 10% of weight
    # (pulled from engagement 10→5 and security 10→5). Otherwise keep the legacy weights.
    if m365_score is not None:
        composite = int(
            ticket_health * 0.25 +
            device_health * 0.20 +
            payment_health * 0.20 +
            backup_health * 0.15 +
            security_health * 0.05 +
            engagement * 0.05 +
            m365_score * 0.10
        )
    else:
        composite = int(
            ticket_health * 0.25 +
            device_health * 0.20 +
            payment_health * 0.20 +
            backup_health * 0.15 +
            security_health * 0.10 +
            engagement * 0.10
        )
    composite = max(0, min(100, composite))

    status = "thriving" if composite >= 85 else "healthy" if composite >= 70 else "needs_attention" if composite >= 50 else "at_risk" if composite >= 30 else "critical"

    # Risk factors
    risk_factors = []
    if critical_tickets > 0:
        risk_factors.append({"factor": f"{critical_tickets} critical tickets open", "severity": "critical", "impact": -25})
    if open_tickets > 5:
        risk_factors.append({"factor": f"{open_tickets} tickets backlogged", "severity": "warning", "impact": -10})
    if overdue_invoices > 0:
        risk_factors.append({"factor": f"{overdue_invoices} overdue invoices", "severity": "warning", "impact": -15})
    if backup_failures > 2:
        risk_factors.append({"factor": f"{backup_failures} backup failures", "severity": "critical", "impact": -20})
    if security_alerts > 0:
        risk_factors.append({"factor": f"{security_alerts} active security alerts", "severity": "critical", "impact": -15})
    if expiring_contracts > 0:
        risk_factors.append({"factor": f"{expiring_contracts} contracts expiring in 60 days", "severity": "warning", "impact": -10})
    if devices > 0 and online_devices / devices < 0.8:
        risk_factors.append({"factor": f"Device uptime below 80% ({online_devices}/{devices})", "severity": "warning", "impact": -10})

    # Positive factors
    positive_factors = []
    if overdue_invoices == 0 and total_invoices > 0:
        positive_factors.append({"factor": "All invoices paid on time", "impact": "+5"})
    if backup_success_rate >= 98 and backup_total > 0:
        positive_factors.append({"factor": f"Backup success rate {backup_success_rate}%", "impact": "+3"})
    if open_tickets == 0:
        positive_factors.append({"factor": "No open tickets", "impact": "+5"})
    if security_alerts == 0:
        positive_factors.append({"factor": "Clean security posture", "impact": "+3"})
    if m365_score is not None and m365_score >= 85:
        positive_factors.append({"factor": f"M365 hygiene score {m365_score}", "impact": "+3"})

    # M365 hygiene risks
    if m365_score is not None and m365_score < 60:
        risk_factors.append({"factor": f"M365 hygiene score low ({m365_score})", "severity": "warning", "impact": -(60 - m365_score) // 2})
    for tr in m365_top_risks[:2]:
        risk_factors.append({"factor": tr, "severity": "info", "impact": -2})

    return {
        "client_id": cid,
        "client_name": client.get("name", ""),
        "tier": client.get("tier", "standard"),
        "industry": client.get("industry", ""),
        "health_score": composite,
        "status": status,
        "mrr": mrr,
        "metrics": {
            "ticket_health": ticket_health,
            "device_health": device_health,
            "payment_health": payment_health,
            "backup_health": backup_health,
            "security_health": security_health,
            "engagement": engagement,
            "sentiment": sentiment_score,
            "m365_hygiene": m365_score,
        },
        "details": {
            "open_tickets": open_tickets,
            "critical_tickets": critical_tickets,
            "total_tickets": total_tickets,
            "resolved_tickets": resolved_tickets,
            "devices": devices,
            "online_devices": online_devices,
            "overdue_invoices": overdue_invoices,
            "paid_invoices": paid_invoices,
            "backup_success_rate": backup_success_rate,
            "backup_failures": backup_failures,
            "security_alerts": security_alerts,
            "expiring_contracts": expiring_contracts,
            "monthly_revenue": mrr,
        },
        "risk_factors": risk_factors,
        "positive_factors": positive_factors,
    }


@router.get("/client-health/scores")
async def get_all_health_scores(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0}).to_list(500)
    scores = []
    for c in clients:
        h = await _compute_health(c)
        scores.append(h)
    scores.sort(key=lambda x: x["health_score"])
    return scores


@router.get("/client-health/dashboard")
async def health_dashboard(current_user: dict = Depends(get_current_user)):
    scores = await get_all_health_scores(current_user)
    if not scores:
        return {"total": 0, "avg_health": 0, "distribution": {}, "at_risk": [], "top_clients": [], "alerts": []}

    avg = round(sum(s["health_score"] for s in scores) / len(scores), 1)
    dist = {}
    for s in scores:
        dist[s["status"]] = dist.get(s["status"], 0) + 1

    at_risk = [s for s in scores if s["health_score"] < 50]
    top = sorted(scores, key=lambda x: x["health_score"], reverse=True)[:5]
    total_mrr = sum(s.get("mrr", 0) for s in scores)
    at_risk_mrr = sum(s.get("mrr", 0) for s in at_risk)

    # Auto-generate alerts from risk factors
    alerts = []
    for s in scores:
        for rf in s.get("risk_factors", []):
            if rf["severity"] == "critical":
                alerts.append({
                    "id": f"ALT-{uuid.uuid4().hex[:6].upper()}",
                    "client_name": s["client_name"],
                    "client_id": s["client_id"],
                    "health_score": s["health_score"],
                    "message": rf["factor"],
                    "severity": rf["severity"],
                    "category": _detect_category(rf["factor"]),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
    alerts.sort(key=lambda x: x["health_score"])

    # Trend data (from stored snapshots)
    trend = await db.health_snapshots.find({}, {"_id": 0}).sort("date", -1).to_list(30)

    return {
        "total": len(scores),
        "avg_health": avg,
        "distribution": dist,
        "at_risk": at_risk[:10],
        "top_clients": top,
        "total_monthly_revenue": total_mrr,
        "at_risk_revenue": at_risk_mrr,
        "alerts": alerts[:20],
        "trend": trend[:14],
    }


@router.get("/client-health/{client_id}/detail")
async def get_client_health_detail(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    health = await _compute_health(client)

    # Get historical snapshots for this client
    snapshots = await db.health_snapshots_client.find({"client_id": client_id}, {"_id": 0}).sort("date", -1).to_list(30)

    # Get recent activity
    recent_tickets = await db.tickets.find({"client_id": client_id}, {"_id": 0, "id": 1, "title": 1, "status": 1, "priority": 1, "created_at": 1}).sort("created_at", -1).to_list(5)
    recent_invoices = await db.invoices.find({"client_id": client_id}, {"_id": 0, "id": 1, "invoice_number": 1, "status": 1, "total": 1, "created_at": 1}).sort("created_at", -1).to_list(5)

    health["trend"] = snapshots
    health["recent_tickets"] = recent_tickets
    health["recent_invoices"] = recent_invoices
    return health


@router.post("/client-health/snapshot")
async def take_health_snapshot(current_user: dict = Depends(get_current_user)):
    """Take a point-in-time snapshot of all client health scores for trend tracking"""
    scores = await get_all_health_scores(current_user)
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")

    # Aggregate snapshot
    avg = round(sum(s["health_score"] for s in scores) / max(len(scores), 1), 1) if scores else 0
    dist = {}
    for s in scores:
        dist[s["status"]] = dist.get(s["status"], 0) + 1

    snapshot = {
        "date": date_str,
        "avg_health": avg,
        "total_clients": len(scores),
        "distribution": dist,
        "at_risk_count": len([s for s in scores if s["health_score"] < 50]),
        "taken_at": now.isoformat(),
    }
    await db.health_snapshots.update_one({"date": date_str}, {"$set": snapshot}, upsert=True)

    # Per-client snapshots
    for s in scores:
        await db.health_snapshots_client.update_one(
            {"client_id": s["client_id"], "date": date_str},
            {"$set": {"client_id": s["client_id"], "date": date_str, "health_score": s["health_score"], "status": s["status"], "metrics": s["metrics"]}},
            upsert=True
        )

    return {"message": f"Snapshot taken for {len(scores)} clients", "date": date_str, "avg_health": avg}


@router.get("/client-health/alert-config")
async def get_alert_config(current_user: dict = Depends(get_current_user)):
    config = await db.health_alert_config.find_one({"type": "global"}, {"_id": 0})
    if not config:
        config = {
            "type": "global",
            "critical_threshold": 30,
            "warning_threshold": 50,
            "notify_on_decline": True,
            "decline_amount": 10,
            "notify_email": "",
            "notify_slack": False,
            "auto_create_ticket": True,
            "check_interval_hours": 24,
        }
    return config


@router.put("/client-health/alert-config")
async def update_alert_config(data: dict, current_user: dict = Depends(get_current_user)):
    config = {
        "type": "global",
        "critical_threshold": data.get("critical_threshold", 30),
        "warning_threshold": data.get("warning_threshold", 50),
        "notify_on_decline": data.get("notify_on_decline", True),
        "decline_amount": data.get("decline_amount", 10),
        "notify_email": data.get("notify_email", ""),
        "notify_slack": data.get("notify_slack", False),
        "auto_create_ticket": data.get("auto_create_ticket", True),
        "check_interval_hours": data.get("check_interval_hours", 24),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": current_user.get("name", "Admin"),
    }
    await db.health_alert_config.update_one({"type": "global"}, {"$set": config}, upsert=True)
    return config


def _detect_category(factor: str) -> str:
    f = factor.lower()
    if "ticket" in f:
        return "tickets"
    if "invoice" in f or "overdue" in f:
        return "billing"
    if "backup" in f:
        return "backup"
    if "security" in f:
        return "security"
    if "device" in f or "uptime" in f:
        return "devices"
    if "contract" in f:
        return "contracts"
    return "general"
