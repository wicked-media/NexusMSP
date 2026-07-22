"""Evidence-backed client workspace endpoints.

Client Studio presents recorded commercial and service data.  It intentionally
does not forecast renewal, sentiment, revenue uplift, compliance, or churn
when the required provider or technician evidence is absent.
"""

from datetime import datetime, timezone, timedelta
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db


router = APIRouter(tags=["Client Studio"])
TRUSTED_SENTIMENT_SOURCES = {"manual", "survey", "csat", "nps", "provider", "integration"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _date(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def derive_tier(mrr: float, active_services: int = 0) -> str:
    """Suggested tier from recorded recurring commercial value only."""
    if mrr >= 15000:
        return "diamond"
    if mrr >= 5000:
        return "platinum"
    if mrr >= 1500:
        return "gold"
    if mrr >= 500:
        return "silver"
    return "bronze"


async def _client_or_404(client_id: str) -> dict:
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


async def _sentiment(client_id: str) -> float | None:
    record = await db.sentiment_scores.find_one({"client_id": client_id}, {"_id": 0})
    source = str((record or {}).get("source") or "").lower()
    score = _number((record or {}).get("score"))
    return score if source in TRUSTED_SENTIMENT_SOURCES and score is not None else None


async def compute_client_metrics(client_id: str) -> dict:
    contracts = await db.contracts.find({"client_id": client_id, "status": "active"}, {"_id": 0}).to_list(200)
    mrr = 0.0
    for contract in contracts:
        value = _number(contract.get("monthly_value"))
        if value is None:
            value = _number(contract.get("mrr"))
        if value is None:
            value = _number(contract.get("recurring_amount"))
        if value is not None:
            mrr += value
    subscriptions = await db.subscriptions.count_documents({"client_id": client_id, "status": "active"})
    devices = await db.devices.count_documents({"client_id": client_id})
    total_tickets = await db.tickets.count_documents({"client_id": client_id})
    open_tickets = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["open", "in_progress"]}})
    return {"mrr": round(mrr, 2), "subscriptions": subscriptions, "devices": devices, "total_tickets": total_tickets, "open_tickets": open_tickets, "contracts": len(contracts)}


def _health(metrics: dict, sentiment: float | None) -> float | None:
    """A small, documented score from two observed dimensions; never a default."""
    dimensions: list[float] = []
    if metrics.get("total_tickets", 0) > 0:
        dimensions.append(float(max(0, 100 - metrics["open_tickets"] * 8)))
    if sentiment is not None:
        dimensions.append(float(max(0, min(100, sentiment))))
    return round(sum(dimensions) / len(dimensions)) if len(dimensions) >= 2 else None


def _risk_label(score: float | None) -> str:
    if score is None:
        return "Not assessed"
    if score >= 75:
        return "Low"
    if score >= 55:
        return "Medium"
    return "High"


