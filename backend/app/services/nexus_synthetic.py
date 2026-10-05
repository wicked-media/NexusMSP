"""Nexus Synthetic Employee: monitor what employees actually need to accomplish.

Infrastructure monitoring answers "is the server up". That is not the question a
technician is actually asked. A synthetic identity answers the business question:
*can a person sign in, open the application, read the file and send the mail?*

A synthetic identity is a dedicated test account (or an explicitly scoped
service identity) that runs a short, safe sequence of business checks on a
schedule. Each check is **read-only** or explicitly side-effect scoped — the one
message it sends is addressed to the identity itself — so a synthetic run can
never mutate business data.

Honesty boundary: this module records what the checks observed and nothing more.
A run that reported only part of its declared checks is ``degraded``, never
``healthy``; a check the identity is not entitled to run is ``unavailable``, never
a pass. Nexus never reports health it did not observe.

Credential boundary: synthetic identities never store credentials. Only an
opaque ``credential_ref`` pointer at the existing secret store is persisted, and
a payload that carries a secret value is refused outright and stores nothing.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

DEFAULT_INTERVAL_MINUTES = 30

VERDICTS = ("pass", "fail", "unavailable")

#: Access each check needs. ``read-only`` and ``no-side-effect`` checks are the
#: only ones Nexus will run; ``test-identity`` means the check exercises the
#: identity's own entitlement rather than a shared resource.
ACCESS_KINDS = ("read-only", "no-side-effect", "test-identity")

#: Payload keys that mean "a secret value is being handed to Nexus". The service
#: refuses these rather than storing them; only ``credential_ref`` is accepted.
SECRET_KEYS = frozenset({"password", "secret", "token", "api_key", "apikey", "credential"})

CHECKS: tuple[dict[str, str], ...] = (
    {
        "check": "authenticate",
        "label": "Sign in",
        "purpose": "Sign in as the synthetic identity with its own seeded credential.",
        "access": "test-identity",
        "business_meaning": "Employees can sign in",
    },
    {
        "check": "resolve_dns",
        "label": "Name resolution",
        "purpose": "Resolve the business application's internal DNS name from the identity's network.",
        "access": "read-only",
        "business_meaning": "Business names resolve",
    },
    {
        "check": "open_web_app",
        "label": "Open web application",
        "purpose": "Open the application URL and confirm a real page renders.",
        "access": "read-only",
        "business_meaning": "The web application opens",
    },
    {
        "check": "api_read",
        "label": "API read",
        "purpose": "Perform a read-only API call against the business service.",
        "access": "read-only",
        "business_meaning": "Integrations and APIs answer",
    },
    {
        "check": "read_authorised_share",
        "label": "Read authorised share",
        "purpose": "Read one file from a share the identity is entitled to.",
        "access": "read-only",
        "business_meaning": "Team files are reachable",
    },
    {
        "check": "send_test_mail",
        "label": "Send test mail",
        "purpose": "Send a clearly marked test message to the identity itself.",
        "access": "no-side-effect",
        "business_meaning": "Mail can be sent",
    },
    {
        "check": "receive_test_mail",
        "label": "Receive test mail",
        "purpose": "Confirm the marked test message actually arrives.",
        "access": "no-side-effect",
        "business_meaning": "Mail arrives",
    },
    {
        "check": "sharepoint_read",
        "label": "Read SharePoint",
        "purpose": "Read a document library the identity is permitted to access.",
        "access": "read-only",
        "business_meaning": "SharePoint documents open",
    },
)

CHECK_KEYS = frozenset(entry["check"] for entry in CHECKS)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def check_catalog() -> dict:
    """The published check catalog: what can be tested, how, and what it means."""
    return {
        "checks": [dict(entry) for entry in CHECKS],
        "verdicts": list(VERDICTS),
        "default_interval_minutes": DEFAULT_INTERVAL_MINUTES,
        "note": (
            "Every check is read-only or explicitly side-effect scoped (the test mail is "
            "addressed to the identity itself), so a synthetic run cannot change business "
            "data. Nexus cannot run a check the test identity has no rights to: an "
            "unrunnable check is reported as unavailable, never as a pass."
        ),
    }


def _check_label(check: str) -> str:
    return next((entry["label"] for entry in CHECKS if entry["check"] == check), check)


def _first_secret_key(value: Any) -> str | None:
    """Return the first payload key that carries a secret value, if any."""
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).strip().lower() in SECRET_KEYS:
                return str(key)
            found = _first_secret_key(child)
            if found:
                return found
    elif isinstance(value, (list, tuple)):
        for child in value:
            found = _first_secret_key(child)
            if found:
                return found
    return None


def _aggregate(results: list[dict]) -> str:
    """Overall verdict. Any failure wins; unproven evidence can never be healthy."""
    if any(item["verdict"] == "fail" for item in results):
        return "failed"
    if any(item["verdict"] == "unavailable" for item in results):
        return "degraded"
    return "healthy"


def _business_statement(label: str, verdict: str, results: list[dict]) -> str:
    """Translate the verdict into what an employee would actually experience."""
    failed = [item["check"] for item in results if item["verdict"] == "fail"]
    unavailable = [item["check"] for item in results if item["verdict"] == "unavailable"]
    if verdict == "failed":
        return f"{label}: not working — {', '.join(failed[:3])} failing"
    if verdict == "degraded":
        detail = f" ({', '.join(unavailable[:3])})" if unavailable else ""
        return f"{label}: some checks did not run, so this is not proven healthy{detail}"
    return f"{label}: the business workflow works end to end"


async def register_identity(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Register a synthetic identity and the business checks it should run."""
    payload = payload or {}
    offending = _first_secret_key(payload)
    if offending:
        return {
            "found": False,
            "error": ("synthetic identities never store credentials — supply credential_ref "
                      "pointing at the secret store instead"),
        }

    label = str(payload.get("label") or "").strip()
    if not label:
        return {"found": False, "error": "label is required"}

    requested = payload.get("checks")
    if requested is None:
        selected = [entry["check"] for entry in CHECKS]
    else:
        if not isinstance(requested, (list, tuple)) or isinstance(requested, str):
            return {"found": False, "error": "checks must be a list of check names"}
        selected = []
        for raw in requested:
            check = str(raw or "").strip()
            if check not in CHECK_KEYS:
                return {"found": False, "error": f"unknown check '{check}'"}
            if check not in selected:
                selected.append(check)
        if not selected:
            return {"found": False, "error": "at least one check is required"}

    try:
        interval = int(payload.get("interval_minutes") or DEFAULT_INTERVAL_MINUTES)
    except (TypeError, ValueError):
        return {"found": False, "error": "interval_minutes must be a whole number of minutes"}
    if interval < 1:
        return {"found": False, "error": "interval_minutes must be at least 1"}

    now = _utcnow()
    identity = {
        "id": f"SYN-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": platform_tenant_id(user),
        "client_id": str(payload.get("client_id") or "")[:64],
        "label": label[:200],
        "detail": str(payload.get("detail") or "")[:1000],
        "checks": selected,
        "interval_minutes": interval,
        "credential_ref": str(payload.get("credential_ref") or "")[:200],
        "enabled": True,
        "last_run_at": "",
        "last_verdict": "",
        "last_business_statement": "",
        "next_run_hint": f"every {interval} minutes",
        "created_by": user.get("id"),
        "created_by_name": name,
        "created_at": _iso(now),
    }
    await db.synthetic_identities.insert_one(identity)
    identity.pop("_id", None)
    return {
        "found": True,
        "identity": identity,
        "note": (
            "Registered. The identity stores a credential reference only — never a secret — and "
            "every check it runs is read-only or explicitly side-effect scoped."
        ),
    }


