"""
Iteration 73 - Finance Center (Xero) + Tickets Bulk Actions Testing
Tests:
- Xero Dashboard API with aging, collection_rate
- Xero Estimates CRUD
- Xero Recurring CRUD
- Xero Sync History
- Tickets Bulk Actions (close, assign, priority, status, tag)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestXeroDashboard:
    """Test Xero Dashboard API with enhanced stats"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login to get token
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed")
    
    def test_xero_dashboard_returns_stats(self):
        """Test /api/xero/dashboard returns correct stats including aging and collection_rate"""
        response = self.session.get(f"{BASE_URL}/api/xero/dashboard")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Verify required fields
        assert "total_revenue" in data, "Missing total_revenue"
        assert "total_paid" in data, "Missing total_paid"
        assert "total_outstanding" in data, "Missing total_outstanding"
        assert "total_overdue" in data, "Missing total_overdue"
        assert "collection_rate" in data, "Missing collection_rate"
        assert "aging" in data, "Missing aging"
        assert "by_status" in data, "Missing by_status"
        assert "monthly_revenue" in data, "Missing monthly_revenue"
        
        # Verify aging structure
        aging = data["aging"]
        assert "current" in aging, "Missing aging.current"
        assert "30_days" in aging, "Missing aging.30_days"
        assert "60_days" in aging, "Missing aging.60_days"
        assert "90_plus" in aging, "Missing aging.90_plus"
        
        # Verify collection_rate is a number
        assert isinstance(data["collection_rate"], (int, float)), "collection_rate should be numeric"
        print(f"Dashboard stats: revenue=${data['total_revenue']}, collection_rate={data['collection_rate']}%")


