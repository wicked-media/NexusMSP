"""Nexus Diagnostic Workbench: one investigation instead of eighty tools.

A technician opens a problem ("Sarah can't access MYOB"). Nexus creates an
*investigation*: the plausible cause domains, the evidence recorded so far, and
the single next diagnostic test that eliminates the most uncertainty. Each
recorded test result updates the posterior probabilities.

Honesty boundaries that this module will not cross:

* The starting weights and per-test likelihoods are **declared heuristics**,
  published by :func:`hypothesis_catalog` so they can be argued with. They are
  not learned statistics and the module never presents them as measured fact.
* ``inconclusive`` evidence is recorded but changes nothing — an observation
  that could not be made must never move a probability.
* A root cause is only ever "isolated" from arithmetic on real, recorded
  evidence. Nexus does not invent a cause to look clever.
* Nexus records the test *results a technician reports*. It never claims to
  have run a test it did not run.
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

INVESTIGATION_STATUSES = ("open", "closed")

CLOSE_OUTCOMES = ("resolved", "inconclusive", "escalated")

EVIDENCE_RESULTS = ("abnormal", "normal", "inconclusive")

SUBJECT_TYPES = ("user", "device", "client")

#: A hypothesis needs this much posterior probability *and* this much daylight
#: over the runner-up before the workbench calls the root cause isolated.
ISOLATION_THRESHOLD = 0.7
ISOLATION_MARGIN = 0.4

#: When a test says nothing about a domain we fall back to a neutral likelihood
#: of one half, so that test simply cannot move that hypothesis.
NEUTRAL_LIKELIHOOD = 0.5

DEFAULT_LIKELIHOOD: dict[str, float] = {
    "application": NEUTRAL_LIKELIHOOD,
    "identity": NEUTRAL_LIKELIHOOD,
    "endpoint": NEUTRAL_LIKELIHOOD,
    "network": NEUTRAL_LIKELIHOOD,
    "change": NEUTRAL_LIKELIHOOD,
}

DOMAINS: tuple[dict[str, Any], ...] = (
    {"domain": "application", "label": "Application",
     "prior": 0.25,
     "question": "Does the application itself fail, or only for this user and device?"},
    {"domain": "identity", "label": "Identity and access",
     "prior": 0.20,
     "question": "Is the account, group membership, licence or sign-in path the problem?"},
    {"domain": "endpoint", "label": "Endpoint",
     "prior": 0.20,
     "question": "Is this machine's own state — disk, profile, runtime, resources — the problem?"},
    {"domain": "network", "label": "Network",
     "prior": 0.20,
     "question": "Is transport, name resolution or reachability the problem?"},
    {"domain": "change", "label": "Change",
     "prior": 0.15,
     "question": "Did something we changed — update, policy, certificate, configuration — break it?"},
)

DIAGNOSTIC_TESTS: tuple[dict[str, Any], ...] = (
    {"test": "auth_recent_failures",
     "label": "Recent failed sign-ins for this user",
     "domain": "identity",
     "source": "sign-in and audit records for the affected user",
     "likelihoods": {"application": 0.15, "identity": 0.85, "endpoint": 0.35,
                     "network": 0.30, "change": 0.25}},
    {"test": "same_application_other_device",
     "label": "The same application on a comparable healthy device",
     "domain": "application",
     "source": "a peer device running the same application",
     "likelihoods": {"application": 0.90, "identity": 0.10, "endpoint": 0.20,
                     "network": 0.25, "change": 0.40}},
    {"test": "same_user_other_device",
     "label": "The same user signing in somewhere else",
     "domain": "identity",
     "source": "the affected user on a second managed device",
     "likelihoods": {"application": 0.30, "identity": 0.85, "endpoint": 0.20,
                     "network": 0.30, "change": 0.30}},
    {"test": "reachability_two_paths",
     "label": "Reachability from two independent paths",
     "domain": "network",
     "source": "the same target reached from inside the site and from the Nexus side",
     "likelihoods": {"application": 0.30, "identity": 0.10, "endpoint": 0.30,
                     "network": 0.90, "change": 0.20}},
    {"test": "name_resolution",
     "label": "Name resolution for the host or service name",
     "domain": "network",
     "source": "the resolver path the application actually uses",
     "likelihoods": {"application": 0.30, "identity": 0.10, "endpoint": 0.30,
                     "network": 0.80, "change": 0.35}},
    {"test": "local_application_launch",
     "label": "Launch the application locally on the device",
     "domain": "endpoint",
     "source": "the device's own process and application records",
     "likelihoods": {"application": 0.40, "identity": 0.10, "endpoint": 0.85,
                     "network": 0.20, "change": 0.45}},
    {"test": "disk_and_resource_health",
     "label": "Disk, memory and thermal state at the moment of failure",
     "domain": "endpoint",
     "source": "device health and telemetry records",
     "likelihoods": {"application": 0.25, "identity": 0.05, "endpoint": 0.70,
                     "network": 0.10, "change": 0.30}},
    {"test": "recent_change_map",
     "label": "Everything changed on the affected path recently",
     "domain": "change",
     "source": "updates, policy and configuration change records near the onset",
     "likelihoods": {"application": 0.50, "identity": 0.30, "endpoint": 0.45,
                     "network": 0.40, "change": 0.90}},
    {"test": "peer_comparison",
     "label": "Compare against healthy peers of the same role and hardware",
     "domain": "endpoint",
     "source": "comparable healthy devices for this customer",
     "likelihoods": {"application": 0.35, "identity": 0.15, "endpoint": 0.80,
                     "network": 0.25, "change": 0.50}},
    {"test": "upstream_service_health",
     "label": "Health of the service or server the application depends on",
     "domain": "network",
     "source": "the dependency's own availability and error evidence",
     "likelihoods": {"application": 0.70, "identity": 0.15, "endpoint": 0.20,
                     "network": 0.65, "change": 0.35}},
    {"test": "runtime_and_licence_present",
     "label": "Required runtime, component or licence present and current",
     "domain": "application",
     "source": "the device's installed software and licence records",
     "likelihoods": {"application": 0.80, "identity": 0.10, "endpoint": 0.40,
                     "network": 0.05, "change": 0.40}},
    {"test": "certificate_and_clock",
     "label": "Certificate validity and time consistency on the path",
     "domain": "network",
     "source": "certificate inventory and device clock evidence",
     "likelihoods": {"application": 0.45, "identity": 0.30, "endpoint": 0.35,
                     "network": 0.70, "change": 0.40}},
)

_TESTS_BY_KEY = {entry["test"]: entry for entry in DIAGNOSTIC_TESTS}

MODEL_NOTE = (
    "The starting weights and per-test likelihoods are declared heuristics, published in full so "
    "a technician can argue with them. They are not learned statistics. Recorded evidence is what "
    "moves the answer, and unrecorded tests never count as passed."
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def hypothesis_catalog() -> dict:
    """The published differential-diagnosis model: domains, priors and tests."""
    return {
        "domains": [dict(entry) for entry in DOMAINS],
        "tests": [
            {"test": entry["test"], "label": entry["label"], "domain": entry["domain"],
             "source": entry["source"], "likelihoods": dict(entry["likelihoods"])}
            for entry in DIAGNOSTIC_TESTS
        ],
        "isolation": {"threshold": ISOLATION_THRESHOLD, "margin": ISOLATION_MARGIN},
        "model_note": MODEL_NOTE,
    }


def _priors() -> dict[str, float]:
    return {entry["domain"]: float(entry["prior"]) for entry in DOMAINS}


def _entropy(distribution: dict[str, float]) -> float:
    return -sum(p * math.log2(p) for p in distribution.values() if p > 0)


def _posterior(priors: dict[str, float], test: str, abnormal: bool) -> dict[str, float]:
    """One Bayesian step. ``abnormal`` is the observed test result."""
    likelihoods = _TESTS_BY_KEY[test]["likelihoods"]
    raw: dict[str, float] = {}
    for domain, prior in priors.items():
        p_abnormal = float(likelihoods.get(domain, NEUTRAL_LIKELIHOOD))
        raw[domain] = prior * (p_abnormal if abnormal else 1.0 - p_abnormal)
    total = sum(raw.values())
    if total <= 0:
        return dict(priors)
    return {domain: value / total for domain, value in raw.items()}


def _expected_information_gain(priors: dict[str, float], test: str) -> float:
    """How much uncertainty this test is expected to remove, before running it."""
    likelihoods = _TESTS_BY_KEY[test]["likelihoods"]
    p_abnormal = sum(prior * float(likelihoods.get(domain, NEUTRAL_LIKELIHOOD))
                     for domain, prior in priors.items())
    p_abnormal = min(max(p_abnormal, 0.0), 1.0)
    baseline = _entropy(priors)
    gain_abnormal = baseline - _entropy(_posterior(priors, test, True))
    gain_normal = baseline - _entropy(_posterior(priors, test, False))
    gain = p_abnormal * gain_abnormal + (1.0 - p_abnormal) * gain_normal
    return round(max(gain, 0.0), 4)


def _rank_tests(priors: dict[str, float], observed: set[str]) -> list[dict]:
    ranked = [
        {"test": entry["test"], "label": entry["label"], "domain": entry["domain"],
         "source": entry["source"],
         "expected_information_gain": _expected_information_gain(priors, entry["test"])}
        for entry in DIAGNOSTIC_TESTS
        if entry["test"] not in observed
    ]
    ranked.sort(key=lambda item: (-item["expected_information_gain"], item["test"]))
    return ranked


def _isolated(posteriors: dict[str, float]) -> bool:
    if not posteriors:
        return False
    ranked = sorted(posteriors.values(), reverse=True)
    top = ranked[0]
    runner_up = ranked[1] if len(ranked) > 1 else 0.0
    return top >= ISOLATION_THRESHOLD and (top - runner_up) >= ISOLATION_MARGIN


def _hypothesis_rows(posteriors: dict[str, float]) -> list[dict]:
    rows = []
    for entry in DOMAINS:
        domain = entry["domain"]
        rows.append({
            "domain": domain,
            "label": entry["label"],
            "prior": float(entry["prior"]),
            "probability": round(float(posteriors.get(domain, 0.0)), 4),
            "question": entry["question"],
        })
    rows.sort(key=lambda item: (-item["probability"], item["domain"]))
    return rows


def _percentages(posteriors: dict[str, float]) -> dict[str, float]:
    return {domain: round(value * 100.0, 1) for domain, value in posteriors.items()}


async def _subject_context(db: Any, user: dict, payload: dict) -> dict:
    """Gather what is *observed* about the subject, clearly separated from what
    is interpreted. A subject that does not exist in scope is not found."""
    subject_type = str(payload.get("subject_type") or "").strip()
    subject_id = str(payload.get("subject_id") or "").strip()
    observations: list[dict] = []
    subject: dict = {"type": subject_type, "id": subject_id}

    if subject_type == "device":
        device = await db.devices.find_one(tenant_scoped_query(user, {"id": subject_id}), {"_id": 0})
        if not device:
            return {"found": False}
        subject["client_id"] = str(device.get("client_id") or "")
        subject["label"] = str(device.get("hostname") or device.get("name") or subject_id)
        observations.append({"observation": "device last seen",
                             "value": str(device.get("last_seen") or "never recorded")})
        observations.append({"observation": "device status",
                             "value": str(device.get("status") or "not recorded")})
    elif subject_type == "user":
        row = await db.users.find_one(tenant_scoped_query(user, {"id": subject_id}), {"_id": 0})
        if not row:
            return {"found": False}
        subject["client_id"] = str(row.get("client_id") or "")
        subject["label"] = str(row.get("name") or row.get("email") or subject_id)
        observations.append({"observation": "account state",
                             "value": str(row.get("status") or "not recorded")})
    elif subject_type == "client":
        row = await db.clients.find_one(tenant_scoped_query(user, {"id": subject_id}), {"_id": 0})
        if not row:
            return {"found": False}
        subject["client_id"] = subject_id
        subject["label"] = str(row.get("name") or subject_id)
    else:
        return {"found": False}

    client_id = str(payload.get("client_id") or subject.get("client_id") or "")
    if client_id:
        open_tickets = await db.tickets.count_documents(tenant_scoped_query(
            user, {"client_id": client_id, "status": {"$in": ["open", "in_progress", "pending"]}}))
        observations.append({"observation": "open tickets for this customer",
                             "value": open_tickets})
    return {
        "found": True,
        "subject": subject,
        "observations": observations,
        "context_note": ("Observed facts only — listed so a technician can see what Nexus already knew. "
                         "None of these observations has been interpreted as a cause."),
    }


def _summary(row: dict, next_test: dict | None, ranked: list[dict]) -> dict:
    posteriors = dict(row.get("posteriors") or {})
    return {
        "id": row.get("id"),
        "status": row.get("status"),
        "symptom": row.get("symptom"),
        "subject": row.get("subject"),
        "client_id": row.get("client_id") or "",
        "ticket_id": row.get("ticket_id") or "",
        "hypotheses": _hypothesis_rows(posteriors),
        "probabilities_percent": _percentages(posteriors),
        "evidence_count": len(row.get("evidence") or []),
        "isolated": bool(row.get("root_cause")),
        "root_cause": row.get("root_cause"),
        "next_test": next_test,
        "alternatives": ranked[1:4],
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "closed_outcome": row.get("closed_outcome") or "",
    }


async def open_investigation(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Open one investigation and gather what is already observed about the subject."""
    symptom = str(payload.get("symptom") or "").strip()
    subject_type = str(payload.get("subject_type") or "").strip()
    subject_id = str(payload.get("subject_id") or "").strip()
    if not symptom:
        return {"found": False, "error": "symptom is required"}
    if subject_type not in SUBJECT_TYPES:
        return {"found": False, "error": f"subject_type must be one of {', '.join(SUBJECT_TYPES)}"}
    if not subject_id:
        return {"found": False, "error": "subject_id is required"}

    context = await _subject_context(db, user, {**payload, "subject_type": subject_type,
                                                "subject_id": subject_id})
    if not context.get("found"):
        return {"found": False}

    priors = _priors()
    observed: set[str] = set()
    ranked = _rank_tests(priors, observed)
    now = _utcnow()
    row = {
        "id": f"INV-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": platform_tenant_id(user),
        "symptom": symptom[:300],
        "subject": context["subject"],
        "subject_type": subject_type,
        "subject_id": subject_id,
        "client_id": str(payload.get("client_id") or context["subject"].get("client_id") or "")[:64],
        "ticket_id": str(payload.get("ticket_id") or "")[:64],
        "status": "open",
        "observations": context["observations"],
        "context_note": context["context_note"],
        "posteriors": priors,
        "evidence": [],
        "root_cause": None,
        "closed_outcome": "",
        "created_by": user.get("id"),
        "created_by_name": name,
        "created_at": _iso(now),
        "updated_at": _iso(now),
    }
    await db.investigations.insert_one(row)
    row.pop("_id", None)
    return {
        "found": True,
        "investigation": _summary(row, ranked[0] if ranked else None, ranked),
        "note": ("Investigation opened. Evidence moves these probabilities; unrecorded tests never "
                 "count as passed."),
    }


