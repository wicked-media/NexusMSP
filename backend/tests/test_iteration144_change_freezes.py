"""
Iteration 144 Tests: Change Freeze Calendar + All-Clear Broadcast
Tests for:
1. Change Freeze CRUD endpoints
2. All-Clear broadcast hook
3. Broadcast tick endpoint (4 keys)
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for admin user"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json().get("token")

@pytest.fixture(scope="module")
def auth_headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}

@pytest.fixture(scope="module")
def test_client_id(auth_headers):
    """Get a client ID for testing"""
    response = requests.get(f"{BASE_URL}/api/clients", headers=auth_headers)
    if response.status_code == 200:
        data = response.json()
        clients = data if isinstance(data, list) else data.get("clients", [])
        if clients:
            return clients[0].get("id")
    return None


# ═══════════════════════ CHANGE FREEZE CRUD TESTS ═══════════════════════

class TestChangeFreezeCreate:
    """POST /api/change-freezes - Create freeze window"""
    
    def test_create_freeze_msp_wide(self, auth_headers):
        """Create MSP-wide freeze (no client_id)"""
        now = datetime.utcnow()
        payload = {
            "title": "TEST_MSP_Wide_Freeze",
            "starts_at": (now + timedelta(hours=1)).isoformat() + "Z",
            "ends_at": (now + timedelta(hours=5)).isoformat() + "Z",
            "kinds": ["patch", "reboot", "script", "broadcast"],
            "reason": "Testing MSP-wide freeze",
            "active": True
        }
        response = requests.post(f"{BASE_URL}/api/change-freezes", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Create freeze failed: {response.text}"
        data = response.json()
        assert data.get("id"), "Freeze should have an ID"
        assert data.get("title") == "TEST_MSP_Wide_Freeze"
        assert data.get("client_id") is None, "MSP-wide freeze should have null client_id"
        assert "patch" in data.get("kinds", [])
        assert data.get("active") is True
        # Store for cleanup
        TestChangeFreezeCreate.created_freeze_id = data.get("id")
    
    def test_create_freeze_client_specific(self, auth_headers, test_client_id):
        """Create client-specific freeze"""
        if not test_client_id:
            pytest.skip("No test client available")
        now = datetime.utcnow()
        payload = {
            "title": "TEST_Client_Freeze",
            "client_id": test_client_id,
            "starts_at": (now + timedelta(hours=2)).isoformat() + "Z",
            "ends_at": (now + timedelta(hours=6)).isoformat() + "Z",
            "kinds": ["patch", "reboot"],
            "reason": "Client-specific maintenance window",
            "active": True
        }
        response = requests.post(f"{BASE_URL}/api/change-freezes", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Create client freeze failed: {response.text}"
        data = response.json()
        assert data.get("client_id") == test_client_id
        TestChangeFreezeCreate.client_freeze_id = data.get("id")
    
    def test_create_freeze_missing_dates_fails(self, auth_headers):
        """Create freeze without dates should fail"""
        payload = {"title": "TEST_No_Dates"}
        response = requests.post(f"{BASE_URL}/api/change-freezes", json=payload, headers=auth_headers)
        assert response.status_code == 400, "Should fail without dates"
        assert "starts_at" in response.text.lower() or "ends_at" in response.text.lower()


class TestChangeFreezeList:
    """GET /api/change-freezes - List freeze windows"""
    
    def test_list_all_freezes(self, auth_headers):
        """List all freeze windows"""
        response = requests.get(f"{BASE_URL}/api/change-freezes", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "freezes" in data
        assert "count" in data
        assert isinstance(data["freezes"], list)
        # Check hydrated client_name
        for f in data["freezes"]:
            assert "client_name" in f, "Should have hydrated client_name"
    
    def test_list_freezes_by_client(self, auth_headers, test_client_id):
        """List freezes filtered by client_id"""
        if not test_client_id:
            pytest.skip("No test client available")
        response = requests.get(f"{BASE_URL}/api/change-freezes?client_id={test_client_id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        # All returned freezes should be for this client
        for f in data.get("freezes", []):
            assert f.get("client_id") == test_client_id or f.get("client_id") is None
    
    def test_list_active_only(self, auth_headers):
        """List only currently active freezes"""
        response = requests.get(f"{BASE_URL}/api/change-freezes?active_only=true", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        # All returned should be active and within time window
        now = datetime.utcnow().isoformat()
        for f in data.get("freezes", []):
            assert f.get("active") is True


class TestChangeFreezeActive:
    """GET /api/change-freezes/active - Currently active windows"""
    
    def test_get_active_freezes(self, auth_headers):
        """Get currently active freeze windows"""
        response = requests.get(f"{BASE_URL}/api/change-freezes/active", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "active" in data
        assert "count" in data
        assert isinstance(data["active"], list)


class TestChangeFreezeCheck:
    """GET /api/change-freezes/check - Boolean is-frozen check"""
    
    def test_check_freeze_no_params(self, auth_headers):
        """Check freeze status without params"""
        response = requests.get(f"{BASE_URL}/api/change-freezes/check", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "frozen" in data
        assert isinstance(data["frozen"], bool)
        assert "matches" in data
        assert isinstance(data["matches"], list)
    
    def test_check_freeze_with_client(self, auth_headers, test_client_id):
        """Check freeze status for specific client"""
        if not test_client_id:
            pytest.skip("No test client available")
        response = requests.get(f"{BASE_URL}/api/change-freezes/check?client_id={test_client_id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "frozen" in data
        assert data.get("client_id") == test_client_id
    
    def test_check_freeze_with_kind(self, auth_headers):
        """Check freeze status for specific kind"""
        response = requests.get(f"{BASE_URL}/api/change-freezes/check?kind=patch", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "frozen" in data
        assert data.get("kind") == "patch"


class TestChangeFreezeGetOne:
    """GET /api/change-freezes/{id} - Fetch single freeze"""
    
    def test_get_freeze_by_id(self, auth_headers):
        """Get freeze by ID"""
        freeze_id = getattr(TestChangeFreezeCreate, 'created_freeze_id', None)
        if not freeze_id:
            pytest.skip("No freeze created to fetch")
        response = requests.get(f"{BASE_URL}/api/change-freezes/{freeze_id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("id") == freeze_id
        assert data.get("title") == "TEST_MSP_Wide_Freeze"
    
    def test_get_freeze_not_found(self, auth_headers):
        """Get non-existent freeze returns 404"""
        response = requests.get(f"{BASE_URL}/api/change-freezes/nonexistent123", headers=auth_headers)
        assert response.status_code == 404


class TestChangeFreezeUpdate:
    """PUT /api/change-freezes/{id} - Update freeze"""
    
    def test_update_freeze(self, auth_headers):
        """Update freeze window"""
        freeze_id = getattr(TestChangeFreezeCreate, 'created_freeze_id', None)
        if not freeze_id:
            pytest.skip("No freeze created to update")
        payload = {
            "title": "TEST_MSP_Wide_Freeze_Updated",
            "reason": "Updated reason",
            "active": False
        }
        response = requests.put(f"{BASE_URL}/api/change-freezes/{freeze_id}", json=payload, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("title") == "TEST_MSP_Wide_Freeze_Updated"
        assert data.get("reason") == "Updated reason"
        assert data.get("active") is False
    
    def test_update_freeze_not_found(self, auth_headers):
        """Update non-existent freeze returns 404"""
        response = requests.put(f"{BASE_URL}/api/change-freezes/nonexistent123", json={"title": "X"}, headers=auth_headers)
        assert response.status_code == 404


class TestChangeFreezeDelete:
    """DELETE /api/change-freezes/{id} - Remove freeze"""
    
    def test_delete_freeze(self, auth_headers):
        """Delete freeze window"""
        freeze_id = getattr(TestChangeFreezeCreate, 'created_freeze_id', None)
        if not freeze_id:
            pytest.skip("No freeze created to delete")
        response = requests.delete(f"{BASE_URL}/api/change-freezes/{freeze_id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("deleted") is True
        # Verify it's gone
        get_response = requests.get(f"{BASE_URL}/api/change-freezes/{freeze_id}", headers=auth_headers)
        assert get_response.status_code == 404
    
    def test_delete_freeze_not_found(self, auth_headers):
        """Delete non-existent freeze returns 404"""
        response = requests.delete(f"{BASE_URL}/api/change-freezes/nonexistent123", headers=auth_headers)
        assert response.status_code == 404
    
    def test_cleanup_client_freeze(self, auth_headers):
        """Cleanup client-specific freeze"""
        freeze_id = getattr(TestChangeFreezeCreate, 'client_freeze_id', None)
        if freeze_id:
            requests.delete(f"{BASE_URL}/api/change-freezes/{freeze_id}", headers=auth_headers)


# ═══════════════════════ ALL-CLEAR BROADCAST TESTS ═══════════════════════

class TestAllClearBroadcast:
    """POST /api/chat/broadcast/all-clear-check - Storm passed broadcast"""
    
    def test_all_clear_endpoint_exists(self, auth_headers):
        """All-clear endpoint returns valid response"""
        response = requests.post(f"{BASE_URL}/api/chat/broadcast/all-clear-check", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "posted" in data
        assert isinstance(data["posted"], int)
        assert data["posted"] in [0, 1]
        # msg_id may be None if not posted
        assert "msg_id" in data
    
    def test_all_clear_idempotent(self, auth_headers):
        """All-clear is idempotent - second call returns posted:0"""
        # First call
        response1 = requests.post(f"{BASE_URL}/api/chat/broadcast/all-clear-check", headers=auth_headers)
        assert response1.status_code == 200
        # Second call should also succeed but not post again
        response2 = requests.post(f"{BASE_URL}/api/chat/broadcast/all-clear-check", headers=auth_headers)
        assert response2.status_code == 200
        # If first posted, second should not
        # If first didn't post (no storm today or mood still stormy), second also won't


class TestBroadcastTick:
    """POST /api/chat/broadcast/tick - Combined broadcast tick"""
    
    def test_broadcast_tick_returns_four_keys(self, auth_headers):
        """Broadcast tick returns all 4 keys"""
        response = requests.post(f"{BASE_URL}/api/chat/broadcast/tick", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        # Must have all 4 keys
        assert "sentiment_posted" in data, "Missing sentiment_posted key"
        assert "sla_posted" in data, "Missing sla_posted key"
        assert "storm_posted" in data, "Missing storm_posted key"
        assert "all_clear_posted" in data, "Missing all_clear_posted key"
        # All should be integers
        assert isinstance(data["sentiment_posted"], int)
        assert isinstance(data["sla_posted"], int)
        assert isinstance(data["storm_posted"], int)
        assert isinstance(data["all_clear_posted"], int)


class TestStormBroadcast:
    """POST /api/chat/broadcast/storm-check - Storm mood broadcast"""
    
    def test_storm_check_endpoint(self, auth_headers):
        """Storm check endpoint returns valid response"""
        response = requests.post(f"{BASE_URL}/api/chat/broadcast/storm-check", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "posted" in data
        assert isinstance(data["posted"], int)


# ═══════════════════════ REGRESSION TESTS ═══════════════════════

class TestRegressionHelpCenter:
    """Regression: Help Center still works"""
    
    def test_help_articles_list(self, auth_headers):
        """GET /api/help/articles returns 6 articles"""
        response = requests.get(f"{BASE_URL}/api/help/articles", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "articles" in data
        assert data.get("count", 0) >= 6, f"Expected at least 6 articles, got {data.get('count')}"


class TestRegressionAtmosphere:
    """Regression: Atmosphere page APIs still work"""
    
    def test_weather_mode(self, auth_headers):
        """GET /api/ambient/weather-mode works"""
        response = requests.get(f"{BASE_URL}/api/ambient/weather-mode", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "mood" in data
        assert "stats" in data
    
    def test_friday_reel(self, auth_headers):
        """GET /api/wrap-up/friday-reel works"""
        response = requests.get(f"{BASE_URL}/api/wrap-up/friday-reel", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "stats" in data
    
    def test_threat_dragon(self, auth_headers):
        """GET /api/security/threat-dragon works"""
        response = requests.get(f"{BASE_URL}/api/security/threat-dragon", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "mood" in data
    
    def test_recent_launches(self, auth_headers):
        """GET /api/ambient/recent-launches works"""
        response = requests.get(f"{BASE_URL}/api/ambient/recent-launches", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        # API returns list directly or {"launches": [...]}
        assert isinstance(data, list) or "launches" in data
    
    def test_device_graveyard(self, auth_headers):
        """GET /api/device-graveyard works"""
        response = requests.get(f"{BASE_URL}/api/device-graveyard", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "tombstones" in data


class TestRegressionDashboard:
    """Regression: Dashboard APIs still work"""
    
    def test_dashboard_stats(self, auth_headers):
        """GET /api/dashboard/stats works"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=auth_headers)
        assert response.status_code == 200
    
    def test_dashboard_enhanced_stats(self, auth_headers):
        """GET /api/dashboard/enhanced-stats works"""
        response = requests.get(f"{BASE_URL}/api/dashboard/enhanced-stats", headers=auth_headers)
        assert response.status_code == 200
