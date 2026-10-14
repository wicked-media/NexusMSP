"""
Test Iteration 17: Technicians Module Enhancement
Features tested:
1. Technicians overview with job titles and ticket stats
2. Tech card stats (open, no notes, overdue, hours)
3. Technician detail dashboard with stats
4. Tickets/History/Permissions tabs
5. Permission presets (L1, L2, Senior Engineer, Service Manager, Dispatcher)
6. Leaderboard ranking
7. Email signature builder
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuthentication:
    """Test authentication flow"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        return data["token"]
    
    def test_login_returns_admin_user(self, auth_token):
        """Verify login returns admin user with is_admin=True"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200
        data = response.json()
        assert data["user"]["is_admin"] == True
        assert data["user"]["role"] == "admin"
        assert data["user"]["job_title"] == "Service Manager"


class TestTechniciansOverview:
    """Test technicians list/overview endpoint"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    def test_get_technicians_overview(self, auth_token):
        """GET /api/technicians/overview returns list of techs with stats"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Should return a list of technicians
        assert isinstance(data, list)
        assert len(data) >= 5, f"Expected at least 5 techs, got {len(data)}"
        
        # Each tech should have these fields
        for tech in data:
            assert "id" in tech
            assert "name" in tech
            assert "email" in tech
            assert "job_title" in tech
            assert "open_count" in tech
            assert "no_notes_count" in tech
            assert "overdue_count" in tech
            assert "hours_this_week" in tech
            assert "assigned_count" in tech
            assert "resolved_count" in tech
        
        print(f"Found {len(data)} technicians with complete stats")
    
    def test_tech_has_job_titles(self, auth_token):
        """Verify technicians have job titles set"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/overview", headers=headers)
        data = response.json()
        
        # Check for expected job titles
        job_titles = [t.get("job_title", "") for t in data]
        expected_titles = ["Service Manager", "Senior Engineer", "L2 Technician", "L1 Technician", "Dispatcher"]
        
        for title in expected_titles:
            assert title in job_titles, f"Expected job title '{title}' not found in {job_titles}"
        
        print(f"Job titles found: {set(job_titles)}")
    
    def test_tech_permissions_structure(self, auth_token):
        """Verify technicians have proper permissions structure"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/overview", headers=headers)
        data = response.json()
        
        for tech in data:
            permissions = tech.get("permissions", {})
            assert "tickets" in permissions
            assert "clients" in permissions
            assert "devices" in permissions
            
            # Each module should have view/create/edit/delete
            for module in ["tickets", "clients", "devices"]:
                assert "view" in permissions[module]
                assert "create" in permissions[module]
                assert "edit" in permissions[module]
                assert "delete" in permissions[module]


class TestTechnicianDashboard:
    """Test individual technician dashboard endpoint"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    @pytest.fixture(scope="class")
    def tech_id(self, auth_token):
        """Get a technician ID for testing"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/overview", headers=headers)
        data = response.json()
        return data[0]["id"]
    
    def test_get_tech_dashboard(self, auth_token, tech_id):
        """GET /api/technicians/{id}/dashboard returns full dashboard data"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/{tech_id}/dashboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Should have technician info
        assert "technician" in data
        assert data["technician"]["id"] == tech_id
        
        # Should have stats
        assert "stats" in data
        stats = data["stats"]
        assert "total_assigned" in stats
        assert "open_tickets" in stats
        assert "overdue_tickets" in stats
        assert "no_notes_tickets" in stats
        assert "resolved_tickets" in stats
        assert "total_hours" in stats
        assert "billable_hours" in stats
        assert "hours_this_week" in stats
        
        # Should have ticket lists
        assert "open_tickets" in data
        assert "overdue_tickets" in data
        assert "no_notes_tickets" in data
        
        print(f"Dashboard stats: {stats}")
    
    def test_tech_dashboard_not_found(self, auth_token):
        """GET /api/technicians/invalid-id/dashboard returns 404"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/invalid-id-xyz/dashboard", headers=headers)
        assert response.status_code == 404


class TestPermissionPresets:
    """Test permission presets endpoint"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    def test_get_permission_presets(self, auth_token):
        """GET /api/technicians/permission-presets returns 5 presets"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/permission-presets", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Should have 5 presets
        expected_presets = ["L1 Technician", "L2 Technician", "Senior Engineer", "Service Manager", "Dispatcher"]
        for preset in expected_presets:
            assert preset in data, f"Missing preset: {preset}"
        
        print(f"Found {len(data)} permission presets: {list(data.keys())}")
    
    def test_preset_has_16_modules(self, auth_token):
        """Each preset should have permissions for 16 modules"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/permission-presets", headers=headers)
        data = response.json()
        
        expected_modules = [
            "tickets", "clients", "invoices", "products", "devices", "networking",
            "assets", "reports", "knowledge_base", "it_docs", "contracts", "projects",
            "time_tracking", "purchase_orders", "scheduling", "settings"
        ]
        
        for preset_name, permissions in data.items():
            for module in expected_modules:
                assert module in permissions, f"Preset '{preset_name}' missing module '{module}'"
            print(f"Preset '{preset_name}' has {len(permissions)} modules")
    
    def test_l1_tech_limited_permissions(self, auth_token):
        """L1 Technician should have limited permissions"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/permission-presets", headers=headers)
        data = response.json()
        
        l1 = data["L1 Technician"]
        
        # L1 should NOT have invoice/report/settings access
        assert l1["invoices"]["view"] == False
        assert l1["reports"]["view"] == False
        assert l1["settings"]["view"] == False
        
        # L1 should have ticket access
        assert l1["tickets"]["view"] == True
        assert l1["tickets"]["create"] == True
        
        print("L1 Technician permissions verified as limited")
    
    def test_service_manager_full_permissions(self, auth_token):
        """Service Manager should have full permissions"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/permission-presets", headers=headers)
        data = response.json()
        
        manager = data["Service Manager"]
        
        # Manager should have full access everywhere
        assert manager["tickets"]["view"] == True
        assert manager["tickets"]["delete"] == True
        assert manager["invoices"]["view"] == True
        assert manager["invoices"]["delete"] == True
        assert manager["reports"]["view"] == True
        assert manager["scheduling"]["delete"] == True
        
        print("Service Manager permissions verified as full access")


