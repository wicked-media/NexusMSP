"""Canonical Nexus Core entity and relationship index.

The current application remains the source of truth while this compatibility
layer gives every module one stable vocabulary:

Client -> Site -> Contact/User -> Device -> Service -> Contract -> Ticket ->
Invoice -> Integration.

The index is derived, versioned and rebuildable. Source collections are never
deleted or renamed by this service, which lets domains migrate to the shared
model incrementally without a big-bang database rewrite.
"""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from pymongo import ReplaceOne

from app.database import db


CORE_SCHEMA_VERSION = 1
CORE_ENTITY_ORDER = (
    "client", "site", "contact", "user", "device", "service",
    "contract", "ticket", "invoice", "integration",
)

CORE_ENTITY_TYPES = (
    {
        "id": "client",
        "label": "Client",
        "description": "The canonical commercial and operational boundary.",
        "sources": ["clients"],
        "required_parent": None,
    },
    {
        "id": "site",
        "label": "Site",
        "description": "A physical, network or service-delivery location owned by a client.",
        "sources": ["network_sites"],
        "required_parent": "client",
    },
    {
        "id": "contact",
        "label": "Contact",
        "description": "A client-facing person and communication identity.",
        "sources": ["clients.contacts", "contacts"],
        "required_parent": "client",
    },
    {
        "id": "user",
        "label": "User",
        "description": "A managed customer identity from Microsoft or another identity provider.",
        "sources": ["m365_users", "client_portal_users"],
        "required_parent": "client",
    },
    {
        "id": "device",
        "label": "Device",
        "description": "The stable managed-asset identity used by Nexus Agent and Remote.",
        "sources": ["devices", "nexus_agents"],
        "required_parent": "client",
    },
    {
        "id": "service",
        "label": "Service",
        "description": "A billable or protected service with a declared source-of-truth quantity.",
        "sources": ["core_services", "usage_billing", "yeastar_pbxs"],
        "required_parent": "client",
    },
    {
        "id": "contract",
        "label": "Contract",
        "description": "The commercial agreement governing services, SLA and billing.",
        "sources": ["contracts"],
        "required_parent": "client",
    },
    {
        "id": "ticket",
        "label": "Ticket",
        "description": "The auditable service record linking people, devices and work.",
        "sources": ["tickets"],
        "required_parent": "client",
    },
    {
        "id": "invoice",
        "label": "Invoice",
        "description": "A financial record or recurring billing plan linked to its client and contract.",
        "sources": ["invoices", "recurring_invoices"],
        "required_parent": "client",
    },
    {
        "id": "integration",
        "label": "Integration",
        "description": "A client-to-provider connection with authentication, health and mappings.",
        "sources": ["yeastar_pbxs", "client integration fields"],
        "required_parent": "client",
    },
)

CORE_RELATION_TYPES = (
    {"id": "client.owns", "from": "client", "to": ["site", "contact", "user", "device", "service", "contract", "ticket", "invoice", "integration"]},
    {"id": "site.contains", "from": "site", "to": ["device", "service"]},
    {"id": "user.uses", "from": "user", "to": ["device"]},
    {"id": "service.governed_by", "from": "service", "to": ["contract"]},
    {"id": "integration.provides", "from": "integration", "to": ["service"]},
    {"id": "ticket.concerns", "from": "ticket", "to": ["device", "contact", "user"]},
    {"id": "invoice.bills", "from": "invoice", "to": ["contract", "ticket", "service"]},
)

CLIENT_INTEGRATION_FIELDS = {
    "pax8_company_id": ("pax8", "Pax8"),
    "cipp_tenant_id": ("microsoft365", "Microsoft 365"),
    "suped_tenant_id": ("suped", "Suped"),
    "acronis_tenant_id": ("acronis", "Acronis"),
    "unifi_site_id": ("unifi", "UniFi"),
    "splynx_customer_id": ("splynx", "Splynx"),
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_id(value: Any) -> str:
    return str(value or "").strip()


def _digest(*values: Any, length: int = 20) -> str:
    raw = "|".join(str(value or "").strip().casefold() for value in values)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:length]


def core_ref(entity_type: str, entity_id: str) -> str:
    return f"nexus:{entity_type}:{entity_id}"


def relationship_id(relation_type: str, from_ref: str, to_ref: str) -> str:
    return f"nexus:relationship:{_digest(relation_type, from_ref, to_ref, length=28)}"


