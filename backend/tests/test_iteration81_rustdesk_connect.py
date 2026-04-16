"""
Iteration 81 - RustDesk Remote Access Connect Functionality Tests
Tests the critical fix for remote connection functionality:
- POST /api/rustdesk/quick-connect returns connection_url, relay_server, web_client_url, server_url
- POST /api/rustdesk/devices/{id}/connect returns connection_url, relay_server, web_client_url, rustdesk_password
- connection_url format is rustdesk://connection/new/{id} (not rustdesk://{id})
- GET /api/rustdesk/config returns server configuration correctly
- POST /api/rustdesk/config saves settings correctly
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestRustDeskConfig:
    """RustDesk server configuration tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token for tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get token
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_response.status_code == 200:
            token = login_response.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed - skipping tests")
    
    def test_get_rustdesk_config(self):
        """GET /api/rustdesk/config returns server configuration"""
        response = self.session.get(f"{BASE_URL}/api/rustdesk/config")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Should have key and value structure
        assert "key" in data or "value" in data or "server_url" in data, "Config should have key/value or direct fields"
        
        # Check for expected config fields
        config = data.get("value", data)
        print(f"RustDesk config: {config}")
        
        # Config should have these fields (may be empty if not configured)
        expected_fields = ["server_url", "api_key", "relay_server", "enabled"]
        for field in expected_fields:
            assert field in config or field in data, f"Config should have {field} field"
    
    def test_save_rustdesk_config(self):
        """POST /api/rustdesk/config saves settings correctly"""
        test_config = {
            "server_url": "https://test.rustdesk.com",
            "api_key": "test-api-key-12345",
            "relay_server": "relay.test.rustdesk.com",
            "enabled": True,
            "auto_sync": True
        }
        
        response = self.session.post(f"{BASE_URL}/api/rustdesk/config", json=test_config)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "message" in data, "Response should have message"
        assert "saved" in data["message"].lower(), f"Expected 'saved' in message, got: {data['message']}"
        
        # Verify config was saved by fetching it
        get_response = self.session.get(f"{BASE_URL}/api/rustdesk/config")
        assert get_response.status_code == 200
        
        saved_config = get_response.json()
        config_value = saved_config.get("value", saved_config)
        
        assert config_value.get("server_url") == test_config["server_url"], "server_url should be saved"
        assert config_value.get("relay_server") == test_config["relay_server"], "relay_server should be saved"
        assert config_value.get("enabled") == test_config["enabled"], "enabled should be saved"
        print(f"Config saved and verified: {config_value}")


class TestRustDeskQuickConnect:
    """RustDesk quick-connect endpoint tests - CRITICAL FIX VERIFICATION"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token for tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get token
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_response.status_code == 200:
            token = login_response.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed - skipping tests")
    
    def test_quick_connect_returns_required_fields(self):
        """POST /api/rustdesk/quick-connect returns connection_url, relay_server, web_client_url, server_url"""
        test_rd_id = "123456789"
        
        response = self.session.post(f"{BASE_URL}/api/rustdesk/quick-connect", json={
            "rustdesk_id": test_rd_id
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        print(f"Quick connect response: {data}")
        
        # CRITICAL: Verify all required fields are present
        assert "connection_url" in data, "Response must have connection_url"
        assert "relay_server" in data, "Response must have relay_server"
        assert "web_client_url" in data, "Response must have web_client_url"
        assert "server_url" in data, "Response must have server_url"
        assert "rustdesk_id" in data, "Response must have rustdesk_id"
        assert "message" in data, "Response must have message"
        
        # Verify rustdesk_id matches
        assert data["rustdesk_id"] == test_rd_id, f"rustdesk_id should match input"
    
    def test_quick_connect_connection_url_format(self):
        """CRITICAL: connection_url format is rustdesk://connection/new/{id} (not rustdesk://{id})"""
        test_rd_id = "987654321"
        
        response = self.session.post(f"{BASE_URL}/api/rustdesk/quick-connect", json={
            "rustdesk_id": test_rd_id
        })
        assert response.status_code == 200
        
        data = response.json()
        connection_url = data.get("connection_url", "")
        
        # CRITICAL FIX VERIFICATION: Must be rustdesk://connection/new/{id}
        expected_format = f"rustdesk://connection/new/{test_rd_id}"
        assert connection_url == expected_format, f"connection_url must be '{expected_format}', got '{connection_url}'"
        
        # Verify it's NOT the old broken format
        old_broken_format = f"rustdesk://{test_rd_id}"
        assert connection_url != old_broken_format, f"connection_url must NOT be old format '{old_broken_format}'"
        
        print(f"PASS: connection_url format is correct: {connection_url}")
    
    def test_quick_connect_requires_rustdesk_id(self):
        """POST /api/rustdesk/quick-connect requires rustdesk_id"""
        response = self.session.post(f"{BASE_URL}/api/rustdesk/quick-connect", json={})
        assert response.status_code == 400, f"Expected 400 for missing rustdesk_id, got {response.status_code}"
        
        # Also test with empty string
        response2 = self.session.post(f"{BASE_URL}/api/rustdesk/quick-connect", json={
            "rustdesk_id": ""
        })
        assert response2.status_code == 400, f"Expected 400 for empty rustdesk_id, got {response2.status_code}"


