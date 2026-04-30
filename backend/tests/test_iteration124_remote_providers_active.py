"""
Iteration 124: Remote Providers Active Endpoint Testing
Tests the new GET /api/remote-providers/active endpoint that returns currently active+configured providers.

Features tested:
1. GET /api/remote-providers/active returns a list (200 OK) of currently active+configured providers
2. When TRMM is saved (POST /api/trmm/settings with base_url + api_key), /api/remote-providers/active includes TRMM entry
3. When TRMM is removed (DELETE /api/trmm/settings), /api/remote-providers/active no longer includes the trmm entry
4. RustDesk detection: if there's a settings doc with key='rustdesk_config' and value.server_url + value.enabled!=false, the rustdesk entry appears
5. Auth required (401 when no token)
6. Regression: the original GET /api/remote-providers still works and returns the full SUPPORTED_PROVIDERS list
7. Existing TRMM endpoints from prev iterations still pass: /api/trmm/status, /api/trmm/summary, /api/trmm/test, /api/trmm/auto-link
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


class TestRemoteProvidersActiveEndpoint:
    """Test the new GET /api/remote-providers/active endpoint"""
    
    def test_active_providers_returns_list(self, auth_headers):
        """GET /api/remote-providers/active should return a list (200 OK)"""
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


class TestTrmmInActiveProviders:
    """Test TRMM appears in /api/remote-providers/active when configured"""
    
    def test_trmm_appears_when_configured(self, auth_headers):
        """When TRMM is saved, /api/remote-providers/active should include TRMM entry"""
        # First ensure TRMM is not configured
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        
        # Verify TRMM is NOT in active providers initially
        initial_response = requests.get(f"{BASE_URL}/api/remote-providers/active", headers=auth_headers)
        assert initial_response.status_code == 200
        initial_providers = initial_response.json()
        trmm_ids = [p.get("id") for p in initial_providers if p.get("id") == "trmm"]
        assert len(trmm_ids) == 0, f"TRMM should not be in active providers when not configured: {initial_providers}"
        print("PASS: TRMM not in active providers when not configured")
        
        # Save TRMM settings
        save_response = requests.post(f"{BASE_URL}/api/trmm/settings", headers=auth_headers, json={
            "base_url": "https://test-trmm-iter124.example.com",
            "api_key": "TEST_API_KEY_ITER124_1234",
            "verify_tls": False
        })
        assert save_response.status_code == 200, f"Failed to save TRMM settings: {save_response.text}"
        
        try:
            # Verify TRMM IS in active providers now
            after_response = requests.get(f"{BASE_URL}/api/remote-providers/active", headers=auth_headers)
            assert after_response.status_code == 200
            after_providers = after_response.json()
            
            trmm_entry = next((p for p in after_providers if p.get("id") == "trmm"), None)
            assert trmm_entry is not None, f"TRMM should be in active providers after configuration: {after_providers}"
            
            # Verify TRMM entry shape
            assert trmm_entry.get("name") == "Tactical RMM", f"Expected name='Tactical RMM', got {trmm_entry.get('name')}"
            assert trmm_entry.get("kind") == "rmm", f"Expected kind='rmm', got {trmm_entry.get('kind')}"
            assert trmm_entry.get("primary") == True, f"Expected primary=true, got {trmm_entry.get('primary')}"
            assert trmm_entry.get("configured") == True, f"Expected configured=true, got {trmm_entry.get('configured')}"
            assert trmm_entry.get("active") == True, f"Expected active=true, got {trmm_entry.get('active')}"
            
            print(f"PASS: TRMM appears in active providers with correct shape: {trmm_entry}")
        finally:
            # Cleanup
            requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
    
    def test_trmm_removed_when_deleted(self, auth_headers):
        """When TRMM is removed (DELETE), /api/remote-providers/active should no longer include TRMM"""
        # First save TRMM settings
        requests.post(f"{BASE_URL}/api/trmm/settings", headers=auth_headers, json={
            "base_url": "https://test-trmm-delete.example.com",
            "api_key": "TEST_API_KEY_DELETE_5678",
            "verify_tls": True
        })
        
        # Verify TRMM is in active providers
        before_response = requests.get(f"{BASE_URL}/api/remote-providers/active", headers=auth_headers)
        before_providers = before_response.json()
        assert any(p.get("id") == "trmm" for p in before_providers), "TRMM should be in active providers before delete"
        
        # Delete TRMM settings
        delete_response = requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        assert delete_response.status_code == 200, f"Failed to delete TRMM settings: {delete_response.text}"
        
        # Verify TRMM is NOT in active providers anymore
        after_response = requests.get(f"{BASE_URL}/api/remote-providers/active", headers=auth_headers)
        after_providers = after_response.json()
        assert not any(p.get("id") == "trmm" for p in after_providers), f"TRMM should NOT be in active providers after delete: {after_providers}"
        
        print("PASS: TRMM removed from active providers after DELETE /api/trmm/settings")


class TestRustDeskInActiveProviders:
    """Test RustDesk detection in /api/remote-providers/active"""
    
    def test_rustdesk_detection_does_not_throw_if_missing(self, auth_headers):
        """RustDesk detection should NOT throw if settings doc is missing"""
        # Just verify the endpoint doesn't crash - RustDesk may or may not be configured
        response = requests.get(f"{BASE_URL}/api/remote-providers/active", headers=auth_headers)
        assert response.status_code == 200, f"Endpoint should not crash: {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Should return a list even if RustDesk not configured"
        
        # Check if RustDesk is in the list (may or may not be depending on seed data)
        rustdesk_entry = next((p for p in data if p.get("id") == "rustdesk"), None)
        if rustdesk_entry:
            print(f"PASS: RustDesk found in active providers: {rustdesk_entry}")
            # Verify shape if present
            assert rustdesk_entry.get("name") == "RustDesk", f"Expected name='RustDesk', got {rustdesk_entry.get('name')}"
            assert rustdesk_entry.get("kind") == "remote", f"Expected kind='remote', got {rustdesk_entry.get('kind')}"
            assert rustdesk_entry.get("configured") == True
            assert rustdesk_entry.get("active") == True
        else:
            print("PASS: RustDesk not in active providers (not configured) - endpoint did not throw")


class TestOriginalRemoteProvidersRegression:
    """Regression: GET /api/remote-providers still works and returns full SUPPORTED_PROVIDERS list"""
    
    def test_remote_providers_returns_full_list(self, auth_headers):
        """GET /api/remote-providers should return the full SUPPORTED_PROVIDERS list with config status"""
        response = requests.get(f"{BASE_URL}/api/remote-providers", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Should have all supported providers (rustdesk, meshcentral, splashtop, screenconnect, teamviewer, anydesk, guacamole)
        provider_ids = [p.get("id") for p in data]
        expected_providers = ["rustdesk", "meshcentral", "splashtop", "screenconnect", "teamviewer", "anydesk", "guacamole"]
        
        for expected_id in expected_providers:
            assert expected_id in provider_ids, f"Missing provider '{expected_id}' in response"
        
        # Each provider should have configured and active fields
        for provider in data:
            assert "configured" in provider, f"Provider {provider.get('id')} missing 'configured' field"
            assert "active" in provider, f"Provider {provider.get('id')} missing 'active' field"
        
        print(f"PASS: GET /api/remote-providers returns {len(data)} providers with config status")
        print(f"  Provider IDs: {provider_ids}")
    
    def test_remote_providers_requires_auth(self):
        """GET /api/remote-providers should require authentication"""
        response = requests.get(f"{BASE_URL}/api/remote-providers")
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"
        print("PASS: GET /api/remote-providers requires authentication")


class TestTrmmEndpointsRegression:
    """Regression: Existing TRMM endpoints from prev iterations still pass"""
    
    def test_trmm_status_endpoint(self, auth_headers):
        """GET /api/trmm/status should return expected shape"""
        response = requests.get(f"{BASE_URL}/api/trmm/status", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "configured" in data, "Missing 'configured' field"
        assert "base_url" in data, "Missing 'base_url' field"
        print(f"PASS: GET /api/trmm/status returns expected shape: configured={data.get('configured')}")
    
    def test_trmm_summary_endpoint(self, auth_headers):
        """GET /api/trmm/summary should return expected shape"""
        # Ensure clean state
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        
        response = requests.get(f"{BASE_URL}/api/trmm/summary", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "configured" in data, "Missing 'configured' field"
        assert "stats" in data, "Missing 'stats' field"
        print(f"PASS: GET /api/trmm/summary returns expected shape: configured={data.get('configured')}")
    
    def test_trmm_test_endpoint(self, auth_headers):
        """GET /api/trmm/test should return expected shape when not configured"""
        # Ensure clean state
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        
        response = requests.get(f"{BASE_URL}/api/trmm/test", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "success" in data, "Missing 'success' field"
        assert "message" in data, "Missing 'message' field"
        assert data.get("success") == False, "Should return success=false when not configured"
        print(f"PASS: GET /api/trmm/test returns success=false when not configured")
    
    def test_trmm_auto_link_endpoint(self, auth_headers):
        """POST /api/trmm/auto-link should return 503 when not configured"""
        # Ensure clean state
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        
        response = requests.post(f"{BASE_URL}/api/trmm/auto-link", headers=auth_headers, json={})
        assert response.status_code == 503, f"Expected 503 when not configured, got {response.status_code}: {response.text}"
        data = response.json()
        assert "not configured" in data.get("detail", "").lower(), f"Expected 'not configured' in detail: {data}"
        print("PASS: POST /api/trmm/auto-link returns 503 when not configured")


class TestHealthRegression:
    """Verify health endpoint still works"""
    
    def test_health_endpoint(self):
        """GET /api/health should return 200 OK"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health check failed: {response.text}"
        data = response.json()
        assert data.get("status") == "ok"
        print("PASS: GET /api/health returns 200 OK with status=ok")


class TestCleanup:
    """Cleanup test data after all tests"""
    
    def test_cleanup_trmm_settings(self, auth_headers):
        """Ensure TRMM settings are cleaned up after tests"""
        response = requests.delete(f"{BASE_URL}/api/trmm/settings", headers=auth_headers)
        # Accept 200 or 404 (already deleted)
        assert response.status_code in [200, 404]
        
        # Verify clean state
        verify = requests.get(f"{BASE_URL}/api/trmm/status", headers=auth_headers)
        assert verify.json().get("configured") == False
        print("PASS: TRMM settings cleaned up successfully")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
