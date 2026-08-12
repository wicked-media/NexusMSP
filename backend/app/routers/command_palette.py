"""Global entity search, safe intent routing, and audited slash commands."""

import asyncio
import re
from urllib.parse import quote_plus

from fastapi import APIRouter, Body, Depends, HTTPException

from app.database import db
from app.routers.auth import get_current_user
from app.services.scope_permissions import assert_client_scope, scoped_query


router = APIRouter()


def _entity_search_term(query: str) -> str:
    """Extract the likely record name from a natural-language request."""
    stop_words = {
        "a", "an", "and", "charges", "client", "create", "device", "for", "into",
        "invoice", "mailbox", "mfa", "move", "new", "renew", "reset", "restart",
        "ssl", "the", "to",
    }
    candidates = []
    for token in re.findall(r"[\w@.'-]+", query, flags=re.UNICODE):
        cleaned = token.strip(" .").removesuffix("'s").removesuffix("’s")
        if len(cleaned) >= 2 and cleaned.lower() not in stop_words:
            candidates.append(cleaned)
    return max(candidates, key=len) if candidates else query


def _intent_suggestions(query: str, entity_term: str) -> list[dict]:
    """Translate technician language into reviewable Nexus workflows."""
    value = query.lower()
    suggestions = []
    definitions = [
        (
            ("reset", "mfa"), "Reset a user's MFA",
            "Open Microsoft identity operations, select the user, and review the reset before approval.",
            "/control-plane?module=microsoft365&view=actions&action=reset-mfa", "Identity change",
        ),
        (
            ("create", "user"), "Create a Microsoft user",
            "Open a governed user-provisioning plan with tenant, client, licence and audit context.",
            "/control-plane?module=microsoft365&view=actions&action=create-user", "Identity workflow",
        ),
        (
            ("block", "sign"), "Block Microsoft sign-in",
            "Open the containment workflow and review the target, business reason and approval requirements first.",
            "/control-plane?module=microsoft365&view=actions&action=block-sign-in", "High-impact workflow",
        ),
        (
            ("licence",), "Review Microsoft licensing",
            "Open Nexus 365 licensing posture and the approval-aware licence-change workflow.",
            "/control-plane?module=microsoft365&view=actions&action=change-licences", "Commercial workflow",
        ),
        (
            ("group",), "Manage Microsoft group access",
            "Open a tenant-scoped group membership plan with access-owner evidence and approval gates.",
            "/control-plane?module=microsoft365&view=actions&action=manage-group-access", "Access governance",
        ),
        (
            ("role",), "Manage privileged Microsoft role",
            "Open a time-bounded, approval-required directory-role plan with a named access owner.",
            "/control-plane?module=microsoft365&view=actions&action=manage-privileged-role", "Privileged access",
        ),
        (
            ("remote",), "Start a remote support session",
            "Open matching managed assets and confirm the endpoint and remote provider.",
            f"/devices?search={quote_plus(entity_term)}", "Technician action",
        ),
        (
            ("invoice",), "Create or review an invoice",
            "Open the auditable invoice workflow with products, tickets and client allocations.",
            f"/invoices?intent={quote_plus(query)}", "Billing workflow",
        ),
        (
            ("backup",), "Investigate or restart a backup",
            "Open Backups to verify the job, recovery evidence and restart approval.",
            f"/backup-center?intent={quote_plus(query)}", "Protected action",
        ),
        (
            ("mailbox",), "Create or manage a mailbox",
            "Open a governed mailbox-delegation plan with tenant, user, mailbox owner and approval context.",
            "/control-plane?module=microsoft365&view=actions&action=manage-mailbox-access", "Mailbox governance",
        ),
        (
            ("phishing",), "Investigate a phishing signal",
            "Open Mail Shield with the incident context; containment stays evidence- and approval-led.",
            "/mail-shield?intent=phishing-investigation", "Security investigation",
        ),
        (
            ("conditional", "access"), "Review Conditional Access",
            "Open a governed Conditional Access policy plan with emergency-access review and approval gates.",
            "/control-plane?module=microsoft365&view=actions&action=manage-conditional-access", "Security governance",
        ),
        (
            ("retire", "device"), "Retire an Intune device",
            "Open the protected device-retirement plan; a device is not retired or wiped until its scope and approval are confirmed.",
            "/control-plane?module=microsoft365&view=actions&action=retire-managed-device", "Critical device action",
        ),
        (
            ("move", "device"), "Move an asset to another client",
            "Open Managed Assets and review ownership, linked tickets and audit impact.",
            f"/devices?intent={quote_plus(query)}", "Ownership change",
        ),
        (
            ("renew", "ssl"), "Renew an SSL certificate",
            "Open the expiry centre to verify the certificate, owner and approved change.",
            "/expiry-tracker?tab=ssl", "Change workflow",
        ),
        (
            ("new", "employee"), "Run employee onboarding",
            "Open automation and select an approved onboarding blueprint.",
            "/automation-hub?intent=employee-onboarding", "Automation workflow",
        ),
        (
            ("terminate",), "Run employee offboarding",
            "Open automation and review identity, device, mailbox and access-removal steps.",
            "/automation-hub?intent=employee-offboarding", "High-impact workflow",
        ),
    ]
    for required_words, label, description, route, risk in definitions:
        if all(word in value for word in required_words):
            suggestions.append({
                "kind": "intent",
                "label": label,
                "hint": risk,
                "description": description,
                "route": route,
                "mode": "review",
            })
    return suggestions[:3]


