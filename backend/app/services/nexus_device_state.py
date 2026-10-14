"""Nexus State Engine (device-level) and Drift Control.

Declare what a *device* should look like — encryption, DNS, endpoint security,
browser version, approved local administrators, firewall, backup protection,
time sync — then continuously reconcile desired → actual → difference →
remediation → verification.

Ownership boundary: the client-level assurance standards and staged remediations
belong to ``expected_state_standards`` / ``expected_state_remediations`` and stay
authoritative there; this service is device-level and never reads or writes them.

Honesty rules this module will not break:

* ``unverified`` is the mandatory verdict when the device record carries no
  evidence for a check. Absence of a field is never "protected", and it is never
  "drifted" either — Nexus does not infer either way.
* A remediation is a **plan**. This module has no code path that executes one.
* A drift finding keeps its real ``first_seen``: re-evaluating the same drifted
  device updates the existing finding instead of inventing a new one.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services import nexus_operational_mode
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

#: How many devices one estate evaluation will walk synchronously.
MAX_DEVICES = 200

#: Every failure to observe is reported, never guessed at.
_MISSING = object()

MET = "met"
DRIFTED = "drifted"
UNVERIFIED = "unverified"

FINDING_STATUSES = ("open", "remediation_proposed", "resolved", "waived")
OPEN_STATUSES = ("open", "remediation_proposed")
TERMINAL_STATUSES = ("resolved", "waived")

VERIFICATION_VERDICTS = ("verified", "still_drifted", "waived")

BACKUP_SUCCESS = ("success", "completed", "succeeded", "ok")
BACKUP_FAILURE = ("failed", "error", "warning")

#: Documented severity per domain. Published so it can be argued with.
SEVERITY_BY_DOMAIN = {
    "encryption": "high",
    "security": "high",
    "backup": "high",
    "identity": "medium",
    "network": "medium",
    "patching": "medium",
    "configuration": "low",
}

#: Code defaults used only when no declaration exists for a check. Documentary,
#: not learned: a technician can override every one of them with a declaration.
DEFAULT_EXPECTATIONS = {
    "bitlocker": "enabled",
    "dns_servers": "",
    "edr_present": "installed and running",
    "browser_version": "120.0",
    "local_admins": "",
    "firewall_enabled": "enabled",
    "backup_protected": "a clean backup execution is recorded",
    "time_sync": "healthy",
}

CHECKS: tuple[dict[str, str], ...] = (
    {
        "check": "bitlocker",
        "label": "Disk encryption enabled",
        "domain": "encryption",
        "evidence": "the device's recorded encryption state (bitlocker_enabled / disk_encryption)",
        "comparison": "met when the device reports disk encryption enabled",
        "question": "Can somebody walk away with this laptop and read the disk?",
    },
    {
        "check": "dns_servers",
        "label": "DNS matches the declared resolver",
        "domain": "network",
        "evidence": "the device's recorded resolver list (dns_servers)",
        "comparison": "met when the declared resolver appears in the recorded list",
        "question": "Is this device resolving through the resolver we intended?",
    },
    {
        "check": "edr_present",
        "label": "Endpoint security agent present",
        "domain": "security",
        "evidence": "the device's recorded endpoint-security state (edr / edr_status)",
        "comparison": "met when the recorded endpoint-security agent is installed and running",
        "question": "Is this endpoint actually protected right now?",
    },
    {
        "check": "browser_version",
        "label": "Browser version at or above the required release",
        "domain": "patching",
        "evidence": "the device's recorded browser version (browsers / chrome_version)",
        "comparison": "met when the recorded version is at or above the declared minimum",
        "question": "Is the browser still inside its supported release window?",
    },
    {
        "check": "local_admins",
        "label": "Local administrators match the approved set",
        "domain": "identity",
        "evidence": "the device's recorded local administrator list (local_admins)",
        "comparison": "met when no recorded local administrator sits outside the declared approved set",
        "question": "Has somebody kept administrator rights they should not have?",
    },
    {
        "check": "firewall_enabled",
        "label": "Host firewall enabled",
        "domain": "security",
        "evidence": "the device's recorded firewall state (firewall_enabled)",
        "comparison": "met when the device reports its host firewall enabled",
        "question": "Is the host firewall actually on?",
    },
    {
        "check": "backup_protected",
        "label": "Backup protection evidenced",
        "domain": "backup",
        "evidence": "recorded backup execution for this device in backup_jobs",
        "comparison": "met when a clean backup execution is recorded for the device",
        "question": "Is there proof this device is recoverable, not just enrolled?",
    },
    {
        "check": "time_sync",
        "label": "Time synchronisation healthy",
        "domain": "configuration",
        "evidence": "the device's recorded time-service state (time_sync_healthy / w32time_status)",
        "comparison": "met when the recorded time service reports healthy",
        "question": "Will Kerberos and TLS trust this device's clock?",
    },
)

CHECKS_BY_KEY = {entry["check"]: entry for entry in CHECKS}

CATALOG_NOTE = (
    "Nexus cannot infer protection from a missing field. A check with no recorded evidence is reported "
    "as unverified — never as met and never as drifted — and a check that needs a declared expectation "
    "you have not supplied is unverified for the same reason."
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def check_catalog() -> dict:
    """Publish the device checks, what each one reads and what "met" means."""
    return {"checks": [dict(entry) for entry in CHECKS],
            "severity_by_domain": dict(SEVERITY_BY_DOMAIN),
            "default_expectations": dict(DEFAULT_EXPECTATIONS),
            "note": CATALOG_NOTE}


# ============== SMALL EVIDENCE HELPERS ==============


def _first_present(row: dict, names: tuple[str, ...]) -> Any:
    """First field that actually carries a value. ``_MISSING`` means no evidence."""
    for name in names:
        if name in row:
            value = row.get(name)
            if value is None or value == "" or value == [] or value == {}:
                continue
            return value
    return _MISSING


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value > 0
    if isinstance(value, str):
        return value.strip().lower() in {
            "enabled", "true", "on", "yes", "installed", "running", "healthy",
            "protected", "active", "ok", "protected",
        }
    if isinstance(value, dict):
        for key in ("enabled", "installed", "running", "healthy", "status", "state"):
            if key in value:
                return _truthy(value[key])
        return bool(value)
    if isinstance(value, (list, tuple)):
        return len(value) > 0
    return bool(value)


def _as_list(value: Any) -> list[str]:
    if isinstance(value, (list, tuple, set, frozenset)):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [part.strip() for part in re.split(r"[,;\s]+", value) if part.strip()]
    return [str(value).strip()] if value not in (None, "") else []


#: A declaration may legitimately require something to be OFF (a legacy service
#: that must stay disabled). These are the phrasings that mean "wants it off".
_NEGATIVE_EXPECTATIONS = {
    "disabled", "off", "not enabled", "not required", "no", "false", "absent",
    "not installed", "not running", "unhealthy", "none needed",
}


def _wants_enabled(expectation: str, default: str) -> bool:
    """Is the expectation positive? Falls back to the documented code default."""
    text = (expectation or default or "").strip().lower()
    return text not in _NEGATIVE_EXPECTATIONS


_VERSION_RE = re.compile(r"\d+(?:\.\d+)*")


def _version_tuple(value: Any) -> tuple[int, ...] | None:
    """First dotted number found in a value, or None when nothing parses."""
    if isinstance(value, dict):
        for key in ("chrome", "edge", "version", "current"):
            if key in value:
                return _version_tuple(value[key])
        for inner in value.values():
            parsed = _version_tuple(inner)
            if parsed:
                return parsed
        return None
    match = _VERSION_RE.search(str(value or ""))
    if not match:
        return None
    return tuple(int(part) for part in match.group(0).split("."))


def _plausible_client_id(row: dict) -> str:
    return str(row.get("client_id") or "")


# ============== THE COMPARISONS ==============


def _compare_bitlocker(device: dict, expectation: str, declared: bool) -> tuple[str, str, str]:
    raw = _first_present(device, ("bitlocker_enabled", "disk_encryption", "encryption_enabled",
                                  "bitlocker_status"))
    expected = expectation or DEFAULT_EXPECTATIONS["bitlocker"]
    if raw is _MISSING:
        return expected, "", UNVERIFIED, (
            "no encryption state is recorded for this device, so Nexus cannot say whether the disk "
            "is protected — absence of evidence is not protection")
    wants = _wants_enabled(expectation, DEFAULT_EXPECTATIONS["bitlocker"])
    ok = _truthy(raw) == wants
    return expected, ("enabled" if _truthy(raw) else "not enabled"), (MET if ok else DRIFTED), (
        "recorded encryption state matches the expectation" if ok
        else ("the device reports disk encryption disabled that the expectation requires enabled"
              if wants else
              "the device reports disk encryption enabled where the declaration requires it disabled"))


def _compare_dns(device: dict, expectation: str, declared: bool) -> tuple[str, str, str]:
    raw = _first_present(device, ("dns_servers", "dns", "dns_addresses"))
    if raw is _MISSING:
        return expectation or "", "", UNVERIFIED, (
            "no resolver list is recorded for this device, so Nexus cannot confirm which DNS it uses")
    servers = _as_list(raw)
    if not expectation:
        return "", ", ".join(servers), UNVERIFIED, (
            "no expected resolver is declared for this device or client, so there is nothing to "
            "compare the recorded resolvers against")
    wanted = _as_list(expectation)
    if any(any(want.lower() in server.lower() for server in servers) for want in wanted):
        return expectation, ", ".join(servers), MET, "the declared resolver appears in the recorded list"
    return expectation, ", ".join(servers), DRIFTED, (
        "the recorded resolvers do not include the declared resolver")


def _compare_edr(device: dict, expectation: str, declared: bool) -> tuple[str, str, str]:
    raw = _first_present(device, ("edr", "edr_status", "endpoint_security", "edr_installed",
                                  "antivirus_status"))
    expected = expectation or DEFAULT_EXPECTATIONS["edr_present"]
    if raw is _MISSING:
        return expected, "", UNVERIFIED, (
            "no endpoint-security state is recorded for this device — Nexus will not call an "
            "endpoint protected without evidence")
    wants = _wants_enabled(expectation, DEFAULT_EXPECTATIONS["edr_present"])
    ok = _truthy(raw) == wants
    return expected, ("running" if _truthy(raw) else "not running"), (MET if ok else DRIFTED), (
        "the recorded endpoint-security agent state matches the expectation" if ok
        else "the recorded endpoint-security agent is not in the state the expectation requires")


def _compare_browser(device: dict, expectation: str, declared: bool) -> tuple[str, str, str]:
    raw = _first_present(device, ("browsers", "chrome_version", "browser_version", "edge_version"))
    expected = expectation or DEFAULT_EXPECTATIONS["browser_version"]
    if raw is _MISSING:
        return expected, "", UNVERIFIED, (
            "no browser version is recorded for this device, so a version comparison is impossible")
    observed = _version_tuple(raw)
    if not observed:
        return expected, str(raw)[:60], UNVERIFIED, (
            "the recorded browser value does not contain a comparable version number")
    wanted = _version_tuple(expected)
    if not wanted:
        return expected, ".".join(str(part) for part in observed), UNVERIFIED, (
            "the declared minimum is not a version number, so nothing can be compared")
    shown = ".".join(str(part) for part in observed)
    if observed >= wanted:
        return expected, shown, MET, f"recorded version {shown} is at or above the declared minimum"
    return expected, shown, DRIFTED, (
        f"recorded version {shown} is below the declared minimum {' '.join(str(p) for p in wanted)}")


def _compare_local_admins(device: dict, expectation: str, declared: bool) -> tuple[str, str, str]:
    raw = _first_present(device, ("local_admins", "local_administrators", "administrators"))
    if raw is _MISSING:
        return expectation or "", "", UNVERIFIED, (
            "no local administrator list is recorded for this device")
    observed = _as_list(raw)
    if not expectation:
        return "", ", ".join(observed), UNVERIFIED, (
            "no approved administrator set is declared for this device or client, so Nexus cannot "
            "judge whether the recorded administrators are expected")
    approved = {item.lower() for item in _as_list(expectation)}
    unexpected = [item for item in observed if item.lower() not in approved]
    if unexpected:
        return expectation, ", ".join(observed), DRIFTED, (
            f"{len(unexpected)} recorded administrator(s) sit outside the approved set: "
            + ", ".join(unexpected[:5]))
    return expectation, ", ".join(observed), MET, "every recorded administrator is in the approved set"


def _compare_firewall(device: dict, expectation: str, declared: bool) -> tuple[str, str, str]:
    raw = _first_present(device, ("firewall_enabled", "firewall_status", "firewall"))
    expected = expectation or DEFAULT_EXPECTATIONS["firewall_enabled"]
    if raw is _MISSING:
        return expected, "", UNVERIFIED, (
            "no firewall state is recorded for this device, so Nexus cannot say whether it is on")
    wants = _wants_enabled(expectation, DEFAULT_EXPECTATIONS["firewall_enabled"])
    ok = _truthy(raw) == wants
    return expected, ("enabled" if _truthy(raw) else "not enabled"), (MET if ok else DRIFTED), (
        "the device's firewall state matches the expectation" if ok
        else ("the device reports its host firewall disabled" if wants
              else "the device reports its host firewall enabled where the declaration requires it disabled"))


def _compare_backup(device: dict, expectation: str, declared: bool, jobs: list[dict]) -> tuple[str, str, str]:
    expected = expectation or DEFAULT_EXPECTATIONS["backup_protected"]
    if not jobs:
        return expected, "", UNVERIFIED, (
            "no backup execution is recorded for this device, so recoverability is not proven — "
            "a device that is enrolled in backup is not the same as a device that is protected")
    statuses = {str(job.get("status") or "").strip().lower() for job in jobs}
    clean = sorted(statuses & set(BACKUP_SUCCESS))
    failed = sorted(statuses & set(BACKUP_FAILURE))
    if clean:
        return expected, "clean execution recorded", MET, (
            "a successful backup execution is recorded for this device")
    if failed:
        return expected, f"recorded states: {', '.join(failed)}", DRIFTED, (
            "recorded backup executions did not complete cleanly")
    return expected, f"recorded states: {', '.join(sorted(statuses)) or 'unknown'}", UNVERIFIED, (
        "backup records exist but none report a clean completion, so protection is not proven")


def _compare_time_sync(device: dict, expectation: str, declared: bool) -> tuple[str, str, str]:
    raw = _first_present(device, ("time_sync_healthy", "time_service_status", "w32time_status",
                                  "time_sync"))
    expected = expectation or DEFAULT_EXPECTATIONS["time_sync"]
    if raw is _MISSING:
        return expected, "", UNVERIFIED, (
            "no time-service state is recorded for this device, so clock health is unknown")
    wants = _wants_enabled(expectation, DEFAULT_EXPECTATIONS["time_sync"])
    ok = _truthy(raw) == wants
    return expected, ("healthy" if _truthy(raw) else "not healthy"), (MET if ok else DRIFTED), (
        "the recorded time service matches the expectation" if ok
        else "the recorded time service is not in the state the expectation requires")


_COMPARATORS = {
    "bitlocker": _compare_bitlocker,
    "dns_servers": _compare_dns,
    "edr_present": _compare_edr,
    "browser_version": _compare_browser,
    "local_admins": _compare_local_admins,
    "firewall_enabled": _compare_firewall,
    "time_sync": _compare_time_sync,
}


def _route_for(device_id: str) -> str:
    return f"/devices/{device_id}"


# ============== DECLARATIONS ==============


async def declare_state(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Declare what a device (or a client's devices) should look like."""
    check = str(payload.get("check") or "").strip()
    expectation = str(payload.get("expectation") or "").strip()
    if check not in CHECKS_BY_KEY:
        return {"found": False, "error": f"unknown check '{check}'"}
    if not expectation:
        return {"found": False, "error": "expectation is required"}
    row = {
        "id": f"DSD-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": platform_tenant_id(user),
        "client_id": str(payload.get("client_id") or "")[:64],
        "device_id": str(payload.get("device_id") or "")[:64],
        "check": check,
        "expectation": expectation[:300],
        "owner": str(payload.get("owner") or "")[:120],
        "detail": str(payload.get("detail") or "")[:1000],
        "created_by": user.get("id"),
        "created_by_name": name,
        "created_at": _iso(_utcnow()),
    }
    await db.device_state_declarations.insert_one(row)
    row.pop("_id", None)
    return {
        "found": True,
        "declaration": row,
        "note": ("Declared. Declarations override the code defaults, and every declared expectation "
                 "is compared against real recorded evidence — never assumed."),
    }


