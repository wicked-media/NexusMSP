"""Nexus Evidence Engine: standardised proof that an operation actually succeeded.

An *operation* writes one evidence envelope: what was done, to what, by whom,
how the outcome was observed, and which checks were required to call it done.
The verdict is then **derived from the recorded checks every single time** — a
caller-supplied verdict is ignored, and an operation is only ``verified`` when
every required check carries a real observation that passed.

Boundary with the neighbours (read both before changing anything here):

* ``nexus_verify_execution`` is the approval/challenge gate that authorises
  protected Microsoft provider actions *before* they run. It decides whether an
  action may proceed; this module records what an already-performed operation
  actually achieved.
* ``nexus_ledger`` owns the hash-chained double-entry *financial* ledger. This
  module reuses the same per-tenant chaining idea for *operational* evidence —
  different store, different subject, no money.

Rules that keep this honest:

- absence of evidence is never success: unobserved required checks produce
  ``partial`` or ``unverified``, never ``verified``;
- evidence entries are append-only and hash-chained per tenant, so a stored
  entry can prove it was not altered after the fact;
- a pack is a *manifest of proof* — it references evidence and carries no
  secrets, credentials or raw payload dumps.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

OUTCOMES = ("success", "failure", "partial", "unknown")

EVIDENCE_VERDICTS = ("verified", "partial", "unverified", "failed")

DEFAULT_WINDOW_DAYS = 30
MIN_WINDOW_DAYS = 1
MAX_WINDOW_DAYS = 365


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _public(document: dict) -> dict:
    """Strip the Mongo ``_id`` before any response (insert_one mutates in place)."""
    return {key: value for key, value in document.items() if key != "_id"}


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ============== INTEGRITY: A PER-TENANT HASH CHAIN ==============


def _canonical(body: dict) -> str:
    """Deterministic serialisation, so a hash can be recomputed byte-for-byte."""
    return json.dumps(body, sort_keys=True, default=str, separators=(",", ":"))


def _evidence_hash(previous_hash: str, body: dict) -> str:
    material = str(previous_hash or "") + _canonical(body)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def compute_entry_hash(document: dict) -> str:
    """Recompute a stored entry's hash from its own body.

    This is how an entry proves it was not altered: the body of a stored
    document must reproduce the ``chain.entry_hash`` it was written with.
    """
    chain = document.get("chain") or {}
    body = {key: value for key, value in document.items() if key != "chain"}
    return _evidence_hash(str(chain.get("previous_hash") or ""), body)


async def _chain_state(db: Any, user: dict) -> tuple[str, int]:
    """The tenant's latest chained hash and the next sequence number.

    Ordering is resolved in Python over the ``chain`` sub-document rather than
    with a dotted sort key, so the tail of the chain is unambiguous.
    """
    rows = await db.operation_evidence.find(
        tenant_scoped_query(user, {}), {"_id": 0}).to_list(5000)
    if not rows:
        return "", 1
    latest = max(rows, key=lambda row: int((row.get("chain") or {}).get("sequence") or 0))
    chain = latest.get("chain") or {}
    return str(chain.get("entry_hash") or ""), int(chain.get("sequence") or 0) + 1


# ============== THE DERIVED VERDICT ==============


def derive_verdict(outcome: str, required_checks: list[str], checks: list[dict]) -> dict:
    """Derive the verdict from the recorded observations. Never trusts a caller."""
    observations = {str(entry.get("check")): bool(entry.get("observed")) for entry in checks}
    unobserved = [check for check in required_checks if check not in observations]
    failed = [check for check in required_checks if observations.get(check) is False]
    observed = [check for check in required_checks if check in observations]

    if outcome == "failure" or failed:
        verdict = "failed"
    elif not observed:
        # No required check carries any observation at all. An absence of
        # evidence is not partial success — it is unproven.
        verdict = "unverified"
    elif outcome == "success" and not unobserved:
        verdict = "verified"
    else:
        verdict = "partial"

    if verdict == "verified":
        reason = (f"All {len(required_checks)} required check(s) were observed and passed, "
                  "and the operation reported success.")
    elif verdict == "failed":
        if failed:
            reason = ("These required checks were observed as failed: "
                      + ", ".join(failed) + ".")
        else:
            reason = "The operation reported failure, so no check can make this a success."
    elif verdict == "partial":
        detail = ("no observation for " + ", ".join(unobserved)) if unobserved \
            else "the operation did not report success"
        reason = (f"{len(unobserved)} of {len(required_checks)} required check(s) lack a "
                  f"confirmed observation ({detail}). Success is unproven.")
    else:
        reason = "No required check carries an observation; absence of evidence is not success."

    return {
        "verdict": verdict,
        "reason": reason,
        "required_checks": list(required_checks),
        "observed_checks": observed,
        "unobserved_required": unobserved,
        "failed_required": failed,
    }


def evidence_contract() -> dict:
    """Publish what counts as proof, before anyone records any."""
    return {
        "required_observation": (
            "Every check listed in required_checks must carry a real observed true/false. A check "
            "with no observation is not a pass."
        ),
        "verdicts": list(EVIDENCE_VERDICTS),
        "verdict_meaning": {
            "verified": "The operation reported success and every required check was observed and passed.",
            "partial": "Some required checks carry no observation, so success is unproven.",
            "unverified": "No required check carries any observation at all.",
            "failed": "The operation reported failure, or a required check was observed as failed.",
        },
        "integrity": ("Entries are append-only and hash-chained per tenant: the body of a stored "
                      "entry must reproduce its recorded hash, so alteration is detectable."),
        "pack": ("An evidence pack is a manifest of proof. It references evidence and carries no "
                 "secrets, credentials or raw payload dumps."),
        "note": ("A verdict is a statement about evidence, not about intent. Nexus never infers "
                 "success from an absence of complaints, and never reports success it did not observe."),
    }


# ============== RECORDING ==============


def _clean_checks(required_checks: list[str], raw_checks: Any) -> tuple[list[dict] | None, str | None]:
    if raw_checks is None:
        return [], None
    if not isinstance(raw_checks, list):
        return None, "checks must be a list of observed check results"
    cleaned: list[dict] = []
    seen: set[str] = set()
    for item in raw_checks:
        if not isinstance(item, dict):
            return None, "each check must be an object with check and observed"
        check = str(item.get("check") or "").strip()
        if not check:
            return None, "each check must name a check"
        if check not in required_checks:
            return None, f"check '{check}' is not a required check"
        if check in seen:
            return None, f"duplicate check '{check}'"
        if not isinstance(item.get("observed"), bool):
            return None, f"observed must be true or false for '{check}'"
        seen.add(check)
        cleaned.append({
            "check": check,
            "observed": bool(item.get("observed")),
            "evidence_ref": str(item.get("evidence_ref") or "")[:300],
            "detail": str(item.get("detail") or "")[:500],
        })
    return cleaned, None


async def record_evidence(db: Any, user: dict, actor_name: str, payload: dict) -> dict:
    """Record one operation's evidence envelope. Append-only and hash-chained."""
    operation = str(payload.get("operation") or "").strip()
    target_id = str(payload.get("target_id") or "").strip()
    if not operation:
        return {"found": False, "error": "operation is required"}
    if not target_id:
        return {"found": False, "error": "target_id is required"}
    outcome = str(payload.get("outcome") or "").strip().lower()
    if outcome not in OUTCOMES:
        return {"found": False, "error": f"outcome must be one of {', '.join(OUTCOMES)}"}

    raw_required = payload.get("required_checks")
    if not isinstance(raw_required, list) or not raw_required:
        return {"found": False, "error": "required_checks must be a non-empty list"}
    required_checks: list[str] = []
    for item in raw_required:
        check = str(item or "").strip()
        if not check:
            return {"found": False, "error": "required_checks must be a non-empty list"}
        if check in required_checks:
            return {"found": False, "error": f"duplicate check '{check}'"}
        required_checks.append(check)

    checks, problem = _clean_checks(required_checks, payload.get("checks"))
    if problem:
        return {"found": False, "error": problem}
    checks = checks or []

    verdict = derive_verdict(outcome, required_checks, checks)
    now = _utcnow()
    previous_hash, sequence = await _chain_state(db, user)
    body = {
        "id": f"EVD-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": platform_tenant_id(user),
        "client_id": str(payload.get("client_id") or "").strip()[:64],
        "operation": operation[:160],
        "target_type": str(payload.get("target_type") or "").strip()[:60],
        "target_id": target_id[:120],
        "method": str(payload.get("method") or "").strip()[:160],
        "actor_kind": str(payload.get("actor_kind") or "technician").strip()[:60],
        "outcome": outcome,
        "required_checks": required_checks,
        "checks": checks,
        "verdict": verdict["verdict"],
        "recorded_by": user.get("id"),
        "recorded_by_name": actor_name[:120],
        "recorded_at": _iso(now),
    }
    document = dict(body)
    document["chain"] = {
        "sequence": sequence,
        "previous_hash": previous_hash,
        "entry_hash": _evidence_hash(previous_hash, body),
    }
    await db.operation_evidence.insert_one(document)
    return {
        "found": True,
        "evidence": _public(document),
        "verdict": verdict,
        "note": ("Recorded and chained. The verdict is derived from the observations above — "
                 "nothing here asserts success that was not seen."),
    }


