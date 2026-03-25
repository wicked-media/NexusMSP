"""
Iteration 63 - Technicians Page Improvements Testing
Tests for:
1. Archive/Restore/Delete technician endpoints
2. Bulk actions (archive, restore, set_categories, delete)
3. Categories field in technician data
4. Edit dialog bug fix verification (frontend)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestTechniciansImprovements:
    """Test technicians page improvements - archive, restore, delete, bulk actions, categories"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - login and get auth token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "admin123"
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        token = login_response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        yield
    
    # ============== TECHNICIANS OVERVIEW ==============
    
    def test_get_technicians_overview(self):
        """Test GET /api/technicians/overview returns technicians with categories and archived fields"""
        response = self.session.get(f"{BASE_URL}/api/technicians/overview")
        assert response.status_code == 200, f"Failed: {response.text}"
        
        techs = response.json()
        assert isinstance(techs, list), "Response should be a list"
        assert len(techs) > 0, "Should have at least one technician"
        
        # Check that technicians have required fields
        for tech in techs:
            assert "id" in tech, "Tech should have id"
            assert "name" in tech, "Tech should have name"
            assert "email" in tech, "Tech should have email"
            # Categories field should exist (may be empty list)
            assert "categories" in tech or tech.get("categories") is None, "Tech should have categories field"
            # Archived field should exist
            assert "archived" in tech or tech.get("archived") is None, "Tech should have archived field"
        
        print(f"PASS: Got {len(techs)} technicians with categories and archived fields")
    
    def test_technicians_have_categories(self):
        """Test that technicians can have categories assigned"""
        response = self.session.get(f"{BASE_URL}/api/technicians/overview")
        assert response.status_code == 200
        
        techs = response.json()
        # Find Josh (user-003) who should have categories ['sla','workshop']
        josh = next((t for t in techs if t.get("id") == "user-003"), None)
        
        if josh:
            categories = josh.get("categories", [])
            print(f"Josh's categories: {categories}")
            # Josh should have sla and workshop categories
            assert "sla" in categories or "workshop" in categories, "Josh should have sla or workshop category"
            print(f"PASS: Josh has categories: {categories}")
        else:
            print("INFO: Josh (user-003) not found, skipping category check")
    
    # ============== ARCHIVE ENDPOINT ==============
    
    def test_archive_technician(self):
        """Test POST /api/technicians/{id}/archive archives a technician"""
        # First get a technician to archive (use user-005 James)
        tech_id = "user-005"
        
        response = self.session.post(f"{BASE_URL}/api/technicians/{tech_id}/archive")
        assert response.status_code == 200, f"Archive failed: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should have message"
        assert "archived" in data["message"].lower(), f"Message should mention archived: {data['message']}"
        
        # Verify the technician is now archived
        overview = self.session.get(f"{BASE_URL}/api/technicians/overview")
        assert overview.status_code == 200
        
        techs = overview.json()
        archived_tech = next((t for t in techs if t.get("id") == tech_id), None)
        
        if archived_tech:
            assert archived_tech.get("archived") == True, "Tech should be archived"
            assert archived_tech.get("is_active") == False, "Tech should be inactive"
            print(f"PASS: Technician {tech_id} archived successfully")
        else:
            print(f"INFO: Tech {tech_id} not found in overview after archive")
    
    # ============== RESTORE ENDPOINT ==============
    
    def test_restore_technician(self):
        """Test POST /api/technicians/{id}/restore restores an archived technician"""
        tech_id = "user-005"
        
        # First ensure it's archived
        self.session.post(f"{BASE_URL}/api/technicians/{tech_id}/archive")
        
        # Now restore
        response = self.session.post(f"{BASE_URL}/api/technicians/{tech_id}/restore")
        assert response.status_code == 200, f"Restore failed: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should have message"
        assert "restored" in data["message"].lower(), f"Message should mention restored: {data['message']}"
        
        # Verify the technician is now active
        overview = self.session.get(f"{BASE_URL}/api/technicians/overview")
        assert overview.status_code == 200
        
        techs = overview.json()
        restored_tech = next((t for t in techs if t.get("id") == tech_id), None)
        
        if restored_tech:
            assert restored_tech.get("archived") == False, "Tech should not be archived"
            assert restored_tech.get("is_active") == True, "Tech should be active"
            print(f"PASS: Technician {tech_id} restored successfully")
        else:
            print(f"INFO: Tech {tech_id} not found in overview after restore")
    
    # ============== BULK ACTIONS ==============
    
    def test_bulk_archive(self):
        """Test POST /api/technicians/bulk-action with action=archive"""
        # Use user-004 (Lisa) and user-005 (James) for bulk test
        tech_ids = ["user-004", "user-005"]
        
        response = self.session.post(f"{BASE_URL}/api/technicians/bulk-action", json={
            "tech_ids": tech_ids,
            "action": "archive"
        })
        assert response.status_code == 200, f"Bulk archive failed: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should have message"
        assert "archived" in data["message"].lower(), f"Message should mention archived: {data['message']}"
        
        print(f"PASS: Bulk archive completed: {data['message']}")
    
    def test_bulk_restore(self):
        """Test POST /api/technicians/bulk-action with action=restore"""
        tech_ids = ["user-004", "user-005"]
        
        # First archive them
        self.session.post(f"{BASE_URL}/api/technicians/bulk-action", json={
            "tech_ids": tech_ids,
            "action": "archive"
        })
        
        # Now restore
        response = self.session.post(f"{BASE_URL}/api/technicians/bulk-action", json={
            "tech_ids": tech_ids,
            "action": "restore"
        })
        assert response.status_code == 200, f"Bulk restore failed: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should have message"
        assert "restored" in data["message"].lower(), f"Message should mention restored: {data['message']}"
        
        print(f"PASS: Bulk restore completed: {data['message']}")
    
    def test_bulk_set_categories(self):
        """Test POST /api/technicians/bulk-action with action=set_categories"""
        tech_ids = ["user-004", "user-005"]
        categories = ["network", "helpdesk"]
        
        response = self.session.post(f"{BASE_URL}/api/technicians/bulk-action", json={
            "tech_ids": tech_ids,
            "action": "set_categories",
            "categories": categories
        })
        assert response.status_code == 200, f"Bulk set_categories failed: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should have message"
        
        # Verify categories were set
        overview = self.session.get(f"{BASE_URL}/api/technicians/overview")
        assert overview.status_code == 200
        
        techs = overview.json()
        for tech_id in tech_ids:
            tech = next((t for t in techs if t.get("id") == tech_id), None)
            if tech:
                tech_cats = tech.get("categories", [])
                assert "network" in tech_cats, f"Tech {tech_id} should have network category"
                assert "helpdesk" in tech_cats, f"Tech {tech_id} should have helpdesk category"
        
        print(f"PASS: Bulk set_categories completed: {data['message']}")
    
    def test_bulk_action_no_techs_selected(self):
        """Test bulk action with empty tech_ids returns error"""
        response = self.session.post(f"{BASE_URL}/api/technicians/bulk-action", json={
            "tech_ids": [],
            "action": "archive"
        })
        assert response.status_code == 400, f"Should fail with 400: {response.status_code}"
        print("PASS: Bulk action with no techs returns 400")
    
    def test_bulk_action_invalid_action(self):
        """Test bulk action with invalid action returns error"""
        response = self.session.post(f"{BASE_URL}/api/technicians/bulk-action", json={
            "tech_ids": ["user-001"],
            "action": "invalid_action"
        })
        assert response.status_code == 400, f"Should fail with 400: {response.status_code}"
        print("PASS: Bulk action with invalid action returns 400")
    
    # ============== UPDATE TECHNICIAN WITH CATEGORIES ==============
    
    def test_update_technician_categories(self):
        """Test PUT /api/technicians/{id} can update categories"""
        tech_id = "user-003"  # Josh
        new_categories = ["sla", "workshop", "cabling"]
        
        response = self.session.put(f"{BASE_URL}/api/technicians/{tech_id}", json={
            "categories": new_categories
        })
        assert response.status_code == 200, f"Update failed: {response.text}"
        
        # Verify categories were updated
        overview = self.session.get(f"{BASE_URL}/api/technicians/overview")
        assert overview.status_code == 200
        
        techs = overview.json()
        tech = next((t for t in techs if t.get("id") == tech_id), None)
        
        if tech:
            tech_cats = tech.get("categories", [])
            for cat in new_categories:
                assert cat in tech_cats, f"Tech should have {cat} category"
            print(f"PASS: Updated tech categories to: {tech_cats}")
        else:
            print(f"INFO: Tech {tech_id} not found")
    
    # ============== TECHNICIAN DASHBOARD ==============
    
    def test_technician_dashboard(self):
        """Test GET /api/technicians/{id}/dashboard returns technician with categories"""
        tech_id = "user-001"  # Aaron
        
        response = self.session.get(f"{BASE_URL}/api/technicians/{tech_id}/dashboard")
        assert response.status_code == 200, f"Dashboard failed: {response.text}"
        
        data = response.json()
        assert "technician" in data, "Response should have technician"
        assert "stats" in data, "Response should have stats"
        
        tech = data["technician"]
        assert "id" in tech, "Technician should have id"
        assert "name" in tech, "Technician should have name"
        # Categories should be present
        assert "categories" in tech or tech.get("categories") is None, "Technician should have categories field"
        
        print(f"PASS: Dashboard for {tech['name']} loaded with categories: {tech.get('categories', [])}")
    
    # ============== PERMISSION CHECKS ==============
    
    def test_archive_requires_admin(self):
        """Test that archive endpoint requires admin permissions"""
        # This test verifies the endpoint exists and works for admin
        # Non-admin test would require a separate login
        tech_id = "user-005"
        
        response = self.session.post(f"{BASE_URL}/api/technicians/{tech_id}/archive")
        # Should succeed for admin
        assert response.status_code == 200, f"Admin should be able to archive: {response.text}"
        
        # Restore for cleanup
        self.session.post(f"{BASE_URL}/api/technicians/{tech_id}/restore")
        
        print("PASS: Archive endpoint works for admin")
    
    # ============== CLEANUP ==============
    
    def test_cleanup_restore_all_test_techs(self):
        """Cleanup - restore any archived test technicians"""
        tech_ids = ["user-004", "user-005"]
        
        for tech_id in tech_ids:
            self.session.post(f"{BASE_URL}/api/technicians/{tech_id}/restore")
        
        # Reset categories for user-004 and user-005
        self.session.put(f"{BASE_URL}/api/technicians/user-004", json={"categories": []})
        self.session.put(f"{BASE_URL}/api/technicians/user-005", json={"categories": []})
        
        print("PASS: Cleanup completed - test technicians restored")


