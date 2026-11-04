"""
Iteration 19 - Regression Test Suite
Testing all major endpoints after modular refactoring of server.py into 30+ router files.
This ensures all functionality works identically after the code restructure.
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "admin@nexusops.io"
TEST_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def auth_token(api_client):
    """Get authentication token for admin user"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    data = response.json()
    assert "token" in data, "No token in login response"
    return data["token"]


@pytest.fixture(scope="module")
def authenticated_client(api_client, auth_token):
    """Session with auth header"""
    api_client.headers.update({"Authorization": f"Bearer {auth_token}"})
    return api_client


class TestAPIRoot:
    """Test root API endpoint"""
    
    def test_api_root_returns_status(self, api_client):
        """GET /api/ - Should return API status"""
        response = api_client.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data.get("message") == "NexusOps API v3.0.0"
        assert data.get("status") == "operational"
        print("✓ API root endpoint working")


class TestAuthEndpoints:
    """Authentication router regression tests"""
    
    def test_login_success(self, api_client):
        """POST /api/auth/login - Returns token for valid credentials"""
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == TEST_EMAIL
        print("✓ Auth login endpoint working")
    
    def test_get_current_user(self, authenticated_client):
        """GET /api/auth/me - Returns current user info"""
        response = authenticated_client.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert "email" in data
        assert data["email"] == TEST_EMAIL
        print("✓ Auth /me endpoint working")


class TestClientsRouter:
    """Clients router regression tests"""
    
    def test_get_clients_list(self, authenticated_client):
        """GET /api/clients - Returns list of clients"""
        response = authenticated_client.get(f"{BASE_URL}/api/clients")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "id" in data[0]
            assert "name" in data[0]
        print(f"✓ Clients list endpoint working ({len(data)} clients)")


class TestTicketsRouter:
    """Tickets router regression tests"""
    
    def test_get_tickets_list(self, authenticated_client):
        """GET /api/tickets - Returns list of tickets"""
        response = authenticated_client.get(f"{BASE_URL}/api/tickets")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "id" in data[0]
            assert "title" in data[0]
        print(f"✓ Tickets list endpoint working ({len(data)} tickets)")


class TestDevicesRouter:
    """Devices router regression tests"""
    
    def test_get_devices_list(self, authenticated_client):
        """GET /api/devices - Returns list of devices"""
        response = authenticated_client.get(f"{BASE_URL}/api/devices")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "id" in data[0]
            assert "name" in data[0]
        print(f"✓ Devices list endpoint working ({len(data)} devices)")


class TestInvoicesRouter:
    """Invoices router regression tests"""
    
    def test_get_invoices_list(self, authenticated_client):
        """GET /api/invoices - Returns list of invoices"""
        response = authenticated_client.get(f"{BASE_URL}/api/invoices")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "id" in data[0]
        print(f"✓ Invoices list endpoint working ({len(data)} invoices)")


class TestProductsRouter:
    """Products router regression tests"""
    
    def test_get_products_list(self, authenticated_client):
        """GET /api/products - Returns list of products"""
        response = authenticated_client.get(f"{BASE_URL}/api/products")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "id" in data[0]
            assert "name" in data[0]
        print(f"✓ Products list endpoint working ({len(data)} products)")


class TestDashboardRouter:
    """Dashboard router regression tests"""
    
    def test_get_dashboard_stats(self, authenticated_client):
        """GET /api/dashboard/stats - Returns dashboard statistics"""
        response = authenticated_client.get(f"{BASE_URL}/api/dashboard/stats")
        assert response.status_code == 200
        data = response.json()
        # Verify expected fields in dashboard stats
        assert "total_clients" in data
        assert "total_devices" in data
        assert "open_tickets" in data
        print(f"✓ Dashboard stats endpoint working (clients: {data['total_clients']}, devices: {data['total_devices']}, open tickets: {data['open_tickets']})")


class TestAchievementsRouter:
    """Achievements router regression tests"""
    
    def test_get_achievements_list(self, authenticated_client):
        """GET /api/achievements - Returns 18+ achievement definitions"""
        response = authenticated_client.get(f"{BASE_URL}/api/achievements")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 18, f"Expected at least 18 achievements, got {len(data)}"
        if len(data) > 0:
            assert "id" in data[0]
            assert "name" in data[0]
        print(f"✓ Achievements list endpoint working ({len(data)} achievements)")


class TestActivityLogsRouter:
    """Activity logs router regression tests"""
    
    def test_get_activity_logs(self, authenticated_client):
        """GET /api/activity-logs - Returns activity logs (admin only)"""
        response = authenticated_client.get(f"{BASE_URL}/api/activity-logs")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Activity logs endpoint working ({len(data)} logs)")


