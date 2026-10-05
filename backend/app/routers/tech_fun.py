"""Tech Toolbox API: the delight layer endpoints (fun with guardrails).

All endpoints are authenticated and self- or tenant-scoped; points always flow
through the append-only ledger and hidden badges through the shared award
store, so the fun layer never creates a second source of truth.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.auth import get_current_user
from app.database import db
from app.services import (
    nexus_certainty,
    nexus_connector,
    nexus_genome,
    nexus_insight,
    nexus_intent,
    nexus_ledger,
    nexus_ops_layer,
    nexus_protocol,
    qol_tools,
    tech_fun,
)
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query
from app.services.tech_rewards import points_summary

router = APIRouter()


def _user_id(current_user: dict) -> str:
    return str(current_user.get("id") or "")


@router.get("/tech-fun/me")
async def tech_fun_me(current_user: dict = Depends(get_current_user)):
    """Everything the profile fun strip renders, in one call."""
    uid = _user_id(current_user)
    name = str(current_user.get("name") or "")
    ledger = await db.tech_points_ledger.find({"user_id": uid}, {"_id": 0}).to_list(2000)
    summary = points_summary(ledger)
    state = await tech_fun.fun_state(db, uid)
    profile = await db.users.find_one({"id": uid}, {"_id": 0, "equipped_pet": 1}) or {}
    return {
        "streak": await tech_fun.activity_streak(db, uid, name),
        "pet_evolution": tech_fun.pet_evolution(summary.get("lifetime_earned") or 0),
        "has_pet": bool(profile.get("equipped_pet")),
        "focus": {
            "active": bool(state.get("focus_until")),
            "focus_until": state.get("focus_until"),
        },
        "coin_available_today": state.get("coin_last") != datetime.now(timezone.utc).date().isoformat(),
        "wheel_streak": int(state.get("wheel_streak") or 0),
    }


@router.post("/tech-fun/easter-egg/{egg_key}")
async def trigger_easter_egg(egg_key: str, current_user: dict = Depends(get_current_user)):
    """Fire a hidden easter egg; awards the matching hidden badge when one exists."""
    badge_key = tech_fun.EVENT_EGG_KEYS.get(egg_key)
    if egg_key not in tech_fun.EVENT_EGG_KEYS:
        raise HTTPException(status_code=404, detail="Unknown egg")
    result = {"egg": egg_key, "message": "Permission denied. Nice try." if egg_key == "sudo" else "Delight dispatched."}
    if badge_key:
        result.update(await tech_fun.award_hidden_badge(db, current_user, badge_key))
    return result


@router.post("/tech-fun/lucky-coin")
async def claim_lucky_coin(current_user: dict = Depends(get_current_user)):
    """Claim the once-a-day lucky coin drop into the points ledger."""
    tenant_id = platform_tenant_id(current_user)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Platform tenant required for points awards")
    return await tech_fun.lucky_coin(db, current_user, tenant_id)


@router.post("/tech-fun/wheel-spin")
async def spin_wheel(current_user: dict = Depends(get_current_user)):
    """Assign the oldest unassigned in-scope open ticket to the caller."""
    tenant_id = platform_tenant_id(current_user)
    return await tech_fun.wheel_spin(db, current_user, tenant_id)


@router.get("/tech-fun/focus")
async def get_focus(current_user: dict = Depends(get_current_user)):
    state = await tech_fun.fun_state(db, _user_id(current_user))
    return {"active": bool(state.get("focus_until")), "focus_until": state.get("focus_until")}


@router.post("/tech-fun/focus")
async def start_focus(data: dict, current_user: dict = Depends(get_current_user)):
    """Go dark: suppress non-urgent pings for a bounded focus window."""
    minutes = int((data or {}).get("minutes") or 60)
    return await tech_fun.set_focus(db, current_user, minutes)


@router.delete("/tech-fun/focus")
async def stop_focus(current_user: dict = Depends(get_current_user)):
    """End the focus window; a full 25+ minute session earns a small bonus."""
    tenant_id = platform_tenant_id(current_user)
    return await tech_fun.end_focus(db, current_user, tenant_id)


@router.get("/tech-fun/season")
async def season(current_user: dict = Depends(get_current_user)):
    """Current monthly points standings plus past-season hall of fame."""
    return await tech_fun.season_standings(db, platform_tenant_id(current_user))


@router.get("/tech-fun/win-wall")
async def win_wall(current_user: dict = Depends(get_current_user)):
    """Recent closed-ticket wins within the caller's client scope."""
    return {"wins": await tech_fun.win_wall(db, current_user)}


