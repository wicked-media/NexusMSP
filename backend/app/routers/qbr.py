"""QBR Auto-Generator â€” Quarterly Business Reviews drafted by Claude Sonnet 4.5.

For a given client + quarter, gather:
  â€¢ Ticket volume + categories + SLA performance + top issues
  â€¢ Device health (online/warning/offline counts)
  â€¢ Backup health
  â€¢ Active alerts + critical incidents
  â€¢ Cross-client pattern surges that affected this client (Blueprint Insights bridge)
  â€¢ Invoice / spend totals
Then ask Claude to write a 6-section QBR ready for client delivery, plus a structured
JSON for the frontend to render + export to branded PDF.

Endpoints:
  GET  /api/qbr/{client_id}?quarter=2026-Q1   -- preview/draft the QBR
  POST /api/qbr/{client_id}/save              -- persist a generated QBR
  GET  /api/qbr/{client_id}/list              -- prior QBRs for this client
  GET  /api/qbr/{qbr_id}/pdf?token=...        -- branded PDF download
"""
from fastapi import APIRouter, HTTPException, Depends, Query
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


def _quarter_window(label: str | None):
    """Parse '2026-Q1' or default to the most recently completed quarter."""
    now = datetime.now(timezone.utc)
    if label:
        m = re.match(r"^(\d{4})-Q([1-4])$", label.strip().upper())
        if not m:
            raise HTTPException(400, "quarter must be YYYY-Q[1-4]")
        year = int(m.group(1))
        q = int(m.group(2))
    else:
        # most recently completed quarter relative to today
        cur_q = (now.month - 1) // 3 + 1
        if cur_q == 1:
            year = now.year - 1
            q = 4
        else:
            year = now.year
            q = cur_q - 1
    start_month = (q - 1) * 3 + 1
    start = datetime(year, start_month, 1, tzinfo=timezone.utc)
    if q == 4:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, start_month + 3, 1, tzinfo=timezone.utc)
    return f"{year}-Q{q}", start, end


