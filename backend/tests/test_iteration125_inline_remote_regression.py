"""
Iteration 125: Inline Remote Button Backend Regression Testing
Tests that backend endpoints used by the new inline Remote button on DevicesPage still work.

The frontend change adds RemoteAccessButton inline on each device row/card, which calls:
1. GET /api/devices - returns 135 device list (regression)
2. GET /api/remote-providers/active - returns configured providers (used by DevicesPage for inline buttons)
3. POST /api/rustdesk/quick-connect - for devices with rustdesk_id (regression)
4. GET /api/trmm/agents/{id}/remote-url - returns 503 when TRMM not configured, 200 when configured (regression)
5. Smoke: /api/health, /api/auth/login, /api/trmm/status, /api/remote-providers all still 200 OK
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for tests"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if response.status_code == 200:
        data = response.json()
        return data.get("token") or data.get("access_token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text[:200]}")


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    """Headers with auth token"""
    return {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }


class TestHealthAndAuthSmoke:
    """Smoke tests for basic endpoints"""
    
    def test_health_endpoint(self):
        """GET /api/health should return 200 OK"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health check failed: {response.text}"
        data = response.json()
        assert data.get("status") == "ok"
        print("PASS: GET /api/health returns 200 OK")
    
    def test_auth_login(self):
        """POST /api/auth/login should return 200 with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.status_code} - {response.text}"
        data = response.json()
        assert "token" in data or "access_token" in data, "Missing token in login response"
        print("PASS: POST /api/auth/login returns 200 with token")


class TestDevicesEndpoint:
    """Test GET /api/devices returns the device list (regression)"""
    
    def test_devices_returns_list(self, auth_headers):
        """GET /api/devices should return a list of devices"""
        response = requests.get(f"{BASE_URL}/api/devices", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"PASS: GET /api/devices returns list with {len(data)} devices")
        
        # Verify we have a reasonable number of devices (should be ~135 per spec)
        assert len(data) >= 100, f"Expected at least 100 devices, got {len(data)}"
        print(f"  Device count: {len(data)} (expected ~135)")
    
    def test_devices_have_required_fields(self, auth_headers):
        """Devices should have fields needed by RemoteAccessButton"""
        response = requests.get(f"{BASE_URL}/api/devices", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        if len(data) > 0:
            device = data[0]
            # Fields used by RemoteAccessButton
            assert "id" in device, "Device missing 'id' field"
            assert "name" in device, "Device missing 'name' field"
            assert "status" in device, "Device missing 'status' field"
            # Optional fields that RemoteAccessButton checks
            # rustdesk_id and trmm_agent_id may or may not be present
            print(f"PASS: Device has required fields: id, name, status")
            
            # Count devices with rustdesk_id
            devices_with_rustdesk = [d for d in data if d.get("rustdesk_id")]
            print(f"  Devices with rustdesk_id: {len(devices_with_rustdesk)}")
            
            # Count devices with trmm_agent_id
            devices_with_trmm = [d for d in data if d.get("trmm_agent_id")]
            print(f"  Devices with trmm_agent_id: {len(devices_with_trmm)}")


class TestRemoteProvidersActiveEndpoint:
    """Test GET /api/remote-providers/active (used by DevicesPage for inline buttons)"""
    
    def test_active_providers_returns_list(self, auth_headers):
        """GET /api/remote-providers/active should return a list"""
        response = requests.get(f"{BASE_URL}/api/remote-providers/active", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"PASS: GET /api/remote-providers/active returns list with {len(data)} providers")
        print(f"  Active providers: {[p.get('id') for p in data]}")
    
    def test_active_providers_requires_auth(self):
        """GET /api/remote-providers/active should require authentication"""
        response = requests.get(f"{BASE_URL}/api/remote-providers/active")
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"
        print("PASS: GET /api/remote-providers/active requires authentication")


class TestRemoteProvidersFullList:
    """Test GET /api/remote-providers (full list regression)"""
    
    def test_remote_providers_returns_list(self, auth_headers):
        """GET /api/remote-providers should return the full provider list"""
        response = requests.get(f"{BASE_URL}/api/remote-providers", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Should have all supported providers
        provider_ids = [p.get("id") for p in data]
        expected_providers = ["rustdesk", "meshcentral", "splashtop", "screenconnect", "teamviewer", "anydesk", "guacamole"]
        
        for expected_id in expected_providers:
            assert expected_id in provider_ids, f"Missing provider '{expected_id}' in response"
        
        print(f"PASS: GET /api/remote-providers returns {len(data)} providers")


class TestRustDeskQuickConnect:
    """Test POST /api/rustdesk/quick-connect (used by inline button for devices with rustdesk_id)"""
    
    def test_quick_connect_with_valid_rustdesk_id(self, auth_headers):
        """POST /api/rustdesk/quick-connect should work with a valid rustdesk_id"""
        # First find a device with rustdesk_id
        devices_response = requests.get(f"{BASE_URL}/api/devices", headers=auth_headers)
        devices = devices_response.json()
        
        device_with_rustdesk = next((d for d in devices if d.get("rustdesk_id")), None)
        
        if device_with_rustdesk:
            rustdesk_id = device_with_rustdesk.get("rustdesk_id")
            response = requests.post(f"{BASE_URL}/api/rustdesk/quick-connect", 
                                     headers=auth_headers, 
                                     json={"rustdesk_id": rustdesk_id})
            # Should return 200 with relay_server info or 200 with just success
            assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
            data = response.json()
            print(f"PASS: POST /api/rustdesk/quick-connect returns 200 for rustdesk_id={rustdesk_id}")
            print(f"  Response: {data}")
        else:
            pytest.skip("No device with rustdesk_id found to test quick-connect")
    
    def test_quick_connect_requires_auth(self):
        """POST /api/rustdesk/quick-connect should require authentication"""
        response = requests.post(f"{BASE_URL}/api/rustdesk/quick-connect", 
                                 json={"rustdesk_id": "test123"})
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"
        print("PASS: POST /api/rustdesk/quick-connect requires authentication")


class TestTrmmRemoteUrl:
    """Test GET /api/trmm/agents/{id}/remote-url (used by inline button for TRMM-linked devices)"""
    
    def test_trmm_remote_url_not_configured(self, auth_headers):
        """GET /api/trmm/agents/{id}/remote-url should indicate TRMM not configured"""
        # Ensure TRMM is not configured
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        
        # Try to get remote URL for a fake agent ID
        response = requests.get(f"{BASE_URL}/api/trmm/agents/fake-agent-123/remote-url", headers=auth_headers)
        # May return 503 directly OR 200 with success:false and status:503 in body
        if response.status_code == 200:
            data = response.json()
            # Check if it's a wrapped error response
            assert data.get("success") == False or data.get("status") == 503 or "not configured" in data.get("message", "").lower(), \
                f"Expected error indication in response: {data}"
            print(f"PASS: GET /api/trmm/agents/{{id}}/remote-url returns 200 with success=false when TRMM not configured")
        else:
            assert response.status_code in [503, 404, 400], f"Expected 503/404/400, got {response.status_code}: {response.text}"
            print(f"PASS: GET /api/trmm/agents/{{id}}/remote-url returns {response.status_code} when TRMM not configured")
    
    def test_trmm_remote_url_requires_auth(self):
        """GET /api/trmm/agents/{id}/remote-url should require authentication"""
        response = requests.get(f"{BASE_URL}/api/trmm/agents/fake-agent-123/remote-url")
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"
        print("PASS: GET /api/trmm/agents/{id}/remote-url requires authentication")


class TestTrmmStatusRegression:
    """Test GET /api/trmm/status (regression from iteration 123)"""
    
    def test_trmm_status_endpoint(self, auth_headers):
        """GET /api/trmm/status should return expected shape"""
        response = requests.get(f"{BASE_URL}/api/trmm/status", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "configured" in data, "Missing 'configured' field"
        assert "base_url" in data, "Missing 'base_url' field"
        print(f"PASS: GET /api/trmm/status returns expected shape: configured={data.get('configured')}")


class TestTrmmAutoLinkRegression:
    """Test POST /api/trmm/auto-link (regression from iteration 123)"""
    
    def test_trmm_auto_link_not_configured(self, auth_headers):
        """POST /api/trmm/auto-link should return 503 when not configured"""
        # Ensure clean state
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        
        response = requests.post(f"{BASE_URL}/api/trmm/auto-link", headers=auth_headers, json={})
        assert response.status_code == 503, f"Expected 503 when not configured, got {response.status_code}: {response.text}"
        data = response.json()
        assert "not configured" in data.get("detail", "").lower(), f"Expected 'not configured' in detail: {data}"
        print("PASS: POST /api/trmm/auto-link returns 503 when not configured")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
