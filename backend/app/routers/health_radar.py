"""Client health and opportunity radar.

Health is reported only from recorded evidence.  A client with no devices and
no tickets has no operating health to state, so it is returned as
``not_assessed`` rather than inheriting a perfect score.

The radar does not calculate a second health score: it consumes the canonical
``compute_health`` result and adds opportunity evidence around it.
"""

from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.client_health_engine import compute_health
from app.services.platform_foundation import emit_platform_event
from app.services.scope_permissions import assert_tenant_record_scope, platform_tenant_id, scoped_query, tenant_scoped_query

router = APIRouter()

# ============== CLIENT HEALTH & OPPORTUNITY RADAR ==============

EVIDENCE_POLICY = (
    "A client is scored only when at least two independent evidence dimensions "
    "are recorded; otherwise it is listed as not assessed."
)

EVIDENCE_SOURCES = frozenset({"ticket", "device", "payment", "backup", "security", "m365", "network"})


async def _radar_entry(client: dict, current_user: dict) -> dict:
    """Build one radar row around the canonical health result."""
    client_id = client["id"]
    canonical = await compute_health(client, current_user)
    details = canonical["details"]

    now = datetime.now(timezone.utc)
    thirty_days_ago = (now - timedelta(days=30)).isoformat()

    open_tickets = details["open_tickets"]
    critical_tickets = details["critical_tickets"]
    total_tickets = details["total_tickets"]
    devices = details["devices"]
    offline_devices = max(0, devices - details["online_devices"])
    recent_tickets = await db.tickets.count_documents({"client_id": client_id, "created_at": {"$gte": thirty_days_ago}})

    contracts = await db.contracts.find({"client_id": client_id}, {"_id": 0}).to_list(10)
    expiring_contracts = [c for c in contracts if c.get("end_date") and c["end_date"] <= (now + timedelta(days=60)).strftime("%Y-%m-%d")]
    active_contracts = len([c for c in contracts if c.get("status") == "active"])

    invoices = await db.invoices.find({"client_id": client_id, "status": {"$in": ["sent", "overdue"]}}, {"_id": 0}).to_list(20)
    overdue_invoices = [i for i in invoices if i.get("status") == "overdue"]
    outstanding_amount = sum(float(i.get("total", 0)) - float(i.get("amount_paid", 0)) for i in invoices)

    health_score = canonical["health_score"]
    missing = canonical.get("missing_sources") or []

    risk_factors = []
    opportunities = []
    if critical_tickets > 0:
        risk_factors.append(f"{critical_tickets} critical open tickets")
    if open_tickets > 5:
        risk_factors.append(f"{open_tickets} open tickets (high volume)")
    if recent_tickets > 10:
        risk_factors.append(f"{recent_tickets} tickets in last 30 days (spike)")
    if offline_devices > 0:
        risk_factors.append(f"{offline_devices} devices offline")
    if overdue_invoices:
        risk_factors.append(f"{len(overdue_invoices)} overdue invoices (${sum(float(i.get('total', 0)) for i in overdue_invoices):,.0f})")
    if expiring_contracts:
        risk_factors.append(f"{len(expiring_contracts)} contract(s) expiring soon")

    # Opportunities are only proposed for assessed accounts: an account with no
    # operating evidence is not a growth lead.
    if health_score is not None:
        if devices > 0 and devices < 10:
            opportunities.append({"type": "expansion", "description": f"Only {devices} devices managed - potential for fleet expansion", "potential_mrr": devices * 15})
        if active_contracts == 0:
            opportunities.append({"type": "contract", "description": "No active contracts - opportunity for managed services agreement", "potential_mrr": 500})
        if devices > 0 and offline_devices == 0 and open_tickets < 3:
            opportunities.append({"type": "premium", "description": "Stable environment - upsell to premium/proactive support tier", "potential_mrr": 200})
        if expiring_contracts:
            for c in expiring_contracts:
                opportunities.append({"type": "renewal", "description": f"Contract '{c.get('name', '')}' expiring - renewal opportunity", "potential_mrr": float(c.get("monthly_value", 0))})

    return {
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "health_score": health_score,
        "status": canonical["status"],
        "evidence_state": canonical["evidence_state"],
        "evidence_coverage_pct": canonical["evidence_coverage_pct"],
        "assessed_dimensions": [key for key in ("ticket", "device", "payment", "backup", "security", "m365", "network") if key not in missing],
        "missing_sources": missing,
        "mrr": float(canonical.get("mrr") or client.get("mrr", 0)),
        "risk_factors": risk_factors,
        "opportunities": opportunities,
        "metrics": {
            "open_tickets": open_tickets,
            "critical_tickets": critical_tickets,
            "total_tickets": total_tickets,
            "recent_tickets_30d": recent_tickets,
            "devices": devices,
            "offline_devices": offline_devices,
            "active_contracts": active_contracts,
            "expiring_contracts": len(expiring_contracts),
            "overdue_invoices": len(overdue_invoices),
            "outstanding_amount": outstanding_amount,
        },
    }


