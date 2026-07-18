from app.routers.kanban_tickets import _board_status, _board_ticket


def test_waiting_aliases_share_one_board_column():
    assert _board_status("on_hold") == "waiting"
    assert _board_status("pending") == "waiting"
    assert _board_status("waiting_on_client") == "waiting"


def test_board_ticket_contains_state_needed_by_the_card():
    ticket = {
        "id": "ticket-1",
        "title": "Printer offline",
        "status": "on_hold",
        "priority": "high",
        "assigned_name": "Alex Tech",
        "sla_due_at": "2026-07-15T01:00:00Z",
        "tags": ["printer"],
    }

    card = _board_ticket(ticket, "waiting")

    assert card["status"] == "waiting"
    assert card["assigned_to_name"] == "Alex Tech"
    assert card["sla_due"] == ticket["sla_due_at"]
    assert card["tags"] == ["printer"]
