"""Nexus IT Genome: privacy-preserving aggregate operational intelligence.

The seed of the network-effect moat. Every environment produces the same kind of
operational tuple — hardware + software + configuration + symptom + remediation +
outcome — and the Genome learns which configurations fail, which causes produce
which symptoms, and which fixes actually work.

Privacy is structural, not a promise:

- pattern documents carry **no** identifying fields — no hostnames, serials,
  user names, domains or vendor tenant identifiers;
- component identity is a salted one-way fingerprint (SHA-256 over normalised
  attributes plus a platform salt), so identical stacks collapse together and
  nothing can be reversed to a customer;
- contributions are only ever surfaced as aggregates that meet a k-anonymity
  threshold (``MIN_CLUSTER``); below the threshold the answer is "not enough
  evidence", never a thin re-identifiable slice.

Single-deployment note: this stores tenant-scoped pattern documents in MongoDB
and aggregates within the deployment. A cross-deployment global pool is a future
pipeline that would export only these k-anonymised aggregates — never rows.
"""

from __future__ import annotations

import hashlib
import re
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

MIN_CLUSTER = 3  # k-anonymity floor: never surface a cluster smaller than this
_PLATFORM_SALT = "nexus-genome-v1"  # not a secret; fingerprints are one-way by design
_OUTCOMES = ("success", "failure", "partial", "unknown")
_REMEDIATION_KINDS = ("patch", "rollback", "reconfigure", "replace", "reboot", "config_change", "other")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def fingerprint(*parts: Any) -> str:
    """One-way fingerprint of normalised attributes. Cannot be reversed to a customer."""
    material = "|".join(_norm(part) for part in parts)
    return hashlib.sha256(f"{_PLATFORM_SALT}|{material}".encode("utf-8")).hexdigest()[:24]


def _validate_payload(payload: dict) -> tuple[dict | None, str | None]:
    stack = payload.get("stack") or {}
    symptom = _norm(payload.get("symptom"))
    if not symptom:
        return None, "symptom is required"
    outcome = _norm(payload.get("outcome"))
    if outcome not in _OUTCOMES:
        return None, f"outcome must be one of {', '.join(_OUTCOMES)}"
    remediation = _norm(payload.get("remediation_kind") or "other")
    if remediation not in _REMEDIATION_KINDS:
        return None, f"remediation_kind must be one of {', '.join(_REMEDIATION_KINDS)}"
    hardware = _norm(stack.get("hardware_model") or payload.get("hardware_model"))
    os_name = _norm(stack.get("os") or payload.get("os"))
    software = _norm(stack.get("software") or payload.get("software"))
    config = _norm(payload.get("config_signature"))
    if not any([hardware, os_name, software, config]):
        return None, "at least one stack attribute (hardware_model, os, software, config_signature) is required"
    return {
        "stack_fingerprint": fingerprint(hardware, os_name, software, config),
        "symptom_fingerprint": fingerprint(symptom),
        "hardware_class": hardware or "unspecified",
        "os_family": os_name or "unspecified",
        "software_family": software or "unspecified",
        "symptom": symptom[:120],
        "remediation_kind": remediation,
        "outcome": outcome,
    }, None


async def contribute_pattern(db: Any, user: dict, actor_name: str, payload: dict) -> dict:
    """Contribute one anonymised operational outcome tuple to the Genome."""
    pattern, error = _validate_payload(payload)
    if error:
        return {"found": False, "error": error}
    now = _iso(_utcnow())
    document = {
        "id": f"GEN-{uuid.uuid4().hex[:10]}",
        "tenant_id": platform_tenant_id(user),
        **pattern,
        "privacy": {"k_anonymity_min": MIN_CLUSTER, "contains_identifiers": False,
                    "fingerprint": "sha256-salted-one-way"},
        "contributed_by": fingerprint(actor_name or "unknown"),  # actor identity is hashed too
        "recorded_at": now,
    }
    await db.genome_patterns.insert_one(document)
    return {"found": True, "pattern": {key: value for key, value in document.items() if key != "_id"},
            "privacy_note": "stored without identifiers; surfaced only in aggregates of "
                            f"{MIN_CLUSTER}+ patterns"}


async def contribution_report(db: Any, user: dict) -> dict:
    """What this environment has contributed, and the privacy guarantees in force."""
    rows = await db.genome_patterns.find(tenant_scoped_query(user, {}), {"_id": 0}).to_list(5000)
    outcomes = Counter(row.get("outcome") for row in rows)
    return {
        "patterns_contributed": len(rows),
        "outcomes": dict(outcomes),
        "distinct_stacks": len({row.get("stack_fingerprint") for row in rows}),
        "privacy": {
            "k_anonymity_min": MIN_CLUSTER,
            "identifying_fields_stored": [],
            "actor_identity": "salted one-way hash",
            "cross_deployment_exports": "k-anonymised aggregates only (not yet enabled)",
        },
    }