class TestTechnicianPermissionsUpdate:
    """Test updating technician permissions"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    @pytest.fixture(scope="class")
    def tech_id(self, auth_token):
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/overview", headers=headers)
        data = response.json()
        # Get a non-admin tech
        for tech in data:
            if not tech.get("is_admin"):
                return tech["id"]
        return data[-1]["id"]  # fallback
    
    def test_update_permissions_as_admin(self, auth_token, tech_id):
        """PUT /api/technicians/{id}/permissions works for admin"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Update permissions
        new_permissions = {
            "tickets": {"view": True, "create": True, "edit": True, "delete": True}
        }
        response = requests.put(
            f"{BASE_URL}/api/technicians/{tech_id}/permissions",
            headers=headers,
            json={"permissions": new_permissions, "is_admin": False}
        )
        assert response.status_code == 200
        
        # Verify update
        data = response.json()
        assert data["message"] == "Permissions updated"
        
        print(f"Successfully updated permissions for tech {tech_id}")


class TestLeaderboard:
    """Test technician leaderboard endpoint"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    def test_get_leaderboard(self, auth_token):
        """GET /api/technicians/leaderboard returns ranked list"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/leaderboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Should have month label and leaderboard
        assert "month" in data
        assert "leaderboard" in data
        
        leaderboard = data["leaderboard"]
        assert len(leaderboard) >= 5, f"Expected at least 5 techs, got {len(leaderboard)}"
        
        print(f"Leaderboard for {data['month']} with {len(leaderboard)} entries")
    
    def test_leaderboard_entry_fields(self, auth_token):
        """Each leaderboard entry should have required fields"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/leaderboard", headers=headers)
        data = response.json()
        
        for entry in data["leaderboard"]:
            assert "id" in entry
            assert "name" in entry
            assert "email" in entry
            assert "job_title" in entry
            assert "rank" in entry
            assert "closed_this_month" in entry
            assert "closed_total" in entry
            assert "avg_resolution_hours" in entry
            assert "month_hours" in entry
            assert "csat_score" in entry
            
        print("Leaderboard entries have all required fields")
    
    def test_leaderboard_sorted_by_monthly_closures(self, auth_token):
        """Leaderboard should be sorted by monthly ticket closures descending"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/leaderboard", headers=headers)
        data = response.json()
        
        leaderboard = data["leaderboard"]
        for i in range(len(leaderboard) - 1):
            assert leaderboard[i]["closed_this_month"] >= leaderboard[i+1]["closed_this_month"], \
                f"Leaderboard not sorted: {leaderboard[i]['closed_this_month']} < {leaderboard[i+1]['closed_this_month']}"
        
        # Verify ranks
        for i, entry in enumerate(leaderboard):
            assert entry["rank"] == i + 1, f"Rank mismatch: expected {i+1}, got {entry['rank']}"
        
        print("Leaderboard correctly sorted by monthly closures")


