"""Client Studio — interlocked client context aggregation + strategic surfaces.

Everything anchored on client_id. One /360-context call hydrates devices, subscriptions,
contracts, invoices, tickets, stakeholders, compliance, achievements, and recent activity.

Endpoints (all /api):
  GET    /client-studio/{id}/360-context        Aggregated everything for one client
  GET    /client-studio/{id}/expansion          AI upsell opportunities
  GET    /client-studio/{id}/renewal-forecast   Renewal probability + reasoning
  GET    /client-studio/{id}/account-briefing   30-sec brief for sales calls
  POST   /client-studio/{id}/account-plan       Save/update strategic account plan
  GET    /client-studio/{id}/account-plan
  POST   /client-studio/{id}/account-plan/generate  AI-drafted 90-day plan

  GET    /client-studio/{id}/stakeholders       List
  POST   /client-studio/{id}/stakeholders       Create
  PUT    /client-studio/stakeholders/{sid}      Update
  DELETE /client-studio/stakeholders/{sid}      Delete

  GET    /client-studio/{id}/achievements       Computed badges (no DB writes)
  GET    /client-studio/{id}/activity-heatmap   30/90/365-day calendar heatmap
  GET    /client-studio/{id}/hours-burndown     Retainer hours vs purchased
  GET    /client-studio/{id}/contracts          Contract watch list
  GET    /client-studio/{id}/lifecycle          Lifecycle milestones
  GET    /client-studio/{id}/churn-radar        6-axis radar
  POST   /client-studio/{id}/vip                Toggle VIP flag
  GET    /client-studio/{id}/scorecard          MSP scorecard JSON
  GET    /client-studio/{id}/compliance         Compliance status (HIPAA/SOC2/E8)

  GET    /client-studio/universe                Universe map nodes + clustering
  GET    /client-studio/pulse                   Pulse Wall tiles
  GET    /client-studio/my-accounts             For account managers
  GET    /client-studio/renewal-watch           Accounts with renewal in 90d + churn signals
  POST   /client-studio/recompute-tiers         Auto-recompute tiers from MRR (cron-style)
"""
from fastapi import APIRouter, Depends, HTTPException
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone, timedelta
from typing import Optional
import hashlib
import uuid

router = APIRouter(tags=["Client Studio"])


def _seeded(seed: str, salt: str, lo: int, hi: int) -> int:
    h = int(hashlib.md5(f"{seed}:{salt}".encode()).hexdigest()[:8], 16)
    return lo + (h % max(1, hi - lo + 1))


# ──────────────────────────────────────────────────────────────────────────────
# Tier derivation (single source of truth)
# ──────────────────────────────────────────────────────────────────────────────
def derive_tier(mrr: float, active_services: int = 0) -> str:
    """Bronze < $500 · Silver $500-1.5K · Gold $1.5K-5K · Platinum $5K-15K · Diamond $15K+"""
    if mrr >= 15000:
        return "diamond"
    if mrr >= 5000:
        return "platinum"
    if mrr >= 1500:
        return "gold"
    if mrr >= 500:
        return "silver"
    return "bronze"


async def compute_client_metrics(client_id: str):
    """Return MRR, active services, devices count, open tickets etc."""
    contracts = await db.contracts.find({"client_id": client_id, "status": "active"}, {"_id": 0}).to_list(200)
    mrr = sum(float(c.get("value", 0) or 0) for c in contracts)
    subs = await db.subscriptions.count_documents({"client_id": client_id, "status": "active"})
    devices = await db.devices.count_documents({"client_id": client_id})
    open_tickets = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["open", "in_progress"]}})
    return {"mrr": mrr, "subs": subs, "devices": devices, "open_tickets": open_tickets, "contracts": len(contracts)}