@router.get("/tech-fun/network-weather")
async def network_weather(current_user: dict = Depends(get_current_user)):
    """Per-client weather derived from live device status and last-seen data."""
    return await tech_fun.network_weather(db, current_user)


@router.get("/tech-fun/speedruns/{template_id}")
async def speedruns(template_id: str, current_user: dict = Depends(get_current_user)):
    """Fastest completed checklist runs for one onboarding template."""
    return await tech_fun.speedruns(db, current_user, template_id)


@router.get("/tech-fun/qr")
async def qr_svg(data: str = Query(..., max_length=512), current_user: dict = Depends(get_current_user)):
    """Render a QR code server-side for printable device/cable labels."""
    if not data.startswith(("https://", "http://")):
        raise HTTPException(status_code=400, detail="QR data must be an http(s) URL")
    import qrcode

    qr = qrcode.QRCode(border=2, box_size=8)
    qr.add_data(data)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    size = len(matrix)
    rects = "".join(
        f'<rect x="{x}" y="{y}" width="1" height="1"/>'
        for y, row in enumerate(matrix)
        for x, dark in enumerate(row)
        if dark
    )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'shape-rendering="crispEdges"><rect width="{size}" height="{size}" fill="#fff"/>'
        f'<g fill="#000">{rects}</g></svg>'
    )
    return Response(content=svg, media_type="image/svg+xml")


@router.post("/tech-fun/translator")
async def translate_note(data: dict, current_user: dict = Depends(get_current_user)):
    """Professionalise a venting note or convert jargon into customer language.

    Rule-based and on-server: note text never leaves the installation and the
    result is always an editable draft.
    """
    payload = data or {}
    mode = str(payload.get("mode") or "").strip()
    text = str(payload.get("text") or "")
    if not text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > 4000:
        raise HTTPException(status_code=400, detail="text is too long to translate")
    try:
        result = qol_tools.translate(text, mode)
    except ValueError:
        raise HTTPException(status_code=400, detail="mode must be 'professionalise' or 'customer'")
    return {"mode": mode, "original": text, "result": result}


@router.get("/tech-fun/is-it-dns")
async def is_it_dns(current_user: dict = Depends(get_current_user)):
    """Run the full DNS diagnostic chain on real names in scope. YES or NO."""
    return await tech_fun.is_it_dns(db, current_user)


@router.get("/tech-fun/verify-report")
async def verify_report(
    device_id: str = Query(..., max_length=64),
    window_hours: int = Query(24, ge=1, le=168),
    current_user: dict = Depends(get_current_user),
):
    """Evidence summary for a customer's connectivity claim (facts, not snark)."""
    return await tech_fun.verify_user_report(db, current_user, device_id, window_hours)


@router.get("/tech-fun/boss-battles")
async def boss_battles(current_user: dict = Depends(get_current_user)):
    """Tickets open absurdly long, framed as boss fights."""
    return {"battles": await tech_fun.boss_battles(db, current_user)}


@router.get("/tech-fun/device-personality/{device_id}")
async def device_personality(device_id: str, current_user: dict = Depends(get_current_user)):
    """Generated history and a gentle lifecycle nudge for a long-lived machine."""
    result = await tech_fun.device_personality(db, current_user, device_id)
    if result.get("unicorn"):
        result.update(await tech_fun.award_hidden_badge(db, current_user, "uptime_unicorn"))
    return result


@router.get("/tech-fun/celebrations")
async def celebrations(current_user: dict = Depends(get_current_user)):
    """Queue status: inbox-zero celebrations and upcoming milestones."""
    return await tech_fun.celebrations(db, current_user, str(current_user.get("name") or ""))


# ============== SHIFT INTELLIGENCE ==============


@router.get("/tech-fun/can-i-go-home")
async def can_i_go_home(current_user: dict = Depends(get_current_user)):
    """The end-of-day checklist, answered from live evidence."""
    return await tech_fun.can_i_go_home(db, current_user, str(current_user.get("name") or ""))


