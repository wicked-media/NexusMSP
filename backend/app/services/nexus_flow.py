"""Nexus Flow Intelligence — pure policy for the friction/outcome/continuity tools.

Nexus Flow Intelligence removes the friction between discovering a problem and
proving it stayed fixed. It ships as three tools built on evidence Nexus already
holds, delivered inside existing workspaces rather than as a parallel
destination:

* **Friction Radar** reads the authorised per-technician usage counts the
  workspaces already record (`workspace_learning_signals`) and turns them into
  aggregate workflow-friction opportunities. It never records arbitrary employee
  activity and never ranks or names an individual: it optimises product workflows,
  not people.
* **Outcome Contract** attaches a machine-checkable statement of the *business
  outcome* to a ticket. The requested outcome is separated from the technician's
  chosen method, and a ticket cannot be closed as resolved on a command's exit
  code alone.
* **Breadcrumb Rescue** preserves a technician's investigation and identifies
  which earlier conclusions the record has moved past since they were formed.

Everything in this module is pure and deterministic so the rules can be tested
directly, exactly like `roadmap_tools.py`. Database access lives in
`app/routers/nexus_flow.py`.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

# ── Friction Radar ───────────────────────────────────────────────────────────

# How the same evidence can describe friction. ``repeated_navigation`` means the
# same concept is reached from more than one workspace; ``concentrated_usage``
# means one workspace's work repeatedly funnels through a single screen.
FRICTION_KINDS: tuple[str, ...] = ("repeated_navigation", "concentrated_usage")

# A target needs at least this many observed repeats before Nexus calls it
# friction at all. Below it, the evidence is a habit, not a workflow problem.
MIN_EVIDENCE_REPEATS = 12

# One avoided repeat is worth this much technician time. Deliberately
# conservative: Nexus reports what it can defend, not a flattering number.
SECONDS_PER_REPEAT = 8

# An estimate is only offered once the observed evidence spans this many days.
MIN_ESTIMATE_WINDOW_DAYS = 7

# A single target holding at least this share of a workspace's repeats is the
# buried-favourite signal: the work is concentrated on one screen.
CONCENTRATION_THRESHOLD = 0.35

SOLUTIONS = {
    "repeated_navigation": "Add one contextual entry point for this concept so it is reached without hopping workspaces.",
    "concentrated_usage": "Promote this screen onto the workspace's primary surface with a one-click contextual action.",
}


# Free text in Flow Intelligence is technician-authored, so a note can
# accidentally contain a secret. These patterns catch the shape of credential
# material in a value; Nexus refuses to store it rather than redacting it.
CREDENTIAL_PATTERNS: tuple[str, ...] = (
    "password=",
    "password:",
    "passwd=",
    "api_key=",
    "apikey=",
    "secret=",
    "token=",
    "client_secret",
    "private_key",
    "-----begin",
    "sk_live_",
    "sk_test_",
    "xoxb-",
    "bearer ",
    "authorization:",
)


def contains_credential_material(text: str) -> bool:
    """True when free text looks like it carries credential material."""
    haystack = str(text or "").strip().lower()
    return any(pattern in haystack for pattern in CREDENTIAL_PATTERNS)


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def friction_estimate(
    observed_repeats: int,
    window_days: int | None,
    *,
    seconds_per_repeat: int = SECONDS_PER_REPEAT,
) -> dict[str, Any]:
    """Turn observed repeats into a disclosed monthly estimate.

    The estimate is unavailable — never invented — when the evidence does not
    span a usable window, because a count with no observing period cannot be
    converted into a rate.
    """
    repeats = int(observed_repeats or 0)
    if repeats <= 0:
        return {
            "estimate_available": False,
            "estimate_reason": "No repeats were observed, so no saving is claimed.",
            "estimated_monthly_repeats": None,
            "estimated_monthly_hours": None,
        }
    if not window_days or int(window_days) < MIN_ESTIMATE_WINDOW_DAYS:
        return {
            "estimate_available": False,
            "estimate_reason": (
                f"Evidence spans fewer than {MIN_ESTIMATE_WINDOW_DAYS} days, so Nexus does not claim a monthly rate."
            ),
            "estimated_monthly_repeats": None,
            "estimated_monthly_hours": None,
        }
    monthly_repeats = round(repeats / int(window_days) * 30)
    hours = round(monthly_repeats * int(seconds_per_repeat) / 3600, 1)
    return {
        "estimate_available": True,
        "estimate_reason": (
            f"{repeats} observed repeat(s) over {int(window_days)} days; "
            f"{int(seconds_per_repeat)}s assumed saved per avoided repeat."
        ),
        "estimated_monthly_repeats": int(monthly_repeats),
        "estimated_monthly_hours": hours,
    }


def friction_window_days(rows: Iterable[dict[str, Any]]) -> int | None:
    """Derive the observing window from the spans of the evidence supplied."""
    stamps = [
        stamp
        for stamp in (_parse_ts(row.get("last_used_at")) for row in rows)
        if stamp is not None
    ]
    if len(stamps) < 2:
        return None
    span = (max(stamps) - min(stamps)).total_seconds() / 86400
    return max(1, int(span))


def friction_opportunities(
    rows: Iterable[dict[str, Any]],
    *,
    min_repeats: int = MIN_EVIDENCE_REPEATS,
    seconds_per_repeat: int = SECONDS_PER_REPEAT,
) -> list[dict[str, Any]]:
    """Derive aggregate friction opportunities from per-workspace usage counts.

    ``rows`` are summed tenant-wide counters (workspace, surface, target, count,
    last_used_at) with no user attribution. Two detections are made, both from
    that evidence alone:

    * the same target slug is repeated across two or more workspaces, and
    * one target carries most of a workspace's repeats.

    Nothing here identifies a technician, a client or a record.
    """
    materialised = [dict(row) for row in rows if row]
    window_days = friction_window_days(materialised)

    by_target: dict[str, dict[str, Any]] = {}
    by_workspace_totals: dict[str, int] = {}
    for row in materialised:
        workspace = str(row.get("workspace") or "").strip().lower()
        target = str(row.get("target") or "").strip().lower()
        count = int(row.get("count") or 0)
        if not workspace or not target or count <= 0:
            continue
        by_workspace_totals[workspace] = by_workspace_totals.get(workspace, 0) + count
        entry = by_target.setdefault(target, {"target": target, "repeats": 0, "workspaces": {}})
        entry["repeats"] += count
        entry["workspaces"][workspace] = entry["workspaces"].get(workspace, 0) + count

    opportunities: list[dict[str, Any]] = []
    for target, entry in by_target.items():
        repeats = int(entry["repeats"])
        if repeats < int(min_repeats):
            continue
        workspaces = entry["workspaces"]

        if len(workspaces) >= 2:
            kind = "repeated_navigation"
            workspace = None
            share = None
        else:
            workspace = next(iter(workspaces))
            share = round(workspaces[workspace] / max(1, by_workspace_totals[workspace]), 3)
            if share < CONCENTRATION_THRESHOLD:
                continue
            kind = "concentrated_usage"

        estimate = friction_estimate(repeats, window_days, seconds_per_repeat=seconds_per_repeat)
        opportunities.append(
            {
                "id": f"{kind}:{workspace or '-'}:{target}",
                "kind": kind,
                "workspace": workspace,
                "target": target,
                "workspaces": sorted(workspaces),
                "workspace_counts": {name: int(value) for name, value in sorted(workspaces.items())},
                "observed_repeats": repeats,
                "share_of_workspace": share,
                "window_days": window_days,
                "proposed_solution": SOLUTIONS[kind],
                **estimate,
            }
        )

    opportunities.sort(
        key=lambda item: (
            item["estimated_monthly_hours"] is None,
            -(item["estimated_monthly_hours"] or 0),
            -item["observed_repeats"],
            item["target"],
        )
    )
    return opportunities


# ── Outcome Contract ─────────────────────────────────────────────────────────

# The contract fields a technician must state before the outcome can be verified.
REQUIRED_CONTRACT_FIELDS: tuple[str, ...] = (
    "outcome",
    "verification_method",
    "rollback",
)

# How an outcome may be verified. A method's own success is not one of them.
VERIFICATION_KINDS: tuple[str, ...] = (
    "automated_test",
    "technician_witnessed",
    "customer_confirmed",
    "monitoring_evidence",
)

# An outcome that is really a command. "Restart the MYOB service" is a method,
# not the thing the customer needs; Nexus refuses to treat it as the outcome.
METHOD_PHRASES: tuple[str, ...] = (
    "restart",
    "reboot",
    "rebuild",
    "re-run",
    "rerun",
    "run the",
    "execute",
    "flush",
    "clear the cache",
    "reinstall",
    "re-index",
    "reindex",
    "gpupdate",
    "net stop",
    "net start",
    "stop the service",
    "start the service",
    "reset the",
)

MIN_VERIFICATION_NOTE_CHARS = 12


def outcome_is_method(outcome: str) -> bool:
    """True when the stated outcome is actually an instruction, not an outcome."""
    text = str(outcome or "").strip().lower()
    return any(phrase in text for phrase in METHOD_PHRASES)


def _check(name: str, passed: bool, detail: str) -> dict[str, Any]:
    return {"name": name, "passed": bool(passed), "detail": detail}


def contract_checks(contract: dict[str, Any]) -> list[dict[str, Any]]:
    """The machine-checkable gates every outcome contract must satisfy."""
    outcome = str(contract.get("outcome") or "").strip()
    checks = [
        _check(
            "business outcome stated",
            bool(outcome),
            "The contract states what the customer must be able to do, not what the technician will run.",
        ),
        _check(
            "outcome is not a method",
            bool(outcome) and not outcome_is_method(outcome),
            "A command or service action is the chosen method, not the outcome the customer needs.",
        ),
        _check(
            "preconditions declared",
            bool(str(contract.get("preconditions") or "").strip()),
            "The state the outcome depends on is written down before the work starts.",
        ),
        _check(
            "verification method declared",
            str(contract.get("verification_method") or "").strip() in VERIFICATION_KINDS,
            f"Verification must be one of: {', '.join(VERIFICATION_KINDS)}.",
        ),
        _check(
            "rollback declared",
            bool(str(contract.get("rollback") or "").strip()),
            "The conditions and path back out are recorded before any change is made.",
        ),
        _check(
            "acceptable interruption declared",
            bool(str(contract.get("acceptable_interruption") or "").strip()),
            "How much disruption the customer accepts is part of the contract.",
        ),
    ]
    return checks


def contract_status(contract: dict[str, Any], *, now: datetime | None = None) -> dict[str, Any]:
    """Compute the current standing of one outcome contract.

    ``insufficient`` means the contract itself cannot support verification, so
    nothing may be claimed as proven. ``expired`` means a verification once
    existed but its evidence has aged out.
    """
    current = now or datetime.now(timezone.utc)
    checks = contract_checks(contract)
    failed = [check for check in checks if not check["passed"]]
    if failed:
        return {
            "status": "insufficient",
            "reason": failed[0]["detail"],
            "checks": checks,
            "verified_at": contract.get("verified_at"),
            "evidence_expires_at": contract.get("evidence_expires_at"),
        }

    verified_at = _parse_ts(contract.get("verified_at"))
    expires_at = _parse_ts(contract.get("evidence_expires_at"))
    if verified_at is None:
        return {
            "status": "unverified",
            "reason": "The contract is complete but no verification evidence has been recorded yet.",
            "checks": checks,
            "verified_at": None,
            "evidence_expires_at": None,
        }
    if expires_at is not None and expires_at <= current:
        return {
            "status": "expired",
            "reason": "The verification evidence has expired and the outcome must be re-verified.",
            "checks": checks,
            "verified_at": verified_at.isoformat(),
            "evidence_expires_at": expires_at.isoformat(),
        }
    return {
        "status": "verified",
        "reason": "The outcome was verified and the evidence is still current.",
        "checks": checks,
        "verified_at": verified_at.isoformat(),
        "evidence_expires_at": expires_at.isoformat() if expires_at else None,
    }


def verification_verdict(
    contract: dict[str, Any],
    *,
    kind: str,
    evidence_note: str,
    evidence_days: int = 14,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Decide whether one piece of verification evidence may be accepted.

    Evidence is refused when the contract is incomplete, the verification kind
    is unknown, or no real note is supplied. Nexus never records a verification
    it cannot show evidence for.
    """
    current = now or datetime.now(timezone.utc)
    status = contract_status(contract, now=current)
    if status["status"] == "insufficient":
        return {"accepted": False, "reason": status["reason"], "status": status["status"]}
    if kind not in VERIFICATION_KINDS:
        return {
            "accepted": False,
            "reason": f"Verification kind must be one of: {', '.join(VERIFICATION_KINDS)}.",
            "status": status["status"],
        }
    note = str(evidence_note or "").strip()
    if len(note) < MIN_VERIFICATION_NOTE_CHARS:
        return {
            "accepted": False,
            "reason": "Verification evidence must describe what was observed, not just that something was done.",
            "status": status["status"],
        }
    if not 1 <= int(evidence_days) <= 365:
        return {"accepted": False, "reason": "Evidence validity must be between 1 and 365 days.", "status": status["status"]}
    expires_at = current + timedelta(days=int(evidence_days))
    return {
        "accepted": True,
        "reason": f"Outcome verified by {kind.replace('_', ' ')}; evidence expires {expires_at.date().isoformat()}.",
        "status": "verified",
        "verified_at": current.isoformat(),
        "evidence_expires_at": expires_at.isoformat(),
        "verification_kind": kind,
        "evidence_note": note,
    }