async def set_identity_state(db: Any, user: dict, identity_id: str, payload: dict) -> dict:
    """Enable or pause one synthetic identity. Pausing never deletes its history."""
    payload = payload or {}
    enabled = payload.get("enabled")
    if not isinstance(enabled, bool):
        return {"found": False, "error": "enabled must be true or false"}

    row = await db.synthetic_identities.find_one(
        tenant_scoped_query(user, {"id": identity_id}), {"_id": 0})
    if not row:
        return {"found": False}

    await db.synthetic_identities.update_one(
        {"id": identity_id, "tenant_id": row.get("tenant_id")}, {"$set": {"enabled": enabled}})
    row["enabled"] = enabled
    state = "monitoring" if enabled else "paused"
    return {
        "found": True,
        "identity": row,
        "note": (
            f"{row.get('label')} is now {state} — "
            + ("checks run on schedule." if enabled
               else "no synthetic checks run until it is re-enabled; recorded history is kept.")
        ),
    }


async def record_run(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Record one synthetic run and derive an honest business verdict from it."""
    payload = payload or {}
    identity_id = str(payload.get("identity_id") or "").strip()
    if not identity_id:
        return {"found": False, "error": "identity_id is required"}

    identity = await db.synthetic_identities.find_one(
        tenant_scoped_query(user, {"id": identity_id}), {"_id": 0})
    if not identity:
        return {"found": False}

    supplied = payload.get("results")
    if not isinstance(supplied, list) or not supplied:
        return {"found": False, "error": "results must be a non-empty list of check outcomes"}

    declared = list(identity.get("checks") or [])
    seen: list[str] = []
    results: list[dict] = []
    for item in supplied:
        if not isinstance(item, dict):
            return {"found": False, "error": "each result must be an object with check and verdict"}
        check = str(item.get("check") or "").strip()
        if check not in CHECK_KEYS:
            return {"found": False, "error": f"unknown check '{check}'"}
        if check not in declared:
            return {"found": False, "error": f"'{check}' is not one of this identity's declared checks"}
        if check in seen:
            return {"found": False, "error": f"duplicate result for '{check}'"}
        verdict = str(item.get("verdict") or "").strip().lower()
        if verdict not in VERDICTS:
            return {"found": False, "error": f"verdict must be one of {', '.join(VERDICTS)}"}
        raw_latency = item.get("latency_ms")
        try:
            latency_ms = int(raw_latency) if raw_latency is not None else None
        except (TypeError, ValueError):
            latency_ms = None
        seen.append(check)
        results.append({
            "check": check,
            "label": _check_label(check),
            "verdict": verdict,
            "detail": str(item.get("detail") or "")[:500],
            "latency_ms": latency_ms,
        })

    missing = [check for check in declared if check not in seen]
    for check in missing:
        results.append({
            "check": check,
            "label": _check_label(check),
            "verdict": "unavailable",
            "detail": "declared check reported no result in this run",
            "latency_ms": None,
        })

    verdict = _aggregate(results)
    unavailable = sum(1 for item in results if item["verdict"] == "unavailable")
    coverage = {"declared": len(declared), "ran": len(seen), "unavailable": unavailable}
    latencies = [item["latency_ms"] for item in results if item["latency_ms"] is not None]
    statement = _business_statement(str(identity.get("label") or ""), verdict, results)
    now = _utcnow()

    run = {
        "id": f"RUN-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": identity.get("tenant_id"),
        "identity_id": identity.get("id"),
        "client_id": identity.get("client_id") or "",
        "label": identity.get("label"),
        "verdict": verdict,
        "coverage": coverage,
        "results": results,
        "business_statement": statement,
        "latency_ms_total": sum(latencies) if latencies else None,
        "note": str(payload.get("note") or "")[:500],
        "recorded_by": user.get("id"),
        "recorded_by_name": name,
        "started_at": _iso(now),
    }
    await db.synthetic_runs.insert_one(run)
    run.pop("_id", None)
    await db.synthetic_identities.update_one(
        {"id": identity.get("id"), "tenant_id": identity.get("tenant_id")},
        {"$set": {"last_run_at": run["started_at"], "last_verdict": verdict,
                  "last_business_statement": statement}},
    )
    return {
        "found": True,
        "run": run,
        "verdict": verdict,
        "business_statement": statement,
        "coverage": coverage,
        "note": (
            "Recorded as a synthetic business check. Nexus reports only what the checks actually "
            "observed — a partial run is never reported as healthy."
        ),
    }


def _trend_note(history: list[dict]) -> str:
    if not history:
        return "No synthetic runs recorded yet — this identity is registered but unproven."
    verdicts = [str(entry.get("verdict") or "") for entry in history]
    if len(verdicts) == 1:
        return f"One run recorded: {verdicts[0]}. Treat that as a single observation, not a trend."
    if all(verdict == "healthy" for verdict in verdicts):
        return f"{len(verdicts)} consecutive healthy runs."
    recent = verdicts[:3]
    return f"Last {len(recent)} runs: {', '.join(recent)} — the trend is not currently clean."


async def identity_status(db: Any, user: dict, identity_id: str) -> dict:
    """One identity: its configuration, latest verdict and recent history."""
    identity = await db.synthetic_identities.find_one(
        tenant_scoped_query(user, {"id": identity_id}), {"_id": 0})
    if not identity:
        return {"found": False}

    runs = await db.synthetic_runs.find(
        tenant_scoped_query(user, {"identity_id": identity_id}), {"_id": 0}
    ).sort("started_at", -1).limit(20).to_list(20)
    history = [
        {"at": row.get("started_at"), "verdict": row.get("verdict"),
         "business_statement": row.get("business_statement")}
        for row in runs
    ]
    return {
        "found": True,
        "identity": {**identity, "state": "monitoring" if identity.get("enabled") else "paused"},
        "latest_run": runs[0] if runs else None,
        "history": history,
        "trend_note": _trend_note(history),
        "note": (
            "Checked against the identity's own declared checks only. A paused identity keeps its "
            "history and reports no new evidence."
        ),
    }


async def list_identities(db: Any, user: dict, client_id: str | None = None) -> dict:
    """Synthetic identities in your tenant, optionally narrowed to one customer."""
    scope: dict = {}
    if client_id:
        scope["client_id"] = client_id
    rows = await db.synthetic_identities.find(
        tenant_scoped_query(user, scope), {"_id": 0}
    ).sort("created_at", -1).limit(200).to_list(200)
    identities = [
        {**row, "state": "monitoring" if row.get("enabled") else "paused"} for row in rows
    ]
    return {
        "count": len(identities),
        "identities": identities,
        "note": (
            "A synthetic identity is a business-workflow monitor: it proves the workflow a person "
            "needs actually works, rather than only that a server answered."
        ),
    }


async def synthetic_overview(db: Any, user: dict, client_id: str | None = None) -> dict:
    """Business-service health across the estate: what is proven, and what is not."""
    listed = await list_identities(db, user, client_id)
    identities = listed["identities"]
    by_verdict = {"healthy": 0, "degraded": 0, "failed": 0, "never_run": 0}
    for identity in identities:
        verdict = str(identity.get("last_verdict") or "")
        by_verdict[verdict if verdict in ("healthy", "degraded", "failed") else "never_run"] += 1
    return {
        "count": len(identities),
        "identities": identities,
        "by_verdict": by_verdict,
        "never_run": [item["id"] for item in identities if not item.get("last_verdict")],
        "paused": [item["id"] for item in identities if not item.get("enabled")],
        "note": (
            "Every verdict comes from a real synthetic run. 'never_run' means Nexus has no evidence "
            "for that workflow yet — that is an unknown, not a healthy service."
        ),
    }
