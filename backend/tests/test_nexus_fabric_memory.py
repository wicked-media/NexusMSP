from app.services.nexus_fabric import build_client_fabric


def _node(entity_type, entity_id, name, *, status="active", metadata=None):
    return {
        "id": f"nexus:{entity_type}:{entity_id}",
        "entity_type": entity_type,
        "entity_id": entity_id,
        "client_id": "client-001",
        "name": name,
        "status": status,
        "source": {"collection": f"{entity_type}s", "id": entity_id},
        "metadata": metadata or {},
        "indexed_at": "2026-08-02T00:00:00+00:00",
    }


def test_fabric_builds_evidence_backed_ticket_memory():
    client = _node("client", "client-001", "Example Client")
    ticket = _node(
        "ticket",
        "ticket-042",
        "Fortinet VPN drops after print job",
        status="closed",
        metadata={
            "priority": "high",
            "category": "networking",
            "assigned_to_name": "Josh",
            "resolution": "Applied the approved VPN policy fix",
            "closed_at": "2026-08-01T10:00:00+00:00",
        },
    )
    device = _node("device", "device-009", "Reception PC", status="online")
    edge = {
        "id": "relationship-1",
        "from_ref": ticket["id"],
        "to_ref": device["id"],
        "relation_type": "ticket.concerns",
        "evidence": "tickets.device_ids",
        "source": {"collection": "tickets", "id": "ticket-042"},
    }

    result = build_client_fabric({
        "client": {"id": "client-001", "name": "Example Client"},
        "client_id": "client-001",
        "schema_version": 2,
        "nodes": [client, ticket, device],
        "edges": [edge],
    })

    memory = next(item for item in result["memory"]["items"] if item["object"]["entity_id"] == "ticket-042")
    assert memory["kind"] == "service_history"
    assert memory["confidence"] == "verified"
    assert memory["related_objects"][0]["name"] == "Reception PC"
    assert {fact["label"] for fact in memory["facts"]} >= {"Priority", "Technician", "Resolution"}
    assert memory["evidence"][1]["statement"] == "tickets.device_ids"
    assert "fortinet" in memory["search_text"]
    assert "reception pc" in memory["search_text"]
    assert result["summary"]["operational_memories"] >= 1


def test_fabric_memory_does_not_invent_unlinked_context():
    client = _node("client", "client-001", "Example Client")
    device = _node("device", "device-009", "Unlinked PC", status="online")

    result = build_client_fabric({
        "client": {"id": "client-001", "name": "Example Client"},
        "client_id": "client-001",
        "schema_version": 2,
        "nodes": [client, device],
        "edges": [],
    })

    assert result["memory"]["items"] == []
    assert result["memory"]["evidence_count"] == 0


def test_problem_radius_is_relationship_aware_but_not_causal():
    client = _node("client", "client-001", "Example Client")
    ticket = _node("ticket", "ticket-500", "Backup failure", status="critical")
    device = _node("device", "device-500", "File Server", status="offline")
    document = _node("documentation", "doc-500", "File Server Recovery Plan", status="published")
    edges = [
        {
            "id": "relationship-ticket-device",
            "from_ref": ticket["id"],
            "to_ref": device["id"],
            "relation_type": "ticket.concerns",
            "evidence": "tickets.device_id",
            "source": {"collection": "tickets", "id": "ticket-500"},
        },
        {
            "id": "relationship-document-device",
            "from_ref": document["id"],
            "to_ref": device["id"],
            "relation_type": "documentation.describes",
            "evidence": "documentation.device_id",
            "source": {"collection": "documentation", "id": "doc-500"},
        },
    ]

    result = build_client_fabric({
        "client": {"id": "client-001", "name": "Example Client"},
        "client_id": "client-001",
        "schema_version": 2,
        "nodes": [client, ticket, device, document],
        "edges": edges,
    })

    radius = next(item for item in result["decision_lens"]["radii"] if item["root"]["entity_id"] == "ticket-500")
    assert radius["direct_count"] == 1
    assert radius["extended_count"] == 1
    assert {path["object"]["name"] for path in radius["related_objects"]} == {"File Server", "File Server Recovery Plan"}
    assert "No verified causal explanation" in radius["questions"]["why"]
    assert "not proof" in radius["disclaimer"]
    assert result["knowledge_readiness"]["score"] > 0
    assert sum(component["maximum"] for component in result["knowledge_readiness"]["components"]) == 100
