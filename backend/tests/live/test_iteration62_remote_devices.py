"""
Iteration 62 - Remote Devices (RustDesk) Module Testing
Tests the rebuilt Remote Devices page with device management, Quick Connect, Assign ID, Connect buttons, and session history.
Backend endpoints: /api/rustdesk/all-devices, /api/rustdesk/assign/{device_id}, /api/rustdesk/quick-connect, /api/rustdesk/sessions, /api/rustdesk/config
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestRustDeskRemoteDevices:
    """Test RustDesk Remote Devices API endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - login and get auth token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login with admin credentials
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        token = login_response.json().get("token")
        assert token, "No token received"
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        self.token = token
    
    # ============== GET /api/rustdesk/all-devices ==============
    def test_get_all_devices_returns_enriched_list(self):
        """GET /api/rustdesk/all-devices returns enriched device list with rd_registered, rd_id, rd_password fields"""
        response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        assert response.status_code == 200, f"Failed: {response.text}"
        
        devices = response.json()
        assert isinstance(devices, list), "Response should be a list"
        assert len(devices) > 0, "Should have devices"
        
        # Check enriched fields exist
        first_device = devices[0]
        assert "id" in first_device, "Device should have id"
        assert "rd_registered" in first_device, "Device should have rd_registered field"
        assert "rd_id" in first_device, "Device should have rd_id field"
        assert "rd_password" in first_device, "Device should have rd_password field"
        
        print(f"✓ GET /api/rustdesk/all-devices returned {len(devices)} devices with enriched fields")
    
    def test_all_devices_has_registered_devices(self):
        """Verify some devices have RustDesk IDs assigned (rd_registered=True)"""
        response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        assert response.status_code == 200
        
        devices = response.json()
        registered = [d for d in devices if d.get("rd_registered")]
        
        # According to context, there should be 3 devices with RustDesk IDs
        assert len(registered) >= 1, "Should have at least 1 registered device"
        
        # Check a registered device has rd_id
        for rd in registered:
            assert rd.get("rd_id"), f"Registered device {rd.get('name')} should have rd_id"
        
        print(f"✓ Found {len(registered)} registered devices with RustDesk IDs")
    
    def test_all_devices_has_unregistered_devices(self):
        """Verify some devices don't have RustDesk IDs (rd_registered=False)"""
        response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        assert response.status_code == 200
        
        devices = response.json()
        unregistered = [d for d in devices if not d.get("rd_registered")]
        
        assert len(unregistered) > 0, "Should have unregistered devices"
        print(f"✓ Found {len(unregistered)} unregistered devices")
    
    # ============== GET /api/rustdesk/config ==============
    def test_get_rustdesk_config(self):
        """GET /api/rustdesk/config returns server configuration"""
        response = self.session.get(f"{BASE_URL}/api/rustdesk/config")
        assert response.status_code == 200, f"Failed: {response.text}"
        
        config = response.json()
        # Config should have key and value structure or direct fields
        assert config is not None, "Config should not be None"
        
        # Check for expected fields (either in value or directly)
        config_value = config.get("value", config)
        print(f"✓ GET /api/rustdesk/config returned config: {config_value}")
    
    # ============== PUT /api/rustdesk/config ==============
    def test_save_rustdesk_config(self):
        """PUT /api/rustdesk/config saves server configuration"""
        # First get current config
        get_response = self.session.get(f"{BASE_URL}/api/rustdesk/config")
        current_config = get_response.json().get("value", {})
        
        # Save config (use POST as per the router)
        config_data = {
            "server_url": current_config.get("server_url", "rustdesk.test.com"),
            "api_key": current_config.get("api_key", "test-key"),
            "relay_server": current_config.get("relay_server", "relay.test.com"),
            "enabled": True
        }
        response = self.session.post(f"{BASE_URL}/api/rustdesk/config", json=config_data)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        result = response.json()
        assert "message" in result, "Should return success message"
        print(f"✓ POST /api/rustdesk/config saved configuration")
    
    # ============== GET /api/rustdesk/sessions ==============
    def test_get_sessions(self):
        """GET /api/rustdesk/sessions returns session history"""
        response = self.session.get(f"{BASE_URL}/api/rustdesk/sessions")
        assert response.status_code == 200, f"Failed: {response.text}"
        
        sessions = response.json()
        assert isinstance(sessions, list), "Response should be a list"
        print(f"✓ GET /api/rustdesk/sessions returned {len(sessions)} sessions")
    
    # ============== POST /api/rustdesk/quick-connect ==============
    def test_quick_connect_success(self):
        """POST /api/rustdesk/quick-connect logs session and returns connection_url"""
        response = self.session.post(f"{BASE_URL}/api/rustdesk/quick-connect", json={
            "rustdesk_id": "123456789"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        
        result = response.json()
        assert "connection_url" in result, "Should return connection_url"
        assert "rustdesk_id" in result, "Should return rustdesk_id"
        assert result["connection_url"] == "rustdesk://123456789", "Connection URL should be correct format"
        
        print(f"✓ POST /api/rustdesk/quick-connect returned: {result}")
    
    def test_quick_connect_empty_id_fails(self):
        """POST /api/rustdesk/quick-connect with empty ID returns 400"""
        response = self.session.post(f"{BASE_URL}/api/rustdesk/quick-connect", json={
            "rustdesk_id": ""
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print(f"✓ POST /api/rustdesk/quick-connect with empty ID correctly returns 400")
    
    def test_quick_connect_creates_session(self):
        """POST /api/rustdesk/quick-connect creates a session entry"""
        # Get sessions before
        before = self.session.get(f"{BASE_URL}/api/rustdesk/sessions").json()
        before_count = len(before)
        
        # Quick connect
        test_id = "TEST987654321"
        self.session.post(f"{BASE_URL}/api/rustdesk/quick-connect", json={
            "rustdesk_id": test_id
        })
        
        # Get sessions after
        after = self.session.get(f"{BASE_URL}/api/rustdesk/sessions").json()
        after_count = len(after)
        
        assert after_count >= before_count, "Session count should increase or stay same"
        
        # Check if our session is in the list
        found = any(s.get("rustdesk_id") == test_id for s in after)
        assert found, f"Session with rustdesk_id {test_id} should be in sessions list"
        
        print(f"✓ Quick connect created session entry (before: {before_count}, after: {after_count})")
    
    # ============== PUT /api/rustdesk/assign/{device_id} ==============
    def test_assign_rustdesk_id_to_device(self):
        """PUT /api/rustdesk/assign/{device_id} assigns RustDesk ID to a device"""
        # First get all devices to find an unregistered one
        devices_response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        devices = devices_response.json()
        
        # Find dev-003 (TECH-SRV-01) or any unregistered device
        target_device = None
        for d in devices:
            if d.get("id") == "dev-003":
                target_device = d
                break
        
        if not target_device:
            # Find any unregistered device
            for d in devices:
                if not d.get("rd_registered"):
                    target_device = d
                    break
        
        if not target_device:
            pytest.skip("No unregistered device found to test assign")
        
        device_id = target_device["id"]
        test_rd_id = "TEST111222333"
        
        # Assign RustDesk ID
        response = self.session.put(f"{BASE_URL}/api/rustdesk/assign/{device_id}", json={
            "rustdesk_id": test_rd_id,
            "rustdesk_password": "testpass123"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        
        result = response.json()
        assert "message" in result, "Should return success message"
        assert result.get("rustdesk_id") == test_rd_id, "Should return assigned ID"
        
        # Verify the device now has the RustDesk ID
        verify_response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        verify_devices = verify_response.json()
        updated_device = next((d for d in verify_devices if d.get("id") == device_id), None)
        
        assert updated_device, f"Device {device_id} should exist"
        assert updated_device.get("rd_id") == test_rd_id, f"Device should have rd_id={test_rd_id}"
        assert updated_device.get("rd_registered") == True, "Device should be registered"
        
        print(f"✓ PUT /api/rustdesk/assign/{device_id} assigned RustDesk ID {test_rd_id}")
    
    def test_assign_rustdesk_id_empty_fails(self):
        """PUT /api/rustdesk/assign/{device_id} with empty ID returns 400"""
        response = self.session.put(f"{BASE_URL}/api/rustdesk/assign/dev-001", json={
            "rustdesk_id": ""
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print(f"✓ PUT /api/rustdesk/assign with empty ID correctly returns 400")
    
    def test_assign_rustdesk_id_nonexistent_device_fails(self):
        """PUT /api/rustdesk/assign/{device_id} with nonexistent device returns 404"""
        response = self.session.put(f"{BASE_URL}/api/rustdesk/assign/nonexistent-device-xyz", json={
            "rustdesk_id": "123456789"
        })
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"✓ PUT /api/rustdesk/assign with nonexistent device correctly returns 404")
    
    # ============== POST /api/rustdesk/devices/{id}/connect ==============
    def test_connect_to_registered_device(self):
        """POST /api/rustdesk/devices/{id}/connect initiates connection to registered device"""
        # First get all devices to find one with rd_entry_id
        devices_response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        devices = devices_response.json()
        
        # Find a device with rd_entry_id (registered in rustdesk_devices collection)
        target_device = None
        for d in devices:
            if d.get("rd_entry_id"):
                target_device = d
                break
        
        if not target_device:
            pytest.skip("No device with rd_entry_id found to test connect")
        
        rd_entry_id = target_device["rd_entry_id"]
        
        # Connect
        response = self.session.post(f"{BASE_URL}/api/rustdesk/devices/{rd_entry_id}/connect", json={})
        assert response.status_code == 200, f"Failed: {response.text}"
        
        result = response.json()
        assert "connection_url" in result, "Should return connection_url"
        assert "rustdesk_id" in result, "Should return rustdesk_id"
        
        print(f"✓ POST /api/rustdesk/devices/{rd_entry_id}/connect returned: {result}")
    
    def test_connect_nonexistent_device_fails(self):
        """POST /api/rustdesk/devices/{id}/connect with nonexistent device returns 404"""
        response = self.session.post(f"{BASE_URL}/api/rustdesk/devices/nonexistent-xyz/connect", json={})
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"✓ POST /api/rustdesk/devices/nonexistent/connect correctly returns 404")
    
    # ============== Data Validation Tests ==============
    def test_device_data_structure(self):
        """Verify device data structure has all required fields"""
        response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        devices = response.json()
        
        required_fields = ["id", "rd_registered", "rd_id", "rd_password"]
        optional_fields = ["name", "hostname", "client_id", "client_name", "device_type", "os", "status", "ip_address"]
        
        for device in devices[:5]:  # Check first 5 devices
            for field in required_fields:
                assert field in device, f"Device missing required field: {field}"
        
        print(f"✓ Device data structure validated with required fields")
    
    def test_session_data_structure(self):
        """Verify session data structure has required fields"""
        # Create a session first
        self.session.post(f"{BASE_URL}/api/rustdesk/quick-connect", json={
            "rustdesk_id": "STRUCT_TEST_123"
        })
        
        response = self.session.get(f"{BASE_URL}/api/rustdesk/sessions")
        sessions = response.json()
        
        if len(sessions) > 0:
            session = sessions[0]
            expected_fields = ["id", "rustdesk_id", "user_id", "user_name", "status", "started_at"]
            for field in expected_fields:
                assert field in session, f"Session missing field: {field}"
            print(f"✓ Session data structure validated")
        else:
            print("⚠ No sessions to validate structure")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