async def add_evidence(db: Any, user: dict, name: str, investigation_id: str, payload: dict) -> dict:
    """Record one observed test result and update the hypotheses honestly."""
    test = str(payload.get("test") or "").strip()
    result = str(payload.get("result") or "").strip().lower()
    if test not in _TESTS_BY_KEY:
        return {"found": False, "error": f"unknown test '{test}' — see the diagnostic catalog"}
    if result not in EVIDENCE_RESULTS:
        return {"found": False, "error": f"result must be one of {', '.join(EVIDENCE_RESULTS)}"}

    row = await db.investigations.find_one(
        tenant_scoped_query(user, {"id": investigation_id}), {"_id": 0})
    if not row:
        return {"found": False}
    if row.get("status") != "open":
        return {"found": False,
                "error": "investigation is closed — evidence is append-only and a closed investigation is immutable"}

    prior_posteriors = dict(row.get("posteriors") or _priors())
    before = _entropy(prior_posteriors)
    if result == "inconclusive":
        revised = dict(prior_posteriors)
        gain = 0.0
    else:
        revised = _posterior(prior_posteriors, test, result == "abnormal")
        gain = round(max(before - _entropy(revised), 0.0), 4)

    now = _utcnow()
    observed = {entry.get("test") for entry in (row.get("evidence") or [])}
    observed.add(test)
    entry = {
        "test": test,
        "label": _TESTS_BY_KEY[test]["label"],
        "result": result,
        "detail": str(payload.get("detail") or "")[:1000],
        "source": str(payload.get("source") or _TESTS_BY_KEY[test]["source"])[:300],
        "recorded_by": name,
        "at": _iso(now),
        "information_gain": gain,
    }
    evidence = list(row.get("evidence") or []) + [entry]
    ranked = _rank_tests(revised, observed)
    root_cause = None
    if _isolated(revised):
        top = max(revised, key=lambda domain: revised[domain])
        root_cause = {"domain": top,
                      "probability": round(float(revised[top]), 4),
                      "basis": f"recorded evidence moved {top} to {round(revised[top] * 100, 1)}%"}
    updates = {
        "posteriors": revised,
        "evidence": evidence,
        "root_cause": root_cause,
        "updated_at": _iso(now),
    }
    await db.investigations.update_one(
        {"id": investigation_id, "tenant_id": row.get("tenant_id")}, {"$set": updates})
    row.update(updates)

    note = ("Result recorded as inconclusive — it changed nothing, because an observation that could "
            "not be made must never move a probability." if result == "inconclusive"
            else f"Recorded: {result}. Information gained: {gain} bits.")
    return {
        "found": True,
        "investigation": _summary(row, ranked[0] if ranked else None, ranked),
        "update": {"test": test, "result": result,
                   "posteriors_before": _percentages(prior_posteriors),
                   "posteriors_after": _percentages(revised),
                   "information_gain": gain},
        "note": note,
    }


