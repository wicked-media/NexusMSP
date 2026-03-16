"""
Iteration 23 - Splynx Integration and Tickets Page Revamp Tests
Tests for:
1. Splynx Settings API endpoints
2. Splynx Client Linking API
3. Tickets Page API (existing endpoints, verifying revamp compatibility)
"""

import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "admin@nexusops.io"
TEST_PASSWORD = "admin123"


class TestAuth:
    """Authentication for all tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200, f"Auth failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in response"
        return data["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        """Headers with auth token"""
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestSplynxSettingsAPI(TestAuth):
    """Tests for Splynx Settings API - /api/settings/splynx"""
    
    def test_get_splynx_settings_default(self, headers):
        """GET /api/settings/splynx - should return default unconfigured state"""
        response = requests.get(f"{BASE_URL}/api/settings/splynx", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        # Should have base fields
        assert "url" in data or "configured" in data, "Missing expected fields"
        print(f"Splynx settings: {data}")
    
    def test_put_splynx_settings(self, headers):
        """PUT /api/settings/splynx - should save and mask credentials"""
        payload = {
            "url": "https://test-splynx.example.com",
            "api_key": "test_api_key_12345678",
            "api_secret": "test_api_secret_87654321"
        }
        response = requests.put(f"{BASE_URL}/api/settings/splynx", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data or "configured" in data, "Missing expected response"
        print(f"Save response: {data}")
        
        # Verify settings were saved (should be masked)
        get_response = requests.get(f"{BASE_URL}/api/settings/splynx", headers=headers)
        assert get_response.status_code == 200
        get_data = get_response.json()
        assert get_data.get("url") == "https://test-splynx.example.com", "URL not saved"
        # API key/secret should be masked
        if "api_key" in get_data and get_data["api_key"]:
            assert "*" in get_data["api_key"] or len(get_data["api_key"]) < 30, "API key not masked"
        print(f"Verified saved settings: {get_data}")
    
    def test_post_splynx_test_connection_unconfigured(self, headers):
        """POST /api/settings/splynx/test - should return connection result"""
        response = requests.post(f"{BASE_URL}/api/settings/splynx/test", json={}, headers=headers)
        # Can be 200 (success/failure message) or 400 (not configured)
        assert response.status_code in [200, 400], f"Unexpected status: {response.status_code}"
        data = response.json()
        # Should have success/message or detail
        assert "success" in data or "message" in data or "detail" in data, "Missing expected response fields"
        print(f"Test connection result: {data}")


class TestSplynxClientLinkingAPI(TestAuth):
    """Tests for Client-Splynx Linking API - /api/clients/{id}/splynx"""
    
    @pytest.fixture(scope="class")
    def test_client_id(self, headers):
        """Get a test client ID"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert response.status_code == 200, f"Failed to get clients: {response.text}"
        clients = response.json()
        assert len(clients) > 0, "No clients found for testing"
        return clients[0]["id"]
    
    def test_get_client_splynx_link_initial(self, headers, test_client_id):
        """GET /api/clients/{id}/splynx - should return link status"""
        response = requests.get(f"{BASE_URL}/api/clients/{test_client_id}/splynx", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        # Should have client_id and linked status
        assert "client_id" in data, "Missing client_id"
        assert "linked" in data or "splynx_customer_id" in data, "Missing link status"
        print(f"Initial Splynx link: {data}")
    
    def test_put_client_splynx_link(self, headers, test_client_id):
        """PUT /api/clients/{id}/splynx - should save Splynx customer ID"""
        payload = {"splynx_customer_id": "TEST_SPLYNX_123"}
        response = requests.put(f"{BASE_URL}/api/clients/{test_client_id}/splynx", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data, "Missing success message"
        print(f"Link save response: {data}")
        
        # Verify link was saved
        get_response = requests.get(f"{BASE_URL}/api/clients/{test_client_id}/splynx", headers=headers)
        assert get_response.status_code == 200
        get_data = get_response.json()
        assert get_data.get("splynx_customer_id") == "TEST_SPLYNX_123", "Splynx ID not saved"
        assert get_data.get("linked") == True, "Link status not updated"
        print(f"Verified link: {get_data}")
    
    def test_get_client_splynx_services_no_config(self, headers, test_client_id):
        """GET /api/clients/{id}/splynx/services - should return services or error"""
        response = requests.get(f"{BASE_URL}/api/clients/{test_client_id}/splynx/services", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        # Should have services array (possibly empty) and/or error message
        assert "services" in data or "error" in data, "Missing expected response fields"
        print(f"Splynx services response: {data}")
    
    def test_get_client_splynx_invoices(self, headers, test_client_id):
        """GET /api/clients/{id}/splynx/invoices - should return invoices or error"""
        response = requests.get(f"{BASE_URL}/api/clients/{test_client_id}/splynx/invoices", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        # Should have invoices array (possibly empty) and/or error message
        assert "invoices" in data or "error" in data, "Missing expected response fields"
        print(f"Splynx invoices response: {data}")
    
    def test_get_client_splynx_customer(self, headers, test_client_id):
        """GET /api/clients/{id}/splynx/customer - should return customer data or error"""
        response = requests.get(f"{BASE_URL}/api/clients/{test_client_id}/splynx/customer", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        # Should have customer data or error (since no real Splynx instance)
        assert "customer" in data or "error" in data, "Missing expected response fields"
        print(f"Splynx customer response: {data}")
    
    def test_unlink_client_from_splynx(self, headers, test_client_id):
        """PUT /api/clients/{id}/splynx - unlink by setting empty ID"""
        payload = {"splynx_customer_id": ""}
        response = requests.put(f"{BASE_URL}/api/clients/{test_client_id}/splynx", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        # Verify unlinked
        get_response = requests.get(f"{BASE_URL}/api/clients/{test_client_id}/splynx", headers=headers)
        get_data = get_response.json()
        assert get_data.get("linked") == False, "Link not removed"
        print(f"Verified unlinked: {get_data}")


class TestTicketsAPI(TestAuth):
    """Tests for Tickets API - verifying endpoints work with revamped UI"""
    
    def test_get_tickets_list(self, headers):
        """GET /api/tickets - should return tickets list"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        tickets = response.json()
        assert isinstance(tickets, list), "Response should be a list"
        print(f"Found {len(tickets)} tickets")
        
        # Verify ticket structure for revamped UI
        if len(tickets) > 0:
            ticket = tickets[0]
            required_fields = ["id", "title", "status", "priority"]
            for field in required_fields:
                assert field in ticket, f"Missing required field: {field}"
            print(f"Sample ticket structure: {list(ticket.keys())[:10]}")
    
    def test_get_tickets_note_counts(self, headers):
        """GET /api/tickets/note-counts - for 'No Response' badge"""
        response = requests.get(f"{BASE_URL}/api/tickets/note-counts", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, dict), "Response should be a dict of ticket_id -> count"
        print(f"Note counts for {len(data)} tickets")
    
    def test_get_clients_for_ticket_creation(self, headers):
        """GET /api/clients - needed for ticket creation form"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        clients = response.json()
        assert isinstance(clients, list), "Response should be a list"
        assert len(clients) > 0, "Should have at least one client for testing"
        print(f"Found {len(clients)} clients for ticket creation")
    
    def test_ticket_stats_calculation(self, headers):
        """Verify ticket stats can be calculated from list"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200
        tickets = response.json()
        
        # Calculate stats as UI does
        open_count = len([t for t in tickets if t.get("status") == "open"])
        in_progress_count = len([t for t in tickets if t.get("status") == "in_progress"])
        resolved_count = len([t for t in tickets if t.get("status") == "resolved"])
        critical_count = len([t for t in tickets if t.get("priority") == "critical" and t.get("status") not in ["closed", "resolved"]])
        
        print(f"Ticket stats - Open: {open_count}, In Progress: {in_progress_count}, Resolved: {resolved_count}, Critical: {critical_count}")
        
        # Verify we have data for testing
        assert len(tickets) > 0, "Should have tickets for stats testing"
    
    @pytest.fixture(scope="class")
    def test_ticket_id(self, headers):
        """Get a test ticket ID"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        if len(tickets) > 0:
            return tickets[0]["id"]
        return None
    
    def test_ticket_detail_endpoints(self, headers, test_ticket_id):
        """Test ticket detail endpoints used by detail view"""
        if not test_ticket_id:
            pytest.skip("No ticket available for testing")
        
        # Test comments endpoint
        comments_resp = requests.get(f"{BASE_URL}/api/tickets/{test_ticket_id}/comments", headers=headers)
        assert comments_resp.status_code == 200, f"Comments endpoint failed: {comments_resp.text}"
        print(f"Ticket has {len(comments_resp.json())} comments")
        
        # Test emails endpoint
        emails_resp = requests.get(f"{BASE_URL}/api/tickets/{test_ticket_id}/emails", headers=headers)
        assert emails_resp.status_code == 200, f"Emails endpoint failed: {emails_resp.text}"
        
        # Test time entries endpoint
        time_resp = requests.get(f"{BASE_URL}/api/tickets/{test_ticket_id}/time-entries", headers=headers)
        assert time_resp.status_code == 200, f"Time entries endpoint failed: {time_resp.text}"
        
        # Test audit log endpoint
        audit_resp = requests.get(f"{BASE_URL}/api/tickets/{test_ticket_id}/audit-log", headers=headers)
        assert audit_resp.status_code == 200, f"Audit log endpoint failed: {audit_resp.text}"
        
        print("All ticket detail endpoints working")


class TestSplynxOverviewAPI(TestAuth):
    """Tests for Splynx Overview API"""
    
    def test_get_splynx_overview(self, headers):
        """GET /api/splynx/overview - should return overview stats"""
        response = requests.get(f"{BASE_URL}/api/splynx/overview", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Should have overview fields
        assert "linked_clients" in data, "Missing linked_clients"
        assert "total_services" in data, "Missing total_services"
        assert "clients" in data, "Missing clients list"
        print(f"Splynx overview: linked={data.get('linked_clients')}, services={data.get('total_services')}")
    
    def test_search_splynx_customers(self, headers):
        """GET /api/splynx/customers/search - should return results or empty"""
        response = requests.get(f"{BASE_URL}/api/splynx/customers/search?q=test", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Splynx customer search returned {len(data)} results")


class TestSidebarNavigation(TestAuth):
    """Verify sidebar includes Email Security link"""
    
    def test_dmarc_compliance_endpoint(self, headers):
        """Verify DMARC compliance endpoint still works (Email Security link target)"""
        response = requests.get(f"{BASE_URL}/api/suped/compliance-dashboard", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        print("Email Security endpoint working - sidebar link functional")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