async def list_declarations(db: Any, user: dict, client_id: str | None = None) -> dict:
    """Declared device-state expectations in tenant scope."""
    query: dict = {}
    if client_id:
        query["client_id"] = client_id
    rows = await db.device_state_declarations.find(
        tenant_scoped_query(user, query), {"_id": 0}).sort("created_at", -1).limit(200).to_list(200)
    return {
        "found": True,
        "count": len(rows),
        "declarations": rows,
        "note": ("Client-level assurance standards live in Expected State and stay authoritative there; "
                 "these are device-state declarations."),
    }


def _declaration_for(declarations: list[dict], check: str, client_id: str, device_id: str) -> dict | None:
    """Most specific declaration wins: device, then client, then tenant-wide."""
    candidates = [row for row in declarations if row.get("check") == check]
    for wanted_device in (device_id,):
        for row in candidates:
            if str(row.get("device_id") or "") == wanted_device:
                return row
    if client_id:
        for row in candidates:
            if str(row.get("device_id") or "") == "" and str(row.get("client_id") or "") == client_id:
                return row
    for row in candidates:
        if str(row.get("device_id") or "") == "" and str(row.get("client_id") or "") == "":
            return row
    return None


# ============== EVALUATION ==============


async def _device_row(db: Any, user: dict, device_id: str) -> dict | None:
    return await db.devices.find_one(tenant_scoped_query(user, {"id": device_id}), {"_id": 0})