async def next_best_test(db: Any, user: dict, investigation_id: str) -> dict:
    """The single test that removes the most uncertainty right now."""
    row = await db.investigations.find_one(
        tenant_scoped_query(user, {"id": investigation_id}), {"_id": 0})
    if not row:
        return {"found": False}
    posteriors = dict(row.get("posteriors") or _priors())
    observed = {entry.get("test") for entry in (row.get("evidence") or [])}
    ranked = _rank_tests(posteriors, observed)
    if row.get("root_cause"):
        return {
            "found": True,
            "investigation_id": investigation_id,
            "test": None,
            "isolated": True,
            "root_cause": row.get("root_cause"),
            "why": "A cause is already isolated. The useful next step is to fix it and re-run the "
                   "test that discriminated it, so the fix is verified rather than assumed.",
            "alternatives": [],
            "note": "Nexus will not spend a technician's time on tests that can no longer change the answer.",
        }
    if not ranked:
        return {
            "found": True,
            "investigation_id": investigation_id,
            "test": None,
            "isolated": False,
            "alternatives": [],
            "why": "Every test in the catalog has been recorded for this investigation.",
            "note": ("No remaining test can change the answer. Escalate, or record a new symptom the "
                     "catalog does not cover yet."),
        }
    best = ranked[0]
    top = _hypothesis_rows(posteriors)[:3]
    return {
        "found": True,
        "investigation_id": investigation_id,
        "test": best,
        "isolated": False,
        "alternatives": ranked[1:4],
        "why": (f"'{best['label']}' has the highest expected information value "
                f"({best['expected_information_gain']} bits) against the current hypotheses."),
        "current_leader": top[0] if top else None,
        "note": ("Expected information value is arithmetic on the published likelihoods, not a promise "
                 "about what the test will find."),
    }