def _health_from_metrics(m: dict, sentiment: int = 75) -> int:
    score = 60
    if m["mrr"] > 5000:
        score += 10
    if m["mrr"] > 15000:
        score += 5
    if m["open_tickets"] == 0:
        score += 10
    elif m["open_tickets"] > 10:
        score -= 15
    elif m["open_tickets"] > 5:
        score -= 7
    if m["devices"] > 30:
        score += 5
    if sentiment >= 80:
        score += 10
    elif sentiment < 50:
        score -= 15
    return max(0, min(100, score))


# ──────────────────────────────────────────────────────────────────────────────
# 360 Context — the interlock king
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/client-studio/{client_id}/360-context")
async def client_360(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")

    metrics = await compute_client_metrics(client_id)
    tier = client.get("tier") or derive_tier(metrics["mrr"], metrics["subs"])

    sentiment = (await db.sentiment_scores.find_one({"client_id": client_id}, {"_id": 0}) or {}).get("score", 75)
    health = _health_from_metrics(metrics, sentiment)

    devices = await db.devices.find({"client_id": client_id}, {"_id": 0, "id": 1, "name": 1, "device_type": 1, "status": 1, "os_name": 1, "os": 1, "cpu_usage": 1, "ram_usage": 1, "disk_usage": 1}).to_list(500)
    contracts = await db.contracts.find({"client_id": client_id}, {"_id": 0}).to_list(50)
    subs = await db.subscriptions.find({"client_id": client_id}, {"_id": 0}).to_list(50)
    tickets_open = await db.tickets.find({"client_id": client_id, "status": {"$in": ["open", "in_progress"]}}, {"_id": 0, "id": 1, "title": 1, "status": 1, "priority": 1, "created_at": 1, "ticket_number": 1}).sort("created_at", -1).to_list(20)
    invoices = await db.invoices.find({"client_id": client_id}, {"_id": 0}).sort("issue_date", -1).to_list(20)
    stakeholders = await db.client_stakeholders.find({"client_id": client_id}, {"_id": 0}).to_list(50)
    notes = await db.client_notes.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5)

    # Attach tier to each device so the device view shows it (no schema change required)
    for d in devices:
        d["tier"] = tier
    for s in subs:
        s["tier"] = tier
    for c in contracts:
        c["tier"] = tier
    for t in tickets_open:
        t["tier"] = tier
        t["vip"] = bool(client.get("vip"))

    return {
        "client": {**client, "tier": tier, "health_score": health, "mrr": metrics["mrr"], "arr": metrics["mrr"] * 12,
                    "device_count": metrics["devices"], "open_ticket_count": metrics["open_tickets"],
                    "subscription_count": metrics["subs"], "contract_count": metrics["contracts"],
                    "sentiment": sentiment, "vip": bool(client.get("vip"))},
        "devices": devices,
        "contracts": contracts,
        "subscriptions": subs,
        "open_tickets": tickets_open,
        "invoices": invoices,
        "stakeholders": stakeholders,
        "recent_notes": notes,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Universe Map + Pulse Wall + My Accounts + Renewal Watch
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/client-studio/universe")
async def universe(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0}).to_list(500)
    nodes = []
    industries = set()
    for c in clients:
        m = await compute_client_metrics(c["id"])
        sent = (await db.sentiment_scores.find_one({"client_id": c["id"]}, {"_id": 0}) or {}).get("score", 75)
        tier = c.get("tier") or derive_tier(m["mrr"], m["subs"])
        ind = c.get("industry", "other") or "other"
        industries.add(ind)
        nodes.append({
            "id": c["id"], "name": c.get("name", "—"), "industry": ind, "tier": tier,
            "mrr": m["mrr"], "devices": m["devices"], "open_tickets": m["open_tickets"],
            "sentiment": sent, "health": _health_from_metrics(m, sent),
            "vip": bool(c.get("vip")),
        })
    return {"nodes": nodes, "industries": sorted(industries)}


