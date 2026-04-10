"""
Iteration 72 - Code Quality & Security Fixes Testing
Tests:
1. Backend APIs still work after random→SystemRandom changes
2. Login flow works correctly
3. Portal login works correctly
4. Key endpoints return valid data
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "aaron@stech.com.au"
ADMIN_PASSWORD = "Lucky@2871$!"
PORTAL_EMAIL = "john@acmecorp.com"
PORTAL_PASSWORD = "portal123"


class TestAdminAuth:
    """Test admin authentication flow"""
    
    def test_admin_login_success(self):
        """Test admin login returns token and user"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in response"
        assert "user" in data, "No user in response"
        assert data["user"]["email"] == ADMIN_EMAIL
        print(f"✓ Admin login successful, token received")
    
    def test_auth_me_endpoint(self):
        """Test /api/auth/me returns user info"""
        # First login
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        token = login_resp.json()["token"]
        
        # Then get user info
        response = requests.get(f"{BASE_URL}/api/auth/me", headers={
            "Authorization": f"Bearer {token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == ADMIN_EMAIL
        print(f"✓ Auth me endpoint works correctly")


class TestPortalAuth:
    """Test portal authentication flow"""
    
    def test_portal_login_success(self):
        """Test portal login returns token and user"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        assert response.status_code == 200, f"Portal login failed: {response.text}"
        data = response.json()
        # Portal may return token directly or require 2FA
        assert "token" in data or "requires_2fa" in data, "No token or 2FA flag in response"
        if "token" in data:
            assert "user" in data, "No user in response"
            print(f"✓ Portal login successful, token received")
        else:
            print(f"✓ Portal login requires 2FA (expected behavior)")


class TestSystemRandomEndpoints:
    """Test endpoints that use SystemRandom for demo data generation"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token for authenticated requests"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        self.token = login_resp.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_nps_tracker_overview(self):
        """Test NPS tracker endpoint works after SystemRandom change"""
        response = requests.get(f"{BASE_URL}/api/nps-tracker/overview", headers=self.headers)
        assert response.status_code == 200, f"NPS tracker failed: {response.text}"
        data = response.json()
        assert "surveys" in data, "No surveys in response"
        assert "summary" in data, "No summary in response"
        assert "nps_score" in data["summary"], "No NPS score in summary"
        print(f"✓ NPS tracker works, NPS score: {data['summary']['nps_score']}")
    
    def test_hardware_refresh_overview(self):
        """Test hardware refresh endpoint works after SystemRandom change"""
        response = requests.get(f"{BASE_URL}/api/hardware-refresh/overview", headers=self.headers)
        assert response.status_code == 200, f"Hardware refresh failed: {response.text}"
        data = response.json()
        assert "devices" in data, "No devices in response"
        assert "summary" in data, "No summary in response"
        print(f"✓ Hardware refresh works, {data['summary']['total_tracked']} devices tracked")
    
    def test_backup_verify_overview(self):
        """Test backup verify endpoint works after SystemRandom change"""
        response = requests.get(f"{BASE_URL}/api/backup-verify/overview", headers=self.headers)
        assert response.status_code == 200, f"Backup verify failed: {response.text}"
        data = response.json()
        assert "jobs" in data or "summary" in data, "No jobs or summary in response"
        print(f"✓ Backup verify works")
    
    def test_executive_reports_overview(self):
        """Test executive reports endpoint works after SystemRandom change"""
        response = requests.get(f"{BASE_URL}/api/executive-reports/overview", headers=self.headers)
        assert response.status_code == 200, f"Executive reports failed: {response.text}"
        data = response.json()
        print(f"✓ Executive reports works")


class TestDashboardEndpoints:
    """Test dashboard endpoints to ensure app still works"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token for authenticated requests"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        self.token = login_resp.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_dashboard_stats(self):
        """Test dashboard stats endpoint"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=self.headers)
        assert response.status_code == 200, f"Dashboard stats failed: {response.text}"
        data = response.json()
        print(f"✓ Dashboard stats works")
    
    def test_tickets_list(self):
        """Test tickets list endpoint"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=self.headers)
        assert response.status_code == 200, f"Tickets list failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Tickets should be a list"
        print(f"✓ Tickets list works, {len(data)} tickets")
    
    def test_devices_list(self):
        """Test devices list endpoint"""
        response = requests.get(f"{BASE_URL}/api/devices", headers=self.headers)
        assert response.status_code == 200, f"Devices list failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Devices should be a list"
        print(f"✓ Devices list works, {len(data)} devices")


class TestSeedEndpoint:
    """Test seed endpoint"""
    
    def test_seed_endpoint(self):
        """Test seed endpoint works"""
        response = requests.post(f"{BASE_URL}/api/seed")
        assert response.status_code == 200, f"Seed failed: {response.text}"
        print(f"✓ Seed endpoint works")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
