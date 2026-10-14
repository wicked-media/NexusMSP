"""Certificate & Domain Intelligence — evidence model for roadmap #489/#493.

Unifies domain, certificate, registrar, DNS and expiry evidence around the
canonical client record, and relates externally visible exposure to the
accountable response path. Pure functions only: scoring and classification are
deterministic and testable, and every risk verdict carries its reasons so the
workspace can explain itself.

Evidence boundary: this module scores records Nexus already holds. It never
claims a scan happened, never invents expiry dates, and keeps "unknown"
distinct from "safe".
"""

from datetime import datetime, timezone
from typing import Any

RISK_THRESHOLDS = [
    (0, "expired"),
    (7, "critical"),
    (30, "high"),
    (60, "medium"),
    (90, "low"),
]

DANGEROUS_CHANGE_KINDS = {
    "nameserver_change": "Nameserver change — the whole zone can be redirected.",
    "registrar_transfer": "Registrar transfer — domain control may have moved.",
    "mx_change": "Mail exchanger change — inbound mail can be redirected.",
    "caa_change": "CAA change — certificate issuance policy altered.",
    "dangling_cname": "Dangling CNAME — a takeover target may exist.",
}


def parse_timestamp(value: Any) -> datetime | None:
    """Tolerant timestamp parse; None when absent or malformed."""
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def days_until(value: Any, now: datetime | None = None) -> int | None:
    """Whole days until a timestamp; None when the timestamp is unknown."""
    moment = parse_timestamp(value)
    if not moment:
        return None
    reference = now or datetime.now(timezone.utc)
    return (moment - reference).days


def expiry_risk(expires_at: Any, now: datetime | None = None) -> dict[str, Any]:
    """Explainable expiry risk. Unknown expiry is 'unknown', never 'safe'."""
    remaining = days_until(expires_at, now)
    if remaining is None:
        return {"level": "unknown", "days_remaining": None, "reasons": ["no expiry evidence recorded"]}
    for threshold, level in RISK_THRESHOLDS:
        if remaining <= threshold:
            verb = "already expired" if remaining < 0 else f"{remaining} day(s) remaining"
            return {"level": level, "days_remaining": remaining, "reasons": [f"{verb} (threshold {threshold})"]}
    return {"level": "ok", "days_remaining": remaining, "reasons": [f"{remaining} days remaining"]}


def classify_change(change_kind: str) -> dict[str, Any] | None:
    """Map a DNS/registration change to its danger explanation, or None."""
    description = DANGEROUS_CHANGE_KINDS.get(change_kind)
    if not description:
        return None
    return {"kind": change_kind, "dangerous": True, "explanation": description}


def exposure_score(records: list[dict[str, Any]], now: datetime | None = None) -> dict[str, Any]:
    """Aggregate portfolio risk across certificates and domains.

    Counts each risk band, lists the soonest expiries first, and flags any
    dangerous change awaiting review. Unknowns are reported as their own band.
    """
    bands: dict[str, int] = {"expired": 0, "critical": 0, "high": 0, "medium": 0, "low": 0, "ok": 0, "unknown": 0}
    soonest: list[dict[str, Any]] = []
    unreviewed_changes: list[dict[str, Any]] = []

    for record in records:
        risk = expiry_risk(record.get("expires_at"), now)
        bands[risk["level"]] = bands.get(risk["level"], 0) + 1
        if risk["days_remaining"] is not None:
            soonest.append({
                "id": record.get("id"),
                "name": record.get("name"),
                "client_id": record.get("client_id"),
                "days_remaining": risk["days_remaining"],
                "risk": risk["level"],
            })
        for change in record.get("changes") or []:
            classified = classify_change(change.get("kind", ""))
            if classified and not change.get("reviewed"):
                unreviewed_changes.append({
                    "record_id": record.get("id"),
                    "name": record.get("name"),
                    "client_id": record.get("client_id"),
                    **classified,
                    "observed_at": change.get("observed_at"),
                })

    soonest.sort(key=lambda item: item["days_remaining"])
    return {
        "counts": bands,
        "total": len(records),
        "soonest_expiries": soonest[:10],
        "unreviewed_dangerous_changes": unreviewed_changes,
    }