# ============== READING ==============


def _compact(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "client_id": row.get("client_id") or "",
        "operation": row.get("operation"),
        "target_type": row.get("target_type") or "",
        "target_id": row.get("target_id"),
        "outcome": row.get("outcome"),
        "verdict": row.get("verdict"),
        "required_checks": row.get("required_checks") or [],
        "observed_count": len(row.get("checks") or []),
        "entry_hash": (row.get("chain") or {}).get("entry_hash") or "",
        "recorded_at": row.get("recorded_at"),
    }


async def list_evidence(db: Any, user: dict, client_id: str | None = None,
                        target_id: str | None = None, operation: str | None = None) -> dict:
    """Recorded operation evidence in tenant scope, newest first."""
    query: dict = {}
    if client_id:
        query["client_id"] = client_id
    if target_id:
        query["target_id"] = target_id
    if operation:
        query["operation"] = operation
    rows = await db.operation_evidence.find(
        tenant_scoped_query(user, query), {"_id": 0}).sort("recorded_at", -1).limit(200).to_list(200)
    return {
        "count": len(rows),
        "evidence": [_compact(row) for row in rows],
        "note": ("Verdicts are recomputed from the recorded checks on read; the stored value is "
                 "never treated as authority."),
    }


async def get_evidence(db: Any, user: dict, evidence_id: str) -> dict:
    """One evidence envelope plus its freshly derived verdict."""
    row = await db.operation_evidence.find_one(
        tenant_scoped_query(user, {"id": evidence_id}), {"_id": 0})
    if not row:
        return {"found": False}
    verdict = derive_verdict(str(row.get("outcome")), list(row.get("required_checks") or []),
                             list(row.get("checks") or []))
    return {
        "found": True,
        "evidence": _public(row),
        "verdict": verdict,
        "integrity": {"recomputed_hash": compute_entry_hash(row),
                      "recorded_hash": (row.get("chain") or {}).get("entry_hash") or ""},
    }


