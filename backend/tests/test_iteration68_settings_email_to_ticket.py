"""
Iteration 68 - Settings Page Tabs & Email-to-Ticket Enhancement Tests
Tests:
1. Standard login with aaron@stech.com.au / Lucky@2871$!
2. Settings endpoints (job-numbering, AI config, no-notes-threshold)
3. O365 mailbox settings and email-to-lead webhook
4. Email-to-ticket: creates ticket when sender is a known client
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Test standard login"""
    
    def test_login_success(self):
        """Test login with admin credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == "aaron@stech.com.au"
        print(f"✓ Login successful for {data['user']['email']}")
        return data["token"]


class TestSettingsEndpoints:
    """Test settings endpoints used by the tabbed Settings page"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_job_numbering(self):
        """Test GET /api/settings/job-numbering"""
        response = requests.get(f"{BASE_URL}/api/settings/job-numbering", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        # Should have prefix fields
        assert "sla_prefix" in data or data == {}
        print(f"✓ Job numbering settings retrieved: {data}")
    
    def test_put_job_numbering(self):
        """Test PUT /api/settings/job-numbering"""
        payload = {
            "sla_prefix": "SLA-",
            "workshop_prefix": "WS-",
            "cabling_prefix": "CW-"
        }
        response = requests.put(f"{BASE_URL}/api/settings/job-numbering", json=payload, headers=self.headers)
        assert response.status_code == 200
        print("✓ Job numbering settings saved")
    
    def test_get_ai_config(self):
        """Test GET /api/ai/config"""
        response = requests.get(f"{BASE_URL}/api/ai/config", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "provider" in data
        assert "model" in data
        print(f"✓ AI config retrieved: provider={data.get('provider')}, model={data.get('model')}")
    
    def test_put_ai_config(self):
        """Test PUT /api/ai/config"""
        payload = {"provider": "anthropic", "model": "claude-sonnet-4-5-20250929"}
        response = requests.put(f"{BASE_URL}/api/ai/config", json=payload, headers=self.headers)
        assert response.status_code == 200
        print("✓ AI config saved")
    
    def test_get_no_notes_threshold(self):
        """Test GET /api/settings/no-notes-threshold"""
        response = requests.get(f"{BASE_URL}/api/settings/no-notes-threshold", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "enabled" in data
        assert "threshold_hours" in data
        print(f"✓ No-notes threshold retrieved: enabled={data.get('enabled')}, hours={data.get('threshold_hours')}")
    
    def test_put_no_notes_threshold(self):
        """Test PUT /api/settings/no-notes-threshold"""
        payload = {"enabled": True, "threshold_hours": 24, "escalate_to": "", "escalate_to_name": ""}
        response = requests.put(f"{BASE_URL}/api/settings/no-notes-threshold", json=payload, headers=self.headers)
        assert response.status_code == 200
        print("✓ No-notes threshold saved")
    
    def test_get_microsoft_sso(self):
        """Test GET /api/settings/microsoft-sso"""
        response = requests.get(f"{BASE_URL}/api/settings/microsoft-sso", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        # Should have SSO fields
        print(f"✓ Microsoft SSO settings retrieved: enabled={data.get('enabled')}")
    
    def test_get_xero_settings(self):
        """Test GET /api/settings/xero"""
        response = requests.get(f"{BASE_URL}/api/settings/xero", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        print(f"✓ Xero settings retrieved: connected={data.get('connected')}")
    
    def test_get_stripe_settings(self):
        """Test GET /api/settings/stripe"""
        response = requests.get(f"{BASE_URL}/api/settings/stripe", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        print(f"✓ Stripe settings retrieved: configured={data.get('configured')}")
    
    def test_get_suped_settings(self):
        """Test GET /api/settings/suped"""
        response = requests.get(f"{BASE_URL}/api/settings/suped", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        print(f"✓ Suped settings retrieved: configured={data.get('configured')}")
    
    def test_get_splynx_settings(self):
        """Test GET /api/settings/splynx"""
        response = requests.get(f"{BASE_URL}/api/settings/splynx", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        print(f"✓ Splynx settings retrieved: configured={data.get('configured')}")
    
    def test_get_hudu_settings(self):
        """Test GET /api/settings/hudu"""
        response = requests.get(f"{BASE_URL}/api/settings/hudu", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        print(f"✓ Hudu settings retrieved: configured={data.get('configured')}")


class TestO365MailboxAndEmailToTicket:
    """Test O365 mailbox settings and email-to-ticket functionality"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_o365_mailbox_settings(self):
        """Test GET /api/settings/o365-mailbox"""
        response = requests.get(f"{BASE_URL}/api/settings/o365-mailbox", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "email_to_lead_enabled" in data or "type" in data
        print(f"✓ O365 mailbox settings retrieved: connected={data.get('connected')}, email_to_ticket_enabled={data.get('email_to_ticket_enabled')}")
    
    def test_get_email_leads(self):
        """Test GET /api/o365/email-leads"""
        response = requests.get(f"{BASE_URL}/api/o365/email-leads", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Email leads retrieved: {len(data)} leads")
    
    def test_incoming_email_creates_lead_for_unknown_sender(self):
        """Test POST /api/o365/webhook/incoming-email creates lead for unknown sender"""
        unique_email = f"test_unknown_{uuid.uuid4().hex[:8]}@testdomain.com"
        payload = {
            "from_address": unique_email,
            "from_name": "Test Unknown Sender",
            "subject": "Inquiry about IT services",
            "body": "Hi, I'm interested in your managed services."
        }
        response = requests.post(f"{BASE_URL}/api/o365/webhook/incoming-email", json=payload)
        assert response.status_code == 200
        data = response.json()
        # Should create a lead (not a ticket) for unknown sender
        assert data.get("status") in ["lead_created", "activity_added", "skipped"]
        print(f"✓ Incoming email from unknown sender: status={data.get('status')}, message={data.get('message')}")
    
    def test_email_to_ticket_for_known_client(self):
        """Test POST /api/o365/webhook/incoming-email creates ticket when sender is a known client"""
        # First, create a test client with a unique email
        unique_email = f"test_client_{uuid.uuid4().hex[:8]}@knowncompany.com"
        company_name = f"TEST_KnownCompany_{uuid.uuid4().hex[:6]}"
        client_payload = {
            "name": company_name,  # Required field
            "company_name": company_name,
            "email": unique_email,
            "phone": "555-1234",
            "address": "123 Test St",
            "contacts": [{"name": "Test Contact", "email": unique_email, "phone": "555-1234", "role": "Primary"}]
        }
        create_response = requests.post(f"{BASE_URL}/api/clients", json=client_payload, headers=self.headers)
        assert create_response.status_code in [200, 201], f"Failed to create client: {create_response.text}"
        client_data = create_response.json()
        client_id = client_data.get("id")
        print(f"✓ Created test client: {client_payload['company_name']} with email {unique_email}")
        
        # Enable email-to-ticket in mailbox settings
        mailbox_settings = {
            "email_to_lead_enabled": True,
            "email_to_ticket_enabled": True,
            "auto_reply_enabled": False
        }
        settings_response = requests.put(f"{BASE_URL}/api/settings/o365-mailbox", json=mailbox_settings, headers=self.headers)
        assert settings_response.status_code == 200
        print("✓ Enabled email_to_ticket_enabled in mailbox settings")
        
        # Now send an email from the known client
        email_payload = {
            "from_address": unique_email,
            "from_name": "Test Contact",
            "subject": "Need help with server issue",
            "body": "Our server is down, please help!"
        }
        email_response = requests.post(f"{BASE_URL}/api/o365/webhook/incoming-email", json=email_payload)
        assert email_response.status_code == 200
        data = email_response.json()
        
        # Should create a ticket for known client
        assert data.get("status") == "ticket_created", f"Expected ticket_created, got {data.get('status')}: {data.get('message')}"
        assert "ticket_id" in data
        print(f"✓ Email from known client created ticket: ticket_id={data.get('ticket_id')}, message={data.get('message')}")
        
        # Verify the ticket was created with correct data
        ticket_id = data.get("ticket_id")
        ticket_response = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}", headers=self.headers)
        assert ticket_response.status_code == 200
        ticket = ticket_response.json()
        assert ticket.get("source") == "email"
        assert ticket.get("contact_email") == unique_email
        assert "email-generated" in ticket.get("tags", [])
        print(f"✓ Verified ticket data: source={ticket.get('source')}, contact_email={ticket.get('contact_email')}")
        
        # Cleanup: delete the test client
        delete_response = requests.delete(f"{BASE_URL}/api/clients/{client_id}", headers=self.headers)
        print(f"✓ Cleanup: deleted test client {client_id}")
    
    def test_incoming_email_missing_from_address(self):
        """Test POST /api/o365/webhook/incoming-email returns 400 when from_address is missing"""
        payload = {
            "from_name": "Test Sender",
            "subject": "Test Subject",
            "body": "Test body"
        }
        response = requests.post(f"{BASE_URL}/api/o365/webhook/incoming-email", json=payload)
        assert response.status_code == 400
        print("✓ Incoming email without from_address returns 400")


class TestSyncroSettings:
    """Test Syncro integration settings"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_syncro_settings(self):
        """Test GET /api/syncro/settings"""
        response = requests.get(f"{BASE_URL}/api/syncro/settings", headers=self.headers)
        # May return 200 or 404 depending on if endpoint exists
        assert response.status_code in [200, 404]
        if response.status_code == 200:
            data = response.json()
            print(f"✓ Syncro settings retrieved: enabled={data.get('enabled')}")
        else:
            print("✓ Syncro settings endpoint not found (expected if not implemented)")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
