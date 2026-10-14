"""Evidence-led data-quality read model for Nexus.

Nexus Data Quality is intentionally a *read model*.  It examines retained
Nexus records for deterministic data-integrity signals and points a technician
to the owning workspace.  It neither repairs data nor upgrades missing source
evidence into a pass.

The caller is responsible for providing records already constrained to the
current user's client scope.  Records that cannot be attributed to a permitted
client are deliberately omitted for restricted users; an all-client operator
may receive aggregate orphan counts for controlled review.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Iterable


DATA_QUALITY_SCHEMA_VERSION = 1


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _nonempty(value: Any) -> bool:
    return bool(_text(value))


def _client_label(client: dict[str, Any]) -> str:
    return _text(client.get("name") or client.get("company_name")) or _text(client.get("id")) or "Unlabelled client"


def _record_label(record: dict[str, Any], *fields: str, fallback: str) -> str:
    for field in fields:
        value = _text(record.get(field))
        if value:
            return value
    return fallback


def _source_state(record_count: int, *, truncated: bool = False) -> str:
    if truncated:
        return "partial"
    return "observed" if record_count else "not_observed"


def _source_row(
    source_id: str,
    label: str,
    record_count: int,
    *,
    detail: str,
    truncated: bool = False,
) -> dict[str, Any]:
    capture_detail = (
        f" {detail.rstrip('.')} Nexus stopped this source at the current review limit; "
        "an absence of a signal is not a complete-data result."
        if truncated
        else detail
    )
    return {
        "id": source_id,
        "label": label,
        "state": _source_state(record_count, truncated=truncated),
        "record_count": record_count,
        "detail": capture_detail,
    }


def build_data_quality_snapshot(
    *,
    clients: Iterable[dict[str, Any]] = (),
    devices: Iterable[dict[str, Any]] = (),
    tickets: Iterable[dict[str, Any]] = (),
    subscriptions: Iterable[dict[str, Any]] = (),
    agents: Iterable[dict[str, Any]] = (),
    global_scope: bool = False,
    unattributed_counts: dict[str, int] | None = None,
    source_capture: dict[str, bool] | None = None,
    unattributed_counts_available: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Build a cautious data-quality snapshot from scoped source records.

    ``unattributed_counts`` contains collection counts collected only by an
    explicitly global caller.  Restricted callers must pass no such values;
    data with no provable client owner is outside their permitted view.

    ``source_capture`` records whether a source exceeded the current review
    limit.  A partial capture is deliberately distinct from a clean result:
    the engine may surface evidence from the captured window, but it must not
    represent the unexamined remainder as reviewed.
    """

    now = now or utc_now()
    client_rows = [dict(item) for item in clients]
    device_rows = [dict(item) for item in devices]
    ticket_rows = [dict(item) for item in tickets]
    subscription_rows = [dict(item) for item in subscriptions]
    agent_rows = [dict(item) for item in agents]
    source_capture = {
        _text(source): bool(truncated)
        for source, truncated in (source_capture or {}).items()
        if _text(source)
    }

    client_by_id = {
        _text(item.get("id")): item
        for item in client_rows
        if _text(item.get("id"))
    }
    client_options = [
        {"id": client_id, "name": _client_label(item)}
        for client_id, item in client_by_id.items()
    ]
    client_options.sort(key=lambda item: item["name"].casefold())

    findings: list[dict[str, Any]] = []
    category_counts: Counter[str] = Counter()
    affected_records: set[tuple[str, str]] = set()
    checks_total = 0
    checks_passed = 0

    def check(passed: bool) -> None:
        nonlocal checks_total, checks_passed
        checks_total += 1
        if passed:
            checks_passed += 1

    def add_finding(
        *,
        finding_id: str,
        category: str,
        severity: str,
        title: str,
        detail: str,
        route: str,
        object_type: str,
        object_id: str,
        object_label: str,
        client_id: str | None = None,
        evidence_sources: Iterable[str] = (),
        expected: Any = None,
        observed: Any = None,
    ) -> None:
        # A deterministic ID lets the UI retain a selected item through a safe
        # refresh without persisting this derived record as a second SOR.
        findings.append({
            "id": finding_id,
            "category": category,
            "severity": severity,
            "title": title,
            "detail": detail,
            "route": route,
            "object": {
                "type": object_type,
                "id": object_id,
                "label": object_label,
            },
            "client_id": client_id,
            "client_name": _client_label(client_by_id[client_id]) if client_id in client_by_id else None,
            "expected": expected,
            "observed": observed,
            "provenance": {
                "sources": sorted({_text(source) for source in evidence_sources if _text(source)}),
                "state": "derived_read_model",
                "boundary": "This is a deterministic data-quality signal from retained Nexus records. It does not repair, merge, archive or prove a source record.",
            },
        })
        category_counts[category] += 1
        if object_id:
            affected_records.add((object_type, object_id))

    def owner_known(record: dict[str, Any]) -> tuple[bool, str]:
        client_id = _text(record.get("client_id"))
        return client_id in client_by_id, client_id

    # Client record and embedded contact integrity.
    for index, client in enumerate(client_rows):
        client_id = _text(client.get("id"))
        label = _client_label(client)
        stable_id = bool(client_id)
        named = bool(_text(client.get("name") or client.get("company_name")))
        check(stable_id)
        check(named)
        if not stable_id:
            add_finding(
                finding_id=f"client-missing-id:{index}",
                category="ownership",
                severity="high",
                title="Client record has no stable Nexus ID",
                detail="Relationships cannot safely survive a rename or sync when the client record has no stable ID.",
                route="/clients",
                object_type="client",
                object_id=f"unidentified-client-{index}",
                object_label=label,
                evidence_sources=["clients"],
            )
        if not named:
            add_finding(
                finding_id=f"client-missing-name:{client_id or index}",
                category="identity",
                severity="medium",
                title="Client record has no display name",
                detail="The record has an identifier but no usable client name for technicians, reports or customer-facing context.",
                route="/clients",
                object_type="client",
                object_id=client_id or f"unidentified-client-{index}",
                object_label=label,
                client_id=client_id or None,
                evidence_sources=["clients"],
            )

        contacts = client.get("contacts") if isinstance(client.get("contacts"), list) else []
        primary_contacts = [item for item in contacts if isinstance(item, dict) and item.get("is_primary")]
        communication_paths = [
            item for item in contacts
            if isinstance(item, dict) and any(_nonempty(item.get(field)) for field in ("email", "phone", "mobile"))
        ]
        client_contact = any(_nonempty(client.get(field)) for field in ("email", "phone", "mobile"))
        contact_path_present = bool(communication_paths or client_contact)
        check(contact_path_present)
        if not contact_path_present and client_id:
            add_finding(
                finding_id=f"client-contact-path:{client_id}",
                category="contacts",
                severity="medium",
                title="Client has no recorded communication path",
                detail="No client-level email or phone, and no embedded contact with a recorded email or phone, was found. Nexus cannot infer an escalation contact.",
                route="/clients",
                object_type="client",
                object_id=client_id,
                object_label=label,
                client_id=client_id,
                evidence_sources=["clients.contacts"],
            )
        if len(primary_contacts) > 1 and client_id:
            add_finding(
                finding_id=f"client-multiple-primary-contacts:{client_id}",
                category="contacts",
                severity="low",
                title="Client has multiple primary contacts",
                detail="Several embedded contacts are marked primary. Review the intended escalation owner before automating customer communications.",
                route="/clients",
                object_type="client",
                object_id=client_id,
                object_label=label,
                client_id=client_id,
                evidence_sources=["clients.contacts"],
                expected=1,
                observed=len(primary_contacts),
            )

        for contact_index, contact in enumerate(contacts):
            if not isinstance(contact, dict):
                continue
            contact_id = _text(contact.get("id")) or f"embedded-contact-{contact_index}"
            contact_name = _record_label(contact, "name", "email", "phone", fallback="Unlabelled contact")
            contact_named = bool(_text(contact.get("name")))
            contact_reachable = any(_nonempty(contact.get(field)) for field in ("email", "phone", "mobile"))
            check(contact_named)
            check(contact_reachable)
            if client_id and not contact_named:
                add_finding(
                    finding_id=f"contact-missing-name:{client_id}:{contact_id}",
                    category="contacts",
                    severity="low",
                    title="Embedded contact has no name",
                    detail="The contact remains visible, but technicians cannot reliably identify who owns the recorded communication details.",
                    route="/clients",
                    object_type="contact",
                    object_id=f"{client_id}:{contact_id}",
                    object_label=contact_name,
                    client_id=client_id,
                    evidence_sources=["clients.contacts"],
                )
            if client_id and not contact_reachable:
                add_finding(
                    finding_id=f"contact-missing-method:{client_id}:{contact_id}",
                    category="contacts",
                    severity="medium",
                    title="Embedded contact has no communication method",
                    detail="No email, phone or mobile value is recorded for this contact. Nexus will not treat the contact as reachable.",
                    route="/clients",
                    object_type="contact",
                    object_id=f"{client_id}:{contact_id}",
                    object_label=contact_name,
                    client_id=client_id,
                    evidence_sources=["clients.contacts"],
                )

    # Device identity and ownership quality.  A duplicate serial is a review
    # signal, not proof that a device should be merged or deleted.
    serial_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    device_by_agent_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for index, device in enumerate(device_rows):
        device_id = _text(device.get("id")) or f"unidentified-device-{index}"
        label = _record_label(device, "name", "hostname", "serial_number", fallback="Unlabelled device")
        known_owner, client_id = owner_known(device)
        named = bool(_text(device.get("name") or device.get("hostname")))
        serial = _text(device.get("serial_number"))
        check(known_owner)
        check(named)
        check(bool(serial))
        if not known_owner and global_scope:
            add_finding(
                finding_id=f"device-owner:{device_id}",
                category="ownership",
                severity="high",
                title="Device record has no valid client owner",
                detail="The device is not linked to a current Nexus client record. Do not treat it as safely scoped until its ownership is reviewed.",
                route="/devices",
                object_type="device",
                object_id=device_id,
                object_label=label,
                evidence_sources=["devices", "clients"],
            )
        if known_owner and not named:
            add_finding(
                finding_id=f"device-missing-name:{device_id}",
                category="identity",
                severity="medium",
                title="Device has no hostname or display name",
                detail="The device has a client owner but no usable technician label. Record a canonical hostname or device name before relying on this record in automation.",
                route="/devices",
                object_type="device",
                object_id=device_id,
                object_label=label,
                client_id=client_id,
                evidence_sources=["devices"],
            )
        if known_owner and not serial:
            add_finding(
                finding_id=f"device-missing-serial:{device_id}",
                category="identity",
                severity="medium",
                title="Device has no recorded serial number",
                detail="Nexus cannot use a serial as corroborating identity evidence for this endpoint. This does not mean the device is unsafe or invalid.",
                route="/devices",
                object_type="device",
                object_id=device_id,
                object_label=label,
                client_id=client_id,
                evidence_sources=["devices"],
            )
        if serial:
            serial_groups[serial.casefold()].append(device)
        agent_id = _text(device.get("nexus_agent_id") or device.get("agent_id"))
        if agent_id:
            device_by_agent_id[agent_id].append(device)

    for serial_key, matching_devices in serial_groups.items():
        if len(matching_devices) < 2:
            continue
        for device in matching_devices:
            device_id = _text(device.get("id")) or "unidentified-device"
            client_id = _text(device.get("client_id"))
            add_finding(
                finding_id=f"device-duplicate-serial:{serial_key}:{device_id}",
                category="identity",
                severity="high",
                title="Device serial appears on multiple records",
                detail=f"Nexus observed {len(matching_devices)} device records with the same retained serial evidence. Review source history before merging, archiving or changing any record.",
                route="/devices",
                object_type="device",
                object_id=device_id,
                object_label=_record_label(device, "name", "hostname", fallback="Device"),
                client_id=client_id if client_id in client_by_id else None,
                evidence_sources=["devices"],
                expected=1,
                observed=len(matching_devices),
            )

    # Ticket and service records must preserve an attributable customer and a
    # technician-facing summary.  These checks do not judge SLA, billing or
    # service outcome.
    for source_name, rows, object_type, route, label_fields, title_fields in (
        ("tickets", ticket_rows, "ticket", "/tickets", ("ticket_number", "title", "id"), ("title", "subject")),
        ("subscriptions", subscription_rows, "subscription", "/services-subscriptions?view=attention", ("name", "service_name", "product_name", "id"), ("name", "service_name", "product_name", "product", "sku")),
    ):
        for index, record in enumerate(rows):
            record_id = _text(record.get("id")) or f"unidentified-{object_type}-{index}"
            label = _record_label(record, *label_fields, fallback=f"Unlabelled {object_type}")
            known_owner, client_id = owner_known(record)
            meaningful = any(_nonempty(record.get(field)) for field in title_fields)
            check(known_owner)
            check(meaningful)
            if not known_owner and global_scope:
                add_finding(
                    finding_id=f"{object_type}-owner:{record_id}",
                    category="ownership",
                    severity="high",
                    title=f"{object_type.title()} record has no valid client owner",
                    detail=f"The retained {object_type} cannot be matched to a current Nexus client record. It is excluded from restricted technician views.",
                    route=route,
                    object_type=object_type,
                    object_id=record_id,
                    object_label=label,
                    evidence_sources=[source_name, "clients"],
                )
            if known_owner and not meaningful:
                add_finding(
                    finding_id=f"{object_type}-missing-summary:{record_id}",
                    category="operational",
                    severity="medium" if object_type == "ticket" else "low",
                    title=f"{object_type.title()} record has no usable summary",
                    detail="The record is client-scoped but lacks the source fields technicians use to identify it in operational workflows.",
                    route=route,
                    object_type=object_type,
                    object_id=record_id,
                    object_label=label,
                    client_id=client_id,
                    evidence_sources=[source_name],
                )

    # Agent-to-endpoint link integrity.  A missing link is a data issue; this
    # engine does not make an agent health or deployment claim.
    agents_by_id = {_text(agent.get("id")): agent for agent in agent_rows if _text(agent.get("id"))}
    for index, agent in enumerate(agent_rows):
        agent_id = _text(agent.get("id")) or f"unidentified-agent-{index}"
        label = _record_label(agent, "hostname", "device_name", "id", fallback="Nexus Agent")
        known_owner, client_id = owner_known(agent)
        matching_devices = device_by_agent_id.get(agent_id, [])
        has_device_link = bool(matching_devices)
        check(known_owner)
        check(has_device_link)
        if not known_owner and global_scope:
            add_finding(
                finding_id=f"agent-owner:{agent_id}",
                category="ownership",
                severity="high",
                title="Nexus Agent record has no valid client owner",
                detail="The Agent record cannot be attributed to a current client. Do not use it as evidence for a restricted technician workflow.",
                route="/nexus-agent",
                object_type="agent",
                object_id=agent_id,
                object_label=label,
                evidence_sources=["nexus_agents", "clients"],
            )
        if known_owner and not has_device_link:
            add_finding(
                finding_id=f"agent-device-link:{agent_id}",
                category="operational",
                severity="medium",
                title="Nexus Agent is not linked to an endpoint record",
                detail="The Agent has client ownership but no retained device record references its stable agent ID. Review enrolment or record linkage before using it as endpoint coverage evidence.",
                route="/nexus-agent",
                object_type="agent",
                object_id=agent_id,
                object_label=label,
                client_id=client_id,
                evidence_sources=["nexus_agents", "devices"],
            )
        for device in matching_devices:
            device_client_id = _text(device.get("client_id"))
            if known_owner and device_client_id in client_by_id and device_client_id != client_id:
                add_finding(
                    finding_id=f"agent-client-mismatch:{agent_id}:{_text(device.get('id'))}",
                    category="ownership",
                    severity="high",
                    title="Nexus Agent and linked endpoint disagree on client ownership",
                    detail="The same stable Agent ID is linked to records with different client ownership. Review the authoritative ownership before any remote, automation or billing operation.",
                    route="/devices",
                    object_type="device",
                    object_id=_text(device.get("id")) or f"linked-device-{agent_id}",
                    object_label=_record_label(device, "name", "hostname", fallback="Linked endpoint"),
                    client_id=device_client_id,
                    evidence_sources=["nexus_agents", "devices", "clients"],
                    expected=client_id,
                    observed=device_client_id,
                )

    for device in device_rows:
        device_id = _text(device.get("id")) or "unidentified-device"
        client_id = _text(device.get("client_id"))
        linked_agent_id = _text(device.get("nexus_agent_id") or device.get("agent_id"))
        if not linked_agent_id:
            continue
        linked_agent = agents_by_id.get(linked_agent_id)
        check(bool(linked_agent))
        if client_id in client_by_id and not linked_agent:
            add_finding(
                finding_id=f"device-agent-reference:{device_id}",
                category="operational",
                severity="high",
                title="Device references a Nexus Agent record that is unavailable",
                detail="The device carries a stable Nexus Agent ID, but no retained Agent record in the permitted source set matches it. Verify enrolment before relying on the link.",
                route="/devices",
                object_type="device",
                object_id=device_id,
                object_label=_record_label(device, "name", "hostname", fallback="Device"),
                client_id=client_id,
                evidence_sources=["devices", "nexus_agents"],
            )

    unattributed_counts = {
        _text(source): max(0, int(count or 0))
        for source, count in (unattributed_counts or {}).items()
        if _text(source)
    }
    if global_scope:
        for source, count in sorted(unattributed_counts.items()):
            if not count:
                continue
            add_finding(
                finding_id=f"unattributed-source:{source}",
                category="ownership",
                severity="high",
                title=f"{count} {source.replace('_', ' ')} record{'s' if count != 1 else ''} need client ownership review",
                detail="These records have no current valid client reference. Only an all-client operator can see this aggregate so client isolation remains fail-closed.",
                route={
                    "devices": "/devices",
                    "tickets": "/tickets",
                    "subscriptions": "/services-subscriptions?view=attention",
                    "nexus_agents": "/nexus-agent",
                }.get(source, "/clients"),
                object_type="source_collection",
                object_id=source,
                object_label=source.replace("_", " ").title(),
                evidence_sources=[source, "clients"],
                expected=0,
                observed=count,
            )

    findings.sort(
        key=lambda item: (
            {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(item["severity"], 4),
            item.get("client_name") or "",
            item["title"],
        )
    )
    records_examined = sum((len(client_rows), len(device_rows), len(ticket_rows), len(subscription_rows), len(agent_rows)))
    observed_score = round(checks_passed / checks_total * 100) if checks_total else None
    source_rows = [
        _source_row("clients", "Client register", len(client_rows), detail="Stable client identity and embedded communication records.", truncated=source_capture.get("clients", False)),
        _source_row("devices", "Device register", len(device_rows), detail="Endpoint ownership, identity and retained Agent references.", truncated=source_capture.get("devices", False)),
        _source_row("tickets", "Service Desk", len(ticket_rows), detail="Client-owned ticket records and technician-facing summaries.", truncated=source_capture.get("tickets", False)),
        _source_row("subscriptions", "Services & subscriptions", len(subscription_rows), detail="Client-owned commercial service records.", truncated=source_capture.get("subscriptions", False)),
        _source_row("nexus_agents", "Nexus Agent", len(agent_rows), detail="Retained Agent ownership and endpoint-link evidence.", truncated=source_capture.get("nexus_agents", False)),
    ]
    truncated_sources = [item["id"] for item in source_rows if item["state"] == "partial"]
    categories = [
        {
            "id": key,
            "label": label,
            "finding_count": category_counts.get(key, 0),
            "state": "attention" if category_counts.get(key, 0) else "clear_in_observed_data" if records_examined else "not_assessed",
            "detail": detail,
        }
        for key, label, detail in (
            ("ownership", "Ownership & relationships", "Stable client ownership and cross-record boundaries."),
            ("identity", "Identity & duplicates", "Names, identifiers and duplicate source evidence."),
            ("contacts", "Contact usability", "Technician-visible customer communication paths."),
            ("operational", "Operational hand-offs", "Ticket, service and agent links needed for dependable work."),
        )
    ]
    attention_count = len(findings)
    state = (
        "not_assessed" if not checks_total
        else "attention_required" if attention_count
        else "partial_review" if truncated_sources
        else "observed_clean"
    )
    capture_state = "partial" if truncated_sources else "complete"
    boundary = (
        "Nexus Data Quality evaluates deterministic checks against retained, client-scoped Nexus records. "
        "It does not invent missing data, decide an authoritative record, merge duplicates, or repair any source. "
        "A clear observed signal applies only to the checks and sources shown."
    )
    if truncated_sources:
        boundary += (
            " One or more sources reached the current review limit, so Nexus does not treat the absence of a signal "
            "as evidence that the complete source is clean."
        )
    if global_scope and not unattributed_counts_available:
        boundary += (
            " Aggregate unowned-record review is deferred because the client register capture is partial; Nexus will not "
            "misclassify records owned by an unexamined client as orphaned."
        )

    return {
        "schema_version": DATA_QUALITY_SCHEMA_VERSION,
        "generated_at": now.isoformat(),
        "read_model": "nexus-data-quality",
        "summary": {
            "state": state,
            "observed_quality_signal": observed_score,
            "records_examined": records_examined,
            "deterministic_checks": checks_total,
            "checks_passed": checks_passed,
            "findings": attention_count,
            "affected_records": len(affected_records),
            "sources_observed": sum(item["state"] == "observed" for item in source_rows),
            "sources_partial": len(truncated_sources),
            "sources_not_observed": sum(item["state"] == "not_observed" for item in source_rows),
            "capture_state": capture_state,
            "truncated_sources": truncated_sources,
        },
        "scope": {
            "mode": "all_clients" if global_scope else "restricted_clients",
            "client_count": len(client_by_id),
            "unattributed_records_visible": bool(global_scope),
            "unattributed_records_excluded_for_restricted_users": not global_scope,
            "unattributed_records_review_deferred": bool(global_scope and not unattributed_counts_available),
        },
        "clients": client_options,
        "sources": source_rows,
        "categories": categories,
        "findings": findings,
        "boundary": boundary,
        "provenance": {
            "state": "derived_read_model",
            "authoritative_sources": {
                "clients": "clients",
                "devices": "devices",
                "tickets": "tickets",
                "subscriptions": "subscriptions",
                "nexus_agents": "nexus_agents",
            },
            "no_persistence": True,
            "no_automatic_remediation": True,
            "source_of_truth": "Each finding points to the source workspace. This response is not an independent client, device, ticket, service or agent system of record.",
        },
    }