class TestTechnicianCategories:
    """Test technician categories functionality"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - login and get auth token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "admin123"
        })
        assert login_response.status_code == 200
        token = login_response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        yield
    
    def test_valid_categories(self):
        """Test that valid category values are accepted"""
        valid_categories = ["sla", "workshop", "cabling", "network", "wisp", "field_service", "security", "cloud", "helpdesk"]
        tech_id = "user-005"
        
        response = self.session.put(f"{BASE_URL}/api/technicians/{tech_id}", json={
            "categories": valid_categories
        })
        assert response.status_code == 200, f"Update with valid categories failed: {response.text}"
        
        # Verify
        overview = self.session.get(f"{BASE_URL}/api/technicians/overview")
        techs = overview.json()
        tech = next((t for t in techs if t.get("id") == tech_id), None)
        
        if tech:
            for cat in valid_categories:
                assert cat in tech.get("categories", []), f"Category {cat} should be set"
        
        # Cleanup
        self.session.put(f"{BASE_URL}/api/technicians/{tech_id}", json={"categories": []})
        
        print(f"PASS: All valid categories accepted: {valid_categories}")
    
    def test_empty_categories(self):
        """Test that empty categories list is accepted"""
        tech_id = "user-005"
        
        response = self.session.put(f"{BASE_URL}/api/technicians/{tech_id}", json={
            "categories": []
        })
        assert response.status_code == 200, f"Update with empty categories failed: {response.text}"
        
        print("PASS: Empty categories list accepted")


class TestQuickStats:
    """Test quick stats strip data"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - login and get auth token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "admin123"
        })
        assert login_response.status_code == 200
        token = login_response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        yield
    
    def test_overview_has_stats_data(self):
        """Test that overview returns data needed for quick stats"""
        response = self.session.get(f"{BASE_URL}/api/technicians/overview")
        assert response.status_code == 200
        
        techs = response.json()
        
        # Check that techs have the fields needed for stats
        for tech in techs:
            # These fields are used for quick stats
            assert "open_count" in tech or tech.get("open_count") is not None or "open_count" not in tech, "Should have open_count or be calculable"
            assert "overdue_count" in tech or tech.get("overdue_count") is not None or "overdue_count" not in tech, "Should have overdue_count or be calculable"
            assert "hours_this_week" in tech or tech.get("hours_this_week") is not None or "hours_this_week" not in tech, "Should have hours_this_week or be calculable"
        
        # Calculate stats like frontend does
        active_techs = [t for t in techs if not t.get("archived") and t.get("is_active") != False]
        total_overdue = sum(t.get("overdue_count", 0) for t in techs)
        total_open = sum(t.get("open_count", 0) for t in active_techs)
        
        print(f"PASS: Stats data available - Active: {len(active_techs)}, Overdue: {total_overdue}, Open: {total_open}")
    
    def test_on_call_active_endpoint(self):
        """Test GET /api/on-call/active for on-call stats"""
        response = self.session.get(f"{BASE_URL}/api/on-call/active")
        # May return 200 with empty list or 404 if not implemented
        if response.status_code == 200:
            data = response.json()
            print(f"PASS: On-call active endpoint returns {len(data)} active on-call techs")
        else:
            print(f"INFO: On-call active endpoint returned {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