async def _gather_qbr_data(client_id: str, start: datetime, end: datetime):
    """Aggregate raw operational data for the client across the quarter."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")

    s_iso = start.isoformat()
    e_iso = end.isoformat()

    # Tickets opened in the quarter
    tix = await db.tickets.find({
        "client_id": client_id,
        "$or": [
            {"created_at": {"$gte": s_iso, "$lt": e_iso}},
            {"resolved_at": {"$gte": s_iso, "$lt": e_iso}},
            {"updated_at": {"$gte": s_iso, "$lt": e_iso}},
        ],
    }, {"_id": 0, "id": 1, "title": 1, "priority": 1, "category": 1, "status": 1,
        "created_at": 1, "resolved_at": 1, "sla_breached": 1, "ticket_number": 1}).limit(2000).to_list(2000)

    by_priority = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    by_category = {}
    sla_breaches = 0
    resolved_this_q = 0
    for t in tix:
        p = (t.get("priority") or "medium").lower()
        if p in by_priority:
            by_priority[p] += 1
        cat = (t.get("category") or "support").lower()
        by_category[cat] = by_category.get(cat, 0) + 1
        if t.get("sla_breached"):
            sla_breaches += 1
        if t.get("status") in ("resolved", "closed") and (t.get("resolved_at") or t.get("updated_at", "") >= s_iso):
            resolved_this_q += 1

    top_issues = sorted(by_category.items(), key=lambda kv: -kv[1])[:5]

    # Device health snapshot (live)
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0, "id": 1, "status": 1, "device_type": 1}).to_list(500)
    dev_online = sum(1 for d in devices if d.get("status") == "online")
    dev_warning = sum(1 for d in devices if d.get("status") == "warning")
    dev_offline = sum(1 for d in devices if d.get("status") == "offline")

    # Backup health
    bk_failed = await db.backup_status.count_documents({"client_id": client_id, "backup_health": "failed"}) if "backup_status" in await db.list_collection_names() else 0
    bk_ok = await db.backup_status.count_documents({"client_id": client_id, "backup_health": {"$in": ["healthy", "ok"]}}) if "backup_status" in await db.list_collection_names() else 0

    # Active critical alerts
    alerts = await db.alerts.count_documents({"client_id": client_id, "severity": "critical"}) if "alerts" in await db.list_collection_names() else 0

    # Spend
    invoices = await db.invoices.find({
        "client_id": client_id,
        "issue_date": {"$gte": s_iso[:10], "$lt": e_iso[:10]},
    }, {"_id": 0, "total": 1, "status": 1}).to_list(500)
    spend_total = sum(float(i.get("total") or 0) for i in invoices)

    # Cross-client patterns that touched this client this quarter
    pattern_hits = []
    try:
        from app.routers.blueprints import _bigrams, _tokens
        cross_tix = await db.tickets.find({
            "status": {"$in": ["resolved", "closed"]},
            "$or": [
                {"resolved_at": {"$gte": s_iso, "$lt": e_iso}},
                {"updated_at": {"$gte": s_iso, "$lt": e_iso}},
            ],
        }, {"_id": 0, "id": 1, "title": 1, "client_id": 1}).limit(2000).to_list(2000)
        pool = {}
        for t in cross_tix:
            seen = set()
            for bg in _bigrams(_tokens(t.get("title", ""))):
                if bg in seen:
                    continue
                seen.add(bg)
                pool.setdefault(bg, []).append(t)
        # Find patterns where multiple clients are affected AND THIS client is one of them
        for bg, tickets in pool.items():
            clients = {x.get("client_id") for x in tickets if x.get("client_id")}
            if client_id not in clients or len(clients) < 2 or len(tickets) < 3:
                continue
            mine = sum(1 for x in tickets if x.get("client_id") == client_id)
            pattern_hits.append({
                "name": f"{bg[0].title()} {bg[1].title()}",
                "tokens": list(bg),
                "client_tickets": mine,
                "msp_tickets": len(tickets),
                "msp_clients": len(clients),
            })
        pattern_hits.sort(key=lambda p: -p["client_tickets"])
        pattern_hits = pattern_hits[:3]
    except Exception:
        pattern_hits = []

    return {
        "client_name": client.get("name"),
        "tix_total": len(tix),
        "by_priority": by_priority,
        "top_issues": [{"category": c, "count": n} for c, n in top_issues],
        "sla_breaches": sla_breaches,
        "resolved_this_q": resolved_this_q,
        "devices": {"online": dev_online, "warning": dev_warning, "offline": dev_offline, "total": len(devices)},
        "backup": {"healthy": bk_ok, "failed": bk_failed},
        "critical_alerts": alerts,
        "spend": round(spend_total, 2),
        "pattern_hits": pattern_hits,
    }


def _format_qbr_prompt(quarter: str, snap: dict) -> str:
    pat_lines = "\n".join([
        f"  - '{p['name']}': {p['client_tickets']} tickets at this client (this issue affected "
        f"{p['msp_clients']} other MSP clients Â· {p['msp_tickets']} total) â€” recommend rolling out a Blueprint."
        for p in snap.get("pattern_hits", [])
    ]) or "  - none significant"
    top = "\n".join([f"  - {t['category']}: {t['count']}" for t in snap.get("top_issues", [])]) or "  - none"
    return (
        f"CLIENT: {snap['client_name']}\nQUARTER: {quarter}\n\n"
        f"=== TICKETS ===\n"
        f"Total: {snap['tix_total']} | Resolved this quarter: {snap['resolved_this_q']}\n"
        f"By priority: critical={snap['by_priority']['critical']} high={snap['by_priority']['high']} "
        f"medium={snap['by_priority']['medium']} low={snap['by_priority']['low']}\n"
        f"SLA breaches: {snap['sla_breaches']}\n"
        f"Top categories:\n{top}\n\n"
        f"=== INFRASTRUCTURE ===\n"
        f"Devices: {snap['devices']['online']}/{snap['devices']['total']} online Â· "
        f"{snap['devices']['warning']} warning Â· {snap['devices']['offline']} offline\n"
        f"Backups: {snap['backup']['healthy']} healthy Â· {snap['backup']['failed']} failed\n"
        f"Critical alerts: {snap['critical_alerts']}\n\n"
        f"=== FINANCIALS ===\n"
        f"Quarter spend: ${snap['spend']:.2f}\n\n"
        f"=== CROSS-CLIENT PATTERN INSIGHTS (MSP-level intelligence) ===\n"
        f"{pat_lines}\n"
    )


@router.get("/qbr/{client_id}")
async def generate_qbr(client_id: str, quarter: str | None = None, current_user: dict = Depends(get_current_user)):
    """Draft a QBR for the client + quarter. Returns AI prose + structured snapshot."""
    quarter_label, start, end = _quarter_window(quarter)
    snap = await _gather_qbr_data(client_id, start, end)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {
            "quarter": quarter_label,
            "client_id": client_id,
            "client_name": snap["client_name"],
            "stats": snap,
            "ai_brief": "AI briefing unavailable (OPENAI_API_KEY not configured). Stats only.",
            "sections": {},
        }

    system_msg = (
        "You are a senior MSP account manager writing a Quarterly Business Review for a client. "
        "Tone: confident, specific, client-friendly (no internal jargon). Lead with what your MSP "
        "delivered, then risks and recommendations. Reference real numbers from the snapshot. "
        "Return STRICT JSON ONLY with these keys: "
        "'executive_summary' (3-4 sentence narrative), "
        "'key_wins' (array of 3-5 bullet strings), "
        "'incident_breakdown' (1 paragraph + 'sla_assessment' string: 'excellent' | 'on_track' | 'at_risk' | 'breach'), "
        "'infrastructure_health' (1 paragraph), "
        "'risks_and_recommendations' (array of {area, risk, recommendation}), "
        "'msp_intelligence' (paragraph weaving in cross-client pattern insights â€” explain how their "
        "issues compare to peer clients and which standardised Blueprints could reduce future tickets), "
        "'next_quarter_focus' (array of 3-4 bullet strings)."
    )
    user_msg = _format_qbr_prompt(quarter_label, snap) + "\nReturn only the JSON."

    try:
        from app.services.ai_provider import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key,
            session_id=f"qbr-{uuid.uuid4().hex[:8]}",
            system_message=system_msg,
        ).with_model(MODEL_PROVIDER, MODEL_NAME)
        raw = await chat.send_message(UserMessage(text=user_msg))
        text = raw.strip() if isinstance(raw, str) else str(raw)
    except Exception as e:
        raise HTTPException(502, f"AI call failed: {str(e)[:160]}")

    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise HTTPException(502, "AI did not return JSON")
    try:
        sections = json.loads(m.group(0))
    except Exception:
        raise HTTPException(502, "AI returned invalid JSON")

    return {
        "quarter": quarter_label,
        "client_id": client_id,
        "client_name": snap["client_name"],
        "stats": snap,
        "sections": sections,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ai_model": MODEL_NAME,
    }


@router.post("/qbr/{client_id}/save")
async def save_qbr(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Persist a QBR draft (after edits)."""
    quarter = data.get("quarter")
    sections = data.get("sections")
    stats = data.get("stats")
    if not quarter or not sections:
        raise HTTPException(400, "quarter and sections required")

    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    doc = {
        "id": f"qbr-{uuid.uuid4().hex[:12]}",
        "client_id": client_id,
        "client_name": (client or {}).get("name"),
        "quarter": quarter,
        "stats": stats,
        "sections": sections,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "saved_by": current_user.get("name"),
    }
    await db.qbrs.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/qbr/{client_id}/list")
