"""
Iteration 10 Backend API Tests
Testing:
1. GET /api/tickets/note-counts - returns counts per ticket (new endpoint, fixed the fetch error)
2. POST /api/tickets - create ticket with new fields (ticket_type, impact, source, due_date, estimated_hours, asset_id)
3. POST /api/invoices - create invoice with recurring fields (is_recurring, recurring_interval, recurring_start_date)
4. Regression: tickets list, invoices list, clients
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestIteration10:
    """Tests for iteration 10 features - new ticket/invoice enhancements"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.json()["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        """Auth headers"""
        return {"Authorization": f"Bearer {auth_token}"}
    
    @pytest.fixture(scope="class") 
    def client_id(self, headers):
        """Get a client ID for testing"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert response.status_code == 200
        clients = response.json()
        assert len(clients) > 0, "No clients available for testing"
        return clients[0]["id"]

    # ========== CRITICAL TEST: /api/tickets/note-counts ==========
    def test_tickets_note_counts_returns_200(self, headers):
        """GET /api/tickets/note-counts - This was the missing endpoint causing 'Failed to fetch tickets'"""
        response = requests.get(f"{BASE_URL}/api/tickets/note-counts", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
    def test_tickets_note_counts_returns_dict(self, headers):
        """note-counts should return a dict with ticket_id -> count mapping"""
        response = requests.get(f"{BASE_URL}/api/tickets/note-counts", headers=headers)
        data = response.json()
        assert isinstance(data, dict), f"Expected dict, got {type(data)}"
        # Each value should be an integer count
        for ticket_id, count in data.items():
            assert isinstance(count, int), f"Count for {ticket_id} should be int, got {type(count)}"

    # ========== TICKETS: New enhanced fields ==========
    def test_tickets_list_returns_200(self, headers):
        """GET /api/tickets - basic regression test"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
        
    def test_create_ticket_with_enhanced_fields(self, headers, client_id):
        """POST /api/tickets with new fields: ticket_type, impact, source, due_date, estimated_hours, asset_id"""
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        payload = {
            "title": "TEST_Iteration10_Enhanced_Ticket",
            "description": "Testing all new Syncro/SuperOps-style fields",
            "client_id": client_id,
            "priority": "high",
            "category": "support",
            # New enhanced fields
            "ticket_type": "service_request",
            "impact": "high",
            "source": "phone",
            "due_date": tomorrow,
            "estimated_hours": 2.5,
            "asset_id": "test-asset-123",
            "tags": ["test", "iteration10"]
        }
        response = requests.post(f"{BASE_URL}/api/tickets", headers=headers, json=payload)
        assert response.status_code == 200, f"Create ticket failed: {response.text}"
        
        data = response.json()
        # Verify the new fields were saved
        assert data["ticket_type"] == "service_request", f"ticket_type mismatch: {data.get('ticket_type')}"
        assert data["impact"] == "high", f"impact mismatch: {data.get('impact')}"
        assert data["source"] == "phone", f"source mismatch: {data.get('source')}"
        assert data["due_date"] == tomorrow, f"due_date mismatch: {data.get('due_date')}"
        assert data["estimated_hours"] == 2.5, f"estimated_hours mismatch: {data.get('estimated_hours')}"
        assert data["asset_id"] == "test-asset-123", f"asset_id mismatch: {data.get('asset_id')}"
        assert "test" in data["tags"]
        
        # Cleanup
        ticket_id = data["id"]
        requests.delete(f"{BASE_URL}/api/tickets/{ticket_id}", headers=headers)
        
    def test_create_ticket_minimal_fields(self, headers, client_id):
        """POST /api/tickets with minimal required fields - should use defaults"""
        payload = {
            "title": "TEST_Minimal_Ticket",
            "description": "Just required fields",
            "client_id": client_id,
        }
        response = requests.post(f"{BASE_URL}/api/tickets", headers=headers, json=payload)
        assert response.status_code == 200
        
        data = response.json()
        # Verify defaults
        assert data["ticket_type"] == "incident"  # default
        assert data["impact"] == "medium"  # default  
        assert data["source"] == "portal"  # default
        assert data["priority"] == "medium"  # default
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tickets/{data['id']}", headers=headers)

    # ========== INVOICES: Recurring fields ==========
    def test_invoices_list_returns_200(self, headers):
        """GET /api/invoices - basic regression test"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
        
    def test_invoices_stats_summary(self, headers):
        """GET /api/invoices/stats/summary - returns paid/unpaid counts"""
        response = requests.get(f"{BASE_URL}/api/invoices/stats/summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "paid" in data
        assert "unpaid" in data
        
    def test_create_invoice_with_recurring_fields(self, headers, client_id):
        """POST /api/invoices with recurring fields: is_recurring, recurring_interval, start/end dates"""
        due_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
        start_date = datetime.now().strftime("%Y-%m-%d")
        end_date = (datetime.now() + timedelta(days=365)).strftime("%Y-%m-%d")
        
        payload = {
            "client_id": client_id,
            "due_date": due_date,
            "notes": "TEST_Recurring Invoice",
            "line_items": [
                {"name": "Monthly Service", "quantity": 1, "unit_price": 100.00}
            ],
            "tax_rate": 10.0,
            # Recurring fields
            "is_recurring": True,
            "recurring_interval": "monthly",
            "recurring_start_date": start_date,
            "recurring_end_date": end_date
        }
        response = requests.post(f"{BASE_URL}/api/invoices", headers=headers, json=payload)
        assert response.status_code == 200, f"Create invoice failed: {response.text}"
        
        data = response.json()
        # Verify recurring fields were saved
        assert data["is_recurring"] == True, f"is_recurring should be True: {data.get('is_recurring')}"
        assert data["recurring_interval"] == "monthly", f"recurring_interval mismatch: {data.get('recurring_interval')}"
        assert data["recurring_start_date"] == start_date, f"start_date mismatch: {data.get('recurring_start_date')}"
        assert data["recurring_end_date"] == end_date, f"end_date mismatch: {data.get('recurring_end_date')}"
        
        # Verify it has an invoice_number
        assert "invoice_number" in data and data["invoice_number"].startswith("INV-")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/invoices/{data['id']}", headers=headers)
        
    def test_create_invoice_non_recurring(self, headers, client_id):
        """POST /api/invoices without recurring - is_recurring should default to False"""
        due_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
        
        payload = {
            "client_id": client_id,
            "due_date": due_date,
            "line_items": [{"name": "One-time Service", "quantity": 1, "unit_price": 50.00}],
            "tax_rate": 0,
        }
        response = requests.post(f"{BASE_URL}/api/invoices", headers=headers, json=payload)
        assert response.status_code == 200
        
        data = response.json()
        assert data["is_recurring"] == False, f"Non-recurring invoice should have is_recurring=False"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/invoices/{data['id']}", headers=headers)

    # ========== REGRESSION: Other critical endpoints ==========
    def test_clients_list(self, headers):
        """GET /api/clients - regression"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
        assert len(response.json()) > 0  # Should have seeded clients
        
    def test_users_list(self, headers):
        """GET /api/users - regression (needed for ticket assignment)"""
        response = requests.get(f"{BASE_URL}/api/users", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
        
    def test_canned_responses_list(self, headers):
        """GET /api/canned-responses - needed by TicketsPage"""
        response = requests.get(f"{BASE_URL}/api/canned-responses", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
        
    def test_dashboard_stats(self, headers):
        """GET /api/dashboard/enhanced-stats - needed for dashboard"""
        response = requests.get(f"{BASE_URL}/api/dashboard/enhanced-stats", headers=headers)
        assert response.status_code == 200
        
    def test_settings_no_notes_threshold(self, headers):
        """GET /api/settings/no-notes-threshold - settings page"""
        response = requests.get(f"{BASE_URL}/api/settings/no-notes-threshold", headers=headers)
        assert response.status_code == 200


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