@router.get("/client-studio/{client_id}/360-context")
async def client_360(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await _client_or_404(client_id)
    metrics = await compute_client_metrics(client_id)
    sentiment = await _sentiment(client_id)
    tier = client.get("tier") or derive_tier(metrics["mrr"], metrics["subscriptions"])
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0, "id": 1, "name": 1, "device_type": 1, "status": 1, "os_name": 1, "os": 1, "cpu_usage": 1, "ram_usage": 1, "disk_usage": 1}).to_list(500)
    contracts = await db.contracts.find({"client_id": client_id}, {"_id": 0}).to_list(50)
    subscriptions = await db.subscriptions.find({"client_id": client_id}, {"_id": 0}).to_list(50)
    tickets = await db.tickets.find({"client_id": client_id, "status": {"$in": ["open", "in_progress"]}}, {"_id": 0, "id": 1, "title": 1, "status": 1, "priority": 1, "created_at": 1, "ticket_number": 1}).sort("created_at", -1).to_list(20)
    invoices = await db.invoices.find({"client_id": client_id}, {"_id": 0}).sort("issue_date", -1).to_list(20)
    stakeholders = await db.client_stakeholders.find({"client_id": client_id}, {"_id": 0}).to_list(50)
    notes = await db.client_notes.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5)
    for record in [*devices, *contracts, *subscriptions, *tickets]:
        record["tier"] = tier
    return {
        "client": {**client, "tier": tier, "health_score": _health(metrics, sentiment), "health_evidence_state": "assessed" if _health(metrics, sentiment) is not None else "not_assessed", "mrr": metrics["mrr"], "arr": metrics["mrr"] * 12, "device_count": metrics["devices"], "open_ticket_count": metrics["open_tickets"], "subscription_count": metrics["subscriptions"], "contract_count": metrics["contracts"], "sentiment": sentiment, "vip": bool(client.get("vip"))},
        "devices": devices, "contracts": contracts, "subscriptions": subscriptions, "open_tickets": tickets,
        "invoices": invoices, "stakeholders": stakeholders, "recent_notes": notes,
    }


@router.get("/client-studio/universe")
async def universe(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0}).to_list(500)
    nodes, industries = [], set()
    for client in clients:
        metrics = await compute_client_metrics(client["id"])
        sentiment = await _sentiment(client["id"])
        industry = client.get("industry") or "other"
        industries.add(industry)
        nodes.append({"id": client["id"], "name": client.get("name", "Client"), "industry": industry, "tier": client.get("tier") or derive_tier(metrics["mrr"], metrics["subscriptions"]), "mrr": metrics["mrr"], "devices": metrics["devices"], "open_tickets": metrics["open_tickets"], "sentiment": sentiment, "health": _health(metrics, sentiment), "vip": bool(client.get("vip"))})
    return {"nodes": nodes, "industries": sorted(industries)}


@router.get("/client-studio/pulse")
async def pulse_wall(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0}).to_list(500)
    tiles = []
    for client in clients:
        metrics = await compute_client_metrics(client["id"])
        sentiment = await _sentiment(client["id"])
        snapshots = await db.health_snapshots_client.find({"client_id": client["id"], "health_score": {"$type": "number"}}, {"_id": 0, "health_score": 1}).sort("date", -1).limit(12).to_list(12)
        tiles.append({"id": client["id"], "name": client.get("name", "Client"), "industry": client.get("industry") or "other", "tier": client.get("tier") or derive_tier(metrics["mrr"], metrics["subscriptions"]), "vip": bool(client.get("vip")), "mrr": metrics["mrr"], "devices": metrics["devices"], "open_tickets": metrics["open_tickets"], "sentiment": sentiment, "health": _health(metrics, sentiment), "spark_health": [row["health_score"] for row in reversed(snapshots) if isinstance(row.get("health_score"), (int, float))], "spark_tickets": []})
    tiles.sort(key=lambda item: (-int(item["vip"]), -item["mrr"]))
    return {"tiles": tiles, "total": len(tiles)}


@router.get("/client-studio/my-accounts")
async def my_accounts(current_user: dict = Depends(get_current_user)):
    identifier = current_user.get("id") or current_user.get("email")
    rows = await db.clients.find({"$or": [{"assigned_to": identifier}, {"account_manager_id": identifier}, {"owner_id": identifier}]}, {"_id": 0}).to_list(200)
    accounts = []
    for client in rows:
        metrics = await compute_client_metrics(client["id"])
        sentiment = await _sentiment(client["id"])
        alerts = []
        if metrics["open_tickets"] > 5:
            alerts.append({"kind": "tickets", "msg": f"{metrics['open_tickets']} open tickets"})
        if sentiment is not None and sentiment < 60:
            alerts.append({"kind": "sentiment", "msg": "Recorded sentiment is below 60"})
        accounts.append({"id": client["id"], "name": client.get("name", "Client"), "tier": client.get("tier") or derive_tier(metrics["mrr"], metrics["subscriptions"]), "mrr": metrics["mrr"], "health": _health(metrics, sentiment), "vip": bool(client.get("vip")), "alerts": alerts})
    return {"accounts": sorted(accounts, key=lambda item: (-len(item["alerts"]), -item["mrr"])), "count": len(accounts)}


