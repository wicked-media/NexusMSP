"""Evidence-first Windows health assessments.

The Health Engine is a projection over retained device telemetry, agent health,
patch evidence and audited command outcomes. It never presents a symptom as a
confirmed root cause, nor queues a repair or reboot.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable

BOUNDARY = (
    "Windows Health correlates retained endpoint observations. It does not prove root cause, "
    "execute repairs or reboot a device. Repairs and disruptive actions require an independently "
    "approved change and a maintenance plan."
)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _value(document: dict, key: str) -> Any:
    if key in document:
        return document.get(key)
    telemetry = document.get("telemetry")
    return telemetry.get(key) if isinstance(telemetry, dict) else None


def _windows(device: dict) -> bool:
    return "windows" in " ".join(str(device.get(key) or "") for key in ("os", "os_platform", "platform")).lower()


def _finding(code: str, severity: str, title: str, evidence: str, source: str) -> dict:
    return {"code": code, "severity": severity, "title": title, "evidence": evidence, "source": source}


def _recommendation(kind: str, title: str, reason: str, disruptive: bool = False) -> dict:
    return {"kind": kind, "title": title, "reason": reason, "requires_administrator_approval": disruptive,
            "execution": "change_management" if disruptive else "read_only_diagnostic"}


def assess(device: dict, commands: Iterable[dict] = ()) -> dict:
    """A bounded assessment for one endpoint; the caller owns tenant/scope checks."""
    evidence, findings, hypotheses, recommendations = [], [], [], []
    for key, label in (("cpu_usage", "CPU"), ("memory_usage", "Memory"), ("disk_usage", "Disk")):
        value = _number(_value(device, key))
        if value is None:
            evidence.append({"source": "device telemetry", "status": "not_reported", "label": label})
            continue
        evidence.append({"source": "device telemetry", "status": "reported", "label": label, "value": round(value, 2), "unit": "%"})
        if value >= 90:
            findings.append(_finding(f"high_{key}", "high", f"High {label} utilisation", f"Latest reported {label.lower()} is {value:.1f}%.", "device telemetry"))
            recommendations.append(_recommendation("diagnostic", f"Inspect {label.lower()} consumers", "One utilisation sample is a symptom, not a confirmed cause."))

    self_heal = device.get("self_heal") if isinstance(device.get("self_heal"), dict) else {}
    perf = self_heal.get("performance") if isinstance(self_heal.get("performance"), dict) else {}
    details = perf.get("details") if isinstance(perf.get("details"), dict) else {}
    evidence.append({"source": "agent self-heal", "status": "reported" if perf else "not_reported", "label": "Performance assessment", "value": perf.get("band") if perf else None, "observed_at": perf.get("assessed_at") if perf else None})
    pending = str(details.get("pending_reboot") or "").strip()
    if pending:
        findings.append(_finding("pending_reboot", "medium", "Pending Windows restart", f"Agent reported a pending restart from {pending}.", "agent self-heal"))
        recommendations.append(_recommendation("disruptive", "Plan a restart", "A restart may interrupt users and must be approved and scheduled.", True))
    component = str(details.get("component_store") or "").strip()
    evidence.append({"source": "DISM CheckHealth", "status": "reported" if component else "not_reported", "label": "Component store", "value": component or None, "observed_at": perf.get("assessed_at") if component else None})
    if "repairable" in component.lower() or "corruption" in component.lower():
        findings.append(_finding("component_store", "high", "Windows component-store issue reported", component, "DISM CheckHealth"))
        hypotheses.append({"type": "diagnostic_hypothesis", "statement": "Component-store corruption may contribute to Windows servicing failures.", "confidence": "evidence-backed but unconfirmed", "confirmed_root_cause": False})
        recommendations.append(_recommendation("diagnostic", "Run a supervised DISM ScanHealth", "CheckHealth is a quick indicator; ScanHealth is the next diagnostic evidence."))
        recommendations.append(_recommendation("repair", "Propose DISM RestoreHealth then SFC", "Repair is disruptive maintenance work and must be independently approved before it is queued.", True))

    patch = device.get("patch_evidence") if isinstance(device.get("patch_evidence"), dict) else {}
    pending_updates = _number(patch.get("pending_update_count"))
    evidence.append({"source": "Windows Update", "status": "reported" if pending_updates is not None else "not_reported", "label": "Pending updates", "value": int(pending_updates) if pending_updates is not None else None, "observed_at": patch.get("observed_at")})
    if pending_updates and pending_updates > 0:
        findings.append(_finding("pending_updates", "medium", "Windows updates pending", f"Agent reported {int(pending_updates)} pending update(s).", "Windows Update"))
        recommendations.append(_recommendation("diagnostic", "Review update classification and policy", "Nexus will not bypass WSUS, Intune or Windows Update for Business policy."))

    operations = device.get("windows_operations") if isinstance(device.get("windows_operations"), dict) else {}
    if operations:
        evidence.append({"source": "Windows operational summary", "status": "reported", "label": "Event and service evidence", "observed_at": operations.get("observed_at")})
        for key, label, severity in (("critical_event_count_24h", "Critical Windows events", "high"), ("windows_update_failure_count_7d", "Windows Update failures", "medium"), ("unexpected_shutdown_count_7d", "Unexpected shutdown events", "medium")):
            count = _number(operations.get(key)) or 0
            if count > 0:
                findings.append(_finding(key, severity, label, f"Agent observed {int(count)} in the retained evaluation window.", "Windows operational summary"))
        services = operations.get("failed_automatic_services") if isinstance(operations.get("failed_automatic_services"), list) else []
        if services:
            findings.append(_finding("failed_automatic_services", "high", "Automatic services not running", f"Agent observed {len(services)} automatic service(s) not running: {', '.join(str(item) for item in services[:5])}.", "Windows operational summary"))
            recommendations.append(_recommendation("diagnostic", "Inspect affected service dependencies", "A stopped automatic service is evidence for investigation, not proof of the incident cause."))
    else:
        evidence.append({"source": "Windows operational summary", "status": "not_reported", "label": "Event and service evidence"})

    failed = [row for row in list(commands)[:20] if str(row.get("status") or "") in {"error", "timeout"}]
    if failed:
        evidence.append({"source": "agent command audit", "status": "reported", "label": "Recent failed diagnostic or maintenance commands", "value": len(failed)})
        findings.append(_finding("command_failure", "medium", "Recent diagnostic or maintenance command failed", f"{len(failed)} recent command result(s) ended in error or timeout; inspect audited output before retrying.", "agent command audit"))

    state = "healthy_observed" if not findings else ("action_required" if any(row["severity"] == "high" for row in findings) else "attention")
    if not findings and any(row["status"] == "not_reported" for row in evidence):
        state = "insufficient_evidence"
    findings.sort(key=lambda row: {"high": 0, "medium": 1, "low": 2}.get(row["severity"], 9))
    return {"device_id": device.get("id"), "client_id": device.get("client_id"), "device_name": device.get("name") or device.get("hostname") or "Unnamed endpoint", "assessment_state": state, "assessed_at": datetime.now(timezone.utc).isoformat(), "evidence": evidence, "findings": findings, "diagnostic_hypotheses": hypotheses, "confirmed_root_cause": None, "recommendations": recommendations, "workflow": {"steps": ["Review retained evidence", "Run non-disruptive diagnostics", "Raise an approved change for repair or restart", "Capture command output and exit code", "Compare post-change evidence and resolve"], "repair_or_reboot_requires_administrator_approval": True, "audit_sources": ["nexus_agent_commands", "maintenance_window_runs", "device telemetry"]}, "boundary": BOUNDARY}


def fleet(devices: Iterable[dict], commands_by_device: dict[str, list[dict]]) -> dict:
    rows = [assess(device, commands_by_device.get(str(device.get("id") or ""), ())) for device in devices if _windows(device)]
    rank = {"action_required": 0, "attention": 1, "insufficient_evidence": 2, "healthy_observed": 3}
    rows.sort(key=lambda row: (rank.get(row["assessment_state"], 9), row["device_name"]))
    return {"devices": rows, "summary": {state: sum(1 for row in rows if row["assessment_state"] == state) for state in rank}, "boundary": BOUNDARY}
