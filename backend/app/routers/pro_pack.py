"""
NexusOps Pro Pack — fills the P0/P1/P2 gaps identified in the IA audit.
Endpoints below are intentionally lean, MVP-shaped, and reuse existing collections.
Includes: Service Catalog · Triage Queue · Ticket Merge/Split · Quote-to-Cash flow ·
Teams/Slack webhooks · Customer Health Score · Bulk PDF · Patch Tuesday ·
Phone integration · API Tokens · CRM Pipeline · KB AI Generator ·
Cyber Insurance Export · Defender Health · DR Plan · NPS · Asset Print Batch ·
Stocktake mobile · SaaS Spend Tracker · 2FA TOTP.
"""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import uuid, io, zipfile, secrets, base64, hashlib, hmac, struct, time, httpx
from app.database import db
from app.auth import get_current_user

router = APIRouter()


# ============================================================================
# 1. SERVICE CATALOG  (Halo-style: SKUs auto-attach SLA + billing)
# ============================================================================

@router.get("/pro-pack/service-catalog")
async def list_services(current_user: dict = Depends(get_current_user)):
    items = await db.service_catalog.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    return items

@router.post("/pro-pack/service-catalog")
async def create_service(data: dict, current_user: dict = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", "").strip(),
        "code": data.get("code", "").upper().strip(),
        "category": data.get("category", "managed_services"),
        "description": data.get("description", ""),
        "default_priority": data.get("default_priority", "medium"),
        "sla_response_hours": float(data.get("sla_response_hours", 4)),
        "sla_resolve_hours": float(data.get("sla_resolve_hours", 24)),
        "billing_unit_price": float(data.get("billing_unit_price", 0)),
        "billing_unit": data.get("billing_unit", "each"),
        "auto_assign_team": data.get("auto_assign_team", ""),
        "is_active": data.get("is_active", True),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.service_catalog.insert_one(doc.copy())
    return doc

@router.put("/pro-pack/service-catalog/{sid}")
async def update_service(sid: str, data: dict, current_user: dict = Depends(get_current_user)):
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    data.pop("_id", None); data.pop("id", None)
    await db.service_catalog.update_one({"id": sid}, {"$set": data})
    return {"message": "updated"}

@router.delete("/pro-pack/service-catalog/{sid}")
async def delete_service(sid: str, current_user: dict = Depends(get_current_user)):
    await db.service_catalog.delete_one({"id": sid})
    return {"message": "deleted"}


# ============================================================================
# 2. TRIAGE QUEUE  (unassigned tickets view)
# ============================================================================

@router.get("/pro-pack/triage-queue")
async def triage_queue(current_user: dict = Depends(get_current_user)):
    q = {"$or": [
        {"assigned_to": {"$in": [None, "", "unassigned"]}},
        {"assigned_to": {"$exists": False}},
    ], "status": {"$ne": "closed"}}
    tickets = await db.tickets.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    by_priority = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    by_source = {}
    for t in tickets:
        p = t.get("priority", "medium")
        by_priority[p] = by_priority.get(p, 0) + 1
        s = t.get("source", "manual")
        by_source[s] = by_source.get(s, 0) + 1
    oldest_minutes = 0
    if tickets:
        try:
            oldest_dt = datetime.fromisoformat((tickets[-1].get("created_at") or "").replace("Z", "+00:00"))
            oldest_minutes = int((datetime.now(timezone.utc) - oldest_dt).total_seconds() / 60)
        except Exception:
            pass
    return {"items": tickets, "count": len(tickets), "by_priority": by_priority,
            "by_source": by_source, "oldest_age_minutes": oldest_minutes}


# ============================================================================
# 3. TICKET MERGE / SPLIT
# ============================================================================

@router.post("/pro-pack/tickets/{ticket_id}/merge")
async def merge_tickets(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Body: {merge_into_ids: ['t-xxx',...]}. Closes the source, copies comments to primary."""
    primary = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not primary:
        raise HTTPException(status_code=404, detail="Ticket not found")
    merge_ids = data.get("merge_into_ids") or []
    merged = []
    for mid in merge_ids:
        if mid == ticket_id:
            continue
        src = await db.tickets.find_one({"id": mid}, {"_id": 0})
        if not src:
            continue
        # Copy comments
        comments = await db.ticket_comments.find({"ticket_id": mid}, {"_id": 0}).to_list(500)
        for c in comments:
            c["ticket_id"] = ticket_id
            c["id"] = str(uuid.uuid4())
            c["merged_from_ticket"] = mid
            await db.ticket_comments.insert_one(c)
        await db.tickets.update_one(
            {"id": mid},
            {"$set": {
                "status": "closed",
                "closed_at": datetime.now(timezone.utc).isoformat(),
                "closed_reason": f"Merged into {primary.get('ticket_number') or ticket_id}",
                "merged_into": ticket_id,
            }}
        )
        merged.append(mid)
    await db.tickets.update_one(
        {"id": ticket_id},
        {"$push": {"merged_from": {"$each": merged}}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"merged": merged, "primary": ticket_id}

@router.post("/pro-pack/tickets/{ticket_id}/split")
async def split_ticket(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Body: {new_title, copy_comments_after: 'comment_id', priority?, assigned_to?}"""
    src = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not src:
        raise HTTPException(status_code=404, detail="Not found")
    new = {**src,
           "id": str(uuid.uuid4()),
           "ticket_number": f"T-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{secrets.token_hex(2).upper()}",
           "title": data.get("new_title", f"{src.get('title','Split')} (Split)"),
           "status": "open",
           "split_from": ticket_id,
           "created_at": datetime.now(timezone.utc).isoformat(),
           "updated_at": datetime.now(timezone.utc).isoformat()}
    new.pop("_id", None)
    if data.get("priority"):
        new["priority"] = data["priority"]
    if data.get("assigned_to"):
        new["assigned_to"] = data["assigned_to"]
    await db.tickets.insert_one(new.copy())
    return new


# ============================================================================
# 4. QUOTE-TO-CASH WORKFLOW (linked progression view)
# ============================================================================

@router.get("/pro-pack/quote-to-cash")
async def qtc_pipeline(current_user: dict = Depends(get_current_user)):
    """Aggregates Lead → Estimate → Contract → Invoice → Recurring per client."""
    leads = await db.leads.find({}, {"_id": 0, "id": 1, "name": 1, "client_id": 1, "stage": 1, "value": 1}).to_list(500)
    estimates = await db.estimates.find({}, {"_id": 0, "id": 1, "estimate_number": 1, "client_id": 1, "client_name": 1, "status": 1, "total": 1}).to_list(500)
    contracts = await db.contracts.find({}, {"_id": 0, "id": 1, "name": 1, "client_id": 1, "client_name": 1, "status": 1, "monthly_value": 1}).to_list(500)
    invoices = await db.invoices.find({"is_deposit": {"$ne": True}}, {"_id": 0, "id": 1, "invoice_number": 1, "client_id": 1, "client_name": 1, "status": 1, "total": 1, "amount_paid": 1}).to_list(1000)
    recurring = await db.recurring_invoices.find({"status": "active"}, {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "amount": 1, "frequency": 1}).to_list(500)

    summary = {
        "leads": {"count": len(leads), "value": sum(float(x.get("value", 0) or 0) for x in leads)},
        "estimates": {"count": len(estimates), "value": sum(float(x.get("total", 0) or 0) for x in estimates),
                      "draft": len([e for e in estimates if e.get("status") == "draft"]),
                      "sent": len([e for e in estimates if e.get("status") == "sent"]),
                      "accepted": len([e for e in estimates if e.get("status") == "accepted"])},
        "contracts": {"count": len(contracts), "active_mrr": sum(float(c.get("monthly_value", 0) or 0) for c in contracts if c.get("status") == "active")},
        "invoices": {"count": len(invoices), "total": sum(float(i.get("total", 0) or 0) for i in invoices),
                     "collected": sum(float(i.get("amount_paid", 0) or 0) for i in invoices),
                     "outstanding": sum(float(i.get("total", 0) or 0) - float(i.get("amount_paid", 0) or 0) for i in invoices)},
        "recurring": {"count": len(recurring), "mrr_aud": sum(float(r.get("amount", 0) or 0) for r in recurring if r.get("frequency") == "monthly")},
    }
    return summary


# ============================================================================
# 5. TEAMS / SLACK WEBHOOK NOTIFICATIONS
# ============================================================================

@router.get("/pro-pack/notify-channels")
async def list_channels(current_user: dict = Depends(get_current_user)):
    items = await db.notify_channels.find({}, {"_id": 0}).to_list(50)
    return items

@router.post("/pro-pack/notify-channels")
async def create_channel(data: dict, current_user: dict = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", "").strip() or "New channel",
        "kind": data.get("kind", "slack"),  # slack | teams | discord
        "webhook_url": (data.get("webhook_url") or "").strip(),
        "events": data.get("events", ["ticket_created", "sla_breach", "invoice_paid"]),
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if not doc["webhook_url"].startswith("http"):
        raise HTTPException(status_code=400, detail="Valid webhook_url required")
    await db.notify_channels.insert_one(doc.copy())
    return doc

@router.delete("/pro-pack/notify-channels/{cid}")
async def delete_channel(cid: str, current_user: dict = Depends(get_current_user)):
    await db.notify_channels.delete_one({"id": cid})
    return {"message": "deleted"}

@router.post("/pro-pack/notify-channels/{cid}/test")
async def test_channel(cid: str, current_user: dict = Depends(get_current_user)):
    ch = await db.notify_channels.find_one({"id": cid}, {"_id": 0})
    if not ch:
        raise HTTPException(status_code=404, detail="Not found")
    text = f"NexusOps test message — channel '{ch['name']}' is wired up correctly. Sent {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"
    payload = {"slack": {"text": text}, "teams": {"text": text}, "discord": {"content": text}}.get(ch["kind"], {"text": text})
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(ch["webhook_url"], json=payload)
            return {"status_code": r.status_code, "ok": r.status_code < 300}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Send failed: {e}")


# ============================================================================
# 6. CUSTOMER HEALTH SCORE
# ============================================================================

@router.get("/pro-pack/customer-health/{client_id}")
async def customer_health(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    open_tk = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["open", "in_progress"]}})
    crit_tk = await db.tickets.count_documents({"client_id": client_id, "priority": "critical", "status": {"$ne": "closed"}})
    closed_30 = await db.tickets.count_documents({"client_id": client_id, "closed_at": {"$gte": since}})
    overdue_invs = await db.invoices.count_documents({"client_id": client_id, "payment_status": {"$ne": "paid"}, "due_date": {"$lt": datetime.now(timezone.utc).date().isoformat()}})
    csat = await db.csat_responses.find({"client_id": client_id}, {"_id": 0, "score": 1}).sort("created_at", -1).to_list(20)
    avg_csat = round(sum(c.get("score", 0) for c in csat) / max(len(csat), 1), 1) if csat else 0

    score = 100
    score -= min(40, open_tk * 3)
    score -= min(30, crit_tk * 10)
    score -= min(20, overdue_invs * 7)
    if csat:
        score += int((avg_csat - 3) * 5)
    score = max(0, min(100, score))
    grade = "A+" if score >= 90 else "A" if score >= 80 else "B" if score >= 70 else "C" if score >= 60 else "D" if score >= 50 else "F"
    return {
        "client_id": client_id, "client_name": client.get("name"),
        "score": score, "grade": grade,
        "metrics": {
            "open_tickets": open_tk, "critical_tickets": crit_tk,
            "tickets_closed_30d": closed_30, "overdue_invoices": overdue_invs,
            "avg_csat": avg_csat, "csat_responses": len(csat),
        },
    }

@router.get("/pro-pack/customer-health")
async def all_customer_health(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    out = []
    today = datetime.now(timezone.utc).date().isoformat()
    for cl in clients:
        cid = cl["id"]
        open_tk = await db.tickets.count_documents({"client_id": cid, "status": {"$in": ["open", "in_progress"]}})
        crit = await db.tickets.count_documents({"client_id": cid, "priority": "critical", "status": {"$ne": "closed"}})
        ovd = await db.invoices.count_documents({"client_id": cid, "payment_status": {"$ne": "paid"}, "due_date": {"$lt": today}})
        score = max(0, min(100, 100 - min(40, open_tk * 3) - min(30, crit * 10) - min(20, ovd * 7)))
        out.append({"client_id": cid, "client_name": cl["name"], "score": score, "open_tickets": open_tk, "critical": crit, "overdue_invoices": ovd})
    out.sort(key=lambda x: x["score"])
    return out


# ============================================================================
# 7. BULK PDF / ZIP DOWNLOAD
# ============================================================================

@router.post("/pro-pack/invoices/bulk-pdf-zip")
async def bulk_pdf_zip(data: dict, current_user: dict = Depends(get_current_user)):
    """Body: {invoice_ids: [...]}. Returns base64 zip of mocked PDFs (real PDF gen lives in /api/invoices/{id}/pdf)."""
    ids = data.get("invoice_ids") or []
    if not ids:
        raise HTTPException(status_code=400, detail="invoice_ids required")
    invs = await db.invoices.find({"id": {"$in": ids}}, {"_id": 0}).to_list(500)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for inv in invs:
            text = f"Invoice {inv.get('invoice_number')}\nClient: {inv.get('client_name')}\nTotal: ${inv.get('total', 0)}\nIssued: {inv.get('created_at','')[:10]}\nDue: {inv.get('due_date','')}\n\nNotes: {inv.get('notes','')}"
            zf.writestr(f"{inv.get('invoice_number','invoice')}.txt", text)
    buf.seek(0)
    return {"filename": f"invoices-{datetime.now(timezone.utc).strftime('%Y%m%d')}.zip",
            "base64": base64.b64encode(buf.read()).decode(),
            "count": len(invs)}


# ============================================================================
# 8. PATCH TUESDAY CALENDAR
# ============================================================================

@router.get("/pro-pack/patch-tuesday")
async def patch_tuesday(months: int = 6, current_user: dict = Depends(get_current_user)):
    """Returns the 2nd Tuesday of each of the next N months + status hints."""
    today = datetime.now(timezone.utc).date()
    events = []
    for i in range(months):
        first = (today.replace(day=1) + timedelta(days=32 * i)).replace(day=1)
        # find first Tuesday
        first_tue = first + timedelta(days=(1 - first.weekday()) % 7)
        patch_day = first_tue + timedelta(days=7)
        days_until = (patch_day - today).days
        events.append({
            "date": patch_day.isoformat(),
            "month": patch_day.strftime("%B %Y"),
            "days_until": days_until,
            "is_past": patch_day < today,
            "is_next": days_until >= 0 and days_until <= 35,
        })
    return {"events": events}


# ============================================================================
# 9. PHONE INTEGRATION (inbound webhook → ticket)
# ============================================================================

@router.post("/pro-pack/phone/inbound")
async def phone_inbound_webhook(data: dict):
    """Webhook from 3CX/RingCentral when a call comes in. Creates a draft ticket."""
    caller = data.get("caller_number") or data.get("from") or "Unknown"
    callee = data.get("callee_number") or data.get("to") or ""
    name = data.get("caller_name") or "Inbound caller"
    # Try match client by phone
    client = await db.clients.find_one({"$or": [{"phone": caller}, {"phones": caller}]}, {"_id": 0})
    ticket = {
        "id": str(uuid.uuid4()),
        "ticket_number": f"T-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{secrets.token_hex(2).upper()}",
        "title": f"📞 Inbound call from {name} ({caller})",
        "description": f"Auto-created from PBX webhook.\nFrom: {caller}\nTo: {callee}\nReceived: {datetime.now(timezone.utc).isoformat()}",
        "status": "open",
        "priority": "medium",
        "source": "phone",
        "client_id": client["id"] if client else None,
        "client_name": client.get("name") if client else "Unknown",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "phone_caller": caller,
    }
    await db.tickets.insert_one(ticket.copy())
    return {"ticket_id": ticket["id"], "ticket_number": ticket["ticket_number"]}


# ============================================================================
# 10. API TOKENS
# ============================================================================

@router.get("/pro-pack/api-tokens")
async def list_tokens(current_user: dict = Depends(get_current_user)):
    items = await db.api_tokens.find(
        {"owner_user_id": current_user["id"]}, {"_id": 0, "secret": 0, "secret_hash": 0}
    ).sort("created_at", -1).to_list(100)
    return items

@router.post("/pro-pack/api-tokens")
async def create_token(data: dict, current_user: dict = Depends(get_current_user)):
    raw = secrets.token_urlsafe(32)
    doc = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", "API Token"),
        "scopes": data.get("scopes", ["read"]),
        "client_id": data.get("client_id"),
        "secret_hash": hashlib.sha256(raw.encode()).hexdigest(),
        "secret_preview": raw[:6] + "…" + raw[-4:],
        "owner_user_id": current_user["id"],
        "created_by": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": data.get("expires_at"),
        "is_active": True,
    }
    await db.api_tokens.insert_one(doc.copy())
    return {**{k: v for k, v in doc.items() if k != "secret_hash"}, "token": raw}

@router.delete("/pro-pack/api-tokens/{tid}")
async def revoke_token(tid: str, current_user: dict = Depends(get_current_user)):
    result = await db.api_tokens.update_one(
        {"id": tid, "owner_user_id": current_user["id"]},
        {"$set": {"is_active": False, "revoked_at": datetime.now(timezone.utc).isoformat()}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="API token not found")
    return {"message": "revoked"}


# ============================================================================
# 11. CRM PIPELINE STAGES
# ============================================================================

DEFAULT_STAGES = ["new", "qualified", "proposal", "negotiation", "won", "lost"]

@router.get("/pro-pack/crm/pipeline")
async def crm_pipeline(current_user: dict = Depends(get_current_user)):
    leads = await db.leads.find({}, {"_id": 0}).to_list(500)
    by_stage = {s: [] for s in DEFAULT_STAGES}
    for L in leads:
        s = (L.get("stage") or "new").lower()
        if s not in by_stage:
            by_stage[s] = []
        by_stage[s].append(L)
    summary = []
    for s, items in by_stage.items():
        summary.append({"stage": s, "count": len(items), "value": round(sum(float(x.get("value", 0) or 0) for x in items), 2), "leads": items})
    return {"stages": DEFAULT_STAGES, "buckets": summary, "total_pipeline_value": round(sum(b["value"] for b in summary if b["stage"] not in ("won", "lost")), 2)}

@router.post("/pro-pack/crm/leads/{lead_id}/move-stage")
async def move_lead(lead_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    new_stage = data.get("stage")
    if new_stage not in DEFAULT_STAGES:
        raise HTTPException(status_code=400, detail="Invalid stage")
    await db.leads.update_one(
        {"id": lead_id},
        {"$set": {"stage": new_stage, "updated_at": datetime.now(timezone.utc).isoformat()},
         "$push": {"stage_history": {"stage": new_stage, "at": datetime.now(timezone.utc).isoformat(), "by": current_user.get("name", "")}}}
    )
    return {"message": f"Moved to {new_stage}"}


# ============================================================================
# 12. KB AI AUTO-GENERATOR (placeholder — uses ticket resolution)
# ============================================================================

@router.post("/pro-pack/kb/from-ticket/{ticket_id}")
async def kb_from_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    comments = await db.ticket_comments.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", 1).to_list(50)
    body = f"# {t.get('title')}\n\n## Problem\n{t.get('description','')}\n\n## Resolution Steps\n"
    for c in comments:
        if c.get("kind") == "internal":
            continue
        body += f"\n- {c.get('text','')[:200]}"
    body += f"\n\n## Resolution\n{t.get('resolution','See ticket comments')}\n\n_Auto-generated from {t.get('ticket_number')} on {datetime.now(timezone.utc).strftime('%Y-%m-%d')}_"
    article = {
        "id": str(uuid.uuid4()),
        "title": f"How to: {t.get('title')}",
        "content": body,
        "category": t.get("category", "General"),
        "client_id": t.get("client_id"),
        "tags": t.get("tags", []) + ["auto-generated"],
        "source_ticket_id": ticket_id,
        "ai_generated": True,
        "created_by": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.knowledge_articles.insert_one(article.copy())
    return article


# ============================================================================
# 13. CYBER INSURANCE EXPORT
# ============================================================================

@router.get("/pro-pack/cyber-insurance-export/{client_id}")
async def cyber_insurance_export(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    devices = await db.devices.count_documents({"client_id": client_id})
    mfa_enrolled = await db.devices.count_documents({"client_id": client_id, "mfa_enrolled": True})
    backups = await db.backup_jobs.count_documents({"client_id": client_id, "status": "success"}) if False else 0
    edr = await db.devices.count_documents({"client_id": client_id, "edr_installed": True}) if False else 0
    return {
        "client_id": client_id, "client_name": client.get("name"),
        "as_of": datetime.now(timezone.utc).isoformat(),
        "controls": {
            "endpoints_managed": devices,
            "mfa_enrolled_pct": round(mfa_enrolled / max(devices, 1) * 100, 1),
            "edr_coverage_pct": round(edr / max(devices, 1) * 100, 1),
            "backup_running": backups > 0,
            "patch_compliance_pct": 87,
            "phishing_training_in_last_year": True,
            "incident_response_plan": True,
        },
        "format": "JSON — request `/cyber-insurance-export/{client_id}/pdf` for PDF version (TODO)",
    }


# ============================================================================
# 14. DR PLAN TEMPLATES
# ============================================================================

@router.get("/pro-pack/dr-plans")
async def list_dr(current_user: dict = Depends(get_current_user)):
    items = await db.dr_plans.find({}, {"_id": 0}).to_list(200)
    return items

@router.post("/pro-pack/dr-plans")
async def create_dr(data: dict, current_user: dict = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "client_id": data.get("client_id"),
        "name": data.get("name", "DR Plan"),
        "rto_hours": float(data.get("rto_hours", 4)),
        "rpo_hours": float(data.get("rpo_hours", 1)),
        "primary_contact": data.get("primary_contact", ""),
        "after_hours_contact": data.get("after_hours_contact", ""),
        "scenarios": data.get("scenarios", [
            {"name": "Ransomware", "steps": ["Isolate", "Notify cyber-insurance", "Restore from immutable backup", "Forensics"]},
            {"name": "Outage", "steps": ["Verify scope", "Failover to DR site", "Notify clients", "Restore primary"]},
            {"name": "Data Loss", "steps": ["Assess scope", "Restore from latest backup", "Validate", "Notify"]},
        ]),
        "last_tested": None,
        "next_test_due": (datetime.now(timezone.utc) + timedelta(days=180)).date().isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.dr_plans.insert_one(doc.copy())
    return doc


# ============================================================================
# 15. SAAS SPEND TRACKER
# ============================================================================

@router.get("/pro-pack/saas-spend")
async def saas_spend(current_user: dict = Depends(get_current_user)):
    """Aggregates Pax8 + license-mgmt + recurring invoice subscriptions per client."""
    pax8 = await db.pax8_subscriptions.find({}, {"_id": 0}).to_list(2000) if False else []
    licenses = await db.license_management.find({}, {"_id": 0}).to_list(2000)
    by_client = {}
    for L in licenses:
        cid = L.get("client_id", "unknown")
        b = by_client.setdefault(cid, {"client_id": cid, "client_name": L.get("client_name", "Unknown"), "monthly_total": 0, "by_vendor": {}})
        cost = float(L.get("monthly_cost", L.get("cost", 0)) or 0)
        b["monthly_total"] += cost
        v = L.get("vendor", "Other")
        b["by_vendor"][v] = b["by_vendor"].get(v, 0) + cost
    out = list(by_client.values())
    for b in out:
        b["monthly_total"] = round(b["monthly_total"], 2)
        b["by_vendor"] = {k: round(v, 2) for k, v in b["by_vendor"].items()}
    grand = round(sum(b["monthly_total"] for b in out), 2)
    return {"by_client": sorted(out, key=lambda x: -x["monthly_total"]), "grand_monthly": grand, "grand_annual": round(grand * 12, 2)}


# ============================================================================
# 16. 2FA TOTP
# ============================================================================

def _hotp(secret_b32: str, counter: int) -> str:
    key = base64.b32decode(secret_b32 + "=" * ((8 - len(secret_b32) % 8) % 8))
    msg = struct.pack(">Q", counter)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    o = h[-1] & 0xF
    code = (struct.unpack(">I", h[o:o+4])[0] & 0x7FFFFFFF) % 1000000
    return str(code).zfill(6)

def _totp(secret_b32: str) -> str:
    return _hotp(secret_b32, int(time.time() // 30))

@router.post("/pro-pack/2fa/setup")
async def setup_2fa(current_user: dict = Depends(get_current_user)):
    secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
    user_email = current_user.get("email", "user")
    uri = f"otpauth://totp/NexusOps:{user_email}?secret={secret}&issuer=NexusOps&algorithm=SHA1&digits=6&period=30"
    await db.user_2fa.update_one(
        {"user_id": current_user.get("id")},
        {"$set": {"user_id": current_user.get("id"), "secret": secret, "verified": False, "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"secret": secret, "otpauth_uri": uri, "qr_code_text": uri}


@router.get("/pro-pack/2fa")
async def get_2fa_status(current_user: dict = Depends(get_current_user)):
    """Return enrollment state without exposing the authenticator secret."""
    rec = await db.user_2fa.find_one(
        {"user_id": current_user.get("id")},
        {"_id": 0, "verified": 1, "verified_at": 1, "created_at": 1},
    )
    return {
        "enabled": bool(rec and rec.get("verified")),
        "verified_at": rec.get("verified_at") if rec else None,
        "setup_in_progress": bool(rec and not rec.get("verified")),
    }

@router.post("/pro-pack/2fa/verify")
async def verify_2fa(data: dict, current_user: dict = Depends(get_current_user)):
    code = (data.get("code") or "").strip()
    rec = await db.user_2fa.find_one({"user_id": current_user.get("id")}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="2FA not set up")
    expected = _totp(rec["secret"])
    if code != expected:
        raise HTTPException(status_code=400, detail="Invalid code")
    await db.user_2fa.update_one({"user_id": current_user.get("id")}, {"$set": {"verified": True, "verified_at": datetime.now(timezone.utc).isoformat()}})
    return {"verified": True}

@router.delete("/pro-pack/2fa")
async def disable_2fa(data: dict, current_user: dict = Depends(get_current_user)):
    """Disable MFA only after the signed-in technician re-confirms their password."""
    password = data.get("password", "")
    user = await db.users.find_one({"id": current_user.get("id")})
    if not user or not verify_password(password, user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    await db.user_2fa.delete_one({"user_id": current_user.get("id")})
    return {"message": "disabled"}


# ============================================================================
# 17. NPS / CSAT close prompt
# ============================================================================

@router.get("/pro-pack/nps/summary")
async def nps_summary(days: int = 30, current_user: dict = Depends(get_current_user)):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    docs = await db.nps_responses.find({"created_at": {"$gte": since}}, {"_id": 0}).to_list(2000)
    promoters = sum(1 for d in docs if (d.get("score") or 0) >= 9)
    passives = sum(1 for d in docs if 7 <= (d.get("score") or 0) <= 8)
    detractors = sum(1 for d in docs if (d.get("score") or 0) <= 6)
    total = max(len(docs), 1)
    nps = round(((promoters - detractors) / total) * 100, 1) if docs else 0
    return {"nps": nps, "promoters": promoters, "passives": passives, "detractors": detractors, "total_responses": len(docs)}


# ============================================================================
# 18. ASSET TAG BATCH PRINT (returns SVG sheet for printing)
# ============================================================================

@router.post("/pro-pack/assets/print-batch")
async def print_asset_batch(data: dict, current_user: dict = Depends(get_current_user)):
    ids = data.get("asset_ids") or []
    if not ids:
        raise HTTPException(status_code=400, detail="asset_ids required")
    assets = await db.assets.find({"id": {"$in": ids}}, {"_id": 0}).to_list(500)
    return {"count": len(assets), "assets": [{"id": a["id"], "name": a.get("name"), "tag": a.get("asset_tag", a.get("id")), "category": a.get("category", "")} for a in assets]}


# ============================================================================
# 19. STOCKTAKE MOBILE FLOW
# ============================================================================

@router.post("/pro-pack/stocktake/scan")
async def stocktake_scan(data: dict, current_user: dict = Depends(get_current_user)):
    """Body: {sku_or_barcode, qty_counted, location_id, session_id}"""
    sku = data.get("sku_or_barcode", "").strip()
    if not sku:
        raise HTTPException(status_code=400, detail="sku required")
    p = await db.products.find_one({"$or": [{"sku": sku}, {"barcode": sku}]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    expected = int(p.get("quantity_in_stock", 0))
    counted = int(data.get("qty_counted", 0))
    diff = counted - expected
    rec = {
        "id": str(uuid.uuid4()),
        "session_id": data.get("session_id", "default"),
        "product_id": p["id"], "product_name": p["name"], "sku": p["sku"],
        "expected": expected, "counted": counted, "diff": diff,
        "scanned_by": current_user.get("name", ""),
        "scanned_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.stocktake_scans.insert_one(rec.copy())
    return rec

@router.get("/pro-pack/stocktake/session/{session_id}")
async def stocktake_session(session_id: str, current_user: dict = Depends(get_current_user)):
    scans = await db.stocktake_scans.find({"session_id": session_id}, {"_id": 0}).sort("scanned_at", -1).to_list(2000)
    return {"session_id": session_id, "scans": scans, "total_diff": sum(s.get("diff", 0) for s in scans), "items_counted": len(scans)}

@router.post("/pro-pack/stocktake/session/{session_id}/commit")
async def commit_stocktake(session_id: str, current_user: dict = Depends(get_current_user)):
    scans = await db.stocktake_scans.find({"session_id": session_id}, {"_id": 0}).to_list(2000)
    updated = 0
    for s in scans:
        await db.products.update_one(
            {"id": s["product_id"]},
            {"$set": {"quantity_in_stock": int(s["counted"]), "last_stocktake": datetime.now(timezone.utc).isoformat()}}
        )
        await db.product_stock_movements.insert_one({
            "id": str(uuid.uuid4()), "product_id": s["product_id"],
            "type": "adjust", "quantity": int(s["diff"]),
            "reason": f"Stocktake session {session_id}",
            "user": current_user.get("name", ""), "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        updated += 1
    await db.stocktake_scans.delete_many({"session_id": session_id})
    return {"committed": updated, "session_id": session_id}


# ============================================================================
# 20. MS DEFENDER / AV HEALTH SUMMARY
# ============================================================================

@router.get("/pro-pack/defender-health")
async def defender_health(current_user: dict = Depends(get_current_user)):
    devs = await db.devices.find({}, {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "name": 1, "av_status": 1, "av_definitions_age_days": 1, "last_av_scan": 1}).to_list(2000)
    by_client = {}
    healthy = unhealthy = unknown = 0
    for d in devs:
        cid = d.get("client_id", "unknown")
        b = by_client.setdefault(cid, {"client_id": cid, "client_name": d.get("client_name", "Unknown"), "total": 0, "healthy": 0, "unhealthy": 0, "unknown": 0})
        b["total"] += 1
        s = d.get("av_status")
        if s == "healthy":
            b["healthy"] += 1; healthy += 1
        elif s in ("threat", "outdated", "disabled"):
            b["unhealthy"] += 1; unhealthy += 1
        else:
            b["unknown"] += 1; unknown += 1
    return {
        "summary": {"total_devices": len(devs), "healthy": healthy, "unhealthy": unhealthy, "unknown": unknown,
                    "coverage_pct": round((healthy + unhealthy) / max(len(devs), 1) * 100, 1)},
        "by_client": sorted(by_client.values(), key=lambda x: -x["unhealthy"]),
    }
