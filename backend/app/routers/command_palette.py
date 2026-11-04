"""Global entity search, safe intent routing, and audited slash commands."""

import asyncio
import re
from urllib.parse import quote_plus

from fastapi import APIRouter, Body, Depends, HTTPException

from app.database import db
from app.routers.auth import get_current_user
from app.services.chat_access import channel_visibility_query
from app.services.scope_permissions import assert_client_scope, scoped_query


router = APIRouter()


def _search_terms(query: str) -> list[str]:
    """Keep both the technician's exact phrase and its likely record token."""
    raw = str(query or "").strip()
    entity = _entity_search_term(raw)
    return list(dict.fromkeys(term for term in (raw, entity) if term))


def _text_conditions(fields: tuple[str, ...], terms: list[str]) -> list[dict]:
    """Build literal, case-insensitive Mongo text predicates.

    User-entered search must never be treated as a regular expression.  This
    deliberately uses literal substring matching for names and descriptions;
    record identifiers receive their own prefix-aware predicate below.
    """
    return [
        {field: {"$regex": re.escape(term), "$options": "i"}}
        for term in terms
        for field in fields
    ]


def _phone_condition(query: str, fields: tuple[str, ...]) -> list[dict]:
    """Match a dialled phone fragment despite spaces, brackets or hyphens."""
    digits = re.sub(r"\D", "", str(query or ""))[:24]
    if len(digits) < 3:
        return []
    pattern = r"\D*".join(re.escape(digit) for digit in digits)
    return [{field: {"$regex": pattern}} for field in fields]


def _ticket_prefix_condition(query: str) -> list[dict]:
    """Give ticket numbers a predictable start-of-reference lookup.

    ``TKT-48`` is an exact prefix search.  A bare numeric fragment also
    matches the number segment after a ticket prefix, so technicians can type
    the visible number without first remembering the local prefix.
    """
    reference = str(query or "").strip().lstrip("#").replace(" ", "")
    if not reference or not re.fullmatch(r"[A-Za-z0-9_-]+", reference):
        return []
    if reference.isdigit():
        pattern = rf"(?:^|[-#/]){re.escape(reference)}"
    else:
        pattern = rf"^{re.escape(reference)}"
    return [{"ticket_number": {"$regex": pattern, "$options": "i"}}]


def _matches_contact(contact: dict, terms: list[str], phone_query: str) -> bool:
    """Apply the same literal semantics to embedded client contacts."""
    haystack = " ".join(str(contact.get(field) or "") for field in ("name", "email", "role", "title"))
    if any(term.lower() in haystack.lower() for term in terms):
        return True
    digits = re.sub(r"\D", "", str(phone_query or ""))
    contact_phone = re.sub(r"\D", "", str(contact.get("phone") or contact.get("mobile") or ""))
    return bool(len(digits) >= 3 and digits in contact_phone)


def _contact_result(contact: dict, *, client_id: str = "", client_name: str = "") -> dict:
    return {
        "id": str(contact.get("id") or ""),
        "client_id": str(contact.get("client_id") or client_id or ""),
        "client_name": str(contact.get("client_name") or client_name or ""),
        "name": str(contact.get("name") or contact.get("email") or "Client contact"),
        "email": str(contact.get("email") or ""),
        "phone": str(contact.get("phone") or contact.get("mobile") or ""),
        "role": str(contact.get("role") or contact.get("title") or ""),
    }