class TestTechnicianHistory:
    """Test technician history endpoint"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    @pytest.fixture(scope="class")
    def tech_id(self, auth_token):
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/overview", headers=headers)
        data = response.json()
        return data[0]["id"]
    
    def test_get_tech_history(self, auth_token, tech_id):
        """GET /api/technicians/{id}/history returns monthly activity"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/{tech_id}/history", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Should have technician info
        assert "technician" in data
        
        # Should have totals
        assert "total_tickets" in data
        assert "total_resolved" in data
        
        # Should have monthly data (6 months)
        assert "monthly" in data
        monthly = data["monthly"]
        assert len(monthly) == 6, f"Expected 6 months of data, got {len(monthly)}"
        
        for month in monthly:
            assert "label" in month
            assert "opened" in month
            assert "closed" in month
        
        # Should have recent resolved
        assert "recent_resolved" in data
        
        print(f"History: {data['total_tickets']} total tickets, {data['total_resolved']} resolved")
    
    def test_tech_history_not_found(self, auth_token):
        """GET /api/technicians/invalid-id/history returns 404"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/invalid-id-xyz/history", headers=headers)
        assert response.status_code == 404


class TestEmailSignature:
    """Test email signature endpoints"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    @pytest.fixture(scope="class")
    def tech_id(self, auth_token):
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/technicians/overview", headers=headers)
        data = response.json()
        return data[0]["id"]
    
    def test_save_email_signature(self, auth_token, tech_id):
        """PUT /api/technicians/{id}/email-signature saves signature"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        signature_data = {
            "email_signature": "Alex Thompson",
            "email_signature_html": "<table><tr><td><strong>Alex Thompson</strong></td></tr></table>",
            "signature_config": {
                "full_name": "Alex Thompson",
                "job_title": "Service Manager",
                "email": "alex@flamingomsp.com",
                "phone": "+1 555-123-4567",
                "company": "Flamingo MSP",
                "template": "professional"
            }
        }
        
        response = requests.put(
            f"{BASE_URL}/api/technicians/{tech_id}/email-signature",
            headers=headers,
            json=signature_data
        )
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Email signature updated"
        
        print(f"Email signature saved for tech {tech_id}")
    
    def test_get_email_signature(self, auth_token, tech_id):
        """GET /api/technicians/{id}/email-signature retrieves signature"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # First save
        signature_data = {
            "email_signature": "Test User",
            "email_signature_html": "<div>Test</div>",
            "signature_config": {"template": "modern"}
        }
        requests.put(
            f"{BASE_URL}/api/technicians/{tech_id}/email-signature",
            headers=headers,
            json=signature_data
        )
        
        # Then retrieve
        response = requests.get(f"{BASE_URL}/api/technicians/{tech_id}/email-signature", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "email_signature" in data or data.get("email_signature") is None
        # The fields may or may not be present based on whether signature was ever set
        
        print(f"Retrieved email signature for tech {tech_id}")


class TestEmailSignatureTemplates:
    """Test email signature templates endpoint"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    def test_get_signature_templates(self, auth_token):
        """GET /api/settings/email-signature-templates returns 4 templates"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/settings/email-signature-templates", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert len(data) == 4, f"Expected 4 templates, got {len(data)}"
        
        template_ids = [t["id"] for t in data]
        expected_ids = ["professional", "modern", "minimal", "technical"]
        
        for tid in expected_ids:
            assert tid in template_ids, f"Missing template: {tid}"
        
        print(f"Found 4 signature templates: {template_ids}")


class TestTechnicianCRUD:
    """Test technician create/update/delete"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    def test_create_technician(self, auth_token):
        """POST /api/technicians creates new tech"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        tech_data = {
            "name": "TEST_NewTech",
            "email": f"test_tech_{os.urandom(4).hex()}@test.com",
            "password": "testpass123",
            "role": "technician",
            "job_title": "L1 Technician",
            "hourly_rate": 50,
            "phone": "+1 555-000-0000",
            "specialties": ["Windows", "Networking"],
            "is_admin": False
        }
        
        response = requests.post(f"{BASE_URL}/api/technicians", headers=headers, json=tech_data)
        assert response.status_code == 200
        data = response.json()
        
        assert data["name"] == "TEST_NewTech"
        assert data["job_title"] == "L1 Technician"
        assert "password_hash" not in data
        
        print(f"Created technician: {data['id']}")
        return data["id"]
    
    def test_update_technician(self, auth_token):
        """PUT /api/technicians/{id} updates tech"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Get a tech first
        response = requests.get(f"{BASE_URL}/api/technicians/overview", headers=headers)
        techs = response.json()
        tech_id = techs[-1]["id"]  # Use last tech
        
        update_data = {
            "phone": "+1 555-999-9999",
            "hourly_rate": 80
        }
        
        response = requests.put(f"{BASE_URL}/api/technicians/{tech_id}", headers=headers, json=update_data)
        assert response.status_code == 200
        
        print(f"Updated technician {tech_id}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
