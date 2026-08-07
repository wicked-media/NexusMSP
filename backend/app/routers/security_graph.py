"""Evidence-backed security relationship graph.

The graph intentionally uses only persisted NexusMSP records. It does not
invent identities, privileges, services, or attack paths when connectors have
not supplied that evidence.
"""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query

from app.auth import get_current_user
from app.database import db

router = APIRouter(prefix="/security-graph", tags=["Security Graph"])

OPEN_STATUSES = {"open", "active", "new", "detected", "investigating", "unresolved", "pending"}
TRUSTED_VULNERABILITY_SOURCES = {"agent", "huntress", "defender", "vulnerability-provider"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normal(value: Any) -> str:
    return str(value or "").strip().lower()


def _is_open(record: dict) -> bool:
    status = _normal(record.get("status"))
    if "resolved" in record and record.get("resolved") is True:
        return False
    return not status or status in OPEN_STATUSES


def _matches_client(record: dict, client_id: str, client_name: str) -> bool:
    if not client_id:
        return True
    return (
        str(record.get("client_id") or "") == client_id
        or (client_name and _normal(record.get("client_name") or record.get("organization")) == _normal(client_name))
    )


def _group_canary_triggers(triggers: list[dict]) -> list[dict]:
    """Collapse repeated unresolved Canary signals into one endpoint exposure.

    Security Graph represents relationships, not an event log. Repeated signals
    from the same endpoint therefore enrich a single path instead of inflating
    the critical-path count. The underlying events remain available in Shield.
    """
    grouped: dict[tuple[str, str], list[dict]] = {}
    for trigger in triggers:
        client_key = _normal(trigger.get("client_id") or trigger.get("client_name") or "unassigned")
        device_key = _normal(trigger.get("device_id") or trigger.get("device_name") or "unknown-device")
        grouped.setdefault((client_key, device_key), []).append(trigger)

    result: list[dict] = []
    for records in grouped.values():
        ordered = sorted(records, key=lambda item: str(item.get("triggered_at") or ""))
        latest = dict(ordered[-1])
        latest["_event_count"] = len(ordered)
        latest["_first_triggered_at"] = ordered[0].get("triggered_at")
        latest["_last_triggered_at"] = ordered[-1].get("triggered_at")
        latest["_file_paths"] = list(dict.fromkeys(
            str(item.get("file_path") or "").strip()
            for item in ordered
            if str(item.get("file_path") or "").strip()
        ))
        latest["_trigger_types"] = list(dict.fromkeys(
            str(item.get("trigger_type") or "").strip()
            for item in ordered
            if str(item.get("trigger_type") or "").strip()
        ))
        result.append(latest)
    return result


def _node(node_id: str, node_type: str, label: str, detail: str, state: str = "observed") -> dict:
    return {"id": node_id, "type": node_type, "label": label, "detail": detail, "state": state}


def _edge(source: str, target: str, relationship: str, evidence: str) -> dict:
    return {"source": source, "target": target, "relationship": relationship, "evidence": evidence}


def _device_control_gaps(device: dict) -> list[str]:
    gaps: list[str] = []
    if device.get("bitlocker_enabled") is False or _normal(device.get("encryption_status")) in {"disabled", "off", "not encrypted"}:
        gaps.append("Disk encryption is recorded as disabled")
    if device.get("firewall_enabled") is False:
        gaps.append("Host firewall is recorded as disabled")
    if device.get("edr_status") is not None and _normal(device.get("edr_status")) not in {"healthy", "protected", "running", "enabled", "active"}:
        gaps.append(f"EDR state is {_normal(device.get('edr_status')) or 'not healthy'}")
    if device.get("antivirus_status") is not None and _normal(device.get("antivirus_status")) not in {"healthy", "protected", "running", "enabled", "active", "up to date"}:
        gaps.append(f"Antivirus state is {_normal(device.get('antivirus_status')) or 'not healthy'}")
    pending_patches = int(device.get("pending_patches") or 0)
    if pending_patches > 0:
        gaps.append(f"{pending_patches} pending patch{'es' if pending_patches != 1 else ''}")
    return gaps


def _device_path(device: dict, client: dict | None) -> dict | None:
    gaps = _device_control_gaps(device)
    if not gaps:
        return None

    device_id = str(device.get("id") or device.get("agent_id") or device.get("hostname") or "unknown-device")
    device_name = str(device.get("name") or device.get("hostname") or "Recorded endpoint")
    client_id = str(device.get("client_id") or (client or {}).get("id") or "")
    client_name = str(device.get("client_name") or (client or {}).get("name") or "Unassigned client")
    identity = str(device.get("assigned_user") or device.get("last_logged_in_user") or "").strip()
    pending_patches = int(device.get("pending_patches") or 0)
    severe_control = any("disabled" in gap.lower() or "edr" in gap.lower() for gap in gaps)
    severity = "high" if severe_control or pending_patches >= 10 else "medium"

    nodes: list[dict] = []
    edges: list[dict] = []
    if identity:
        identity_id = f"identity:{device_id}:{identity}"
        relationship = "assigned to" if device.get("assigned_user") else "last signed in to"
        nodes.append(_node(identity_id, "identity", identity, "Identity observed on the endpoint"))
        edges.append(_edge(identity_id, f"endpoint:{device_id}", relationship, f"Recorded by endpoint inventory for {device_name}"))

    endpoint_id = f"endpoint:{device_id}"
    control_id = f"control:{device_id}"
    client_node_id = f"client:{client_id or client_name}"
    nodes.extend([
        _node(endpoint_id, "endpoint", device_name, str(device.get("os") or device.get("device_type") or "Managed endpoint")),
        _node(control_id, "control", f"{len(gaps)} control gap{'s' if len(gaps) != 1 else ''}", "; ".join(gaps)),
        _node(client_node_id, "client", client_name, "Recorded client relationship"),
    ])
    edges.extend([
        _edge(endpoint_id, control_id, "has observed exposure", "; ".join(gaps)),
        _edge(endpoint_id, client_node_id, "belongs to", f"Endpoint client_id: {client_id or 'not recorded'}"),
    ])
    return {
        "id": f"path-device-{device_id}",
        "title": f"Endpoint control exposure · {device_name}",
        "severity": severity,
        "confidence": "observed",
        "client_id": client_id,
        "client_name": client_name,
        "summary": "A recorded user or client endpoint has one or more verified control gaps.",
        "nodes": nodes,
        "edges": edges,
        "evidence": gaps,
        "recommended_action": "Validate the endpoint state, remediate the recorded controls, then rerun the agent assessment.",
        "source": "Nexus Agent inventory",
        "source_route": f"/devices/{device_id}",
        "observed_at": device.get("last_heartbeat") or device.get("last_seen") or device.get("updated_at"),
    }


@router.get("/overview")
async def security_graph_overview(
    client_id: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
):
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).sort("name", 1).to_list(2000)
    selected_client = next((client for client in clients if str(client.get("id")) == client_id), None)
    client_name = str((selected_client or {}).get("name") or "")
    client_by_id = {str(client.get("id")): client for client in clients}

    device_query = {"client_id": client_id} if client_id else {}
    devices = await db.devices.find(device_query, {
        "_id": 0, "id": 1, "agent_id": 1, "name": 1, "hostname": 1, "client_id": 1, "client_name": 1,
        "assigned_user": 1, "last_logged_in_user": 1, "os": 1, "device_type": 1, "status": 1,
        "bitlocker_enabled": 1, "encryption_status": 1, "firewall_enabled": 1, "edr_status": 1,
        "antivirus_status": 1, "pending_patches": 1, "last_heartbeat": 1, "last_seen": 1, "updated_at": 1,
    }).to_list(10000)
    vulnerabilities = await db.vulnerabilities.find({
        "source": {"$in": list(TRUSTED_VULNERABILITY_SOURCES)},
    }, {"_id": 0}).to_list(5000)
    alerts = await db.soc_alerts.find({}, {"_id": 0}).to_list(5000)
    canary_triggers = await db.canary_triggers.find({"resolved": False}, {"_id": 0}).to_list(2000)

    paths: list[dict] = []
    for device in devices:
        path = _device_path(device, client_by_id.get(str(device.get("client_id") or "")))
        if path:
            paths.append(path)

    for trigger in _group_canary_triggers(canary_triggers):
        if not _matches_client(trigger, client_id, client_name):
            continue
        device_id = str(trigger.get("device_id") or "unknown-device")
        device_name = str(trigger.get("device_name") or "Recorded endpoint")
        trigger_client_name = str(trigger.get("client_name") or client_name or "Unassigned client")
        trigger_client_id = str(trigger.get("client_id") or client_id or "")
        event_count = int(trigger.get("_event_count") or 1)
        file_paths = trigger.get("_file_paths") or []
        trigger_types = trigger.get("_trigger_types") or []
        signal_label = f"{event_count} unresolved Canary signal{'s' if event_count != 1 else ''}"
        evidence = [signal_label]
        if trigger_types:
            evidence.append(f"Trigger types: {', '.join(trigger_types[:4])}")
        if file_paths:
            evidence.append(f"Affected files: {', '.join(file_paths[:4])}")
        paths.append({
            "id": f"path-canary-{trigger_client_id or 'unassigned'}-{device_id}",
            "title": f"Nexus Canary trip · {device_name}",
            "severity": "critical",
            "confidence": "observed",
            "client_id": trigger_client_id,
            "client_name": trigger_client_name,
            "summary": "A live deception-file trigger is recorded on this endpoint and requires containment review.",
            "nodes": [
                _node(f"detection:{device_id}", "detection", "Nexus Canary triggered", signal_label),
                _node(f"endpoint:{device_id}", "endpoint", device_name, "Endpoint linked by the canary record"),
                _node(f"client:{trigger_client_id or trigger_client_name}", "client", trigger_client_name, "Recorded client relationship"),
            ],
            "edges": [
                _edge(f"detection:{device_id}", f"endpoint:{device_id}", "triggered on", signal_label),
                _edge(f"endpoint:{device_id}", f"client:{trigger_client_id or trigger_client_name}", "belongs to", "Persisted canary client association"),
            ],
            "evidence": evidence,
            "recommended_action": "Open Nexus Shield, validate isolation state, preserve evidence, and start the ransomware response playbook.",
            "source": "Nexus Canary",
            "source_route": "/nexus-shield?tab=canary",
            "event_count": event_count,
            "first_observed_at": trigger.get("_first_triggered_at"),
            "observed_at": trigger.get("_last_triggered_at") or trigger.get("triggered_at"),
        })

    for alert in alerts:
        if not _is_open(alert) or not _matches_client(alert, client_id, client_name):
            continue
        alert_id = str(alert.get("id") or alert.get("alert_id") or len(paths))
        alert_client_name = str(alert.get("client_name") or alert.get("organization") or client_name or "Unassigned client")
        alert_client_id = str(alert.get("client_id") or client_id or "")
        affected = str(alert.get("hostname") or alert.get("device_name") or alert.get("user") or "Recorded security subject")
        severity = _normal(alert.get("severity"))
        severity = severity if severity in {"critical", "high", "medium", "low"} else "medium"
        paths.append({
            "id": f"path-alert-{alert_id}",
            "title": str(alert.get("title") or alert.get("summary") or "Open security alert"),
            "severity": severity,
            "confidence": "observed",
            "client_id": alert_client_id,
            "client_name": alert_client_name,
            "summary": "An unresolved security alert links this subject to the recorded client environment.",
            "nodes": [
                _node(f"alert:{alert_id}", "detection", "Open security alert", str(alert.get("source") or "SOC evidence")),
                _node(f"subject:{alert_id}", "endpoint", affected, "Affected subject from the alert record"),
                _node(f"client:{alert_client_id or alert_client_name}", "client", alert_client_name, "Recorded client relationship"),
            ],
            "edges": [
                _edge(f"alert:{alert_id}", f"subject:{alert_id}", "affects", "Persisted SOC alert"),
                _edge(f"subject:{alert_id}", f"client:{alert_client_id or alert_client_name}", "is associated with", "Persisted alert client association"),
            ],
            "evidence": [str(alert.get("description") or alert.get("summary") or "Open SOC alert")],
            "recommended_action": "Open the SOC record, validate scope, assign ownership, and record the containment decision.",
            "source": str(alert.get("source") or "SOC alert"),
            "source_route": "/security-dashboard",
            "observed_at": alert.get("created_at") or alert.get("detected_at"),
        })

    device_by_id = {str(device.get("id") or device.get("agent_id") or ""): device for device in devices}
    trusted_open_vulnerabilities: list[dict] = []
    for finding in vulnerabilities:
        if not _is_open(finding):
            continue
        linked_device = device_by_id.get(str(finding.get("device_id") or ""), {})
        effective_finding = {
            **finding,
            "client_id": finding.get("client_id") or linked_device.get("client_id"),
            "client_name": finding.get("client_name") or linked_device.get("client_name"),
        }
        if not _matches_client(effective_finding, client_id, client_name):
            continue
        trusted_open_vulnerabilities.append(effective_finding)
        finding_id = str(finding.get("id") or finding.get("cve") or finding.get("cve_id") or len(paths))
        device_id = str(finding.get("device_id") or linked_device.get("id") or "fleet")
        device_name = str(finding.get("device_name") or linked_device.get("name") or linked_device.get("hostname") or "Affected fleet")
        finding_client_id = str(effective_finding.get("client_id") or client_id or "")
        finding_client_name = str(effective_finding.get("client_name") or client_name or "Unassigned client")
        severity = _normal(finding.get("severity"))
        severity = severity if severity in {"critical", "high", "medium", "low"} else "medium"
        reference = str(finding.get("cve") or finding.get("cve_id") or "Verified vulnerability finding")
        title = str(finding.get("title") or reference)
        paths.append({
            "id": f"path-vulnerability-{finding_id}",
            "title": f"{reference} · {title}",
            "severity": severity,
            "confidence": "observed",
            "client_id": finding_client_id,
            "client_name": finding_client_name,
            "summary": "A trusted provider or Nexus Agent has recorded an unresolved vulnerability against this endpoint or fleet.",
            "nodes": [
                _node(f"vulnerability:{finding_id}", "detection", reference, title),
                _node(f"endpoint:{device_id}", "endpoint", device_name, "Affected endpoint or fleet from the finding"),
                _node(f"client:{finding_client_id or finding_client_name}", "client", finding_client_name, "Recorded client relationship"),
            ],
            "edges": [
                _edge(f"vulnerability:{finding_id}", f"endpoint:{device_id}", "is present on", f"Source: {finding.get('source')}"),
                _edge(f"endpoint:{device_id}", f"client:{finding_client_id or finding_client_name}", "belongs to", "Finding or endpoint client association"),
            ],
            "evidence": [
                f"Source: {finding.get('source')}",
                f"Patch available: {'Yes' if finding.get('patch_available') else 'Not recorded'}",
                f"Exploited in the wild: {'Yes' if finding.get('exploited_in_wild') or finding.get('exploitable') else 'Not recorded'}",
            ],
            "recommended_action": "Open the verified finding, validate applicability, patch or mitigate it, and retain any accepted-risk decision.",
            "source": str(finding.get("source") or "Trusted vulnerability provider"),
            "source_route": "/vulnerability-scanner",
            "observed_at": finding.get("discovered_at") or finding.get("created_at"),
        })

    seen_path_ids: dict[str, int] = {}
    for path in paths:
        base_id = path["id"]
        occurrence = seen_path_ids.get(base_id, 0) + 1
        seen_path_ids[base_id] = occurrence
        if occurrence > 1:
            path["id"] = f"{base_id}-{occurrence}"

    paths.sort(key=lambda path: ({"critical": 0, "high": 1, "medium": 2, "low": 3}.get(path["severity"], 4), path.get("client_name") or "", path["title"]))
    affected_clients = {path.get("client_id") or path.get("client_name") for path in paths if path.get("client_id") or path.get("client_name")}
    observed_identities = {
        node["label"]
        for path in paths
        for node in path.get("nodes", [])
        if node.get("type") == "identity"
    }
    sources = sorted({path.get("source") for path in paths if path.get("source")})
    return {
        "generated_at": _now(),
        "summary": {
            "paths": len(paths),
            "critical": sum(path["severity"] == "critical" for path in paths),
            "high": sum(path["severity"] == "high" for path in paths),
            "affected_clients": len(affected_clients),
            "observed_identities": len(observed_identities),
            "sources": len(sources),
            "trusted_open_vulnerabilities": len(trusted_open_vulnerabilities),
        },
        "paths": paths,
        "sources": sources,
        "filters": {"clients": clients, "selected_client_id": client_id},
        "evidence_note": "Every node and edge is backed by a persisted NexusMSP relationship. Missing connector evidence is left unknown.",
    }