async def investigation_summary(db: Any, user: dict, investigation_id: str) -> dict:
    """Ranked hypotheses, the evidence trail, and the next best test."""
    row = await db.investigations.find_one(
        tenant_scoped_query(user, {"id": investigation_id}), {"_id": 0})
    if not row:
        return {"found": False}
    posteriors = dict(row.get("posteriors") or _priors())
    observed = {entry.get("test") for entry in (row.get("evidence") or [])}
    ranked = _rank_tests(posteriors, observed)
    summary = _summary(row, None if row.get("root_cause") else (ranked[0] if ranked else None), ranked)
    summary["evidence"] = row.get("evidence") or []
    summary["observations"] = row.get("observations") or []
    summary["context_note"] = row.get("context_note") or ""
    summary["model_note"] = MODEL_NOTE
    return {
        "found": True,
        "investigation": summary,
        "note": ("Probabilities are the arithmetic result of recorded evidence against published "
                 "heuristics. Everything Nexus did not observe is unverified."),
    }


async def close_investigation(db: Any, user: dict, name: str, investigation_id: str,
                             payload: dict) -> dict:
    """Close an investigation with an honest outcome. What was learned stays."""
    outcome = str(payload.get("outcome") or "").strip().lower()
    if outcome not in CLOSE_OUTCOMES:
        return {"found": False, "error": f"outcome must be one of {', '.join(CLOSE_OUTCOMES)}"}
    row = await db.investigations.find_one(
        tenant_scoped_query(user, {"id": investigation_id}), {"_id": 0})
    if not row:
        return {"found": False}
    if row.get("status") != "open":
        return {"found": False, "error": "investigation is already closed — closing is recorded once"}

    now = _utcnow()
    root_cause = row.get("root_cause")
    stated = str(payload.get("root_cause") or "").strip()
    if outcome == "resolved":
        if stated and not root_cause:
            root_cause = {"domain": "reported", "probability": None,
                          "basis": f"recorded by {name} at close: {stated[:200]}"}
        elif stated:
            root_cause = {**root_cause, "technician_note": stated[:200]}
        if not root_cause:
            return {"found": False,
                    "error": ("no cause is isolated and no root_cause was supplied — record the "
                              "outcome as inconclusive rather than inventing one")}
    elif outcome != "resolved":
        root_cause = row.get("root_cause")

    updates = {
        "status": "closed",
        "closed_outcome": outcome,
        "closed_by": name,
        "closed_at": _iso(now),
        "root_cause": root_cause,
        "updated_at": _iso(now),
    }
    await db.investigations.update_one(
        {"id": investigation_id, "tenant_id": row.get("tenant_id")}, {"$set": updates})
    row.update(updates)
    observed = {entry.get("test") for entry in (row.get("evidence") or [])}
    ranked = _rank_tests(dict(row.get("posteriors") or _priors()), observed)
    return {
        "found": True,
        "investigation": _summary(row, None, ranked),
        "note": ("Closed. The evidence trail and the tests that actually discriminated survive for the "
                 "next technician." if outcome == "resolved"
                 else "Closed without a confirmed cause. The recorded evidence is kept — an honest "
                      "unresolved investigation is more useful than a guessed cause."),
    }