class TestTechniciansRouter:
    """Technicians router regression tests"""
    
    def test_get_technician_status(self, authenticated_client):
        """GET /api/technicians/user-001/status - Returns hover card status"""
        response = authenticated_client.get(f"{BASE_URL}/api/technicians/user-001/status")
        assert response.status_code == 200
        data = response.json()
        # Hover card should have status fields
        assert "status" in data or "is_online" in data or "status_text" in data
        print("✓ Technician status endpoint working")
    
    def test_get_technician_achievements(self, authenticated_client):
        """GET /api/technicians/user-001/achievements - Returns earned badges"""
        response = authenticated_client.get(f"{BASE_URL}/api/technicians/user-001/achievements")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Technician achievements endpoint working ({len(data)} badges)")


class TestRemoteRouter:
    """Remote sessions router regression tests"""
    
    def test_get_active_sessions(self, authenticated_client):
        """GET /api/remote/active-sessions - Returns active remote sessions"""
        response = authenticated_client.get(f"{BASE_URL}/api/remote/active-sessions")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Remote active sessions endpoint working ({len(data)} sessions)")


class TestNetworkingRouter:
    """Networking router regression tests"""
    
    def test_get_network_sites(self, authenticated_client):
        """GET /api/networking/sites - Returns network sites"""
        response = authenticated_client.get(f"{BASE_URL}/api/networking/sites")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Networking sites endpoint working ({len(data)} sites)")


class TestIntegrationsRouter:
    """Integrations/settings router regression tests"""
    
    def test_get_cipp_config(self, authenticated_client):
        """GET /api/settings/cipp - Returns CIPP config"""
        response = authenticated_client.get(f"{BASE_URL}/api/settings/cipp")
        assert response.status_code == 200
        data = response.json()
        # Config can be empty but should return object
        assert isinstance(data, dict)
        print("✓ CIPP settings endpoint working")
    
    def test_get_teams_config(self, authenticated_client):
        """GET /api/settings/microsoft-teams - Returns Teams config"""
        response = authenticated_client.get(f"{BASE_URL}/api/settings/microsoft-teams")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        print("✓ Microsoft Teams settings endpoint working")


class TestContractsRouter:
    """Contracts router regression tests"""
    
    def test_get_contracts_list(self, authenticated_client):
        """GET /api/contracts - Returns contracts list"""
        response = authenticated_client.get(f"{BASE_URL}/api/contracts")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Contracts list endpoint working ({len(data)} contracts)")


class TestAlertsEndpoint:
    """Alerts endpoint regression tests"""
    
    def test_get_alerts(self, authenticated_client):
        """GET /api/alerts - Returns alerts"""
        response = authenticated_client.get(f"{BASE_URL}/api/alerts")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Alerts endpoint working ({len(data)} alerts)")


class TestKnowledgeBaseRouter:
    """Knowledge base router regression tests"""
    
    def test_get_kb_articles(self, authenticated_client):
        """GET /api/kb-articles - Returns KB articles"""
        response = authenticated_client.get(f"{BASE_URL}/api/kb-articles")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Knowledge base endpoint working ({len(data)} articles)")


class TestPax8Integration:
    """Pax8 integration router regression tests"""
    
    def test_get_pax8_status(self, authenticated_client):
        """GET /api/pax8/status - Returns Pax8 integration status"""
        response = authenticated_client.get(f"{BASE_URL}/api/pax8/status")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        # Should have status info
        assert "configured" in data or "status" in data or "connected" in data
        print("✓ Pax8 status endpoint working")


class TestAdditionalEndpoints:
    """Additional critical endpoints regression tests"""
    
    def test_get_technicians_list(self, authenticated_client):
        """GET /api/technicians/overview - Returns list of technicians with stats"""
        response = authenticated_client.get(f"{BASE_URL}/api/technicians/overview")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Technicians overview endpoint working ({len(data)} technicians)")
    
    def test_get_assets_list(self, authenticated_client):
        """GET /api/assets - Returns list of assets"""
        response = authenticated_client.get(f"{BASE_URL}/api/assets")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Assets list endpoint working ({len(data)} assets)")
    
    def test_get_time_entries(self, authenticated_client):
        """GET /api/time-entries - Returns time entries"""
        response = authenticated_client.get(f"{BASE_URL}/api/time-entries")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Time entries endpoint working ({len(data)} entries)")
    
    def test_get_projects(self, authenticated_client):
        """GET /api/projects - Returns projects list"""
        response = authenticated_client.get(f"{BASE_URL}/api/projects")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Projects endpoint working ({len(data)} projects)")
    
    def test_get_leads(self, authenticated_client):
        """GET /api/leads - Returns CRM leads"""
        response = authenticated_client.get(f"{BASE_URL}/api/leads")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Leads endpoint working ({len(data)} leads)")
    
    def test_get_scripts(self, authenticated_client):
        """GET /api/scripts - Returns scripts list"""
        response = authenticated_client.get(f"{BASE_URL}/api/scripts")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Scripts endpoint working ({len(data)} scripts)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
