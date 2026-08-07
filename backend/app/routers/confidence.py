"""Nexus Confidence API.

The API exposes one evidence contract across clients, devices and operational
documentation. It is intentionally read from existing source records rather
than maintained as a second inventory or documentation database.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.confidence_engine import (
    build_confidence_profile,
    confidence_dimension,
    evidence_gap,
    newest_timestamp,
)
from app.services.platform_foundation import emit_platform_event, request_correlation_id
from app.services.scope_permissions import assert_client_scope


router = APIRouter(tags=["Nexus Confidence"])

SUPPORTED_TYPES = {"client", "device", "documentation"}


async def _latest_verification(entity_type: str, entity_id: str) -> dict | None:
    return await db.confidence_verifications.find_one(
        {"entity_type": entity_type, "entity_id": entity_id},
        {"_id": 0},
        sort=[("verified_at", -1)],
    )


def _record_time(record: dict | None) -> Any:
    record = record or {}
    return (
        record.get("last_seen")
        or record.get("last_check_in")
        or record.get("last_sync_at")
        or record.get("verified_at")
        or record.get("updated_at")
        or record.get("created_at")
    )


def _document_content(record: dict) -> str:
    return str(
        record.get("content")
        or record.get("body")
        or record.get("html")
        or record.get("description")
        or ""
    ).strip()


async def _device_confidence(device: dict, verification: dict | None) -> dict:
    device_id = str(device["id"])
    client_id = str(device.get("client_id") or "")
    serial = str(device.get("serial_number") or "").strip()
    asset_query = {"$or": [{"device_id": device_id}, {"id": device.get("asset_id")}]}
    if serial:
        asset_query["$or"].append({"serial_number": serial})

    asset, tickets, events, sessions, backup_jobs, duplicate_serials = await asyncio.gather(
        db.assets.find_one(asset_query, {"_id": 0}),
        db.tickets.find(
            {
                "$or": [
                    {"device_id": device_id},
                    {"linked_device_ids": device_id},
                    {"asset_ids": device_id},
                ]
            },
            {"_id": 0},
        ).sort("updated_at", -1).to_list(250),
        db.device_events.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(250),
        db.remote_sessions.find({"device_id": device_id}, {"_id": 0}).sort("started_at", -1).to_list(100),
        db.backup_jobs.find(
            {"$or": [{"device_id": device_id}, {"client_id": client_id}]},
            {"_id": 0},
        ).sort("updated_at", -1).to_list(100),
        db.devices.count_documents(
            {"serial_number": serial, "id": {"$ne": device_id}}
        ) if serial else asyncio.sleep(0, result=0),
    )
    asset = asset or {}
    last_telemetry = newest_timestamp([
        _record_time(device),
        *(_record_time(event) for event in events[:20]),
    ])
    latest_service = newest_timestamp([
        *(_record_time(ticket) for ticket in tickets),
        *(_record_time(event) for event in events),
        *(_record_time(session) for session in sessions),
    ])
    latest_protection = newest_timestamp([
        *(_record_time(job) for job in backup_jobs),
        _record_time(device),
    ])

    protection_fields = [
        device.get("antivirus_status"),
        device.get("firewall_status"),
        device.get("bitlocker_status"),
        device.get("security_status"),
        device.get("edr_status"),
    ]
    protection_observed = any(value not in (None, "") for value in protection_fields)
    purchase_date = asset.get("purchase_date") or device.get("purchase_date")
    warranty_end = asset.get("warranty_end") or asset.get("warranty_expiry") or device.get("warranty_expiry")

    dimensions = [
        confidence_dimension(
            "identity",
            "Identity",
            weight=20,
            checks=[
                ("device name", bool(device.get("name"))),
                ("serial number", bool(serial)),
                ("manufacturer and model", bool(
                    (device.get("manufacturer") or asset.get("manufacturer"))
                    and (device.get("model") or asset.get("model"))
                )),
                ("operating system", bool(device.get("os") or device.get("os_name"))),
            ],
            sources=["devices", "assets"] if asset else ["devices"],
            evidence_count=1 + int(bool(asset)),
            observed_at=_record_time(device),
            fresh_days=30,
            stale_days=365,
            gaps=[
                evidence_gap("device.serial", "Record a verified serial number.", severity="high", route=f"/devices/{device_id}")
            ] if not serial else [],
            detail="Stable endpoint identity and canonical inventory linkage.",
        ),
        confidence_dimension(
            "ownership",
            "Ownership",
            weight=15,
            checks=[
                ("owning client", bool(client_id)),
                ("assigned user", bool(asset.get("assigned_to") or device.get("assigned_user"))),
                ("physical location or site", bool(asset.get("location") or device.get("location") or device.get("site_id"))),
            ],
            sources=["devices", "assets"] if asset else ["devices"],
            evidence_count=1 + int(bool(asset)),
            observed_at=_record_time(asset) or _record_time(device),
            fresh_days=90,
            stale_days=365,
            gaps=[
                evidence_gap("device.owner", "Assign the endpoint to its current user.", route=f"/devices/{device_id}")
            ] if not (asset.get("assigned_to") or device.get("assigned_user")) else [],
            detail="Who owns, uses and physically holds this endpoint.",
        ),
        confidence_dimension(
            "telemetry",
            "Live telemetry",
            weight=25,
            checks=[
                ("recent endpoint observation", bool(last_telemetry)),
                ("agent or provider identity", bool(device.get("agent_id") or device.get("source") or device.get("nexus_agent_id"))),
                ("reported operational status", device.get("status") not in (None, "")),
                ("hardware telemetry", any(device.get(key) is not None for key in ("cpu_usage", "memory_usage", "disk_usage"))),
            ],
            sources=["devices", "device_events"],
            evidence_count=1 + len(events),
            observed_at=last_telemetry,
            fresh_days=1,
            stale_days=14,
            gaps=[
                evidence_gap("device.telemetry", "Restore current agent telemetry.", severity="critical", route=f"/devices/{device_id}")
            ] if not last_telemetry else [],
            detail="How recently Nexus observed the endpoint and its agent.",
        ),
        confidence_dimension(
            "lifecycle",
            "Lifecycle",
            weight=15,
            checks=[
                ("canonical inventory record", bool(asset)),
                ("purchase date", bool(purchase_date)),
                ("warranty boundary", bool(warranty_end)),
                ("useful-life policy", bool(asset.get("expected_lifespan_months"))),
            ],
            sources=["assets"] if asset else ["devices"],
            evidence_count=int(bool(asset)),
            observed_at=_record_time(asset),
            fresh_days=180,
            stale_days=730,
            gaps=[
                evidence_gap("device.asset_story", "Connect the endpoint to its Asset Story.", severity="high", route=f"/devices/{device_id}")
            ] if not asset else [],
            detail="Purchase, warranty and replacement evidence.",
        ),
        confidence_dimension(
            "service_history",
            "Service history",
            weight=10,
            checks=[
                ("attributable operational history", bool(tickets or events or sessions)),
                ("ticket linkage", bool(tickets)),
                ("remote-session linkage", bool(sessions)),
            ],
            sources=["tickets", "device_events", "remote_sessions"],
            evidence_count=len(tickets) + len(events) + len(sessions),
            observed_at=latest_service,
            fresh_days=90,
            stale_days=730,
            detail="Tickets, agent events and remote work retained against the endpoint.",
        ),
        confidence_dimension(
            "protection",
            "Protection evidence",
            weight=15,
            checks=[
                ("security posture telemetry", protection_observed),
                ("backup evidence", bool(backup_jobs)),
                ("alert state observed", device.get("alerts_count") is not None or device.get("alert_count") is not None),
            ],
            sources=["devices", "backup_jobs"],
            evidence_count=1 + len(backup_jobs),
            observed_at=latest_protection,
            fresh_days=7,
            stale_days=45,
            gaps=[
                evidence_gap("device.protection", "Connect endpoint protection or backup evidence.", severity="high", route="/nexus-shield")
            ] if not (protection_observed or backup_jobs) else [],
            detail="Observed security, backup and alert evidence; absence is never treated as healthy.",
        ),
    ]
    conflicts = []
    if duplicate_serials:
        conflicts.append({
            "key": "duplicate_serial",
            "severity": "high",
            "label": f"{duplicate_serials + 1} managed devices share serial {serial}.",
            "route": "/devices",
        })
    profile = build_confidence_profile(
        entity_type="device",
        entity_id=device_id,
        entity_label=str(device.get("name") or device_id),
        dimensions=dimensions,
        conflicts=conflicts,
        verification=verification,
    )
    profile["client_id"] = client_id or None
    return profile


async def _client_confidence(client: dict, verification: dict | None) -> dict:
    client_id = str(client["id"])
    (
        devices,
        contacts,
        tickets,
        contracts,
        invoices,
        recurring,
        services,
        documentation,
        articles,
        generated_docs,
        backups,
        sites,
    ) = await asyncio.gather(
        db.devices.find({"client_id": client_id}, {"_id": 0}).to_list(5000),
        db.contacts.find({"client_id": client_id}, {"_id": 0}).to_list(1000),
        db.tickets.find({"client_id": client_id}, {"_id": 0}).sort("updated_at", -1).to_list(1000),
        db.contracts.find({"client_id": client_id}, {"_id": 0}).to_list(500),
        db.invoices.find({"client_id": client_id}, {"_id": 0}).to_list(1000),
        db.recurring_invoices.find({"client_id": client_id}, {"_id": 0}).to_list(500),
        db.core_services.find({"client_id": client_id}, {"_id": 0}).to_list(1000),
        db.documentation.find({"client_id": client_id}, {"_id": 0}).to_list(1000),
        db.kb_articles.find({"client_id": client_id}, {"_id": 0}).to_list(1000),
        db.auto_generated_docs.find({"client_id": client_id}, {"_id": 0}).to_list(1000),
        db.backup_jobs.find({"client_id": client_id}, {"_id": 0}).to_list(1000),
        db.network_sites.find({"client_id": client_id}, {"_id": 0}).to_list(500),
    )
    embedded_contacts = client.get("contacts") or []
    contact_rows = [*contacts, *embedded_contacts]
    documents = [*documentation, *articles, *generated_docs]
    latest_device = newest_timestamp(_record_time(item) for item in devices)
    latest_service = newest_timestamp([
        *(_record_time(item) for item in tickets),
        *(_record_time(item) for item in devices),
        *(_record_time(item) for item in backups),
    ])
    latest_commercial = newest_timestamp([
        *(_record_time(item) for item in contracts),
        *(_record_time(item) for item in invoices),
        *(_record_time(item) for item in recurring),
        *(_record_time(item) for item in services),
    ])
    latest_document = newest_timestamp(_record_time(item) for item in documents)

    integration_keys = (
        "pax8_company_id",
        "cipp_tenant_id",
        "m365_tenant_id",
        "acronis_tenant_id",
        "unifi_site_id",
        "splynx_customer_id",
        "yeastar_pbx_id",
    )
    connected_integrations = [key for key in integration_keys if client.get(key)]
    emails = [
        str(item.get("email") or "").strip().lower()
        for item in contact_rows
        if str(item.get("email") or "").strip()
    ]
    duplicate_contact_emails = sorted({email for email in emails if emails.count(email) > 1})
    serials = [
        str(item.get("serial_number") or "").strip().lower()
        for item in devices
        if str(item.get("serial_number") or "").strip()
    ]
    duplicate_serials = sorted({serial for serial in serials if serials.count(serial) > 1})
    primary_contact = any(
        item.get("is_primary") or item.get("primary") or str(item.get("role") or "").lower() == "primary"
        for item in contact_rows
    )

    dimensions = [
        confidence_dimension(
            "account_identity",
            "Account identity",
            weight=15,
            checks=[
                ("business name", bool(client.get("name"))),
                ("support email", bool(client.get("email"))),
                ("phone number", bool(client.get("phone"))),
                ("physical address", bool(client.get("address"))),
                ("industry", bool(client.get("industry"))),
            ],
            sources=["clients"],
            evidence_count=1,
            observed_at=_record_time(client),
            fresh_days=90,
            stale_days=730,
            detail="The commercial and support identity technicians rely on.",
        ),
        confidence_dimension(
            "people",
            "People & contacts",
            weight=15,
            checks=[
                ("contact record", bool(contact_rows)),
                ("primary contact", primary_contact),
                ("contact email", bool(emails)),
                ("contact phone", any(item.get("phone") or item.get("mobile") for item in contact_rows)),
            ],
            sources=["clients.contacts", "contacts"],
            evidence_count=len(contact_rows),
            observed_at=newest_timestamp(_record_time(item) for item in contact_rows),
            fresh_days=90,
            stale_days=365,
            gaps=[
                evidence_gap("client.primary_contact", "Confirm the current primary contact.", severity="high", route=f"/clients?client={client_id}")
            ] if not primary_contact else [],
            detail="Named, attributable people and communication details.",
        ),
        confidence_dimension(
            "managed_environment",
            "Managed environment",
            weight=20,
            checks=[
                ("managed device", bool(devices)),
                ("recent device observation", bool(latest_device)),
                ("site or location", bool(sites or any(item.get("site_id") or item.get("location") for item in devices))),
                ("service history", bool(tickets)),
            ],
            sources=["devices", "network_sites", "tickets"],
            evidence_count=len(devices) + len(sites) + len(tickets),
            observed_at=latest_service,
            fresh_days=7,
            stale_days=45,
            gaps=[
                evidence_gap("client.managed_devices", "Verify the managed-device and site scope.", severity="critical", route=f"/clients?client={client_id}")
            ] if not devices else [],
            detail="Endpoints, locations and service activity attributed to this client.",
        ),
        confidence_dimension(
            "commercial",
            "Commercial coverage",
            weight=15,
            checks=[
                ("active contract", any(str(item.get("status") or "").lower() in {"active", "current", "signed"} for item in contracts)),
                ("billable service or recurring plan", bool(services or recurring)),
                ("invoice history", bool(invoices)),
                ("commercial ownership", bool(contracts or services or recurring)),
            ],
            sources=["contracts", "core_services", "recurring_invoices", "invoices"],
            evidence_count=len(contracts) + len(services) + len(recurring) + len(invoices),
            observed_at=latest_commercial,
            fresh_days=45,
            stale_days=365,
            gaps=[
                evidence_gap("client.commercial", "Reconcile the client’s contract, services and billing.", severity="high", route="/services-subscriptions?view=billing")
            ] if not (contracts or services or recurring) else [],
            detail="Contract, service quantity and invoice relationships.",
        ),
        confidence_dimension(
            "documentation",
            "Documentation",
            weight=15,
            checks=[
                ("client-owned documentation", bool(documents)),
                ("substantive document content", any(len(_document_content(item)) >= 100 for item in documents)),
                ("recent documentation review", bool(latest_document)),
                ("multiple operational records", len(documents) >= 2),
            ],
            sources=["documentation", "kb_articles", "auto_generated_docs"],
            evidence_count=len(documents),
            observed_at=latest_document,
            fresh_days=90,
            stale_days=365,
            gaps=[
                evidence_gap("client.documentation", "Review or create client-owned operational documentation.", severity="high", route="/documentation-hub?tab=library")
            ] if not documents else [],
            detail="Client-owned knowledge with content and freshness evidence.",
        ),
        confidence_dimension(
            "protection",
            "Protection & recovery",
            weight=10,
            checks=[
                ("backup evidence", bool(backups)),
                ("managed endpoint evidence", bool(devices)),
                ("recent recovery or protection observation", bool(newest_timestamp(_record_time(item) for item in backups))),
            ],
            sources=["backup_jobs", "devices"],
            evidence_count=len(backups) + len(devices),
            observed_at=newest_timestamp(_record_time(item) for item in backups) or latest_device,
            fresh_days=7,
            stale_days=45,
            gaps=[
                evidence_gap("client.backups", "Confirm backup and recovery coverage.", severity="critical", route="/backup-center")
            ] if not backups else [],
            detail="Observed protection and recovery evidence, not an assumed policy state.",
        ),
        confidence_dimension(
            "integrations",
            "Connected providers",
            weight=10,
            checks=[
                ("connected provider mapping", bool(connected_integrations)),
                ("Microsoft tenant mapping", bool(client.get("cipp_tenant_id") or client.get("m365_tenant_id"))),
                ("backup provider mapping", bool(client.get("acronis_tenant_id") or backups)),
            ],
            sources=["clients", *connected_integrations],
            evidence_count=len(connected_integrations),
            observed_at=_record_time(client),
            fresh_days=90,
            stale_days=365,
            detail="Provider identities mapped to the canonical client.",
        ),
    ]
    conflicts = []
    if duplicate_contact_emails:
        conflicts.append({
            "key": "duplicate_contact_email",
            "severity": "medium",
            "label": f"{len(duplicate_contact_emails)} contact email value(s) are duplicated.",
            "route": f"/clients?client={client_id}",
        })
    if duplicate_serials:
        conflicts.append({
            "key": "duplicate_device_serial",
            "severity": "high",
            "label": f"{len(duplicate_serials)} device serial value(s) are duplicated within the client.",
            "route": "/devices",
        })
    profile = build_confidence_profile(
        entity_type="client",
        entity_id=client_id,
        entity_label=str(client.get("name") or client_id),
        dimensions=dimensions,
        conflicts=conflicts,
        verification=verification,
    )
    profile["client_id"] = client_id
    return profile


async def _find_document(document_id: str) -> tuple[dict | None, str | None]:
    for collection in ("documentation", "kb_articles", "auto_generated_docs"):
        record = await db[collection].find_one({"id": document_id}, {"_id": 0})
        if record:
            return record, collection
    return None, None


async def _documentation_confidence(
    record: dict,
    collection: str,
    verification: dict | None,
) -> dict:
    document_id = str(record["id"])
    content = _document_content(record)
    updated_at = _record_time(record)
    links = record.get("links") or record.get("related_records") or record.get("attachments") or []
    dimensions = [
        confidence_dimension(
            "content",
            "Content quality",
            weight=35,
            checks=[
                ("title", bool(record.get("title"))),
                ("substantive content", len(content) >= 100),
                ("category or document type", bool(record.get("category") or record.get("type"))),
                ("owner or author", bool(record.get("author") or record.get("created_by") or record.get("owner"))),
            ],
            sources=[collection],
            evidence_count=1,
            observed_at=updated_at,
            fresh_days=90,
            stale_days=365,
            detail="Whether the document contains enough attributable operational detail to use.",
        ),
        confidence_dimension(
            "freshness",
            "Freshness",
            weight=30,
            checks=[
                ("dated source record", bool(updated_at)),
                ("review boundary", bool(record.get("reviewed_at") or record.get("next_review_at") or verification)),
                ("revision metadata", bool(record.get("version") or record.get("revision") or record.get("updated_by"))),
            ],
            sources=[collection, "confidence_verifications"] if verification else [collection],
            evidence_count=1 + int(bool(verification)),
            observed_at=(verification or {}).get("verified_at") or updated_at,
            fresh_days=90,
            stale_days=365,
            gaps=[
                evidence_gap("documentation.review", "Review and attest this document against the live environment.", severity="high", route="/documentation-hub?tab=library")
            ] if not verification else [],
            detail="How recently a human or source system confirmed the record.",
        ),
        confidence_dimension(
            "relationships",
            "Relationships",
            weight=20,
            checks=[
                ("owning client", bool(record.get("client_id"))),
                ("linked operational record", bool(links or record.get("device_id") or record.get("ticket_id") or record.get("project_id"))),
            ],
            sources=[collection, "nexus_core"],
            evidence_count=len(links) if isinstance(links, list) else int(bool(links)),
            observed_at=updated_at,
            fresh_days=180,
            stale_days=730,
            detail="Whether the document is attributable to the client and objects it describes.",
        ),
        confidence_dimension(
            "usage",
            "Operational use",
            weight=15,
            checks=[
                ("used by technicians", int(record.get("views") or record.get("view_count") or 0) > 0),
                ("usefulness evidence", int(record.get("helpful_count") or record.get("usefulness_score") or 0) > 0),
            ],
            sources=[collection],
            evidence_count=int(record.get("views") or record.get("view_count") or 0),
            observed_at=updated_at,
            fresh_days=180,
            stale_days=730,
            detail="Use and usefulness signals; unused knowledge remains visible but lower-confidence.",
        ),
    ]
    profile = build_confidence_profile(
        entity_type="documentation",
        entity_id=document_id,
        entity_label=str(record.get("title") or document_id),
        dimensions=dimensions,
        verification=verification,
    )
    profile["client_id"] = record.get("client_id")
    return profile


async def _profile(
    entity_type: str,
    entity_id: str,
    *,
    request: Request,
    current_user: dict,
) -> dict:
    if entity_type not in SUPPORTED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Confidence supports {', '.join(sorted(SUPPORTED_TYPES))}.",
        )
    verification = await _latest_verification(entity_type, entity_id)
    if entity_type == "device":
        record = await db.devices.find_one({"id": entity_id}, {"_id": 0})
        if not record:
            raise HTTPException(status_code=404, detail="Device not found")
        await assert_client_scope(
            current_user,
            record.get("client_id"),
            site_id=record.get("site_id"),
            operation="confidence.device.read",
            request=request,
            mask_not_found=True,
        )
        return await _device_confidence(record, verification)
    if entity_type == "client":
        record = await db.clients.find_one({"id": entity_id}, {"_id": 0})
        if not record:
            raise HTTPException(status_code=404, detail="Client not found")
        await assert_client_scope(
            current_user,
            entity_id,
            operation="confidence.client.read",
            request=request,
        )
        return await _client_confidence(record, verification)

    record, collection = await _find_document(entity_id)
    if not record or not collection:
        raise HTTPException(status_code=404, detail="Documentation record not found")
    if record.get("client_id"):
        await assert_client_scope(
            current_user,
            str(record["client_id"]),
            operation="confidence.documentation.read",
            request=request,
        )
    return await _documentation_confidence(record, collection, verification)


@router.get("/confidence/{entity_type}/{entity_id}")
async def get_confidence_profile(
    entity_type: str,
    entity_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    return await _profile(
        entity_type,
        entity_id,
        request=request,
        current_user=current_user,
    )


@router.post(
    "/confidence/{entity_type}/{entity_id}/verify",
    dependencies=[Depends(require_action("confidence.verify"))],
)
async def verify_confidence_evidence(
    entity_type: str,
    entity_id: str,
    payload: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    profile = await _profile(
        entity_type,
        entity_id,
        request=request,
        current_user=current_user,
    )
    note = str(payload.get("note") or "").strip()
    if len(note) < 10:
        raise HTTPException(status_code=400, detail="Record what was checked in at least 10 characters.")
    valid_for_days = int(payload.get("valid_for_days") or 90)
    if not 1 <= valid_for_days <= 365:
        raise HTTPException(status_code=400, detail="Verification must be valid for 1 to 365 days.")

    now = datetime.now(timezone.utc)
    correlation_id = request_correlation_id(request)
    verification = {
        "id": str(uuid.uuid4()),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_label": profile["entity"]["label"],
        "verified_at": now.isoformat(),
        "expires_at": (now + timedelta(days=valid_for_days)).isoformat(),
        "verified_by": current_user.get("name") or current_user.get("email") or current_user.get("id"),
        "verified_by_id": current_user.get("id"),
        "note": note,
        "score_at_verification": profile["score"],
        "open_gap_count": len(profile["gaps"]),
        "correlation_id": correlation_id,
    }
    await db.confidence_verifications.insert_one(verification.copy())
    await log_activity(
        current_user,
        "confidence_evidence_verified",
        entity_type,
        entity_id,
        profile["entity"]["label"],
        f"Reviewed confidence evidence at {profile['score']}% with {len(profile['gaps'])} open gap(s).",
        metadata={
            "confidence_score": profile["score"],
            "open_gap_count": len(profile["gaps"]),
            "valid_for_days": valid_for_days,
            "note": note,
            "correlation_id": correlation_id,
        },
    )
    await emit_platform_event(
        subject="confidence.assessment.verified",
        source="nexus.confidence",
        actor=current_user,
        correlation_id=correlation_id,
        payload={
            "entity_type": entity_type,
            "entity_id": entity_id,
            "client_id": profile.get("client_id"),
            "score": profile["score"],
            "open_gap_count": len(profile["gaps"]),
            "expires_at": verification["expires_at"],
        },
    )
    refreshed = await _profile(
        entity_type,
        entity_id,
        request=request,
        current_user=current_user,
    )
    return {
        "message": "Evidence review recorded. Missing source evidence remains visible.",
        "verification": {key: value for key, value in verification.items() if key != "_id"},
        "profile": refreshed,
    }