async def list_investigations(db: Any, user: dict, client_id: str | None = None,
                              status: str | None = None) -> dict:
    """Open and recent investigations in tenant scope."""
    query: dict = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        if status not in INVESTIGATION_STATUSES:
            return {"found": False,
                    "error": f"status must be one of {', '.join(INVESTIGATION_STATUSES)}"}
        query["status"] = status
    rows = await db.investigations.find(tenant_scoped_query(user, query), {"_id": 0}) \
        .sort("updated_at", -1).limit(100).to_list(100)
    items = []
    for row in rows:
        posteriors = dict(row.get("posteriors") or {})
        top_domain = max(posteriors, key=lambda domain: posteriors[domain]) if posteriors else None
        items.append({
            "id": row.get("id"),
            "symptom": row.get("symptom"),
            "subject": row.get("subject"),
            "client_id": row.get("client_id") or "",
            "status": row.get("status"),
            "top_hypothesis": top_domain,
            "probability_percent": round(float(posteriors.get(top_domain, 0.0)) * 100.0, 1) if top_domain else None,
            "evidence_count": len(row.get("evidence") or []),
            "isolated": bool(row.get("root_cause")),
            "updated_at": row.get("updated_at"),
        })
    return {
        "count": len(items),
        "investigations": items,
        "open": sum(1 for item in items if item["status"] == "open"),
        "note": ("Every investigation keeps its evidence trail, so the next technician inherits what "
                 "was already ruled out."),
    }
