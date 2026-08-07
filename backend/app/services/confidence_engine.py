"""Evidence-based confidence profiles for canonical Nexus objects.

Confidence is deliberately separate from health. Health answers whether an
object appears operational right now. Confidence answers whether the evidence
behind that judgement is complete, current, attributable and conflict-free.

Manual verification is retained as an attestation, but never hides missing or
stale source evidence and never increases the calculated score.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable


CONFIDENCE_SCHEMA_VERSION = 1


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def newest_timestamp(values: Iterable[Any]) -> datetime | None:
    parsed = [item for value in values if (item := parse_timestamp(value))]
    return max(parsed) if parsed else None


def freshness_score(
    observed_at: Any,
    *,
    now: datetime | None = None,
    fresh_days: int = 7,
    stale_days: int = 90,
) -> int:
    """Return a transparent freshness score without assuming missing dates."""
    observed = parse_timestamp(observed_at)
    if not observed:
        return 0
    now = now or utc_now()
    age_days = max(0.0, (now - observed).total_seconds() / 86400)
    if age_days <= fresh_days:
        return 100
    if age_days >= stale_days:
        return 0
    remaining = 1 - ((age_days - fresh_days) / max(1, stale_days - fresh_days))
    return round(remaining * 100)


def evidence_gap(
    key: str,
    label: str,
    *,
    severity: str = "medium",
    route: str | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "severity": severity,
        "route": route,
    }


def confidence_dimension(
    key: str,
    label: str,
    *,
    weight: int,
    checks: Iterable[tuple[str, bool]],
    sources: Iterable[str],
    evidence_count: int = 0,
    observed_at: Any = None,
    fresh_days: int = 30,
    stale_days: int = 180,
    gaps: Iterable[dict[str, Any]] = (),
    detail: str = "",
    now: datetime | None = None,
) -> dict[str, Any]:
    """Score one explainable dimension from declared checks and freshness."""
    declared_checks = [
        {"label": str(check_label), "observed": bool(observed)}
        for check_label, observed in checks
    ]
    completeness = (
        round(sum(1 for check in declared_checks if check["observed"]) / len(declared_checks) * 100)
        if declared_checks
        else 0
    )
    observed = parse_timestamp(observed_at)
    freshness = (
        freshness_score(
            observed,
            now=now,
            fresh_days=fresh_days,
            stale_days=stale_days,
        )
        if observed
        else None
    )
    score = completeness if freshness is None else round(completeness * 0.72 + freshness * 0.28)
    declared_gaps = list(gaps)
    if not declared_gaps:
        declared_gaps = [
            evidence_gap(
                f"{key}.{index}",
                f"Verify {check['label'].lower()}.",
            )
            for index, check in enumerate(declared_checks)
            if not check["observed"]
        ]
    return {
        "key": key,
        "label": label,
        "weight": int(weight),
        "score": max(0, min(100, score)),
        "completeness": completeness,
        "freshness": freshness,
        "evidence_count": max(0, int(evidence_count or 0)),
        "observed_at": observed.isoformat() if observed else None,
        "sources": sorted({str(source) for source in sources if str(source).strip()}),
        "checks": declared_checks,
        "gaps": declared_gaps,
        "detail": detail,
    }


def confidence_label(score: int, *, evidence_available: bool) -> tuple[str, str]:
    if not evidence_available:
        return "Unavailable", "unavailable"
    if score >= 90:
        return "Verified", "verified"
    if score >= 75:
        return "Strong", "strong"
    if score >= 50:
        return "Review", "review"
    return "Low confidence", "low"


def build_confidence_profile(
    *,
    entity_type: str,
    entity_id: str,
    entity_label: str,
    dimensions: Iterable[dict[str, Any]],
    conflicts: Iterable[dict[str, Any]] = (),
    verification: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Combine dimensions into a scored, explainable confidence profile."""
    now = now or utc_now()
    declared_dimensions = list(dimensions)
    declared_conflicts = list(conflicts)
    total_weight = sum(max(0, int(item.get("weight") or 0)) for item in declared_dimensions)
    evidence_available = any(
        item.get("evidence_count")
        or any(check.get("observed") for check in item.get("checks", []))
        for item in declared_dimensions
    )
    raw_score = (
        round(
            sum(
                int(item.get("score") or 0) * max(0, int(item.get("weight") or 0))
                for item in declared_dimensions
            )
            / total_weight
        )
        if total_weight and evidence_available
        else 0
    )
    conflict_penalty = min(
        30,
        sum(
            12 if conflict.get("severity") == "critical"
            else 8 if conflict.get("severity") == "high"
            else 4
            for conflict in declared_conflicts
        ),
    )
    score = max(0, raw_score - conflict_penalty)
    label, state = confidence_label(score, evidence_available=evidence_available)

    latest_evidence = newest_timestamp(
        item.get("observed_at") for item in declared_dimensions
    )
    verification = verification or None
    verification_expires = parse_timestamp((verification or {}).get("expires_at"))
    attestation_current = bool(
        verification
        and verification_expires
        and verification_expires >= now
    )
    ordered_gaps = sorted(
        [
            {
                **gap,
                "dimension": item["label"],
                "dimension_key": item["key"],
            }
            for item in declared_dimensions
            for gap in item.get("gaps", [])
        ],
        key=lambda gap: (
            {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(gap.get("severity"), 4),
            gap.get("label") or "",
        ),
    )

    return {
        "schema_version": CONFIDENCE_SCHEMA_VERSION,
        "entity": {
            "type": entity_type,
            "id": entity_id,
            "label": entity_label,
        },
        "score": score,
        "raw_score": raw_score,
        "conflict_penalty": conflict_penalty,
        "label": label,
        "state": state,
        "evidence_available": evidence_available,
        "evidence_count": sum(int(item.get("evidence_count") or 0) for item in declared_dimensions),
        "last_observed_at": latest_evidence.isoformat() if latest_evidence else None,
        "assessed_at": now.isoformat(),
        "dimensions": declared_dimensions,
        "conflicts": declared_conflicts,
        "gaps": ordered_gaps,
        "next_actions": ordered_gaps[:5],
        "attestation": {
            "current": attestation_current,
            "verified_at": (verification or {}).get("verified_at"),
            "expires_at": (verification or {}).get("expires_at"),
            "verified_by": (verification or {}).get("verified_by"),
            "note": (verification or {}).get("note"),
            "does_not_override_gaps": True,
        },
        "method": (
            "Confidence measures completeness, freshness, attribution and conflicts in recorded "
            "Nexus evidence. Manual verification is shown separately and never conceals a gap."
        ),
    }
