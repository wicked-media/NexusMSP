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
    nexus_decision_family,
    nexus_device_state,
    nexus_diagnostics,
    nexus_evidence,
    nexus_find,
    nexus_fleet_shell,
    nexus_genome,
    nexus_insight,
    nexus_intent,
    nexus_investigate,
    nexus_ledger,
    nexus_operational_mode,
    nexus_ops_layer,
    nexus_protocol,
    nexus_recorder,
    nexus_rescue,
    nexus_safety_layer,
    nexus_synthetic,
    qol_tools,
    tech_fun,
)
from app.services.scope_permissions import platform_tenant_id
from app.services.tech_rewards import points_summary

router = APIRouter()


def _user_id(current_user: dict) -> str:
    return str(current_user.get("id") or "")


def _guard(result: dict, not_found_detail: str) -> dict:
    """Map the service contract onto HTTP.

    Services report bad input as ``{"found": False, "error": ...}`` (400) and a
    genuinely missing object as ``{"found": False}`` with no error (404). A
    successful read that simply has no ``found`` key passes straight through.
    """
    if result.get("found") is False:
        if result.get("error"):
            raise HTTPException(status_code=400, detail=result["error"])
        raise HTTPException(status_code=404, detail=not_found_detail)
    return result


def _source_list(value: str | None) -> list[str] | None:
    """Parse a comma-separated source filter, or None for every source."""
    if value is None:
        return None
    parts = [part.strip() for part in str(value).split(",") if part.strip()]
    return parts or None


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


# ============== SAFETY UX (P1 #9): WRITING GUARD, WRONG-CUSTOMER, FOUR-EYES ==============


@router.post("/tech-fun/safety/writing-guard")
async def safety_writing_guard(data: dict, current_user: dict = Depends(get_current_user)):
    """Scan a draft for cross-customer references before a human sends it."""
    result = await nexus_safety_layer.writing_guard(db, current_user, data or {})
    if not result.get("found"):
        raise HTTPException(status_code=400, detail=result.get("error") or "invalid draft")
    return result


@router.post("/tech-fun/safety/wrong-customer")
async def safety_wrong_customer(data: dict, current_user: dict = Depends(get_current_user)):
    """Wrong-Customer Protection: is this content safe to send to this customer?"""
    result = await nexus_safety_layer.wrong_customer_check(db, current_user, data or {})
    if not result.get("found"):
        raise HTTPException(status_code=400, detail=result.get("error") or "invalid check")
    return result


@router.post("/tech-fun/safety/four-eyes")
async def request_four_eyes(data: dict, current_user: dict = Depends(get_current_user)):
    """Request independent sign-off on a change — the real diff is attached."""
    result = await nexus_safety_layer.request_four_eyes(
        db, current_user, str(current_user.get("name") or ""), data or {})
    if not result.get("found"):
        raise HTTPException(status_code=400, detail=result.get("error") or "invalid sign-off request")
    return result


