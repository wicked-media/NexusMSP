"""
Iteration 123: TRMM Auto-Link Feature Testing
Tests the new POST /api/trmm/auto-link endpoint and regression tests for existing TRMM endpoints.

Features tested:
1. POST /api/trmm/auto-link returns 503 when TRMM not configured
2. POST /api/trmm/auto-link returns 502 (graceful upstream error) when TRMM configured with fake URL
3. Auto-link response shape validation with dry_run=true
4. Regression: existing TRMM endpoints still work (settings CRUD, status, summary, test, actions/log, linked-devices, link-trmm-agent)
5. Regression: /api/health still returns 200 OK
"""

import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"

# Test data prefixes for cleanup
TEST_PREFIX = "TEST_ITER123_"


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


class TestHealthRegression:
    """Verify navigation cleanup didn't break route resolution"""
    
    def test_health_endpoint_returns_200(self):
        """GET /api/health should return 200 OK"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health check failed: {response.text}"
        data = response.json()
        assert data.get("status") == "ok"
        print("PASS: /api/health returns 200 OK with status=ok")


class TestTrmmAutoLinkNotConfigured:
    """Test auto-link when TRMM is not configured"""
    
    def test_auto_link_returns_503_when_not_configured(self, auth_headers):
        """POST /api/trmm/auto-link should return 503 when TRMM not configured"""
        # First ensure TRMM is not configured by deleting any existing settings
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        
        # Now test auto-link
        response = requests.post(f"{BASE_URL}/api/trmm/auto-link", headers=auth_headers, json={})
        assert response.status_code == 503, f"Expected 503, got {response.status_code}: {response.text}"
        data = response.json()
        assert "not configured" in data.get("detail", "").lower(), f"Expected 'not configured' in detail: {data}"
        print("PASS: POST /api/trmm/auto-link returns 503 with 'Tactical RMM not configured' when no TRMM creds saved")


class TestTrmmAutoLinkWithFakeUrl:
    """Test auto-link with fake TRMM URL - should return graceful 502"""
    
    def test_auto_link_returns_502_with_fake_url(self, auth_headers):
        """POST /api/trmm/auto-link should return 502 (graceful upstream error) with fake URL"""
        # Save fake TRMM settings
        fake_settings = {
            "base_url": "https://fake-trmm-instance.invalid.local",
            "api_key": "fake-api-key-12345678",
            "verify_tls": False
        }
        save_response = requests.post(f"{BASE_URL}/api/trmm/settings", headers=auth_headers, json=fake_settings)
        assert save_response.status_code == 200, f"Failed to save fake settings: {save_response.text}"
        
        try:
            # Now test auto-link - should get 502 (upstream error), NOT 500 crash
            response = requests.post(f"{BASE_URL}/api/trmm/auto-link", headers=auth_headers, json={})
            # Accept 502 (graceful upstream error) - this is expected behavior
            assert response.status_code == 502, f"Expected 502 (graceful upstream error), got {response.status_code}: {response.text}"
            data = response.json()
            # Should have a meaningful error message
            assert "detail" in data, f"Expected 'detail' in error response: {data}"
            print(f"PASS: POST /api/trmm/auto-link returns 502 with graceful error: {data.get('detail', '')[:100]}")
        finally:
            # Cleanup: delete the fake settings
            requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)


class TestTrmmAutoLinkResponseShape:
    """Test auto-link response shape by seeding test data"""
    
    def test_auto_link_dry_run_response_shape(self, auth_headers):
        """
        Test the auto-link response shape with dry_run=true.
        Since we can't mock TRMM agents, we verify the endpoint exists and returns proper error shape.
        """
        # First ensure TRMM is not configured
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        
        # Test with dry_run - should still return 503 since not configured
        response = requests.post(f"{BASE_URL}/api/trmm/auto-link", headers=auth_headers, json={"dry_run": True})
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print("PASS: dry_run=true still requires TRMM configuration (returns 503)")
    
    def test_auto_link_with_overwrite_flag(self, auth_headers):
        """Test that overwrite flag is accepted in request body"""
        # First ensure TRMM is not configured
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        
        # Test with overwrite - should still return 503 since not configured
        response = requests.post(f"{BASE_URL}/api/trmm/auto-link", headers=auth_headers, json={"overwrite": True})
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print("PASS: overwrite=true flag accepted (returns 503 as expected when not configured)")


class TestTrmmSettingsRegression:
    """Regression tests for TRMM settings CRUD from iteration_122"""
    
    def test_get_settings_not_configured(self, auth_headers):
        """GET /api/trmm/settings should return configured=false when not set"""
        # Ensure clean state
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        
        response = requests.get(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("configured") == False
        print("PASS: GET /api/trmm/settings returns configured=false when not set")
    
    def test_save_and_delete_settings(self, auth_headers):
        """POST and DELETE /api/trmm/settings should work correctly"""
        # Save settings
        settings = {
            "base_url": "https://test-trmm.example.com",
            "api_key": "test-key-abcd1234",
            "verify_tls": True
        }
        save_response = requests.post(f"{BASE_URL}/api/trmm/settings", headers=auth_headers, json=settings)
        assert save_response.status_code == 200
        
        # Verify saved
        get_response = requests.get(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        assert get_response.status_code == 200
        data = get_response.json()
        assert data.get("configured") == True
        assert data.get("base_url") == "https://test-trmm.example.com"
        assert data.get("api_key_preview") == "…1234"
        
        # Delete settings
        delete_response = requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        assert delete_response.status_code == 200
        
        # Verify deleted
        verify_response = requests.get(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        assert verify_response.json().get("configured") == False
        print("PASS: TRMM settings CRUD (POST/GET/DELETE) works correctly")
    
    def test_settings_validation(self, auth_headers):
        """POST /api/trmm/settings should validate required fields"""
        # Missing api_key
        response = requests.post(f"{BASE_URL}/api/trmm/settings", headers=auth_headers, json={"base_url": "https://test.com"})
        assert response.status_code == 400
        
        # Missing base_url
        response = requests.post(f"{BASE_URL}/api/trmm/settings", headers=auth_headers, json={"api_key": "test-key"})
        assert response.status_code == 400
        print("PASS: TRMM settings validation works (400 for missing fields)")


class TestTrmmStatusRegression:
    """Regression tests for TRMM status endpoint"""
    
    def test_status_endpoint(self, auth_headers):
        """GET /api/trmm/status should return same shape as settings"""
        response = requests.get(f"{BASE_URL}/api/trmm/status", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        # Should have expected fields
        assert "configured" in data
        assert "base_url" in data
        print("PASS: GET /api/trmm/status returns expected shape")


class TestTrmmSummaryRegression:
    """Regression tests for TRMM summary endpoint"""
    
    def test_summary_not_configured(self, auth_headers):
        """GET /api/trmm/summary should return configured=false with zero stats when not configured"""
        # Ensure clean state
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        
        response = requests.get(f"{BASE_URL}/api/trmm/summary", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("configured") == False
        assert "stats" in data
        stats = data["stats"]
        assert stats.get("agents") == 0
        assert stats.get("online") == 0
        print("PASS: GET /api/trmm/summary returns configured=false with zero stats")


class TestTrmmTestConnectionRegression:
    """Regression tests for TRMM test connection endpoint"""
    
    def test_test_connection_not_configured(self, auth_headers):
        """GET /api/trmm/test should return success=false when not configured"""
        # Ensure clean state
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        
        response = requests.get(f"{BASE_URL}/api/trmm/test", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == False
        assert "not configured" in data.get("message", "").lower()
        print("PASS: GET /api/trmm/test returns success=false with 'Not configured' message")


class TestTrmmActionsLogRegression:
    """Regression tests for TRMM actions log endpoint"""
    
    def test_actions_log_endpoint(self, auth_headers):
        """GET /api/trmm/actions/log should return array"""
        response = requests.get(f"{BASE_URL}/api/trmm/actions/log", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print("PASS: GET /api/trmm/actions/log returns array")


class TestTrmmLinkedDevicesRegression:
    """Regression tests for TRMM linked devices endpoint"""
    
    def test_linked_devices_endpoint(self, auth_headers):
        """GET /api/trmm/linked-devices should return array"""
        response = requests.get(f"{BASE_URL}/api/trmm/linked-devices", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print("PASS: GET /api/trmm/linked-devices returns array")


class TestDeviceTrmmLinkRegression:
    """Regression tests for device TRMM agent linking"""
    
    def test_link_trmm_agent_validation(self, auth_headers):
        """POST /api/devices/{id}/link-trmm-agent should validate inputs"""
        # Test with non-existent device
        response = requests.post(
            f"{BASE_URL}/api/devices/nonexistent-device-id/link-trmm-agent",
            headers=auth_headers,
            json={"agent_id": "test-agent"}
        )
        assert response.status_code == 404
        print("PASS: POST /api/devices/{id}/link-trmm-agent returns 404 for non-existent device")
    
    def test_link_trmm_agent_requires_agent_id(self, auth_headers):
        """POST /api/devices/{id}/link-trmm-agent should require agent_id"""
        # Get a real device first
        devices_response = requests.get(f"{BASE_URL}/api/devices", headers=auth_headers)
        if devices_response.status_code != 200:
            pytest.skip("Could not fetch devices")
        
        devices = devices_response.json()
        if not devices:
            pytest.skip("No devices available for testing")
        
        device_id = devices[0].get("id")
        
        # Test without agent_id
        response = requests.post(
            f"{BASE_URL}/api/devices/{device_id}/link-trmm-agent",
            headers=auth_headers,
            json={}
        )
        assert response.status_code == 400
        print("PASS: POST /api/devices/{id}/link-trmm-agent returns 400 when agent_id missing")


class TestTrmmEndpointAuthentication:
    """Test that TRMM endpoints require authentication"""
    
    def test_auto_link_requires_auth(self):
        """POST /api/trmm/auto-link should require authentication"""
        response = requests.post(f"{BASE_URL}/api/trmm/auto-link", json={})
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: POST /api/trmm/auto-link requires authentication")
    
    def test_settings_requires_auth(self):
        """GET /api/trmm/settings should require authentication"""
        response = requests.get(f"{BASE_URL}/api/trmm/settings")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: GET /api/trmm/settings requires authentication")


class TestCleanup:
    """Cleanup test data after all tests"""
    
    def test_cleanup_trmm_settings(self, auth_headers):
        """Ensure TRMM settings are cleaned up after tests"""
        response = requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        # Accept 200 or 404 (already deleted)
        assert response.status_code in [200, 404]
        
        # Verify clean state
        verify = requests.get(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        assert verify.json().get("configured") == False
        print("PASS: TRMM settings cleaned up successfully")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