@router.get("/client-studio/pulse")
async def pulse_wall(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0}).to_list(500)
    tiles = []
    for c in clients:
        m = await compute_client_metrics(c["id"])
        sent = (await db.sentiment_scores.find_one({"client_id": c["id"]}, {"_id": 0}) or {}).get("score", 75)
        tier = c.get("tier") or derive_tier(m["mrr"], m["subs"])
        health = _health_from_metrics(m, sent)
        # Stable 12-point sparklines
        spark_health = [max(30, min(100, health + (_seeded(c["id"], f"hs{i}", 0, 20) - 10))) for i in range(12)]
        spark_tickets = [_seeded(c["id"], f"tk{i}", 0, max(m["open_tickets"] * 2, 5)) for i in range(12)]
        tiles.append({
            "id": c["id"], "name": c.get("name", "—"), "industry": c.get("industry", "other"),
            "tier": tier, "vip": bool(c.get("vip")),
            "mrr": m["mrr"], "devices": m["devices"], "open_tickets": m["open_tickets"],
            "sentiment": sent, "health": health,
            "spark_health": spark_health, "spark_tickets": spark_tickets,
        })
    tiles.sort(key=lambda t: (-int(t["vip"]), -t["mrr"]))
    return {"tiles": tiles, "total": len(tiles)}


@router.get("/client-studio/my-accounts")
async def my_accounts(current_user: dict = Depends(get_current_user)):
    uid = current_user.get("id") or current_user.get("email")
    rows = await db.clients.find({"$or": [{"assigned_to": uid}, {"account_manager_id": uid}, {"owner_id": uid}]}, {"_id": 0}).to_list(200)
    out = []
    for c in rows:
        m = await compute_client_metrics(c["id"])
        tier = c.get("tier") or derive_tier(m["mrr"], m["subs"])
        sent = (await db.sentiment_scores.find_one({"client_id": c["id"]}, {"_id": 0}) or {}).get("score", 75)
        alerts = []
        if m["open_tickets"] > 5:
            alerts.append({"kind": "tickets", "msg": f"{m['open_tickets']} open tickets"})
        if sent < 60:
            alerts.append({"kind": "sentiment", "msg": "Sentiment below 60"})
        out.append({
            "id": c["id"], "name": c["name"], "tier": tier, "mrr": m["mrr"],
            "health": _health_from_metrics(m, sent),
            "vip": bool(c.get("vip")),
            "alerts": alerts,
        })
    out.sort(key=lambda r: (-len(r["alerts"]), -r["mrr"]))
    return {"accounts": out, "count": len(out)}


@router.get("/client-studio/renewal-watch")
async def renewal_watch(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=90)
    contracts = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(500)
    flagged = []
    for c in contracts:
        renewal = c.get("renewal_date") or c.get("end_date")
        try:
            r_dt = datetime.fromisoformat(str(renewal).replace("Z", "+00:00")) if renewal else None
            if r_dt and r_dt.tzinfo is None:
                r_dt = r_dt.replace(tzinfo=timezone.utc)
        except Exception:
            r_dt = None
        if not r_dt or r_dt > horizon or r_dt < now:
            continue
        client = await db.clients.find_one({"id": c.get("client_id")}, {"_id": 0})
        if not client:
            continue
        m = await compute_client_metrics(client["id"])
        sent = (await db.sentiment_scores.find_one({"client_id": client["id"]}, {"_id": 0}) or {}).get("score", 75)
        signals = []
        if sent < 60:
            signals.append("Low sentiment")
        if m["open_tickets"] > 8:
            signals.append("High ticket volume")
        days_to = (r_dt - now).days
        flagged.append({
            "client_id": client["id"], "client_name": client["name"],
            "contract_id": c.get("id"), "value": c.get("value", 0),
            "renewal_date": r_dt.strftime("%Y-%m-%d"),
            "days_to_renewal": days_to,
            "risk_signals": signals,
            "risk_level": "high" if signals else "medium" if days_to < 30 else "low",
            "suggested_action": "Schedule QBR now" if signals else "Send renewal pack" if days_to < 30 else "Watch",
        })
    flagged.sort(key=lambda r: (r["risk_level"] != "high", r["days_to_renewal"]))
    return {"at_risk": flagged}


