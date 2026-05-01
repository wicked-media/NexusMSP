"""Differentiator features bundle:
  • POST /api/ai/why-on-fire/{entity_type}/{entity_id} — AI senior-engineer triage
  • POST /api/tickets/{ticket_id}/auto-quote        — Conversation -> quote draft
  • GET  /api/threat-radar                          — MSP-wide threat ticker
  • GET  /api/clients/{client_id}/health-certificate.pdf?token=  — printable cert
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

MODEL_PROVIDER = "anthropic"
MODEL_NAME = "claude-sonnet-4-5-20250929"


async def _llm(system: str, user_msg: str, session_prefix: str = "x") -> str:
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(503, "AI not configured")
    from emergentintegrations.llm.chat import LlmChat, UserMessage
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


# ─────────────────────── 1. Why is this on fire? ───────────────────────

@router.post("/ai/why-on-fire/{entity_type}/{entity_id}")
async def why_on_fire(entity_type: str, entity_id: str, current_user: dict = Depends(get_current_user)):
    """Aggregate last 24h of context for a device | ticket | client and ask Claude
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
        return {"diagnosis": "Not enough activity in the last 24h to diagnose anything significant.", "next_steps": [], "severity": "info"}

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


# ─────────────────────── 2. Auto-Quote from Conversation ───────────────────────

@router.post("/tickets/{ticket_id}/auto-quote")
async def auto_quote_from_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Read the ticket conversation + product catalog and draft a quote."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")

    notes = await db.ticket_notes.find({"ticket_id": ticket_id}, {"_id": 0, "body": 1, "author": 1}).sort("created_at", 1).limit(50).to_list(50)
    products = await db.products.find({}, {"_id": 0, "id": 1, "name": 1, "description": 1, "price": 1, "category": 1}).limit(200).to_list(200) if "products" in await db.list_collection_names() else []

    convo = "\n".join([f"  {n.get('author','?')}: {(n.get('body') or '')[:300]}" for n in notes])
    catalog = "\n".join([f"  - {p.get('name')} (${p.get('price', 0)}): {(p.get('description') or '')[:90]}" for p in products[:60]]) or "  (catalog empty — invent reasonable pricing)"

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


# ─────────────────────── 3. Threat Radar ───────────────────────

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


# ─────────────────────── 4. Client Health Certificate PDF ───────────────────────


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
    repl = {"—": "-", "–": "-", "•": "*", "·": "-", "“": '"', "”": '"', "‘": "'", "’": "'", "…": "...", "→": "->", "✓": "v", "✗": "x", "★": "*"}
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
