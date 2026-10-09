"""Nexus Guardian — the adaptive security operations core.

Guardian is the Nexus-branded managed detection layer: Windows Defender and
Nexus Agent evidence in, explainable triage out. Its scoring functions are pure
so the adaptive behaviour can be tested directly: every queue position carries
the reason it earned its rank, and technician feedback adjusts future ranking
without ever hiding the underlying evidence.
"""

from datetime import datetime, timezone
from typing import Any

SEVERITY_BASE = {"critical": 90, "high": 70, "medium": 45, "low": 20, "informational": 5}

# Signals that raise confidence an alert is a true positive.
CORROBORATING_FACTORS = {
    "defender_realtime": 8,
    "multiple_detections": 12,
    "persistence_mechanism": 15,
    "credential_access": 15,
    "lateral_movement": 12,
    "unsigned_binary": 6,
    "newly_observed_path": 5,
}

# Signals that lower confidence (noise patterns learned from triage).
NOISE_FACTORS = {
    "scheduled_scanner": -10,
    "known_admin_tool": -8,
    "repeat_identical": -6,
    "lab_or_test_device": -12,
}


def clamp(value: float, low: int = 0, high: int = 100) -> int:
    return int(max(low, min(high, value)))


def score_alert(alert: dict[str, Any], feedback_profile: dict[str, Any] | None = None) -> dict[str, Any]:
    """Explainable 0-100 triage score for one alert.

    ``feedback_profile`` carries adaptive weights learned from technician
    dispositions (see ``learn_from_feedback``). Every adjustment is echoed in
    ``reasons`` so the ranking is never a black box.
    """
    severity = str(alert.get("severity") or "medium").lower()
    score = SEVERITY_BASE.get(severity, SEVERITY_BASE["medium"])
    reasons: list[str] = [f"base severity {severity} ({score})"]

    factors = set(alert.get("factors") or [])
    for factor, delta in CORROBORATING_FACTORS.items():
        if factor in factors:
            score += delta
            reasons.append(f"{factor} (+{delta})")
    for factor, delta in NOISE_FACTORS.items():
        if factor in factors:
            score += delta
            reasons.append(f"{factor} ({delta})")

    profile = feedback_profile or {}
    signal = str(alert.get("signal") or "")
    adaptive = profile.get("signal_weights", {}).get(signal, 0)
    if adaptive:
        score += adaptive
        reasons.append(f"learned weight for {signal} ({adaptive:+d})")

    if alert.get("asset_criticality") == "critical":
        score = clamp(score + 10)
        reasons.append("critical asset (+10)")

    age_hours = alert.get("age_hours")
    if isinstance(age_hours, (int, float)) and age_hours > 72:
        score = clamp(score - 10)
        reasons.append(f"aging alert ({int(age_hours)}h) (-10)")

    return {"alert_id": alert.get("id"), "score": clamp(score), "reasons": reasons}


def rank_queue(alerts: list[dict[str, Any]], feedback_profile: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Score and order alerts for the triage queue, highest priority first."""
    scored = [score_alert(alert, feedback_profile) for alert in alerts]
    by_id = {item["alert_id"]: item for item in scored}
    ranked = sorted(
        alerts,
        key=lambda a: (-by_id[a.get("id")]["score"], str(a.get("created_at") or "")),
    )
    return [
        {**alert, "triage": by_id[alert.get("id")]}
        for alert in ranked
    ]


def learn_from_feedback(feedback_profile: dict[str, Any], signal: str, disposition: str) -> dict[str, Any]:
    """Adapt signal weights from a technician disposition.

    True positives strengthen a signal's weight; false positives weaken it.
    Weights are bounded to +/-25 so learning can never bury or manufacture a
    severity, and the profile records its own evidence (counts per disposition).
    """
    profile = dict(feedback_profile or {})
    weights = dict(profile.get("signal_weights") or {})
    counts = dict(profile.get("disposition_counts") or {})
    per_signal = dict(counts.get(signal) or {"true_positive": 0, "false_positive": 0, "accepted_risk": 0})

    delta = {"true_positive": 3, "false_positive": -4, "accepted_risk": -2}.get(disposition)
    if delta is None:
        raise ValueError(f"unknown disposition: {disposition}")

    per_signal[disposition] = per_signal.get(disposition, 0) + 1
    counts[signal] = per_signal
    weights[signal] = clamp(weights.get(signal, 0) + delta, -25, 25)

    profile["signal_weights"] = weights
    profile["disposition_counts"] = counts
    profile["updated_at"] = datetime.now(timezone.utc).isoformat()
    return profile


def suggestion_for(signal: str, per_signal: dict[str, Any]) -> str | None:
    """Bounded, explainable tuning suggestion from disposition history."""
    false_positives = per_signal.get("false_positive", 0)
    true_positives = per_signal.get("true_positive", 0)
    total = false_positives + true_positives + per_signal.get("accepted_risk", 0)
    if total < 3:
        return None
    if false_positives / total >= 0.7:
        return (
            f"{false_positives} of {total} '{signal}' alerts were closed as false positives — "
            f"consider a suppression rule or narrowing the detection."
        )
    if true_positives / total >= 0.7:
        return (
            f"'{signal}' is proving actionable ({true_positives}/{total} true positives) — "
            f"consider raising its priority or auto-ticketing it."
        )
    return None


def adaptive_suggestions(feedback_profile: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Explainable tuning suggestions derived from the technician's own history."""
    profile = feedback_profile or {}
    suggestions: list[dict[str, Any]] = []
    for signal, per_signal in (profile.get("disposition_counts") or {}).items():
        text = suggestion_for(signal, per_signal if isinstance(per_signal, dict) else {})
        if text:
            suggestions.append({"id": f"tune-{signal}", "signal": signal, "text": text})
    return suggestions


def defender_posture(devices: list[dict[str, Any]]) -> dict[str, Any]:
    """Evidence-backed Defender posture. 'not assessed' is never scored as healthy."""
    enrolled = [d for d in devices if d.get("nexus_agent_id")]
    assessed = [d for d in enrolled if d.get("defender_status") is not None]
    protected = [d for d in assessed if str(d.get("defender_status")).lower() in {"protected", "active", "healthy"}]
    signature_stale = [
        d for d in assessed
        if isinstance(d.get("defender_signature_age_days"), (int, float)) and d["defender_signature_age_days"] > 3
    ]
    realtime_off = [d for d in assessed if d.get("defender_realtime") is False]
    return {
        "assessed": len(assessed),
        "not_assessed": len(enrolled) - len(assessed),
        "protected": len(protected),
        "signature_stale": [{"device_id": d.get("id"), "age_days": d.get("defender_signature_age_days")} for d in signature_stale],
        "realtime_disabled": [d.get("id") for d in realtime_off],
        "coverage_pct": round(len(protected) / len(assessed) * 100) if assessed else None,
    }
