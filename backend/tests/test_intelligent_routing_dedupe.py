from app.routers.intelligent_routing import _dedupe_technicians


def test_technician_capacity_feed_deduplicates_legacy_user_rows():
    rows = [
        {"id": "user-001", "name": "Alex Thompson", "email": "alex@example.com"},
        {"id": "user-001", "name": "Alex Thompson", "email": "alex@example.com"},
        {"id": "user-002", "name": "Sarah Chen", "email": "sarah@example.com"},
    ]

    assert _dedupe_technicians(rows) == [rows[0], rows[2]]


def test_technician_capacity_feed_can_fall_back_to_email_identity():
    rows = [
        {"name": "Imported Tech", "email": "TECH@example.com"},
        {"name": "Imported Tech", "email": "tech@example.com"},
    ]

    assert _dedupe_technicians(rows) == [rows[0]]