async def _backup_rows(db: Any, user: dict, device_id: str) -> list[dict]:
    return await db.backup_jobs.find(
        tenant_scoped_query(user, {"device_id": device_id}), {"_id": 0}).limit(50).to_list(50)


async def _evaluate_checks(db: Any, user: dict, device: dict, declarations: list[dict]) -> list[dict]:
    device_id = str(device.get("id") or "")
    client_id = _plausible_client_id(device)
    jobs = await _backup_rows(db, user, device_id)
    results: list[dict] = []
    for entry in CHECKS:
        check = entry["check"]
        declaration = _declaration_for(declarations, check, client_id, device_id)
        expectation = str((declaration or {}).get("expectation") or "")
        declared = declaration is not None
        if check == "backup_protected":
            expected, observed, verdict, reason = _compare_backup(device, expectation, declared, jobs)
        else:
            expected, observed, verdict, reason = _COMPARATORS[check](device, expectation, declared)
        results.append({
            "check": check,
            "label": entry["label"],
            "domain": entry["domain"],
            "expected": expected,
            "observed": observed,
            "verdict": verdict,
            "reason": (f"{reason} (expectation from declaration {declaration['id']})" if declared else reason),
            "declared": declared,
            "severity": SEVERITY_BY_DOMAIN.get(entry["domain"], "medium"),
            "route": _route_for(device_id),
        })
    return results


