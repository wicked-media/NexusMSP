"""Differentiator features bundle:
  â€¢ POST /api/ai/why-on-fire/{entity_type}/{entity_id} â€” AI senior-engineer triage
  â€¢ POST /api/tickets/{ticket_id}/auto-quote        â€” Conversation -> quote draft
  â€¢ GET  /api/threat-radar                          â€” MSP-wide threat ticker
  â€¢ GET  /api/clients/{client_id}/health-certificate.pdf?token=  â€” printable cert
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from datetime import datetime, timezone, timedelta
import os
import re
import json
import uuid
import jwt

from app.database import db, JWT_SECRET, JWT_ALGORITHM
from app.auth import get_current_user

router = APIRouter()

MODEL_PROVIDER = "openai"
MODEL_NAME = "gpt-5.6-terra"


async def _llm(system: str, user_msg: str, session_prefix: str = "x") -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(503, "AI not configured")
    from app.services.ai_provider import LlmChat, UserMessage
    chat = LlmChat(api_key=api_key, session_id=f"{session_prefix}-{uuid.uuid4().hex[:8]}",
                   system_message=system).with_model(MODEL_PROVIDER, MODEL_NAME)
    raw = await chat.send_message(UserMessage(text=user_msg))
    return raw.strip() if isinstance(raw, str) else str(raw)


def _safe_json(text: str) -> dict:
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise HTTPException(502, "AI did not return JSON")
    try:
        return json.loads(m.group(0))
    except Exception:
        raise HTTPException(502, "AI returned invalid JSON")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 1. Why is this on fire? â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/ai/why-on-fire/{entity_type}/{entity_id}")
async def why_on_fire(entity_type: str, entity_id: str, current_user: dict = Depends(get_current_user)):
    """Aggregate last 24h of context for a device | ticket | client and ask Nexus AI
    to explain in plain English what's likely happening + 3 next steps."""
    if entity_type not in ("device", "ticket", "client"):
        raise HTTPException(400, "entity_type must be device | ticket | client")

    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    bundle = []
    target = None

    if entity_type == "ticket":
        target = await db.tickets.find_one({"id": entity_id}, {"_id": 0})
        if not target:
            raise HTTPException(404, "Ticket not found")
        bundle.append(f"TICKET #{target.get('ticket_number','')} title: {target.get('title','')} priority: {target.get('priority')} status: {target.get('status')}")
        notes = await db.ticket_notes.find({"ticket_id": entity_id}, {"_id": 0, "body": 1, "created_at": 1, "author": 1}).sort("created_at", -1).limit(15).to_list(15)
        for n in notes:
            bundle.append(f"  Note ({n.get('author','?')}): {(n.get('body') or '')[:240]}")
        # Related device logs if linked
        device_id = target.get("device_id")
        if device_id:
            target_dev = await db.devices.find_one({"id": device_id}, {"_id": 0, "name": 1, "status": 1, "device_type": 1})
            if target_dev:
                bundle.append(f"DEVICE: {target_dev.get('name')} ({target_dev.get('device_type')}) status={target_dev.get('status')}")

    elif entity_type == "device":
        target = await db.devices.find_one({"id": entity_id}, {"_id": 0})
        if not target:
            raise HTTPException(404, "Device not found")
        bundle.append(f"DEVICE: {target.get('name')} status={target.get('status')} os={target.get('os','?')} client={target.get('client_name','?')}")
        # Recent alerts referencing this device
        alerts = await db.alerts.find({"device_id": entity_id, "created_at": {"$gte": since}}, {"_id": 0, "title": 1, "severity": 1, "created_at": 1}).sort("created_at", -1).limit(10).to_list(10) if "alerts" in await db.list_collection_names() else []
        for a in alerts:
            bundle.append(f"  Alert [{a.get('severity')}]: {a.get('title')}")
        # Recent tickets
        tix = await db.tickets.find({"device_id": entity_id, "created_at": {"$gte": since}}, {"_id": 0, "title": 1, "priority": 1, "status": 1, "ticket_number": 1}).limit(5).to_list(5)
        for t in tix:
            bundle.append(f"  Ticket #{t.get('ticket_number','')} [{t.get('priority')}/{t.get('status')}]: {t.get('title')}")

    else:  # client
        target = await db.clients.find_one({"id": entity_id}, {"_id": 0})
        if not target:
            raise HTTPException(404, "Client not found")
        bundle.append(f"CLIENT: {target.get('name')} health_score={target.get('health_score','?')}")
        tix = await db.tickets.find({"client_id": entity_id, "created_at": {"$gte": since}}, {"_id": 0, "title": 1, "priority": 1, "status": 1, "ticket_number": 1}).limit(15).to_list(15)
        for t in tix:
            bundle.append(f"  Ticket #{t.get('ticket_number','')} [{t.get('priority')}/{t.get('status')}]: {t.get('title')}")
        offline = await db.devices.count_documents({"client_id": entity_id, "status": "offline"})
        warning = await db.devices.count_documents({"client_id": entity_id, "status": "warning"})
        bundle.append(f"  Devices: {offline} offline, {warning} warning")

    if len(bundle) < 2:
        return {
            "diagnosis": "Not enough activity in the last 24h to diagnose anything significant.",
            "next_steps": [],
            "severity": "info",
            "confidence": "low",
            "likely_root_cause": "",
            "entity_type": entity_type,
            "entity_id": entity_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    system = (
        "You are a senior MSP engineer doing on-call triage. Given a snapshot of the last 24 hours "
        "of activity for ONE entity, produce STRICT JSON ONLY with: 'diagnosis' (1 paragraph plain-English "
        "explanation of what's most likely happening), 'severity' ('low'|'medium'|'high'|'critical'), "
        "'likely_root_cause' (one sentence), 'next_steps' (array of 3 actionable items), 'confidence' "
        "('low'|'medium'|'high'). Be concrete, reference the data."
    )
    text = await _llm(system, "Snapshot:\n" + "\n".join(bundle) + "\n\nReturn only JSON.", "fire")
    out = _safe_json(text)
    out["entity_type"] = entity_type
    out["entity_id"] = entity_id
    out["generated_at"] = datetime.now(timezone.utc).isoformat()
    return out


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 2. Auto-Quote from Conversation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/tickets/{ticket_id}/auto-quote")
async def auto_quote_from_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Read the ticket conversation + product catalog and draft a quote."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")

    notes = await db.ticket_notes.find({"ticket_id": ticket_id}, {"_id": 0, "body": 1, "author": 1}).sort("created_at", 1).limit(50).to_list(50)
    products = await db.products.find({}, {"_id": 0, "id": 1, "name": 1, "description": 1, "price": 1, "category": 1}).limit(200).to_list(200) if "products" in await db.list_collection_names() else []

    convo = "\n".join([f"  {n.get('author','?')}: {(n.get('body') or '')[:300]}" for n in notes])
    catalog = "\n".join([f"  - {p.get('name')} (${p.get('price', 0)}): {(p.get('description') or '')[:90]}" for p in products[:60]]) or "  (catalog empty â€” invent reasonable pricing)"

    system = (
        "You are an MSP sales engineer. Read a support-ticket conversation and draft a QUOTE for the work "
        "discussed. Return STRICT JSON ONLY with: "
        "'title' (short), 'summary' (1 sentence), "
        "'line_items' (array of {description, quantity, unit_price (number), total (number), product_id (or null)}), "
        "'subtotal' (number), 'tax_rate' (0.10 default), 'tax' (number), 'total' (number), "
        "'confidence' (low|medium|high), 'notes_for_tech' (string explaining your assumptions). "
        "Use products from the provided catalog when they match. Otherwise invent reasonable line items."
    )
    user_msg = (
        f"TICKET: {ticket.get('title','')} ({ticket.get('priority','medium')})\n"
        f"CLIENT: {ticket.get('client_name','')}\n\n"
        f"CONVERSATION:\n{convo or '  (none)'}\n\n"
        f"PRODUCT CATALOG:\n{catalog}\n\nReturn only JSON."
    )
    text = await _llm(system, user_msg, "quote")
    draft = _safe_json(text)
    draft["ticket_id"] = ticket_id
    draft["client_id"] = ticket.get("client_id")
    draft["client_name"] = ticket.get("client_name")
    draft["generated_at"] = datetime.now(timezone.utc).isoformat()
    return draft


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 3. Threat Radar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/threat-radar")
async def threat_radar(current_user: dict = Depends(get_current_user)):
    """Aggregate fresh threat indicators across:
       - Huntress recent threats (db.huntress_threats / db.threat_intel)
       - Resolved-incident DB title patterns from the last 7 days
    Returns a list of ticker items the frontend can scroll.
    """
    items = []
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    cols = await db.list_collection_names()

    if "huntress_threats" in cols or "threat_events" in cols:
        coll = "threat_events" if "threat_events" in cols else "huntress_threats"
        ht = await db[coll].find({"created_at": {"$gte": since}}, {"_id": 0, "title": 1, "severity": 1, "client_name": 1, "created_at": 1, "ioc": 1, "name": 1, "description": 1}).sort("created_at", -1).limit(15).to_list(15)
        for t in ht:
            items.append({
                "kind": "huntress",
                "title": t.get("title") or t.get("name") or t.get("description", "Threat detected"),
                "severity": t.get("severity", "medium"),
                "client": t.get("client_name"),
                "ioc": t.get("ioc"),
                "ts": t.get("created_at"),
            })

    if "identity_threats" in cols:
        idt = await db.identity_threats.find({"created_at": {"$gte": since}}, {"_id": 0, "title": 1, "severity": 1, "user_email": 1, "created_at": 1, "name": 1}).sort("created_at", -1).limit(10).to_list(10)
        for t in idt:
            items.append({
                "kind": "identity",
                "title": t.get("title") or t.get("name") or "Identity threat",
                "severity": t.get("severity", "medium"),
                "client": t.get("user_email"),
                "ts": t.get("created_at"),
            })

    if "alerts" in cols:
        cr = await db.alerts.find({"severity": "critical", "created_at": {"$gte": since}}, {"_id": 0, "title": 1, "client_name": 1, "created_at": 1}).sort("created_at", -1).limit(10).to_list(10)
        for a in cr:
            items.append({
                "kind": "alert",
                "title": a.get("title", "Critical alert"),
                "severity": "critical",
                "client": a.get("client_name"),
                "ts": a.get("created_at"),
            })

    # Cross-client incident pattern (reuse blueprints helpers)
    try:
        from app.routers.blueprints import _bigrams, _tokens
        recent_tix = await db.tickets.find({"status": {"$in": ["resolved", "closed"]}, "$or": [{"resolved_at": {"$gte": since}}, {"updated_at": {"$gte": since}}]}, {"_id": 0, "title": 1, "client_id": 1}).limit(800).to_list(800)
        pool = {}
        for t in recent_tix:
            seen = set()
            for bg in _bigrams(_tokens(t.get("title", ""))):
                if bg in seen:
                    continue
                seen.add(bg)
                pool.setdefault(bg, []).append(t)
        for bg, tickets in pool.items():
            clients = {t.get("client_id") for t in tickets if t.get("client_id")}
            if len(tickets) >= 3 and len(clients) >= 2:
                items.append({
                    "kind": "pattern",
                    "title": f"{bg[0].title()} {bg[1].title()} affecting {len(clients)} clients",
                    "severity": "high" if len(clients) >= 3 else "medium",
                    "tickets": len(tickets),
                    "clients": len(clients),
                    "tokens": list(bg),
                })
    except Exception:
        pass

    items.sort(key=lambda i: {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}.get(i.get("severity"), 5))
    return {"items": items[:20], "generated_at": datetime.now(timezone.utc).isoformat()}


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 4. Client Health Certificate PDF â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


