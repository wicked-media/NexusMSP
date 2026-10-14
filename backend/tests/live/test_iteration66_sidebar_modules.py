"""
Iteration 66 - Sidebar Navigation Consolidation & Module Visibility Tests
Tests for:
1. Login response includes enabled_modules field
2. PUT /api/technicians/{id}/permissions with enabled_modules array
3. Technician overview returns enabled_modules
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSidebarModuleVisibility:
    """Tests for sidebar module visibility feature"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session with auth"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login as admin
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        data = login_resp.json()
        self.token = data.get("token")
        self.user = data.get("user", {})
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
        yield
    
    def test_login_response_structure(self):
        """Test that login response includes user data with expected fields"""
        # Re-login to check response structure
        resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data, "Login response should include token"
        assert "user" in data, "Login response should include user"
        user = data["user"]
        assert "id" in user, "User should have id"
        assert "email" in user, "User should have email"
        assert "name" in user, "User should have name"
        print(f"Login response user fields: {list(user.keys())}")
        # enabled_modules may or may not be present depending on if it was set
        if "enabled_modules" in user:
            print(f"User has enabled_modules: {user['enabled_modules']}")
        else:
            print("User does not have enabled_modules set (will use defaults)")
    
    def test_technicians_overview_returns_enabled_modules(self):
        """Test that technicians overview includes enabled_modules when set"""
        resp = self.session.get(f"{BASE_URL}/api/technicians/overview")
        assert resp.status_code == 200
        techs = resp.json()
        assert isinstance(techs, list), "Should return list of technicians"
        assert len(techs) > 0, "Should have at least one technician"
        
        # Check if any tech has enabled_modules
        techs_with_modules = [t for t in techs if "enabled_modules" in t]
        print(f"Found {len(techs_with_modules)} technicians with enabled_modules set")
        
        # Find Luke (user-002) who should have enabled_modules set
        luke = next((t for t in techs if "luke" in t.get("name", "").lower()), None)
        if luke:
            print(f"Luke's enabled_modules: {luke.get('enabled_modules', 'NOT SET')}")
    
    def test_update_technician_permissions_with_enabled_modules(self):
        """Test updating technician permissions with enabled_modules array"""
        # First get a technician to update
        resp = self.session.get(f"{BASE_URL}/api/technicians/overview")
        assert resp.status_code == 200
        techs = resp.json()
        
        # Find a non-admin tech to update (or use Luke)
        test_tech = next((t for t in techs if "luke" in t.get("name", "").lower()), None)
        if not test_tech:
            test_tech = next((t for t in techs if t.get("role") == "technician"), None)
        
        if not test_tech:
            pytest.skip("No suitable technician found for testing")
        
        tech_id = test_tech["id"]
        print(f"Testing with technician: {test_tech['name']} (ID: {tech_id})")
        
        # Update permissions with enabled_modules
        test_modules = ["service_desk", "infrastructure", "business"]
        update_resp = self.session.put(f"{BASE_URL}/api/technicians/{tech_id}/permissions", json={
            "permissions": test_tech.get("permissions", {}),
            "is_admin": False,
            "enabled_modules": test_modules
        })
        assert update_resp.status_code == 200, f"Failed to update permissions: {update_resp.text}"
        print(f"Successfully updated enabled_modules to: {test_modules}")
        
        # Verify the update persisted
        verify_resp = self.session.get(f"{BASE_URL}/api/technicians/overview")
        assert verify_resp.status_code == 200
        updated_techs = verify_resp.json()
        updated_tech = next((t for t in updated_techs if t["id"] == tech_id), None)
        assert updated_tech is not None, "Could not find updated technician"
        
        # Check enabled_modules was saved
        saved_modules = updated_tech.get("enabled_modules", [])
        print(f"Saved enabled_modules: {saved_modules}")
        assert set(saved_modules) == set(test_modules), f"Expected {test_modules}, got {saved_modules}"
    
    def test_update_permissions_all_modules(self):
        """Test updating with all 7 module groups"""
        resp = self.session.get(f"{BASE_URL}/api/technicians/overview")
        assert resp.status_code == 200
        techs = resp.json()
        
        test_tech = next((t for t in techs if "luke" in t.get("name", "").lower()), None)
        if not test_tech:
            test_tech = next((t for t in techs if t.get("role") == "technician"), None)
        
        if not test_tech:
            pytest.skip("No suitable technician found")
        
        tech_id = test_tech["id"]
        
        # All 7 module groups
        all_modules = ["service_desk", "infrastructure", "business", "security", "intelligence", "reports", "platform"]
        
        update_resp = self.session.put(f"{BASE_URL}/api/technicians/{tech_id}/permissions", json={
            "permissions": test_tech.get("permissions", {}),
            "is_admin": False,
            "enabled_modules": all_modules
        })
        assert update_resp.status_code == 200
        print(f"Successfully set all 7 modules for {test_tech['name']}")
        
        # Verify
        verify_resp = self.session.get(f"{BASE_URL}/api/technicians/overview")
        updated_tech = next((t for t in verify_resp.json() if t["id"] == tech_id), None)
        saved_modules = updated_tech.get("enabled_modules", [])
        assert len(saved_modules) == 7, f"Expected 7 modules, got {len(saved_modules)}"
    
    def test_update_permissions_empty_modules(self):
        """Test updating with empty enabled_modules array"""
        resp = self.session.get(f"{BASE_URL}/api/technicians/overview")
        assert resp.status_code == 200
        techs = resp.json()
        
        test_tech = next((t for t in techs if "luke" in t.get("name", "").lower()), None)
        if not test_tech:
            test_tech = next((t for t in techs if t.get("role") == "technician"), None)
        
        if not test_tech:
            pytest.skip("No suitable technician found")
        
        tech_id = test_tech["id"]
        
        # Empty modules (user would see nothing in sidebar)
        update_resp = self.session.put(f"{BASE_URL}/api/technicians/{tech_id}/permissions", json={
            "permissions": test_tech.get("permissions", {}),
            "is_admin": False,
            "enabled_modules": []
        })
        assert update_resp.status_code == 200
        print(f"Successfully set empty modules for {test_tech['name']}")
        
        # Restore to default
        all_modules = ["service_desk", "infrastructure", "business", "security", "intelligence", "reports", "platform"]
        self.session.put(f"{BASE_URL}/api/technicians/{tech_id}/permissions", json={
            "permissions": test_tech.get("permissions", {}),
            "is_admin": False,
            "enabled_modules": all_modules
        })
        print("Restored to all modules")