async def _apply_drift(db: Any, user: dict, device: dict, checks: list[dict]) -> list[dict]:
    """Upsert drift findings. Re-evaluating the same device updates the existing
    finding, so ``first_seen`` keeps telling the truth."""
    tenant_id = platform_tenant_id(user)
    device_id = str(device.get("id") or "")
    client_id = _plausible_client_id(device)
    now = _iso(_utcnow())
    existing = await db.drift_findings.find(
        tenant_scoped_query(user, {"device_id": device_id}), {"_id": 0}).limit(500).to_list(500)
    by_check: dict[str, dict] = {}
    for row in existing:
        by_check.setdefault(str(row.get("check") or ""), row)
    current: list[dict] = []

    for result in checks:
        check = result["check"]
        prior = by_check.get(check)
        if result["verdict"] == DRIFTED:
            if prior and str(prior.get("status")) in OPEN_STATUSES:
                occurrences = int(prior.get("occurrences") or 1) + 1
                updates = {
                    "expected": result["expected"],
                    "observed": result["observed"],
                    "severity": result["severity"],
                    "last_seen": now,
                    "occurrences": occurrences,
                    "updated_at": now,
                }
                await db.drift_findings.update_one(
                    tenant_id_query(prior, tenant_id), {"$set": updates})
                finding = {**prior, **updates}
            else:
                finding = {
                    "id": f"DRF-{uuid.uuid4().hex[:12].upper()}",
                    "tenant_id": tenant_id,
                    "device_id": device_id,
                    "client_id": client_id,
                    "check": check,
                    "domain": result["domain"],
                    "expected": result["expected"],
                    "observed": result["observed"],
                    "severity": result["severity"],
                    "status": "open",
                    "first_seen": now,
                    "last_seen": now,
                    "occurrences": 1,
                    "remediation": None,
                    "verification": None,
                    "created_at": now,
                    "updated_at": now,
                }
                await db.drift_findings.insert_one(finding)
                finding.pop("_id", None)
            current.append({**finding, "reason": result["reason"]})
        elif result["verdict"] == MET and prior and str(prior.get("status")) in OPEN_STATUSES:
            updates = {
                "status": "resolved",
                "resolved_at": now,
                "last_seen": now,
                "updated_at": now,
                "verification": {
                    "verdict": "verified",
                    "by": "nexus evaluation",
                    "at": now,
                    "evidence": result["observed"] or result["reason"],
                },
            }
            await db.drift_findings.update_one(tenant_id_query(prior, tenant_id), {"$set": updates})
            current.append({**prior, **updates, "reason": "drift cleared by re-evaluation"})
    return current


