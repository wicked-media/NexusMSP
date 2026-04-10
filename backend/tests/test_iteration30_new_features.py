"""
Test Suite for NexusOps Iteration 30 - New Features Testing
Features to test:
1. O365 One-Click Mailbox Setup
2. Email-to-Lead Creation 
3. Asset Lifecycle Management
4. Predictive Maintenance AI
5. Real-time Event Bus
6. Client Health & Opportunity Radar
7. Ticket Number Badges & Active Viewers
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Authentication failed")

@pytest.fixture
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============== O365 MAILBOX TESTS ==============
class TestO365Mailbox:
    """Office 365 Mailbox Setup Tests"""
    
    def test_get_o365_settings(self, headers):
        """GET /api/settings/o365-mailbox returns settings"""
        resp = requests.get(f"{BASE_URL}/api/settings/o365-mailbox", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "type" in data or "connected" in data or data == {} or "email_to_lead_enabled" in data
        print(f"O365 settings: connected={data.get('connected', False)}")
    
    def test_connect_o365_mailbox(self, headers):
        """POST /api/o365/connect with credentials"""
        resp = requests.post(f"{BASE_URL}/api/o365/connect", headers=headers, json={
            "tenant_id": "test-tenant-123",
            "client_id": "test-client-456",
            "client_secret": "test-secret-789",
            "mailbox_email": "support@test.com",
            "email_to_lead_enabled": True
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "message" in data
        print(f"O365 connect response: {data.get('message')}")
    
    def test_o365_test_connection(self, headers):
        """POST /api/o365/test-connection"""
        resp = requests.post(f"{BASE_URL}/api/o365/test-connection", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "success" in data
        print(f"O365 test connection: success={data.get('success')}")
    
    def test_get_email_leads(self, headers):
        """GET /api/o365/email-leads returns email-generated leads"""
        resp = requests.get(f"{BASE_URL}/api/o365/email-leads", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        print(f"Email leads count: {len(data)}")


# ============== EMAIL-TO-LEAD WEBHOOK ==============
class TestEmailToLead:
    """Email-to-Lead Webhook Tests"""
    
    def test_incoming_email_creates_lead(self, headers):
        """POST /api/o365/webhook/incoming-email creates a lead"""
        test_email = f"testuser_{uuid.uuid4().hex[:8]}@testdomain.com"
        resp = requests.post(f"{BASE_URL}/api/o365/webhook/incoming-email", headers=headers, json={
            "from_address": test_email,
            "from_name": "Test Sender",
            "subject": "Inquiry about IT services",
            "body": "We are looking for managed services provider. Please contact us."
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") in ["lead_created", "activity_added"]
        print(f"Email webhook result: {data.get('status')}, message={data.get('message')}")
    
    def test_duplicate_email_adds_activity(self, headers):
        """Second email from same address should add activity to existing lead"""
        test_email = f"duplicate_test_{uuid.uuid4().hex[:6]}@testdomain.com"
        # First email creates lead
        resp1 = requests.post(f"{BASE_URL}/api/o365/webhook/incoming-email", headers=headers, json={
            "from_address": test_email,
            "from_name": "Duplicate Sender",
            "subject": "First inquiry",
            "body": "First email"
        })
        assert resp1.status_code == 200
        
        # Second email from same address
        resp2 = requests.post(f"{BASE_URL}/api/o365/webhook/incoming-email", headers=headers, json={
            "from_address": test_email,
            "from_name": "Duplicate Sender",
            "subject": "Follow up",
            "body": "Second email"
        })
        assert resp2.status_code == 200
        assert resp2.json().get("status") == "activity_added"
        print("Duplicate email handling: PASSED")


# ============== ASSET LIFECYCLE TESTS ==============
class TestAssetLifecycle:
    """Asset Lifecycle Management Tests"""
    
    def test_get_lifecycle_dashboard(self, headers):
        """GET /api/asset-lifecycle/dashboard returns stats"""
        resp = requests.get(f"{BASE_URL}/api/asset-lifecycle/dashboard", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "total" in data
        assert "by_stage" in data
        assert "total_investment" in data
        print(f"Asset lifecycle dashboard: total={data.get('total')}, by_stage={data.get('by_stage')}")
    
    def test_get_all_lifecycle_assets(self, headers):
        """GET /api/asset-lifecycle returns asset list"""
        resp = requests.get(f"{BASE_URL}/api/asset-lifecycle", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        print(f"Lifecycle assets count: {len(data)}")
    
    def test_create_lifecycle_asset(self, headers):
        """POST /api/asset-lifecycle creates new asset"""
        resp = requests.post(f"{BASE_URL}/api/asset-lifecycle", headers=headers, json={
            "name": f"TEST_Dell_OptiPlex_{uuid.uuid4().hex[:6]}",
            "asset_type": "hardware",
            "category": "computer",
            "manufacturer": "Dell",
            "model": "OptiPlex 7090",
            "serial_number": f"SN-{uuid.uuid4().hex[:8].upper()}",
            "purchase_cost": 1200,
            "lifecycle_stage": "procurement"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert data.get("lifecycle_stage") == "procurement"
        assert data.get("asset_tag") is not None
        print(f"Created asset: {data.get('asset_tag')}, stage={data.get('lifecycle_stage')}")
        return data
    
    def test_transition_lifecycle_stage(self, headers):
        """POST /api/asset-lifecycle/{id}/transition changes stage"""
        # Create asset first
        create_resp = requests.post(f"{BASE_URL}/api/asset-lifecycle", headers=headers, json={
            "name": f"TEST_Transition_Asset_{uuid.uuid4().hex[:6]}",
            "asset_type": "hardware",
            "lifecycle_stage": "procurement"
        })
        assert create_resp.status_code == 200
        asset_id = create_resp.json()["id"]
        
        # Transition to deployment
        trans_resp = requests.post(f"{BASE_URL}/api/asset-lifecycle/{asset_id}/transition", headers=headers, json={
            "new_stage": "deployment",
            "notes": "Moving to deployment phase"
        })
        assert trans_resp.status_code == 200
        assert trans_resp.json().get("new_stage") == "deployment"
        print(f"Transitioned asset to deployment: PASSED")
        
        # Verify via GET
        get_resp = requests.get(f"{BASE_URL}/api/asset-lifecycle/{asset_id}", headers=headers)
        assert get_resp.status_code == 200
        assert get_resp.json().get("lifecycle_stage") == "deployment"


# ============== PREDICTIVE MAINTENANCE TESTS ==============
class TestPredictiveMaintenance:
    """Predictive Maintenance AI Tests"""
    
    def test_get_predictive_dashboard(self, headers):
        """GET /api/predictive-maintenance/dashboard returns risk analysis"""
        resp = requests.get(f"{BASE_URL}/api/predictive-maintenance/dashboard", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "total_devices" in data
        assert "risk_summary" in data
        assert "devices" in data
        print(f"Predictive dashboard: total={data.get('total_devices')}, risk_summary={data.get('risk_summary')}")
    
    def test_get_device_prediction(self, headers):
        """GET /api/predictive-maintenance/device/{id} returns device prediction"""
        # First get a device ID
        devices_resp = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        devices = devices_resp.json()
        if len(devices) == 0:
            pytest.skip("No devices to test prediction")
        
        device_id = devices[0]["id"]
        resp = requests.get(f"{BASE_URL}/api/predictive-maintenance/device/{device_id}", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "device" in data
        assert "prediction" in data
        pred = data["prediction"]
        assert "risk_score" in pred
        assert "risk_level" in pred
        assert "risk_factors" in pred
        assert "recommendations" in pred
        print(f"Device prediction: risk_score={pred.get('risk_score')}, risk_level={pred.get('risk_level')}")


# ============== EVENT BUS & TICKET VIEWERS ==============
class TestEventBusAndViewers:
    """Real-time Event Bus and Ticket Viewer Tracking Tests"""
    
    def test_publish_event(self, headers):
        """POST /api/events/publish publishes an event"""
        resp = requests.post(f"{BASE_URL}/api/events/publish", headers=headers, json={
            "type": "test_event",
            "source": "testing",
            "payload": {"message": "Test event from pytest"}
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "event_id" in data
        print(f"Published event: {data.get('event_id')}")
    
    def test_get_recent_events(self, headers):
        """GET /api/events/recent returns recent events"""
        resp = requests.get(f"{BASE_URL}/api/events/recent", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        print(f"Recent events count: {len(data)}")
    
    def test_mark_viewing_ticket(self, headers):
        """POST /api/tickets/{id}/viewing marks user as viewing"""
        # Get a ticket ID
        tickets_resp = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = tickets_resp.json()
        if len(tickets) == 0:
            pytest.skip("No tickets to test viewing")
        
        ticket_id = tickets[0]["id"]
        resp = requests.post(f"{BASE_URL}/api/tickets/{ticket_id}/viewing", headers=headers)
        assert resp.status_code == 200
        print(f"Marked viewing ticket: {ticket_id}")
    
    def test_get_active_viewers(self, headers):
        """GET /api/tickets/active-viewers returns viewers"""
        resp = requests.get(f"{BASE_URL}/api/tickets/active-viewers", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, dict)
        print(f"Active viewers for tickets: {len(data)} tickets being viewed")
    
    def test_stop_viewing_ticket(self, headers):
        """POST /api/tickets/{id}/stop-viewing clears viewing"""
        tickets_resp = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = tickets_resp.json()
        if len(tickets) == 0:
            pytest.skip("No tickets")
        
        ticket_id = tickets[0]["id"]
        resp = requests.post(f"{BASE_URL}/api/tickets/{ticket_id}/stop-viewing", headers=headers)
        assert resp.status_code == 200
        print(f"Stopped viewing ticket: {ticket_id}")


# ============== HEALTH RADAR TESTS ==============
class TestHealthRadar:
    """Client Health & Opportunity Radar Tests"""
    
    def test_get_health_radar_dashboard(self, headers):
        """GET /api/health-radar/dashboard returns health analysis"""
        resp = requests.get(f"{BASE_URL}/api/health-radar/dashboard", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "summary" in data
        assert "at_risk_clients" in data
        assert "upsell_opportunities" in data
        assert "healthy_clients" in data
        
        summary = data.get("summary", {})
        assert "total_clients" in summary
        assert "at_risk_count" in summary
        assert "healthy_count" in summary
        assert "total_potential_mrr" in summary
        
        print(f"Health Radar: total_clients={summary.get('total_clients')}, at_risk={summary.get('at_risk_count')}, healthy={summary.get('healthy_count')}")
        print(f"Potential MRR: ${summary.get('total_potential_mrr', 0):,}")


# ============== TICKETS WITH NUMBERS ==============
class TestTicketNumbers:
    """Ticket Number Badge Tests"""
    
    def test_tickets_have_numbers(self, headers):
        """GET /api/tickets returns tickets with ticket_number field"""
        resp = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert resp.status_code == 200
        tickets = resp.json()
        
        tickets_with_numbers = [t for t in tickets if t.get("ticket_number")]
        tickets_without = [t for t in tickets if not t.get("ticket_number")]
        
        print(f"Tickets with numbers: {len(tickets_with_numbers)}/{len(tickets)}")
        
        # Check format
        for t in tickets_with_numbers[:5]:
            tn = t.get("ticket_number", "")
            # Should be INC-xxxx, SR-xxxx, CHG-xxxx, etc.
            assert any(tn.startswith(prefix) for prefix in ["INC-", "SR-", "CHG-", "PRB-", "TKT-"]), f"Invalid ticket number format: {tn}"
            print(f"  Ticket: {tn} - {t.get('title', '')[:30]}")


# ============== LEADS PAGE FIX ==============
class TestLeadsFix:
    """Leads Page Bug Fix Tests - Convert to Client & Create Ticket"""
    
    def test_convert_lead_to_client(self, headers):
        """POST /api/leads/{id}/convert converts lead to client"""
        # Create a test lead
        lead_resp = requests.post(f"{BASE_URL}/api/leads", headers=headers, json={
            "company_name": f"TEST_LeadConvert_{uuid.uuid4().hex[:6]}",
            "contact_name": "Test Contact",
            "email": f"testlead_{uuid.uuid4().hex[:6]}@test.com",
            "source": "website"
        })
        assert lead_resp.status_code == 200 or lead_resp.status_code == 201
        lead_id = lead_resp.json().get("id")
        
        # Convert to client
        convert_resp = requests.post(f"{BASE_URL}/api/leads/{lead_id}/convert", headers=headers)
        assert convert_resp.status_code == 200
        print(f"Lead converted to client: PASSED")
    
    def test_create_ticket_from_lead(self, headers):
        """POST /api/leads/{id}/create-ticket creates ticket from lead"""
        # Create a test lead
        lead_resp = requests.post(f"{BASE_URL}/api/leads", headers=headers, json={
            "company_name": f"TEST_LeadTicket_{uuid.uuid4().hex[:6]}",
            "contact_name": "Test Contact",
            "email": f"testlead_{uuid.uuid4().hex[:6]}@test.com",
            "source": "website"
        })
        lead_id = lead_resp.json().get("id")
        
        # Convert first (required to create ticket)
        requests.post(f"{BASE_URL}/api/leads/{lead_id}/convert", headers=headers)
        
        # Create ticket from lead
        ticket_resp = requests.post(f"{BASE_URL}/api/leads/{lead_id}/create-ticket", headers=headers, json={
            "title": "Inquiry from test lead",
            "description": "Test ticket from lead",
            "priority": "medium",
            "category": "support"
        })
        assert ticket_resp.status_code == 200
        data = ticket_resp.json()
        assert "ticket_number" in data or "id" in data
        print(f"Ticket created from lead: {data.get('ticket_number', data.get('id'))}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