class TestXeroInvoices:
    """Test Xero Invoices CRUD"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed")
    
    def test_get_invoices(self):
        """Test GET /api/xero/invoices returns list"""
        response = self.session.get(f"{BASE_URL}/api/xero/invoices")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of invoices"
        print(f"Found {len(data)} invoices")
    
    def test_create_invoice(self):
        """Test POST /api/xero/invoices creates new invoice"""
        payload = {
            "client_name": "TEST_BulkClient",
            "reference": "TEST-REF-001",
            "due_date": "2026-02-28",
            "line_items": [
                {"description": "Test Service", "quantity": 2, "unit_price": 100}
            ]
        }
        response = self.session.post(f"{BASE_URL}/api/xero/invoices", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Missing invoice id"
        assert "invoice_number" in data, "Missing invoice_number"
        assert data["client_name"] == "TEST_BulkClient"
        assert data["total"] > 0, "Total should be calculated"
        print(f"Created invoice: {data['invoice_number']} for ${data['total']}")
        return data["id"]


class TestXeroEstimates:
    """Test Xero Estimates CRUD"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed")
    
    def test_get_estimates(self):
        """Test GET /api/xero/estimates returns list"""
        response = self.session.get(f"{BASE_URL}/api/xero/estimates")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of estimates"
        print(f"Found {len(data)} estimates")
    
    def test_create_estimate(self):
        """Test POST /api/xero/estimates creates new estimate"""
        payload = {
            "title": "TEST_Network Upgrade Project",
            "client_name": "TEST_EstimateClient",
            "valid_until": "2026-03-15",
            "notes": "Test estimate notes",
            "line_items": [
                {"description": "Network Assessment", "quantity": 1, "unit_price": 500},
                {"description": "Equipment", "quantity": 5, "unit_price": 200}
            ]
        }
        response = self.session.post(f"{BASE_URL}/api/xero/estimates", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Missing estimate id"
        assert "estimate_number" in data, "Missing estimate_number"
        assert data["title"] == "TEST_Network Upgrade Project"
        assert data["total"] > 0, "Total should be calculated"
        print(f"Created estimate: {data['estimate_number']} for ${data['total']}")
        return data
    
    def test_convert_estimate_to_invoice(self):
        """Test POST /api/xero/estimates/{id}/convert converts to invoice"""
        # First create an estimate
        create_payload = {
            "title": "TEST_Convert Estimate",
            "client_name": "TEST_ConvertClient",
            "valid_until": "2026-03-15",
            "line_items": [{"description": "Service", "quantity": 1, "unit_price": 1000}]
        }
        create_resp = self.session.post(f"{BASE_URL}/api/xero/estimates", json=create_payload)
        assert create_resp.status_code == 200
        estimate = create_resp.json()
        estimate_id = estimate["id"]
        
        # Convert to invoice
        convert_resp = self.session.post(f"{BASE_URL}/api/xero/estimates/{estimate_id}/convert")
        assert convert_resp.status_code == 200, f"Convert failed: {convert_resp.text}"
        
        invoice = convert_resp.json()
        assert "invoice_number" in invoice, "Missing invoice_number in converted invoice"
        print(f"Converted estimate {estimate['estimate_number']} to invoice {invoice['invoice_number']}")


class TestXeroRecurring:
    """Test Xero Recurring Templates CRUD"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed")
    
    def test_get_recurring(self):
        """Test GET /api/xero/recurring returns list"""
        response = self.session.get(f"{BASE_URL}/api/xero/recurring")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of recurring templates"
        print(f"Found {len(data)} recurring templates")
    
    def test_create_recurring(self):
        """Test POST /api/xero/recurring creates new template"""
        payload = {
            "client_name": "TEST_RecurringClient",
            "description": "TEST_Monthly IT Support",
            "frequency": "monthly",
            "line_items": [
                {"description": "Monthly Support", "quantity": 1, "unit_price": 500}
            ]
        }
        response = self.session.post(f"{BASE_URL}/api/xero/recurring", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Missing recurring id"
        assert data["client_name"] == "TEST_RecurringClient"
        assert data["frequency"] == "monthly"
        assert data["status"] == "active"
        print(f"Created recurring template: {data['description']} - ${data['amount']}/mo")
        return data
    
    def test_toggle_recurring(self):
        """Test PUT /api/xero/recurring/{id}/toggle pauses/resumes"""
        # First create a recurring template
        create_payload = {
            "client_name": "TEST_ToggleClient",
            "description": "TEST_Toggle Template",
            "frequency": "monthly",
            "line_items": [{"description": "Service", "quantity": 1, "unit_price": 100}]
        }
        create_resp = self.session.post(f"{BASE_URL}/api/xero/recurring", json=create_payload)
        assert create_resp.status_code == 200
        rec = create_resp.json()
        rec_id = rec["id"]
        assert rec["status"] == "active"
        
        # Toggle to pause
        toggle_resp = self.session.put(f"{BASE_URL}/api/xero/recurring/{rec_id}/toggle")
        assert toggle_resp.status_code == 200
        toggle_data = toggle_resp.json()
        assert toggle_data["status"] == "paused", "Expected status to be paused"
        print(f"Toggled recurring template to: {toggle_data['status']}")
        
        # Toggle back to active
        toggle_resp2 = self.session.put(f"{BASE_URL}/api/xero/recurring/{rec_id}/toggle")
        assert toggle_resp2.status_code == 200
        toggle_data2 = toggle_resp2.json()
        assert toggle_data2["status"] == "active", "Expected status to be active"
        print(f"Toggled recurring template back to: {toggle_data2['status']}")


class TestXeroSyncHistory:
    """Test Xero Sync History API"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed")
    
    def test_get_sync_history(self):
        """Test GET /api/xero/sync-history returns events"""
        response = self.session.get(f"{BASE_URL}/api/xero/sync-history")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of sync events"
        if len(data) > 0:
            event = data[0]
            assert "id" in event, "Missing event id"
            assert "event_type" in event, "Missing event_type"
            assert "message" in event, "Missing message"
            assert "timestamp" in event, "Missing timestamp"
        print(f"Found {len(data)} sync history events")
    
    def test_trigger_sync(self):
        """Test POST /api/xero/sync triggers sync"""
        response = self.session.post(f"{BASE_URL}/api/xero/sync")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data, "Missing message"
        print(f"Sync result: {data['message']}")