def core_schema() -> dict[str, Any]:
    return {
        "name": "Nexus Core",
        "schema_version": CORE_SCHEMA_VERSION,
        "canonical_path": list(CORE_ENTITY_ORDER),
        "entity_types": list(CORE_ENTITY_TYPES),
        "relationship_types": list(CORE_RELATION_TYPES),
        "rules": [
            "Every operational object has one stable Nexus reference.",
            "Every client-owned object resolves to one canonical client ID.",
            "Provider records keep their native IDs as external references.",
            "Relationships carry source evidence and never invent missing links.",
            "The derived index may be rebuilt without mutating source collections.",
        ],
    }


async def _rows(collection: str, limit: int = 20000) -> list[dict]:
    return await db[collection].find({}, {"_id": 0}).limit(limit).to_list(limit)


async def build_core_index(*, persist: bool, actor: dict | None = None, correlation_id: str | None = None) -> dict[str, Any]:
    generation = str(uuid.uuid4())
    generated_at = _now()
    source_names = [
        "clients", "network_sites", "contacts", "m365_users",
        "client_portal_users", "devices", "nexus_agents", "core_services",
        "usage_billing", "contracts", "tickets", "invoices",
        "recurring_invoices", "yeastar_pbxs",
    ]
    results = await asyncio.gather(*(_rows(name) for name in source_names))
    source = dict(zip(source_names, results))

    entities: dict[str, dict] = {}
    relationships: dict[str, dict] = {}
    anomalies: list[dict] = []
    source_totals: Counter = Counter()
    source_linked: Counter = Counter()

    clients = source["clients"]
    client_by_id = {_safe_id(item.get("id")): item for item in clients if _safe_id(item.get("id"))}
    client_name_ids: dict[str, list[str]] = defaultdict(list)
    for item in clients:
        client_name_ids[str(item.get("name") or item.get("company_name") or "").strip().casefold()].append(_safe_id(item.get("id")))
    tenant_to_client = {}
    for client_id, item in client_by_id.items():
        for field in ("cipp_tenant_id", "m365_tenant_id", "tenant_id"):
            if _safe_id(item.get(field)):
                tenant_to_client[_safe_id(item.get(field))] = client_id

    def resolve_client(row: dict) -> str | None:
        direct = _safe_id(row.get("client_id"))
        if direct:
            return direct if direct in client_by_id else None
        tenant = _safe_id(row.get("tenant_id") or row.get("customer_id"))
        if tenant and tenant in tenant_to_client:
            return tenant_to_client[tenant]
        name = str(row.get("client_name") or row.get("company_name") or "").strip().casefold()
        matches = client_name_ids.get(name, [])
        return matches[0] if len(matches) == 1 else None

    def add_entity(
        entity_type: str,
        source_collection: str,
        source_id: str,
        *,
        name: str,
        client_id: str | None = None,
        site_id: str | None = None,
        status: str | None = None,
        external_refs: dict | None = None,
        metadata: dict | None = None,
    ) -> str:
        stable_id = _safe_id(source_id) or _digest(source_collection, name, client_id)
        ref = core_ref(entity_type, stable_id)
        entities[ref] = {
            "id": ref,
            "entity_type": entity_type,
            "entity_id": stable_id,
            "schema_version": CORE_SCHEMA_VERSION,
            "tenant_id": "nexus-local",
            "client_id": client_id,
            "site_id": site_id,
            "name": str(name or stable_id),
            "status": status,
            "source": {"collection": source_collection, "id": stable_id},
            "external_refs": external_refs or {},
            "metadata": metadata or {},
            "generation": generation,
            "active": True,
            "indexed_at": generated_at,
        }
        source_totals[source_collection] += 1
        if entity_type == "client" or client_id:
            source_linked[source_collection] += 1
        return ref

    def add_relation(
        relation_type: str,
        from_ref: str,
        to_ref: str,
        *,
        client_id: str | None,
        evidence: str,
        source_collection: str,
        source_id: str,
    ) -> None:
        if from_ref not in entities or to_ref not in entities:
            anomalies.append({
                "type": "dangling_relationship",
                "severity": "high",
                "source_collection": source_collection,
                "source_id": source_id,
                "message": f"{relation_type} could not resolve both canonical objects.",
            })
            return
        rid = relationship_id(relation_type, from_ref, to_ref)
        relationships[rid] = {
            "id": rid,
            "relation_type": relation_type,
            "from_ref": from_ref,
            "to_ref": to_ref,
            "tenant_id": "nexus-local",
            "client_id": client_id,
            "evidence": evidence,
            "source": {"collection": source_collection, "id": _safe_id(source_id)},
            "schema_version": CORE_SCHEMA_VERSION,
            "generation": generation,
            "active": True,
            "indexed_at": generated_at,
        }

    def client_owner(entity_ref: str, client_id: str | None, collection: str, source_id: str) -> None:
        if not client_id:
            anomalies.append({
                "type": "missing_client",
                "severity": "high",
                "entity_ref": entity_ref,
                "source_collection": collection,
                "source_id": source_id,
                "message": "Client-owned record does not resolve to a canonical client.",
            })
            return
        add_relation(
            "client.owns",
            core_ref("client", client_id),
            entity_ref,
            client_id=client_id,
            evidence=f"{collection}.client_id or an unambiguous provider mapping",
            source_collection=collection,
            source_id=source_id,
        )

    # Clients are the canonical root.
    for item in clients:
        client_id = _safe_id(item.get("id"))
        add_entity(
            "client",
            "clients",
            client_id,
            name=item.get("name") or item.get("company_name") or client_id,
            client_id=client_id,
            status=item.get("lifecycle") or item.get("status"),
            external_refs={field: item.get(field) for field in CLIENT_INTEGRATION_FIELDS if item.get(field)},
            metadata={"industry": item.get("industry"), "tier": item.get("tier")},
        )

    # Sites.
    site_client: dict[str, str] = {}
    for item in source["network_sites"]:
        sid = _safe_id(item.get("id") or item.get("site_id"))
        client_id = resolve_client(item)
        ref = add_entity("site", "network_sites", sid, name=item.get("name") or item.get("location") or sid, client_id=client_id, status=item.get("status"), external_refs={"provider_site_id": item.get("site_id")})
        if client_id:
            site_client[sid] = client_id
        client_owner(ref, client_id, "network_sites", sid)

    # Embedded and standalone contacts.
    for client in clients:
        client_id = _safe_id(client.get("id"))
        for contact in client.get("contacts") or []:
            cid = _safe_id(contact.get("id")) or _digest(client_id, contact.get("email"), contact.get("name"))
            ref = add_entity("contact", "clients.contacts", cid, name=contact.get("name") or contact.get("email") or "Client contact", client_id=client_id, status="active", external_refs={"email": contact.get("email")}, metadata={"phone": contact.get("phone"), "role": contact.get("role")})
            client_owner(ref, client_id, "clients.contacts", cid)
    for item in source["contacts"]:
        cid = _safe_id(item.get("id")) or _digest(item.get("client_id"), item.get("email"), item.get("name"))
        client_id = resolve_client(item)
        ref = add_entity("contact", "contacts", cid, name=item.get("name") or item.get("email") or cid, client_id=client_id, status=item.get("status", "active"), external_refs={"email": item.get("email")})
        client_owner(ref, client_id, "contacts", cid)

    # Managed identities.
    user_by_lookup: dict[tuple[str, str], str] = {}
    for collection in ("m365_users", "client_portal_users"):
        for item in source[collection]:
            uid = _safe_id(item.get("id") or item.get("user_id") or item.get("upn") or item.get("email"))
            client_id = resolve_client(item)
            upn = str(item.get("upn") or item.get("user_principal_name") or item.get("email") or "").strip()
            ref = add_entity("user", collection, uid, name=item.get("display_name") or item.get("name") or upn or uid, client_id=client_id, status="active" if item.get("account_enabled", item.get("is_active", True)) else "disabled", external_refs={"upn": upn, "provider_tenant_id": item.get("tenant_id")})
            if client_id and upn:
                user_by_lookup[(client_id, upn.casefold())] = ref
            client_owner(ref, client_id, collection, uid)

    # Devices and their Nexus Agent identity.
    devices_by_id: dict[str, str] = {}
    devices_by_host: dict[tuple[str, str], str] = {}
    for item in source["devices"]:
        did = _safe_id(item.get("id"))
        client_id = resolve_client(item)
        site_id = _safe_id(item.get("site_id")) or None
        ref = add_entity("device", "devices", did, name=item.get("name") or item.get("hostname") or did, client_id=client_id, site_id=site_id, status=item.get("status"), external_refs={"serial_number": item.get("serial_number"), "agent_id": item.get("agent_id") or item.get("nexus_agent_id")}, metadata={"device_type": item.get("device_type"), "os": item.get("os")})
        devices_by_id[did] = ref
        host = str(item.get("hostname") or item.get("name") or "").strip().casefold()
        if client_id and host:
            devices_by_host[(client_id, host)] = ref
        client_owner(ref, client_id, "devices", did)
        if site_id:
            add_relation("site.contains", core_ref("site", site_id), ref, client_id=client_id, evidence="devices.site_id", source_collection="devices", source_id=did)
        assigned = str(item.get("assigned_user") or item.get("last_logged_in_user") or "").strip().casefold()
        user_ref = user_by_lookup.get((client_id, assigned)) if client_id and assigned else None
        if user_ref:
            add_relation("user.uses", user_ref, ref, client_id=client_id, evidence="devices.assigned_user", source_collection="devices", source_id=did)

    for agent in source["nexus_agents"]:
        client_id = resolve_client(agent)
        agent_id = _safe_id(agent.get("id"))
        device_ref = devices_by_id.get(_safe_id(agent.get("device_id")))
        if not device_ref:
            device_ref = devices_by_host.get((client_id, str(agent.get("hostname") or "").strip().casefold()))
        if device_ref:
            entities[device_ref]["external_refs"]["nexus_agent_id"] = agent_id
            entities[device_ref]["metadata"]["agent_version"] = agent.get("agent_version")
            entities[device_ref]["metadata"]["agent_last_seen"] = agent.get("last_seen")
        else:
            ref = add_entity("device", "nexus_agents", agent_id, name=agent.get("hostname") or agent_id, client_id=client_id, status="online" if agent.get("is_active") and agent.get("online", True) else "offline", external_refs={"nexus_agent_id": agent_id}, metadata={"agent_version": agent.get("agent_version"), "os": agent.get("os")})
            client_owner(ref, client_id, "nexus_agents", agent_id)

    # Contracts are indexed before services so commercial relationships can be
    # resolved in the same generation without producing false dangling links.
    for item in source["contracts"]:
        cid = _safe_id(item.get("id"))
        client_id = resolve_client(item)
        ref = add_entity("contract", "contracts", cid, name=item.get("name") or item.get("contract_name") or cid, client_id=client_id, status=item.get("status"), metadata={"billing_frequency": item.get("billing_frequency"), "end_date": item.get("end_date"), "sla_tier": item.get("sla_tier")})
        client_owner(ref, client_id, "contracts", cid)

    # Services with explicit source-of-truth metadata.
    service_refs: dict[str, str] = {}
    for item in source["core_services"]:
        sid = _safe_id(item.get("id"))
        client_id = resolve_client(item)
        ref = add_entity("service", "core_services", sid, name=item.get("name") or item.get("service_name") or sid, client_id=client_id, site_id=_safe_id(item.get("site_id")) or None, status=item.get("status", "active"), external_refs={"provider": item.get("provider"), "provider_id": item.get("provider_id")}, metadata={"quantity": item.get("quantity"), "quantity_source": item.get("quantity_source"), "product_id": item.get("product_id")})
        service_refs[sid] = ref
        client_owner(ref, client_id, "core_services", sid)
        if item.get("contract_id"):
            add_relation("service.governed_by", ref, core_ref("contract", _safe_id(item.get("contract_id"))), client_id=client_id, evidence="core_services.contract_id", source_collection="core_services", source_id=sid)
    for item in source["usage_billing"]:
        sid = f"usage-billing:{_safe_id(item.get('id'))}"
        client_id = resolve_client(item)
        ref = add_entity("service", "usage_billing", sid, name=f"{item.get('plan_type', 'usage')} service", client_id=client_id, status="active", external_refs={"usage_billing_id": item.get("id")}, metadata={"quantity": item.get("device_count") or item.get("user_count"), "quantity_source": "usage_billing", "current_mrr": item.get("current_mrr")})
        service_refs[sid] = ref
        client_owner(ref, client_id, "usage_billing", sid)

    # Tickets and their device/contact links.
    for item in source["tickets"]:
        tid = _safe_id(item.get("id"))
        client_id = resolve_client(item)
        ref = add_entity("ticket", "tickets", tid, name=item.get("title") or item.get("subject") or item.get("ticket_number") or tid, client_id=client_id, status=item.get("status"), external_refs={"ticket_number": item.get("ticket_number")}, metadata={"priority": item.get("priority"), "category": item.get("category")})
        client_owner(ref, client_id, "tickets", tid)
        linked_devices = {_safe_id(value) for value in (item.get("device_ids") or []) if _safe_id(value)}
        if _safe_id(item.get("device_id")):
            linked_devices.add(_safe_id(item.get("device_id")))
        for did in linked_devices:
            add_relation("ticket.concerns", ref, core_ref("device", did), client_id=client_id, evidence="tickets.device_id/device_ids", source_collection="tickets", source_id=tid)
        if _safe_id(item.get("contact_id")):
            add_relation("ticket.concerns", ref, core_ref("contact", _safe_id(item.get("contact_id"))), client_id=client_id, evidence="tickets.contact_id", source_collection="tickets", source_id=tid)

    # Invoices and recurring billing plans.
    for collection in ("invoices", "recurring_invoices"):
        for item in source[collection]:
            iid = _safe_id(item.get("id"))
            client_id = resolve_client(item)
            ref = add_entity("invoice", collection, iid, name=item.get("invoice_name") or item.get("description") or item.get("invoice_number") or iid, client_id=client_id, status=item.get("status"), external_refs={"invoice_number": item.get("invoice_number"), "xero_invoice_id": item.get("xero_invoice_id")}, metadata={"total": item.get("total") or item.get("amount"), "recurring": collection == "recurring_invoices" or item.get("is_recurring")})
            client_owner(ref, client_id, collection, iid)
            if _safe_id(item.get("contract_id")):
                add_relation("invoice.bills", ref, core_ref("contract", _safe_id(item.get("contract_id"))), client_id=client_id, evidence=f"{collection}.contract_id", source_collection=collection, source_id=iid)
            if _safe_id(item.get("ticket_id")):
                add_relation("invoice.bills", ref, core_ref("ticket", _safe_id(item.get("ticket_id"))), client_id=client_id, evidence=f"{collection}.ticket_id", source_collection=collection, source_id=iid)

    # Provider integrations and provider-backed services.
    for item in source["yeastar_pbxs"]:
        pbx_id = _safe_id(item.get("id"))
        client_id = resolve_client(item)
        integration_ref = add_entity("integration", "yeastar_pbxs", f"yeastar:{pbx_id}", name=item.get("name") or "Yeastar PBX", client_id=client_id, status=item.get("status"), external_refs={"provider": "yeastar", "pbx_id": pbx_id, "fqdn": item.get("pbx_url") or item.get("fqdn")})
        client_owner(integration_ref, client_id, "yeastar_pbxs", pbx_id)
        service_id = f"voice:{pbx_id}"
        service_ref = add_entity("service", "yeastar_pbxs", service_id, name=f"{item.get('name') or 'Yeastar'} voice service", client_id=client_id, status="active" if item.get("enabled", True) else "disabled", external_refs={"provider": "yeastar", "pbx_id": pbx_id}, metadata={"quantity": item.get("billable_extension_count") or item.get("extension_count"), "quantity_source": "yeastar_extensions", "product_mapping": item.get("product_mapping")})
        client_owner(service_ref, client_id, "yeastar_pbxs", service_id)
        add_relation("integration.provides", integration_ref, service_ref, client_id=client_id, evidence="yeastar_pbxs billable extension source", source_collection="yeastar_pbxs", source_id=pbx_id)
        contract_id = _safe_id(item.get("agreement_mapping") or item.get("contract_id"))
        if contract_id:
            add_relation("service.governed_by", service_ref, core_ref("contract", contract_id), client_id=client_id, evidence="yeastar_pbxs.agreement_mapping", source_collection="yeastar_pbxs", source_id=pbx_id)

    for client_id, client in client_by_id.items():
        for field, (provider, label) in CLIENT_INTEGRATION_FIELDS.items():
            external_id = _safe_id(client.get(field))
            if not external_id:
                continue
            iid = f"{provider}:{client_id}"
            ref = add_entity("integration", "clients", iid, name=f"{label} connection", client_id=client_id, status="linked", external_refs={"provider": provider, "external_id": external_id}, metadata={"link_field": field})
            client_owner(ref, client_id, "clients", iid)

    # Calculate coverage and integrity.
    coverage = []
    for collection in sorted(source_totals):
        total = source_totals[collection]
        linked = source_linked[collection]
        coverage.append({
            "source": collection,
            "records": total,
            "client_linked": linked,
            "coverage_pct": round((linked / total) * 100, 1) if total else 100.0,
        })
    entity_counts = Counter(item["entity_type"] for item in entities.values())
    relation_counts = Counter(item["relation_type"] for item in relationships.values())
    high_anomalies = sum(1 for item in anomalies if item["severity"] == "high")
    linked_owned = sum(1 for item in relationships.values() if item["relation_type"] == "client.owns")
    client_owned_entities = sum(1 for item in entities.values() if item["entity_type"] != "client")
    linked_pct = round((linked_owned / client_owned_entities) * 100, 1) if client_owned_entities else 100.0

    integrity = {
        "id": generation,
        "schema_version": CORE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": (actor or {}).get("name") or (actor or {}).get("email") or "Nexus System",
        "correlation_id": correlation_id,
        "status": "attention" if high_anomalies else "healthy",
        "entities": len(entities),
        "relationships": len(relationships),
        "client_linked_pct": linked_pct,
        "anomaly_count": len(anomalies),
        "high_anomaly_count": high_anomalies,
        "entity_counts": dict(entity_counts),
        "relation_counts": dict(relation_counts),
        "coverage": coverage,
        "anomalies": anomalies[:200],
    }

    if persist:
        await db.core_entities.update_many(
            {"source.indexer": "nexus-core-rebuild"},
            {"$set": {"active": False, "superseded_at": generated_at}},
        )
        entity_ops = []
        for item in entities.values():
            item["source"]["indexer"] = "nexus-core-rebuild"
            entity_ops.append(ReplaceOne({"id": item["id"]}, item, upsert=True))
        if entity_ops:
            await db.core_entities.bulk_write(entity_ops, ordered=False)

        await db.core_relationships.update_many(
            {"source.indexer": "nexus-core-rebuild"},
            {"$set": {"active": False, "superseded_at": generated_at}},
        )
        relation_ops = []
        for item in relationships.values():
            item["source"]["indexer"] = "nexus-core-rebuild"
            relation_ops.append(ReplaceOne({"id": item["id"]}, item, upsert=True))
        if relation_ops:
            await db.core_relationships.bulk_write(relation_ops, ordered=False)
        await db.core_integrity_runs.insert_one(dict(integrity))
        await db.core_foundation_state.update_one(
            {"id": "nexus-core"},
            {"$set": {
                "id": "nexus-core",
                "schema_version": CORE_SCHEMA_VERSION,
                "last_rebuild_id": generation,
                "last_rebuilt_at": generated_at,
                "last_rebuilt_by": integrity["generated_by"],
                "entity_count": len(entities),
                "relationship_count": len(relationships),
                "status": integrity["status"],
            }},
            upsert=True,
        )
    return integrity


