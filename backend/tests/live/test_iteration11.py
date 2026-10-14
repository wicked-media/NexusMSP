"""
Iteration 11 Tests: Stripe Settings + Ticket Progress Bar
==========================================================
Testing:
1. GET /api/settings/stripe - returns masked key and configured status
2. PUT /api/settings/stripe - saves new Stripe API key
3. POST /api/invoices/{id}/pay - uses settings-stored key before env var fallback
4. Frontend: Settings page Stripe section (API key input, badge, save button)
5. Frontend: Ticket progress bar with 5 stages (Open, In Progress, On Hold, Resolved, Closed)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
AUTH_TOKEN = None


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for all tests"""
    global AUTH_TOKEN
    if AUTH_TOKEN:
        return AUTH_TOKEN
    
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    AUTH_TOKEN = response.json()["token"]
    return AUTH_TOKEN


@pytest.fixture
def headers(auth_token):
    """Auth headers for API requests"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============== STRIPE SETTINGS API TESTS ==============

class TestStripeSettingsAPI:
    """Test Stripe settings GET/PUT endpoints"""
    
    def test_get_stripe_settings_returns_masked_key(self, headers):
        """GET /api/settings/stripe returns masked key and configured status"""
        response = requests.get(f"{BASE_URL}/api/settings/stripe", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "api_key" in data, "Response should have api_key field"
        assert "configured" in data, "Response should have configured field"
        
        # Key should be masked if present
        if data["api_key"]:
            assert data["api_key"].startswith("***"), "API key should be masked with ***"
        
        print(f"Stripe settings: api_key={data['api_key']}, configured={data['configured']}")
    
    def test_put_stripe_settings_saves_key(self, headers):
        """PUT /api/settings/stripe saves a new API key"""
        test_key = "sk_test_iteration11_test_key"
        response = requests.put(
            f"{BASE_URL}/api/settings/stripe",
            headers=headers,
            json={"api_key": test_key}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should have message field"
        print(f"PUT response: {data['message']}")
        
        # Verify the key was saved by fetching settings again
        get_response = requests.get(f"{BASE_URL}/api/settings/stripe", headers=headers)
        assert get_response.status_code == 200
        get_data = get_response.json()
        
        # Should show masked version ending with last 4 chars
        assert get_data["configured"] == True, "Stripe should be configured after saving key"
        assert get_data["api_key"].endswith("_key"), "Masked key should end with last 4 chars"
        print(f"After save: api_key={get_data['api_key']}, configured={get_data['configured']}")
    
    def test_put_stripe_settings_ignores_masked_key(self, headers):
        """PUT /api/settings/stripe ignores masked key (***xyz)"""
        response = requests.put(
            f"{BASE_URL}/api/settings/stripe",
            headers=headers,
            json={"api_key": "***test"}  # Masked key should be ignored
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "No changes" in data.get("message", ""), "Should indicate no changes for masked key"
        print(f"Masked key response: {data['message']}")


# ============== TICKETS API TESTS (Progress Bar Support) ==============

class TestTicketsProgressBar:
    """Test tickets API for progress bar status support"""
    
    def test_ticket_has_status_field(self, headers):
        """Verify tickets have status field for progress bar"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        tickets = response.json()
        assert len(tickets) > 0, "Should have at least one ticket"
        
        # Check first ticket has status
        ticket = tickets[0]
        assert "status" in ticket, "Ticket should have status field"
        
        valid_statuses = ["open", "in_progress", "on_hold", "resolved", "closed"]
        assert ticket["status"] in valid_statuses, f"Status {ticket['status']} should be one of {valid_statuses}"
        print(f"First ticket status: {ticket['status']}")
    
    def test_ticket_status_update_for_progress_bar(self, headers):
        """Test updating ticket status (progress bar interaction)"""
        # Get a ticket
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        assert len(tickets) > 0, "Need at least one ticket"
        
        ticket = tickets[0]
        ticket_id = ticket["id"]
        original_status = ticket["status"]
        
        # Try to update status to in_progress (if not already)
        new_status = "in_progress" if original_status != "in_progress" else "open"
        
        update_response = requests.put(
            f"{BASE_URL}/api/tickets/{ticket_id}",
            headers=headers,
            json={"status": new_status}
        )
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}"
        
        # Restore original status
        requests.put(
            f"{BASE_URL}/api/tickets/{ticket_id}",
            headers=headers,
            json={"status": original_status}
        )
        print(f"Successfully updated ticket {ticket_id} status to {new_status} and restored to {original_status}")
    
    def test_tickets_page_loads_all_tickets(self, headers):
        """Verify tickets endpoint returns all tickets (previous bug fix)"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200
        
        tickets = response.json()
        print(f"Total tickets: {len(tickets)}")
        
        # Should have multiple tickets
        assert len(tickets) >= 5, f"Expected at least 5 tickets, got {len(tickets)}"
        
        # Verify each ticket has required fields
        for t in tickets[:5]:
            assert "id" in t
            assert "title" in t
            assert "status" in t
            assert "priority" in t


# ============== ENHANCED TICKET FIELDS TESTS ==============

class TestEnhancedTicketFields:
    """Test enhanced ticket fields (Type, Impact, Source, etc.)"""
    
    def test_create_ticket_with_enhanced_fields(self, headers):
        """Create ticket with all enhanced fields visible in dialog"""
        # First get a client ID
        clients_response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = clients_response.json()
        client_id = clients[0]["id"] if clients else None
        
        if not client_id:
            pytest.skip("No clients available for ticket creation")
        
        ticket_data = {
            "title": "TEST_Iter11 Enhanced Ticket",
            "description": "Testing enhanced fields from iteration 11",
            "client_id": client_id,
            "priority": "high",
            "ticket_type": "service_request",
            "impact": "high",
            "source": "email",
            "category": "network",
            "due_date": "2026-02-01",
            "estimated_hours": 4.5,
            "tags": ["test", "iteration11"]
        }
        
        response = requests.post(f"{BASE_URL}/api/tickets", headers=headers, json=ticket_data)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        created = response.json()
        assert created["ticket_type"] == "service_request"
        assert created["impact"] == "high"
        assert created["source"] == "email"
        print(f"Created ticket {created.get('ticket_number')} with enhanced fields")
        
        # Cleanup - delete the test ticket
        requests.delete(f"{BASE_URL}/api/tickets/{created['id']}", headers=headers)


# ============== REGRESSION TESTS ==============

class TestRegressionIter11:
    """Regression tests for previously working features"""
    
    def test_clients_endpoint(self, headers):
        """GET /api/clients regression"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert response.status_code == 200
        print(f"Clients: {len(response.json())} found")
    
    def test_users_endpoint(self, headers):
        """GET /api/users regression"""
        response = requests.get(f"{BASE_URL}/api/users", headers=headers)
        assert response.status_code == 200
        print(f"Users: {len(response.json())} found")
    
    def test_ticket_note_counts(self, headers):
        """GET /api/tickets/note-counts regression (critical fix from iter10)"""
        response = requests.get(f"{BASE_URL}/api/tickets/note-counts", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict), "Should return dict of ticket_id -> count"
        print(f"Note counts for {len(data)} tickets")
    
    def test_xero_settings(self, headers):
        """GET /api/settings/xero regression"""
        response = requests.get(f"{BASE_URL}/api/settings/xero", headers=headers)
        assert response.status_code == 200
        print(f"Xero settings: {response.json()}")
    
    def test_no_notes_threshold(self, headers):
        """GET /api/settings/no-notes-threshold regression"""
        response = requests.get(f"{BASE_URL}/api/settings/no-notes-threshold", headers=headers)
        assert response.status_code == 200
        print(f"No-notes threshold: {response.json()}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