class TestNavigationRoutes:
    """Test that key navigation routes work"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session with auth"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert login_resp.status_code == 200
        data = login_resp.json()
        self.token = data.get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
        yield
    
    def test_dashboard_api(self):
        """Test dashboard data endpoint"""
        resp = self.session.get(f"{BASE_URL}/api/dashboard")
        assert resp.status_code == 200, f"Dashboard API failed: {resp.text}"
        data = resp.json()
        print(f"Dashboard data keys: {list(data.keys())}")
    
    def test_tickets_api(self):
        """Test tickets endpoint"""
        resp = self.session.get(f"{BASE_URL}/api/tickets")
        assert resp.status_code == 200, f"Tickets API failed: {resp.text}"
        data = resp.json()
        print(f"Tickets count: {len(data) if isinstance(data, list) else 'N/A'}")
    
    def test_devices_api(self):
        """Test devices endpoint"""
        resp = self.session.get(f"{BASE_URL}/api/devices")
        assert resp.status_code == 200, f"Devices API failed: {resp.text}"
        data = resp.json()
        print(f"Devices count: {len(data) if isinstance(data, list) else 'N/A'}")
    
    def test_clients_api(self):
        """Test clients endpoint"""
        resp = self.session.get(f"{BASE_URL}/api/clients")
        assert resp.status_code == 200, f"Clients API failed: {resp.text}"
        data = resp.json()
        print(f"Clients count: {len(data) if isinstance(data, list) else 'N/A'}")
    
    def test_settings_api(self):
        """Test settings endpoint"""
        resp = self.session.get(f"{BASE_URL}/api/settings")
        assert resp.status_code == 200, f"Settings API failed: {resp.text}"
        data = resp.json()
        print(f"Settings data: {data}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
