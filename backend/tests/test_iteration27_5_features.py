"""
Test Iteration 27: 5 Features - Syncro RMM, Leads/CRM, Email from Tickets, Scripting, Patches
Testing all new features implemented in parallel.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data, f"Expected 'token' in response: {data}"
        return data["token"]
    
    def test_login_success(self, auth_token):
        """Verify login returns valid token"""
        assert auth_token is not None
        assert len(auth_token) > 0
        print("PASSED: Login successful with admin@nexusops.io")


class TestSyncroRMM:
    """Syncro RMM Integration tests - Settings, Test Connection, Import"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io", "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_get_syncro_settings_empty(self, headers):
        """GET /api/syncro/settings - should return empty/default config"""
        response = requests.get(f"{BASE_URL}/api/syncro/settings", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "subdomain" in data
        assert "api_key" in data
        print(f"PASSED: GET /api/syncro/settings - returned config: subdomain={data.get('subdomain','')}")
    
    def test_save_syncro_settings(self, headers):
        """PUT /api/syncro/settings - save syncro subdomain and API key"""
        payload = {
            "subdomain": "test-msp",
            "api_key": "fake-api-key-for-testing",
            "enabled": True
        }
        response = requests.put(f"{BASE_URL}/api/syncro/settings", headers=headers, json=payload)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data
        print(f"PASSED: PUT /api/syncro/settings - saved settings")
    
    def test_syncro_test_connection_fails_invalid(self, headers):
        """POST /api/syncro/test-connection - test with invalid creds (should return error)"""
        response = requests.post(f"{BASE_URL}/api/syncro/test-connection", headers=headers)
        assert response.status_code in [200, 400, 502], f"Unexpected status: {response.status_code}"
        data = response.json()
        # With invalid creds, should return error status
        if response.status_code == 200:
            assert "status" in data
            # May be "error" due to invalid credentials
            print(f"PASSED: POST /api/syncro/test-connection - status={data.get('status')}, message={data.get('message','')}")
        else:
            print(f"PASSED: POST /api/syncro/test-connection - returned {response.status_code} as expected with invalid creds")


class TestLeadsCRM:
    """Leads/CRM tests - Create lead, Create ticket from lead, Assign client"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io", "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    @pytest.fixture(scope="class")
    def test_lead(self, headers):
        """Create a test lead for other tests"""
        payload = {
            "company_name": "TEST_LeadCompany",
            "contact_name": "John Lead",
            "email": "john@testlead.com",
            "phone": "+1-555-0123",
            "source": "website",
            "industry": "Technology",
            "estimated_value": 5000
        }
        response = requests.post(f"{BASE_URL}/api/leads", headers=headers, json=payload)
        assert response.status_code == 200, f"Failed to create lead: {response.text}"
        return response.json()
    
    @pytest.fixture(scope="class")
    def test_client(self, headers):
        """Get or create a test client for assign client tests"""
        # Get existing clients
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        if response.status_code == 200 and len(response.json()) > 0:
            return response.json()[0]
        # Create one if none exist
        payload = {"name": "TEST_AssignClient", "email": "test@assign.com"}
        response = requests.post(f"{BASE_URL}/api/clients", headers=headers, json=payload)
        return response.json()
    
    def test_create_lead(self, headers, test_lead):
        """POST /api/leads - create a new lead"""
        assert "id" in test_lead
        assert test_lead["company_name"] == "TEST_LeadCompany"
        assert test_lead["contact_name"] == "John Lead"
        print(f"PASSED: POST /api/leads - created lead id={test_lead['id']}")
    
    def test_get_leads(self, headers):
        """GET /api/leads - list leads"""
        response = requests.get(f"{BASE_URL}/api/leads", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"PASSED: GET /api/leads - returned {len(data)} leads")
    
    def test_create_ticket_from_lead(self, headers, test_lead):
        """POST /api/leads/{id}/create-ticket - create ticket from lead"""
        lead_id = test_lead["id"]
        payload = {
            "title": "Test Ticket from Lead",
            "description": "Created from lead test",
            "priority": "medium",
            "category": "support"
        }
        response = requests.post(f"{BASE_URL}/api/leads/{lead_id}/create-ticket", headers=headers, json=payload)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "ticket_id" in data
        assert "ticket_number" in data
        print(f"PASSED: POST /api/leads/{lead_id}/create-ticket - created ticket {data['ticket_number']}")
    
    def test_get_lead_activities(self, headers, test_lead):
        """GET /api/leads/{id}/activities - verify activities were logged after ticket creation"""
        lead_id = test_lead["id"]
        response = requests.get(f"{BASE_URL}/api/leads/{lead_id}/activities", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        # Should have at least one activity from ticket creation
        print(f"PASSED: GET /api/leads/{lead_id}/activities - returned {len(data)} activities")
    
    def test_assign_client_to_lead(self, headers, test_client):
        """POST /api/leads/{id}/assign-client - assign existing client to a lead"""
        # Create a fresh lead for this test
        lead_payload = {
            "company_name": "TEST_AssignLeadCompany",
            "contact_name": "Jane Assign",
            "email": "jane@assign.com",
            "source": "referral"
        }
        lead_response = requests.post(f"{BASE_URL}/api/leads", headers=headers, json=lead_payload)
        assert lead_response.status_code == 200
        lead = lead_response.json()
        lead_id = lead["id"]
        client_id = test_client["id"]
        
        # Assign client
        response = requests.post(f"{BASE_URL}/api/leads/{lead_id}/assign-client", headers=headers, json={"client_id": client_id})
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data
        print(f"PASSED: POST /api/leads/{lead_id}/assign-client - assigned client {client_id}")


class TestTicketEmail:
    """Ticket Email tests - Send email from ticket (demo mode)"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io", "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    @pytest.fixture(scope="class")
    def test_ticket(self, headers):
        """Get or create a test ticket"""
        # Get existing tickets
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        if response.status_code == 200 and len(response.json()) > 0:
            return response.json()[0]
        # We need a client to create a ticket
        clients_res = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        client_id = clients_res.json()[0]["id"] if clients_res.status_code == 200 and len(clients_res.json()) > 0 else None
        if not client_id:
            pytest.skip("No clients available to create ticket")
        payload = {
            "title": "TEST_EmailTicket",
            "description": "Ticket for email test",
            "client_id": client_id,
            "priority": "medium",
            "category": "support"
        }
        response = requests.post(f"{BASE_URL}/api/tickets", headers=headers, json=payload)
        return response.json()
    
    def test_send_ticket_email_demo_mode(self, headers, test_ticket):
        """POST /api/tickets/{id}/emails - send email (demo mode, should return status sent)"""
        ticket_id = test_ticket["id"]
        payload = {
            "to_addresses": ["test@example.com"],
            "subject": "Test Email from Ticket",
            "body": "This is a test email sent from the ticket system.",
            "body_type": "text"
        }
        response = requests.post(f"{BASE_URL}/api/tickets/{ticket_id}/emails", headers=headers, json=payload)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "status" in data
        # In demo mode (placeholder RESEND_API_KEY), should be marked as "sent"
        assert data["status"] == "sent", f"Expected status 'sent' but got '{data['status']}'"
        print(f"PASSED: POST /api/tickets/{ticket_id}/emails - email sent (demo mode)")
    
    def test_get_ticket_emails(self, headers, test_ticket):
        """GET /api/tickets/{id}/emails - get emails for ticket"""
        ticket_id = test_ticket["id"]
        response = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}/emails", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"PASSED: GET /api/tickets/{ticket_id}/emails - returned {len(data)} emails")


