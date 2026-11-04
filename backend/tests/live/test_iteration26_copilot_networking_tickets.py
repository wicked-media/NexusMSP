"""
Iteration 26 Tests - Co-Pilot, WLAN/DPI Networking, Tickets Rename, Settings Email Sig & Canned Responses
Features to test:
1. API: POST /api/ai/copilot returns AI response with session_id
2. API: GET /api/networking/sites/{id}/wlans returns WLAN list
3. API: GET /api/networking/sites/{id}/dpi returns DPI traffic data
4. API: POST /api/networking/sites/{id}/sync returns sync result
5. Settings page has email signature and canned responses endpoints
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        return data["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestCoPilotAPI(TestAuth):
    """Test Technician Co-Pilot AI chat endpoint"""
    
    def test_copilot_basic_message(self, headers):
        """POST /api/ai/copilot should return AI response with session_id"""
        payload = {
            "message": "What could cause a printer not to connect?",
            "session_id": "test-session-123",
            "ticket_context": {
                "title": "Printer Offline",
                "description": "Customer reports printer won't connect to network",
                "client_name": "Test Client",
                "category": "Hardware",
                "priority": "medium"
            }
        }
        response = requests.post(f"{BASE_URL}/api/ai/copilot", json=payload, headers=headers)
        assert response.status_code == 200, f"Copilot failed: {response.text}"
        data = response.json()
        assert "response" in data, "Response should have 'response' field"
        assert "session_id" in data, "Response should have 'session_id' field"
        assert data["session_id"] == "test-session-123"
        assert len(data["response"]) > 10, "AI response should be meaningful"
    
    def test_copilot_empty_message(self, headers):
        """POST /api/ai/copilot with empty message should return helpful response"""
        payload = {"message": "", "session_id": "test-empty"}
        response = requests.post(f"{BASE_URL}/api/ai/copilot", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "response" in data


class TestNetworkingSites(TestAuth):
    """Test Networking sites endpoints"""
    
    @pytest.fixture(scope="class")
    def site_id(self, headers):
        """Get first network site ID or seed demo data"""
        # Try to get existing sites
        response = requests.get(f"{BASE_URL}/api/networking/sites", headers=headers)
        assert response.status_code == 200
        sites = response.json()
        
        if not sites:
            # Seed demo data if no sites exist
            seed_response = requests.post(f"{BASE_URL}/api/networking/seed-demo", headers=headers)
            assert seed_response.status_code == 200
            # Fetch again
            response = requests.get(f"{BASE_URL}/api/networking/sites", headers=headers)
            sites = response.json()
        
        assert len(sites) > 0, "Should have at least one network site"
        return sites[0]["id"]
    
    def test_get_networking_sites(self, headers):
        """GET /api/networking/sites returns site list"""
        response = requests.get(f"{BASE_URL}/api/networking/sites", headers=headers)
        assert response.status_code == 200
        sites = response.json()
        assert isinstance(sites, list)
        if sites:
            site = sites[0]
            assert "id" in site
            assert "name" in site
    
    def test_get_site_wlans(self, headers, site_id):
        """GET /api/networking/sites/{id}/wlans returns WLAN list"""
        response = requests.get(f"{BASE_URL}/api/networking/sites/{site_id}/wlans", headers=headers)
        assert response.status_code == 200, f"WLAN fetch failed: {response.text}"
        wlans = response.json()
        assert isinstance(wlans, list), "WLANs should be a list"
        # Should have demo WLANs seeded
        assert len(wlans) > 0, "Should have at least one WLAN"
        wlan = wlans[0]
        assert "id" in wlan
        assert "ssid" in wlan
        assert "security" in wlan
        assert "vlan_id" in wlan
    
    def test_get_site_dpi(self, headers, site_id):
        """GET /api/networking/sites/{id}/dpi returns DPI traffic data"""
        response = requests.get(f"{BASE_URL}/api/networking/sites/{site_id}/dpi", headers=headers)
        assert response.status_code == 200, f"DPI fetch failed: {response.text}"
        dpi = response.json()
        assert "categories" in dpi, "DPI should have categories"
        assert isinstance(dpi["categories"], list)
        # Should have traffic categories
        assert len(dpi["categories"]) > 0, "Should have traffic categories"
        cat = dpi["categories"][0]
        assert "name" in cat
        assert "rx_bytes" in cat
        assert "tx_bytes" in cat
        assert "clients" in cat
    
    def test_sync_from_controller(self, headers, site_id):
        """POST /api/networking/sites/{id}/sync returns sync result"""
        response = requests.post(f"{BASE_URL}/api/networking/sites/{site_id}/sync", headers=headers)
        assert response.status_code == 200, f"Sync failed: {response.text}"
        data = response.json()
        # Sync may succeed or fail depending on controller config, but should return valid response
        assert "success" in data
        assert "message" in data
        assert "synced_devices" in data
        assert "synced_clients" in data


class TestNetworkingStats(TestAuth):
    """Test Networking statistics endpoints"""
    
    def test_get_networking_stats(self, headers):
        """GET /api/networking/stats returns stats"""
        response = requests.get(f"{BASE_URL}/api/networking/stats", headers=headers)
        assert response.status_code == 200
        stats = response.json()
        assert "total_sites" in stats
        assert "total_devices" in stats
        assert "total_clients" in stats
        assert "access_points" in stats
    
    def test_get_networking_dashboard(self, headers):
        """GET /api/networking/dashboard returns dashboard data"""
        response = requests.get(f"{BASE_URL}/api/networking/dashboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "summary" in data
        assert "site_bandwidth" in data
        assert "alerts" in data


class TestSettingsEmailSignatureAndCannedResponses(TestAuth):
    """Test email signature and canned responses endpoints"""
    
    def test_get_canned_responses(self, headers):
        """GET /api/canned-responses returns list"""
        response = requests.get(f"{BASE_URL}/api/canned-responses", headers=headers)
        assert response.status_code == 200
        canned = response.json()
        assert isinstance(canned, list)
    
    def test_create_canned_response(self, headers):
        """POST /api/canned-responses creates new response"""
        payload = {
            "title": "TEST_Welcome_Response",
            "content": "Thank you for contacting support. We are reviewing your request.",
            "category": "general"
        }
        response = requests.post(f"{BASE_URL}/api/canned-responses", json=payload, headers=headers)
        assert response.status_code in [200, 201], f"Create failed: {response.text}"
        data = response.json()
        assert "id" in data or "title" in data
    
    def test_update_user_email_signature(self, headers):
        """PUT /api/users/{id} updates email signature"""
        # First get user ID from login
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        user_id = login_resp.json()["user"]["id"]
        
        payload = {
            "email_signature": "<p><strong>Alex Thompson</strong><br/>Service Manager | NexusOps MSP<br/>Phone: +1 (555) 123-4567</p>"
        }
        response = requests.put(f"{BASE_URL}/api/users/{user_id}", json=payload, headers=headers)
        assert response.status_code == 200, f"Update signature failed: {response.text}"
        
        # Verify signature was saved via GET /api/users (list)
        get_resp = requests.get(f"{BASE_URL}/api/users", headers=headers)
        assert get_resp.status_code == 200
        users = get_resp.json()
        user_data = next((u for u in users if u["id"] == user_id), None)
        assert user_data is not None
        assert user_data.get("email_signature") == payload["email_signature"]


class TestTicketsEndpoint(TestAuth):
    """Test tickets endpoint naming"""
    
    def test_tickets_endpoint_exists(self, headers):
        """GET /api/tickets should work"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200
        tickets = response.json()
        assert isinstance(tickets, list)


class TestCleanup(TestAuth):
    """Cleanup test data"""
    
    def test_cleanup_test_canned_responses(self, headers):
        """Clean up test canned responses"""
        response = requests.get(f"{BASE_URL}/api/canned-responses", headers=headers)
        if response.status_code == 200:
            canned_list = response.json()
            for cr in canned_list:
                if cr.get("title", "").startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/canned-responses/{cr['id']}", headers=headers)
        assert True  # Always pass cleanup


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