async def list_qbrs(client_id: str, current_user: dict = Depends(get_current_user)):
    items = await db.qbrs.find({"client_id": client_id}, {"_id": 0, "sections": 0, "stats": 0}).sort("saved_at", -1).to_list(50)
    return items


@router.get("/qbrs/{qbr_id}")
async def get_qbr(qbr_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.qbrs.find_one({"id": qbr_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "QBR not found")
    return doc


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PDF generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


async def _qbr_user_from_token(token: str = Query(None)):
    if not token:
        raise HTTPException(401, "Token required")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(401, "User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except Exception:
        raise HTTPException(401, "Invalid token")


def _safe(text) -> str:
    """fpdf default helvetica supports latin-1 only â€” strip/replace unicode."""
    if text is None:
        return ""
    s = str(text)
    repl = {"â€”": "-", "â€“": "-", "â€¢": "*", "â€œ": '"', "â€": '"', "â€˜": "'", "â€™": "'", "â€¦": "...", "â†’": "->", "Â·": "-"}
    for k, v in repl.items():
        s = s.replace(k, v)
    return s.encode("latin-1", "replace").decode("latin-1")


def _render_qbr_pdf(qbr: dict, branding: dict | None = None) -> bytes:
    from fpdf import FPDF

    branding = branding or {}
    company_name = branding.get("company_name") or "NexusOps"
    accent = branding.get("primary_color") or "#10B981"
    # Convert hex â†’ RGB
    try:
        r = int(accent[1:3], 16)
        g = int(accent[3:5], 16)
        b = int(accent[5:7], 16)
    except Exception:
        r, g, b = 16, 185, 129

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    # Cover header
    pdf.set_fill_color(r, g, b)
    pdf.rect(0, 0, 210, 38, "F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_xy(15, 12)
    pdf.cell(180, 8, _safe("Quarterly Business Review"), ln=True)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_xy(15, 22)
    pdf.cell(180, 6, _safe(f"{qbr.get('client_name', '')} - {qbr.get('quarter', '')}"), ln=True)

    pdf.set_text_color(50, 50, 50)
    pdf.set_y(48)

    sections = qbr.get("sections") or {}
    stats = qbr.get("stats") or {}

    def _h(text):
        pdf.ln(4)
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(r, g, b)
        pdf.cell(0, 6, _safe(text), ln=True)
        pdf.set_text_color(40, 40, 40)
        pdf.set_font("Helvetica", "", 10)

    def _p(text):
        if not text:
            return
        pdf.set_x(15)
        pdf.multi_cell(180, 5, _safe(text))
        pdf.ln(1)

    def _bullets(items):
        pdf.set_font("Helvetica", "", 10)
        for it in (items or []):
            pdf.set_x(15)
            pdf.multi_cell(180, 5, "  * " + _safe(it))
        pdf.ln(1)

    _h("Executive Summary")
    _p(sections.get("executive_summary"))

    _h("Key Wins")
    _bullets(sections.get("key_wins"))

    _h("Quarter at a glance")
    by_p = stats.get("by_priority", {})
    devs = stats.get("devices", {})
    bk = stats.get("backup", {})
    pdf.set_font("Helvetica", "", 10)
    _p(
        f"Tickets: {stats.get('tix_total', 0)} (Critical {by_p.get('critical', 0)} Â· "
        f"High {by_p.get('high', 0)} Â· Medium {by_p.get('medium', 0)} Â· Low {by_p.get('low', 0)})"
    )
    _p(f"Resolved this quarter: {stats.get('resolved_this_q', 0)} Â· SLA breaches: {stats.get('sla_breaches', 0)}")
    _p(f"Devices: {devs.get('online', 0)}/{devs.get('total', 0)} online, {devs.get('warning', 0)} warning, {devs.get('offline', 0)} offline")
    _p(f"Backups: {bk.get('healthy', 0)} healthy, {bk.get('failed', 0)} failed")
    _p(f"Spend: ${stats.get('spend', 0):.2f}")

    _h("Incident Breakdown")
    ib = sections.get("incident_breakdown")
    if isinstance(ib, dict):
        _p(ib.get("paragraph") or "")
        if ib.get("sla_assessment"):
            _p(f"SLA assessment: {ib['sla_assessment']}")
    else:
        _p(ib)

    _h("Infrastructure Health")
    _p(sections.get("infrastructure_health"))

    _h("Risks & Recommendations")
    for rr in (sections.get("risks_and_recommendations") or []):
        if isinstance(rr, dict):
            pdf.set_font("Helvetica", "B", 10)
            pdf.cell(0, 5, _safe(rr.get("area", "Item")), ln=True)
            pdf.set_font("Helvetica", "", 10)
            _p(f"Risk: {rr.get('risk', '')}")
            _p(f"Recommendation: {rr.get('recommendation', '')}")
            pdf.ln(1)
        else:
            _p(str(rr))

    _h("MSP Intelligence (Cross-client patterns)")
    _p(sections.get("msp_intelligence"))
    for ph in (stats.get("pattern_hits") or []):
        pdf.set_font("Helvetica", "I", 9)
        pdf.set_text_color(120, 120, 120)
        _p(f"  - {ph['name']}: {ph['client_tickets']} tickets here - also affecting {ph['msp_clients']} other clients")
    pdf.set_text_color(40, 40, 40)

    _h("Focus for Next Quarter")
    _bullets(sections.get("next_quarter_focus"))

    # Footer
    pdf.set_y(-18)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(150, 150, 150)
    pdf.cell(0, 5, _safe(f"Prepared by {company_name} - {qbr.get('saved_by', '')} - {qbr.get('saved_at', qbr.get('generated_at', ''))[:10]}"), align="C")

    return bytes(pdf.output(dest="S"))


@router.get("/qbrs/{qbr_id}/pdf")
async def qbr_pdf(qbr_id: str, user: dict = Depends(_qbr_user_from_token)):
    qbr = await db.qbrs.find_one({"id": qbr_id}, {"_id": 0})
    if not qbr:
        raise HTTPException(404, "QBR not found")
    branding = await db.settings.find_one({"key": "branding"}, {"_id": 0}) or {}
    pdf_bytes = _render_qbr_pdf(qbr, (branding.get("value") or {}))
    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", f"QBR_{qbr.get('client_name', 'client')}_{qbr.get('quarter', '')}")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={safe_name}.pdf"},
    )
