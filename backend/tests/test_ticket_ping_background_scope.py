from app.routers.ticket_ping import _background_ticket_query


def test_background_ticket_update_preserves_explicit_tenant():
    assert _background_ticket_query({"id": "ticket-1", "tenant_id": "tenant-a"}) == {
        "id": "ticket-1", "tenant_id": "tenant-a"
    }


def test_background_ticket_update_keeps_legacy_local_partition():
    query = _background_ticket_query({"id": "ticket-1"})
    assert query["$and"][0] == {"id": "ticket-1"}
    assert {"tenant_id": {"$exists": False}} in query["$and"][1]["$or"]