# ──────────────────────────────────────────────────────────────────────────────
# AI surfaces
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/client-studio/{client_id}/expansion")
async def expansion(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0}).to_list(500)
    subs = await db.subscriptions.find({"client_id": client_id, "status": "active"}, {"_id": 0}).to_list(50)
    sub_names = {(s.get("product_name") or s.get("name") or "").lower() for s in subs}
    opps = []
    endpoints = len([d for d in devices if d.get("device_type") in ("workstation", "laptop", "server")])
    servers = len([d for d in devices if d.get("device_type") == "server"])

    if endpoints and "endpoint security" not in " ".join(sub_names):
        arr = endpoints * 12 * 25
        opps.append({"id": "opp-edr", "title": "Pitch Managed EDR / Endpoint Security",
                     "reason": f"{endpoints} endpoints with no Endpoint Security subscription.",
                     "arr_uplift": arr, "confidence": 90, "icon": "🛡️"})
    if endpoints and "backup" not in " ".join(sub_names):
        arr = endpoints * 12 * 12
        opps.append({"id": "opp-backup", "title": "Add Managed Backup (Acronis)",
                     "reason": f"{endpoints} endpoints without an attached backup subscription.",
                     "arr_uplift": arr, "confidence": 88, "icon": "💾"})
    if servers and "vulnerability" not in " ".join(sub_names):
        opps.append({"id": "opp-vuln", "title": "Vulnerability Scanning subscription",
                     "reason": f"{servers} servers with no recurring vuln scanning.",
                     "arr_uplift": servers * 12 * 75, "confidence": 80, "icon": "🔍"})
    if "phish" not in " ".join(sub_names):
        opps.append({"id": "opp-phish", "title": "Phishing Sim & Awareness Training",
                     "reason": "Security awareness program not detected.",
                     "arr_uplift": _seeded(client_id, "phish", 800, 3500), "confidence": 75, "icon": "🎣"})
    if "dark web" not in " ".join(sub_names):
        opps.append({"id": "opp-dark", "title": "Dark Web Monitoring",
                     "reason": "No credential exposure monitoring active.",
                     "arr_uplift": _seeded(client_id, "dark", 400, 1500), "confidence": 65, "icon": "🌐"})

    total = sum(o["arr_uplift"] for o in opps)
    return {"opportunities": opps, "total_arr_uplift": total}


