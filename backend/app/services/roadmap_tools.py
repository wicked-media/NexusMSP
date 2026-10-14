"""Merged roadmap-tool policy for existing Nexus workspaces.

The four next roadmap features — Nexus Access, Nexus Application Manager,
Nexus Configuration as Code and Nexus Test Environment — are delivered as tools
inside the workspaces that already own their problem space (Nexus Elevate, the
Application Manager, Expected State and the Proving Ground). This module holds
the pure decision policy those tools share: credential-material refusal,
rotation scheduling, staged rollout gates, standards-revision impact, and the
deterministic pre-rollout bench verdict. Nothing here touches the database so
every rule is directly testable.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

# Nexus records rotation *boundaries* and evidence — never credential material.
SENSITIVE_KEY_FRAGMENTS: tuple[str, ...] = (
    "password", "passphrase", "secret", "token", "credential",
    "api_key", "apikey", "private_key", "connection_string",
)

# Staged rollout progression for an application lifecycle plan.
RING_ORDER: tuple[str, ...] = ("test", "canary", "pilot", "broad")

# Candidate kinds the pre-rollout bench can simulate before broad rollout.
BENCH_KINDS: tuple[str, ...] = (
    "script", "package", "policy", "automation", "agent_update", "connector",
)


def find_sensitive_keys(payload: dict[str, Any], *, _depth: int = 2) -> list[str]:
    """Return offending key names if a payload looks like credential material."""
    found: list[str] = []
    for key, value in payload.items():
        normalised = str(key).strip().lower().replace("-", "_")
        if any(fragment in normalised for fragment in SENSITIVE_KEY_FRAGMENTS):
            found.append(str(key))
        elif isinstance(value, dict) and _depth > 0:
            found.extend(find_sensitive_keys(value, _depth=_depth - 1))
    return sorted(set(found))


def rotation_schedule(
    last_rotated_at: str | None,
    interval_days: int,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Compute the next rotation due point for one credential-rotation boundary."""
    if not 1 <= int(interval_days) <= 365:
        raise ValueError("Rotation interval must be between 1 and 365 days")
    current = now or datetime.now(timezone.utc)
    if not last_rotated_at:
        return {
            "last_rotated_at": None,
            "next_due_at": current.isoformat(),
            "due": True,
            "overdue": False,
            "days_remaining": 0,
        }
    last = datetime.fromisoformat(str(last_rotated_at))
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    next_due = last + timedelta(days=int(interval_days))
    due = current >= next_due
    overdue = current >= next_due + timedelta(days=7)
    return {
        "last_rotated_at": last.isoformat(),
        "next_due_at": next_due.isoformat(),
        "due": due,
        "overdue": overdue,
        "days_remaining": max(0, (next_due - current).days),
    }


def promotion_gate(existing_rings: list[dict[str, Any]], next_kind: str) -> dict[str, Any]:
    """Decide whether a lifecycle plan may advance to the next rollout ring.

    A ring may only be created when every earlier ring in the progression has
    recorded verification evidence. This is the staged-deployment gate: nothing
    reaches a wider ring while a narrower one is unproven.
    """
    if next_kind not in RING_ORDER:
        return {"allowed": False, "reason": f"Unknown rollout ring {next_kind!r}"}
    verified = {
        str(ring.get("kind") or "")
        for ring in existing_rings
        if str(ring.get("status") or "") in {"verified", "completed"}
    }
    position = RING_ORDER.index(next_kind)
    for earlier in RING_ORDER[:position]:
        if earlier not in verified:
            return {
                "allowed": False,
                "reason": f"The {earlier} ring must record verification evidence before {next_kind} begins.",
            }
    return {"allowed": True, "reason": f"All earlier rings are verified; {next_kind} may begin."}