def closeout_gate(contract: dict[str, Any] | None, *, now: datetime | None = None) -> dict[str, Any]:
    """Whether a ticket may be closed claiming this outcome is resolved."""
    if not contract:
        return {
            "allowed": True,
            "status": "no_contract",
            "reason": "This ticket carries no outcome contract, so no verified-outcome claim is made.",
        }
    status = contract_status(contract, now=now)
    if status["status"] == "verified":
        return {"allowed": True, "status": "verified", "reason": status["reason"]}
    return {
        "allowed": False,
        "status": status["status"],
        "reason": status["reason"],
    }


# ── Breadcrumb Rescue ────────────────────────────────────────────────────────

# What a breadcrumb can record. This is the technician's reasoning, not a log.
BREADCRUMB_KINDS: tuple[str, ...] = (
    "hypothesis",
    "tested",
    "ruled_out",
    "finding",
    "next_step",
    "change",
)

# Conclusions Nexus starts treating as age-stale even without recorded changes.
STALE_AFTER_HOURS = 24

_CONCLUSION_KINDS = ("tested", "ruled_out", "finding")


def breadcrumb_resume(
    breadcrumbs: Iterable[dict[str, Any]],
    *,
    changes: Iterable[dict[str, Any]] = (),
    now: datetime | None = None,
    stale_after_hours: int = STALE_AFTER_HOURS,
) -> dict[str, Any]:
    """Reconstruct an investigation and flag the conclusions that may be stale.

    ``changes`` are records of what moved since the technician left (a device or
    client-scoped change with ``scope_ref`` and ``at``). A conclusion is
    ``possibly_stale`` when a change landed after it was formed on the same
    scope, and ``age_stale`` when no change evidence was supplied at all and the
    conclusion is older than the freshness window. Nexus never silently trusts
    an old conclusion.
    """
    current = now or datetime.now(timezone.utc)
    ordered = sorted(
        (dict(row) for row in breadcrumbs),
        key=lambda row: (_parse_ts(row.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc)),
    )
    change_rows = [dict(change) for change in changes]

    ruled_out = [str(row.get("text") or "") for row in ordered if row.get("kind") == "ruled_out"]
    findings = [str(row.get("text") or "") for row in ordered if row.get("kind") == "finding"]
    verdicts = [str(row.get("text") or "") for row in ordered if row.get("kind") == "ruled_out"]
    tests = [str(row.get("text") or "") for row in ordered if row.get("kind") == "tested"]
    next_steps = [str(row.get("text") or "") for row in ordered if row.get("kind") == "next_step"]

    # A hypothesis is still open while no later finding or ruled-out step has
    # resolved it on the same scope. Nexus keeps asking rather than assuming.
    open_hypotheses = _open_hypotheses(ordered)

    stale: list[dict[str, Any]] = []
    for row in ordered:
        if row.get("kind") not in _CONCLUSION_KINDS:
            continue
        formed_at = _parse_ts(row.get("created_at"))
        if formed_at is None:
            continue
        scope_ref = row.get("scope_ref")
        moved = [
            change
            for change in change_rows
            if (_parse_ts(change.get("at")) or current) > formed_at
            and (scope_ref is None or change.get("scope_ref") in (None, scope_ref))
        ]
        if moved:
            change = sorted(moved, key=lambda item: str(item.get("at") or ""))[-1]
            stale.append(
                {
                    "text": str(row.get("text") or ""),
                    "kind": row.get("kind"),
                    "formed_at": formed_at.isoformat(),
                    "reason": "possibly_stale",
                    "detail": (
                        f"{str(change.get('summary') or 'A change')} landed on this scope after this conclusion "
                        f"was formed ({str(change.get('at') or '')}), so it may no longer hold."
                    ),
                    "change": {
                        "scope_ref": change.get("scope_ref"),
                        "at": change.get("at"),
                        "summary": change.get("summary"),
                    },
                }
            )
        elif (current - formed_at) > timedelta(hours=int(stale_after_hours)):
            stale.append(
                {
                    "text": str(row.get("text") or ""),
                    "kind": row.get("kind"),
                    "formed_at": formed_at.isoformat(),
                    "reason": "age_stale",
                    "detail": (
                        "No change evidence was supplied and this conclusion is older than the freshness window; "
                        "re-check the record before relying on it."
                    ),
                    "change": None,
                }
            )

    last_test = tests[-1] if tests else None
    return {
        "resume": {
            "testing": last_test,
            "ruled_out": ruled_out,
            "findings": findings,
            "verdicts": verdicts,
            "open_hypotheses": open_hypotheses,
            "next_step": next_steps[-1] if next_steps else None,
            "resume_from": ordered[-1].get("created_at") if ordered else None,
        },
        "stale": stale,
        "stale_count": len(stale),
        "line": _resume_line(last_test, ruled_out, next_steps[-1] if next_steps else None, len(stale)),
    }