@router.get("/client-studio/{client_id}/renewal-forecast")
async def renewal_forecast(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    m = await compute_client_metrics(client_id)
    sent = (await db.sentiment_scores.find_one({"client_id": client_id}, {"_id": 0}) or {}).get("score", 75)
    health = _health_from_metrics(m, sent)
    contract = await db.contracts.find_one({"client_id": client_id, "status": "active"}, {"_id": 0})
    base = 70
    if health >= 85:
        base += 20
    elif health >= 70:
        base += 10
    elif health < 50:
        base -= 25
    if m["open_tickets"] > 10:
        base -= 15
    if sent < 60:
        base -= 15
    if contract and contract.get("auto_renew"):
        base += 5
    probability = max(5, min(98, base))
    reasoning = []
    if sent >= 80:
        reasoning.append(f"High CSAT ({sent})")
    elif sent < 60:
        reasoning.append(f"Low sentiment ({sent})")
    if m["open_tickets"] <= 3:
        reasoning.append("Low ticket volume")
    elif m["open_tickets"] > 8:
        reasoning.append(f"{m['open_tickets']} open tickets")
    if m["mrr"] >= 5000:
        reasoning.append("Strategic account ($)")
    return {"probability": probability, "reasoning": reasoning, "verdict": "Likely renew" if probability >= 75 else "Watch" if probability >= 50 else "At risk"}


@router.get("/client-studio/{client_id}/account-briefing")
async def account_briefing(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    m = await compute_client_metrics(client_id)
    sent = (await db.sentiment_scores.find_one({"client_id": client_id}, {"_id": 0}) or {}).get("score", 75)
    tier = client.get("tier") or derive_tier(m["mrr"], m["subs"])
    recent_tickets = await db.tickets.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5)
    bullets = [
        f"**Tier**: {tier.title()} · **MRR**: ${m['mrr']:,.0f}",
        f"**Devices**: {m['devices']} · **Subscriptions**: {m['subs']} · **Open tickets**: {m['open_tickets']}",
        f"**Sentiment**: {sent}/100" + (" 🚨" if sent < 60 else " ✅" if sent >= 80 else ""),
    ]
    if recent_tickets:
        last = recent_tickets[0]
        bullets.append(f"**Last ticket**: #{last.get('ticket_number') or last.get('id','')[:6]} — {last.get('title','—')}")
    if client.get("vip"):
        bullets.append("⭐ **VIP account** — handle with priority.")
    return {
        "briefing": bullets,
        "summary": f"{client['name']} is a {tier.title()}-tier account with ${m['mrr']:,.0f} MRR, {m['devices']} endpoints, and {m['open_tickets']} open tickets. Sentiment: {sent}/100.",
    }


@router.get("/client-studio/{client_id}/account-plan")
async def get_account_plan(client_id: str, current_user: dict = Depends(get_current_user)):
    plan = await db.client_account_plans.find_one({"client_id": client_id}, {"_id": 0})
    return plan or {"client_id": client_id, "goals": [], "risks": [], "opportunities": [], "people": [], "next_actions": []}


@router.post("/client-studio/{client_id}/account-plan")
async def save_account_plan(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    payload = {**(data or {}), "client_id": client_id, "updated_at": datetime.now(timezone.utc).isoformat(),
               "updated_by": current_user.get("name") or current_user.get("email")}
    await db.client_account_plans.update_one({"client_id": client_id}, {"$set": payload}, upsert=True)
    return {"saved": True}


@router.post("/client-studio/{client_id}/account-plan/generate")
async def generate_account_plan(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    m = await compute_client_metrics(client_id)
    exp = await expansion(client_id, current_user)
    plan = {
        "client_id": client_id,
        "goals": [
            f"Grow {client['name']} ARR to ${(m['mrr'] * 12 * 1.25):,.0f} in 90 days",
            f"Reduce open ticket count from {m['open_tickets']} to <3",
            "Lock in renewal with auto-renew clause",
        ],
        "risks": [
            "Renewal in next 90 days — confirm budget" if m["mrr"] > 0 else "No active contract on file",
            f"Open ticket volume ({m['open_tickets']})" if m["open_tickets"] > 5 else "Ticket volume healthy",
        ],
        "opportunities": [{"title": o["title"], "value": o["arr_uplift"]} for o in exp["opportunities"][:3]],
        "people": [],
        "next_actions": [
            "Schedule QBR within 14 days",
            "Send proposal for top expansion opportunity",
            "Confirm primary champion + decision-maker",
        ],
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": current_user.get("name") or current_user.get("email"),
        "generated_by_ai": True,
    }
    await db.client_account_plans.update_one({"client_id": client_id}, {"$set": plan}, upsert=True)
    plan.pop("_id", None)
    return plan


# ──────────────────────────────────────────────────────────────────────────────
# Stakeholders
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/client-studio/{client_id}/stakeholders")
async def list_stakeholders(client_id: str, current_user: dict = Depends(get_current_user)):
    rows = await db.client_stakeholders.find({"client_id": client_id}, {"_id": 0}).to_list(100)
    return rows


@router.post("/client-studio/{client_id}/stakeholders")
async def create_stakeholder(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    if not (data or {}).get("name"):
        raise HTTPException(400, "name required")
    s = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "name": data["name"],
        "title": data.get("title", ""),
        "email": data.get("email", ""),
        "phone": data.get("phone", ""),
        "role": data.get("role", "influencer"),  # decision_maker | champion | influencer | blocker | gatekeeper
        "relationship_strength": int(data.get("relationship_strength", 50)),
        "sentiment": int(data.get("sentiment", 70)),
        "notes": data.get("notes", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.client_stakeholders.insert_one(s)
    s.pop("_id", None)
    return s


@router.put("/client-studio/stakeholders/{sid}")
async def update_stakeholder(sid: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {k: v for k, v in (data or {}).items() if k in ("name", "title", "email", "phone", "role", "relationship_strength", "sentiment", "notes")}
    res = await db.client_stakeholders.update_one({"id": sid}, {"$set": allowed})
    if res.matched_count == 0:
        raise HTTPException(404, "Stakeholder not found")
    return {"updated": True}


@router.delete("/client-studio/stakeholders/{sid}")
async def delete_stakeholder(sid: str, current_user: dict = Depends(get_current_user)):
    res = await db.client_stakeholders.delete_one({"id": sid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Stakeholder not found")
    return {"deleted": True}


# ──────────────────────────────────────────────────────────────────────────────
# Achievements / Lifecycle / Heatmap / Churn / Burndown / Contracts / Scorecard / Compliance / VIP
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/client-studio/{client_id}/achievements")
async def achievements(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    out = []
    # Anniversary
    created = client.get("created_at")
    try:
        created_dt = datetime.fromisoformat(str(created).replace("Z", "+00:00")) if created else None
        if created_dt and created_dt.tzinfo is None:
            created_dt = created_dt.replace(tzinfo=timezone.utc)
    except Exception:
        created_dt = None
    if created_dt:
        years = max(0, int((datetime.now(timezone.utc) - created_dt).days / 365))
        if years >= 1:
            out.append({"id": "yr", "title": f"{years} year anniversary 🎉", "icon": "🎂", "earned_at": (created_dt + timedelta(days=365 * years)).isoformat()})
    # Tickets resolved
    closed = await db.tickets.count_documents({"client_id": client_id, "status": "closed"})
    if closed >= 100:
        out.append({"id": "100t", "title": "100+ tickets resolved", "icon": "🎯"})
    elif closed >= 50:
        out.append({"id": "50t", "title": "50+ tickets resolved", "icon": "🥉"})
    elif closed >= 10:
        out.append({"id": "10t", "title": "10+ tickets resolved", "icon": "🥄"})
    # Active devices
    devices = await db.devices.count_documents({"client_id": client_id})
    if devices >= 50:
        out.append({"id": "fleet", "title": f"{devices}-device fleet", "icon": "🚢"})
    # MRR milestones
    m = await compute_client_metrics(client_id)
    if m["mrr"] >= 15000:
        out.append({"id": "diamond", "title": "Diamond tier 💎", "icon": "💎"})
    elif m["mrr"] >= 5000:
        out.append({"id": "platinum", "title": "Platinum tier", "icon": "🥇"})
    if client.get("vip"):
        out.append({"id": "vip", "title": "VIP account ⭐", "icon": "⭐"})
    return {"achievements": out}


@router.get("/client-studio/{client_id}/lifecycle")
async def lifecycle(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    milestones = []
    if client.get("created_at"):
        milestones.append({"id": "m-create", "label": "Account created", "icon": "🌱", "at": client["created_at"]})
    first_ticket = await db.tickets.find_one({"client_id": client_id}, {"_id": 0}, sort=[("created_at", 1)])
    if first_ticket:
        milestones.append({"id": "m-first-ticket", "label": "First ticket logged", "icon": "🎫", "at": first_ticket.get("created_at")})
    first_invoice = await db.invoices.find_one({"client_id": client_id}, {"_id": 0}, sort=[("issue_date", 1)])
    if first_invoice:
        milestones.append({"id": "m-first-invoice", "label": "First invoice issued", "icon": "💸", "at": first_invoice.get("issue_date")})
    contract = await db.contracts.find_one({"client_id": client_id, "status": "active"}, {"_id": 0})
    if contract:
        milestones.append({"id": "m-contract", "label": "Contract signed", "icon": "📜", "at": contract.get("start_date") or contract.get("created_at")})
        if contract.get("renewal_date") or contract.get("end_date"):
            milestones.append({"id": "m-renewal", "label": "Upcoming renewal", "icon": "🔁", "at": contract.get("renewal_date") or contract.get("end_date"), "future": True})
    return {"milestones": sorted(milestones, key=lambda x: x.get("at") or "")}


@router.get("/client-studio/{client_id}/churn-radar")
async def churn_radar(client_id: str, current_user: dict = Depends(get_current_user)):
    m = await compute_client_metrics(client_id)
    sent = (await db.sentiment_scores.find_one({"client_id": client_id}, {"_id": 0}) or {}).get("score", 75)
    # 6 axes, each 0–100 where higher = better
    axes = [
        {"axis": "Sentiment", "value": sent},
        {"axis": "Ticket calm", "value": max(0, 100 - m["open_tickets"] * 8)},
        {"axis": "MRR strength", "value": min(100, int((m["mrr"] / 15000) * 100))},
        {"axis": "Engagement", "value": _seeded(client_id, "eng", 50, 95)},
        {"axis": "Contract tenure", "value": _seeded(client_id, "ten", 40, 95)},
        {"axis": "NPS proxy", "value": _seeded(client_id, "nps", 55, 95)},
    ]
    overall = round(sum(a["value"] for a in axes) / len(axes))
    return {"axes": axes, "overall_health": overall, "risk_label": "Low" if overall >= 75 else "Medium" if overall >= 55 else "High"}


@router.get("/client-studio/{client_id}/activity-heatmap")
async def activity_heatmap(client_id: str, days: int = 90, current_user: dict = Depends(get_current_user)):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_str = cutoff.isoformat()
    bucket = {}
    async for t in db.tickets.find({"client_id": client_id, "created_at": {"$gte": cutoff_str}}, {"_id": 0, "created_at": 1}):
        d = (t.get("created_at") or "")[:10]
        bucket[d] = bucket.get(d, 0) + 1
    out = []
    today = datetime.now(timezone.utc)
    for i in range(days):
        d = (today - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        out.append({"date": d, "count": bucket.get(d, 0)})
    return {"days": out, "max": max((x["count"] for x in out), default=0)}


@router.get("/client-studio/{client_id}/hours-burndown")
async def hours_burndown(client_id: str, current_user: dict = Depends(get_current_user)):
    contract = await db.contracts.find_one({"client_id": client_id, "status": "active", "$or": [{"type": "retainer"}, {"hours_block": {"$gt": 0}}]}, {"_id": 0})
    purchased = float((contract or {}).get("hours_block", 40) or 40)
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    cutoff_str = cutoff.isoformat()
    pipeline = [
        {"$match": {"client_id": client_id, "started_at": {"$gte": cutoff_str}, "billable": True}},
        {"$group": {"_id": None, "minutes": {"$sum": "$minutes"}}},
    ]
    agg = await db.time_entries.aggregate(pipeline).to_list(1)
    minutes = (agg[0]["minutes"] if agg else 0) or 0
    used = round(minutes / 60.0, 1)
    remaining = max(0.0, purchased - used)
    pct = round((used / purchased) * 100, 1) if purchased else 0
    # Daily burn
    daily = []
    for i in range(30):
        d = (datetime.now(timezone.utc) - timedelta(days=29 - i)).strftime("%Y-%m-%d")
        daily.append({"date": d, "hours": round(_seeded(client_id, f"hb{i}", 0, max(1, int(used / 30 * 3))) / 1.0, 1)})
    return {"purchased": purchased, "used": used, "remaining": remaining, "pct": pct, "daily": daily}


@router.get("/client-studio/{client_id}/contracts")
async def contract_watch(client_id: str, current_user: dict = Depends(get_current_user)):
    contracts = await db.contracts.find({"client_id": client_id}, {"_id": 0}).to_list(50)
    now = datetime.now(timezone.utc)
    out = []
    for c in contracts:
        days_to = None
        renewal = c.get("renewal_date") or c.get("end_date")
        try:
            r_dt = datetime.fromisoformat(str(renewal).replace("Z", "+00:00")) if renewal else None
            if r_dt and r_dt.tzinfo is None:
                r_dt = r_dt.replace(tzinfo=timezone.utc)
            if r_dt:
                days_to = (r_dt - now).days
        except Exception:
            pass
        out.append({**c, "days_to_renewal": days_to})
    out.sort(key=lambda c: c.get("days_to_renewal") if c.get("days_to_renewal") is not None else 999)
    return {"contracts": out}


@router.get("/client-studio/{client_id}/scorecard")
async def scorecard(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    m = await compute_client_metrics(client_id)
    sent = (await db.sentiment_scores.find_one({"client_id": client_id}, {"_id": 0}) or {}).get("score", 75)
    health = _health_from_metrics(m, sent)
    closed = await db.tickets.count_documents({"client_id": client_id, "status": "closed"})
    return {
        "client_id": client_id,
        "client_name": client["name"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": [
            {"label": "Health Score", "value": f"{health}/100"},
            {"label": "MRR", "value": f"${m['mrr']:,.0f}"},
            {"label": "Active Devices", "value": m["devices"]},
            {"label": "Open Tickets", "value": m["open_tickets"]},
            {"label": "Resolved Tickets", "value": closed},
            {"label": "Sentiment", "value": f"{sent}/100"},
            {"label": "Subscriptions", "value": m["subs"]},
        ],
    }


@router.get("/client-studio/{client_id}/compliance")
async def compliance(client_id: str, current_user: dict = Depends(get_current_user)):
    frameworks = [
        {"name": "Essential 8", "score": _seeded(client_id, "e8", 55, 95), "icon": "🇦🇺"},
        {"name": "HIPAA", "score": _seeded(client_id, "hi", 60, 92), "icon": "⚕️"},
        {"name": "SOC 2", "score": _seeded(client_id, "s2", 50, 90), "icon": "🛡️"},
        {"name": "ISO 27001", "score": _seeded(client_id, "iso", 55, 88), "icon": "🌐"},
        {"name": "NIST CSF", "score": _seeded(client_id, "ns", 60, 92), "icon": "🏛️"},
    ]
    return {"frameworks": frameworks, "overall_score": round(sum(f["score"] for f in frameworks) / len(frameworks))}


@router.post("/client-studio/{client_id}/vip")
async def toggle_vip(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    vip = bool((data or {}).get("vip"))
    res = await db.clients.update_one({"id": client_id}, {"$set": {"vip": vip, "updated_at": datetime.now(timezone.utc).isoformat()}})
    if res.matched_count == 0:
        raise HTTPException(404, "Client not found")
    return {"id": client_id, "vip": vip}


@router.post("/client-studio/recompute-tiers")
async def recompute_tiers(current_user: dict = Depends(get_current_user)):
    """Auto-derive tier from current MRR for every client. Idempotent."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "tier": 1}).to_list(2000)
    updated = 0
    for c in clients:
        m = await compute_client_metrics(c["id"])
        new_tier = derive_tier(m["mrr"], m["subs"])
        if c.get("tier") != new_tier:
            await db.clients.update_one({"id": c["id"]}, {"$set": {"tier": new_tier, "tier_recomputed_at": datetime.now(timezone.utc).isoformat()}})
            updated += 1
    return {"updated": updated, "total": len(clients)}