@router.get("/client-studio/renewal-watch")
async def renewal_watch(current_user: dict = Depends(get_current_user)):
    now, horizon = datetime.now(timezone.utc), datetime.now(timezone.utc) + timedelta(days=90)
    contracts = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(500)
    watch = []
    for contract in contracts:
        renewal = _date(contract.get("renewal_date") or contract.get("end_date"))
        if not renewal or renewal < now or renewal > horizon:
            continue
        client = await db.clients.find_one({"id": contract.get("client_id")}, {"_id": 0})
        if not client:
            continue
        metrics = await compute_client_metrics(client["id"])
        sentiment = await _sentiment(client["id"])
        signals = []
        if sentiment is not None and sentiment < 60:
            signals.append("Recorded sentiment is below 60")
        if metrics["open_tickets"] > 8:
            signals.append(f"{metrics['open_tickets']} open tickets")
        days = (renewal - now).days
        risk = "high" if signals else "medium" if days < 30 else "low"
        watch.append({"client_id": client["id"], "client_name": client.get("name", "Client"), "contract_id": contract.get("id"), "value": _number(contract.get("monthly_value")) or _number(contract.get("mrr")) or _number(contract.get("recurring_amount")) or 0, "renewal_date": renewal.strftime("%Y-%m-%d"), "days_to_renewal": days, "risk_signals": signals, "risk_level": risk, "suggested_action": "Review recorded risk signals" if signals else "Prepare renewal review"})
    return {"at_risk": sorted(watch, key=lambda item: (item["risk_level"] != "high", item["days_to_renewal"]))}


@router.get("/client-studio/{client_id}/expansion")
async def expansion(client_id: str, current_user: dict = Depends(get_current_user)):
    await _client_or_404(client_id)
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0, "device_type": 1}).to_list(500)
    subscriptions = await db.subscriptions.find({"client_id": client_id, "status": "active"}, {"_id": 0, "product_name": 1, "name": 1}).to_list(100)
    names = " ".join((row.get("product_name") or row.get("name") or "").lower() for row in subscriptions)
    endpoints = sum(1 for device in devices if device.get("device_type") in {"workstation", "laptop", "server"})
    servers = sum(1 for device in devices if device.get("device_type") == "server")
    opportunities = []
    if endpoints and "endpoint security" not in names:
        opportunities.append({"id": "coverage-endpoint-security", "title": "Review endpoint-security coverage", "reason": f"{endpoints} recorded endpoints and no matching active subscription were found.", "arr_uplift": None, "confidence": None, "icon": "security", "pricing_state": "requires_rate_card"})
    if endpoints and "backup" not in names:
        opportunities.append({"id": "coverage-backup", "title": "Review backup coverage", "reason": f"{endpoints} recorded endpoints and no matching active subscription were found.", "arr_uplift": None, "confidence": None, "icon": "backup", "pricing_state": "requires_rate_card"})
    if servers and "vulnerability" not in names:
        opportunities.append({"id": "coverage-vulnerability", "title": "Review server vulnerability coverage", "reason": f"{servers} recorded servers and no matching active subscription were found.", "arr_uplift": None, "confidence": None, "icon": "assessment", "pricing_state": "requires_rate_card"})
    return {"opportunities": opportunities, "total_arr_uplift": None, "evidence_state": "subscription_coverage_comparison"}