class TestXeroContacts:
    """Test Xero Contacts API"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed")
    
    def test_get_contacts(self):
        """Test GET /api/xero/contacts returns list with balance info"""
        response = self.session.get(f"{BASE_URL}/api/xero/contacts")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of contacts"
        if len(data) > 0:
            contact = data[0]
            assert "id" in contact, "Missing contact id"
            assert "client_name" in contact or "name" in contact, "Missing name"
            # Balance fields should exist
            assert "balance_due" in contact or "overdue_amount" in contact, "Missing balance fields"
        print(f"Found {len(data)} Xero contacts")


class TestXeroAccounts:
    """Test Xero Accounts API"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed")
    
    def test_get_accounts(self):
        """Test GET /api/xero/accounts returns chart of accounts"""
        response = self.session.get(f"{BASE_URL}/api/xero/accounts")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of accounts"
        if len(data) > 0:
            account = data[0]
            assert "id" in account, "Missing account id"
            assert "code" in account, "Missing account code"
            assert "name" in account, "Missing account name"
            assert "type" in account, "Missing account type"
        print(f"Found {len(data)} chart of accounts")


class TestTicketsBulkActions:
    """Test Tickets Bulk Actions API"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed")
        
        # Get existing tickets for testing
        tickets_resp = self.session.get(f"{BASE_URL}/api/tickets")
        if tickets_resp.status_code == 200:
            self.tickets = tickets_resp.json()
        else:
            self.tickets = []
    
    def test_bulk_action_close(self):
        """Test bulk close action"""
        if len(self.tickets) < 1:
            pytest.skip("No tickets available for testing")
        
        # Create a test ticket first
        create_resp = self.session.post(f"{BASE_URL}/api/tickets", json={
            "title": "TEST_BulkClose Ticket",
            "description": "Test ticket for bulk close",
            "client_id": self.tickets[0].get("client_id", ""),
            "client_name": "TEST_Client",
            "priority": "low",
            "status": "open"
        })
        if create_resp.status_code != 200:
            pytest.skip("Could not create test ticket")
        
        test_ticket = create_resp.json()
        ticket_id = test_ticket["id"]
        
        # Bulk close
        response = self.session.post(f"{BASE_URL}/api/tickets/bulk-action", json={
            "ticket_ids": [ticket_id],
            "action": "close"
        })
        assert response.status_code == 200, f"Bulk close failed: {response.text}"
        data = response.json()
        assert "updated" in data, "Missing updated count"
        assert data["updated"] >= 1, "Expected at least 1 ticket updated"
        print(f"Bulk close result: {data['message']}")
    
    def test_bulk_action_priority(self):
        """Test bulk priority change action"""
        # Create a test ticket
        create_resp = self.session.post(f"{BASE_URL}/api/tickets", json={
            "title": "TEST_BulkPriority Ticket",
            "description": "Test ticket for bulk priority",
            "client_name": "TEST_Client",
            "priority": "low",
            "status": "open"
        })
        if create_resp.status_code != 200:
            pytest.skip("Could not create test ticket")
        
        test_ticket = create_resp.json()
        ticket_id = test_ticket["id"]
        
        # Bulk change priority to high
        response = self.session.post(f"{BASE_URL}/api/tickets/bulk-action", json={
            "ticket_ids": [ticket_id],
            "action": "priority",
            "value": "high"
        })
        assert response.status_code == 200, f"Bulk priority failed: {response.text}"
        data = response.json()
        assert data["updated"] >= 1
        print(f"Bulk priority result: {data['message']}")
    
    def test_bulk_action_status(self):
        """Test bulk status change action"""
        # Create a test ticket
        create_resp = self.session.post(f"{BASE_URL}/api/tickets", json={
            "title": "TEST_BulkStatus Ticket",
            "description": "Test ticket for bulk status",
            "client_name": "TEST_Client",
            "priority": "medium",
            "status": "open"
        })
        if create_resp.status_code != 200:
            pytest.skip("Could not create test ticket")
        
        test_ticket = create_resp.json()
        ticket_id = test_ticket["id"]
        
        # Bulk change status to in_progress
        response = self.session.post(f"{BASE_URL}/api/tickets/bulk-action", json={
            "ticket_ids": [ticket_id],
            "action": "status",
            "value": "in_progress"
        })
        assert response.status_code == 200, f"Bulk status failed: {response.text}"
        data = response.json()
        assert data["updated"] >= 1
        print(f"Bulk status result: {data['message']}")
    
    def test_bulk_action_tag(self):
        """Test bulk tag action"""
        # Create a test ticket
        create_resp = self.session.post(f"{BASE_URL}/api/tickets", json={
            "title": "TEST_BulkTag Ticket",
            "description": "Test ticket for bulk tag",
            "client_name": "TEST_Client",
            "priority": "medium",
            "status": "open"
        })
        if create_resp.status_code != 200:
            pytest.skip("Could not create test ticket")
        
        test_ticket = create_resp.json()
        ticket_id = test_ticket["id"]
        
        # Bulk add tag
        response = self.session.post(f"{BASE_URL}/api/tickets/bulk-action", json={
            "ticket_ids": [ticket_id],
            "action": "tag",
            "value": "urgent-review"
        })
        assert response.status_code == 200, f"Bulk tag failed: {response.text}"
        data = response.json()
        assert data["updated"] >= 1
        print(f"Bulk tag result: {data['message']}")
    
    def test_bulk_action_invalid_action(self):
        """Test bulk action with invalid action type"""
        response = self.session.post(f"{BASE_URL}/api/tickets/bulk-action", json={
            "ticket_ids": ["some-id"],
            "action": "invalid_action"
        })
        assert response.status_code == 400, "Expected 400 for invalid action"
        print("Invalid action correctly rejected")
    
    def test_bulk_action_missing_params(self):
        """Test bulk action with missing parameters"""
        response = self.session.post(f"{BASE_URL}/api/tickets/bulk-action", json={
            "ticket_ids": [],
            "action": "close"
        })
        assert response.status_code == 400, "Expected 400 for empty ticket_ids"
        print("Missing params correctly rejected")


class TestXeroInvoiceActions:
    """Test Xero Invoice Actions (send, pay, void)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed")
    
    def test_send_invoice(self):
        """Test POST /api/xero/invoices/{id}/send"""
        # Create a draft invoice
        create_resp = self.session.post(f"{BASE_URL}/api/xero/invoices", json={
            "client_name": "TEST_SendClient",
            "line_items": [{"description": "Service", "quantity": 1, "unit_price": 500}]
        })
        assert create_resp.status_code == 200
        invoice = create_resp.json()
        invoice_id = invoice["id"]
        
        # Send invoice
        send_resp = self.session.post(f"{BASE_URL}/api/xero/invoices/{invoice_id}/send")
        assert send_resp.status_code == 200, f"Send failed: {send_resp.text}"
        print(f"Invoice {invoice['invoice_number']} sent successfully")
    
    def test_pay_invoice(self):
        """Test PUT /api/xero/invoices/{id}/pay"""
        # Create an invoice
        create_resp = self.session.post(f"{BASE_URL}/api/xero/invoices", json={
            "client_name": "TEST_PayClient",
            "line_items": [{"description": "Service", "quantity": 1, "unit_price": 1000}]
        })
        assert create_resp.status_code == 200
        invoice = create_resp.json()
        invoice_id = invoice["id"]
        
        # Send it first (to make it AUTHORISED)
        self.session.post(f"{BASE_URL}/api/xero/invoices/{invoice_id}/send")
        
        # Pay invoice
        pay_resp = self.session.put(f"{BASE_URL}/api/xero/invoices/{invoice_id}/pay", json={
            "amount": invoice["total"]
        })
        assert pay_resp.status_code == 200, f"Pay failed: {pay_resp.text}"
        pay_data = pay_resp.json()
        assert pay_data["status"] == "PAID", "Expected status PAID after full payment"
        print(f"Invoice paid: amount_due=${pay_data['amount_due']}, status={pay_data['status']}")
    
    def test_void_invoice(self):
        """Test PUT /api/xero/invoices/{id}/void"""
        # Create an invoice
        create_resp = self.session.post(f"{BASE_URL}/api/xero/invoices", json={
            "client_name": "TEST_VoidClient",
            "line_items": [{"description": "Service", "quantity": 1, "unit_price": 200}]
        })
        assert create_resp.status_code == 200
        invoice = create_resp.json()
        invoice_id = invoice["id"]
        
        # Void invoice
        void_resp = self.session.put(f"{BASE_URL}/api/xero/invoices/{invoice_id}/void")
        assert void_resp.status_code == 200, f"Void failed: {void_resp.text}"
        print(f"Invoice {invoice['invoice_number']} voided successfully")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
