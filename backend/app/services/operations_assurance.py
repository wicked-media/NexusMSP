"""Nexus Operations Assurance Studio — did the promised outcome actually happen?

Foundation 2 of the three foundations in ``docs/NEXUS_FOUNDATIONS_BATCH_4.md``.

Monitoring answers "did the job run?" Operations Assurance answers the question
the customer actually bought: *was the promised operational outcome achieved?*
Each commitment below names a promise, the evidence that would prove it, and a
deterministic evaluation of that evidence.

The governing rule is the studio fleet's Law 9 — **disclosed, never fabricated**.
A commitment with no recorded evidence is ``not_measured`` with its reason. It is
never ``met``, and it is never quietly omitted: an unmeasured obligation is the
most important thing on the screen.

This module is pure policy. The router assembles evidence from already-scoped
reads; nothing here performs I/O or invents a fact.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Mapping

COMMITMENT_STATES = frozenset({"met", "at_risk", "breached", "not_measured"})

# Anything at or above this share of a threshold is reported early, so an
# obligation is visible before it breaches rather than after.
AT_RISK_RATIO = 0.8

ASSURANCE_BOUNDARY = (
    "Nexus evaluates recorded evidence against the promise. A commitment with no "
    "recorded evidence is reported as not measured, never as met."
)


def _parse_timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _hours_since(stamp: datetime | None, now: datetime) -> float | None:
    if stamp is None:
        return None
    return (now - stamp).total_seconds() / 3600.0


def _result(
    commitment: Mapping[str, Any],
    *,
    state: str,
    reason: str,
    gaps: Iterable[Mapping[str, Any]] = (),
    counts: Mapping[str, int] | None = None,
    now: datetime,
) -> dict[str, Any]:
    if state not in COMMITMENT_STATES:
        raise ValueError(f"unknown commitment state: {state}")
    return {
        "id": commitment["id"],
        "title": commitment["title"],
        "promise": commitment["promise"],
        "evidence_source": commitment["evidence_source"],
        "owner": commitment["owner"],
        "state": state,
        "reason": reason,
        "gaps": [dict(gap) for gap in gaps],
        "counts": dict(counts or {}),
        "evaluated_at": now.isoformat(),
    }


# ============== COMMITMENT EVALUATORS ==============


def evaluate_verified_recovery_point(
    records: Iterable[Mapping[str, Any]], commitment: Mapping[str, Any], now: datetime,
) -> dict[str, Any]:
    """Every protected workload has a *verified* recovery point inside its RPO."""
    workloads = list(records)
    if not workloads:
        return _result(commitment, state="not_measured", now=now,
                       reason="No protected workload is recorded, so no recovery point can be verified.")

    unassessed = [w for w in workloads if w.get("rpo_hours") in (None, "")]
    if len(unassessed) == len(workloads):
        return _result(commitment, state="not_measured", now=now,
                       reason="No workload records an agreed recovery-point objective (RPO).",
                       counts={"evaluated": 0, "total": len(workloads)})

    gaps: list[dict[str, Any]] = []
    evaluated = len(workloads) - len(unassessed)
    for workload in workloads:
        rpo = workload.get("rpo_hours")
        if rpo in (None, ""):
            continue
        try:
            rpo_hours = float(rpo)
        except (TypeError, ValueError):
            continue
        verified = _parse_timestamp(workload.get("last_verified_recovery_at"))
        age = _hours_since(verified, now)
        if verified is None:
            gaps.append({
                "workload_id": str(workload.get("id") or ""),
                "name": str(workload.get("name") or ""),
                "reason": "No verified recovery point has been recorded.",
                "age_hours": None,
                "rpo_hours": rpo_hours,
            })
            continue
        if age > rpo_hours:
            gaps.append({
                "workload_id": str(workload.get("id") or ""),
                "name": str(workload.get("name") or ""),
                "reason": "Verified recovery point is older than the agreed objective.",
                "age_hours": round(age, 2),
                "rpo_hours": rpo_hours,
            })

    breached = [gap for gap in gaps if gap["age_hours"] is not None]
    never_verified = [gap for gap in gaps if gap["age_hours"] is None]
    if breached:
        return _result(commitment, state="breached", now=now,
                       reason=f"{len(breached)} workload(s) have no verified recovery point inside their RPO.",
                       gaps=gaps, counts={"evaluated": evaluated, "breached": len(breached)})
    if never_verified:
        return _result(commitment, state="at_risk", now=now,
                       reason=f"{len(never_verified)} workload(s) have never recorded a verified recovery point.",
                       gaps=gaps, counts={"evaluated": evaluated, "unverified": len(never_verified)})
    return _result(commitment, state="met", now=now,
                   reason=f"All {evaluated} workload(s) have a verified recovery point inside their RPO.",
                   counts={"evaluated": evaluated, "breached": 0})


def evaluate_website_enquiry_form(
    records: Iterable[Mapping[str, Any]], commitment: Mapping[str, Any], now: datetime,
) -> dict[str, Any]:
    """Every critical website has a form the customer can actually submit."""
    sites = list(records)
    if not sites:
        return _result(commitment, state="not_measured", now=now,
                       reason="No critical website is recorded for this scope.")

    missing: list[dict[str, Any]] = []
    unassessed: list[dict[str, Any]] = []
    verified = 0
    for site in sites:
        state = str(site.get("enquiry_form_state") or "").strip().lower()
        entry = {
            "website_id": str(site.get("id") or ""),
            "name": str(site.get("name") or ""),
            "url": str(site.get("url") or ""),
        }
        if state == "verified":
            verified += 1
        elif state == "missing":
            missing.append({**entry, "reason": "No functional enquiry form was recorded."})
        else:
            unassessed.append({**entry, "reason": "The enquiry form has not been assessed."})

    if missing:
        return _result(commitment, state="breached", now=now,
                       reason=f"{len(missing)} critical website(s) have no functional enquiry form.",
                       gaps=missing, counts={"evaluated": verified, "breached": len(missing)})
    if unassessed:
        return _result(commitment, state="at_risk", now=now,
                       reason=f"{len(unassessed)} critical website(s) have an unassessed enquiry form.",
                       gaps=unassessed, counts={"evaluated": verified, "unassessed": len(unassessed)})
    return _result(commitment, state="met", now=now,
                   reason=f"All {verified} critical website(s) report a verified enquiry form.",
                   counts={"evaluated": verified, "breached": 0})


def evaluate_departed_user_access(
    records: Iterable[Mapping[str, Any]], commitment: Mapping[str, Any], now: datetime,
) -> dict[str, Any]:
    """A departed user's access is revoked inside the agreed timeframe."""
    departures = list(records)
    if not departures:
        return _result(commitment, state="not_measured", now=now,
                       reason="No departure has been recorded, so revocation cannot be evaluated.")

    outstanding: list[dict[str, Any]] = []
    late: list[dict[str, Any]] = []
    on_time = 0
    for departure in departures:
        left_at = _parse_timestamp(departure.get("left_at"))
        revoked_at = _parse_timestamp(departure.get("revoked_at"))
        try:
            timeframe = float(departure.get("timeframe_hours"))
        except (TypeError, ValueError):
            timeframe = None
        entry = {
            "user_id": str(departure.get("user_id") or ""),
            "name": str(departure.get("name") or ""),
        }
        if left_at is None or timeframe is None:
            outstanding.append({**entry, "reason": "The departure or its timeframe was not recorded."})
            continue
        elapsed = _hours_since(left_at, revoked_at or now)
        if revoked_at is None:
            outstanding.append({**entry, "reason": "Access has not been revoked yet.",
                                "elapsed_hours": round(elapsed, 2), "timeframe_hours": timeframe})
        elif elapsed > timeframe:
            late.append({**entry, "reason": "Access was revoked later than the agreed timeframe.",
                         "elapsed_hours": round(elapsed, 2), "timeframe_hours": timeframe})
        else:
            on_time += 1

    if late:
        return _result(commitment, state="breached", now=now,
                       reason=f"{len(late)} departure(s) had access revoked later than agreed.",
                       gaps=late, counts={"evaluated": on_time + len(late), "breached": len(late)})
    if outstanding:
        return _result(commitment, state="at_risk", now=now,
                       reason=f"{len(outstanding)} departure(s) cannot be verified as revoked.",
                       gaps=outstanding, counts={"evaluated": on_time, "unverified": len(outstanding)})
    return _result(commitment, state="met", now=now,
                   reason=f"All {on_time} departure(s) had access revoked inside the agreed timeframe.",
                   counts={"evaluated": on_time, "breached": 0})