@router.get("/tech-fun/weekend-risk")
async def weekend_risk(current_user: dict = Depends(get_current_user)):
    """What could ruin the weekend."""
    return await tech_fun.weekend_risk(db, current_user)


@router.get("/tech-fun/caught-up")
async def caught_up(
    hours: int = Query(24, ge=1, le=24 * 14),
    current_user: dict = Depends(get_current_user),
):
    """What did I miss? Digest after lunch or annual leave."""
    return await tech_fun.caught_up(db, current_user, str(current_user.get("name") or ""), hours)


# ============== OPERATIONAL MEMORY ==============


@router.post("/tech-fun/memory")
async def pin_memory(data: dict, current_user: dict = Depends(get_current_user)):
    """📌 Nexus must remember this — knowledge attached to an object."""
    payload = data or {}
    object_type = str(payload.get("object_type") or "").strip()
    object_id = str(payload.get("object_id") or "").strip()
    text = str(payload.get("text") or "").strip()
    if not object_type or not object_id or not text:
        raise HTTPException(status_code=400, detail="object_type, object_id and text are required")
    if len(text) > 2000:
        raise HTTPException(status_code=400, detail="text is too long")
    return await tech_fun.pin_memory(db, current_user, object_type=object_type, object_id=object_id, text=text)


@router.get("/tech-fun/memory")
async def list_memory(
    object_type: str = Query(""),
    object_id: str = Query(""),
    current_user: dict = Depends(get_current_user),
):
    """Pinned operational knowledge for an object (tenant-scoped)."""
    if not object_type or not object_id:
        raise HTTPException(status_code=400, detail="object_type and object_id are required")
    return {"memories": await tech_fun.list_memory(db, current_user, object_type, object_id)}


# ============== CHANGE RISK / FEEDBACK / LABS ==============


@router.post("/tech-fun/change-risk")
async def change_risk(data: dict, current_user: dict = Depends(get_current_user)):
    """Explainable risk score for a proposed change on a device."""
    payload = data or {}
    device_id = str(payload.get("device_id") or "").strip()
    description = str(payload.get("description") or "").strip()
    if not device_id or not description:
        raise HTTPException(status_code=400, detail="device_id and description are required")
    result = await tech_fun.change_risk_score(db, current_user, device_id=device_id, description=description)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Device not found in your scope")
    return result


@router.post("/tech-fun/feedback")
async def record_feedback(data: dict, current_user: dict = Depends(get_current_user)):
    """The 'Nope' button: technicians correct Nexus so it learns from outcomes."""
    payload = data or {}
    verdict = str(payload.get("verdict") or "").strip()
    allowed = {"wrong_root_cause", "wrong_remediation", "missing_information", "unsafe_recommendation", "other"}
    if verdict not in allowed:
        raise HTTPException(status_code=400, detail=f"verdict must be one of {sorted(allowed)}")
    return await tech_fun.record_feedback(
        db, current_user,
        source_type=str(payload.get("source_type") or "").strip()[:40],
        source_id=str(payload.get("source_id") or "").strip()[:64],
        verdict=verdict,
        note=str(payload.get("note") or ""),
    )


@router.get("/tech-fun/labs")
async def get_labs(current_user: dict = Depends(get_current_user)):
    """🧪 Nexus Labs: experimental capabilities, opt-in per tenant."""
    return {"flags": await tech_fun.labs_flags(db)}