async def verify_operation(db: Any, user: dict, evidence_id: str) -> dict:
    """Derive the verdict for one operation from its evidence, every time asked."""
    row = await db.operation_evidence.find_one(
        tenant_scoped_query(user, {"id": evidence_id}), {"_id": 0})
    if not row:
        return {"found": False}
    verdict = derive_verdict(str(row.get("outcome")), list(row.get("required_checks") or []),
                             list(row.get("checks") or []))
    note = ("Verified: every required check was observed and the operation succeeded."
            if verdict["verdict"] == "verified"
            else "Not verified. " + verdict["reason"])
    return {
        "found": True,
        "evidence": _compact(row),
        "verdict": verdict,
        "unobserved_required": verdict["unobserved_required"],
        "note": note,
    }


# ============== EVIDENCE PACKS ==============


def _root_hash(entries: list[dict]) -> str:
    """Deterministic digest over the packed entries, so a pack can be re-verified."""
    material = "|".join(f"{row['id']}:{row['entry_hash']}" for row in sorted(
        entries, key=lambda row: (str(row.get("id") or ""), str(row.get("entry_hash") or ""))))
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


async def build_evidence_pack(db: Any, user: dict, actor_name: str, payload: dict) -> dict:
    """Assemble a permissioned manifest of proof for an incident or audit."""
    title = str(payload.get("title") or "").strip()
    subject = str(payload.get("subject") or "").strip()
    if not title:
        return {"found": False, "error": "title is required"}
    if not subject:
        return {"found": False, "error": "subject is required"}

    now = _utcnow()
    window_days = payload.get("window_days", DEFAULT_WINDOW_DAYS)
    try:
        window_days = int(window_days)
    except (TypeError, ValueError):
        return {"found": False, "error": "window_days must be a whole number of days"}
    if not MIN_WINDOW_DAYS <= window_days <= MAX_WINDOW_DAYS:
        return {"found": False,
                "error": f"window_days must be between {MIN_WINDOW_DAYS} and {MAX_WINDOW_DAYS}"}

    client_id = str(payload.get("client_id") or "").strip()[:64]
    include = payload.get("include") if isinstance(payload.get("include"), list) else []
    include = [str(item)[:60] for item in include]

    explicit = payload.get("evidence_ids")
    selected: list[dict] = []
    if explicit is not None:
        if not isinstance(explicit, list) or not explicit:
            return {"found": False, "error": "evidence_ids must be a non-empty list"}
        for raw_id in explicit:
            evidence_id = str(raw_id or "").strip()
            row = await db.operation_evidence.find_one(
                tenant_scoped_query(user, {"id": evidence_id}), {"_id": 0})
            if not row:
                return {"found": False, "error": f"evidence '{evidence_id}' not found in your scope"}
            selected.append(row)
    else:
        query: dict = {"client_id": client_id} if client_id else {}
        rows = await db.operation_evidence.find(
            tenant_scoped_query(user, query), {"_id": 0}).sort("recorded_at", -1).limit(500).to_list(500)
        cutoff = now - timedelta(days=window_days)
        for row in rows:
            recorded = _parse_iso(row.get("recorded_at"))
            if recorded and recorded >= cutoff:
                selected.append(row)

    entries: list[dict] = []
    for row in selected:
        verdict = derive_verdict(str(row.get("outcome")), list(row.get("required_checks") or []),
                                 list(row.get("checks") or []))
        entries.append({
            "id": row.get("id"),
            "operation": row.get("operation"),
            "target_type": row.get("target_type") or "",
            "target_id": row.get("target_id"),
            "client_id": row.get("client_id") or "",
            "verdict": verdict["verdict"],
            "entry_hash": (row.get("chain") or {}).get("entry_hash") or "",
            "recorded_at": row.get("recorded_at"),
        })

    summary = {verdict: 0 for verdict in EVIDENCE_VERDICTS}
    for entry in entries:
        summary[entry["verdict"]] = summary.get(entry["verdict"], 0) + 1

    document = {
        "id": f"PCK-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": platform_tenant_id(user),
        "title": title[:200],
        "subject": subject[:200],
        "client_id": client_id,
        "window": {"days": window_days,
                   "from": _iso(now - timedelta(days=window_days)),
                   "to": _iso(now)},
        "include": include,
        "evidence_count": len(entries),
        "evidence_ids": [entry["id"] for entry in entries],
        "manifest": entries,
        "summary": summary,
        "integrity": {"algorithm": "sha256", "root_hash": _root_hash(entries)},
        "generated_by": user.get("id"),
        "generated_by_name": actor_name[:120],
        "generated_at": _iso(now),
    }
    await db.evidence_packs.insert_one(document)
    verified = summary.get("verified", 0)
    return {
        "found": True,
        "pack": _public(document),
        "note": (f"Manifest of {len(entries)} evidence entries; {verified} verified. "
                 "A manifest is not itself proof — each entry carries its own chained hash. "
                 "No secrets, credentials or raw payloads are included."),
    }


