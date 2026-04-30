"""
Iteration 120: UniFi Site Manager Integration Tests
Tests for /api/unifi/* endpoints including settings, status, test, sites, hosts, devices, clients, alerts, networks, events, summary, and linked-clients.
Also tests /api/clients/{id}/link-unifi-site (POST/DELETE) for linking UniFi sites to NexusOps clients.
"""
import pytest
import requests
import os

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
    pytest.skip("Authentication failed - skipping tests")

@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers for API requests"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestUnifiStatusInitial:
    """Test UniFi status endpoint returns correct initial state"""
    
    def test_unifi_status_returns_not_configured_initially(self, headers):
        """GET /api/unifi/status should return configured:false and default base_url initially"""
        # First ensure we're in a clean state by deleting any existing settings
        requests.delete(f"{BASE_URL}/api/unifi/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/unifi/status", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("configured") == False, f"Expected configured=False, got {data}"
        assert data.get("base_url") == "https://api.ui.com/ea", f"Expected default base_url, got {data.get('base_url')}"
        print(f"PASS: UniFi status returns configured=False with default base_url")
    
    def test_unifi_settings_alias_of_status(self, headers):
        """GET /api/unifi/settings should return same data as /api/unifi/status"""
        response = requests.get(f"{BASE_URL}/api/unifi/settings", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert "configured" in data
        assert "base_url" in data
        print(f"PASS: UniFi settings endpoint works as alias of status")


class TestUnifiSettingsSaveAndDelete:
    """Test saving and deleting UniFi credentials"""
    
    def test_save_unifi_settings_success(self, headers):
        """POST /api/unifi/settings saves credentials and returns success"""
        payload = {
            "base_url": "https://api.ui.com/ea",
            "api_key": "test_fake_api_key_1234"
        }
        response = requests.post(f"{BASE_URL}/api/unifi/settings", json=payload, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data
        assert "saved" in data["message"].lower()
        print(f"PASS: UniFi settings saved successfully")
    
    def test_status_after_save_shows_configured(self, headers):
        """GET /api/unifi/status after save returns configured:true with api_key_preview"""
        response = requests.get(f"{BASE_URL}/api/unifi/status", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("configured") == True, f"Expected configured=True, got {data}"
        assert data.get("api_key_preview") is not None, "Expected api_key_preview to be set"
        # Preview should show last 4 chars
        assert "1234" in data.get("api_key_preview", ""), f"Expected preview to contain last 4 chars, got {data.get('api_key_preview')}"
        print(f"PASS: UniFi status shows configured=True with api_key_preview: {data.get('api_key_preview')}")
    
    def test_save_without_api_key_fails(self, headers):
        """POST /api/unifi/settings without api_key returns 400"""
        payload = {"base_url": "https://api.ui.com/ea"}
        response = requests.post(f"{BASE_URL}/api/unifi/settings", json=payload, headers=headers)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print(f"PASS: Save without api_key correctly returns 400")
    
    def test_delete_unifi_settings(self, headers):
        """DELETE /api/unifi/settings removes credentials"""
        response = requests.delete(f"{BASE_URL}/api/unifi/settings", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "removed" in data.get("message", "").lower() or "deleted" in data.get("message", "").lower()
        print(f"PASS: UniFi settings deleted successfully")
    
    def test_status_after_delete_shows_not_configured(self, headers):
        """GET /api/unifi/status after delete returns configured:false"""
        response = requests.get(f"{BASE_URL}/api/unifi/status", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("configured") == False, f"Expected configured=False after delete, got {data}"
        print(f"PASS: UniFi status shows configured=False after delete")


class TestUnifiTestConnection:
    """Test the /api/unifi/test endpoint"""
    
    def test_test_connection_not_configured(self, headers):
        """GET /api/unifi/test when not configured returns success:false"""
        # Ensure not configured
        requests.delete(f"{BASE_URL}/api/unifi/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/unifi/test", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("success") == False, f"Expected success=False, got {data}"
        assert "not configured" in data.get("message", "").lower()
        print(f"PASS: Test connection returns success=False when not configured")
    
    def test_test_connection_with_fake_key_fails(self, headers):
        """GET /api/unifi/test with fake key returns success:false and updates last_test_status"""
        # Save fake credentials
        payload = {"api_key": "fake_key_for_testing_5678"}
        requests.post(f"{BASE_URL}/api/unifi/settings", json=payload, headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/unifi/test", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("success") == False, f"Expected success=False with fake key, got {data}"
        print(f"PASS: Test connection with fake key returns success=False: {data.get('message', '')[:100]}")
        
        # Verify last_test_status was updated
        status_response = requests.get(f"{BASE_URL}/api/unifi/status", headers=headers)
        status_data = status_response.json()
        assert status_data.get("last_test_status") is not None, "Expected last_test_status to be set"
        assert status_data.get("last_tested_at") is not None, "Expected last_tested_at to be set"
        print(f"PASS: last_test_status updated to: {status_data.get('last_test_status')}")


class TestUnifiDataEndpointsNotConfigured:
    """Test that data endpoints return 503 when not configured"""
    
    def test_sites_returns_503_when_not_configured(self, headers):
        """GET /api/unifi/sites returns 503 when not configured"""
        requests.delete(f"{BASE_URL}/api/unifi/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/unifi/sites", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print(f"PASS: /unifi/sites returns 503 when not configured")
    
    def test_hosts_returns_503_when_not_configured(self, headers):
        """GET /api/unifi/hosts returns 503 when not configured"""
        response = requests.get(f"{BASE_URL}/api/unifi/hosts", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print(f"PASS: /unifi/hosts returns 503 when not configured")
    
    def test_site_devices_returns_503_when_not_configured(self, headers):
        """GET /api/unifi/sites/{id}/devices returns 503 when not configured"""
        response = requests.get(f"{BASE_URL}/api/unifi/sites/test-site-id/devices", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print(f"PASS: /unifi/sites/{id}/devices returns 503 when not configured")
    
    def test_site_clients_returns_503_when_not_configured(self, headers):
        """GET /api/unifi/sites/{id}/clients returns 503 when not configured"""
        response = requests.get(f"{BASE_URL}/api/unifi/sites/test-site-id/clients", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print(f"PASS: /unifi/sites/{id}/clients returns 503 when not configured")
    
    def test_site_alerts_returns_503_when_not_configured(self, headers):
        """GET /api/unifi/sites/{id}/alerts returns 503 when not configured"""
        response = requests.get(f"{BASE_URL}/api/unifi/sites/test-site-id/alerts", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print(f"PASS: /unifi/sites/{id}/alerts returns 503 when not configured")
    
    def test_site_networks_returns_503_when_not_configured(self, headers):
        """GET /api/unifi/sites/{id}/networks returns 503 when not configured"""
        response = requests.get(f"{BASE_URL}/api/unifi/sites/test-site-id/networks", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print(f"PASS: /unifi/sites/{id}/networks returns 503 when not configured")
    
    def test_site_events_returns_503_when_not_configured(self, headers):
        """GET /api/unifi/sites/{id}/events returns 503 when not configured"""
        response = requests.get(f"{BASE_URL}/api/unifi/sites/test-site-id/events", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print(f"PASS: /unifi/sites/{id}/events returns 503 when not configured")


class TestUnifiSummaryNotConfigured:
    """Test /api/unifi/summary when not configured"""
    
    def test_summary_returns_not_configured_message(self, headers):
        """GET /api/unifi/summary when not configured returns configured:false with message"""
        requests.delete(f"{BASE_URL}/api/unifi/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/unifi/summary", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("configured") == False, f"Expected configured=False, got {data}"
        assert "message" in data, "Expected message field in response"
        print(f"PASS: /unifi/summary returns configured=False with message: {data.get('message')}")


class TestUnifiLinkedClients:
    """Test /api/unifi/linked-clients endpoint"""
    
    def test_linked_clients_returns_empty_array_initially(self, headers):
        """GET /api/unifi/linked-clients returns [] when no clients linked"""
        response = requests.get(f"{BASE_URL}/api/unifi/linked-clients", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"PASS: /unifi/linked-clients returns array (length: {len(data)})")


class TestUnifiLinkClientSite:
    """Test linking/unlinking UniFi sites to NexusOps clients"""
    
    def test_link_unifi_site_to_client(self, headers):
        """POST /api/clients/{id}/link-unifi-site links a site to a client"""
        payload = {
            "site_id": "TEST_unifi_site_001",
            "site_name": "Test UniFi Site",
            "host_id": "TEST_host_001"
        }
        response = requests.post(f"{BASE_URL}/api/clients/client-001/link-unifi-site", json=payload, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "linked" in data.get("message", "").lower()
        assert data.get("client_id") == "client-001"
        assert data.get("site_id") == "TEST_unifi_site_001"
        print(f"PASS: UniFi site linked to client-001")
    
    def test_client_has_unifi_integration_flag(self, headers):
        """After linking, client should have integrations.unifi=true"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        integrations = data.get("integrations", {})
        assert integrations.get("unifi") == True, f"Expected integrations.unifi=True, got {integrations}"
        assert data.get("unifi_site_id") == "TEST_unifi_site_001"
        assert data.get("unifi_site_name") == "Test UniFi Site"
        print(f"PASS: Client has integrations.unifi=True and unifi_site_id set")
    
    def test_linked_clients_includes_newly_linked(self, headers):
        """GET /api/unifi/linked-clients returns array with freshly linked client"""
        response = requests.get(f"{BASE_URL}/api/unifi/linked-clients", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        # Find client-001 in the list
        linked_client = next((c for c in data if c.get("id") == "client-001"), None)
        assert linked_client is not None, f"Expected client-001 in linked clients, got {data}"
        assert linked_client.get("unifi_site_id") == "TEST_unifi_site_001"
        print(f"PASS: /unifi/linked-clients includes client-001 with correct site_id")
    
    def test_unlink_unifi_site_from_client(self, headers):
        """DELETE /api/clients/{id}/link-unifi-site unlinks and sets integrations.unifi=false"""
        response = requests.delete(f"{BASE_URL}/api/clients/client-001/link-unifi-site", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "unlinked" in data.get("message", "").lower()
        print(f"PASS: UniFi site unlinked from client-001")
    
    def test_client_unifi_flag_false_after_unlink(self, headers):
        """After unlinking, client should have integrations.unifi=false"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        integrations = data.get("integrations", {})
        assert integrations.get("unifi") == False, f"Expected integrations.unifi=False, got {integrations}"
        assert data.get("unifi_site_id") is None or data.get("unifi_site_id") == ""
        print(f"PASS: Client has integrations.unifi=False after unlink")
    
    def test_link_requires_site_id(self, headers):
        """POST /api/clients/{id}/link-unifi-site without site_id returns 400"""
        payload = {"site_name": "Test Site"}
        response = requests.post(f"{BASE_URL}/api/clients/client-001/link-unifi-site", json=payload, headers=headers)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print(f"PASS: Link without site_id correctly returns 400")
    
    def test_link_nonexistent_client_returns_404(self, headers):
        """POST /api/clients/{id}/link-unifi-site for nonexistent client returns 404"""
        payload = {"site_id": "test-site"}
        response = requests.post(f"{BASE_URL}/api/clients/nonexistent-client-xyz/link-unifi-site", json=payload, headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"PASS: Link to nonexistent client correctly returns 404")


class TestUnifiAuthRequired:
    """Test that all UniFi endpoints require authentication"""
    
    def test_status_requires_auth(self):
        """GET /api/unifi/status without auth returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/unifi/status")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: /unifi/status requires auth")
    
    def test_settings_post_requires_auth(self):
        """POST /api/unifi/settings without auth returns 401/403"""
        response = requests.post(f"{BASE_URL}/api/unifi/settings", json={"api_key": "test"})
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: POST /unifi/settings requires auth")
    
    def test_test_requires_auth(self):
        """GET /api/unifi/test without auth returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/unifi/test")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: /unifi/test requires auth")
    
    def test_summary_requires_auth(self):
        """GET /api/unifi/summary without auth returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/unifi/summary")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: /unifi/summary requires auth")
    
    def test_linked_clients_requires_auth(self):
        """GET /api/unifi/linked-clients without auth returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/unifi/linked-clients")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: /unifi/linked-clients requires auth")


class TestCleanup:
    """Cleanup test data after all tests"""
    
    def test_cleanup_unifi_settings(self, headers):
        """Remove any test UniFi settings"""
        requests.delete(f"{BASE_URL}/api/unifi/settings", headers=headers)
        print(f"PASS: Cleanup - UniFi settings removed")
    
    def test_cleanup_client_unifi_link(self, headers):
        """Ensure client-001 is unlinked from any UniFi site"""
        requests.delete(f"{BASE_URL}/api/clients/client-001/link-unifi-site", headers=headers)
        
        # Verify cleanup
        response = requests.get(f"{BASE_URL}/api/clients/client-001", headers=headers)
        if response.status_code == 200:
            data = response.json()
            assert data.get("unifi_site_id") is None or data.get("unifi_site_id") == ""
        print(f"PASS: Cleanup - client-001 UniFi link removed")
