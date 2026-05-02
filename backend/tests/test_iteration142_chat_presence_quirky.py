"""
Iteration 142: Chat/Presence + Quirky Features E2E Tests
Tests for:
- Presence: heartbeat, status, list
- Chat: channels, DMs, messages, read, unread, reactions, slash commands
- Gamification: achievements, tech profile, daily quests, friday reel
- Quirky: trading card, mood ring, slow internet, device graveyard, family tree,
          brain bucket, threat dragon, password pet, birthdays, weather mode, launch events
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Test credentials
ADMIN_EMAIL = "aaron@stech.com.au"
ADMIN_PASSWORD = "Lucky@2871$!"


@pytest.fixture(scope="module")
def auth_token():
    """Get auth token for admin user"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    data = response.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def user_info(auth_token):
    """Get current user info"""
    response = requests.get(f"{BASE_URL}/api/auth/me", headers={
        "Authorization": f"Bearer {auth_token}"
    })
    assert response.status_code == 200
    return response.json()


@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers"""
    return {"Authorization": f"Bearer {auth_token}"}


# ═══════════════════════ PRESENCE TESTS ═══════════════════════

class TestPresence:
    """Presence heartbeat and status tests"""

    def test_heartbeat_basic(self, headers):
        """POST /api/presence/heartbeat - basic heartbeat"""
        response = requests.post(f"{BASE_URL}/api/presence/heartbeat", json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True
        assert "ts" in data
        print(f"✓ Heartbeat basic: ok={data['ok']}, ts={data['ts']}")

    def test_heartbeat_with_busy_state(self, headers):
        """POST /api/presence/heartbeat with busy_state"""
        response = requests.post(f"{BASE_URL}/api/presence/heartbeat", 
                                 json={"busy_state": "ticket:TKT-001"}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True
        print(f"✓ Heartbeat with busy_state: ok={data['ok']}")

    def test_presence_list(self, headers):
        """GET /api/presence - list all users with LED status"""
        response = requests.get(f"{BASE_URL}/api/presence", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "users" in data
        assert isinstance(data["users"], list)
        # Check LED field exists
        if data["users"]:
            user = data["users"][0]
            assert "led" in user
            assert user["led"] in ["active", "busy", "dnd", "break", "away", "offline"]
        print(f"✓ Presence list: {len(data['users'])} users, generated_at={data.get('generated_at')}")

    def test_presence_status_set_dnd(self, headers):
        """POST /api/presence/status - set manual DND"""
        response = requests.post(f"{BASE_URL}/api/presence/status", 
                                 json={"manual_state": "dnd"}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True
        print("✓ Set status to DND")

    def test_presence_status_clear(self, headers):
        """POST /api/presence/status - clear manual state"""
        response = requests.post(f"{BASE_URL}/api/presence/status", 
                                 json={"manual_state": ""}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True
        print("✓ Cleared manual status")

    def test_presence_status_invalid(self, headers):
        """POST /api/presence/status - invalid state returns 400"""
        response = requests.post(f"{BASE_URL}/api/presence/status", 
                                 json={"manual_state": "invalid_state"}, headers=headers)
        assert response.status_code == 400
        print("✓ Invalid status rejected with 400")


# ═══════════════════════ CHAT CHANNELS TESTS ═══════════════════════

class TestChatChannels:
    """Chat channels and messaging tests"""

    def test_channels_list_creates_defaults(self, headers):
        """GET /api/chat/channels - auto-creates general and random"""
        response = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        names = [ch["name"] for ch in data]
        assert "general" in names, "Default 'general' channel should exist"
        assert "random" in names, "Default 'random' channel should exist"
        print(f"✓ Channels list: {len(data)} channels, includes general and random")
        return data

    def test_create_channel(self, headers):
        """POST /api/chat/channels - create new channel"""
        response = requests.post(f"{BASE_URL}/api/chat/channels", 
                                 json={"name": "test-channel-142"}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("name") == "test-channel-142"
        assert "id" in data
        print(f"✓ Created channel: {data['name']} (id={data['id']})")
        return data

    def test_send_message(self, headers):
        """POST /api/chat/channels/{id}/messages - send message"""
        # Get general channel
        channels = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers).json()
        general = next((ch for ch in channels if ch["name"] == "general"), None)
        assert general, "General channel not found"
        
        response = requests.post(f"{BASE_URL}/api/chat/channels/{general['id']}/messages",
                                 json={"body": "Test message from iteration 142"}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("body") == "Test message from iteration 142"
        assert "id" in data
        assert "ts" in data
        print(f"✓ Sent message: id={data['id']}")
        return data

    def test_send_message_with_mention(self, headers):
        """POST /api/chat/channels/{id}/messages - message with @mention"""
        channels = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers).json()
        general = next((ch for ch in channels if ch["name"] == "general"), None)
        
        response = requests.post(f"{BASE_URL}/api/chat/channels/{general['id']}/messages",
                                 json={"body": "Hey @aaron check this out!"}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "mentions" in data
        assert "aaron" in data["mentions"]
        print(f"✓ Sent message with mention: mentions={data['mentions']}")

    def test_get_messages(self, headers):
        """GET /api/chat/channels/{id}/messages - fetch messages"""
        channels = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers).json()
        general = next((ch for ch in channels if ch["name"] == "general"), None)
        
        response = requests.get(f"{BASE_URL}/api/chat/channels/{general['id']}/messages", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Got messages: {len(data)} messages in general")

    def test_mark_read(self, headers):
        """POST /api/chat/channels/{id}/read - mark channel read"""
        channels = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers).json()
        general = next((ch for ch in channels if ch["name"] == "general"), None)
        
        response = requests.post(f"{BASE_URL}/api/chat/channels/{general['id']}/read", 
                                 json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True
        print("✓ Marked channel as read")

    def test_unread_counts(self, headers):
        """GET /api/chat/unread - get unread counts"""
        response = requests.get(f"{BASE_URL}/api/chat/unread", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        print(f"✓ Unread counts: {len(data)} channels tracked")

    def test_react_to_message(self, headers):
        """POST /api/chat/messages/{msg_id}/react - toggle reaction"""
        # Send a message first
        channels = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers).json()
        general = next((ch for ch in channels if ch["name"] == "general"), None)
        msg = requests.post(f"{BASE_URL}/api/chat/channels/{general['id']}/messages",
                           json={"body": "React to this!"}, headers=headers).json()
        
        # React with thumbs up
        response = requests.post(f"{BASE_URL}/api/chat/messages/{msg['id']}/react",
                                 json={"emoji": "👍"}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "reactions" in data
        assert "👍" in data["reactions"]
        print(f"✓ Added reaction: {data['reactions']}")


# ═══════════════════════ DM TESTS ═══════════════════════

class TestDirectMessages:
    """DM channel tests"""

    def test_create_dm_requires_other_user(self, headers, user_info):
        """POST /api/chat/dm/{user_id} - cannot DM yourself"""
        my_id = user_info.get("id")
        response = requests.post(f"{BASE_URL}/api/chat/dm/{my_id}", json={}, headers=headers)
        assert response.status_code == 400
        print("✓ Cannot DM yourself - 400 returned")

    def test_create_dm_user_not_found(self, headers):
        """POST /api/chat/dm/{user_id} - 404 for non-existent user"""
        response = requests.post(f"{BASE_URL}/api/chat/dm/nonexistent-user-id", json={}, headers=headers)
        assert response.status_code == 404
        print("✓ DM to non-existent user returns 404")


# ═══════════════════════ SLASH COMMANDS TESTS ═══════════════════════

class TestSlashCommands:
    """Slash command tests"""

    def test_slash_help(self, headers):
        """POST /api/chat/slash - /help command"""
        channels = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers).json()
        general = next((ch for ch in channels if ch["name"] == "general"), None)
        
        response = requests.post(f"{BASE_URL}/api/chat/slash",
                                 json={"channel_id": general["id"], "raw": "/help"}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "body" in data
        assert "/assign" in data["body"] or "Slash commands" in data["body"]
        print(f"✓ /help returned: {data['body'][:80]}...")

    def test_slash_assign_missing_args(self, headers):
        """POST /api/chat/slash - /assign with missing args"""
        channels = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers).json()
        general = next((ch for ch in channels if ch["name"] == "general"), None)
        
        response = requests.post(f"{BASE_URL}/api/chat/slash",
                                 json={"channel_id": general["id"], "raw": "/assign"}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        # Should return unknown command or help since args missing
        assert "body" in data
        print(f"✓ /assign without args handled: {data['body'][:60]}...")

    def test_slash_unknown_command(self, headers):
        """POST /api/chat/slash - unknown command"""
        channels = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers).json()
        general = next((ch for ch in channels if ch["name"] == "general"), None)
        
        response = requests.post(f"{BASE_URL}/api/chat/slash",
                                 json={"channel_id": general["id"], "raw": "/unknowncmd"}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "Unknown command" in data.get("body", "")
        print("✓ Unknown command handled gracefully")


# ═══════════════════════ ACHIEVEMENTS TESTS ═══════════════════════

class TestAchievements:
    """Gamification achievements tests"""

    def test_user_achievements(self, headers, user_info):
        """GET /api/team/{user_id}/achievements - get achievements"""
        user_id = user_info.get("id")
        response = requests.get(f"{BASE_URL}/api/team/{user_id}/achievements", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "earned" in data
        assert "locked" in data
        assert "total_unlocked" in data
        assert "total_available" in data
        assert "completion_pct" in data
        assert data["total_available"] == 15, "Should have 15 total achievements defined"
        print(f"✓ Achievements: {data['total_unlocked']}/{data['total_available']} ({data['completion_pct']}%)")


# ═══════════════════════ TECH PROFILE TESTS ═══════════════════════

class TestTechProfile:
    """Tech profile page tests"""

    def test_tech_profile(self, headers, user_info):
        """GET /api/team/{user_id}/profile - get full profile"""
        user_id = user_info.get("id")
        response = requests.get(f"{BASE_URL}/api/team/{user_id}/profile", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "level" in data
        assert "total_xp" in data
        assert "skills_radar" in data
        assert "achievements_earned" in data
        assert "achievements_total" in data
        assert "open_tickets" in data
        assert "closed_tickets" in data
        print(f"✓ Tech profile: Level {data['level']}, {data['total_xp']} XP, {data['achievements_earned']} achievements")


# ═══════════════════════ DAILY QUESTS TESTS ═══════════════════════

class TestDailyQuests:
    """Daily quests tests"""

    def test_daily_quests(self, headers, user_info):
        """GET /api/team/{user_id}/daily-quests - get 3 random quests"""
        user_id = user_info.get("id")
        response = requests.get(f"{BASE_URL}/api/team/{user_id}/daily-quests", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "quests" in data
        assert len(data["quests"]) == 3, "Should have exactly 3 quests"
        for q in data["quests"]:
            assert "key" in q
            assert "title" in q
            assert "xp" in q
            assert "icon" in q
        print(f"✓ Daily quests: {[q['key'] for q in data['quests']]}")


# ═══════════════════════ FRIDAY REEL TESTS ═══════════════════════

class TestFridayReel:
    """Friday wrap-up reel tests"""

    def test_friday_reel(self, headers):
        """GET /api/wrap-up/friday-reel - get weekly stats + storyboard"""
        response = requests.get(f"{BASE_URL}/api/wrap-up/friday-reel", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "stats" in data
        assert "closed" in data["stats"]
        assert "criticals" in data["stats"]
        assert "drills" in data["stats"]
        assert "runbooks" in data["stats"]
        # Storyboard may be None if AI not configured or no data
        print(f"✓ Friday reel: stats={data['stats']}, has_storyboard={data.get('storyboard') is not None}")


# ═══════════════════════ TRADING CARD TESTS ═══════════════════════

class TestTradingCard:
    """Client trading card tests"""

    def test_trading_card(self, headers):
        """GET /api/clients/{id}/trading-card - get client card"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/trading-card", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "rarity" in data
        assert data["rarity"] in ["common", "rare", "epic", "legendary"]
        assert "stats" in data
        assert "ltv_revenue" in data["stats"]
        assert "tickets_resolved" in data["stats"]
        assert "longest_resolution_hrs" in data["stats"]
        assert "churn_score" in data["stats"]
        assert "devices" in data["stats"]
        assert "years_partnered" in data["stats"]
        assert "tagline" in data
        print(f"✓ Trading card: rarity={data['rarity']}, tagline={data['tagline']}")


