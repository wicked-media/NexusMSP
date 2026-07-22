"""Evidence-weighted client health.

Client Health is an operational indicator, not a certification or a substitute
for an external monitoring provider.  Missing sources stay unassessed rather
than being converted into friendly default scores.
"""

from datetime import datetime, timezone, timedelta
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db


router = APIRouter()
TRUSTED_DEVICE_SOURCES = {"nexus-agent", "rmm-agent", "agent", "api-agent", "provider"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _numeric(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _device_source(device: dict) -> str | None:
    source = str(device.get("source") or device.get("telemetry_source") or "").lower()
    if source in TRUSTED_DEVICE_SOURCES:
        return source
    if device.get("nexus_agent_id"):
        return "nexus-agent"
    if device.get("last_heartbeat"):
        return "api-agent"
    return None


def _health_status(score: float | None) -> str:
    if score is None:
        return "not_assessed"
    if score >= 85:
        return "thriving"
    if score >= 70:
        return "healthy"
    if score >= 50:
        return "needs_attention"
    if score >= 30:
        return "at_risk"
    return "critical"


async def _compute_health(client: dict) -> dict:
    cid = client["id"]
    now = datetime.now(timezone.utc)
    open_tickets = await db.tickets.count_documents({"client_id": cid, "status": {"$in": ["open", "in_progress"]}})
    total_tickets = await db.tickets.count_documents({"client_id": cid})
    critical_tickets = await db.tickets.count_documents({"client_id": cid, "priority": "critical", "status": {"$in": ["open", "in_progress"]}})
    resolved_tickets = await db.tickets.count_documents({"client_id": cid, "status": {"$in": ["resolved", "closed"]}})

    all_devices = await db.devices.find({"client_id": cid}, {"_id": 0}).to_list(5000)
    devices = [device for device in all_devices if _device_source(device)]
    online_devices = sum(1 for device in devices if device.get("status") == "online")

    invoices = await db.invoices.find({"client_id": cid}, {"_id": 0, "status": 1}).to_list(5000)
    overdue_invoices = sum(1 for invoice in invoices if invoice.get("status") == "overdue")
    paid_invoices = sum(1 for invoice in invoices if invoice.get("status") == "paid")
    contracts = await db.contracts.find({"client_id": cid, "status": "active"}, {"_id": 0, "value": 1, "monthly_value": 1, "mrr": 1, "end_date": 1}).to_list(100)
    mrr = sum((_numeric(contract.get("monthly_value")) or _numeric(contract.get("mrr")) or _numeric(contract.get("value")) or 0) for contract in contracts)
    expiring_contracts = sum(1 for contract in contracts if contract.get("end_date") and str(contract["end_date"]) < (now + timedelta(days=60)).isoformat())

    backup_rows = await db.backup_jobs.find({"client_id": cid}, {"_id": 0, "status": 1, "source": 1, "provider": 1}).to_list(5000)
    verified_backups = [row for row in backup_rows if str(row.get("source") or row.get("provider") or "").strip()]
    backup_failures = sum(1 for row in verified_backups if str(row.get("status") or "").lower() == "failed")

    security_rows = await db.security_alerts.find({"client_id": cid}, {"_id": 0, "status": 1, "source": 1, "provider": 1}).to_list(5000)
    verified_security = [row for row in security_rows if str(row.get("source") or row.get("provider") or "").strip()]
    security_alerts = sum(1 for row in verified_security if str(row.get("status") or "").lower() in {"open", "active"})

    m365_score = None
    m365_top_risks: list[str] = []
    if client.get("cipp_tenant_id"):
        cached = await db.cipp_hygiene_cache.find_one({"tenant_id": client["cipp_tenant_id"]}, {"_id": 0})
        hygiene = (cached or {}).get("hygiene") or {}
        candidate = hygiene.get("score")
        if isinstance(candidate, (int, float)) and hygiene.get("evidence_state") in {"evidence_available", "assessed", "complete"}:
            m365_score = float(candidate)
            m365_top_risks = [risk.get("factor") for risk in hygiene.get("risks") or [] if risk.get("severity") != "info"][:3]

    network_score = None
    network_stats = None
    if client.get("unifi_site_id"):
        uni = await db.unifi_site_cache.find_one({"site_id": client["unifi_site_id"]}, {"_id": 0})
        total = _numeric((uni or {}).get("devices_total"))
        online = _numeric((uni or {}).get("devices_online"))
        if uni and total is not None and total > 0 and online is not None:
            alerts = int(_numeric(uni.get("alerts")) or 0)
            uptime_pct = round(online / total * 100)
            network_score = max(0, uptime_pct - alerts * 5)
            network_stats = {"devices_total": int(total), "devices_online": int(online), "offline_devices": max(0, int(total - online)), "clients_connected": int(_numeric(uni.get("clients_total")) or 0), "alerts": alerts, "uptime_pct": uptime_pct, "site_name": uni.get("name")}

    # A dimension contributes only if a directly attributable source exists.
    ticket_health = max(0, 100 - open_tickets * 8 - critical_tickets * 25) if total_tickets else None
    device_health = round(online_devices / len(devices) * 100) if devices else None
    payment_health = (100 if overdue_invoices == 0 else max(0, 100 - overdue_invoices * 25)) if invoices else None
    backup_health = round((len(verified_backups) - backup_failures) / len(verified_backups) * 100) if verified_backups else None
    security_health = max(0, 100 - security_alerts * 20) if verified_security else None
    sentiment_row = await db.client_sentiments.find_one({"client_id": cid}, {"_id": 0, "score": 1, "source": 1})
    sentiment = _numeric((sentiment_row or {}).get("score")) if sentiment_row and sentiment_row.get("source") else None

    dimensions = {
        "ticket": (ticket_health, 0.25), "device": (device_health, 0.20), "payment": (payment_health, 0.20),
        "backup": (backup_health, 0.15), "security": (security_health, 0.10), "m365": (m365_score, 0.10), "network": (network_score, 0.10),
    }
    assessed = {key: item for key, item in dimensions.items() if item[0] is not None}
    # At least two independent evidence dimensions are required for an overall
    # client health score.  One signal is useful context, not a portfolio score.
    if len(assessed) >= 2:
        total_weight = sum(weight for _, weight in assessed.values())
        composite = round(sum(score * weight for score, weight in assessed.values()) / total_weight)
    else:
        composite = None
    status = _health_status(composite)
    coverage_pct = round(len(assessed) / len(dimensions) * 100)

    risk_factors = []
    positive_factors = []
    if critical_tickets:
        risk_factors.append({"factor": f"{critical_tickets} critical tickets open", "severity": "critical", "impact": -25})
    if total_tickets and open_tickets > 5:
        risk_factors.append({"factor": f"{open_tickets} tickets backlogged", "severity": "warning", "impact": -10})
    if invoices and overdue_invoices:
        risk_factors.append({"factor": f"{overdue_invoices} overdue invoices", "severity": "warning", "impact": -15})
    if verified_backups and backup_failures:
        risk_factors.append({"factor": f"{backup_failures} failed backup jobs", "severity": "critical" if backup_failures > 2 else "warning", "impact": -20})
    if verified_security and security_alerts:
        risk_factors.append({"factor": f"{security_alerts} active security alerts", "severity": "critical", "impact": -15})
    if expiring_contracts:
        risk_factors.append({"factor": f"{expiring_contracts} contracts expiring in 60 days", "severity": "warning", "impact": -10})
    if device_health is not None and device_health < 80:
        risk_factors.append({"factor": f"Reported endpoint availability is below 80% ({online_devices}/{len(devices)})", "severity": "warning", "impact": -10})
    if m365_score is not None and m365_score < 60:
        risk_factors.append({"factor": f"M365 hygiene score is low ({m365_score:g})", "severity": "warning", "impact": -(60 - m365_score) // 2})
    risk_factors.extend({"factor": factor, "severity": "info", "impact": -2} for factor in m365_top_risks[:2] if factor)
    if network_stats and network_stats["offline_devices"]:
        risk_factors.append({"factor": f"{network_stats['offline_devices']} UniFi device(s) offline at {network_stats['site_name'] or 'linked site'}", "severity": "critical" if network_stats["offline_devices"] >= 3 else "warning", "impact": -network_stats["offline_devices"] * 5})

    if invoices and not overdue_invoices:
        positive_factors.append({"factor": "No overdue invoices in recorded invoice history", "impact": "+5"})
    if backup_health is not None and backup_health >= 98:
        positive_factors.append({"factor": f"Recorded backup success rate {backup_health}%", "impact": "+3"})
    if total_tickets and open_tickets == 0:
        positive_factors.append({"factor": "No open tickets in recorded ticket history", "impact": "+5"})
    if network_stats and network_stats["uptime_pct"] == 100 and not network_stats["alerts"]:
        positive_factors.append({"factor": f"All {network_stats['devices_total']} linked network devices reported online", "impact": "+3"})

    missing_sources = [key for key in dimensions if key not in assessed]
    return {
        "client_id": cid, "client_name": client.get("name", ""), "tier": client.get("tier", "standard"), "industry": client.get("industry", ""),
        "health_score": composite, "status": status, "evidence_state": "assessed" if len(assessed) >= 3 else "partial_evidence" if assessed else "not_assessed", "evidence_coverage_pct": coverage_pct,
        "missing_sources": missing_sources, "mrr": mrr,
        "metrics": {"ticket_health": ticket_health, "device_health": device_health, "payment_health": payment_health, "backup_health": backup_health, "security_health": security_health, "engagement": None, "sentiment": sentiment, "m365_hygiene": m365_score, "network_health": network_score},
        "details": {"open_tickets": open_tickets, "critical_tickets": critical_tickets, "total_tickets": total_tickets, "resolved_tickets": resolved_tickets, "devices": len(devices), "online_devices": online_devices, "device_observed": bool(devices), "overdue_invoices": overdue_invoices, "paid_invoices": paid_invoices, "backup_success_rate": backup_health, "backup_failures": backup_failures, "backup_observed": bool(verified_backups), "security_alerts": security_alerts, "security_observed": bool(verified_security), "expiring_contracts": expiring_contracts, "monthly_revenue": mrr, "network": network_stats},
        "risk_factors": risk_factors, "positive_factors": positive_factors,
    }


@router.get("/client-health/scores")
async def get_all_health_scores(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0}).to_list(500)
    scores = [await _compute_health(client) for client in clients]
    return sorted(scores, key=lambda item: (item["health_score"] is None, item["health_score"] if item["health_score"] is not None else 101))


@router.get("/client-health/dashboard")
async def health_dashboard(current_user: dict = Depends(get_current_user)):
    scores = await get_all_health_scores(current_user)
    numeric_scores = [score for score in scores if isinstance(score.get("health_score"), (int, float))]
    distribution: dict[str, int] = {}
    for score in scores:
        distribution[score["status"]] = distribution.get(score["status"], 0) + 1
    at_risk = [score for score in numeric_scores if score["health_score"] < 50]
    alerts = []
    for score in scores:
        for index, factor in enumerate(score.get("risk_factors") or []):
            if factor.get("severity") == "critical":
                alerts.append({"id": f"health-{score['client_id']}-{index}", "client_name": score["client_name"], "client_id": score["client_id"], "health_score": score["health_score"], "message": factor["factor"], "severity": factor["severity"], "category": _detect_category(factor["factor"]), "source": "computed_from_recorded_evidence"})
    trend = await db.health_snapshots.find({}, {"_id": 0}).sort("date", -1).to_list(30)
    return {"total": len(scores), "assessed_clients": len(numeric_scores), "avg_health": round(sum(score["health_score"] for score in numeric_scores) / len(numeric_scores), 1) if numeric_scores else None, "distribution": distribution, "at_risk": at_risk[:10], "top_clients": sorted(numeric_scores, key=lambda item: item["health_score"], reverse=True)[:5], "total_monthly_revenue": sum(score.get("mrr", 0) for score in scores), "at_risk_revenue": sum(score.get("mrr", 0) for score in at_risk), "alerts": alerts[:20], "trend": trend[:14], "message": "Client health requires at least two independent evidence dimensions. Missing integrations are shown as unassessed."}


@router.get("/client-health/{client_id}/detail")
async def get_client_health_detail(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    health = await _compute_health(client)
    health["trend"] = await db.health_snapshots_client.find({"client_id": client_id}, {"_id": 0}).sort("date", -1).to_list(30)
    health["recent_tickets"] = await db.tickets.find({"client_id": client_id}, {"_id": 0, "id": 1, "title": 1, "status": 1, "priority": 1, "created_at": 1}).sort("created_at", -1).to_list(5)
    health["recent_invoices"] = await db.invoices.find({"client_id": client_id}, {"_id": 0, "id": 1, "invoice_number": 1, "status": 1, "total": 1, "created_at": 1}).sort("created_at", -1).to_list(5)
    return health


@router.post("/client-health/snapshot")
async def take_health_snapshot(current_user: dict = Depends(get_current_user)):
    scores = await get_all_health_scores(current_user)
    numeric_scores = [score for score in scores if isinstance(score.get("health_score"), (int, float))]
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    distribution: dict[str, int] = {}
    for score in scores:
        distribution[score["status"]] = distribution.get(score["status"], 0) + 1
    snapshot = {"date": date, "avg_health": round(sum(score["health_score"] for score in numeric_scores) / len(numeric_scores), 1) if numeric_scores else None, "total_clients": len(scores), "assessed_clients": len(numeric_scores), "distribution": distribution, "at_risk_count": sum(1 for score in numeric_scores if score["health_score"] < 50), "taken_at": _now(), "taken_by": current_user.get("name") or current_user.get("email") or current_user.get("id", "")}
    await db.health_snapshots.update_one({"date": date}, {"$set": snapshot}, upsert=True)
    for score in numeric_scores:
        await db.health_snapshots_client.update_one({"client_id": score["client_id"], "date": date}, {"$set": {"client_id": score["client_id"], "date": date, "health_score": score["health_score"], "status": score["status"], "metrics": score["metrics"], "evidence_state": score["evidence_state"]}}, upsert=True)
    return {"message": f"Snapshot recorded for {len(numeric_scores)} assessed client(s)", "date": date, "avg_health": snapshot["avg_health"]}


@router.get("/client-health/alert-config")
async def get_alert_config(current_user: dict = Depends(get_current_user)):
    config = await db.health_alert_config.find_one({"type": "global"}, {"_id": 0})
    return config or {"type": "global", "critical_threshold": 30, "warning_threshold": 50, "notify_on_decline": True, "decline_amount": 10, "notify_email": "", "notify_slack": False, "auto_create_ticket": False, "check_interval_hours": 24, "evidence_state": "not_configured"}


@router.put("/client-health/alert-config")
async def update_alert_config(data: dict, current_user: dict = Depends(get_current_user)):
    config = {"type": "global", "critical_threshold": data.get("critical_threshold", 30), "warning_threshold": data.get("warning_threshold", 50), "notify_on_decline": data.get("notify_on_decline", True), "decline_amount": data.get("decline_amount", 10), "notify_email": data.get("notify_email", ""), "notify_slack": data.get("notify_slack", False), "auto_create_ticket": False, "check_interval_hours": data.get("check_interval_hours", 24), "updated_at": _now(), "updated_by": current_user.get("name") or current_user.get("email") or current_user.get("id", "")}
    await db.health_alert_config.update_one({"type": "global"}, {"$set": config}, upsert=True)
    return config


def _detect_category(factor: str) -> str:
    value = factor.lower()
    if "ticket" in value:
        return "tickets"
    if "invoice" in value or "overdue" in value:
        return "billing"
    if "backup" in value:
        return "backup"
    if "security" in value:
        return "security"
    if "device" in value or "endpoint" in value:
        return "devices"
    if "contract" in value:
        return "contracts"
    return "general"