def _dedupe_contacts(rows: list[dict]) -> list[dict]:
    """Collapse legacy embedded and standalone representations by identity."""
    unique: list[dict] = []
    seen: set[tuple[str, str, str, str]] = set()
    for row in rows:
        key = (
            str(row.get("client_id") or ""),
            str(row.get("id") or ""),
            str(row.get("email") or "").strip().lower(),
            re.sub(r"\D", "", str(row.get("phone") or "")),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique


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
        "contacts": [], "invoices": [], "purchase_orders": [], "projects": [],
        "contracts": [], "vendors": [], "leads": [], "conversations": [],
        "pbxs": [], "backups": [], "csat_surveys": [], "knowledge": [], "products": [],
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

    terms = _search_terms(q)
    entity_term = _entity_search_term(q)
    ticket_conditions = _text_conditions(("title", "ticket_number", "client_name"), terms) + _ticket_prefix_condition(q)
    client_conditions = _text_conditions(
        ("name", "email", "phone", "contact_name", "primary_contact", "contacts.name", "contacts.email", "contacts.phone"),
        terms,
    ) + _phone_condition(q, ("phone", "contacts.phone", "contacts.mobile"))
    contact_conditions = _text_conditions(("name", "email", "role", "title", "phone", "mobile"), terms) + _phone_condition(q, ("phone", "mobile"))
    device_conditions = _text_conditions(("hostname", "name", "client_name", "serial_number", "asset_tag", "ip_address"), terms)
    invoice_conditions = _text_conditions(("invoice_number", "invoice_name", "client_name", "reference"), terms)
    purchase_order_conditions = _text_conditions(("po_number", "vendor", "vendor_contact", "vendor_email", "client_name", "ticket_number"), terms)
    project_conditions = _text_conditions(("name", "description", "client_name", "project_number"), terms)
    contract_conditions = _text_conditions(("name", "contract_number", "client_name", "description"), terms)
    vendor_conditions = _text_conditions(("name", "contact_name", "email", "phone", "website", "account_number"), terms) + _phone_condition(q, ("phone",))
    product_conditions = _text_conditions(("name", "sku", "barcode", "vendor", "category", "description"), terms)
    lead_conditions = _text_conditions(("company_name", "contact_name", "email", "phone", "website", "industry", "assigned_name", "status"), terms) + _phone_condition(q, ("phone",))
    conversation_conditions = _text_conditions(("name", "display_name", "description"), terms)
    csat_conditions = _text_conditions(("ticket_number", "client_name", "tech_name", "status", "comment", "feedback"), terms)

    ticket_query = {"$or": ticket_conditions}
    client_query = {"$or": client_conditions}
    contact_query = {"$or": contact_conditions}
    device_query = {"$or": device_conditions}
    invoice_query = {"$or": invoice_conditions}
    purchase_order_query = {"$or": purchase_order_conditions}
    project_query = {"$or": project_conditions}
    contract_query = {"$or": contract_conditions}
    lead_query = {"$or": lead_conditions}
    csat_query = {"$or": csat_conditions}
    if client_id:
        ticket_query["client_id"] = client_id
        client_query["id"] = client_id
        contact_query["client_id"] = client_id
        device_query["client_id"] = client_id
        invoice_query["client_id"] = client_id
        purchase_order_query["client_id"] = client_id
        project_query["client_id"] = client_id
        contract_query["client_id"] = client_id
        # Leads only become customer records after conversion.  While a
        # technician has an active client context, keep the commercial view
        # intentionally tied to that resulting Nexus client.
        lead_query["converted_to_client"] = client_id
        csat_query["client_id"] = client_id

    (
        tickets, clients, embedded_contact_clients, contacts, legacy_contacts, devices, users,
        invoices, purchase_orders, projects, contracts, vendors, leads, conversations, pbxs, backups,
        csat_surveys, knowledge, products,
    ) = await asyncio.gather(
        db.tickets.find(
            scoped_query(current_user, ticket_query),
            {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "status": 1, "priority": 1, "client_name": 1},
        ).limit(6).to_list(6),
        db.clients.find(
            scoped_query(current_user, client_query, field="id", site_field=None),
            {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1, "contract_status": 1},
        ).limit(6).to_list(6),
        db.clients.find(
            scoped_query(current_user, {"$or": _text_conditions(("contacts.name", "contacts.email", "contacts.phone", "contacts.mobile", "contacts.role", "contacts.title"), terms) + _phone_condition(q, ("contacts.phone", "contacts.mobile")), **({"id": client_id} if client_id else {})}, field="id", site_field=None),
            {"_id": 0, "id": 1, "name": 1, "contacts": 1},
        ).limit(6).to_list(6),
        db.contacts.find(
            scoped_query(current_user, contact_query),
            {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "name": 1, "email": 1, "phone": 1, "mobile": 1, "role": 1, "title": 1},
        ).limit(6).to_list(6),
        db.client_contacts.find(
            scoped_query(current_user, contact_query),
            {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "name": 1, "email": 1, "phone": 1, "mobile": 1, "role": 1, "title": 1},
        ).limit(6).to_list(6),
        db.devices.find(
            scoped_query(current_user, device_query),
            {"_id": 0, "id": 1, "hostname": 1, "name": 1, "client_name": 1, "status": 1, "device_type": 1},
        ).limit(6).to_list(6),
        db.users.find(
            {"$or": _text_conditions(("name", "email"), terms)},
            {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
        ).limit(5).to_list(5),
        db.invoices.find(
            scoped_query(current_user, invoice_query),
            {"_id": 0, "id": 1, "invoice_number": 1, "invoice_name": 1, "client_name": 1, "status": 1, "total": 1},
        ).limit(5).to_list(5),
        db.purchase_orders.find(
            scoped_query(current_user, purchase_order_query, site_field=None),
            {"_id": 0, "id": 1, "po_number": 1, "vendor": 1, "client_name": 1, "status": 1, "total": 1},
        ).limit(5).to_list(5),
        db.projects.find(
            scoped_query(current_user, project_query),
            {"_id": 0, "id": 1, "name": 1, "project_number": 1, "client_name": 1, "status": 1, "priority": 1},
        ).limit(5).to_list(5),
        db.contracts.find(
            scoped_query(current_user, contract_query),
            {"_id": 0, "id": 1, "name": 1, "contract_number": 1, "client_name": 1, "status": 1},
        ).limit(5).to_list(5),
        db.vendors.find(
            {"$or": vendor_conditions},
            {"_id": 0, "id": 1, "name": 1, "contact_name": 1, "email": 1, "phone": 1, "status": 1},
        ).limit(5).to_list(5),
        # Leads are commercial records owned by the MSP, not customer records.
        # They retain their own explicit scope when they become a client via
        # ``converted_to_client`` above.
        db.leads.find(
            lead_query,
            {"_id": 0, "id": 1, "company_name": 1, "contact_name": 1, "email": 1, "phone": 1, "assigned_name": 1, "status": 1, "converted_to_client": 1},
        ).limit(5).to_list(5),
        # The collaboration search deliberately returns channels only.  Message
        # content remains behind the channel-scoped chat search endpoint, which
        # checks the user's membership before exposing it.
        db.chat_channels.find(
            {"$and": [channel_visibility_query(current_user), {"$or": conversation_conditions}]},
            {"_id": 0, "id": 1, "name": 1, "display_name": 1, "description": 1, "kind": 1, "is_private": 1},
        ).limit(5).to_list(5),
        db.yeastar_pbxs.find(
            scoped_query(current_user, {"$or": _text_conditions(("name", "pbx_name", "client_name", "pbx_url"), terms), **({"client_id": client_id} if client_id else {})}),
            {"_id": 0, "id": 1, "name": 1, "pbx_name": 1, "client_name": 1, "status": 1},
        ).limit(5).to_list(5),
        db.backup_jobs.find(
            scoped_query(current_user, {"$or": _text_conditions(("name", "client_name", "type", "provider"), terms), **({"client_id": client_id} if client_id else {})}),
            {"_id": 0, "id": 1, "name": 1, "client_name": 1, "status": 1, "provider": 1},
        ).limit(5).to_list(5),
        db.csat_surveys.find(
            scoped_query(current_user, csat_query),
            {"_id": 0, "id": 1, "ticket_id": 1, "ticket_number": 1, "client_id": 1, "client_name": 1, "tech_name": 1, "score": 1, "status": 1, "responded_at": 1, "submitted_at": 1},
        ).limit(5).to_list(5),
        db.knowledge_articles.find(
            {"$or": _text_conditions(("title", "summary", "category"), terms)},
            {"_id": 0, "id": 1, "slug": 1, "title": 1, "summary": 1, "category": 1},
        ).limit(5).to_list(5),
        db.products.find(
            {"$or": product_conditions},
            {"_id": 0, "id": 1, "name": 1, "sku": 1, "barcode": 1, "vendor": 1, "category": 1, "retail_price": 1, "is_active": 1},
        ).limit(5).to_list(5),
    )

    contact_results = []
    for client in embedded_contact_clients:
        for contact in client.get("contacts") or []:
            if _matches_contact(contact, terms, q):
                contact_results.append(_contact_result(contact, client_id=client.get("id", ""), client_name=client.get("name", "")))
    contact_results.extend(_contact_result(contact) for contact in [*contacts, *legacy_contacts])
    contact_results = _dedupe_contacts(contact_results)[:6]

    return {
        "intents": _intent_suggestions(q, entity_term),
        "tickets": tickets,
        "clients": clients,
        "contacts": contact_results,
        "devices": devices,
        "users": users,
        "invoices": invoices,
        "purchase_orders": purchase_orders,
        "projects": projects,
        "contracts": contracts,
        "vendors": vendors,
        "leads": leads,
        "conversations": conversations,
        "pbxs": pbxs,
        "backups": backups,
        "csat_surveys": csat_surveys,
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