def tenant_id_query(row: dict, tenant_id: str) -> dict:
    """Reference an owned finding by its stable ID inside its tenant partition."""
    return {"id": row.get("id"), "tenant_id": tenant_id}


async def evaluate_device(db: Any, user: dict, device_id: str) -> dict:
    """Desired → actual → difference for one device, with the drift kept current."""
    device = await _device_row(db, user, device_id)
    if not device:
        return {"found": False}
    declarations = await db.device_state_declarations.find(
        tenant_scoped_query(user, {}), {"_id": 0}).limit(500).to_list(500)
    checks = await _evaluate_checks(db, user, device, declarations)
    drift = await _apply_drift(db, user, device, checks)
    counts = {
        MET: sum(1 for item in checks if item["verdict"] == MET),
        DRIFTED: sum(1 for item in checks if item["verdict"] == DRIFTED),
        UNVERIFIED: sum(1 for item in checks if item["verdict"] == UNVERIFIED),
    }
    client_name = ""
    client_id = _plausible_client_id(device)
    if client_id:
        client_row = await db.clients.find_one(
            tenant_scoped_query(user, {"id": client_id}), {"_id": 0, "name": 1})
        client_name = str((client_row or {}).get("name") or "")
    return {
        "found": True,
        "device": {
            "id": device_id,
            "hostname": device.get("hostname") or device.get("name") or device_id,
            "client_id": client_id,
            "client_name": client_name,
        },
        "checks": checks,
        "counts": counts,
        "drift": drift,
        "note": ("Unverified is a real answer: where Nexus has no recorded evidence it says so rather "
                 "than reporting either protection or drift."),
    }


