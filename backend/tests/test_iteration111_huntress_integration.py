"""
Huntress Labs Integration Tests - Iteration 111
Tests for /api/huntress/* endpoints:
- /api/huntress/status - GET status (configured/not configured)
- /api/huntress/settings - POST save credentials, DELETE remove credentials
- /api/huntress/test-connection - GET test connection (expected to fail with test keys)
- /api/huntress/summary - GET aggregated security telemetry
- /api/huntress/organizations - GET organizations (503 when not configured)
- /api/huntress/agents - GET agents (503 when not configured)
- /api/huntress/incident-reports - GET incident reports (503 when not configured)
- /api/huntress/signals - GET signals (503 when not configured)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"

# Placeholder Huntress keys (will fail test-connection, which is expected)
TEST_API_KEY = "test-huntress-api-key-12345"
TEST_SECRET_KEY = "test-huntress-secret-key-67890"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for API calls"""
    response = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    if response.status_code == 200:
        data = response.json()
        return data.get("token") or data.get("access_token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text[:200]}")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestHuntressStatusNotConfigured:
    """Test Huntress status when NOT configured"""
    
    def test_status_not_configured(self, headers):
        """GET /api/huntress/status when NOT configured returns {configured:false, api_key_preview:null}"""
        # First ensure Huntress is not configured by deleting any existing settings
        requests.delete(f"{BASE_URL}/api/huntress/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/huntress/status", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("configured") == False, f"Expected configured=False, got {data}"
        assert data.get("api_key_preview") is None, f"Expected api_key_preview=None, got {data.get('api_key_preview')}"
        print(f"✓ Status when not configured: {data}")


class TestHuntressSettingsSave:
    """Test saving Huntress settings"""
    
    def test_save_settings_missing_fields_400(self, headers):
        """POST /api/huntress/settings with missing fields returns 400"""
        # Test with empty body
        response = requests.post(f"{BASE_URL}/api/huntress/settings", headers=headers, json={})
        assert response.status_code == 400, f"Expected 400 for empty body, got {response.status_code}"
        print(f"✓ Empty body returns 400: {response.json()}")
        
        # Test with only api_key
        response = requests.post(f"{BASE_URL}/api/huntress/settings", headers=headers, json={"api_key": "test"})
        assert response.status_code == 400, f"Expected 400 for missing secret_key, got {response.status_code}"
        print(f"✓ Missing secret_key returns 400")
        
        # Test with only secret_key
        response = requests.post(f"{BASE_URL}/api/huntress/settings", headers=headers, json={"secret_key": "test"})
        assert response.status_code == 400, f"Expected 400 for missing api_key, got {response.status_code}"
        print(f"✓ Missing api_key returns 400")
    
    def test_save_settings_success(self, headers):
        """POST /api/huntress/settings with {api_key, secret_key} saves to db.settings"""
        response = requests.post(
            f"{BASE_URL}/api/huntress/settings",
            headers=headers,
            json={"api_key": TEST_API_KEY, "secret_key": TEST_SECRET_KEY}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, f"Expected message in response, got {data}"
        assert "updated_at" in data, f"Expected updated_at in response, got {data}"
        print(f"✓ Settings saved successfully: {data}")


class TestHuntressStatusConfigured:
    """Test Huntress status when configured"""
    
    def test_status_configured(self, headers):
        """GET /api/huntress/status after save returns {configured:true, api_key_preview:'...'}"""
        # First ensure settings are saved
        requests.post(
            f"{BASE_URL}/api/huntress/settings",
            headers=headers,
            json={"api_key": TEST_API_KEY, "secret_key": TEST_SECRET_KEY}
        )
        
        response = requests.get(f"{BASE_URL}/api/huntress/status", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("configured") == True, f"Expected configured=True, got {data}"
        assert data.get("api_key_preview") is not None, f"Expected api_key_preview to be set, got {data}"
        # Preview should contain first 6 chars + ellipsis + last 4 chars
        preview = data.get("api_key_preview", "")
        assert len(preview) > 0, f"Expected non-empty api_key_preview"
        print(f"✓ Status when configured: configured={data.get('configured')}, api_key_preview={preview}")


class TestHuntressTestConnection:
    """Test Huntress test-connection endpoint"""
    
    def test_connection_with_invalid_keys(self, headers):
        """GET /api/huntress/test-connection with invalid keys returns {success:false, message:...}"""
        # Ensure settings are saved first
        requests.post(
            f"{BASE_URL}/api/huntress/settings",
            headers=headers,
            json={"api_key": TEST_API_KEY, "secret_key": TEST_SECRET_KEY}
        )
        
        response = requests.get(f"{BASE_URL}/api/huntress/test-connection", headers=headers)
        # Should NOT throw - should return 200 with success:false
        assert response.status_code == 200, f"Expected 200 (not throw), got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == False, f"Expected success=False with test keys, got {data}"
        assert "message" in data, f"Expected message in response, got {data}"
        print(f"✓ Test connection with invalid keys: success={data.get('success')}, message={data.get('message')[:100]}")
    
    def test_connection_updates_last_test_status(self, headers):
        """Test connection updates last_test_status in DB"""
        # Run test connection
        requests.get(f"{BASE_URL}/api/huntress/test-connection", headers=headers)
        
        # Check status to verify last_test_status was updated
        response = requests.get(f"{BASE_URL}/api/huntress/status", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("last_test_status") is not None, f"Expected last_test_status to be set, got {data}"
        assert data.get("last_tested_at") is not None, f"Expected last_tested_at to be set, got {data}"
        print(f"✓ last_test_status updated: {data.get('last_test_status')}, last_tested_at: {data.get('last_tested_at')}")


class TestHuntressSummary:
    """Test Huntress summary endpoint"""
    
    def test_summary_not_configured(self, headers):
        """GET /api/huntress/summary when NOT configured returns graceful response"""
        # Delete settings first
        requests.delete(f"{BASE_URL}/api/huntress/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("configured") == False, f"Expected configured=False, got {data}"
        assert "message" in data, f"Expected message in response, got {data}"
        assert "Huntress not configured" in data.get("message", ""), f"Expected 'not configured' message, got {data.get('message')}"
        
        # Check stats are all zeros
        stats = data.get("stats", {})
        assert stats.get("agents_total") == 0, f"Expected agents_total=0, got {stats}"
        print(f"✓ Summary when not configured: {data.get('message')}")
    
    def test_summary_configured_with_test_keys(self, headers):
        """GET /api/huntress/summary when configured (with test keys) returns 200 with configured:true and stats:{all 0s}"""
        # Save test settings
        requests.post(
            f"{BASE_URL}/api/huntress/settings",
            headers=headers,
            json={"api_key": TEST_API_KEY, "secret_key": TEST_SECRET_KEY}
        )
        
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("configured") == True, f"Expected configured=True, got {data}"
        
        # Stats should be present (all 0s due to safe() helper swallowing network errors)
        stats = data.get("stats", {})
        assert "agents_total" in stats, f"Expected agents_total in stats, got {stats}"
        assert "incidents_total" in stats, f"Expected incidents_total in stats, got {stats}"
        
        # recent_incidents should be empty list (not None)
        recent = data.get("recent_incidents")
        assert recent is not None, f"Expected recent_incidents to be present, got {data}"
        assert isinstance(recent, list), f"Expected recent_incidents to be list, got {type(recent)}"
        
        print(f"✓ Summary when configured: configured={data.get('configured')}, stats={stats}")


class TestHuntressProtectedEndpointsNotConfigured:
    """Test protected endpoints return 503 when not configured"""
    
    def test_agents_not_configured_503(self, headers):
        """GET /api/huntress/agents when NOT configured returns 503"""
        # Delete settings first
        requests.delete(f"{BASE_URL}/api/huntress/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/huntress/agents", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}: {response.text}"
        print(f"✓ /agents returns 503 when not configured")
    
    def test_incident_reports_not_configured_503(self, headers):
        """GET /api/huntress/incident-reports when NOT configured returns 503"""
        response = requests.get(f"{BASE_URL}/api/huntress/incident-reports", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}: {response.text}"
        print(f"✓ /incident-reports returns 503 when not configured")
    
    def test_organizations_not_configured_503(self, headers):
        """GET /api/huntress/organizations when NOT configured returns 503"""
        response = requests.get(f"{BASE_URL}/api/huntress/organizations", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}: {response.text}"
        print(f"✓ /organizations returns 503 when not configured")
    
    def test_signals_not_configured_503(self, headers):
        """GET /api/huntress/signals when NOT configured returns 503"""
        response = requests.get(f"{BASE_URL}/api/huntress/signals", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}: {response.text}"
        print(f"✓ /signals returns 503 when not configured")


class TestHuntressDeleteSettings:
    """Test deleting Huntress settings"""
    
    def test_delete_settings(self, headers):
        """DELETE /api/huntress/settings removes credentials"""
        # First save settings
        requests.post(
            f"{BASE_URL}/api/huntress/settings",
            headers=headers,
            json={"api_key": TEST_API_KEY, "secret_key": TEST_SECRET_KEY}
        )
        
        # Verify configured
        status_before = requests.get(f"{BASE_URL}/api/huntress/status", headers=headers).json()
        assert status_before.get("configured") == True, f"Expected configured=True before delete"
        
        # Delete settings
        response = requests.delete(f"{BASE_URL}/api/huntress/settings", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, f"Expected message in response, got {data}"
        print(f"✓ Delete response: {data}")
        
        # Verify not configured after delete
        status_after = requests.get(f"{BASE_URL}/api/huntress/status", headers=headers).json()
        assert status_after.get("configured") == False, f"Expected configured=False after delete, got {status_after}"
        print(f"✓ Status after delete: configured={status_after.get('configured')}")


class TestHuntressCleanup:
    """Cleanup test data after all tests"""
    
    def test_cleanup(self, headers):
        """Clean up test credentials"""
        response = requests.delete(f"{BASE_URL}/api/huntress/settings", headers=headers)
        print(f"✓ Cleanup complete: {response.status_code}")