# ═══════════════════════ MOOD RING TESTS ═══════════════════════

class TestMoodRing:
    """Client mood ring tests"""

    def test_mood_ring(self, headers):
        """GET /api/clients/{id}/mood-ring - get sentiment colour"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/mood-ring", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "colour" in data
        assert "label" in data
        # Score may be None if no sentiment data
        print(f"✓ Mood ring: colour={data['colour']}, label={data['label']}, score={data.get('score')}")


# ═══════════════════════ SLOW INTERNET DETECTIVE TESTS ═══════════════════════

class TestSlowInternetDetective:
    """Slow internet detective tests (MOCKED - uses random values)"""

    def test_slow_internet_detective(self, headers):
        """POST /api/network/slow-internet/{client_id} - get verdict"""
        response = requests.post(f"{BASE_URL}/api/network/slow-internet/client-001", 
                                 json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "verdict" in data
        assert "confidence" in data
        assert "metrics" in data
        assert "avg_ping_ms" in data["metrics"]
        assert "jitter_ms" in data["metrics"]
        assert "speed_down_mbps" in data["metrics"]
        assert "reasons" in data
        print(f"✓ Slow internet detective (MOCKED): verdict={data['verdict']}, confidence={data['confidence']}")


# ═══════════════════════ DEVICE GRAVEYARD TESTS ═══════════════════════

class TestDeviceGraveyard:
    """Device graveyard tests"""

    def test_device_graveyard(self, headers):
        """GET /api/device-graveyard - get decommissioned devices"""
        response = requests.get(f"{BASE_URL}/api/device-graveyard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "tombstones" in data
        assert "count" in data
        assert isinstance(data["tombstones"], list)
        if data["tombstones"]:
            tomb = data["tombstones"][0]
            assert "epitaph" in tomb
        print(f"✓ Device graveyard: {data['count']} tombstones")


# ═══════════════════════ DEVICE FAMILY TREE TESTS ═══════════════════════

class TestDeviceFamilyTree:
    """Device family tree tests"""

    def test_device_family_tree(self, headers):
        """GET /api/device-family-tree/{client_id} - get device families"""
        response = requests.get(f"{BASE_URL}/api/device-family-tree/client-001", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "families" in data
        assert "client_id" in data
        assert isinstance(data["families"], list)
        print(f"✓ Device family tree: {len(data['families'])} families for client-001")


# ═══════════════════════ BRAIN BUCKET TESTS ═══════════════════════

class TestBrainBucket:
    """Brain bucket (private notes) tests"""

    def test_brain_bucket_get_own(self, headers, user_info):
        """GET /api/team/{my_id}/brain-bucket - get own bucket"""
        user_id = user_info.get("id")
        response = requests.get(f"{BASE_URL}/api/team/{user_id}/brain-bucket", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "user_id" in data
        assert "notes" in data
        print(f"✓ Brain bucket GET: notes length={len(data.get('notes', ''))}")

    def test_brain_bucket_save(self, headers, user_info):
        """POST /api/team/{my_id}/brain-bucket - save notes"""
        user_id = user_info.get("id")
        test_notes = "Test notes from iteration 142 - remember to check the firewall config!"
        response = requests.post(f"{BASE_URL}/api/team/{user_id}/brain-bucket",
                                 json={"notes": test_notes}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True
        
        # Verify saved
        verify = requests.get(f"{BASE_URL}/api/team/{user_id}/brain-bucket", headers=headers).json()
        assert test_notes in verify.get("notes", "")
        print("✓ Brain bucket saved and verified")

    def test_brain_bucket_403_other_user(self, headers):
        """GET /api/team/{other_id}/brain-bucket - 403 for other user's bucket"""
        response = requests.get(f"{BASE_URL}/api/team/some-other-user-id/brain-bucket", headers=headers)
        assert response.status_code == 403
        print("✓ Brain bucket 403 for other user's bucket")