async def evaluate_estate(db: Any, user: dict, client_id: str | None = None,
                          limit: int = MAX_DEVICES) -> dict:
    """Reconcile every device in scope. Drift findings are kept current."""
    try:
        bounded = max(1, min(int(limit or MAX_DEVICES), MAX_DEVICES))
    except (TypeError, ValueError):
        bounded = MAX_DEVICES
    query: dict = {}
    if client_id:
        query["client_id"] = client_id
    rows = await db.devices.find(tenant_scoped_query(user, query), {"_id": 0}) \
        .limit(bounded).to_list(bounded)
    results = []
    total = {MET: 0, DRIFTED: 0, UNVERIFIED: 0}
    for device in rows:
        evaluated = await evaluate_device(db, user, str(device.get("id") or ""))
        if not evaluated.get("found"):
            continue
        counts = evaluated["counts"]
        for key in total:
            total[key] += counts[key]
        results.append({
            "device_id": evaluated["device"]["id"],
            "hostname": evaluated["device"]["hostname"],
            "counts": counts,
            "drift": len(evaluated["drift"]),
        })
    return {
        "found": True,
        "count": len(results),
        "devices": results,
        "counts": total,
        "note": ("Estate evaluations are bounded and synchronous. Devices with no recorded evidence for "
                 "a check count as unverified, never as healthy."),
    }