@router.post("/health-radar/evidence-actions")
async def record_evidence_action(payload: dict | None = None, current_user: dict = Depends(get_current_user)):
    """Record when a technician starts connecting a missing evidence source.

    The client is resolved through the caller's tenant/client scope first, so an
    out-of-scope client cannot be probed through this endpoint.  The resulting
    platform event is the measurement record: it carries the source and client,
    not the missing values or any provider data.
    """
    body = payload or {}
    client_id = str(body.get("client_id") or "").strip()
    source = str(body.get("source") or "").strip().lower()
    if not client_id or source not in EVIDENCE_SOURCES:
        raise HTTPException(status_code=422, detail="client_id and a missing evidence source are required")

    client = await assert_tenant_record_scope(
        current_user,
        db.clients,
        client_id,
        operation="health_radar.evidence_action",
        resource_name="Client",
    )
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    event = await emit_platform_event(
        subject="client.evidence_action.started",
        source="nexus.health-radar",
        payload={
            "client_id": client_id,
            "client_name": client.get("name") or "",
            "evidence_source": source,
        },
        actor=current_user,
        tenant_id=platform_tenant_id(current_user),
        client_id=client_id,
    )
    return {"recorded": True, "event_id": event.get("id")}


@router.get("/health-radar/dashboard")
async def get_health_radar_dashboard(current_user: dict = Depends(get_current_user)):
    """Comprehensive client health and opportunity analysis."""
    clients = await db.clients.find(tenant_scoped_query(current_user, scoped_query(current_user)), {"_id": 0}).to_list(500)

    entries = [await _radar_entry(client, current_user) for client in clients]
    at_risk = [entry for entry in entries if entry["status"] in {"needs_attention", "at_risk", "critical"}]
    healthy = [entry for entry in entries if entry["status"] in {"thriving", "healthy"}]
    unassessed = [entry for entry in entries if entry["health_score"] is None]
    upsell_opportunities = [entry for entry in entries if entry["opportunities"] and entry["health_score"] is not None]

    at_risk.sort(key=lambda x: x["health_score"])
    upsell_opportunities.sort(key=lambda x: sum(o.get("potential_mrr", 0) for o in x["opportunities"]), reverse=True)
    unassessed.sort(key=lambda x: x["client_name"])

    total_potential_mrr = sum(sum(o.get("potential_mrr", 0) for o in c["opportunities"]) for c in upsell_opportunities)
    numeric_scores = [entry["health_score"] for entry in entries if entry["health_score"] is not None]

    return {
        "summary": {
            "total_clients": len(clients),
            "assessed_count": len(numeric_scores),
            "not_assessed_count": len(unassessed),
            "at_risk_count": len(at_risk),
            "healthy_count": len(healthy),
            "total_potential_mrr": total_potential_mrr,
            "avg_health_score": round(sum(numeric_scores) / len(numeric_scores), 1) if numeric_scores else None,
            "evidence_policy": EVIDENCE_POLICY,
        },
        "at_risk_clients": at_risk[:20],
        "upsell_opportunities": upsell_opportunities[:20],
        "healthy_clients": healthy[:20],
        "unassessed_clients": unassessed[:20],
    }