# ═══════════════════════ THREAT DRAGON TESTS ═══════════════════════

class TestThreatDragon:
    """Threat dragon (security mood) tests"""

    def test_threat_dragon(self, headers):
        """GET /api/security/threat-dragon - get dragon mood"""
        response = requests.get(f"{BASE_URL}/api/security/threat-dragon", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "mood" in data
        assert "label" in data
        assert "emoji" in data
        assert "size_pct" in data
        assert "open_alerts" in data
        assert "critical_alerts" in data
        print(f"✓ Threat dragon: mood={data['mood']}, emoji={data['emoji']}, size={data['size_pct']}%")


# ═══════════════════════ PASSWORD PET TESTS ═══════════════════════

class TestPasswordPet:
    """Password pet (hygiene avatar) tests"""

    def test_password_pet(self, headers):
        """GET /api/security/password-pet/{client_id} - get pet health"""
        response = requests.get(f"{BASE_URL}/api/security/password-pet/client-001", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "health" in data
        assert "state" in data
        assert data["state"] in ["happy", "ok", "sick", "dying"]
        assert "emoji" in data
        assert "stats" in data
        print(f"✓ Password pet: health={data['health']}, state={data['state']}, emoji={data['emoji']}")


# ═══════════════════════ BIRTHDAYS TESTS ═══════════════════════

class TestBirthdays:
    """Client birthdays tests"""

    def test_birthdays(self, headers):
        """GET /api/clients/{id}/birthdays - get upcoming birthdays"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/birthdays", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "client_id" in data
        assert "upcoming" in data
        assert isinstance(data["upcoming"], list)
        print(f"✓ Birthdays: {len(data['upcoming'])} upcoming for client-001")


# ═══════════════════════ WEATHER MODE TESTS ═══════════════════════

class TestWeatherMode:
    """Ambient weather mode tests"""

    def test_weather_mode(self, headers):
        """GET /api/ambient/weather-mode - get dashboard mood"""
        response = requests.get(f"{BASE_URL}/api/ambient/weather-mode", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "mood" in data
        assert data["mood"] in ["stormy", "beach", "rainy_monday", "sunny", "neutral"]
        assert "gradient_classes" in data
        assert "stats" in data
        print(f"✓ Weather mode: mood={data['mood']}, gradient={data['gradient_classes']}")


# ═══════════════════════ LAUNCH EVENTS TESTS ═══════════════════════

class TestLaunchEvents:
    """Launch events (rocket animations) tests"""

    def test_record_launch_event(self, headers):
        """POST /api/ambient/launch-event - record celebration"""
        response = requests.post(f"{BASE_URL}/api/ambient/launch-event",
                                 json={"kind": "critical_resolved", "label": "Saved the day!"}, 
                                 headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data.get("kind") == "critical_resolved"
        assert data.get("label") == "Saved the day!"
        print(f"✓ Launch event recorded: id={data['id']}")

    def test_recent_launches(self, headers):
        """GET /api/ambient/recent-launches - get last 10 events"""
        response = requests.get(f"{BASE_URL}/api/ambient/recent-launches", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) <= 10
        print(f"✓ Recent launches: {len(data)} events")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
