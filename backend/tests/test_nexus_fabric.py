from app.services.nexus_fabric import build_client_fabric


def _graph():
    return {
        "client": {"id": "client-1", "name": "Example Co"},
        "client_id": "client-1",
        "schema_version": 2,
        "nodes": [
            {
                "id": "nexus:client:client-1",
                "entity_type": "client",
                "entity_id": "client-1",
                "client_id": "client-1",
                "name": "Example Co",
                "status": "active",
                "source": {"collection": "clients", "id": "client-1"},
            },
            {
                "id": "nexus:device:device-1",
                "entity_type": "device",
                "entity_id": "device-1",
                "client_id": "client-1",
                "name": "EXAMPLE-PC",
                "status": "offline",
                "source": {"collection": "devices", "id": "device-1"},
            },
            {
                "id": "nexus:ticket:ticket-1",
                "entity_type": "ticket",
                "entity_id": "ticket-1",
                "client_id": "client-1",
                "name": "Computer offline",
                "status": "open",
                "source": {"collection": "tickets", "id": "ticket-1"},
            },
        ],
        "edges": [
            {
                "id": "owner-device",
                "relation_type": "client.owns",
                "from_ref": "nexus:client:client-1",
                "to_ref": "nexus:device:device-1",
                "evidence": "devices.client_id",
                "source": {"collection": "devices", "id": "device-1"},
            },
            {
                "id": "owner-ticket",
                "relation_type": "client.owns",
                "from_ref": "nexus:client:client-1",
                "to_ref": "nexus:ticket:ticket-1",
                "evidence": "tickets.client_id",
                "source": {"collection": "tickets", "id": "ticket-1"},
            },
            {
                "id": "ticket-device",
                "relation_type": "ticket.concerns",
                "from_ref": "nexus:ticket:ticket-1",
                "to_ref": "nexus:device:device-1",
                "evidence": "tickets.device_ids",
                "source": {"collection": "tickets", "id": "ticket-1"},
            },
        ],
    }


def test_fabric_preserves_evidence_and_direct_routes():
    result = build_client_fabric(_graph())
    assert result["indexed"] is True
    assert result["summary"]["objects"] == 3
    assert result["summary"]["relationships"] == 3
    assert result["summary"]["operational_threads"] == 1
    assert result["summary"]["relationship_coverage_pct"] == 100

    device = next(node for node in result["nodes"] if node["entity_type"] == "device")
    assert device["attention"] is True
    assert device["route"] == "/devices/device-1"
    concern = next(item for item in device["relationships"] if item["relation_type"] == "ticket.concerns")
    assert concern["evidence"] == "tickets.device_ids"
    assert concern["related"]["route"] == "/tickets?ticket=ticket-1"


def test_fabric_does_not_invent_operational_links():
    graph = _graph()
    graph["edges"] = graph["edges"][:2]
    result = build_client_fabric(graph)
    assert result["summary"]["operational_threads"] == 0
    assert result["summary"]["relationship_coverage_pct"] == 0
    assert result["threads"] == []


def test_empty_graph_is_an_honest_unindexed_state():
    result = build_client_fabric({
        "client": {"id": "client-1", "name": "Example Co"},
        "client_id": "client-1",
        "schema_version": 2,
        "nodes": [],
        "edges": [],
    })
    assert result["indexed"] is False
    assert result["summary"]["objects"] == 0
    assert result["summary"]["relationships"] == 0
    assert result["summary"]["relationship_coverage_pct"] == 100


def test_fabric_preserves_approved_operational_context():
    graph = _graph()
    graph["edges"].append({
        "id": "context-ticket-device",
        "relation_type": "context.explains",
        "from_ref": "nexus:ticket:ticket-1",
        "to_ref": "nexus:device:device-1",
        "evidence": "Approved context: Reception depends on this device for dispatch",
        "source": {"collection": "context_relationships", "id": "context-1"},
        "context": {
            "purpose": "Reception depends on this device for dispatch",
            "business_process": "Customer dispatch",
            "requested_by": "Operations manager",
            "approved_by": "Aaron",
            "approval_evidence": "CHG-100",
        },
    })

    result = build_client_fabric(graph)
    ticket = next(node for node in result["nodes"] if node["entity_type"] == "ticket")
    context = next(item for item in ticket["relationships"] if item["relation_type"] == "context.explains")

    assert context["label"] == "explains why"
    assert context["source"]["collection"] == "context_relationships"
    assert context["context"]["business_process"] == "Customer dispatch"
    assert context["context"]["approval_evidence"] == "CHG-100"