@router.put("/tech-fun/labs")
async def update_labs(data: dict, current_user: dict = Depends(get_current_user)):
    """Toggle experimental capabilities (admin only, audited)."""
    if not (current_user.get("is_admin") or current_user.get("role") == "admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    flags = await tech_fun.set_labs_flags(db, data.get("flags") or {})
    return {"flags": flags}


# ============== CONTEXT-AWARENESS ==============


@router.get("/tech-fun/alert-triage/{alert_id}")
async def alert_triage(alert_id: str, current_user: dict = Depends(get_current_user)):
    """Why am I looking at this? / Should I care? — verdict with evidence."""
    result = await tech_fun.alert_triage(db, current_user, alert_id)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Alert not found in your scope")
    return result


@router.get("/tech-fun/blast-radius/{device_id}")
async def blast_radius(device_id: str, current_user: dict = Depends(get_current_user)):
    """If this device fails, what is affected?"""
    result = await tech_fun.blast_radius(db, current_user, device_id)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Device not found in your scope")
    return result


@router.post("/tech-fun/work-lock")
async def acquire_work_lock(data: dict, current_user: dict = Depends(get_current_user)):
    """'Before you touch it' — a soft lock so two technicians never fight over a device."""
    payload = data or {}
    device_id = str(payload.get("device_id") or "").strip()
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id is required")
    try:
        minutes = int(payload.get("minutes") or 30)
    except (TypeError, ValueError):
        minutes = 30
    return await tech_fun.acquire_work_lock(
        db, current_user, str(current_user.get("name") or ""),
        device_id=device_id, ticket_id=str(payload.get("ticket_id") or ""),
        note=str(payload.get("note") or ""), minutes=minutes,
        force=bool(payload.get("force")),
    )


@router.get("/tech-fun/work-lock/{device_id}")
async def work_lock_status(device_id: str, current_user: dict = Depends(get_current_user)):
    """Who else is here, what is scheduled, what is already open on this device."""
    return await tech_fun.work_lock_status(db, current_user, device_id)


@router.get("/tech-fun/handover")
async def handover(current_user: dict = Depends(get_current_user)):
    """The end-of-shift digest: active issues, waiting customers, running work."""
    return await tech_fun.handover(db, current_user, str(current_user.get("name") or ""))


@router.get("/tech-fun/customer-cost/{client_id}")
async def customer_cost_report(client_id: str, current_user: dict = Depends(get_current_user)):
    """Why is this customer expensive? Demand vs peers with cost drivers."""
    result = await tech_fun.customer_cost_report(db, current_user, client_id)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Customer not found in your scope")
    return result


# ============== INSIGHT LAYER ("features MSPs don't realise they want") ==============


@router.get("/tech-fun/baseline/{device_id}")
async def behaviour_baseline(device_id: str, current_user: dict = Depends(get_current_user)):
    """What is normal for THIS device? Behaviour bands with honest evidence notes."""
    result = await nexus_insight.behaviour_baseline(db, current_user, device_id)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Device not found in your scope")
    return result


@router.get("/tech-fun/anomaly-scan")
async def anomaly_scan(
    client_id: str | None = None,
    hours: int = Query(default=48, ge=1, le=720),
    current_user: dict = Depends(get_current_user),
):
    """'Show me weird shit' — statistically unusual, not necessarily broken."""
    return await nexus_insight.anomaly_scan(db, current_user, str(current_user.get("name") or ""), client_id, hours)


@router.get("/tech-fun/timeline")
async def universal_timeline(
    hours: int = Query(default=24, ge=1, le=720),
    user_filter: str = "",
    device_filter: str = "",
    client_filter: str = "",
    limit: int = Query(default=100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    """One universal timeline: activity, alerts, tickets, sessions, automation, billing."""
    return await nexus_insight.universal_timeline(
        db, current_user, str(current_user.get("name") or ""), hours=hours,
        user_filter=user_filter, device_filter=device_filter, client_filter=client_filter, limit=limit,
    )


@router.get("/tech-fun/universal-search")
async def universal_search(
    q: str = "",
    limit: int = Query(default=8, ge=1, le=25),
    current_user: dict = Depends(get_current_user),
):
    """One search box for the entire MSP: phone, serial, IP, email, invoice number."""
    return await nexus_insight.universal_search(db, current_user, q, limit)


@router.get("/tech-fun/session-sidecar/{device_id}")
async def session_sidecar(device_id: str, current_user: dict = Depends(get_current_user)):
    """Everything a technician needs beside the remote session, in one call."""
    result = await nexus_insight.session_sidecar(db, current_user, device_id)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Device not found in your scope")
    return result


@router.get("/tech-fun/while-youre-there/{client_id}")
async def while_youre_there(client_id: str, current_user: dict = Depends(get_current_user)):
    """Since you're here… everything worth physically doing at this customer."""
    result = await nexus_insight.while_youre_there(db, current_user, client_id)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Customer not found in your scope")
    return result


@router.get("/tech-fun/dependency-horizon")
async def dependency_horizon(
    days: int = Query(default=90, ge=7, le=365),
    current_user: dict = Depends(get_current_user),
):
    """What becomes somebody else's emergency in the next N days if we ignore it?"""
    return await nexus_insight.dependency_horizon(db, current_user, days)


@router.get("/tech-fun/agreement-margin/{client_id}")
async def agreement_margin(client_id: str, current_user: dict = Depends(get_current_user)):
    """'You're giving this customer away' — agreement value versus delivery cost."""
    result = await nexus_insight.agreement_margin(db, current_user, client_id)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Customer not found in your scope")
    return result


@router.post("/tech-fun/technical-debt")
async def record_technical_debt(data: dict, current_user: dict = Depends(get_current_user)):
    """'Future Me Will Hate Me' — record the temporary fix before it becomes permanent."""
    payload = data or {}
    title = str(payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    return await nexus_insight.record_technical_debt(
        db, current_user, str(current_user.get("name") or ""), payload
    )


@router.get("/tech-fun/technical-debt")
async def technical_debt_report(
    client_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Recorded temporary fixes, due reviews, and estate-level debt indicators."""
    return await nexus_insight.technical_debt_report(db, current_user, client_id)


# ============== CERTAINTY LAYER (unknowns, proof, confidence, laws) ==============


@router.get("/tech-fun/knowledge-coverage")
async def knowledge_coverage(
    client_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """'What don't we know?' — unknowns are themselves a risk. Reduce Unknowns → 100%."""
    return await nexus_certainty.knowledge_coverage(db, current_user, client_id)


@router.get("/tech-fun/prove-it")
async def prove_it(
    claim: str,
    subject_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Nexus does not repeat claims — it gathers evidence and shows its work."""
    result = await nexus_certainty.prove_it(db, current_user, claim, subject_id)
    if not result.get("found", True):
        raise HTTPException(status_code=404, detail="No evidence source for that claim/subject in your scope")
    return result


@router.get("/tech-fun/confidence/{object_type}/{object_id}")
async def confidence_report(object_type: str, object_id: str, current_user: dict = Depends(get_current_user)):
    """Click the confidence score to see why Nexus believes it."""
    result = await nexus_certainty.confidence_report(db, current_user, object_type, object_id)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Object not found in your scope")
    return result


@router.get("/tech-fun/ticket-difficulty/{ticket_id}")
async def ticket_difficulty(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Predicted complexity, time and skill BEFORE assignment."""
    result = await nexus_certainty.ticket_difficulty(db, current_user, ticket_id)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Ticket not found in your scope")
    return result


@router.get("/tech-fun/ticket-gravity/{ticket_id}")
async def ticket_gravity(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Tickets that consume disproportionate organisational attention."""
    result = await nexus_certainty.ticket_gravity(db, current_user, ticket_id)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Ticket not found in your scope")
    return result


@router.get("/tech-fun/escalation-preflight/{ticket_id}")
async def escalation_preflight(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Before L1→L2: what hasn't been checked? Nexus runs what it can itself."""
    result = await nexus_certainty.escalation_preflight(db, current_user, ticket_id)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Ticket not found in your scope")
    return result


@router.get("/tech-fun/noise-budget")
async def noise_budget(current_user: dict = Depends(get_current_user)):
    """Measure every alert source by what technicians actually did about it."""
    return await nexus_certainty.noise_budget(db, current_user)


@router.get("/tech-fun/correlate-tickets")
async def correlate_tickets(
    client_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """One problem, many symptoms — plus work batches for identical remediations."""
    return await nexus_certainty.correlate_tickets(db, current_user, client_id)


@router.get("/tech-fun/audit-readiness")
async def audit_readiness(
    client_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """'Auditor Tomorrow' — controls, gaps and an evidence pack manifest."""
    return await nexus_certainty.audit_readiness(db, current_user, client_id)


@router.get("/tech-fun/laws")
async def list_laws(current_user: dict = Depends(get_current_user)):
    """Nexus Laws: non-negotiable invariants above users, scripts, AI and automations."""
    return await nexus_certainty.list_laws(db, current_user)


@router.post("/tech-fun/laws")
async def record_law(data: dict, current_user: dict = Depends(get_current_user)):
    """Add a custom law (admin only): forbidden action, approval requirement or time window."""
    if not (current_user.get("is_admin") or current_user.get("role") == "admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    try:
        return await nexus_certainty.record_law(db, current_user, data or {})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/tech-fun/laws/evaluate")
async def evaluate_action(data: dict, current_user: dict = Depends(get_current_user)):
    """Deterministic pre-action gate. Blocked beats approval beats allowed."""
    return await nexus_certainty.evaluate_action(db, current_user, data or {})


@router.post("/tech-fun/credential-scan")
async def credential_scan(data: dict, current_user: dict = Depends(get_current_user)):
    """'Absolutely not.' — detect credentials in a draft; the secret is never echoed back."""
    return await nexus_certainty.credential_scan(db, current_user, str((data or {}).get("text") or ""))


@router.get("/tech-fun/ticket-reality-check/{ticket_id}")
async def ticket_reality_check(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Urgency punctuation, definition of insanity, 'nobody changed anything', 'it never worked'."""
    result = await nexus_certainty.ticket_reality_check(db, current_user, ticket_id)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Ticket not found in your scope")
    return result


@router.get("/tech-fun/presence-effect")
async def presence_effect(current_user: dict = Depends(get_current_user)):
    """Problems mysteriously fixed by a technician connecting — tracked as a statistic."""
    return await nexus_certainty.presence_effect(db, current_user)


# ============== OPERATING LAYER (commander, consequence, memory) ==============


@router.post("/tech-fun/consequence")
async def consequence_model(data: dict, current_user: dict = Depends(get_current_user)):
    """Nexus Consequence Engine: what does clicking this button mean to the business?"""
    payload = data or {}
    if not str(payload.get("target_id") or "").strip():
        raise HTTPException(status_code=400, detail="target_id is required")
    result = await nexus_ops_layer.consequence_model(db, current_user, payload)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Target not found in your scope")
    return result


@router.get("/tech-fun/morning-commander")
async def morning_commander(current_user: dict = Depends(get_current_user)):
    """Not another dashboard — Nexus decides what matters today."""
    return await nexus_ops_layer.morning_commander(db, current_user, str(current_user.get("name") or ""))


@router.get("/tech-fun/end-my-day")
async def end_my_day(current_user: dict = Depends(get_current_user)):
    """Before you finish: what must not be left behind."""
    return await nexus_ops_layer.end_my_day(db, current_user, str(current_user.get("name") or ""))


@router.post("/tech-fun/decisions")
async def record_decision(data: dict, current_user: dict = Depends(get_current_user)):
    """Decision log: record why the recommendation wasn't followed, before everyone forgets."""
    payload = data or {}
    if not str(payload.get("decision") or "").strip():
        raise HTTPException(status_code=400, detail="decision is required")
    return await nexus_ops_layer.record_decision(db, current_user, str(current_user.get("name") or ""), payload)


@router.get("/tech-fun/decisions")
async def list_decisions(client_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """The MSP's institutional memory of deliberate choices."""
    return await nexus_ops_layer.list_decisions(db, current_user, client_id)


@router.post("/tech-fun/risk-acceptances")
async def record_risk_acceptance(data: dict, current_user: dict = Depends(get_current_user)):
    """Risk Acceptance objects — owner, expiry and compensating controls, not ticket notes."""
    payload = data or {}
    if not str(payload.get("title") or "").strip():
        raise HTTPException(status_code=400, detail="title is required")
    return await nexus_ops_layer.record_risk_acceptance(db, current_user, str(current_user.get("name") or ""), payload)


@router.get("/tech-fun/risk-acceptances")
async def list_risk_acceptances(client_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """Accepted risks with review dates — deliberate, never forgotten."""
    return await nexus_ops_layer.list_risk_acceptances(db, current_user, client_id)


@router.get("/tech-fun/we-told-you")
async def we_told_you(
    client_id: str | None = None,
    device_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Prior Recommendation Evidence: recommendation → decision → accepted risk → incident."""
    return await nexus_ops_layer.we_told_you(db, current_user, client_id, device_id)


# ============== NETWORK PRIMITIVES (intent, genome, connector, ledger) ==============


@router.post("/tech-fun/intents")
async def record_intent(data: dict, current_user: dict = Depends(get_current_user)):
    """Intent OS: state the business outcome; Nexus compiles it into checkable controls."""
    payload = data or {}
    if not str(payload.get("statement") or "").strip():
        raise HTTPException(status_code=400, detail="statement is required")
    result = await nexus_intent.record_intent(db, current_user, str(current_user.get("name") or ""), payload)
    if not result.get("found"):
        raise HTTPException(status_code=400, detail=result.get("error") or "invalid intent")
    return result


@router.get("/tech-fun/intents")
async def list_intents(client_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """Active business intents in your scope."""
    return await nexus_intent.list_intents(db, current_user, client_id)


@router.get("/tech-fun/intent-evaluation")
async def evaluate_intents(client_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """Continuous desired state: every intent's controls evaluated against live data."""
    return await nexus_intent.evaluate_intents(db, current_user, client_id)


@router.post("/tech-fun/intent-suggest")
async def suggest_intent_controls(data: dict, current_user: dict = Depends(get_current_user)):
    """Compile plain-English intent into suggested controls (suggestions, never auto-recorded)."""
    statement = str((data or {}).get("statement") or "").strip()
    if not statement:
        raise HTTPException(status_code=400, detail="statement is required")
    return {"suggested_controls": nexus_intent.suggest_controls(statement),
            "known_controls": nexus_intent.known_controls()}


@router.post("/tech-fun/genome/patterns")
async def contribute_genome_pattern(data: dict, current_user: dict = Depends(get_current_user)):
    """Contribute one anonymised outcome tuple to the Nexus IT Genome."""
    payload = data or {}
    result = await nexus_genome.contribute_pattern(db, current_user, str(current_user.get("name") or ""), payload)
    if not result.get("found"):
        raise HTTPException(status_code=400, detail=result.get("error") or "invalid pattern")
    return result


@router.get("/tech-fun/genome/contribution")
async def genome_contribution(current_user: dict = Depends(get_current_user)):
    """What this environment contributed, and the privacy guarantees in force."""
    return await nexus_genome.contribution_report(db, current_user)


@router.get("/tech-fun/genome/emerging-issues")
async def genome_emerging_issues(
    window_days: int = Query(14, ge=1, le=90),
    current_user: dict = Depends(get_current_user),
):
    """Emerging failure patterns with lift vs baseline — k-anonymised aggregates only."""
    return await nexus_genome.emerging_issues(db, current_user, window_days=window_days)


@router.get("/tech-fun/genome/insights")
async def genome_insights(
    symptom: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """What normally causes this symptom, and which fixes actually work."""
    return await nexus_genome.genome_insights(db, current_user, symptom)


@router.get("/tech-fun/connector/capabilities")
async def connector_capabilities(current_user: dict = Depends(get_current_user)):
    """The stable capability verbs workflows are written against."""
    return nexus_connector.list_capabilities()


@router.get("/tech-fun/connector/adapters")
async def connector_adapters(current_user: dict = Depends(get_current_user)):
    """Which vendor adapters implement which verbs — wired status never exaggerated."""
    return nexus_connector.list_adapters()


@router.get("/tech-fun/connector/coverage")
async def connector_coverage(current_user: dict = Depends(get_current_user)):
    """Capability coverage: what is portable today, and where a single vendor is a risk."""
    return nexus_connector.capability_coverage()


@router.post("/tech-fun/connector/translate")
async def connector_translate(data: dict, current_user: dict = Depends(get_current_user)):
    """Resolve a capability verb to a vendor-specific operation plan (plan, not execution)."""
    payload = data or {}
    result = nexus_connector.translate(str(payload.get("verb") or ""), str(payload.get("adapter") or ""))
    if not result.get("found"):
        raise HTTPException(status_code=404, detail=result.get("error") or "no translation")
    return result


@router.post("/tech-fun/connector/swap-plan")
async def connector_swap_plan(data: dict, current_user: dict = Depends(get_current_user)):
    """What changing the vendor under a workflow actually touches."""
    payload = data or {}
    result = nexus_connector.swap_plan(
        str(payload.get("verb") or ""),
        str(payload.get("from_adapter") or ""),
        str(payload.get("to_adapter") or ""),
    )
    if not result.get("found"):
        raise HTTPException(status_code=404, detail=result.get("error") or "no swap plan")
    return result


@router.post("/tech-fun/ledger/usage")
async def record_usage(data: dict, current_user: dict = Depends(get_current_user)):
    """Record a usage meter event — idempotent, ready for marketplace rating."""
    payload = data or {}
    result = await nexus_ledger.record_usage(db, current_user, str(current_user.get("name") or ""), payload)
    if not result.get("found"):
        raise HTTPException(status_code=400, detail=result.get("error") or "invalid usage event")
    return result


@router.get("/tech-fun/ledger/usage")
async def usage_summary(meter: str | None = None, current_user: dict = Depends(get_current_user)):
    """Recorded usage totals per meter."""
    return await nexus_ledger.usage_summary(db, current_user, meter)


@router.post("/tech-fun/ledger/entries")
async def post_ledger_entries(data: dict, current_user: dict = Depends(get_current_user)):
    """Post a balanced double-entry transaction — append-only, hash-chained."""
    payload = data or {}
    result = await nexus_ledger.post_entries(db, current_user, str(current_user.get("name") or ""), payload)
    if not result.get("found"):
        raise HTTPException(status_code=400, detail=result.get("error") or "invalid transaction")
    return result


@router.get("/tech-fun/ledger/balance")
async def ledger_balance(account: str, current_user: dict = Depends(get_current_user)):
    """Net position of one ledger account."""
    result = await nexus_ledger.account_balance(db, current_user, account)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail=result.get("error") or "account not found")
    return result


@router.get("/tech-fun/ledger/statement")
async def ledger_statement(account: str | None = None, current_user: dict = Depends(get_current_user)):
    """Append-only statement across ledger accounts."""
    return await nexus_ledger.statement(db, current_user, account)


@router.post("/tech-fun/ledger/revenue-share")
async def revenue_share_preview(data: dict, current_user: dict = Depends(get_current_user)):
    """Preview marketplace revenue share from recorded usage × a supplied rate."""
    payload = data or {}
    result = await nexus_ledger.revenue_share_preview(db, current_user, payload)
    if not result.get("found"):
        raise HTTPException(status_code=400, detail=result.get("error") or "invalid preview")
    return result


# ============== NEXUS PROTOCOL (standard objects, actions, certification) ==============


@router.get("/tech-fun/protocol")
async def protocol_spec(current_user: dict = Depends(get_current_user)):
    """The Nexus Protocol manifest: standard objects, standard actions, certification."""
    return nexus_protocol.protocol_manifest()


@router.get("/tech-fun/protocol/objects")
async def protocol_objects(current_user: dict = Depends(get_current_user)):
    """Standard protocol objects with their stable Nexus IDs."""
    return nexus_protocol.list_objects()


@router.get("/tech-fun/protocol/actions")
async def protocol_actions(current_user: dict = Depends(get_current_user)):
    """The ten standard actions and what each means."""
    return nexus_protocol.list_actions()


@router.get("/tech-fun/protocol/coverage")
async def platform_protocol_coverage(current_user: dict = Depends(get_current_user)):
    """How much of the protocol the platform itself speaks today — honestly."""
    return nexus_protocol.platform_coverage()


@router.post("/tech-fun/protocol/validate-action")
async def validate_protocol_action(data: dict, current_user: dict = Depends(get_current_user)):
    """Validate one proposed action against the canonical action descriptor (P0 #1)."""
    return nexus_protocol.validate_action_descriptor(data or {})


@router.get("/tech-fun/protocol/conformance")
async def protocol_conformance(
    adapter: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Nexus Native conformance board — verified/partial/unverified, gaps published."""
    return await nexus_protocol.conformance_board(db, current_user, adapter)


@router.post("/tech-fun/protocol/reviews")
async def record_certification_review(data: dict, current_user: dict = Depends(get_current_user)):
    """Record a certification review — admin only; declarations never certify."""
    if not (current_user.get("is_admin") or current_user.get("role") == "admin"):
        raise HTTPException(status_code=403, detail="admin access required")
    result = await nexus_protocol.record_review(
        db, current_user, str(current_user.get("name") or ""), data or {})
    if not result.get("found"):
        raise HTTPException(status_code=400, detail=result.get("error") or "invalid review")
    return result


@router.get("/tech-fun/protocol/reviews")
async def list_certification_reviews(
    adapter: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Recorded certification reviews in your tenant scope."""
    return await nexus_protocol.list_reviews(db, current_user, adapter)