def evaluate_monitoring_reporting(
    records: Iterable[Mapping[str, Any]], commitment: Mapping[str, Any], now: datetime,
) -> dict[str, Any]:
    """Every monitored endpoint reported inside the agreed window."""
    agents = list(records)
    if not agents:
        return _result(commitment, state="not_measured", now=now,
                       reason="No monitored endpoint is recorded for this scope.")

    silent: list[dict[str, Any]] = []
    reporting = 0
    for agent in agents:
        last_seen = _parse_timestamp(agent.get("last_seen") or agent.get("last_heartbeat_at"))
        try:
            window = float(agent.get("window_hours"))
        except (TypeError, ValueError):
            window = None
        entry = {
            "device_id": str(agent.get("device_id") or agent.get("id") or ""),
            "name": str(agent.get("name") or agent.get("hostname") or ""),
        }
        if last_seen is None:
            silent.append({**entry, "reason": "The endpoint has never reported.",
                           "silent_hours": None, "window_hours": window})
            continue
        silent_hours = _hours_since(last_seen, now)
        if window is not None and silent_hours > window:
            silent.append({**entry, "reason": "The endpoint has not reported inside the window.",
                           "silent_hours": round(silent_hours, 2), "window_hours": window})
        else:
            reporting += 1

    if silent:
        return _result(commitment, state="breached", now=now,
                       reason=f"{len(silent)} monitored endpoint(s) are outside the agreed reporting window.",
                       gaps=silent, counts={"evaluated": reporting, "breached": len(silent)})
    return _result(commitment, state="met", now=now,
                   reason=f"All {reporting} monitored endpoint(s) reported inside the agreed window.",
                   counts={"evaluated": reporting, "breached": 0})