# ── Dead End Detector ────────────────────────────────────────────────────────

# An investigation is only called stalled once Nexus has real evidence that it
# stopped reducing uncertainty: two repeated diagnostics, or three tests since
# the last conclusion, inside a window long enough to be a session rather than a
# pause between two clicks.
STALL_AFTER_MINUTES = 30
MIN_BREADCRUMBS_FOR_VERDICT = 3
REPEATED_TESTS_FOR_STALL = 2
TESTS_SINCE_CONCLUSION_FOR_RISK = 3

_TEST_NORMALISE = re.compile(r"[^a-z0-9 ]+")


def _normalise_test(text: str) -> str:
    """Reduce a test description to the shape that decides whether it repeats."""
    lowered = str(text or "").strip().lower()
    return " ".join(_TEST_NORMALISE.sub(" ", lowered).split())


def investigation_health(
    breadcrumbs: Iterable[dict[str, Any]],
    *,
    now: datetime | None = None,
    stall_after_minutes: int = STALL_AFTER_MINUTES,
) -> dict[str, Any]:
    """Decide whether an investigation is still reducing uncertainty.

    This is the Dead End Detector: a troubleshooting system that notices when the
    *investigation* is going wrong, not just when the endpoint is broken. It is
    deliberately advisory — Nexus reports the evidence and a suggested next test
    and never stops the technician, guesses the diagnosis, or claims the work is
    wasted.
    """
    current = now or datetime.now(timezone.utc)
    ordered = sorted(
        (dict(row) for row in breadcrumbs),
        key=lambda row: (_parse_ts(row.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc)),
    )
    if len(ordered) < MIN_BREADCRUMBS_FOR_VERDICT:
        return {
            "verdict": "insufficient_evidence",
            "reason": "Not enough recorded steps for Nexus to say anything about the investigation itself.",
            "repeated_tests": 0,
            "tests_since_conclusion": 0,
            "unverified_assumptions": [],
            "scopes_tested": [],
            "evidence_source_converged": False,
            "minutes_investigating": _minutes_between(ordered, current),
            "recommended_test": None,
            "boundary": DEAD_END_BOUNDARY,
        }

    seen_tests: dict[str, int] = {}
    repeated_tests = 0
    last_conclusion_index = -1
    for index, row in enumerate(ordered):
        kind = row.get("kind")
        if kind in {"ruled_out", "finding", "change"}:
            last_conclusion_index = index
        if kind == "tested":
            signature = _normalise_test(row.get("text"))
            if not signature:
                continue
            seen_tests[signature] = seen_tests.get(signature, 0) + 1
            if seen_tests[signature] > 1:
                repeated_tests += 1

    tests_since_conclusion = sum(
        1 for row in ordered[last_conclusion_index + 1:] if row.get("kind") == "tested"
    )
    assumptions = _open_hypotheses(ordered)
    scopes = sorted(
        {str(row.get("scope_ref")) for row in ordered if row.get("kind") == "tested" and row.get("scope_ref")}
    )
    minutes = _minutes_between(ordered, current)
    # "Converged" means every test came from the same place: one evidence source
    # cannot settle a question it is itself part of.
    converged = len(scopes) == 1 and len(seen_tests) >= 1

    if repeated_tests >= REPEATED_TESTS_FOR_STALL and minutes >= int(stall_after_minutes):
        verdict = "stalled"
        reason = (
            f"{repeated_tests} diagnostic(s) repeated without new evidence after "
            f"{minutes} minutes of investigation."
        )
    elif (
        repeated_tests >= 1
        or tests_since_conclusion >= TESTS_SINCE_CONCLUSION_FOR_RISK
        or (converged and len(assumptions) >= 1)
    ):
        verdict = "at_risk"
        reason = (
            "Progress has slowed: the evidence is coming from the same source and a conclusion has not moved."
        )
    else:
        verdict = "progressing"
        reason = "The investigation is still producing new evidence."

    return {
        "verdict": verdict,
        "reason": reason,
        "repeated_tests": repeated_tests,
        "tests_since_conclusion": tests_since_conclusion,
        "distinct_tests": len(seen_tests),
        "unverified_assumptions": assumptions,
        "scopes_tested": scopes,
        "evidence_source_converged": converged,
        "minutes_investigating": minutes,
        "recommended_test": _recommended_test(verdict, converged, assumptions, scopes),
        "boundary": DEAD_END_BOUNDARY,
    }