def revision_impact(
    current_controls: list[dict[str, Any]],
    proposed_controls: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compare two standards revisions by control reference and requirement text."""
    current = {str(control.get("ref") or ""): str(control.get("requirement") or "") for control in current_controls}
    proposed = {str(control.get("ref") or ""): str(control.get("requirement") or "") for control in proposed_controls}
    added = sorted(ref for ref in proposed if ref not in current)
    removed = sorted(ref for ref in current if ref not in proposed)
    changed = sorted(ref for ref in current if ref in proposed and current[ref] != proposed[ref])
    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "impacted_controls": sorted(set(added) | set(removed) | set(changed)),
        "unchanged": len([ref for ref in current if ref in proposed and current[ref] == proposed[ref]]),
    }


def _check(name: str, passed: bool, detail: str) -> dict[str, Any]:
    return {"name": name, "passed": bool(passed), "detail": detail}


def bench_verdict(kind: str, candidate: dict[str, Any]) -> dict[str, Any]:
    """Compute a deterministic pre-rollout simulation verdict for one candidate.

    The bench never executes on endpoints. It proves the declared candidate
    metadata satisfies the checks that make a representative non-production
    simulation meaningful for that kind, so a technician sees exactly which
    gate is missing before broad rollout.
    """
    if kind not in BENCH_KINDS:
        raise ValueError(f"Unsupported bench candidate kind {kind!r}")
    data = dict(candidate or {})
    checks: list[dict[str, Any]] = []

    checks.append(_check(
        "named candidate",
        bool(str(data.get("name") or "").strip()),
        "The candidate carries a clear operator-facing name.",
    ))
    checks.append(_check(
        "representative scope",
        bool(str(data.get("representative_scope") or "").strip()),
        "A representative non-production scope is declared for the simulation.",
    ))

    if kind == "script":
        fingerprint = str(data.get("sha256") or "").strip().lower()
        checks.append(_check(
            "script fingerprint",
            len(fingerprint) == 64 and all(ch in "0123456789abcdef" for ch in fingerprint),
            "The script declares a 64-character SHA-256 fingerprint.",
        ))
        checks.append(_check(
            "dry run declared",
            bool(data.get("dry_run")),
            "The script can be dry-run without changing managed endpoints.",
        ))
    elif kind == "package":
        checks.append(_check(
            "publisher evidence",
            bool(str(data.get("publisher") or "").strip()),
            "The package declares its publisher for provenance evidence.",
        ))
        checks.append(_check(
            "install checksum",
            bool(str(data.get("checksum") or "").strip()),
            "The package install payload carries a checksum to verify after staging.",
        ))
    elif kind == "policy":
        checks.append(_check(
            "monitor-only first",
            data.get("enforcement") == "monitor",
            "The policy simulates in monitor mode before any enforcement change.",
        ))
        checks.append(_check(
            "impact measured",
            data.get("impacted_count") is not None and int(data.get("impacted_count") or 0) >= 0,
            "The policy simulation reports how many records it would change.",
        ))
    elif kind == "automation":
        checks.append(_check(
            "recent simulation",
            bool(str(data.get("last_simulation_at") or "").strip()),
            "The automation has a retained simulation run to compare against.",
        ))
        checks.append(_check(
            "test cases present",
            int(data.get("test_count") or 0) >= 1,
            "The automation ships at least one explicit test case.",
        ))
    elif kind == "agent_update":
        checks.append(_check(
            "staged ring plan",
            bool(str(data.get("ring_plan") or "").strip()),
            "The agent update declares its staged ring plan before rollout.",
        ))
        checks.append(_check(
            "minimum version floor",
            bool(str(data.get("min_version") or "").strip()),
            "The update declares the minimum supported agent version.",
        ))
    elif kind == "connector":
        checks.append(_check(
            "sandbox tested",
            bool(data.get("sandbox_tested")),
            "The connector passed a sandbox test before touching live data.",
        ))
        sensitive = find_sensitive_keys(data)
        checks.append(_check(
            "no credential material",
            not sensitive,
            "The candidate carries references only; no credential material is accepted.",
        ))

    passed = sum(1 for check in checks if check["passed"])
    verdict = "pass" if passed == len(checks) else ("needs_review" if passed >= len(checks) - 1 else "fail")
    return {
        "kind": kind,
        "verdict": verdict,
        "checks": checks,
        "checks_passed": passed,
        "checks_total": len(checks),
    }
