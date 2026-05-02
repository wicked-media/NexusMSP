"""
Iteration 143: Help Center + Atmosphere Page + Chat Broadcast Hooks Testing

Tests for:
1. Help Center APIs (articles CRUD, search, seed)
2. Chat Broadcast Hooks (sentiment-escalating, sla-page, tick)
3. Chat @channel/@here/@everyone broadcast mentions
4. Atmosphere/Quirky Features APIs (already tested in iter142, regression check)
5. Frontend routes (/help, /help/:slug, /atmosphere)
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for admin user"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")

@pytest.fixture(scope="module")
def auth_headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ═══════════════════════ HELP CENTER ARTICLES ═══════════════════════

class TestHelpArticles:
    """Help Center article CRUD tests"""

    def test_list_articles_auto_seeds(self, auth_headers):
        """GET /api/help/articles - should auto-seed 6 default articles when empty"""
        response = requests.get(f"{BASE_URL}/api/help/articles", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "articles" in data, "Response should have 'articles' key"
        assert "by_category" in data, "Response should have 'by_category' key"
        assert "count" in data, "Response should have 'count' key"
        
        # Should have at least 6 default articles
        assert data["count"] >= 6, f"Expected at least 6 articles, got {data['count']}"
        
        # Verify categories exist
        categories = data["by_category"]
        expected_cats = ["Basics", "Service Desk", "Reports & Comms", "Collaboration", "Team"]
        for cat in expected_cats:
            assert cat in categories, f"Expected category '{cat}' in by_category"
        
        print(f"✓ List articles: {data['count']} articles in {len(categories)} categories")

    def test_list_articles_search(self, auth_headers):
        """GET /api/help/articles?q=tickets - search functionality"""
        response = requests.get(f"{BASE_URL}/api/help/articles?q=tickets", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        # Should find articles mentioning tickets
        assert "articles" in data
        # At least the Tickets Module article should match
        titles = [a.get("title", "").lower() for a in data["articles"]]
        assert any("ticket" in t for t in titles), "Search for 'tickets' should find ticket-related articles"
        print(f"✓ Search articles: found {data['count']} matching 'tickets'")

    def test_get_article_by_slug(self, auth_headers):
        """GET /api/help/articles/getting-started - get single article"""
        response = requests.get(f"{BASE_URL}/api/help/articles/getting-started", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify article structure
        assert data.get("slug") == "getting-started"
        assert data.get("title") == "Getting Started with NexusOps"
        assert data.get("category") == "Basics"
        assert data.get("icon") == "🚀"
        assert "body_md" in data, "Article should have body_md"
        assert len(data.get("body_md", "")) > 100, "Article body should have content"
        print(f"✓ Get article: '{data['title']}' ({len(data.get('body_md', ''))} chars)")

    def test_get_article_not_found(self, auth_headers):
        """GET /api/help/articles/nonexistent-slug - 404 for missing"""
        response = requests.get(f"{BASE_URL}/api/help/articles/nonexistent-slug-xyz", headers=auth_headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Get nonexistent article returns 404")

    def test_create_article(self, auth_headers):
        """POST /api/help/articles - create new article"""
        test_slug = f"test-article-{uuid.uuid4().hex[:8]}"
        payload = {
            "title": "Test Article for Iteration 143",
            "slug": test_slug,
            "category": "Testing",
            "icon": "🧪",
            "summary": "A test article created during automated testing",
            "body_md": "## Test Content\n\nThis is test content for the help center.",
            "order": 99
        }
        response = requests.post(f"{BASE_URL}/api/help/articles", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert data.get("slug") == test_slug
        assert data.get("title") == payload["title"]
        assert data.get("category") == "Testing"
        assert "updated_at" in data
        print(f"✓ Created article: {data['slug']}")
        
        # Cleanup - delete the test article
        del_response = requests.delete(f"{BASE_URL}/api/help/articles/{test_slug}", headers=auth_headers)
        assert del_response.status_code == 200
        print(f"✓ Cleaned up test article")

    def test_create_article_auto_slug(self, auth_headers):
        """POST /api/help/articles - auto-generates slug from title"""
        payload = {
            "title": "Auto Slug Test Article",
            "category": "Testing",
            "body_md": "Test content"
        }
        response = requests.post(f"{BASE_URL}/api/help/articles", json=payload, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        # Slug should be auto-generated from title
        assert data.get("slug") == "auto-slug-test-article", f"Expected auto-slug, got {data.get('slug')}"
        print(f"✓ Auto-slug generated: {data['slug']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/help/articles/{data['slug']}", headers=auth_headers)

    def test_create_article_missing_title(self, auth_headers):
        """POST /api/help/articles - 400 when title missing"""
        payload = {"category": "Testing", "body_md": "No title"}
        response = requests.post(f"{BASE_URL}/api/help/articles", json=payload, headers=auth_headers)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✓ Create article without title returns 400")

    def test_delete_article(self, auth_headers):
        """DELETE /api/help/articles/{slug} - delete article"""
        # First create an article to delete
        test_slug = f"delete-test-{uuid.uuid4().hex[:8]}"
        create_resp = requests.post(f"{BASE_URL}/api/help/articles", json={
            "title": "Article to Delete",
            "slug": test_slug,
            "category": "Testing",
            "body_md": "Will be deleted"
        }, headers=auth_headers)
        assert create_resp.status_code == 200
        
        # Delete it
        del_resp = requests.delete(f"{BASE_URL}/api/help/articles/{test_slug}", headers=auth_headers)
        assert del_resp.status_code == 200
        assert del_resp.json().get("deleted") == True
        
        # Verify it's gone
        get_resp = requests.get(f"{BASE_URL}/api/help/articles/{test_slug}", headers=auth_headers)
        assert get_resp.status_code == 404
        print("✓ Delete article works correctly")

    def test_delete_article_not_found(self, auth_headers):
        """DELETE /api/help/articles/nonexistent - 404"""
        response = requests.delete(f"{BASE_URL}/api/help/articles/nonexistent-xyz-123", headers=auth_headers)
        assert response.status_code == 404
        print("✓ Delete nonexistent article returns 404")

    def test_reseed_articles(self, auth_headers):
        """POST /api/help/seed - re-seeds default articles"""
        response = requests.post(f"{BASE_URL}/api/help/seed", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("seeded") == 6, f"Expected 6 seeded, got {data.get('seeded')}"
        print(f"✓ Re-seeded {data['seeded']} default articles")


# ═══════════════════════ CHAT BROADCAST HOOKS ═══════════════════════

class TestChatBroadcastHooks:
    """Chat broadcast hook tests for sentiment escalation and SLA pages"""

    def test_broadcast_sentiment_escalating(self, auth_headers):
        """POST /api/chat/broadcast/sentiment-escalating - scans and posts escalations"""
        response = requests.post(f"{BASE_URL}/api/chat/broadcast/sentiment-escalating", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Response should have posted count and items
        assert "posted" in data, "Response should have 'posted' count"
        assert "items" in data, "Response should have 'items' list"
        assert isinstance(data["posted"], int)
        assert isinstance(data["items"], list)
        print(f"✓ Sentiment broadcast: {data['posted']} new posts")

    def test_broadcast_sla_page(self, auth_headers):
        """POST /api/chat/broadcast/sla-page - scans and posts SLA pages"""
        response = requests.post(f"{BASE_URL}/api/chat/broadcast/sla-page", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "posted" in data
        assert "items" in data
        print(f"✓ SLA page broadcast: {data['posted']} new posts")

    def test_broadcast_tick(self, auth_headers):
        """POST /api/chat/broadcast/tick - calls both broadcast hooks"""
        response = requests.post(f"{BASE_URL}/api/chat/broadcast/tick", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "sentiment_posted" in data
        assert "sla_posted" in data
        print(f"✓ Broadcast tick: sentiment={data['sentiment_posted']}, sla={data['sla_posted']}")


# ═══════════════════════ CHAT @CHANNEL BROADCAST ═══════════════════════

class TestChatChannelBroadcast:
    """Test @channel/@here/@everyone broadcast mentions"""

    def test_send_message_with_channel_mention(self, auth_headers):
        """POST /api/chat/channels/{id}/messages with @channel sets broadcast=true"""
        # First get channels to find general
        ch_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=auth_headers)
        assert ch_resp.status_code == 200
        channels = ch_resp.json()
        
        general = next((c for c in channels if c.get("name") == "general"), None)
        assert general is not None, "General channel should exist"
        
        # Send message with @channel
        msg_payload = {"body": "@channel Testing broadcast mention from iteration 143"}
        msg_resp = requests.post(f"{BASE_URL}/api/chat/channels/{general['id']}/messages", 
                                 json=msg_payload, headers=auth_headers)
        assert msg_resp.status_code == 200, f"Expected 200, got {msg_resp.status_code}: {msg_resp.text}"
        msg = msg_resp.json()
        
        assert msg.get("broadcast") == True, "Message with @channel should have broadcast=true"
        assert "@channel" in msg.get("body", "")
        print(f"✓ @channel message sent with broadcast=true")

    def test_send_message_with_here_mention(self, auth_headers):
        """POST /api/chat/channels/{id}/messages with @here sets broadcast=true"""
        ch_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=auth_headers)
        channels = ch_resp.json()
        general = next((c for c in channels if c.get("name") == "general"), None)
        
        msg_payload = {"body": "@here Testing here mention"}
        msg_resp = requests.post(f"{BASE_URL}/api/chat/channels/{general['id']}/messages", 
                                 json=msg_payload, headers=auth_headers)
        assert msg_resp.status_code == 200
        msg = msg_resp.json()
        
        assert msg.get("broadcast") == True
        print(f"✓ @here message sent with broadcast=true")

    def test_send_message_with_everyone_mention(self, auth_headers):
        """POST /api/chat/channels/{id}/messages with @everyone sets broadcast=true"""
        ch_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=auth_headers)
        channels = ch_resp.json()
        general = next((c for c in channels if c.get("name") == "general"), None)
        
        msg_payload = {"body": "@everyone Testing everyone mention"}
        msg_resp = requests.post(f"{BASE_URL}/api/chat/channels/{general['id']}/messages", 
                                 json=msg_payload, headers=auth_headers)
        assert msg_resp.status_code == 200
        msg = msg_resp.json()
        
        assert msg.get("broadcast") == True
        print(f"✓ @everyone message sent with broadcast=true")

    def test_send_message_with_user_mention_no_broadcast(self, auth_headers):
        """POST /api/chat/channels/{id}/messages with @user does NOT set broadcast"""
        ch_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=auth_headers)
        channels = ch_resp.json()
        general = next((c for c in channels if c.get("name") == "general"), None)
        
        msg_payload = {"body": "@aaron Testing user mention only"}
        msg_resp = requests.post(f"{BASE_URL}/api/chat/channels/{general['id']}/messages", 
                                 json=msg_payload, headers=auth_headers)
        assert msg_resp.status_code == 200
        msg = msg_resp.json()
        
        # Should NOT be broadcast (only @channel/@here/@everyone trigger broadcast)
        assert msg.get("broadcast") == False, "Regular @user mention should not set broadcast"
        assert "aaron" in msg.get("mentions", []), "Should extract @aaron as mention"
        print(f"✓ @user mention works without broadcast flag")


# ═══════════════════════ QUIRKY FEATURES (ATMOSPHERE) ═══════════════════════

class TestAtmosphereFeatures:
    """Regression tests for quirky features used in Atmosphere page"""

    def test_friday_reel(self, auth_headers):
        """GET /api/wrap-up/friday-reel - returns storyboard + stats"""
        response = requests.get(f"{BASE_URL}/api/wrap-up/friday-reel", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "stats" in data
        assert "closed" in data["stats"]
        assert "criticals" in data["stats"]
        assert "drills" in data["stats"]
        assert "runbooks" in data["stats"]
        assert "top_critical_wins" in data
        # storyboard may be None if no LLM key
        print(f"✓ Friday reel: {data['stats']['closed']} closed, {data['stats']['criticals']} criticals")

    def test_threat_dragon(self, auth_headers):
        """GET /api/security/threat-dragon - returns mood/label/emoji/size"""
        response = requests.get(f"{BASE_URL}/api/security/threat-dragon", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "mood" in data
        assert "label" in data
        assert "emoji" in data
        assert "size_pct" in data
        assert "open_alerts" in data
        assert "critical_alerts" in data
        assert data["mood"] in ["sleeping_kitten", "drowsy_dragon", "hungry_dragon", "raging_dragon"]
        print(f"✓ Threat dragon: {data['emoji']} {data['label']} ({data['open_alerts']} open)")

    def test_weather_mode(self, auth_headers):
        """GET /api/ambient/weather-mode - returns mood + gradient"""
        response = requests.get(f"{BASE_URL}/api/ambient/weather-mode", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "mood" in data
        assert "gradient_classes" in data
        assert "stats" in data
        assert data["mood"] in ["stormy", "beach", "rainy_monday", "sunny", "neutral"]
        print(f"✓ Weather mode: {data['mood']} ({data['gradient_classes'][:30]}...)")

    def test_launch_event_create(self, auth_headers):
        """POST /api/ambient/launch-event - records a launch"""
        payload = {"kind": "test", "label": "Test launch from iteration 143"}
        response = requests.post(f"{BASE_URL}/api/ambient/launch-event", json=payload, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("kind") == "test"
        assert data.get("label") == payload["label"]
        assert "id" in data
        assert "ts" in data
        print(f"✓ Launch event created: {data['id']}")

    def test_recent_launches(self, auth_headers):
        """GET /api/ambient/recent-launches - returns last 10"""
        response = requests.get(f"{BASE_URL}/api/ambient/recent-launches", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        assert len(data) <= 10
        if data:
            assert "id" in data[0]
            assert "kind" in data[0]
            assert "label" in data[0]
        print(f"✓ Recent launches: {len(data)} events")

    def test_device_graveyard(self, auth_headers):
        """GET /api/device-graveyard - returns tombstones"""
        response = requests.get(f"{BASE_URL}/api/device-graveyard", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "tombstones" in data
        assert "count" in data
        assert isinstance(data["tombstones"], list)
        print(f"✓ Device graveyard: {data['count']} tombstones")


class TestClientQuirkyFeatures:
    """Client-specific quirky features for Atmosphere Client Cards tab"""

    @pytest.fixture(scope="class")
    def client_id(self, auth_headers):
        """Get a client ID for testing"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=auth_headers)
        if response.status_code == 200:
            clients = response.json()
            if isinstance(clients, dict):
                clients = clients.get("clients", [])
            if clients:
                return clients[0].get("id")
        pytest.skip("No clients available for testing")

    def test_trading_card(self, auth_headers, client_id):
        """GET /api/clients/{id}/trading-card - returns rarity card data"""
        response = requests.get(f"{BASE_URL}/api/clients/{client_id}/trading-card", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "rarity" in data
        assert data["rarity"] in ["common", "rare", "epic", "legendary"]
        assert "stats" in data
        assert "ltv_revenue" in data["stats"]
        assert "tickets_resolved" in data["stats"]
        assert "tagline" in data
        print(f"✓ Trading card: {data.get('name')} - {data['rarity']}")

    def test_mood_ring(self, auth_headers, client_id):
        """GET /api/clients/{id}/mood-ring - returns sentiment colour"""
        response = requests.get(f"{BASE_URL}/api/clients/{client_id}/mood-ring", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "colour" in data
        assert "label" in data
        # colour can be emerald, sky, amber, orange, rose, or grey
        print(f"✓ Mood ring: {data['colour']} - {data['label']}")

    def test_slow_internet_detective(self, auth_headers, client_id):
        """POST /api/network/slow-internet/{client_id} - returns verdict"""
        response = requests.post(f"{BASE_URL}/api/network/slow-internet/{client_id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "verdict" in data
        assert "confidence" in data
        assert "metrics" in data
        assert "reasons" in data
        assert "avg_ping_ms" in data["metrics"]
        print(f"✓ Slow internet: {data['verdict']} ({data['confidence']*100:.0f}% confidence)")

    def test_password_pet(self, auth_headers, client_id):
        """GET /api/security/password-pet/{client_id} - returns pet health"""
        response = requests.get(f"{BASE_URL}/api/security/password-pet/{client_id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "health" in data
        assert "state" in data
        assert "emoji" in data
        assert data["state"] in ["happy", "ok", "sick", "dying"]
        print(f"✓ Password pet: {data['emoji']} health={data['health']} ({data['state']})")

    def test_birthdays(self, auth_headers, client_id):
        """GET /api/clients/{id}/birthdays - returns upcoming birthdays"""
        response = requests.get(f"{BASE_URL}/api/clients/{client_id}/birthdays", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "upcoming" in data
        assert isinstance(data["upcoming"], list)
        print(f"✓ Birthdays: {len(data['upcoming'])} upcoming")

    def test_device_family_tree(self, auth_headers, client_id):
        """GET /api/device-family-tree/{client_id} - returns families grouped"""
        response = requests.get(f"{BASE_URL}/api/device-family-tree/{client_id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "families" in data
        assert isinstance(data["families"], list)
        if data["families"]:
            fam = data["families"][0]
            assert "family" in fam
            assert "count" in fam
        print(f"✓ Device family tree: {len(data['families'])} families")


# ═══════════════════════ NAVIGATION VERIFICATION ═══════════════════════

class TestNavigationRoutes:
    """Verify /help and /atmosphere routes are configured"""

    def test_help_route_exists(self, auth_headers):
        """Verify /help articles endpoint works (proxy for route)"""
        response = requests.get(f"{BASE_URL}/api/help/articles", headers=auth_headers)
        assert response.status_code == 200
        print("✓ /help route backend ready")

    def test_atmosphere_endpoints_exist(self, auth_headers):
        """Verify atmosphere-related endpoints work"""
        endpoints = [
            "/api/ambient/weather-mode",
            "/api/wrap-up/friday-reel",
            "/api/security/threat-dragon",
            "/api/ambient/recent-launches",
            "/api/device-graveyard"
        ]
        for ep in endpoints:
            response = requests.get(f"{BASE_URL}{ep}", headers=auth_headers)
            assert response.status_code == 200, f"{ep} failed: {response.status_code}"
        print(f"✓ All {len(endpoints)} atmosphere endpoints ready")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
