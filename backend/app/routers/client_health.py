"""Evidence-weighted client health.

Client Health is an operational indicator, not a certification or a substitute
for an external monitoring provider.  Missing sources stay unassessed rather
than being converted into friendly default scores.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.time_utils import now_iso as _now
from app.services.client_health_engine import compute_health
from app.services.scope_permissions import assert_tenant_record_scope, platform_tenant_id, scoped_query, tenant_scoped_query


router = APIRouter()


@router.get("/client-health/scores")
async def get_all_health_scores(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find(tenant_scoped_query(current_user, scoped_query(current_user)), {"_id": 0}).to_list(500)
    scores = [await compute_health(client, current_user) for client in clients]
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
    trend = await db.health_snapshots.find(tenant_scoped_query(current_user), {"_id": 0}).sort("date", -1).to_list(30)
    return {"total": len(scores), "assessed_clients": len(numeric_scores), "avg_health": round(sum(score["health_score"] for score in numeric_scores) / len(numeric_scores), 1) if numeric_scores else None, "distribution": distribution, "at_risk": at_risk[:10], "top_clients": sorted(numeric_scores, key=lambda item: item["health_score"], reverse=True)[:5], "total_monthly_revenue": sum(score.get("mrr", 0) for score in scores), "at_risk_revenue": sum(score.get("mrr", 0) for score in at_risk), "alerts": alerts[:20], "trend": trend[:14], "message": "Client health requires at least two independent evidence dimensions. Missing integrations are shown as unassessed."}


@router.get("/client-health/{client_id}/detail")
async def get_client_health_detail(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await assert_tenant_record_scope(current_user, db.clients, client_id, operation="client_health.read", resource_name="Client")
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    health = await compute_health(client, current_user)
    health["trend"] = await db.health_snapshots_client.find(tenant_scoped_query(current_user, {"client_id": client_id}), {"_id": 0}).sort("date", -1).to_list(30)
    health["recent_tickets"] = await db.tickets.find(tenant_scoped_query(current_user, {"client_id": client_id}), {"_id": 0, "id": 1, "title": 1, "status": 1, "priority": 1, "created_at": 1}).sort("created_at", -1).to_list(5)
    health["recent_invoices"] = await db.invoices.find(tenant_scoped_query(current_user, {"client_id": client_id}), {"_id": 0, "id": 1, "invoice_number": 1, "status": 1, "total": 1, "created_at": 1}).sort("created_at", -1).to_list(5)
    return health


@router.post("/client-health/snapshot")
async def take_health_snapshot(current_user: dict = Depends(get_current_user)):
    scores = await get_all_health_scores(current_user)
    numeric_scores = [score for score in scores if isinstance(score.get("health_score"), (int, float))]
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    distribution: dict[str, int] = {}
    for score in scores:
        distribution[score["status"]] = distribution.get(score["status"], 0) + 1
    snapshot = {"date": date, "tenant_id": platform_tenant_id(current_user), "avg_health": round(sum(score["health_score"] for score in numeric_scores) / len(numeric_scores), 1) if numeric_scores else None, "total_clients": len(scores), "assessed_clients": len(numeric_scores), "distribution": distribution, "at_risk_count": sum(1 for score in numeric_scores if score["health_score"] < 50), "taken_at": _now(), "taken_by": current_user.get("name") or current_user.get("email") or current_user.get("id", "")}
    await db.health_snapshots.update_one(tenant_scoped_query(current_user, {"date": date}), {"$set": snapshot}, upsert=True)
    for score in numeric_scores:
        await db.health_snapshots_client.update_one(tenant_scoped_query(current_user, {"client_id": score["client_id"], "date": date}), {"$set": {"tenant_id": platform_tenant_id(current_user), "client_id": score["client_id"], "date": date, "health_score": score["health_score"], "status": score["status"], "metrics": score["metrics"], "evidence_state": score["evidence_state"]}}, upsert=True)
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