async def list_packs(db: Any, user: dict) -> dict:
    """Evidence packs in tenant scope, newest first."""
    rows = await db.evidence_packs.find(
        tenant_scoped_query(user, {}), {"_id": 0}).sort("generated_at", -1).limit(100).to_list(100)
    packs = [{
        "id": row.get("id"),
        "title": row.get("title"),
        "subject": row.get("subject"),
        "client_id": row.get("client_id") or "",
        "evidence_count": row.get("evidence_count") or 0,
        "summary": row.get("summary") or {},
        "root_hash": (row.get("integrity") or {}).get("root_hash") or "",
        "generated_at": row.get("generated_at"),
    } for row in rows]
    return {"count": len(packs), "packs": packs,
            "note": "Packs are point-in-time manifests; later evidence is a new pack, not an edit."}


async def get_pack(db: Any, user: dict, pack_id: str) -> dict:
    """One evidence pack with a re-verified root hash."""
    row = await db.evidence_packs.find_one(
        tenant_scoped_query(user, {"id": pack_id}), {"_id": 0})
    if not row:
        return {"found": False}
    recomputed = _root_hash(list(row.get("manifest") or []))
    recorded = (row.get("integrity") or {}).get("root_hash") or ""
    return {
        "found": True,
        "pack": _public(row),
        "integrity": {"algorithm": "sha256", "recorded_root_hash": recorded,
                      "recomputed_root_hash": recomputed, "unchanged": recomputed == recorded},
    }