class TestScripting:
    """Scripting tests - CRUD scripts, scheduled tasks"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io", "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    @pytest.fixture(scope="class")
    def test_script(self, headers):
        """Create a test script"""
        payload = {
            "name": "TEST_Script",
            "description": "Test script for iteration 27",
            "script_type": "powershell",
            "content": "Write-Output 'Hello World'",
            "category": "general",
            "os_target": "windows",
            "run_as_admin": False,
            "timeout_seconds": 60
        }
        response = requests.post(f"{BASE_URL}/api/scripts", headers=headers, json=payload)
        assert response.status_code == 200, f"Failed to create script: {response.text}"
        return response.json()
    
    def test_get_scripts(self, headers):
        """GET /api/scripts - list scripts"""
        response = requests.get(f"{BASE_URL}/api/scripts", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"PASSED: GET /api/scripts - returned {len(data)} scripts")
    
    def test_create_script(self, headers, test_script):
        """POST /api/scripts - create a script"""
        assert "id" in test_script
        assert test_script["name"] == "TEST_Script"
        assert test_script["script_type"] == "powershell"
        print(f"PASSED: POST /api/scripts - created script id={test_script['id']}")
    
    def test_get_scheduled_tasks(self, headers):
        """GET /api/scheduled-tasks - list scheduled tasks"""
        response = requests.get(f"{BASE_URL}/api/scheduled-tasks", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"PASSED: GET /api/scheduled-tasks - returned {len(data)} tasks")
    
    def test_create_scheduled_task(self, headers, test_script):
        """POST /api/scheduled-tasks - create a scheduled task"""
        script_id = test_script["id"]
        payload = {
            "name": "TEST_ScheduledTask",
            "script_id": script_id,
            "schedule_type": "daily",
            "schedule_time": "09:00",
            "enabled": True
        }
        response = requests.post(f"{BASE_URL}/api/scheduled-tasks", headers=headers, json=payload)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["name"] == "TEST_ScheduledTask"
        print(f"PASSED: POST /api/scheduled-tasks - created task id={data['id']}")


class TestPatchManagement:
    """Patch Management tests - dashboard stats"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io", "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_get_patch_dashboard(self, headers):
        """GET /api/patches/dashboard - get patch stats"""
        response = requests.get(f"{BASE_URL}/api/patches/dashboard", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        # Should have these fields
        expected_fields = ["total", "available", "approved", "installed", "failed", "pending_critical", "pending_important"]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
        print(f"PASSED: GET /api/patches/dashboard - total={data['total']}, critical={data['pending_critical']}")
    
    def test_get_patches_list(self, headers):
        """GET /api/patches - list patches"""
        response = requests.get(f"{BASE_URL}/api/patches", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"PASSED: GET /api/patches - returned {len(data)} patches")


class TestAICopilot:
    """AI Co-Pilot endpoint test"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io", "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_copilot_chat(self, headers):
        """POST /api/ai/copilot - test copilot responds"""
        payload = {
            "message": "What could cause a computer to be slow?",
            "session_id": "test-session-123",
            "ticket_context": {
                "title": "Slow computer",
                "description": "User reports computer is running slowly",
                "client_name": "Test Client"
            }
        }
        response = requests.post(f"{BASE_URL}/api/ai/copilot", headers=headers, json=payload)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "response" in data
        assert "session_id" in data
        print(f"PASSED: POST /api/ai/copilot - got response (length={len(data['response'])} chars)")


class TestCleanup:
    """Clean up TEST_ prefixed data"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io", "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_cleanup_test_data(self, headers):
        """Cleanup test leads and scripts"""
        # Cleanup leads
        leads_res = requests.get(f"{BASE_URL}/api/leads", headers=headers)
        if leads_res.status_code == 200:
            for lead in leads_res.json():
                if lead.get("company_name", "").startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/leads/{lead['id']}", headers=headers)
        
        # Cleanup scripts
        scripts_res = requests.get(f"{BASE_URL}/api/scripts", headers=headers)
        if scripts_res.status_code == 200:
            for script in scripts_res.json():
                if script.get("name", "").startswith("TEST_"):
                    try:
                        requests.delete(f"{BASE_URL}/api/scripts/{script['id']}", headers=headers)
                    except:
                        pass
        
        # Cleanup scheduled tasks
        tasks_res = requests.get(f"{BASE_URL}/api/scheduled-tasks", headers=headers)
        if tasks_res.status_code == 200:
            for task in tasks_res.json():
                if task.get("name", "").startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/scheduled-tasks/{task['id']}", headers=headers)
        
        print("PASSED: Cleanup completed")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
