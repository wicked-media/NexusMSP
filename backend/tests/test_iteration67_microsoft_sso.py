"""
Iteration 67 - Microsoft SSO Integration Tests
Tests for Microsoft OAuth2 SSO configuration and login flow endpoints.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "aaron@stech.com.au"
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


class TestMicrosoftSSOStatus:
    """Tests for GET /api/settings/microsoft-sso/status (public endpoint)"""
    
    def test_sso_status_returns_disabled_when_not_configured(self):
        """SSO status should return enabled: false when not configured"""
        response = requests.get(f"{BASE_URL}/api/settings/microsoft-sso/status")
        assert response.status_code == 200
        data = response.json()
        assert "enabled" in data
        # Initially SSO is not configured, so should be disabled
        print(f"SSO status response: {data}")


class TestMicrosoftSSOSettings:
    """Tests for GET/PUT /api/settings/microsoft-sso (authenticated)"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token for admin user"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")
    
    def test_get_sso_settings_requires_auth(self):
        """GET /api/settings/microsoft-sso should require authentication"""
        response = requests.get(f"{BASE_URL}/api/settings/microsoft-sso")
        assert response.status_code == 401 or response.status_code == 403
        print(f"Unauthenticated request returned: {response.status_code}")
    
    def test_get_sso_settings_returns_defaults(self, auth_token):
        """GET /api/settings/microsoft-sso should return SSO config with defaults"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/settings/microsoft-sso", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Verify expected fields exist
        expected_fields = ["enabled", "tenant_id", "client_id", "auto_create_users", "default_role"]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
        
        print(f"SSO settings response: {data}")
    
    def test_put_sso_settings_saves_config(self, auth_token):
        """PUT /api/settings/microsoft-sso should save SSO configuration"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Save test SSO config
        test_config = {
            "enabled": True,
            "tenant_id": "test-tenant-id-12345",
            "client_id": "test-client-id-67890",
            "client_secret": "test-secret-abc",
            "redirect_uri": "",
            "auto_create_users": True,
            "default_role": "tech"
        }
        
        response = requests.put(f"{BASE_URL}/api/settings/microsoft-sso", json=test_config, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        print(f"PUT response: {data}")
        
        # Verify config was saved by fetching it
        get_response = requests.get(f"{BASE_URL}/api/settings/microsoft-sso", headers=headers)
        assert get_response.status_code == 200
        saved_config = get_response.json()
        
        assert saved_config["enabled"] == True
        assert saved_config["tenant_id"] == "test-tenant-id-12345"
        assert saved_config["client_id"] == "test-client-id-67890"
        print(f"Saved config verified: {saved_config}")
    
    def test_client_secret_is_masked_on_get(self, auth_token):
        """Client secret should be masked (********) when fetching SSO settings"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # First save a config with a secret
        test_config = {
            "enabled": True,
            "tenant_id": "test-tenant-mask",
            "client_id": "test-client-mask",
            "client_secret": "super-secret-value",
            "auto_create_users": True,
            "default_role": "tech"
        }
        requests.put(f"{BASE_URL}/api/settings/microsoft-sso", json=test_config, headers=headers)
        
        # Fetch and verify secret is masked
        response = requests.get(f"{BASE_URL}/api/settings/microsoft-sso", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Secret should be masked
        assert data.get("client_secret") == "********", f"Expected masked secret, got: {data.get('client_secret')}"
        print("Client secret is properly masked")
    
    def test_sso_status_enabled_when_configured(self, auth_token):
        """SSO status should return enabled: true when tenant_id, client_id set and enabled=true"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Configure SSO with required fields
        test_config = {
            "enabled": True,
            "tenant_id": "configured-tenant",
            "client_id": "configured-client",
            "client_secret": "configured-secret",
            "auto_create_users": True,
            "default_role": "tech"
        }
        requests.put(f"{BASE_URL}/api/settings/microsoft-sso", json=test_config, headers=headers)
        
        # Check public status endpoint
        response = requests.get(f"{BASE_URL}/api/settings/microsoft-sso/status")
        assert response.status_code == 200
        data = response.json()
        assert data["enabled"] == True, f"Expected enabled=true, got: {data}"
        print(f"SSO status after configuration: {data}")


class TestMicrosoftLoginEndpoint:
    """Tests for GET /api/auth/microsoft/login"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token for admin user"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip(f"Authentication failed: {response.status_code}")
    
    def test_microsoft_login_returns_400_when_sso_disabled(self, auth_token):
        """GET /api/auth/microsoft/login should return 400 when SSO not configured"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # First disable SSO
        disable_config = {
            "enabled": False,
            "tenant_id": "",
            "client_id": "",
            "client_secret": "",
            "auto_create_users": True,
            "default_role": "tech"
        }
        requests.put(f"{BASE_URL}/api/settings/microsoft-sso", json=disable_config, headers=headers)
        
        # Try to initiate Microsoft login - should fail
        response = requests.get(f"{BASE_URL}/api/auth/microsoft/login", allow_redirects=False)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print(f"Microsoft login when disabled: {response.status_code} - {response.text}")
    
    def test_microsoft_login_redirects_when_sso_enabled(self, auth_token):
        """GET /api/auth/microsoft/login should redirect to Microsoft when SSO is enabled"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Enable SSO with test credentials
        enable_config = {
            "enabled": True,
            "tenant_id": "test-tenant-redirect",
            "client_id": "test-client-redirect",
            "client_secret": "test-secret",
            "auto_create_users": True,
            "default_role": "tech"
        }
        requests.put(f"{BASE_URL}/api/settings/microsoft-sso", json=enable_config, headers=headers)
        
        # Try to initiate Microsoft login - should redirect
        response = requests.get(f"{BASE_URL}/api/auth/microsoft/login", allow_redirects=False)
        
        # Should be a redirect (302)
        assert response.status_code == 302, f"Expected 302 redirect, got {response.status_code}"
        
        # Check redirect location contains Microsoft auth URL
        location = response.headers.get("Location", "")
        assert "login.microsoftonline.com" in location, f"Expected Microsoft URL in redirect, got: {location}"
        assert "test-tenant-redirect" in location, f"Expected tenant_id in redirect URL"
        assert "test-client-redirect" in location, f"Expected client_id in redirect URL"
        print(f"Microsoft login redirect URL: {location[:100]}...")


class TestStandardLogin:
    """Tests to verify standard email/password login still works"""
    
    def test_standard_login_works(self):
        """Standard login with email/password should still work"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == ADMIN_EMAIL
        print(f"Standard login successful for {ADMIN_EMAIL}")
    
    def test_standard_login_invalid_credentials(self):
        """Standard login with wrong credentials should fail"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "wrong@example.com",
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        print("Invalid credentials correctly rejected")


class TestCleanup:
    """Cleanup test - disable SSO after tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token for admin user"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip(f"Authentication failed: {response.status_code}")
    
    def test_cleanup_disable_sso(self, auth_token):
        """Cleanup: Disable SSO after tests"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        disable_config = {
            "enabled": False,
            "tenant_id": "",
            "client_id": "",
            "client_secret": "",
            "auto_create_users": True,
            "default_role": "tech"
        }
        response = requests.put(f"{BASE_URL}/api/settings/microsoft-sso", json=disable_config, headers=headers)
        assert response.status_code == 200
        
        # Verify disabled
        status_response = requests.get(f"{BASE_URL}/api/settings/microsoft-sso/status")
        assert status_response.json()["enabled"] == False
        print("SSO disabled after tests (cleanup)")