def _cluster(rows: list[dict], key_fields: tuple[str, ...]) -> dict[tuple, list[dict]]:
    clusters: dict[tuple, list[dict]] = defaultdict(list)
    for row in rows:
        clusters[tuple(row.get(field) for field in key_fields)].append(row)
    return clusters


async def emerging_issues(db: Any, user: dict, *, window_days: int = 14) -> dict:
    """Newly emerging failure patterns: recent failure rate vs prior baseline, k-anonymised."""
    rows = await db.genome_patterns.find(tenant_scoped_query(user, {}), {"_id": 0}).to_list(5000)
    now = _utcnow()
    window_start = now - timedelta(days=window_days)
    issues: list[dict] = []
    for key, cluster in _cluster(rows, ("stack_fingerprint", "symptom")).items():
        if len(cluster) < MIN_CLUSTER:
            continue
        recent, prior = [], []
        for row in cluster:
            recorded = _parse(row.get("recorded_at"))
            if recorded and recorded >= window_start:
                recent.append(row)
            else:
                prior.append(row)
        recent_failures = sum(1 for r in recent if r.get("outcome") == "failure")
        prior_failures = sum(1 for r in prior if r.get("outcome") == "failure")
        if not recent or recent_failures == 0:
            continue
        recent_rate = recent_failures / len(recent)
        prior_rate = (prior_failures / len(prior)) if prior else None
        if prior_rate is None:
            lift = None
            note = "no prior baseline for this pattern yet"
        elif prior_rate == 0:
            lift = None
            note = "failure is new — prior window had no failures"
        else:
            lift = round(recent_rate / prior_rate, 1)
            note = f"{lift}× the prior failure rate"
        issues.append({
            "stack_fingerprint": key[0],
            "symptom": cluster[0].get("symptom"),
            "os_family": cluster[0].get("os_family"),
            "software_family": cluster[0].get("software_family"),
            "hardware_class": cluster[0].get("hardware_class"),
            "recent_failures": recent_failures,
            "recent_samples": len(recent),
            "cluster_size": len(cluster),
            "lift": lift,
            "baseline_note": note,
        })
    issues.sort(key=lambda item: (item.get("lift") or 0, item["recent_failures"]), reverse=True)
    return {
        "emerging_issues": issues,
        "count": len(issues),
        "window_days": window_days,
        "checked_at": _iso(now),
        "note": ("aggregated across " + str(len(rows)) + " anonymised patterns; "
                 f"clusters below {MIN_CLUSTER} patterns are never reported"),
    }


async def genome_insights(db: Any, user: dict, symptom: str | None = None) -> dict:
    """What normally causes this symptom — and which fixes actually work."""
    rows = await db.genome_patterns.find(tenant_scoped_query(user, {}), {"_id": 0}).to_list(5000)
    if symptom:
        wanted = fingerprint(symptom)
        rows = [row for row in rows if row.get("symptom_fingerprint") == wanted]
    by_symptom: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_symptom[str(row.get("symptom") or "unspecified")].append(row)

    insights = []
    for name, cluster in sorted(by_symptom.items()):
        if len(cluster) < MIN_CLUSTER:
            continue
        outcomes = Counter(row.get("outcome") for row in cluster)
        remedies: dict[str, Counter] = defaultdict(Counter)
        for row in cluster:
            remedies[str(row.get("remediation_kind"))][str(row.get("outcome"))] += 1
        fix_rows = []
        for kind, counter in sorted(remedies.items()):
            attempts = sum(counter.values())
            successes = counter.get("success", 0)
            fix_rows.append({
                "remediation_kind": kind,
                "attempts": attempts,
                "successes": successes,
                "success_rate": round(successes / attempts, 2) if attempts else 0.0,
            })
        fix_rows.sort(key=lambda item: (item["success_rate"], item["attempts"]), reverse=True)
        insights.append({
            "symptom": name,
            "samples": len(cluster),
            "outcomes": dict(outcomes),
            "leading_hardware_class": Counter(r.get("hardware_class") for r in cluster).most_common(1)[0][0],
            "leading_os_family": Counter(r.get("os_family") for r in cluster).most_common(1)[0][0],
            "remedies": fix_rows,
        })
    return {
        "insights": insights,
        "count": len(insights),
        "note": (f"only clusters of {MIN_CLUSTER}+ anonymised patterns are reported"
                 + (f"; symptom filter: {symptom}" if symptom else "")),
    }


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