class TestRustDeskDeviceConnect:
    """RustDesk device connect endpoint tests - CRITICAL FIX VERIFICATION"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token and find a device with RustDesk ID"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get token
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_response.status_code == 200:
            token = login_response.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed - skipping tests")
        
        # Get all devices to find one with RustDesk ID
        devices_response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        if devices_response.status_code == 200:
            devices = devices_response.json()
            # Find a device with rd_entry_id (registered RustDesk device)
            self.test_device = None
            for d in devices:
                if d.get("rd_entry_id"):
                    self.test_device = d
                    break
            
            # If no registered device, create one for testing
            if not self.test_device and devices:
                # Get first client to create a test device
                clients_response = self.session.get(f"{BASE_URL}/api/clients")
                if clients_response.status_code == 200:
                    clients = clients_response.json()
                    if clients:
                        client_id = clients[0].get("id")
                        # Create a test RustDesk device
                        create_response = self.session.post(
                            f"{BASE_URL}/api/rustdesk/clients/{client_id}/devices",
                            json={
                                "device_name": "TEST_RustDesk_Device",
                                "rustdesk_id": "TEST123456",
                                "rustdesk_password": "testpass123",
                                "os": "Windows 11"
                            }
                        )
                        if create_response.status_code == 200:
                            self.test_device = create_response.json()
                            self.test_device["rd_entry_id"] = self.test_device.get("id")
    
    def test_device_connect_returns_required_fields(self):
        """POST /api/rustdesk/devices/{id}/connect returns connection_url, relay_server, web_client_url, rustdesk_password"""
        if not hasattr(self, 'test_device') or not self.test_device:
            pytest.skip("No RustDesk device available for testing")
        
        device_id = self.test_device.get("rd_entry_id") or self.test_device.get("id")
        
        response = self.session.post(f"{BASE_URL}/api/rustdesk/devices/{device_id}/connect", json={})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        print(f"Device connect response: {data}")
        
        # CRITICAL: Verify all required fields are present
        assert "connection_url" in data, "Response must have connection_url"
        assert "relay_server" in data, "Response must have relay_server"
        assert "web_client_url" in data, "Response must have web_client_url"
        assert "rustdesk_password" in data, "Response must have rustdesk_password"
        assert "rustdesk_id" in data, "Response must have rustdesk_id"
        assert "message" in data, "Response must have message"
    
    def test_device_connect_connection_url_format(self):
        """CRITICAL: connection_url format is rustdesk://connection/new/{id}"""
        if not hasattr(self, 'test_device') or not self.test_device:
            pytest.skip("No RustDesk device available for testing")
        
        device_id = self.test_device.get("rd_entry_id") or self.test_device.get("id")
        rd_id = self.test_device.get("rd_id") or self.test_device.get("rustdesk_id")
        
        response = self.session.post(f"{BASE_URL}/api/rustdesk/devices/{device_id}/connect", json={})
        assert response.status_code == 200
        
        data = response.json()
        connection_url = data.get("connection_url", "")
        actual_rd_id = data.get("rustdesk_id", rd_id)
        
        # CRITICAL FIX VERIFICATION: Must be rustdesk://connection/new/{id}
        expected_format = f"rustdesk://connection/new/{actual_rd_id}"
        assert connection_url == expected_format, f"connection_url must be '{expected_format}', got '{connection_url}'"
        
        print(f"PASS: Device connect connection_url format is correct: {connection_url}")
    
    def test_device_connect_not_found(self):
        """POST /api/rustdesk/devices/{id}/connect returns 404 for non-existent device"""
        response = self.session.post(f"{BASE_URL}/api/rustdesk/devices/nonexistent-device-id/connect", json={})
        assert response.status_code == 404, f"Expected 404 for non-existent device, got {response.status_code}"


class TestRustDeskAllDevices:
    """RustDesk all-devices endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token for tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get token
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_response.status_code == 200:
            token = login_response.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed - skipping tests")
    
    def test_get_all_devices(self):
        """GET /api/rustdesk/all-devices returns device list"""
        response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        if len(data) > 0:
            device = data[0]
            # Check expected fields
            expected_fields = ["id", "name", "rd_registered"]
            for field in expected_fields:
                assert field in device, f"Device should have {field} field"
            print(f"Found {len(data)} devices, first device: {device.get('name')}")


class TestRemoteProviders:
    """Remote providers (Integrations tab) tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token for tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get token
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_response.status_code == 200:
            token = login_response.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed - skipping tests")
    
    def test_get_remote_providers_returns_7(self):
        """GET /api/remote-providers returns 7 providers"""
        response = self.session.get(f"{BASE_URL}/api/remote-providers")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        assert len(data) == 7, f"Expected 7 providers, got {len(data)}"
        
        # Verify expected providers
        provider_names = [p.get("name") for p in data]
        expected_providers = ["RustDesk", "MeshCentral", "Splashtop", "ConnectWise ScreenConnect", "TeamViewer", "AnyDesk", "Apache Guacamole"]
        for expected in expected_providers:
            assert expected in provider_names, f"Provider '{expected}' should be in list"
        
        print(f"All 7 providers found: {provider_names}")


# Run tests if executed directly
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