# ============== THE COMMITMENT CATALOGUE ==============

COMMITMENTS: tuple[dict[str, Any], ...] = (
    {
        "id": "verified_recovery_point",
        "title": "Verified recovery point inside the agreed objective",
        "promise": "Every protected workload has a recovery point that was verified, and it is newer than the agreed recovery-point objective.",
        "evidence_source": "backup_jobs (workload, rpo_hours, last_verified_recovery_at)",
        "owner": "Recovery",
        "evaluate": evaluate_verified_recovery_point,
    },
    {
        "id": "website_enquiry_form",
        "title": "Critical websites have a functional enquiry form",
        "promise": "Every critical website has an enquiry form a customer can actually submit.",
        "evidence_source": "web_sites (critical, enquiry_form_state)",
        "owner": "Experience",
        "evaluate": evaluate_website_enquiry_form,
    },
    {
        "id": "departed_user_access_revoked",
        "title": "Departed access revoked inside the agreed timeframe",
        "promise": "A departed user's access is revoked within the timeframe the customer agreed.",
        "evidence_source": "offboarding_records (user_id, left_at, revoked_at, timeframe_hours)",
        "owner": "Security",
        "evaluate": evaluate_departed_user_access,
    },
    {
        "id": "monitoring_reporting_window",
        "title": "Monitored endpoints report inside their window",
        "promise": "Every monitored endpoint has reported inside the window its monitoring agreement promises.",
        "evidence_source": "nexus_agents (device_id, last_seen, window_hours)",
        "owner": "Platform Operations",
        "evaluate": evaluate_monitoring_reporting,
    },
)

COMMITMENT_BY_ID: dict[str, dict[str, Any]] = {commitment["id"]: commitment for commitment in COMMITMENTS}


def _coerce_evaluator(commitment: Mapping[str, Any]) -> Callable[..., dict[str, Any]]:
    evaluate = commitment.get("evaluate")
    if not callable(evaluate):
        raise ValueError(f"commitment '{commitment.get('id')}' has no evaluator")
    return evaluate


def evaluate_commitment(
    commitment_id: str,
    records: Iterable[Mapping[str, Any]],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Evaluate one commitment against its recorded evidence."""
    commitment = COMMITMENT_BY_ID.get(str(commitment_id))
    if commitment is None:
        raise KeyError(commitment_id)
    reference = now or datetime.now(timezone.utc)
    return _coerce_evaluator(commitment)(records, commitment, reference)


def evaluate_all(
    evidence: Mapping[str, Iterable[Mapping[str, Any]]],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Evaluate every commitment.

    ``evidence`` maps a commitment id to its already-fetched, already-scoped
    records. A commitment with no entry is evaluated as ``not_measured`` with a
    reason rather than being silently dropped from the report.
    """
    reference = now or datetime.now(timezone.utc)
    rows: list[dict[str, Any]] = []
    for commitment in COMMITMENTS:
        records = evidence.get(commitment["id"])
        if records is None:
            rows.append(_result(
                commitment, state="not_measured", now=reference,
                reason="Nexus holds no evidence source for this commitment in this scope.",
            ))
            continue
        rows.append(_coerce_evaluator(commitment)(records, commitment, reference))

    summary = {state: 0 for state in sorted(COMMITMENT_STATES)}
    for row in rows:
        summary[row["state"]] += 1
    summary["total"] = len(rows)

    return {
        "commitments": rows,
        "summary": summary,
        "boundary": ASSURANCE_BOUNDARY,
    }