@router.get("/command-palette/search")
async def palette_search(q: str = "", client_id: str = "", current_user: dict = Depends(get_current_user)):
    """Search Nexus records within both the selected and permitted client boundary."""
    q = (q or "").strip()
    client_id = str(client_id or "").strip()
    empty = {
        "intents": [], "tickets": [], "clients": [], "devices": [], "users": [],
        "invoices": [], "pbxs": [], "backups": [], "knowledge": [], "products": [],
    }
    if not q:
        return empty

    if client_id:
        await assert_client_scope(
            current_user,
            client_id,
            operation="command_palette.search.client_context",
            mask_not_found=True,
        )

    entity_term = _entity_search_term(q)
    regex = {"$regex": re.escape(entity_term), "$options": "i"}
    (
        tickets, clients, devices, users, invoices, pbxs, backups, knowledge, products,
    ) = await asyncio.gather(
        db.tickets.find(
            scoped_query(current_user, {"$or": [{"title": regex}, {"ticket_number": regex}, {"client_name": regex}], **({"client_id": client_id} if client_id else {})}),
            {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "status": 1, "priority": 1, "client_name": 1},
        ).limit(6).to_list(6),
        db.clients.find(
            scoped_query(current_user, {"$or": [{"name": regex}, {"email": regex}, {"phone": regex}], **({"id": client_id} if client_id else {})}, field="id", site_field=None),
            {"_id": 0, "id": 1, "name": 1, "email": 1, "contract_status": 1},
        ).limit(6).to_list(6),
        db.devices.find(
            scoped_query(current_user, {"$or": [{"hostname": regex}, {"name": regex}, {"client_name": regex}, {"serial_number": regex}], **({"client_id": client_id} if client_id else {})}),
            {"_id": 0, "id": 1, "hostname": 1, "name": 1, "client_name": 1, "status": 1, "device_type": 1},
        ).limit(6).to_list(6),
        db.users.find(
            {"$or": [{"name": regex}, {"email": regex}]},
            {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
        ).limit(5).to_list(5),
        db.invoices.find(
            scoped_query(current_user, {"$or": [{"invoice_number": regex}, {"invoice_name": regex}, {"client_name": regex}], **({"client_id": client_id} if client_id else {})}),
            {"_id": 0, "id": 1, "invoice_number": 1, "invoice_name": 1, "client_name": 1, "status": 1, "total": 1},
        ).limit(5).to_list(5),
        db.yeastar_pbxs.find(
            scoped_query(current_user, {"$or": [{"name": regex}, {"pbx_name": regex}, {"client_name": regex}, {"pbx_url": regex}], **({"client_id": client_id} if client_id else {})}),
            {"_id": 0, "id": 1, "name": 1, "pbx_name": 1, "client_name": 1, "status": 1},
        ).limit(5).to_list(5),
        db.backup_jobs.find(
            scoped_query(current_user, {"$or": [{"name": regex}, {"client_name": regex}, {"type": regex}, {"provider": regex}], **({"client_id": client_id} if client_id else {})}),
            {"_id": 0, "id": 1, "name": 1, "client_name": 1, "status": 1, "provider": 1},
        ).limit(5).to_list(5),
        db.knowledge_articles.find(
            {"$or": [{"title": regex}, {"summary": regex}, {"category": regex}]},
            {"_id": 0, "id": 1, "slug": 1, "title": 1, "summary": 1, "category": 1},
        ).limit(5).to_list(5),
        db.products.find(
            {"$or": [{"name": regex}, {"sku": regex}, {"category": regex}, {"description": regex}]},
            {"_id": 0, "id": 1, "name": 1, "sku": 1, "category": 1, "retail_price": 1},
        ).limit(5).to_list(5),
    )
    return {
        "intents": _intent_suggestions(q, entity_term),
        "tickets": tickets,
        "clients": clients,
        "devices": devices,
        "users": users,
        "invoices": invoices,
        "pbxs": pbxs,
        "backups": backups,
        "knowledge": knowledge,
        "products": products,
    }


async def _resolve_default_channel(user_id: str) -> str | None:
    """Pick a sensible channel for the audited result of a slash command."""
    for name in ("ops", "general"):
        channel = await db.chat_channels.find_one({"name": name, "kind": "team"}, {"_id": 0, "id": 1})
        if channel:
            return channel["id"]
    channel = await db.chat_channels.find_one(
        {"$or": [{"member_ids": user_id}, {"kind": "team", "member_ids": {"$size": 0}}]},
        {"_id": 0, "id": 1},
    )
    return channel["id"] if channel else None


@router.post("/command-palette/run")
async def palette_run(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Run a slash command through the existing audited chat command handler."""
    raw = (payload.get("raw") or "").strip()
    if not raw.startswith("/"):
        raise HTTPException(400, "raw must start with /")

    channel_id = payload.get("channel_id") or await _resolve_default_channel(current_user.get("id"))
    if not channel_id:
        raise HTTPException(404, "No team channel available. Create #ops or #general first.")

    from app.routers.chat_presence import slash as run_slash_command

    message = await run_slash_command(
        payload={"raw": raw, "channel_id": channel_id},
        current_user=current_user,
    )
    return {"channel_id": channel_id, "message": message}