# ============== DRIFT LIFECYCLE (Drift Control) ==============


async def list_drift(db: Any, user: dict, client_id: str | None = None, status: str | None = None,
                     device_id: str | None = None) -> dict:
    """Open and recent drift findings in tenant scope."""
    query: dict = {}
    if client_id:
        query["client_id"] = client_id
    if device_id:
        query["device_id"] = device_id
    if status:
        if status not in FINDING_STATUSES:
            return {"found": False,
                    "error": f"status must be one of {', '.join(FINDING_STATUSES)}"}
        query["status"] = status
    rows = await db.drift_findings.find(tenant_scoped_query(user, query), {"_id": 0}) \
        .sort("last_seen", -1).limit(200).to_list(200)
    # A work queue: an open finding always outranks a resolved one, then severity,
    # then how long the device has actually been drifted.
    severity_rank = {"high": 0, "medium": 1, "low": 2}
    rows.sort(key=lambda row: (0 if str(row.get("status")) in OPEN_STATUSES else 1,
                               severity_rank.get(str(row.get("severity")), 3),
                               str(row.get("first_seen") or "")))
    return {
        "found": True,
        "count": len(rows),
        "open": sum(1 for row in rows if str(row.get("status")) in OPEN_STATUSES),
        "findings": rows,
        "note": ("first_seen is the truth about how long a device has been drifted: re-evaluation "
                 "updates an open finding instead of starting a new one."),
    }


async def propose_remediation(db: Any, user: dict, name: str, drift_id: str, payload: dict) -> dict:
    """Propose how to close one drift finding. This is a plan and never an execution."""
    action = str(payload.get("action") or "").strip()
    if not action:
        return {"found": False, "error": "action is required"}
    row = await db.drift_findings.find_one(tenant_scoped_query(user, {"id": drift_id}), {"_id": 0})
    if not row:
        return {"found": False}
    if str(row.get("status")) in TERMINAL_STATUSES:
        return {"found": False,
                "error": f"finding is already {row.get('status')} — a closed drift finding is not reopened "
                         "by a proposal"}

    remediation = {
        "action": action[:300],
        "detail": str(payload.get("detail") or "")[:1000],
        "rollback": str(payload.get("rollback") or "")[:1000],
        "verification": str(payload.get("verification") or "")[:1000] or (
            f"re-evaluate '{row.get('check')}' on this device and confirm it reports met"),
        "proposed_by": name,
        "proposed_at": _iso(_utcnow()),
        "executed": False,
    }
    now = _iso(_utcnow())
    updates = {"remediation": remediation, "status": "remediation_proposed", "updated_at": now}
    await db.drift_findings.update_one(tenant_id_query(row, platform_tenant_id(user)), {"$set": updates})

    mode = await nexus_operational_mode.current_mode(db, user)
    decision = nexus_operational_mode.permits(
        mode, client_id=str(row.get("client_id") or ""), capability="device_remediation")
    permitted = bool(decision.get("allowed"))
    note = ("Plan recorded. Nexus will not execute it — a technician or an approved automation runs it, "
            "then a verification closes the finding.")
    if not permitted:
        note = (f"Plan recorded but execution is blocked right now: {decision.get('reason')} "
                "Nothing has been changed on the device.")
    return {
        "found": True,
        "finding_id": drift_id,
        "remediation": remediation,
        "permitted": permitted,
        "mode": mode.get("mode"),
        "finding": {**row, **updates},
        "note": note,
    }


