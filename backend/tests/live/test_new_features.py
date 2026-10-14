"""
Backend API Tests for NexusOps v2.0 - New Features
Tests: Leads/CRM, Acronis, Office 365 Email, Device Chat, Remote Access
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "admin@nexusops.io"
TEST_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


class TestAuthentication:
    """Authentication tests"""
    
    def test_login_success(self):
        """Test login with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == TEST_EMAIL
        print(f"Login successful for {TEST_EMAIL}")
        return data["token"]
    
    def test_login_invalid_credentials(self):
        """Test login with invalid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "wrong@example.com",
            "password": "wrongpass"
        })
        assert response.status_code == 401


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for tests"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if response.status_code == 200:
        return response.json()["token"]
    pytest.skip("Authentication failed")


@pytest.fixture
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}"}


class TestLeadsCRM:
    """Leads & CRM module tests"""
    
    def test_get_leads(self, headers):
        """Test GET /api/leads"""
        response = requests.get(f"{BASE_URL}/api/leads", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} leads")
    
    def test_create_lead(self, headers):
        """Test POST /api/leads"""
        lead_data = {
            "company_name": "TEST_Lead Company",
            "contact_name": "John Test",
            "email": "test@testlead.com",
            "phone": "+1-555-0100",
            "source": "website",
            "industry": "Technology",
            "estimated_value": 5000.0
        }
        response = requests.post(f"{BASE_URL}/api/leads", json=lead_data, headers=headers)
        assert response.status_code == 200, f"Create lead failed: {response.text}"
        data = response.json()
        assert data["company_name"] == lead_data["company_name"]
        assert data["contact_name"] == lead_data["contact_name"]
        assert "id" in data
        print(f"Created lead: {data['id']}")
        return data["id"]
    
    def test_get_lead_by_id(self, headers):
        """Test GET /api/leads/{id}"""
        # First create a lead
        lead_data = {
            "company_name": "TEST_GetLead Company",
            "contact_name": "Jane Test",
            "source": "referral"
        }
        create_response = requests.post(f"{BASE_URL}/api/leads", json=lead_data, headers=headers)
        lead_id = create_response.json()["id"]
        
        # Then get it
        response = requests.get(f"{BASE_URL}/api/leads/{lead_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == lead_id
        assert data["company_name"] == lead_data["company_name"]
    
    def test_update_lead(self, headers):
        """Test PUT /api/leads/{id}"""
        # Create lead
        lead_data = {"company_name": "TEST_UpdateLead", "contact_name": "Update Test", "source": "cold_call"}
        create_response = requests.post(f"{BASE_URL}/api/leads", json=lead_data, headers=headers)
        lead_id = create_response.json()["id"]
        
        # Update lead
        update_data = {"status": "qualified", "estimated_value": 10000}
        response = requests.put(f"{BASE_URL}/api/leads/{lead_id}", json=update_data, headers=headers)
        assert response.status_code == 200
        
        # Verify update
        get_response = requests.get(f"{BASE_URL}/api/leads/{lead_id}", headers=headers)
        assert get_response.json()["status"] == "qualified"
    
    def test_delete_lead(self, headers):
        """Test DELETE /api/leads/{id}"""
        # Create lead
        lead_data = {"company_name": "TEST_DeleteLead", "contact_name": "Delete Test", "source": "marketing"}
        create_response = requests.post(f"{BASE_URL}/api/leads", json=lead_data, headers=headers)
        lead_id = create_response.json()["id"]
        
        # Delete lead
        response = requests.delete(f"{BASE_URL}/api/leads/{lead_id}", headers=headers)
        assert response.status_code == 200
        
        # Verify deletion
        get_response = requests.get(f"{BASE_URL}/api/leads/{lead_id}", headers=headers)
        assert get_response.status_code == 404
    
    def test_crm_dashboard(self, headers):
        """Test GET /api/crm/dashboard"""
        response = requests.get(f"{BASE_URL}/api/crm/dashboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "leads" in data
        assert "total" in data["leads"]
        assert "pipeline_value" in data["leads"]
        print(f"CRM Dashboard: {data['leads']['total']} leads, ${data['leads']['pipeline_value']} pipeline")


class TestAcronis:
    """Acronis backup subscription tests"""
    
    def test_acronis_status(self, headers):
        """Test GET /api/acronis/status"""
        response = requests.get(f"{BASE_URL}/api/acronis/status", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "configured" in data
        print(f"Acronis configured: {data['configured']}")
    
    def test_get_acronis_subscriptions(self, headers):
        """Test GET /api/acronis/subscriptions"""
        response = requests.get(f"{BASE_URL}/api/acronis/subscriptions", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} Acronis subscriptions")
    
    def test_acronis_dashboard(self, headers):
        """Test GET /api/acronis/dashboard"""
        response = requests.get(f"{BASE_URL}/api/acronis/dashboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total_subscriptions" in data
        assert "backup_status" in data
        print(f"Acronis Dashboard: {data['total_subscriptions']} subscriptions")
    
    def test_create_acronis_subscription(self, headers):
        """Test POST /api/acronis/subscriptions"""
        # First get a client
        clients_response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = clients_response.json()
        
        if not clients:
            # Create a test client
            client_data = {"name": "TEST_AcronisClient", "email": "acronis@test.com"}
            client_response = requests.post(f"{BASE_URL}/api/clients", json=client_data, headers=headers)
            client_id = client_response.json()["id"]
        else:
            client_id = clients[0]["id"]
        
        sub_data = {
            "client_id": client_id,
            "product_name": "Acronis Cyber Protect",
            "edition": "Standard",
            "status": "active",
            "license_type": "per_device",
            "quantity": 1,
            "storage_quota_gb": 100
        }
        response = requests.post(f"{BASE_URL}/api/acronis/subscriptions", json=sub_data, headers=headers)
        assert response.status_code == 200, f"Create subscription failed: {response.text}"
        data = response.json()
        assert data["product_name"] == sub_data["product_name"]
        print(f"Created Acronis subscription: {data['id']}")


class TestOffice365Email:
    """Office 365 email integration tests"""
    
    def test_office365_status(self, headers):
        """Test GET /api/office365/status"""
        response = requests.get(f"{BASE_URL}/api/office365/status", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "configured" in data
        print(f"Office 365 configured: {data['configured']}")
    
    def test_get_emails(self, headers):
        """Test GET /api/emails"""
        response = requests.get(f"{BASE_URL}/api/emails", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} emails")
    
    def test_create_email_draft(self, headers):
        """Test POST /api/emails"""
        email_data = {
            "to_addresses": ["test@example.com"],
            "subject": "TEST_Email Subject",
            "body": "<p>This is a test email body</p>",
            "body_type": "html"
        }
        response = requests.post(f"{BASE_URL}/api/emails", json=email_data, headers=headers)
        assert response.status_code == 200, f"Create email failed: {response.text}"
        data = response.json()
        assert data["subject"] == email_data["subject"]
        assert data["status"] == "draft"
        print(f"Created email draft: {data['id']}")


class TestDeviceChat:
    """Device chat functionality tests"""
    
    def test_get_device_chat(self, headers):
        """Test GET /api/devices/{id}/chat"""
        # First get a device
        devices_response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        devices = devices_response.json()
        
        if devices:
            device_id = devices[0]["id"]
            response = requests.get(f"{BASE_URL}/api/devices/{device_id}/chat", headers=headers)
            assert response.status_code == 200
            data = response.json()
            # API returns dict with 'messages' key
            assert "messages" in data or isinstance(data, list)
            messages = data.get("messages", data) if isinstance(data, dict) else data
            print(f"Found {len(messages)} chat messages for device {device_id}")
        else:
            print("No devices found to test chat")
    
    def test_send_device_chat_message(self, headers):
        """Test POST /api/devices/{id}/chat"""
        # First get or create a device
        devices_response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        devices = devices_response.json()
        
        if not devices:
            # Get a client first
            clients_response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
            clients = clients_response.json()
            if not clients:
                client_data = {"name": "TEST_ChatClient"}
                client_response = requests.post(f"{BASE_URL}/api/clients", json=client_data, headers=headers)
                client_id = client_response.json()["id"]
            else:
                client_id = clients[0]["id"]
            
            # Create device
            device_data = {"name": "TEST_ChatDevice", "client_id": client_id, "device_type": "workstation"}
            device_response = requests.post(f"{BASE_URL}/api/devices", json=device_data, headers=headers)
            device_id = device_response.json()["id"]
        else:
            device_id = devices[0]["id"]
        
        # Send chat message
        chat_data = {
            "device_id": device_id,
            "message": "TEST_Hello from test",
            "message_type": "text"
        }
        response = requests.post(f"{BASE_URL}/api/devices/{device_id}/chat", json=chat_data, headers=headers)
        assert response.status_code == 200, f"Send chat failed: {response.text}"
        data = response.json()
        assert data["message"] == chat_data["message"]
        print(f"Sent chat message to device {device_id}")


class TestRemoteAccess:
    """Remote access (RustDesk) tests"""
    
    def test_remote_status(self, headers):
        """Test GET /api/remote/status"""
        response = requests.get(f"{BASE_URL}/api/remote/status", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "configured" in data
        print(f"Remote access configured: {data['configured']}")
    
    def test_get_remote_agents(self, headers):
        """Test GET /api/remote/agents"""
        response = requests.get(f"{BASE_URL}/api/remote/agents", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} remote agents")
    
    def test_get_remote_sessions(self, headers):
        """Test GET /api/remote/sessions"""
        response = requests.get(f"{BASE_URL}/api/remote/sessions", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} remote sessions")


class TestDashboard:
    """Dashboard stats tests"""
    
    def test_dashboard_stats(self, headers):
        """Test GET /api/dashboard/stats"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total_clients" in data
        assert "total_devices" in data
        assert "open_tickets" in data
        print(f"Dashboard: {data['total_clients']} clients, {data['total_devices']} devices, {data['open_tickets']} open tickets")


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_leads(self, headers):
        """Clean up TEST_ prefixed leads"""
        response = requests.get(f"{BASE_URL}/api/leads", headers=headers)
        leads = response.json()
        deleted = 0
        for lead in leads:
            if lead.get("company_name", "").startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/leads/{lead['id']}", headers=headers)
                deleted += 1
        print(f"Cleaned up {deleted} test leads")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
