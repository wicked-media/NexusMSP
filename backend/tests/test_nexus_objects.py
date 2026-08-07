from app.services.nexus_objects import build_object_story


def test_object_story_separates_health_from_confidence_and_filters_timeline():
    entity = {
        "id": "nexus:device:dev-1", "entity_type": "device", "entity_id": "dev-1",
        "client_id": "client-1", "name": "Reception PC", "status": "offline",
        "source": {"collection": "devices", "id": "dev-1"},
        "metadata": {"business_process": "Front desk", "affected_users": 2},
    }
    events = [
        {"id": "matching", "entity_type": "device", "entity_id": "dev-1", "timestamp": "2026-08-02T01:00:00+00:00"},
        {"id": "other", "entity_type": "device", "entity_id": "dev-2", "timestamp": "2026-08-02T02:00:00+00:00"},
    ]
    story = build_object_story(entity, [{"id": "relationship-1"}], events)

    assert story["health"]["band"] == "attention"
    assert story["confidence"] == {
        "score": 100,
        "band": "high",
        "signals": [
            {"label": "Canonical source", "available": True, "weight": 40},
            {"label": "Relationship evidence", "available": True, "weight": 35},
            {"label": "Timeline evidence", "available": True, "weight": 25},
        ],
        "explanation": "Confidence measures evidence coverage, not whether the object is healthy.",
    }
    assert [event["id"] for event in story["timeline"]] == ["matching"]
    assert story["business_impact"]["known"] is True


def test_object_story_does_not_invent_health_or_impact():
    story = build_object_story(
        {"id": "nexus:document:doc-1", "entity_type": "documentation", "entity_id": "doc-1", "name": "Old note", "source": {}},
        [],
        [],
    )
    assert story["health"]["band"] == "observed"
    assert story["confidence"]["score"] == 0
    assert story["business_impact"]["known"] is False
