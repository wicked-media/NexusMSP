"""
Iteration 112: Security Dashboard (Huntress-first) Backend Tests
Tests the extended /api/huntress/summary endpoint with new keys:
- per_org: []
- severity_mix: {critical, high, medium, low}
- recent_signals: []
- recent_incidents: [] (already existed)

Also tests that summary returns 200 (not 503) when not configured.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"

# Test Huntress keys (will fail auth but test the flow)
TEST_API_KEY = "test-key"
TEST_SECRET_KEY = "test-secret"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text[:200]}")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestHuntressSummaryNotConfigured:
    """Tests for /api/huntress/summary when Huntress is NOT configured"""
    
    def test_summary_returns_200_not_503_when_not_configured(self, headers):
        """CRITICAL: Summary should return 200 with configured:false, NOT 503"""
        # First ensure Huntress is not configured by deleting any existing settings
        requests.delete(f"{BASE_URL}/api/huntress/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=headers)
        
        # Should return 200, NOT 503
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text[:200]}"
        
        data = response.json()
        assert data.get("configured") == False, "Expected configured:false"
        assert "message" in data, "Expected message field when not configured"
        print(f"PASS: Summary returns 200 with configured:false when not configured")
    
    def test_summary_has_stats_with_zeros_when_not_configured(self, headers):
        """Stats should have all zero values when not configured"""
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        stats = data.get("stats", {})
        
        # Verify all expected stats keys exist with 0 values
        expected_keys = [
            "agents_total", "agents_online", "agents_offline",
            "incidents_total", "incidents_critical", "incidents_high", "incidents_low",
            "incidents_open", "incidents_resolved",
            "signals_count", "organizations_count"
        ]
        
        for key in expected_keys:
            assert key in stats, f"Missing stats key: {key}"
            assert stats[key] == 0, f"Expected {key}=0, got {stats[key]}"
        
        print(f"PASS: Stats has all expected keys with 0 values when not configured")


class TestHuntressSummaryResponseShape:
    """Tests for the new response shape of /api/huntress/summary"""
    
    def test_summary_has_per_org_key(self, headers):
        """Summary should include per_org array (empty when not configured)"""
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        # When not configured, per_org may not be present or be empty
        # When configured, it should be an array
        if data.get("configured"):
            assert "per_org" in data, "Missing per_org key when configured"
            assert isinstance(data["per_org"], list), "per_org should be a list"
        print(f"PASS: per_org key check passed")
    
    def test_summary_has_severity_mix_key(self, headers):
        """Summary should include severity_mix with critical/high/medium/low"""
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        # When not configured, severity_mix may not be present
        # When configured, it should have the expected structure
        if data.get("configured"):
            assert "severity_mix" in data, "Missing severity_mix key when configured"
            sev_mix = data["severity_mix"]
            for key in ["critical", "high", "medium", "low"]:
                assert key in sev_mix, f"Missing severity_mix.{key}"
                assert isinstance(sev_mix[key], int), f"severity_mix.{key} should be int"
        print(f"PASS: severity_mix key check passed")
    
    def test_summary_has_recent_signals_key(self, headers):
        """Summary should include recent_signals array"""
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        # When not configured, recent_signals may not be present
        # When configured, it should be an array
        if data.get("configured"):
            assert "recent_signals" in data, "Missing recent_signals key when configured"
            assert isinstance(data["recent_signals"], list), "recent_signals should be a list"
        print(f"PASS: recent_signals key check passed")
    
    def test_summary_has_recent_incidents_key(self, headers):
        """Summary should include recent_incidents array (already existed)"""
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        # When configured, recent_incidents should be present
        if data.get("configured"):
            assert "recent_incidents" in data, "Missing recent_incidents key when configured"
            assert isinstance(data["recent_incidents"], list), "recent_incidents should be a list"
        print(f"PASS: recent_incidents key check passed")


class TestHuntressWithTestCredentials:
    """Tests with test credentials saved"""
    
    def test_save_test_credentials(self, headers):
        """POST /api/huntress/settings with test-key/test-secret should succeed"""
        response = requests.post(f"{BASE_URL}/api/huntress/settings", headers=headers, json={
            "api_key": TEST_API_KEY,
            "secret_key": TEST_SECRET_KEY
        })
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text[:200]}"
        data = response.json()
        assert "message" in data, "Expected message in response"
        print(f"PASS: Test credentials saved successfully")
    
    def test_summary_with_test_creds_returns_200_configured_true(self, headers):
        """With test creds, summary should return 200 with configured:true"""
        # First save test credentials
        requests.post(f"{BASE_URL}/api/huntress/settings", headers=headers, json={
            "api_key": TEST_API_KEY,
            "secret_key": TEST_SECRET_KEY
        })
        
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text[:200]}"
        
        data = response.json()
        assert data.get("configured") == True, "Expected configured:true with test creds"
        print(f"PASS: Summary returns 200 with configured:true when test creds saved")
    
    def test_summary_with_test_creds_has_all_new_keys(self, headers):
        """With test creds, summary should have per_org, severity_mix, recent_signals"""
        # Ensure test credentials are saved
        requests.post(f"{BASE_URL}/api/huntress/settings", headers=headers, json={
            "api_key": TEST_API_KEY,
            "secret_key": TEST_SECRET_KEY
        })
        
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        
        # Verify all new keys exist
        assert "per_org" in data, "Missing per_org key"
        assert isinstance(data["per_org"], list), "per_org should be a list"
        
        assert "severity_mix" in data, "Missing severity_mix key"
        assert isinstance(data["severity_mix"], dict), "severity_mix should be a dict"
        for key in ["critical", "high", "medium", "low"]:
            assert key in data["severity_mix"], f"Missing severity_mix.{key}"
        
        assert "recent_signals" in data, "Missing recent_signals key"
        assert isinstance(data["recent_signals"], list), "recent_signals should be a list"
        
        assert "recent_incidents" in data, "Missing recent_incidents key"
        assert isinstance(data["recent_incidents"], list), "recent_incidents should be a list"
        
        assert "stats" in data, "Missing stats key"
        
        print(f"PASS: Summary with test creds has all new keys: per_org, severity_mix, recent_signals, recent_incidents")
    
    def test_summary_stats_structure_with_test_creds(self, headers):
        """Stats should have proper structure even with test creds (will be zeros)"""
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        stats = data.get("stats", {})
        
        # All stats should be integers (likely 0 with test creds since API will fail)
        expected_keys = [
            "agents_total", "agents_online", "agents_offline",
            "incidents_total", "incidents_critical", "incidents_high", "incidents_low",
            "incidents_open", "incidents_resolved",
            "signals_count", "organizations_count"
        ]
        
        for key in expected_keys:
            assert key in stats, f"Missing stats key: {key}"
            assert isinstance(stats[key], int), f"stats.{key} should be int, got {type(stats[key])}"
        
        print(f"PASS: Stats structure is correct with test creds")
    
    def test_cleanup_delete_test_credentials(self, headers):
        """DELETE /api/huntress/settings should remove test credentials"""
        response = requests.delete(f"{BASE_URL}/api/huntress/settings", headers=headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text[:200]}"
        
        # Verify credentials are removed
        status_response = requests.get(f"{BASE_URL}/api/huntress/status", headers=headers)
        assert status_response.status_code == 200
        status_data = status_response.json()
        assert status_data.get("configured") == False, "Expected configured:false after delete"
        
        print(f"PASS: Test credentials cleaned up successfully")


class TestSOCDashboardEndpoint:
    """Tests for /api/soc/dashboard (fallback data source)"""
    
    def test_soc_dashboard_returns_200(self, headers):
        """SOC dashboard should return 200 with demo data"""
        response = requests.get(f"{BASE_URL}/api/soc/dashboard", headers=headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text[:200]}"
        print(f"PASS: SOC dashboard returns 200")
    
    def test_soc_dashboard_has_expected_structure(self, headers):
        """SOC dashboard should have huntress, vulnerability_summary, incidents, etc."""
        response = requests.get(f"{BASE_URL}/api/soc/dashboard", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        
        # Check for expected keys used by SecurityDashboardPage
        expected_keys = ["huntress", "vulnerability_summary", "incidents"]
        for key in expected_keys:
            assert key in data, f"Missing key: {key}"
        
        # Verify huntress fallback data structure
        huntress = data.get("huntress", {})
        huntress_keys = ["total_agents", "offline", "critical_incidents", "open_incidents"]
        for key in huntress_keys:
            assert key in huntress, f"Missing huntress.{key}"
        
        print(f"PASS: SOC dashboard has expected structure for fallback data")


class TestHuntressSettingsRegression:
    """Regression tests for Huntress Settings card functionality"""
    
    def test_huntress_status_endpoint(self, headers):
        """GET /api/huntress/status should work"""
        response = requests.get(f"{BASE_URL}/api/huntress/status", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert "configured" in data
        print(f"PASS: Huntress status endpoint works")
    
    def test_huntress_settings_save_requires_both_keys(self, headers):
        """POST /api/huntress/settings should require both api_key and secret_key"""
        # Missing secret_key
        response = requests.post(f"{BASE_URL}/api/huntress/settings", headers=headers, json={
            "api_key": "test"
        })
        assert response.status_code == 400, f"Expected 400 for missing secret_key, got {response.status_code}"
        
        # Missing api_key
        response = requests.post(f"{BASE_URL}/api/huntress/settings", headers=headers, json={
            "secret_key": "test"
        })
        assert response.status_code == 400, f"Expected 400 for missing api_key, got {response.status_code}"
        
        print(f"PASS: Settings save requires both keys")
    
    def test_huntress_test_connection_not_configured(self, headers):
        """GET /api/huntress/test-connection should handle not configured state"""
        # Ensure not configured
        requests.delete(f"{BASE_URL}/api/huntress/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/huntress/test-connection", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("success") == False
        assert "message" in data
        print(f"PASS: Test connection handles not configured state")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