DEAD_END_BOUNDARY = (
    "Nexus reports that the investigation is not reducing uncertainty and suggests one different test. "
    "It does not decide the diagnosis, stop the technician or claim the work so far was wasted."
)


def _minutes_between(ordered: list[dict[str, Any]], current: datetime) -> int:
    stamps = [stamp for stamp in (_parse_ts(row.get("created_at")) for row in ordered) if stamp is not None]
    if not stamps:
        return 0
    return max(0, int((current - min(stamps)).total_seconds() // 60))


def _open_hypotheses(ordered: list[dict[str, Any]]) -> list[str]:
    open_items: list[str] = []
    for index, row in enumerate(ordered):
        if row.get("kind") != "hypothesis":
            continue
        scope_ref = row.get("scope_ref")
        resolved = any(
            later.get("kind") in {"ruled_out", "finding"}
            and (scope_ref is None or later.get("scope_ref") in (None, scope_ref))
            for later in ordered[index + 1:]
        )
        if not resolved:
            open_items.append(str(row.get("text") or ""))
    return open_items


def _recommended_test(
    verdict: str,
    converged: bool,
    assumptions: list[str],
    scopes: list[str],
) -> str:
    """One different next test — the point of the detector is to change the input."""
    if verdict == "progressing":
        return "Keep going: the current approach is still producing new evidence."
    if converged:
        return (
            "Change the evidence source: repeat the same test from a known-good device or an "
            f"independent path rather than from {scopes[0]} again."
        )
    if assumptions:
        return f"Test the remaining assumption directly instead of repeating a diagnostic: {assumptions[0]}"
    return "Write down what would disprove the leading hypothesis, then run the test that would show it."


def _resume_line(
    testing: str | None,
    ruled_out: list[str],
    next_step: str | None,
    stale_count: int,
) -> str:
    parts: list[str] = []
    if testing:
        parts.append(f"You were testing: {testing}.")
    if ruled_out:
        parts.append(f"Already ruled out: {'; '.join(ruled_out[:3])}.")
    if next_step:
        parts.append(f"Next: {next_step}.")
    if stale_count:
        parts.append(f"{stale_count} earlier conclusion(s) need re-checking before you rely on them.")
    return " ".join(parts) or "No breadcrumbs were recorded for this investigation yet."