@router.get("/client-studio/{client_id}/renewal-forecast")
async def renewal_forecast(client_id: str, current_user: dict = Depends(get_current_user)):
    await _client_or_404(client_id)
    metrics = await compute_client_metrics(client_id)
    sentiment = await _sentiment(client_id)
    reasoning = []
    if sentiment is not None:
        reasoning.append(f"Recorded sentiment: {sentiment:g}/100")
    else:
        reasoning.append("No verified sentiment source is connected")
    reasoning.append(f"Open tickets: {metrics['open_tickets']}")
    return {"probability": None, "reasoning": reasoning, "verdict": "Not assessed", "evidence_state": "insufficient_renewal_history"}


@router.get("/client-studio/{client_id}/account-briefing")
async def account_briefing(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await _client_or_404(client_id)
    metrics = await compute_client_metrics(client_id)
    sentiment = await _sentiment(client_id)
    tier = client.get("tier") or derive_tier(metrics["mrr"], metrics["subscriptions"])
    recent = await db.tickets.find({"client_id": client_id}, {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "created_at": 1}).sort("created_at", -1).limit(1).to_list(1)
    briefing = [f"Tier: {tier.title()} | Recorded MRR: ${metrics['mrr']:,.0f}", f"Devices: {metrics['devices']} | Active subscriptions: {metrics['subscriptions']} | Open tickets: {metrics['open_tickets']}", f"Sentiment: {sentiment:g}/100" if sentiment is not None else "Sentiment: not assessed"]
    if recent:
        ticket = recent[0]
        briefing.append(f"Latest ticket: #{ticket.get('ticket_number') or ticket.get('id', '')} - {ticket.get('title') or 'Untitled'}")
    if client.get("vip"):
        briefing.append("VIP flag is enabled")
    return {"briefing": briefing, "summary": f"{client.get('name', 'Client')} has ${metrics['mrr']:,.0f} recorded MRR, {metrics['devices']} devices, and {metrics['open_tickets']} open tickets."}


@router.get("/client-studio/{client_id}/account-plan")
async def get_account_plan(client_id: str, current_user: dict = Depends(get_current_user)):
    return await db.client_account_plans.find_one({"client_id": client_id}, {"_id": 0}) or {"client_id": client_id, "goals": [], "risks": [], "opportunities": [], "people": [], "next_actions": []}


@router.post("/client-studio/{client_id}/account-plan")
async def save_account_plan(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await _client_or_404(client_id)
    payload = {**(data or {}), "client_id": client_id, "updated_at": _now(), "updated_by": current_user.get("name") or current_user.get("email") or current_user.get("id", "")}
    await db.client_account_plans.update_one({"client_id": client_id}, {"$set": payload}, upsert=True)
    return {"saved": True, "updated_at": payload["updated_at"]}


@router.post("/client-studio/{client_id}/account-plan/generate")
async def generate_account_plan(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await _client_or_404(client_id)
    metrics = await compute_client_metrics(client_id)
    coverage = await expansion(client_id, current_user)
    plan = {"client_id": client_id, "goals": ["Confirm documented commercial and service objectives", "Review open service work with the client"], "risks": [f"{metrics['open_tickets']} open tickets" if metrics["open_tickets"] else "No open tickets are recorded", "No verified renewal prediction is available"], "opportunities": [{"title": item["title"], "value": None} for item in coverage["opportunities"]], "people": [], "next_actions": ["Schedule a client review", "Confirm the primary decision maker", "Price any approved coverage gaps from the rate card"], "updated_at": _now(), "updated_by": current_user.get("name") or current_user.get("email") or current_user.get("id", ""), "generation_mode": "evidence_seed", "generated_by_ai": False, "client_name": client.get("name", "Client")}
    await db.client_account_plans.update_one({"client_id": client_id}, {"$set": plan}, upsert=True)
    return plan


@router.get("/client-studio/{client_id}/stakeholders")
async def list_stakeholders(client_id: str, current_user: dict = Depends(get_current_user)):
    return await db.client_stakeholders.find({"client_id": client_id}, {"_id": 0}).to_list(100)


@router.post("/client-studio/{client_id}/stakeholders")
async def create_stakeholder(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await _client_or_404(client_id)
    if not str((data or {}).get("name") or "").strip():
        raise HTTPException(status_code=400, detail="name required")
    strength = max(0, min(100, int(data.get("relationship_strength", 50))))
    sentiment = _number(data.get("sentiment"))
    stakeholder = {"id": str(uuid.uuid4()), "client_id": client_id, "name": str(data["name"]).strip(), "title": data.get("title", ""), "email": data.get("email", ""), "phone": data.get("phone", ""), "role": data.get("role", "influencer"), "relationship_strength": strength, "sentiment": sentiment, "notes": data.get("notes", ""), "source": "manual", "created_at": _now(), "created_by": current_user.get("name") or current_user.get("email") or current_user.get("id", "")}
    await db.client_stakeholders.insert_one(stakeholder)
    return stakeholder


@router.put("/client-studio/stakeholders/{sid}")
async def update_stakeholder(sid: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {key: value for key, value in (data or {}).items() if key in {"name", "title", "email", "phone", "role", "relationship_strength", "sentiment", "notes"}}
    if "relationship_strength" in allowed:
        allowed["relationship_strength"] = max(0, min(100, int(allowed["relationship_strength"])))
    if "sentiment" in allowed:
        allowed["sentiment"] = _number(allowed["sentiment"])
    allowed.update({"updated_at": _now(), "updated_by": current_user.get("name") or current_user.get("email") or current_user.get("id", "")})
    result = await db.client_stakeholders.update_one({"id": sid}, {"$set": allowed})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Stakeholder not found")
    return {"updated": True}


@router.delete("/client-studio/stakeholders/{sid}")
async def delete_stakeholder(sid: str, current_user: dict = Depends(get_current_user)):
    result = await db.client_stakeholders.delete_one({"id": sid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Stakeholder not found")
    return {"deleted": True}


@router.get("/client-studio/{client_id}/achievements")
async def achievements(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await _client_or_404(client_id)
    achievements_list = []
    created = _date(client.get("created_at"))
    if created:
        years = (datetime.now(timezone.utc) - created).days // 365
        if years >= 1:
            achievements_list.append({"id": "anniversary", "title": f"{years} year anniversary", "icon": "\\U0001F389", "earned_at": (created + timedelta(days=365 * years)).isoformat()})
    closed = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["closed", "resolved"]}})
    if closed >= 100:
        achievements_list.append({"id": "resolved-100", "title": "100+ tickets resolved", "icon": "\\U0001F3C6"})
    devices = await db.devices.count_documents({"client_id": client_id})
    if devices >= 50:
        achievements_list.append({"id": "fleet-50", "title": f"{devices}-device fleet", "icon": "\\U0001F5A5"})
    if client.get("vip"):
        achievements_list.append({"id": "vip", "title": "VIP account", "icon": "\\u2B50"})
    return {"achievements": achievements_list}


@router.get("/client-studio/{client_id}/lifecycle")
async def lifecycle(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await _client_or_404(client_id)
    milestones = []
    if client.get("created_at"):
        milestones.append({"id": "account-created", "label": "Account created", "icon": "\\U0001F331", "at": client["created_at"]})
    first_ticket = await db.tickets.find_one({"client_id": client_id}, {"_id": 0}, sort=[("created_at", 1)])
    if first_ticket:
        milestones.append({"id": "first-ticket", "label": "First ticket logged", "icon": "\\U0001F3AB", "at": first_ticket.get("created_at")})
    first_invoice = await db.invoices.find_one({"client_id": client_id}, {"_id": 0}, sort=[("issue_date", 1)])
    if first_invoice:
        milestones.append({"id": "first-invoice", "label": "First invoice issued", "icon": "\\U0001F9FE", "at": first_invoice.get("issue_date")})
    contract = await db.contracts.find_one({"client_id": client_id, "status": "active"}, {"_id": 0})
    if contract:
        milestones.append({"id": "active-contract", "label": "Active contract", "icon": "\\U0001F4C4", "at": contract.get("start_date") or contract.get("created_at")})
        renewal = contract.get("renewal_date") or contract.get("end_date")
        if renewal:
            milestones.append({"id": "contract-renewal", "label": "Recorded contract renewal", "icon": "\\U0001F504", "at": renewal, "future": True})
    return {"milestones": sorted(milestones, key=lambda item: item.get("at") or "")}


@router.get("/client-studio/{client_id}/churn-radar")
async def churn_radar(client_id: str, current_user: dict = Depends(get_current_user)):
    await _client_or_404(client_id)
    metrics = await compute_client_metrics(client_id)
    sentiment = await _sentiment(client_id)
    axes = []
    if sentiment is not None:
        axes.append({"axis": "Sentiment", "value": sentiment, "source": "recorded_sentiment"})
    if metrics["total_tickets"]:
        axes.append({"axis": "Ticket calm", "value": max(0, 100 - metrics["open_tickets"] * 8), "source": "recorded_tickets"})
    overall = round(sum(axis["value"] for axis in axes) / len(axes)) if len(axes) >= 2 else None
    return {"axes": axes, "overall_health": overall, "risk_label": _risk_label(overall), "evidence_state": "assessed" if overall is not None else "not_assessed"}


@router.get("/client-studio/{client_id}/activity-heatmap")
async def activity_heatmap(client_id: str, days: int = 90, current_user: dict = Depends(get_current_user)):
    days = max(1, min(days, 365))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    buckets: dict[str, int] = {}
    async for ticket in db.tickets.find({"client_id": client_id, "created_at": {"$gte": cutoff.isoformat()}}, {"_id": 0, "created_at": 1}):
        stamp = str(ticket.get("created_at") or "")[:10]
        if stamp:
            buckets[stamp] = buckets.get(stamp, 0) + 1
    today = datetime.now(timezone.utc)
    values = [{"date": (today - timedelta(days=days - 1 - index)).strftime("%Y-%m-%d"), "count": buckets.get((today - timedelta(days=days - 1 - index)).strftime("%Y-%m-%d"), 0)} for index in range(days)]
    return {"days": values, "max": max((item["count"] for item in values), default=0), "evidence_state": "recorded_tickets"}


@router.get("/client-studio/{client_id}/hours-burndown")
async def hours_burndown(client_id: str, current_user: dict = Depends(get_current_user)):
    contract = await db.contracts.find_one({"client_id": client_id, "status": "active", "$or": [{"type": "retainer"}, {"hours_block": {"$gt": 0}}]}, {"_id": 0})
    purchased = _number((contract or {}).get("hours_block"))
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    daily_map: dict[str, float] = {}
    async for entry in db.time_entries.find({"client_id": client_id, "started_at": {"$gte": cutoff.isoformat()}, "billable": True}, {"_id": 0, "started_at": 1, "minutes": 1, "hours": 1}):
        stamp = str(entry.get("started_at") or "")[:10]
        hours = _number(entry.get("hours"))
        if hours is None:
            minutes = _number(entry.get("minutes"))
            hours = minutes / 60 if minutes is not None else None
        if stamp and hours is not None:
            daily_map[stamp] = daily_map.get(stamp, 0) + hours
    daily = [{"date": (datetime.now(timezone.utc) - timedelta(days=29 - index)).strftime("%Y-%m-%d"), "hours": round(daily_map.get((datetime.now(timezone.utc) - timedelta(days=29 - index)).strftime("%Y-%m-%d"), 0), 1)} for index in range(30)]
    used = round(sum(item["hours"] for item in daily), 1)
    return {"purchased": purchased, "used": used if purchased is not None else None, "remaining": round(max(0, purchased - used), 1) if purchased is not None else None, "pct": round(used / purchased * 100, 1) if purchased and purchased > 0 else None, "daily": daily, "evidence_state": "assessed" if purchased is not None else "not_configured"}


@router.get("/client-studio/{client_id}/contracts")
async def contract_watch(client_id: str, current_user: dict = Depends(get_current_user)):
    contracts = await db.contracts.find({"client_id": client_id}, {"_id": 0}).to_list(50)
    now = datetime.now(timezone.utc)
    values = []
    for contract in contracts:
        renewal = _date(contract.get("renewal_date") or contract.get("end_date"))
        values.append({**contract, "days_to_renewal": (renewal - now).days if renewal else None})
    return {"contracts": sorted(values, key=lambda item: item["days_to_renewal"] if item["days_to_renewal"] is not None else 999999)}


@router.get("/client-studio/{client_id}/scorecard")
async def scorecard(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await _client_or_404(client_id)
    metrics = await compute_client_metrics(client_id)
    sentiment = await _sentiment(client_id)
    health = _health(metrics, sentiment)
    closed = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["closed", "resolved"]}})
    return {"client_id": client_id, "client_name": client.get("name", "Client"), "generated_at": _now(), "metrics": [{"label": "Health Score", "value": f"{health}/100" if health is not None else "Not assessed"}, {"label": "Recorded MRR", "value": f"${metrics['mrr']:,.0f}"}, {"label": "Active Devices", "value": metrics["devices"]}, {"label": "Open Tickets", "value": metrics["open_tickets"]}, {"label": "Resolved Tickets", "value": closed}, {"label": "Sentiment", "value": f"{sentiment:g}/100" if sentiment is not None else "Not assessed"}, {"label": "Subscriptions", "value": metrics["subscriptions"]}]}


@router.get("/client-studio/{client_id}/compliance")
async def compliance(client_id: str, current_user: dict = Depends(get_current_user)):
    scans = await db.compliance_reports.find({"client_id": client_id}, {"_id": 0}).sort("scanned_at", -1).to_list(200)
    latest: dict[str, dict] = {}
    for scan in scans:
        framework = str(scan.get("framework_name") or scan.get("framework") or "")
        if framework and framework not in latest:
            latest[framework] = scan
    frameworks = [{"name": name, "score": scan.get("score") if isinstance(scan.get("score"), (int, float)) else None, "icon": "compliance", "evidence_state": scan.get("evidence_state", "not_assessed"), "scanned_at": scan.get("scanned_at")} for name, scan in latest.items()]
    numeric_scores = [row["score"] for row in frameworks if isinstance(row.get("score"), (int, float))]
    return {"frameworks": frameworks, "overall_score": round(sum(numeric_scores) / len(numeric_scores)) if numeric_scores else None, "evidence_state": "assessed" if numeric_scores else "not_assessed"}


@router.post("/client-studio/{client_id}/vip")
async def toggle_vip(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.clients.update_one({"id": client_id}, {"$set": {"vip": bool((data or {}).get("vip")), "updated_at": _now(), "updated_by": current_user.get("name") or current_user.get("email") or current_user.get("id", "")}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"id": client_id, "vip": bool((data or {}).get("vip"))}


@router.post("/client-studio/recompute-tiers")
async def recompute_tiers(current_user: dict = Depends(get_current_user)):
    """Record suggested tiers without overwriting a technician-managed client type."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1}).to_list(2000)
    updated = 0
    for client in clients:
        metrics = await compute_client_metrics(client["id"])
        result = await db.clients.update_one({"id": client["id"]}, {"$set": {"computed_tier": derive_tier(metrics["mrr"], metrics["subscriptions"]), "tier_recomputed_at": _now()}})
        updated += int(bool(getattr(result, "matched_count", 0)))
    return {"updated": updated, "total": len(clients), "mode": "suggested_tier_only"}
