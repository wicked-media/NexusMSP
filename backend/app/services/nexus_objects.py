"""Universal object story read model for Nexus Core.

The profile is deliberately conservative: it reports observed state and the
evidence available for that state. It does not turn missing evidence into a
positive health claim or infer business impact that has not been recorded.
"""

from __future__ import annotations

from typing import Any, Iterable


ATTENTION_STATES = {
    "attention", "at_risk", "blocked", "critical", "disabled", "failed",
    "needs review", "needs_review", "offline", "overdue", "warning",
}
HEALTHY_STATES = {
    "active", "available", "closed", "completed", "connected", "enabled",
    "healthy", "online", "paid", "protected", "resolved", "success", "verified",
}


def _clean_status(value: Any) -> str:
    return str(value or "recorded").strip().lower().replace("-", "_")


def _business_impact(metadata: dict[str, Any]) -> dict[str, Any]:
    fields = (
        ("Business process", "business_process"),
        ("People affected", "affected_users"),
        ("Service impact", "service_impact"),
        ("Financial exposure", "revenue_impact"),
        ("Recorded impact", "impact"),
    )
    evidence = [
        {"label": label, "value": str(metadata[key])}
        for label, key in fields
        if metadata.get(key) not in (None, "", [], {})
    ]
    return {
        "known": bool(evidence),
        "summary": evidence[0]["value"] if evidence else "Business impact has not been recorded for this object.",
        "evidence": evidence,
    }


def build_object_story(entity: dict[str, Any], relationships: Iterable[dict], events: Iterable[dict]) -> dict[str, Any]:
    """Build a stable object card from canonical, relationship, and timeline evidence."""
    relationships = list(relationships)
    entity_events = [
        event for event in events
        if str(event.get("entity_type") or "") == str(entity.get("entity_type") or "")
        and str(event.get("entity_id") or "") == str(entity.get("entity_id") or "")
    ]
    entity_events.sort(key=lambda item: str(item.get("timestamp") or ""), reverse=True)
    status = _clean_status(entity.get("status"))
    if status in ATTENTION_STATES:
        health = {"band": "attention", "label": "Needs attention", "reason": f"The source record reports {status.replace('_', ' ')}."}
    elif status in HEALTHY_STATES:
        health = {"band": "healthy", "label": "Healthy", "reason": f"The source record reports {status.replace('_', ' ')}."}
    else:
        health = {"band": "observed", "label": "Observed", "reason": "Nexus has a source record but no domain-specific healthy or unhealthy assertion."}

    source = entity.get("source") or {}
    signals = [
        {"label": "Canonical source", "available": bool(source.get("collection") and source.get("id")), "weight": 40},
        {"label": "Relationship evidence", "available": bool(relationships), "weight": 35},
        {"label": "Timeline evidence", "available": bool(entity_events), "weight": 25},
    ]
    confidence_score = sum(signal["weight"] for signal in signals if signal["available"])
    confidence_band = "high" if confidence_score >= 75 else "moderate" if confidence_score >= 40 else "low"
    metadata = entity.get("metadata") or {}
    relationship_rows = []
    for relationship in relationships[:50]:
        direction = "outbound" if relationship.get("from_ref") == entity.get("id") else "inbound"
        related = relationship.get("related") or {}
        relationship_rows.append({
            "id": relationship.get("id"),
            "relation_type": relationship.get("relation_type"),
            "direction": direction,
            "evidence": relationship.get("evidence"),
            "source": relationship.get("source") or {},
            "related": {
                "ref": related.get("id"), "entity_type": related.get("entity_type"),
                "entity_id": related.get("entity_id"), "name": related.get("name"),
                "status": related.get("status"),
            },
        })
    return {
        "object": {
            "ref": entity.get("id"), "entity_type": entity.get("entity_type"),
            "entity_id": entity.get("entity_id"), "name": entity.get("name"),
            "status": entity.get("status"), "client_id": entity.get("client_id"),
            "source": source, "metadata": metadata,
        },
        "health": health,
        "confidence": {
            "score": confidence_score, "band": confidence_band, "signals": signals,
            "explanation": "Confidence measures evidence coverage, not whether the object is healthy.",
        },
        "business_impact": _business_impact(metadata),
        "timeline": entity_events[:50],
        "timeline_count": len(entity_events),
        "relationship_count": len(relationships),
        "relationships": relationship_rows,
        "principles": [
            "Every statement links back to a persisted Nexus source record.",
            "Missing evidence remains unknown rather than being treated as healthy.",
            "Timeline proximity does not imply that one event caused another.",
        ],
    }
