from app.routers.mega_features import _timeline_audit_event


def test_timeline_uses_current_audit_action_details():
    event = _timeline_audit_event(
        {"action": "ticket_subscriber_added", "details": "Subscribed Mike Rodriguez to ticket updates"}
    )

    assert event == {
        "type": "audit",
        "icon": "shuffle",
        "label": "Subscribed Mike Rodriguez to ticket updates",
    }


def test_timeline_keeps_legacy_status_change_readable():
    event = _timeline_audit_event(
        {"field": "status", "old_value": "open", "new_value": "in_progress"}
    )

    assert event == {
        "type": "status_change",
        "icon": "shuffle",
        "label": "status: open → in_progress",
    }