async def _user_from_qtoken(token: str = Query(None)):
    if not token:
        raise HTTPException(401, "Token required")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(401, "User not found")
        return user
    except Exception:
        raise HTTPException(401, "Invalid token")


def _safe_pdf(text) -> str:
    if text is None:
        return ""
    s = str(text)
    repl = {"â€”": "-", "â€“": "-", "â€¢": "*", "Â·": "-", "â€œ": '"', "â€": '"', "â€˜": "'", "â€™": "'", "â€¦": "...", "â†’": "->", "âœ“": "v", "âœ—": "x", "â˜…": "*"}
    for k, v in repl.items():
        s = s.replace(k, v)
    return s.encode("latin-1", "replace").decode("latin-1")


@router.get("/clients/{client_id}/health-certificate.pdf")
async def health_certificate_pdf(client_id: str, user: dict = Depends(_user_from_qtoken)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    branding_doc = await db.settings.find_one({"key": "branding"}, {"_id": 0}) or {}
    branding = branding_doc.get("value") or branding_doc or {}
    company = branding.get("company_name") or "NexusOps"

    score = int(client.get("health_score") or 75)
    grade = "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D"
    cert_id = f"CERT-{client_id[-6:].upper()}-{datetime.now(timezone.utc).strftime('%Y%m')}"

    from fpdf import FPDF
    pdf = FPDF(orientation="L", unit="mm", format="A4")  # landscape for cert feel
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()

    # Outer frame
    pdf.set_draw_color(212, 175, 55)  # gold
    pdf.set_line_width(2.0)
    pdf.rect(8, 8, 281, 194)
    pdf.set_line_width(0.4)
    pdf.rect(12, 12, 273, 186)

    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(120, 120, 120)
    pdf.set_xy(0, 24)
    pdf.cell(297, 6, _safe_pdf(f"{company} - Managed IT Services"), align="C", ln=True)

    pdf.set_font("Helvetica", "B", 28)
    pdf.set_text_color(20, 20, 20)
    pdf.set_xy(0, 36)
    pdf.cell(297, 12, _safe_pdf("CERTIFICATE OF IT HEALTH"), align="C", ln=True)

    pdf.set_font("Helvetica", "I", 12)
    pdf.set_text_color(110, 110, 110)
    pdf.set_xy(0, 52)
    pdf.cell(297, 6, _safe_pdf("This certifies that"), align="C", ln=True)

    pdf.set_font("Helvetica", "B", 24)
    pdf.set_text_color(20, 20, 20)
    pdf.set_xy(0, 64)
    pdf.cell(297, 14, _safe_pdf(client.get("name", "")), align="C", ln=True)

    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(110, 110, 110)
    pdf.set_xy(0, 82)
    pdf.cell(297, 6, _safe_pdf("has achieved an overall IT health score of"), align="C", ln=True)

    # Big score
    pdf.set_font("Helvetica", "B", 64)
    pdf.set_text_color(16, 185, 129)
    pdf.set_xy(0, 92)
    pdf.cell(297, 22, _safe_pdf(f"{score}/100"), align="C", ln=True)

    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(20, 20, 20)
    pdf.set_xy(0, 120)
    pdf.cell(297, 9, _safe_pdf(f"GRADE: {grade}"), align="C", ln=True)

    # Pillar bullets
    dims = client.get("health_dimensions") or {}
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(80, 80, 80)
    line = "  ".join([f"{k.title()}: {v}" for k, v in list(dims.items())[:5]]) if dims else ""
    if line:
        pdf.set_xy(0, 134)
        pdf.cell(297, 5, _safe_pdf(line), align="C", ln=True)

    # Footer signature line
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(110, 110, 110)
    pdf.set_xy(40, 168)
    pdf.cell(80, 5, _safe_pdf(f"Issued: {datetime.now(timezone.utc).strftime('%d %b %Y')}"), align="L", ln=False)
    pdf.set_xy(177, 168)
    pdf.cell(80, 5, _safe_pdf(f"Cert: {cert_id}"), align="R", ln=True)

    pdf.set_xy(0, 184)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(150, 150, 150)
    pdf.cell(297, 4, _safe_pdf(f"Verify at https://{branding.get('domain','')}/verify/{cert_id}"), align="C")

    pdf_bytes = bytes(pdf.output(dest="S"))
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={cert_id}.pdf"})


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 5. Churn Risk Score â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/clients/{client_id}/churn-risk")
async def client_churn_risk(client_id: str, current_user: dict = Depends(get_current_user)):
    """Compute a 0-100 churn risk score with plain-English drivers + save actions."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")

    now = datetime.now(timezone.utc)
    last_30 = (now - timedelta(days=30)).isoformat()
    prev_30 = (now - timedelta(days=60)).isoformat()

    # Signal 1: Rising ticket volume (30d vs prior 30d)
    tix_30 = await db.tickets.count_documents({"client_id": client_id, "created_at": {"$gte": last_30}})
    tix_prev = await db.tickets.count_documents({"client_id": client_id, "created_at": {"$gte": prev_30, "$lt": last_30}})
    vol_delta = tix_30 - tix_prev
    vol_score = min(25, max(0, vol_delta * 2)) if tix_prev > 0 else 0

    # Signal 2: SLA breaches (last 30d)
    sla_breaches = await db.tickets.count_documents({"client_id": client_id, "sla_breached": True, "created_at": {"$gte": last_30}})
    sla_score = min(25, sla_breaches * 6)

    # Signal 3: Unpaid / overdue invoices
    unpaid = 0
    overdue = 0
    if "invoices" in await db.list_collection_names():
        unpaid = await db.invoices.count_documents({"client_id": client_id, "status": {"$in": ["sent", "unpaid"]}})
        overdue = await db.invoices.count_documents({"client_id": client_id, "status": "overdue"})
    inv_score = min(20, overdue * 5 + unpaid * 2)

    # Signal 4: Offline / warning devices
    offline = await db.devices.count_documents({"client_id": client_id, "status": "offline"})
    warn = await db.devices.count_documents({"client_id": client_id, "status": "warning"})
    dev_score = min(15, offline * 3 + warn)

    # Signal 5: Recent critical / P1 tickets unresolved
    critical_open = await db.tickets.count_documents({"client_id": client_id, "priority": "critical", "status": {"$in": ["open", "in_progress"]}})
    crit_score = min(15, critical_open * 7)

    total = min(100, vol_score + sla_score + inv_score + dev_score + crit_score)
    band = "critical" if total >= 75 else "high" if total >= 50 else "medium" if total >= 25 else "low"

    drivers = []
    if vol_delta >= 3:
        drivers.append(f"Ticket volume +{vol_delta} vs prior 30d ({tix_30} vs {tix_prev})")
    if sla_breaches > 0:
        drivers.append(f"{sla_breaches} SLA breach(es) in the last 30 days")
    if overdue > 0:
        drivers.append(f"{overdue} overdue invoice(s)")
    elif unpaid > 0:
        drivers.append(f"{unpaid} unpaid invoice(s)")
    if offline > 0:
        drivers.append(f"{offline} device(s) offline")
    if critical_open > 0:
        drivers.append(f"{critical_open} critical ticket(s) open")

    suggested_actions = []
    if sla_breaches > 0 or critical_open > 0:
        suggested_actions.append("Schedule a same-week VIP check-in with the primary contact")
    if overdue > 0:
        suggested_actions.append("Run the Late-Payment AI workflow and offer a 14-day extension")
    if vol_delta >= 5:
        suggested_actions.append("Open an internal incident to investigate root cause of ticket surge")
    if offline > 0:
        suggested_actions.append("Dispatch an on-site to recover offline devices and demonstrate proactivity")
    if not suggested_actions:
        suggested_actions.append("Health is stable - continue your current cadence")

    return {
        "client_id": client_id,
        "client_name": client.get("name"),
        "score": total,
        "band": band,
        "drivers": drivers,
        "suggested_actions": suggested_actions,
        "signals": {
            "tix_30d": tix_30, "tix_prev": tix_prev, "vol_delta": vol_delta,
            "sla_breaches": sla_breaches, "unpaid": unpaid, "overdue": overdue,
            "offline_devices": offline, "warning_devices": warn, "critical_open": critical_open,
        },
        "generated_at": now.isoformat(),
    }


@router.get("/churn-risk/overview")
async def churn_risk_overview(current_user: dict = Depends(get_current_user)):
    """Top at-risk clients dashboard tile."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    results = []
    for c in clients:
        try:
            r = await client_churn_risk(c["id"], current_user)
            results.append({"client_id": c["id"], "client_name": c["name"], "score": r["score"], "band": r["band"], "top_driver": (r["drivers"] or [""])[0]})
        except Exception:
            continue
    results.sort(key=lambda x: -x["score"])
    return {"top": results[:10], "total_clients": len(clients), "generated_at": datetime.now(timezone.utc).isoformat()}


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 6. Invoice DisputeShield â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/invoices/{invoice_id}/dispute-shield.pdf")
async def invoice_dispute_shield(invoice_id: str, user: dict = Depends(_user_from_qtoken)):
    """Generate a branded evidence-packet PDF for an invoice: every related ticket,
    time entry, email excerpt, estimate, SLA proof, and device telemetry that justifies
    the charges. One-click defense when a client disputes.
    """
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    client_id = invoice.get("client_id")
    branding_doc = await db.settings.find_one({"key": "branding"}, {"_id": 0}) or {}
    branding = branding_doc.get("value") or branding_doc or {}
    company = branding.get("company_name") or "NexusOps"

    # Window: issue_date -> due_date (or 30d prior if issue missing)
    iso_issue = invoice.get("issue_date") or ""
    iso_due = invoice.get("due_date") or ""
    start = iso_issue[:10] if iso_issue else (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()[:10]
    end = iso_due[:10] if iso_due else datetime.now(timezone.utc).isoformat()[:10]

    tix = await db.tickets.find(
        {"client_id": client_id, "$or": [{"created_at": {"$gte": start}}, {"resolved_at": {"$gte": start}}, {"updated_at": {"$gte": start}}]},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1, "status": 1, "created_at": 1, "resolved_at": 1, "assignee_name": 1}
    ).limit(100).to_list(100)

    time_entries = []
    if "time_entries" in await db.list_collection_names():
        time_entries = await db.time_entries.find(
            {"client_id": client_id, "date": {"$gte": start, "$lte": end}},
            {"_id": 0, "date": 1, "minutes": 1, "user_name": 1, "description": 1, "ticket_number": 1}
        ).sort("date", -1).limit(150).to_list(150)

    estimates = []
    if "estimates" in await db.list_collection_names():
        estimates = await db.estimates.find(
            {"client_id": client_id, "status": "approved"},
            {"_id": 0, "estimate_number": 1, "title": 1, "total": 1, "approved_at": 1, "approved_by_name": 1}
        ).limit(20).to_list(20)

    from fpdf import FPDF
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    # Header
    pdf.set_fill_color(30, 41, 59)
    pdf.rect(0, 0, 210, 30, "F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_xy(15, 8)
    pdf.cell(180, 8, _safe_pdf("INVOICE EVIDENCE PACKET"), ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_xy(15, 18)
    pdf.cell(180, 5, _safe_pdf(f"{company} - Confidential - {datetime.now(timezone.utc).strftime('%d %b %Y')}"), ln=True)
    pdf.set_text_color(40, 40, 40)
    pdf.set_y(38)

    def _h(text, color=(30, 41, 59)):
        pdf.ln(3)
        pdf.set_x(15)
        pdf.set_text_color(*color)
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 6, _safe_pdf(text), ln=True)
        pdf.set_text_color(40, 40, 40)
        pdf.set_font("Helvetica", "", 10)

    def _p(text):
        pdf.set_x(15)
        pdf.multi_cell(180, 5, _safe_pdf(text))

    _h("Invoice summary")
    _p(f"Invoice: {invoice.get('invoice_number', invoice_id)}")
    _p(f"Client: {invoice.get('client_name', '')}")
    _p(f"Issue: {start}    Due: {end}")
    _p(f"Total: {invoice.get('currency', 'USD')} {float(invoice.get('total') or 0):,.2f}")

    _h(f"Tickets worked in this billing window ({len(tix)})")
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_x(15)
    pdf.cell(25, 5, "Number")
    pdf.cell(95, 5, "Title")
    pdf.cell(20, 5, "Priority")
    pdf.cell(20, 5, "Status")
    pdf.cell(20, 5, "Tech", ln=True)
    pdf.set_font("Helvetica", "", 9)
    for t in tix[:40]:
        pdf.set_x(15)
        pdf.cell(25, 4.5, _safe_pdf(f"#{t.get('ticket_number', '')}"))
        pdf.cell(95, 4.5, _safe_pdf((t.get('title') or '')[:52]))
        pdf.cell(20, 4.5, _safe_pdf(t.get('priority', '')))
        pdf.cell(20, 4.5, _safe_pdf(t.get('status', '')))
        pdf.cell(20, 4.5, _safe_pdf((t.get('assignee_name') or '')[:10]), ln=True)

    _h(f"Time entries ({len(time_entries)} = {sum(t.get('minutes', 0) for t in time_entries)} min)")
    pdf.set_font("Helvetica", "", 9)
    for te in time_entries[:40]:
        _p(f"  {te.get('date', '')[:10]}  {te.get('user_name', '')} - #{te.get('ticket_number', '')} - {te.get('minutes', 0)}min - {(te.get('description') or '')[:80]}")

    if estimates:
        _h(f"Approved estimates ({len(estimates)})")
        for e in estimates[:15]:
            _p(f"  {e.get('estimate_number', '')} - {e.get('title', '')} - ${float(e.get('total') or 0):,.2f} - approved by {e.get('approved_by_name', '?')} on {str(e.get('approved_at', ''))[:10]}")

    _h("Conclusion", color=(16, 185, 129))
    _p("This packet was generated automatically from the NexusOps platform. All tickets, time entries, and approvals are linked to the above invoice billing period and evidence the work performed.")

    pdf.set_y(-18)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(140, 140, 140)
    pdf.cell(0, 5, _safe_pdf(f"Prepared for {invoice.get('client_name', '')} - generated {datetime.now(timezone.utc).isoformat()[:19]}Z"), align="C")

    pdf_bytes = bytes(pdf.output(dest="S"))
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=dispute_shield_{invoice.get('invoice_number', invoice_id)}.pdf"})


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 7. Auto-Incident Postmortem â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/warroom/{wr_id}/postmortem")
async def warroom_postmortem(wr_id: str, current_user: dict = Depends(get_current_user)):
    """Generate an AI postmortem for a resolved War Room and optionally push to Hudu."""
    wr = await db.war_rooms.find_one({"id": wr_id}, {"_id": 0})
    if not wr:
        raise HTTPException(404, "War room not found")
    if wr.get("status") != "resolved":
        raise HTTPException(400, "War room must be resolved before generating a postmortem")

    timeline = []
    for m in (wr.get("messages") or [])[:150]:
        ts = (m.get("ts") or "")[:19]
        who = m.get("author") or m.get("kind")
        body = (m.get("body") or "")[:200]
        timeline.append(f"  {ts}  {who}: {body}")

    ctx = (
        f"TITLE: {wr.get('title', '')}\n"
        f"SEVERITY: {wr.get('severity', 'P1')}\n"
        f"CLIENT: {wr.get('client_name', '(internal)')}\n"
        f"OPENED: {wr.get('created_at', '')}\n"
        f"RESOLVED: {wr.get('resolved_at', '')}\n"
        f"RESOLUTION_NOTES: {wr.get('resolved_notes') or '(none)'}\n"
        f"AFFECTED_DEVICES: {len(wr.get('affected_device_ids') or [])}\n"
        f"PARTICIPANTS: {', '.join([p.get('name') or '?' for p in (wr.get('participants') or [])][:10])}\n"
        f"\nTIMELINE:\n" + "\n".join(timeline) + "\n"
    )

    system = (
        "You are a senior incident commander writing a clean postmortem. Return STRICT JSON ONLY "
        "with keys: 'summary' (2-3 sentence overview), 'timeline' (array of {ts, event} with 4-8 key "
        "moments), 'root_cause' (1 paragraph), 'impact' (1 paragraph, reference affected clients/"
        "devices), 'what_went_well' (array of 2-4 strings), 'what_went_poorly' (array of 2-4 strings), "
        "'action_items' (array of {owner, task, priority})."
    )
    text = await _llm(system, ctx + "\nReturn only JSON.", "postmortem")
    doc = _safe_json(text)
    doc["war_room_id"] = wr_id
    doc["title"] = wr.get("title")
    doc["severity"] = wr.get("severity")
    doc["client_id"] = wr.get("client_id")
    doc["client_name"] = wr.get("client_name")
    doc["generated_at"] = datetime.now(timezone.utc).isoformat()
    doc["generated_by"] = current_user.get("name")

    # Persist + stamp war room
    doc["id"] = f"pm-{uuid.uuid4().hex[:10]}"
    await db.postmortems.insert_one(doc)
    await db.war_rooms.update_one({"id": wr_id}, {"$set": {"postmortem_id": doc["id"], "postmortem_generated_at": doc["generated_at"]}})
    doc.pop("_id", None)
    return doc


@router.get("/postmortems/{pm_id}")
async def get_postmortem(pm_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.postmortems.find_one({"id": pm_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Postmortem not found")
    return doc


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 8. Client Whisper Mode (VIP context) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/whisper/contact")
async def whisper_contact(email: str, current_user: dict = Depends(get_current_user)):
    """Return rich VIP context for a contact email so a tech can handle them with care."""
    email_lower = email.strip().lower()
    contact = None
    if "contacts" in await db.list_collection_names():
        contact = await db.contacts.find_one(
            {"email": {"$regex": f"^{re.escape(email_lower)}$", "$options": "i"}},
            {"_id": 0}
        )
    client = None
    if contact:
        client = await db.clients.find_one({"id": contact.get("client_id")}, {"_id": 0})
    else:
        client = await db.clients.find_one({"contact_email": {"$regex": f"^{re.escape(email_lower)}$", "$options": "i"}}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Contact not found")

    is_vip = bool((contact or {}).get("is_vip") or (contact or {}).get("role") in ("owner", "cfo", "ceo", "primary_billing") or client.get("tier") in ("platinum", "enterprise"))

    # Recent interactions
    since = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    recent_tix = await db.tickets.find(
        {"client_id": client["id"], "$or": [{"created_at": {"$gte": since}}, {"updated_at": {"$gte": since}}]},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1, "status": 1, "created_at": 1}
    ).sort("created_at", -1).limit(5).to_list(5)

    # Finance
    overdue = 0
    unpaid = 0
    total_due = 0.0
    if "invoices" in await db.list_collection_names():
        overdue_docs = await db.invoices.find({"client_id": client["id"], "status": "overdue"}, {"_id": 0, "total": 1}).to_list(20)
        overdue = len(overdue_docs)
        total_due = sum(float(i.get("total") or 0) for i in overdue_docs)
        unpaid = await db.invoices.count_documents({"client_id": client["id"], "status": {"$in": ["sent", "unpaid"]}})

    # Health + churn band
    churn = None
    try:
        churn = await client_churn_risk(client["id"], current_user)
    except Exception:
        pass

    # Past escalations: count tickets ever marked critical or with sla_breached
    escalations = await db.tickets.count_documents({"client_id": client["id"], "$or": [{"priority": "critical"}, {"sla_breached": True}]})

    # Preferred tech: most frequent assignee in the last 90d
    pref_tech = None
    try:
        pipeline = [
            {"$match": {"client_id": client["id"], "created_at": {"$gte": since}, "assignee_name": {"$nin": [None, ""]}}},
            {"$group": {"_id": "$assignee_name", "c": {"$sum": 1}}},
            {"$sort": {"c": -1}}, {"$limit": 1},
        ]
        agg = await db.tickets.aggregate(pipeline).to_list(1)
        if agg:
            pref_tech = agg[0]["_id"]
    except Exception:
        pass

    return {
        "contact": {
            "name": (contact or {}).get("name") or client.get("name"),
            "email": email_lower,
            "role": (contact or {}).get("role"),
            "is_vip": is_vip,
            "notes": (contact or {}).get("notes", ""),
            "birthday": (contact or {}).get("birthday"),
            "preferred_drink": (contact or {}).get("preferred_drink"),
        },
        "client": {
            "id": client["id"],
            "name": client.get("name"),
            "tier": client.get("tier"),
            "health_score": client.get("health_score"),
        },
        "recent_tickets": recent_tix,
        "finance": {"unpaid": unpaid, "overdue": overdue, "total_overdue": round(total_due, 2)},
        "churn": {"score": churn.get("score") if churn else None, "band": churn.get("band") if churn else None},
        "escalations_ever": escalations,
        "preferred_tech": pref_tech,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 9. Conversation Sentiment Tracker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/tickets/{ticket_id}/sentiment")
async def ticket_sentiment(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Score the ticket's client-side conversation for sentiment trajectory."""
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "id": 1, "title": 1, "client_name": 1})
    if not t:
        raise HTTPException(404, "Ticket not found")
    notes = await db.ticket_notes.find({"ticket_id": ticket_id}, {"_id": 0, "body": 1, "author": 1, "author_type": 1, "created_at": 1}).sort("created_at", 1).limit(40).to_list(40)
    # Filter to client-side messages
    client_msgs = [n for n in notes if (n.get("author_type") == "client" or not n.get("author_type", "").startswith("tech"))]
    if len(client_msgs) < 2:
        return {"ticket_id": ticket_id, "score": None, "trend": "insufficient_data", "message_count": len(client_msgs), "flag": None}

    corpus = "\n".join([f"{i+1}. {(n.get('body') or '')[:300]}" for i, n in enumerate(client_msgs[-10:])])
    system = (
        "You are a customer-experience analyst. Score each message 1-5 where 1=very positive, 3=neutral, 5=very angry. "
        "Return STRICT JSON ONLY: {per_message:[int,...], latest_score (int), overall_trend ('improving'|'stable'|'worsening'|'volatile'), "
        "reasoning (1 sentence), escalate_recommended (bool)}."
    )
    text = await _llm(system, f"Client messages:\n{corpus}\n\nReturn JSON only.", "sentiment")
    out = _safe_json(text)
    flag = None
    if out.get("escalate_recommended") or (out.get("latest_score") and int(out["latest_score"]) >= 4):
        flag = "escalating"
    return {
        "ticket_id": ticket_id,
        "ticket_title": t.get("title"),
        "client_name": t.get("client_name"),
        "per_message": out.get("per_message", []),
        "latest_score": out.get("latest_score"),
        "trend": out.get("overall_trend"),
        "reasoning": out.get("reasoning"),
        "escalate_recommended": bool(out.get("escalate_recommended")),
        "flag": flag,
        "message_count": len(client_msgs),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 10. Predictive SLA Breach Radar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/sla-radar")
async def sla_radar(current_user: dict = Depends(get_current_user)):
    """Heuristic-based SLA breach predictor.

    Score 0-100 by:
      - hours_elapsed_vs_target (weight 40)
      - priority (weight 20, critical more risk)
      - activity_gap â€” time since last note (weight 20)
      - assignee_workload â€” how many active tickets tech has (weight 20)
    Tickets >=60 are 'at risk'; >=80 are 'danger zone' (<2h to breach heuristically).
    """
    now = datetime.now(timezone.utc)
    open_tix = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress"]}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1, "created_at": 1, "sla_due_at": 1,
         "client_name": 1, "assignee_id": 1, "assignee_name": 1, "sla_target_minutes": 1, "last_activity_at": 1,
         "updated_at": 1}
    ).limit(500).to_list(500)

    # Count workload per assignee
    workload = {}
    for t in open_tix:
        aid = t.get("assignee_id")
        if aid:
            workload[aid] = workload.get(aid, 0) + 1

    PRI_TARGET_MIN = {"critical": 240, "high": 480, "medium": 1440, "low": 2880}
    at_risk = []
    for t in open_tix:
        target_min = t.get("sla_target_minutes") or PRI_TARGET_MIN.get((t.get("priority") or "medium").lower(), 1440)
        created_iso = t.get("created_at") or t.get("updated_at") or ""
        try:
            created = datetime.fromisoformat(created_iso.replace("Z", "+00:00")) if created_iso else now
        except Exception:
            created = now
        elapsed_min = (now - created).total_seconds() / 60
        elapsed_pct = min(1.5, elapsed_min / max(1, target_min))
        age_score = min(40, int(elapsed_pct * 40))

        pri_score = {"critical": 20, "high": 14, "medium": 8, "low": 4}.get((t.get("priority") or "medium").lower(), 8)

        # Activity gap
        last_activity = t.get("last_activity_at") or t.get("updated_at") or created_iso
        try:
            la = datetime.fromisoformat(last_activity.replace("Z", "+00:00")) if last_activity else created
        except Exception:
            la = created
        gap_hours = (now - la).total_seconds() / 3600
        gap_score = min(20, int(gap_hours * 2))

        load = workload.get(t.get("assignee_id"), 0)
        load_score = min(20, load * 2)

        score = age_score + pri_score + gap_score + load_score
        mins_to_breach = max(0, int(target_min - elapsed_min))
        if score >= 60:
            at_risk.append({
                "ticket_id": t["id"],
                "ticket_number": t.get("ticket_number"),
                "title": t.get("title"),
                "client_name": t.get("client_name"),
                "priority": t.get("priority"),
                "assignee_name": t.get("assignee_name"),
                "score": min(100, score),
                "minutes_to_breach": mins_to_breach,
                "reasons": [
                    f"Age: {int(elapsed_pct * 100)}% of SLA window used",
                    f"Last activity: {int(gap_hours)}h ago" if gap_hours >= 2 else None,
                    f"Tech workload: {load} open" if load >= 5 else None,
                ],
            })

    at_risk.sort(key=lambda x: -x["score"])
    return {
        "at_risk": at_risk[:20],
        "danger_zone_count": sum(1 for t in at_risk if t["score"] >= 80),
        "generated_at": now.isoformat(),
    }


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 11. Payment Promise Tracker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/invoices/{invoice_id}/promises")
async def record_payment_promise(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Record a payment promise. Body: { text: 'They said pay by Friday', promised_by?: 'contact name' }
    AI extracts the date.
    """
    text = (data.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "text required")
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0, "id": 1, "invoice_number": 1, "client_id": 1, "client_name": 1, "total": 1})
    if not inv:
        raise HTTPException(404, "Invoice not found")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    system = (
        f"Today is {today}. Extract a payment promise from the given text. Return STRICT JSON ONLY: "
        "{promised_date: 'YYYY-MM-DD', confidence: 'low|medium|high', snippet: 'quoted promise', "
        "method: 'bank_transfer|card|cheque|unknown'}. If no date is specified, set promised_date to null."
    )
    try:
        ai = _safe_json(await _llm(system, f"Text: {text}\nReturn JSON only.", "promise"))
    except Exception:
        ai = {"promised_date": None, "confidence": "low", "snippet": text[:200], "method": "unknown"}

    doc = {
        "id": f"pp-{uuid.uuid4().hex[:10]}",
        "invoice_id": invoice_id,
        "invoice_number": inv.get("invoice_number"),
        "client_id": inv.get("client_id"),
        "client_name": inv.get("client_name"),
        "invoice_total": inv.get("total"),
        "raw_text": text,
        "promised_by": (data.get("promised_by") or "").strip()[:200],
        "promised_date": ai.get("promised_date"),
        "method": ai.get("method"),
        "confidence": ai.get("confidence"),
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name"),
    }
    await db.payment_promises.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/payment-promises")
async def list_payment_promises(status: str | None = None, client_id: str | None = None, current_user: dict = Depends(get_current_user)):
    q = {}
    if status:
        q["status"] = status
    if client_id:
        q["client_id"] = client_id
    promises = await db.payment_promises.find(q, {"_id": 0}).sort("promised_date", 1).to_list(200)
    # Auto-flag broken promises (promised_date < today & status still pending)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for p in promises:
        if p.get("status") == "pending" and p.get("promised_date") and p["promised_date"] < today:
            p["overdue"] = True
        else:
            p["overdue"] = False
    return promises


@router.put("/payment-promises/{pp_id}")
async def update_payment_promise(pp_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Mark status: kept | broken | cancelled."""
    new_status = data.get("status")
    if new_status not in ("pending", "kept", "broken", "cancelled"):
        raise HTTPException(400, "invalid status")
    patch = {"status": new_status, "resolved_at": datetime.now(timezone.utc).isoformat() if new_status != "pending" else None}
    res = await db.payment_promises.update_one({"id": pp_id}, {"$set": patch})
    if res.matched_count == 0:
        raise HTTPException(404, "Promise not found")
    return await db.payment_promises.find_one({"id": pp_id}, {"_id": 0})


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 12. Estimate Follow-up AI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/estimates/{estimate_id}/followup-draft")
async def estimate_followup_draft(estimate_id: str, current_user: dict = Depends(get_current_user)):
    est = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not est:
        raise HTTPException(404, "Estimate not found")
    if est.get("status") == "approved":
        raise HTTPException(400, "Estimate already approved - no follow-up needed")

    # Gather conversation history from related ticket if present
    convo = ""
    if est.get("ticket_id"):
        notes = await db.ticket_notes.find({"ticket_id": est["ticket_id"]}, {"_id": 0, "body": 1, "author": 1}).sort("created_at", -1).limit(15).to_list(15)
        convo = "\n".join([f"  {n.get('author','?')}: {(n.get('body') or '')[:200]}" for n in notes])

    days_old = 0
    try:
        created = datetime.fromisoformat((est.get("created_at") or "").replace("Z", "+00:00"))
        days_old = (datetime.now(timezone.utc) - created).days
    except Exception:
        pass

    items = est.get("items") or est.get("line_items") or []
    items_text = "\n".join([f"  - {it.get('description','')}: {float(it.get('total') or 0):,.2f}" for it in items[:10]])

    system = (
        "You are a friendly but effective MSP account manager writing a follow-up email for a stalled estimate. "
        "Identify the most likely objection (price / scope / timing / competing priority) from the conversation, "
        "then draft an email that ACKNOWLEDGES it and gives a practical next step (e.g. phased rollout, volume discount, "
        "call scheduled). Return STRICT JSON ONLY: "
        "{likely_objection: string, subject: string, body: string (3-5 short paragraphs), tone: 'friendly'|'urgent', cta: string}"
    )
    user_msg = (
        f"Estimate #{est.get('estimate_number','')} for {est.get('client_name','')}\n"
        f"Amount: ${float(est.get('total') or 0):,.2f}\n"
        f"Status: {est.get('status')} | Age: {days_old} days\n"
        f"Items:\n{items_text}\n\n"
        f"Recent conversation:\n{convo or '  (no conversation)'}\n\nReturn only JSON."
    )
    draft = _safe_json(await _llm(system, user_msg, "estfollow"))
    draft["estimate_id"] = estimate_id
    draft["estimate_number"] = est.get("estimate_number")
    draft["days_since_sent"] = days_old
    draft["generated_at"] = datetime.now(timezone.utc).isoformat()
    return draft


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 13. Invoice Explainer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/invoices/{invoice_id}/explainer")
async def invoice_explainer(invoice_id: str, current_user: dict = Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")

    start = (inv.get("issue_date") or "")[:10] or (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()[:10]
    end = (inv.get("due_date") or datetime.now(timezone.utc).isoformat())[:10]
    cid = inv.get("client_id")

    tix = await db.tickets.find({
        "client_id": cid,
        "$or": [{"resolved_at": {"$gte": start, "$lte": end}}, {"created_at": {"$gte": start, "$lte": end}}]
    }, {"_id": 0, "title": 1, "priority": 1, "status": 1, "ticket_number": 1}).limit(60).to_list(60)
    critical = sum(1 for t in tix if t.get("priority") == "critical")

    devices = await db.devices.count_documents({"client_id": cid}) if cid else 0
    items_text = "\n".join([f"  - {it.get('description', '')}: ${float(it.get('total') or 0):,.2f}" for it in (inv.get("items") or [])[:15]])

    system = (
        "You are writing a short, warm, plain-English explainer for a business owner (non-technical) of what their "
        "invoice covers. 4-6 short sentences. NO markdown. NO technical jargon. Use 'we' not 'our team'. "
        "End with one sentence that thanks them for trusting you. Output plain text only, no preamble."
    )
    user_msg = (
        f"Invoice #{inv.get('invoice_number','')} for {inv.get('client_name','')}\n"
        f"Total: ${float(inv.get('total') or 0):,.2f}\n"
        f"Period: {start} to {end}\n"
        f"Tickets in period: {len(tix)} ({critical} critical)\n"
        f"Devices managed: {devices}\n"
        f"Line items:\n{items_text}\n"
    )
    body = await _llm(system, user_msg, "invexp")
    return {
        "invoice_id": invoice_id,
        "invoice_number": inv.get("invoice_number"),
        "summary": body.strip() if isinstance(body, str) else str(body),
        "stats": {"tickets": len(tix), "critical": critical, "devices": devices, "period_start": start, "period_end": end},
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
