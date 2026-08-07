from app.routers.dashboard import _dedupe_users


def test_dedupe_users_collapses_legacy_duplicate_ids():
    rows = [
        {"id": "tech-1", "name": "Alex Thompson", "email": "admin@nexusops.io", "avatar_url": ""},
        {"id": "tech-1", "name": "Alex Thompson", "email": "admin@nexusops.io", "avatar_url": "/uploads/alex.png"},
        {"id": "tech-2", "name": "Sarah Chen", "email": "sarah@nexusops.io"},
    ]

    users = _dedupe_users(rows)

    assert [user["id"] for user in users] == ["tech-1", "tech-2"]
    assert users[0]["avatar_url"] == "/uploads/alex.png"


def test_dedupe_users_uses_email_when_an_id_is_missing():
    rows = [
        {"name": "Imported User", "email": "USER@example.com"},
        {"name": "Imported User", "email": "user@example.com", "role": "technician"},
    ]

    users = _dedupe_users(rows)

    assert len(users) == 1
    assert users[0]["role"] == "technician"
