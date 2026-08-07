from app.routers.nexus_second_brain import (
    _build_expertise,
    _build_recommendations,
    _build_topic_signals,
    _coverage,
    _excerpt,
    _score_search_record,
)
from app.services.platform_foundation import EVENT_SUBJECTS


def _ticket(
    ticket_id: str,
    title: str,
    *,
    status: str = "open",
    client: str = "Acme",
    technician_id: str = "",
    technician_name: str = "",
    category: str = "support",
):
    return {
        "id": ticket_id,
        "ticket_number": f"INC-{ticket_id}",
        "title": title,
        "description": title,
        "status": status,
        "client_id": client.lower(),
        "client_name": client,
        "device_id": f"device-{ticket_id}",
        "category": category,
        "assigned_to": technician_id,
        "assigned_name": technician_name,
    }


def test_topic_signals_require_corroborating_ticket_evidence():
    tickets = [
        _ticket("1", "VPN drops every afternoon", client="Acme", category="network"),
        _ticket("2", "VPN cannot connect after update", client="Bravo", status="resolved", category="network"),
        _ticket("3", "Unrelated printer problem", client="Acme", category="hardware"),
    ]
    signals = _build_topic_signals(tickets, [])

    assert len(signals) == 1
    signal = signals[0]
    assert signal["topic"] == "network"
    assert signal["ticket_count"] == 2
    assert signal["client_count"] == 2
    assert signal["knowledge_gap"] is True
    assert len(signal["evidence"]) == 2
    assert "not inferred a root cause" in signal["reason"]


def test_published_knowledge_closes_a_second_brain_gap():
    tickets = [
        _ticket("1", "Printer offline in reception", category="hardware"),
        _ticket("2", "Print spooler repeatedly stops", status="resolved", category="hardware"),
    ]
    knowledge = [{"title": "Printer and spooler recovery", "content": "Restart the print spooler after validating the queue."}]

    signal = _build_topic_signals(tickets, knowledge)[0]
    recommendations = _build_recommendations([signal], [])

    assert signal["documented"] is True
    assert signal["knowledge_gap"] is False
    assert all(item["type"] != "knowledge_gap" for item in recommendations)


def test_expertise_is_outcome_evidence_not_a_performance_claim():
    tickets = [
        _ticket("1", "Firewall rule corrected", status="closed", technician_id="tech-1", technician_name="Emma", category="network"),
        _ticket("2", "VPN route repaired", status="resolved", technician_id="tech-1", technician_name="Emma", category="network"),
        _ticket("3", "Open DNS investigation", status="open", technician_id="tech-1", technician_name="Emma", category="network"),
    ]

    profiles = _build_expertise(tickets)
    assert len(profiles) == 1
    assert profiles[0]["resolved_count"] == 2
    assert profiles[0]["top_category"] == "network"
    assert "not an employee performance score" in profiles[0]["explanation"]


def test_memory_coverage_never_treats_missing_resolution_as_complete():
    tickets = [
        {**_ticket("1", "Resolved with evidence", status="resolved"), "resolution_notes": "Validated with user"},
        _ticket("2", "Closed without evidence", status="closed"),
        _ticket("3", "Still open", status="open"),
    ]

    coverage = _coverage(tickets, knowledge_count=4, runbook_count=2)
    assert coverage["resolution_evidence_pct"] == 50
    assert coverage["knowledge_count"] == 4
    assert coverage["runbook_count"] == 2


def test_memory_search_ranks_direct_record_matches():
    record = {
        "title": "Printer spooler failure at reception",
        "description": "The printer stopped after a Windows update.",
        "client_name": "Acme",
    }
    score, matched = _score_search_record(
        "broken printer from last week",
        record,
        ("title", "description", "client_name"),
    )

    assert score > 0
    assert "printer" in matched


def test_memory_search_excerpt_removes_stored_html():
    assert _excerpt("<h2>Purpose</h2><p>Restart the print spooler.</p>") == "Purpose Restart the print spooler."


def test_second_brain_review_event_is_declared():
    assert any(item["subject"] == "intelligence.memory.reviewed" for item in EVENT_SUBJECTS)