@router.get("/tech-fun/safety/four-eyes")
async def list_four_eyes(client_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """Sign-off queue and history with derived honest lifecycle states."""
    return await nexus_safety_layer.list_four_eyes(db, current_user, client_id)


@router.post("/tech-fun/safety/four-eyes/{review_id}/review")
async def review_four_eyes(review_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Approve or reject a sign-off — never your own."""
    result = await nexus_safety_layer.review_four_eyes(
        db, current_user, str(current_user.get("name") or ""), review_id, data or {})
    if not result.get("found"):
        raise HTTPException(status_code=404 if result.get("error") is None else 400,
                            detail=result.get("error") or "sign-off not found")
    return result


# ============== HUMAN-DECISION FAMILY (P0 #7) ==============


@router.get("/tech-fun/decision-family/lifecycle")
async def decision_family_lifecycle(current_user: dict = Depends(get_current_user)):
    """The shared lifecycle: proposed → reviewed → decided → review-due → expired."""
    return nexus_decision_family.lifecycle_spec()


@router.post("/tech-fun/decision-family")
async def record_family_object(data: dict, current_user: dict = Depends(get_current_user)):
    """Record an approval, consent receipt, risk acceptance or decision-log entry."""
    result = await nexus_decision_family.record_object(
        db, current_user, str(current_user.get("name") or ""), data or {})
    if not result.get("found"):
        raise HTTPException(status_code=400, detail=result.get("error") or "invalid object")
    return result


@router.get("/tech-fun/decision-family")
async def decision_family_index(client_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """Who accepted what risk, when does it expire, what happened next — one read."""
    return await nexus_decision_family.family_index(db, current_user, client_id)


@router.post("/tech-fun/decision-family/{object_id}/transition")
async def transition_family_object(object_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Move one object through the shared lifecycle — every move audited."""
    result = await nexus_decision_family.transition(
        db, current_user, str(current_user.get("name") or ""), object_id, data or {})
    if not result.get("found"):
        raise HTTPException(status_code=404 if result.get("error") is None else 400,
                            detail=result.get("error") or "object not found")
    return result


# ============== DIAGNOSTIC WORKBENCH: ONE INVESTIGATION, HYPOTHESES, NEXT TEST ==============


@router.get("/tech-fun/diagnostics/model")
async def diagnostics_model(current_user: dict = Depends(get_current_user)):
    """The published differential-diagnosis model: domains, priors and tests."""
    return nexus_diagnostics.hypothesis_catalog()


@router.post("/tech-fun/diagnostics/investigations")
async def open_investigation(data: dict, current_user: dict = Depends(get_current_user)):
    """Open an investigation on a user, device or customer and gather what is observed."""
    result = await nexus_diagnostics.open_investigation(
        db, current_user, str(current_user.get("name") or ""), data or {})
    return _guard(result, "Subject not found in your scope")


@router.get("/tech-fun/diagnostics/investigations")
async def list_investigations(
    client_id: str | None = None,
    status: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Open and recent investigations in your scope, newest first."""
    result = await nexus_diagnostics.list_investigations(db, current_user, client_id, status)
    return _guard(result, "No investigations in your scope")


@router.get("/tech-fun/diagnostics/investigations/{investigation_id}")
async def investigation_summary(investigation_id: str, current_user: dict = Depends(get_current_user)):
    """Ranked hypotheses, the evidence trail and the next test that removes most doubt."""
    result = await nexus_diagnostics.investigation_summary(db, current_user, investigation_id)
    return _guard(result, "Investigation not found in your scope")


@router.get("/tech-fun/diagnostics/investigations/{investigation_id}/next-test")
async def investigation_next_test(investigation_id: str, current_user: dict = Depends(get_current_user)):
    """The single test with the highest expected information value right now."""
    result = await nexus_diagnostics.next_best_test(db, current_user, investigation_id)
    return _guard(result, "Investigation not found in your scope")


@router.post("/tech-fun/diagnostics/investigations/{investigation_id}/evidence")
async def record_investigation_evidence(
    investigation_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Record one observed test result and update the hypotheses honestly."""
    result = await nexus_diagnostics.add_evidence(
        db, current_user, str(current_user.get("name") or ""), investigation_id, data or {})
    return _guard(result, "Investigation not found in your scope")


@router.post("/tech-fun/diagnostics/investigations/{investigation_id}/close")
async def close_investigation(
    investigation_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Close with an honest outcome — a guessed cause is refused."""
    result = await nexus_diagnostics.close_investigation(
        db, current_user, str(current_user.get("name") or ""), investigation_id, data or {})
    return _guard(result, "Investigation not found in your scope")


# ============== FIND EVERYWHERE: ONE VALUE, EVERY STORE, CHANGE IMPACT ==============


@router.get("/tech-fun/find/sources")
async def find_sources(current_user: dict = Depends(get_current_user)):
    """Exactly which stores Find Everywhere searches, and who owns each one."""
    return nexus_find.search_sources()


@router.get("/tech-fun/find")
async def find_everywhere(
    q: str = Query(..., max_length=200),
    sources: str | None = None,
    limit: int = Query(default=25, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Find one value across every Nexus store in your tenant, grouped by store."""
    result = await nexus_find.find_everywhere(db, current_user, q, _source_list(sources), limit)
    return _guard(result, "Nothing to search")


@router.post("/tech-fun/find/literals")
async def find_literals(data: dict, current_user: dict = Depends(get_current_user)):
    """Hardcoded IP, hostname and domain hunter — locate one value or discover them all."""
    result = await nexus_find.literal_scan(db, current_user, data or {})
    return _guard(result, "Nothing to scan")


@router.post("/tech-fun/find/change-impact")
async def find_change_impact(data: dict, current_user: dict = Depends(get_current_user)):
    """Before changing a value: everything in Nexus that references it."""
    result = await nexus_find.change_impact(db, current_user, data or {})
    return _guard(result, "Nothing to inspect")


# ============== COMMAND RECORDER: RECORDED FIX → REVIEWED RUNBOOK → VERIFIED ==============


@router.post("/tech-fun/recorder/sessions")
async def start_recording(data: dict, current_user: dict = Depends(get_current_user)):
    """Start recording a manual fix as an append-only session."""
    result = await nexus_recorder.start_session(
        db, current_user, str(current_user.get("name") or ""), data or {})
    return _guard(result, "Session could not be started")


@router.get("/tech-fun/recorder/sessions")
async def list_recording_sessions(
    status: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Recorded sessions in your scope, newest first."""
    result = await nexus_recorder.list_sessions(db, current_user, status)
    return _guard(result, "No sessions in your scope")


@router.get("/tech-fun/recorder/sessions/{session_id}")
async def get_recording_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """One recorded session with its redacted, append-only steps."""
    result = await nexus_recorder.get_session(db, current_user, session_id)
    return _guard(result, "Session not found in your scope")


@router.post("/tech-fun/recorder/sessions/{session_id}/steps")
async def record_recording_step(
    session_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Append one step. Secrets are redacted before anything is stored."""
    result = await nexus_recorder.record_step(db, current_user, session_id, data or {})
    return _guard(result, "Session not found in your scope")


@router.post("/tech-fun/recorder/sessions/{session_id}/end")
async def end_recording_session(
    session_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Close a recording with its real outcome."""
    result = await nexus_recorder.end_session(db, current_user, session_id, data or {})
    return _guard(result, "Session not found in your scope")


@router.post("/tech-fun/recorder/sessions/{session_id}/runbook")
async def propose_runbook_from_session(
    session_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Turn a real recorded fix into a draft runbook a human must review."""
    result = await nexus_recorder.propose_runbook(
        db, current_user, str(current_user.get("name") or ""), session_id, data or {})
    return _guard(result, "Session not found in your scope")


@router.get("/tech-fun/recorder/runbooks")
async def list_recorded_runbooks(
    status: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Draft, verified and demoted runbooks in your scope."""
    result = await nexus_recorder.list_runbooks(db, current_user, status)
    return _guard(result, "No runbooks in your scope")


@router.post("/tech-fun/recorder/runbooks/{runbook_id}/verify")
async def verify_recorded_runbook(
    runbook_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Record a real outcome. Autonomy needs three verified successes and approval."""
    result = await nexus_recorder.verify_runbook(
        db, current_user, str(current_user.get("name") or ""), runbook_id, data or {})
    return _guard(result, "Runbook not found in your scope")


# ============== SYNTHETIC EMPLOYEE: BUSINESS CHECKS, NOT "SERVER RESPONDS" ==============


@router.get("/tech-fun/synthetic/checks")
async def synthetic_checks(current_user: dict = Depends(get_current_user)):
    """The safe, read-only checks a synthetic identity can run."""
    return nexus_synthetic.check_catalog()


@router.post("/tech-fun/synthetic/identities")
async def register_synthetic_identity(data: dict, current_user: dict = Depends(get_current_user)):
    """Register a synthetic identity by vault reference — never a credential."""
    result = await nexus_synthetic.register_identity(
        db, current_user, str(current_user.get("name") or ""), data or {})
    return _guard(result, "Identity could not be registered")


@router.get("/tech-fun/synthetic/identities")
async def list_synthetic_identities(
    client_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Synthetic identities in your scope with their declared checks."""
    result = await nexus_synthetic.list_identities(db, current_user, client_id)
    return _guard(result, "No synthetic identities in your scope")


@router.get("/tech-fun/synthetic/identities/{identity_id}")
async def synthetic_identity_status(identity_id: str, current_user: dict = Depends(get_current_user)):
    """Latest business verdict, coverage and trend for one identity."""
    result = await nexus_synthetic.identity_status(db, current_user, identity_id)
    return _guard(result, "Synthetic identity not found in your scope")


@router.post("/tech-fun/synthetic/identities/{identity_id}/state")
async def set_synthetic_identity_state(
    identity_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Enable or disable a synthetic identity."""
    result = await nexus_synthetic.set_identity_state(db, current_user, identity_id, data or {})
    return _guard(result, "Synthetic identity not found in your scope")


@router.post("/tech-fun/synthetic/runs")
async def record_synthetic_run(data: dict, current_user: dict = Depends(get_current_user)):
    """Record check outcomes. Partial evidence is never reported as healthy."""
    result = await nexus_synthetic.record_run(
        db, current_user, str(current_user.get("name") or ""), data or {})
    return _guard(result, "Synthetic identity not found in your scope")


@router.get("/tech-fun/synthetic/overview")
async def synthetic_overview(
    client_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """What synthetic identities currently prove, and what they have never run."""
    result = await nexus_synthetic.synthetic_overview(db, current_user, client_id)
    return _guard(result, "No synthetic identities in your scope")


# ============== NEXUS RESCUE: HELP WHEN WINDOWS CANNOT BOOT (PLANS, NOT CLAIMS) ==============


@router.get("/tech-fun/rescue/capabilities")
async def rescue_capabilities(current_user: dict = Depends(get_current_user)):
    """The recovery capability ladder, with each capability's honest boundary."""
    return nexus_rescue.capability_ladder()


@router.post("/tech-fun/rescue/assess")
async def rescue_assess(data: dict, current_user: dict = Depends(get_current_user)):
    """What is actually reachable for this device, from real observed evidence."""
    result = await nexus_rescue.assess(
        db, current_user, str(current_user.get("name") or ""), data or {})
    return _guard(result, "Device not found in your scope")


@router.get("/tech-fun/rescue/console/{device_id}")
async def rescue_console(device_id: str, current_user: dict = Depends(get_current_user)):
    """One call for a recovery console: device, liveness evidence, what is reachable."""
    result = await nexus_rescue.rescue_console(db, current_user, device_id)
    return _guard(result, "Device not found in your scope")


@router.post("/tech-fun/rescue/sessions")
async def start_rescue_session(data: dict, current_user: dict = Depends(get_current_user)):
    """Plan a recovery. Sessions are born \"planned\" and are never executed remotely."""
    result = await nexus_rescue.start_recovery(
        db, current_user, str(current_user.get("name") or ""), data or {})
    return _guard(result, "Device not found in your scope")


@router.get("/tech-fun/rescue/sessions")
async def list_rescue_sessions(
    device_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Planned and in-progress recovery sessions in your scope."""
    result = await nexus_rescue.list_sessions(db, current_user, device_id)
    return _guard(result, "No rescue sessions in your scope")


@router.get("/tech-fun/rescue/sessions/{session_id}")
async def get_rescue_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """One recovery session with its append-only step log."""
    result = await nexus_rescue.get_session(db, current_user, session_id)
    return _guard(result, "Rescue session not found in your scope")


@router.post("/tech-fun/rescue/sessions/{session_id}/steps")
async def record_rescue_step(
    session_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Log progress. Technician actions are recorded as performed by a human."""
    result = await nexus_rescue.record_step(
        db, current_user, str(current_user.get("name") or ""), session_id, data or {})
    return _guard(result, "Rescue session not found in your scope")


# ============== MISSION CONTROL · INVESTIGATE: THE ORCHESTRATION LAYER ==============


@router.get("/tech-fun/mission-control/tools")
async def mission_control_tools(current_user: dict = Depends(get_current_user)):
    """Every tool Mission Control can reach, and the endpoint that really exists."""
    return nexus_investigate.tool_catalog()


@router.post("/tech-fun/mission-control/investigate")
async def mission_control_investigate(data: dict, current_user: dict = Depends(get_current_user)):
    """Describe what appears wrong; get scope, tools, hypotheses and the next action."""
    result = await nexus_investigate.investigate(
        db, current_user, str(current_user.get("name") or ""), data or {})
    return _guard(result, "Nothing to investigate")


@router.get("/tech-fun/mission-control/investigations")
async def list_mission_investigations(
    status: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Open and recent problem investigations in your scope."""
    result = await nexus_investigate.list_investigations(db, current_user, status)
    return _guard(result, "No investigations in your scope")


@router.get("/tech-fun/mission-control/investigations/{mission_id}")
async def get_mission_investigation(mission_id: str, current_user: dict = Depends(get_current_user)):
    """One investigation with its live next action and human-decision gate."""
    result = await nexus_investigate.get_investigation(db, current_user, mission_id)
    return _guard(result, "Investigation not found in your scope")


@router.post("/tech-fun/mission-control/investigations/{mission_id}/subject")
async def attach_mission_subject(
    mission_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Attach the real subject and rebuild the scope from actual records."""
    result = await nexus_investigate.attach_subject(
        db, current_user, str(current_user.get("name") or ""), mission_id, data or {})
    return _guard(result, "Investigation or subject not found in your scope")


@router.post("/tech-fun/mission-control/investigations/{mission_id}/decision")
async def record_mission_decision(
    mission_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Record the human decision and why — append-only."""
    result = await nexus_investigate.record_decision(
        db, current_user, str(current_user.get("name") or ""), mission_id, data or {})
    return _guard(result, "Investigation not found in your scope")


@router.post("/tech-fun/mission-control/investigations/{mission_id}/close")
async def close_mission_investigation(
    mission_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Close with an honest outcome; the scope and decisions stay."""
    result = await nexus_investigate.close_investigation(
        db, current_user, str(current_user.get("name") or ""), mission_id, data or {})
    return _guard(result, "Investigation not found in your scope")


# ============== STATE ENGINE (DEVICE-LEVEL) & DRIFT CONTROL ==============


@router.get("/tech-fun/state-engine/checks")
async def state_engine_checks(current_user: dict = Depends(get_current_user)):
    """The declared device checks and the live record each one reads."""
    return nexus_device_state.check_catalog()


@router.post("/tech-fun/state-engine/declarations")
async def declare_device_state(data: dict, current_user: dict = Depends(get_current_user)):
    """Declare what a device (or a whole customer) should look like."""
    result = await nexus_device_state.declare_state(
        db, current_user, str(current_user.get("name") or ""), data or {})
    return _guard(result, "Declaration could not be recorded")


@router.get("/tech-fun/state-engine/declarations")
async def list_device_declarations(
    client_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Declared device-state expectations in your scope."""
    result = await nexus_device_state.list_declarations(db, current_user, client_id)
    return _guard(result, "No declarations in your scope")


@router.get("/tech-fun/state-engine/evaluate/{device_id}")
async def evaluate_device_state(device_id: str, current_user: dict = Depends(get_current_user)):
    """Desired vs actual for one device: met, drifted, or honestly unverified."""
    result = await nexus_device_state.evaluate_device(db, current_user, device_id)
    return _guard(result, "Device not found in your scope")


@router.post("/tech-fun/state-engine/evaluate")
async def evaluate_estate_state(data: dict, current_user: dict = Depends(get_current_user)):
    """Evaluate an estate slice — bounded, and it never infers from a missing field."""
    payload = data or {}
    result = await nexus_device_state.evaluate_estate(
        db, current_user, payload.get("client_id"), payload.get("limit") or 200)
    return _guard(result, "Nothing to evaluate")


@router.get("/tech-fun/drift")
async def list_drift(
    client_id: str | None = None,
    status: str | None = None,
    device_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """The drift work queue: open findings outrank resolved ones."""
    result = await nexus_device_state.list_drift(db, current_user, client_id, status, device_id)
    return _guard(result, "No drift findings in your scope")


@router.get("/tech-fun/drift/summary")
async def drift_summary(
    client_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Drift counts by status, check and customer, with an honest trend note."""
    result = await nexus_device_state.drift_summary(db, current_user, client_id)
    return _guard(result, "No drift findings in your scope")


@router.post("/tech-fun/drift/{drift_id}/remediation")
async def propose_drift_remediation(
    drift_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Propose how to close one drift. A plan — Nexus executes nothing."""
    result = await nexus_device_state.propose_remediation(
        db, current_user, str(current_user.get("name") or ""), drift_id, data or {})
    return _guard(result, "Drift finding not found in your scope")


@router.post("/tech-fun/drift/{drift_id}/verification")
async def record_drift_verification(
    drift_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Record whether the drift is really gone — verified, still drifted, waived."""
    result = await nexus_device_state.record_verification(
        db, current_user, str(current_user.get("name") or ""), drift_id, data or {})
    return _guard(result, "Drift finding not found in your scope")


# ============== FLEET SHELL: A QUESTION BECOMES AN ACTIONABLE OBJECT SET ==============


@router.get("/tech-fun/fleet/grammar")
async def fleet_grammar(current_user: dict = Depends(get_current_user)):
    """The supported fleet filters, and the device field each one needs."""
    return nexus_fleet_shell.shell_grammar()


@router.post("/tech-fun/fleet/query")
async def fleet_query(data: dict, current_user: dict = Depends(get_current_user)):
    """Query the fleet. Filters needing absent evidence report it as unavailable."""
    result = await nexus_fleet_shell.query_fleet(db, current_user, data or {})
    return _guard(result, "Nothing to query")


@router.get("/tech-fun/fleet/summary")
async def fleet_summary(
    client_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Fleet counts derived from recorded fields only."""
    result = await nexus_fleet_shell.fleet_summary(db, current_user, client_id)
    return _guard(result, "Nothing in your scope")


@router.post("/tech-fun/fleet/sets")
async def save_fleet_object_set(data: dict, current_user: dict = Depends(get_current_user)):
    """Freeze a fleet answer into a saved object set with its membership and counts."""
    result = await nexus_fleet_shell.save_object_set(
        db, current_user, str(current_user.get("name") or ""), data or {})
    return _guard(result, "Object set could not be saved")


@router.get("/tech-fun/fleet/sets")
async def list_fleet_object_sets(current_user: dict = Depends(get_current_user)):
    """Saved fleet object sets in your scope."""
    result = await nexus_fleet_shell.list_object_sets(db, current_user)
    return _guard(result, "No object sets in your scope")


@router.get("/tech-fun/fleet/sets/{set_id}")
async def get_fleet_object_set(set_id: str, current_user: dict = Depends(get_current_user)):
    """One saved object set with its recorded membership."""
    result = await nexus_fleet_shell.get_object_set(db, current_user, set_id)
    return _guard(result, "Object set not found in your scope")


@router.post("/tech-fun/fleet/sets/{set_id}/refine")
async def refine_fleet_object_set(
    set_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Narrow a saved set into a NEW set. The parent is never mutated."""
    result = await nexus_fleet_shell.refine_object_set(
        db, current_user, str(current_user.get("name") or ""), set_id, data or {})
    return _guard(result, "Object set not found in your scope")


@router.post("/tech-fun/fleet/sets/{set_id}/plan")
async def plan_fleet_set_action(
    set_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Plan an action over a set: blast-radius rings, rollback, verification. Plan only."""
    result = await nexus_fleet_shell.plan_set_action(
        db, current_user, str(current_user.get("name") or ""), set_id, data or {})
    return _guard(result, "Object set not found in your scope")


# ============== EVIDENCE ENGINE: PROOF THAT AN OPERATION ACTUALLY SUCCEEDED ==============


@router.get("/tech-fun/evidence/contract")
async def evidence_contract(current_user: dict = Depends(get_current_user)):
    """What counts as proof: the verdicts and the never-infer rule."""
    return nexus_evidence.evidence_contract()


@router.post("/tech-fun/evidence")
async def record_operation_evidence(data: dict, current_user: dict = Depends(get_current_user)):
    """Record the evidence envelope for one operation, hash-chained per tenant."""
    result = await nexus_evidence.record_evidence(
        db, current_user, str(current_user.get("name") or ""), data or {})
    return _guard(result, "Evidence could not be recorded")


@router.get("/tech-fun/evidence")
async def list_operation_evidence(
    client_id: str | None = None,
    target_id: str | None = None,
    operation: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Recorded operation evidence in your scope."""
    result = await nexus_evidence.list_evidence(db, current_user, client_id, target_id, operation)
    return _guard(result, "No evidence in your scope")


@router.post("/tech-fun/evidence/packs")
async def build_evidence_pack(data: dict, current_user: dict = Depends(get_current_user)):
    """Build an incident evidence pack manifest with a verifiable root hash."""
    result = await nexus_evidence.build_evidence_pack(
        db, current_user, str(current_user.get("name") or ""), data or {})
    return _guard(result, "Evidence pack could not be built")


@router.get("/tech-fun/evidence/packs")
async def list_evidence_packs(current_user: dict = Depends(get_current_user)):
    """Evidence packs in your scope."""
    result = await nexus_evidence.list_packs(db, current_user)
    return _guard(result, "No evidence packs in your scope")


@router.get("/tech-fun/evidence/packs/{pack_id}")
async def get_evidence_pack(pack_id: str, current_user: dict = Depends(get_current_user)):
    """One pack, re-verified against its stored root hash."""
    result = await nexus_evidence.get_pack(db, current_user, pack_id)
    return _guard(result, "Evidence pack not found in your scope")


@router.get("/tech-fun/evidence/{evidence_id}")
async def get_operation_evidence(evidence_id: str, current_user: dict = Depends(get_current_user)):
    """One evidence record with its derived verdict."""
    result = await nexus_evidence.get_evidence(db, current_user, evidence_id)
    return _guard(result, "Evidence not found in your scope")


@router.post("/tech-fun/evidence/{evidence_id}/verify")
async def verify_operation_evidence(evidence_id: str, current_user: dict = Depends(get_current_user)):
    """Re-derive the verdict from the recorded checks — never from a claim."""
    result = await nexus_evidence.verify_operation(db, current_user, evidence_id)
    return _guard(result, "Evidence not found in your scope")


# ============== OPERATIONAL MODE: NORMAL, OBSERVE-ONLY, SCOPED FREEZE ==============


@router.get("/tech-fun/operational-mode/capabilities")
async def operational_mode_capabilities(current_user: dict = Depends(get_current_user)):
    """What can be stopped, and which layers actually consult this state."""
    return nexus_operational_mode.capability_catalog()


@router.get("/tech-fun/operational-mode")
async def get_operational_mode(current_user: dict = Depends(get_current_user)):
    """The platform's current operational intent."""
    return {"mode": await nexus_operational_mode.current_mode(db, current_user)}


@router.post("/tech-fun/operational-mode")
async def set_operational_mode(data: dict, current_user: dict = Depends(get_current_user)):
    """Change it (admin only). A written reason is mandatory; history is append-only."""
    if not (current_user.get("is_admin") or current_user.get("role") == "admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    result = await nexus_operational_mode.set_mode(
        db, current_user, str(current_user.get("name") or ""), data or {})
    return _guard(result, "Mode change refused")


@router.get("/tech-fun/operational-mode/events")
async def list_operational_mode_events(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    """Append-only history of operational-mode changes with actor and reason."""
    return await nexus_operational_mode.list_events(db, current_user, limit)
