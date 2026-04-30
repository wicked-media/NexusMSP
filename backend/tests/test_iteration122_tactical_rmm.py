"""
Iteration 122: Tactical RMM (TRMM) Integration Backend Tests
Tests all TRMM endpoints for proper response shapes when not configured,
settings CRUD, device linking, and regression smoke tests.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from test_credentials.md
ADMIN_EMAIL = "aaron@stech.com.au"
ADMIN_PASSWORD = "Lucky@2871$!"


class TestTRMMIntegration:
    """Tactical RMM integration endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: get auth token and cleanup any existing TRMM settings"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get token
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("token")
        assert token, "No token in login response"
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        
        # Cleanup: delete any existing TRMM settings before tests
        self.session.delete(f"{BASE_URL}/api/trmm/settings")
        
        yield
        
        # Teardown: cleanup TRMM settings after tests
        self.session.delete(f"{BASE_URL}/api/trmm/settings")
    
    # ─────────────────────────── Status/Settings when NOT configured ───────────────────────────
    
    def test_trmm_status_not_configured(self):
        """GET /api/trmm/status returns configured=false initially with expected shape"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/status")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        
        # Verify expected shape
        assert "configured" in data, "Missing 'configured' field"
        assert data["configured"] == False, f"Expected configured=false, got {data['configured']}"
        assert "base_url" in data, "Missing 'base_url' field"
        assert "api_key_preview" in data, "Missing 'api_key_preview' field"
        assert "verify_tls" in data, "Missing 'verify_tls' field"
        assert "last_test_status" in data, "Missing 'last_test_status' field"
        assert "last_tested_at" in data, "Missing 'last_tested_at' field"
        assert "last_synced_at" in data, "Missing 'last_synced_at' field"
        print(f"✓ TRMM status not configured: {data}")
    
    def test_trmm_summary_not_configured(self):
        """GET /api/trmm/summary returns configured=false and zero stats when not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/summary")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        
        assert data.get("configured") == False, f"Expected configured=false, got {data.get('configured')}"
        assert "stats" in data, "Missing 'stats' field"
        stats = data["stats"]
        assert stats.get("agents") == 0, f"Expected agents=0, got {stats.get('agents')}"
        assert stats.get("online") == 0, f"Expected online=0, got {stats.get('online')}"
        assert stats.get("offline") == 0, f"Expected offline=0, got {stats.get('offline')}"
        assert stats.get("alerts") == 0, f"Expected alerts=0, got {stats.get('alerts')}"
        print(f"✓ TRMM summary not configured: {data}")
    
    def test_trmm_test_not_configured(self):
        """GET /api/trmm/test returns success=false with 'Not configured' when no creds"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/test")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        
        assert data.get("success") == False, f"Expected success=false, got {data.get('success')}"
        assert "message" in data, "Missing 'message' field"
        assert "not configured" in data["message"].lower(), f"Expected 'Not configured' message, got: {data['message']}"
        print(f"✓ TRMM test not configured: {data}")
    
    # ─────────────────────────── Settings CRUD ───────────────────────────
    
    def test_trmm_settings_save_and_verify(self):
        """POST /api/trmm/settings saves base_url, api_key, verify_tls and persists configured=true"""
        # Save settings
        save_resp = self.session.post(f"{BASE_URL}/api/trmm/settings", json={
            "base_url": "https://test-trmm.example.com",
            "api_key": "TEST_API_KEY_12345678",
            "verify_tls": False
        })
        assert save_resp.status_code == 200, f"Expected 200, got {save_resp.status_code}: {save_resp.text}"
        save_data = save_resp.json()
        assert "message" in save_data, "Missing 'message' in save response"
        print(f"✓ TRMM settings saved: {save_data}")
        
        # Verify status shows configured=true
        status_resp = self.session.get(f"{BASE_URL}/api/trmm/status")
        assert status_resp.status_code == 200
        status_data = status_resp.json()
        
        assert status_data.get("configured") == True, f"Expected configured=true after save, got {status_data.get('configured')}"
        assert status_data.get("base_url") == "https://test-trmm.example.com", f"base_url mismatch: {status_data.get('base_url')}"
        assert status_data.get("api_key_preview") == "…5678", f"api_key_preview mismatch: {status_data.get('api_key_preview')}"
        assert status_data.get("verify_tls") == False, f"verify_tls mismatch: {status_data.get('verify_tls')}"
        print(f"✓ TRMM status after save: {status_data}")
    
    def test_trmm_settings_validation(self):
        """POST /api/trmm/settings returns 400 when base_url or api_key missing"""
        # Missing api_key
        resp1 = self.session.post(f"{BASE_URL}/api/trmm/settings", json={
            "base_url": "https://test.example.com"
        })
        assert resp1.status_code == 400, f"Expected 400 for missing api_key, got {resp1.status_code}"
        
        # Missing base_url
        resp2 = self.session.post(f"{BASE_URL}/api/trmm/settings", json={
            "api_key": "some_key"
        })
        assert resp2.status_code == 400, f"Expected 400 for missing base_url, got {resp2.status_code}"
        
        # Empty values
        resp3 = self.session.post(f"{BASE_URL}/api/trmm/settings", json={
            "base_url": "",
            "api_key": ""
        })
        assert resp3.status_code == 400, f"Expected 400 for empty values, got {resp3.status_code}"
        print("✓ TRMM settings validation works correctly")
    
    def test_trmm_test_unreachable_url(self):
        """GET /api/trmm/test against unreachable URL returns success=false with useful error (NOT 500)"""
        # First save settings with fake URL
        self.session.post(f"{BASE_URL}/api/trmm/settings", json={
            "base_url": "https://fake-trmm-that-does-not-exist.invalid",
            "api_key": "TEST_KEY_FAKE_1234",
            "verify_tls": False
        })
        
        # Test connection - should return success=false, NOT raise 500
        resp = self.session.get(f"{BASE_URL}/api/trmm/test")
        assert resp.status_code == 200, f"Expected 200 (graceful failure), got {resp.status_code}: {resp.text}"
        data = resp.json()
        
        assert data.get("success") == False, f"Expected success=false for unreachable URL, got {data.get('success')}"
        assert "message" in data, "Missing 'message' field in error response"
        assert len(data["message"]) > 0, "Error message should not be empty"
        print(f"✓ TRMM test unreachable URL handled gracefully: {data}")
    
    def test_trmm_settings_delete(self):
        """DELETE /api/trmm/settings removes credentials (status becomes configured=false again)"""
        # First save settings
        self.session.post(f"{BASE_URL}/api/trmm/settings", json={
            "base_url": "https://test-trmm.example.com",
            "api_key": "TEST_API_KEY_DELETE",
            "verify_tls": True
        })
        
        # Verify configured
        status1 = self.session.get(f"{BASE_URL}/api/trmm/status").json()
        assert status1.get("configured") == True, "Settings should be configured before delete"
        
        # Delete settings
        del_resp = self.session.delete(f"{BASE_URL}/api/trmm/settings")
        assert del_resp.status_code == 200, f"Expected 200, got {del_resp.status_code}: {del_resp.text}"
        
        # Verify not configured
        status2 = self.session.get(f"{BASE_URL}/api/trmm/status").json()
        assert status2.get("configured") == False, f"Expected configured=false after delete, got {status2.get('configured')}"
        print("✓ TRMM settings delete works correctly")
    
    # ─────────────────────────── Actions Log & Linked Devices ───────────────────────────
    
    def test_trmm_actions_log_empty(self):
        """GET /api/trmm/actions/log returns [] when no actions"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/actions/log")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"✓ TRMM actions log: {data}")
    
    def test_trmm_linked_devices_empty(self):
        """GET /api/trmm/linked-devices returns [] when no devices linked"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/linked-devices")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"✓ TRMM linked devices: {data}")
    
    # ─────────────────────────── Device ↔ Agent Linking ───────────────────────────
    
    def test_device_link_trmm_agent(self):
        """POST /api/devices/{device_id}/link-trmm-agent persists trmm_agent_id on device record"""
        # First get a device from /api/devices
        devices_resp = self.session.get(f"{BASE_URL}/api/devices")
        assert devices_resp.status_code == 200, f"Failed to get devices: {devices_resp.text}"
        devices = devices_resp.json()
        
        if not devices:
            pytest.skip("No devices available for linking test")
        
        device_id = devices[0].get("id")
        assert device_id, "Device has no id field"
        
        # Link TRMM agent
        link_resp = self.session.post(f"{BASE_URL}/api/devices/{device_id}/link-trmm-agent", json={
            "agent_id": "TEST_TRMM_AGENT_122",
            "hostname": "test-hostname-122"
        })
        assert link_resp.status_code == 200, f"Expected 200, got {link_resp.status_code}: {link_resp.text}"
        link_data = link_resp.json()
        assert "message" in link_data, "Missing 'message' in link response"
        print(f"✓ Device linked to TRMM agent: {link_data}")
        
        # Verify device has trmm_agent_id
        device_resp = self.session.get(f"{BASE_URL}/api/devices/{device_id}")
        assert device_resp.status_code == 200
        device_data = device_resp.json()
        assert device_data.get("trmm_agent_id") == "TEST_TRMM_AGENT_122", f"trmm_agent_id not persisted: {device_data.get('trmm_agent_id')}"
        assert device_data.get("trmm_hostname") == "test-hostname-122", f"trmm_hostname not persisted: {device_data.get('trmm_hostname')}"
        print(f"✓ Device trmm_agent_id verified: {device_data.get('trmm_agent_id')}")
        
        # Verify linked-devices includes this device
        linked_resp = self.session.get(f"{BASE_URL}/api/trmm/linked-devices")
        assert linked_resp.status_code == 200
        linked = linked_resp.json()
        linked_ids = [d.get("id") for d in linked]
        assert device_id in linked_ids, f"Device {device_id} not in linked-devices list"
        print(f"✓ Device appears in linked-devices list")
    
    def test_device_unlink_trmm_agent(self):
        """DELETE /api/devices/{device_id}/link-trmm-agent unsets trmm_agent_id"""
        # First get a device
        devices_resp = self.session.get(f"{BASE_URL}/api/devices")
        devices = devices_resp.json()
        
        if not devices:
            pytest.skip("No devices available for unlinking test")
        
        device_id = devices[0].get("id")
        
        # Link first
        self.session.post(f"{BASE_URL}/api/devices/{device_id}/link-trmm-agent", json={
            "agent_id": "TEST_TRMM_AGENT_UNLINK",
            "hostname": "test-unlink"
        })
        
        # Unlink
        unlink_resp = self.session.delete(f"{BASE_URL}/api/devices/{device_id}/link-trmm-agent")
        assert unlink_resp.status_code == 200, f"Expected 200, got {unlink_resp.status_code}: {unlink_resp.text}"
        
        # Verify device no longer has trmm_agent_id
        device_resp = self.session.get(f"{BASE_URL}/api/devices/{device_id}")
        device_data = device_resp.json()
        assert not device_data.get("trmm_agent_id"), f"trmm_agent_id should be unset, got: {device_data.get('trmm_agent_id')}"
        print("✓ Device TRMM agent unlinked successfully")
    
    def test_device_link_validation(self):
        """POST /api/devices/{device_id}/link-trmm-agent returns 400 when agent_id missing"""
        devices_resp = self.session.get(f"{BASE_URL}/api/devices")
        devices = devices_resp.json()
        
        if not devices:
            pytest.skip("No devices available for validation test")
        
        device_id = devices[0].get("id")
        
        # Missing agent_id
        resp = self.session.post(f"{BASE_URL}/api/devices/{device_id}/link-trmm-agent", json={})
        assert resp.status_code == 400, f"Expected 400 for missing agent_id, got {resp.status_code}"
        print("✓ Device link validation works correctly")
    
    def test_device_link_not_found(self):
        """POST /api/devices/{device_id}/link-trmm-agent returns 404 for non-existent device"""
        resp = self.session.post(f"{BASE_URL}/api/devices/nonexistent-device-999/link-trmm-agent", json={
            "agent_id": "TEST_AGENT"
        })
        assert resp.status_code == 404, f"Expected 404 for non-existent device, got {resp.status_code}"
        print("✓ Device link 404 for non-existent device")


class TestRegressionSmoke:
    """Regression smoke tests - ensure existing endpoints still work"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: get auth token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            if token:
                self.session.headers.update({"Authorization": f"Bearer {token}"})
        
        yield
    
    def test_health_endpoint(self):
        """GET /api/health still works"""
        resp = requests.get(f"{BASE_URL}/api/health")
        assert resp.status_code == 200, f"Health check failed: {resp.status_code}"
        data = resp.json()
        assert data.get("status") == "ok", f"Health status not ok: {data}"
        print(f"✓ Health endpoint: {data}")
    
    def test_auth_login(self):
        """POST /api/auth/login still works"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        }, headers={"Content-Type": "application/json"})
        assert resp.status_code == 200, f"Login failed: {resp.status_code}"
        data = resp.json()
        assert "token" in data, "No token in login response"
        assert "user" in data, "No user in login response"
        print(f"✓ Auth login works: user={data['user'].get('email')}")
    
    def test_unifi_status(self):
        """GET /api/unifi/status still responds (regression)"""
        resp = self.session.get(f"{BASE_URL}/api/unifi/status")
        assert resp.status_code == 200, f"UniFi status failed: {resp.status_code}"
        data = resp.json()
        assert "configured" in data, "Missing 'configured' field in UniFi status"
        print(f"✓ UniFi status: configured={data.get('configured')}")
    
    def test_cipp_status(self):
        """GET /api/cipp/status still responds (regression)"""
        resp = self.session.get(f"{BASE_URL}/api/cipp/status")
        assert resp.status_code == 200, f"CIPP status failed: {resp.status_code}"
        data = resp.json()
        assert "configured" in data, "Missing 'configured' field in CIPP status"
        print(f"✓ CIPP status: configured={data.get('configured')}")
    
    def test_hudu_summary(self):
        """GET /api/hudu/summary still responds (regression)"""
        resp = self.session.get(f"{BASE_URL}/api/hudu/summary")
        assert resp.status_code == 200, f"Hudu summary failed: {resp.status_code}"
        data = resp.json()
        # Hudu summary should have stats object
        assert "stats" in data, "Missing 'stats' field in Hudu summary"
        print(f"✓ Hudu summary: stats={data.get('stats')}")


class TestTRMMAuthRequired:
    """Test that TRMM endpoints require authentication"""
    
    def test_trmm_status_requires_auth(self):
        """GET /api/trmm/status requires authentication"""
        resp = requests.get(f"{BASE_URL}/api/trmm/status")
        assert resp.status_code in [401, 403], f"Expected 401/403 without auth, got {resp.status_code}"
        print("✓ TRMM status requires auth")
    
    def test_trmm_summary_requires_auth(self):
        """GET /api/trmm/summary requires authentication"""
        resp = requests.get(f"{BASE_URL}/api/trmm/summary")
        assert resp.status_code in [401, 403], f"Expected 401/403 without auth, got {resp.status_code}"
        print("✓ TRMM summary requires auth")
    
    def test_trmm_test_requires_auth(self):
        """GET /api/trmm/test requires authentication"""
        resp = requests.get(f"{BASE_URL}/api/trmm/test")
        assert resp.status_code in [401, 403], f"Expected 401/403 without auth, got {resp.status_code}"
        print("✓ TRMM test requires auth")
    
    def test_trmm_settings_post_requires_auth(self):
        """POST /api/trmm/settings requires authentication"""
        resp = requests.post(f"{BASE_URL}/api/trmm/settings", json={
            "base_url": "https://test.com",
            "api_key": "test"
        }, headers={"Content-Type": "application/json"})
        assert resp.status_code in [401, 403], f"Expected 401/403 without auth, got {resp.status_code}"
        print("✓ TRMM settings POST requires auth")
    
    def test_trmm_settings_delete_requires_auth(self):
        """DELETE /api/trmm/settings requires authentication"""
        resp = requests.delete(f"{BASE_URL}/api/trmm/settings")
        assert resp.status_code in [401, 403], f"Expected 401/403 without auth, got {resp.status_code}"
        print("✓ TRMM settings DELETE requires auth")
    
    def test_trmm_actions_log_requires_auth(self):
        """GET /api/trmm/actions/log requires authentication"""
        resp = requests.get(f"{BASE_URL}/api/trmm/actions/log")
        assert resp.status_code in [401, 403], f"Expected 401/403 without auth, got {resp.status_code}"
        print("✓ TRMM actions log requires auth")
    
    def test_trmm_linked_devices_requires_auth(self):
        """GET /api/trmm/linked-devices requires authentication"""
        resp = requests.get(f"{BASE_URL}/api/trmm/linked-devices")
        assert resp.status_code in [401, 403], f"Expected 401/403 without auth, got {resp.status_code}"
        print("✓ TRMM linked-devices requires auth")