async def core_integrity_snapshot() -> dict[str, Any]:
    latest = await db.core_integrity_runs.find_one({}, {"_id": 0}, sort=[("generated_at", -1)])
    state = await db.core_foundation_state.find_one({"id": "nexus-core"}, {"_id": 0}) or {}
    if not latest:
        return {
            "status": "not_indexed",
            "schema_version": CORE_SCHEMA_VERSION,
            "entities": 0,
            "relationships": 0,
            "client_linked_pct": 0,
            "anomaly_count": 0,
            "entity_counts": {},
            "relation_counts": {},
            "coverage": [],
            "anomalies": [],
            "last_rebuilt_at": None,
        }
    return {**latest, "last_rebuilt_at": state.get("last_rebuilt_at") or latest.get("generated_at")}


async def client_core_graph(client_id: str) -> dict[str, Any]:
    client_ref = core_ref("client", client_id)
    nodes = await db.core_entities.find(
        {"active": True, "$or": [{"id": client_ref}, {"client_id": client_id}]},
        {"_id": 0},
    ).limit(3000).to_list(3000)
    refs = {item["id"] for item in nodes}
    edges = await db.core_relationships.find(
        {
            "active": True,
            "client_id": client_id,
            "$or": [{"from_ref": {"$in": list(refs)}}, {"to_ref": {"$in": list(refs)}}],
        },
        {"_id": 0},
    ).limit(5000).to_list(5000)
    return {
        "client_id": client_id,
        "schema_version": CORE_SCHEMA_VERSION,
        "nodes": nodes,
        "edges": edges,
        "counts": dict(Counter(item["entity_type"] for item in nodes)),
        "relationship_counts": dict(Counter(item["relation_type"] for item in edges)),
    }
