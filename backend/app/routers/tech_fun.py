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
from app.services import tech_fun
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