async def record_verification(db: Any, user: dict, name: str, drift_id: str, payload: dict) -> dict:
    """Close, reopen or waive a drift finding with recorded evidence."""
    verdict = str(payload.get("verdict") or "").strip().lower()
    if verdict not in VERIFICATION_VERDICTS:
        return {"found": False,
                "error": f"verdict must be one of {', '.join(VERIFICATION_VERDICTS)}"}
    row = await db.drift_findings.find_one(tenant_scoped_query(user, {"id": drift_id}), {"_id": 0})
    if not row:
        return {"found": False}
    if str(row.get("status")) in TERMINAL_STATUSES:
        return {"found": False,
                "error": f"finding is already {row.get('status')} — a drift finding is closed once"}
    reason = str(payload.get("reason") or "").strip()
    if verdict == "waived" and not reason:
        return {"found": False, "error": "reason is required to waive a drift finding"}

    now = _iso(_utcnow())
    status = {"verified": "resolved", "still_drifted": "open", "waived": "waived"}[verdict]
    verification = {
        "verdict": verdict,
        "evidence": str(payload.get("evidence") or "")[:1000],
        "reason": reason[:500],
        "recorded_by": name,
        "recorded_at": now,
    }
    updates: dict = {"status": status, "verification": verification, "updated_at": now}
    if status == "resolved":
        updates["resolved_at"] = now
    await db.drift_findings.update_one(tenant_id_query(row, platform_tenant_id(user)), {"$set": updates})
    note = {
        "verified": "Verified and closed. The check is re-evaluated on the next reconciliation run.",
        "still_drifted": "Recorded as still drifted — the finding stays open and keeps its original first_seen.",
        "waived": "Waived with a recorded reason. A waived finding is deliberate, not forgotten.",
    }[verdict]
    return {"found": True, "finding": {**row, **updates}, "verdict": verdict, "note": note}


async def drift_summary(db: Any, user: dict, client_id: str | None = None) -> dict:
    """The honest drift picture — including how much of it is unproven."""
    query: dict = {}
    if client_id:
        query["client_id"] = client_id
    rows = await db.drift_findings.find(tenant_scoped_query(user, query), {"_id": 0}) \
        .limit(1000).to_list(1000)
    by_status: dict[str, int] = {}
    by_check: dict[str, int] = {}
    by_client: dict[str, int] = {}
    for row in rows:
        status = str(row.get("status") or "open")
        by_status[status] = by_status.get(status, 0) + 1
        if status in OPEN_STATUSES:
            check = str(row.get("check") or "unknown")
            by_check[check] = by_check.get(check, 0) + 1
            tenant_client = str(row.get("client_id") or "unassigned")
            by_client[tenant_client] = by_client.get(tenant_client, 0) + 1
    open_rows = [row for row in rows if str(row.get("status")) in OPEN_STATUSES]
    oldest = None
    if open_rows:
        oldest = sorted(open_rows, key=lambda row: str(row.get("first_seen") or ""))[0]
        oldest = {"id": oldest.get("id"), "device_id": oldest.get("device_id"),
                  "check": oldest.get("check"), "first_seen": oldest.get("first_seen"),
                  "occurrences": oldest.get("occurrences")}
    if not open_rows:
        trend = "No drift is currently open, so there is no trend to report."
    elif len(open_rows) == 1:
        trend = ("One open finding is a sample of one — Nexus will not describe a trend from it.")
    else:
        trend = (f"{len(open_rows)} open findings. Trend is reported from real first_seen dates only; "
                 "an unchanged open count means the same drift, not a new one.")
    return {
        "found": True,
        "by_status": by_status,
        "by_check": by_check,
        "by_client": by_client,
        "open": len(open_rows),
        "oldest_open": oldest,
        "trend_note": trend,
        "note": ("Drift counts describe recorded findings in your tenant. Checks with no recorded "
                 "evidence are unverified and appear here as neither drift nor compliance."),
    }
