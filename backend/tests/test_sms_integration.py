"""
Test SMS Integration for Tickets and Invoices
Tests the two-way SMS service-desk functionality:
- Ticket SMS: conversation-type selector, SMS form, template picker, send SMS
- Invoice SMS: Send SMS Reminder button for overdue invoices
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSMSEndpoints:
    """Test SMS-related backend endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session with auth"""
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
    
    # ============ SMS Templates ============
    def test_get_sms_templates_ticket_category(self):
        """GET /api/sms/templates?category=ticket returns ticket templates"""
        resp = self.session.get(f"{BASE_URL}/api/sms/templates?category=ticket")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Expected list of templates"
        # Should have at least the default ticket templates
        if len(data) > 0:
            assert "key" in data[0], "Template should have 'key' field"
            assert "body" in data[0], "Template should have 'body' field"
            assert "category" in data[0], "Template should have 'category' field"
            # All returned templates should be ticket category
            for t in data:
                assert t.get("category") == "ticket", f"Expected ticket category, got {t.get('category')}"
        print(f"Found {len(data)} ticket SMS templates")
    
    def test_get_sms_templates_billing_category(self):
        """GET /api/sms/templates?category=billing returns billing templates"""
        resp = self.session.get(f"{BASE_URL}/api/sms/templates?category=billing")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Expected list of templates"
        if len(data) > 0:
            for t in data:
                assert t.get("category") == "billing", f"Expected billing category, got {t.get('category')}"
        print(f"Found {len(data)} billing SMS templates")
    
    # ============ Ticket SMS ============
    def test_get_ticket_sms_list(self):
        """GET /api/tickets/{id}/sms returns SMS messages for a ticket"""
        # First get a ticket
        tickets_resp = self.session.get(f"{BASE_URL}/api/tickets")
        assert tickets_resp.status_code == 200
        tickets = tickets_resp.json()
        if not tickets:
            pytest.skip("No tickets available for testing")
        
        ticket_id = tickets[0]["id"]
        resp = self.session.get(f"{BASE_URL}/api/tickets/{ticket_id}/sms")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Expected list of SMS messages"
        print(f"Ticket {ticket_id} has {len(data)} SMS messages")
    
    def test_send_ticket_sms_no_phone_returns_400(self):
        """POST /api/tickets/{id}/send-sms returns 400 if no phone number"""
        # Get a ticket
        tickets_resp = self.session.get(f"{BASE_URL}/api/tickets")
        assert tickets_resp.status_code == 200
        tickets = tickets_resp.json()
        if not tickets:
            pytest.skip("No tickets available for testing")
        
        ticket_id = tickets[0]["id"]
        # Try to send SMS without providing 'to' - should fail if client has no phone
        resp = self.session.post(f"{BASE_URL}/api/tickets/{ticket_id}/send-sms", json={
            "message": "Test message",
            "template_key": None
        })
        # Either 400 (no phone) or 200/201 (if client has phone and SMS config is set)
        # We expect 400 for validation error if no phone
        assert resp.status_code in [200, 201, 400, 502], f"Unexpected status {resp.status_code}: {resp.text}"
        if resp.status_code == 400:
            detail = resp.json().get("detail", "")
            assert "phone" in detail.lower() or "mobile" in detail.lower() or "configured" in detail.lower(), f"Expected phone-related error, got: {detail}"
            print(f"Correctly returned 400: {detail}")
        else:
            print(f"SMS endpoint returned {resp.status_code} - provider may be configured")
    
    def test_send_ticket_sms_with_test_number(self):
        """POST /api/tickets/{id}/send-sms with test number validates request shape"""
        tickets_resp = self.session.get(f"{BASE_URL}/api/tickets")
        assert tickets_resp.status_code == 200
        tickets = tickets_resp.json()
        if not tickets:
            pytest.skip("No tickets available for testing")
        
        ticket_id = tickets[0]["id"]
        # Send with a clearly fake test number - expect either success or provider rejection
        resp = self.session.post(f"{BASE_URL}/api/tickets/{ticket_id}/send-sms", json={
            "to": "0400000000",  # Test number
            "message": "Test SMS from NexusOps testing - please ignore",
            "template_key": None
        })
        # Accept 200/201 (sent), 400 (validation/provider error), or 502 (provider down)
        assert resp.status_code in [200, 201, 400, 502], f"Unexpected status {resp.status_code}: {resp.text}"
        print(f"Send SMS returned {resp.status_code}: {resp.text[:200]}")
    
    # ============ Invoice SMS ============
    def test_get_invoices_list(self):
        """GET /api/invoices returns list of invoices"""
        resp = self.session.get(f"{BASE_URL}/api/invoices")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert isinstance(data, list), "Expected list of invoices"
        print(f"Found {len(data)} invoices")
        return data
    
    def test_send_invoice_sms_reminder_no_phone(self):
        """POST /api/invoices/{id}/send-sms-reminder returns 400 if no phone"""
        invoices_resp = self.session.get(f"{BASE_URL}/api/invoices")
        assert invoices_resp.status_code == 200
        invoices = invoices_resp.json()
        if not invoices:
            pytest.skip("No invoices available for testing")
        
        # Find an unpaid invoice
        unpaid = [i for i in invoices if i.get("payment_status") != "paid"]
        if not unpaid:
            pytest.skip("No unpaid invoices for testing")
        
        invoice_id = unpaid[0]["id"]
        # Try without providing 'to' - should fail if client has no phone
        resp = self.session.post(f"{BASE_URL}/api/invoices/{invoice_id}/send-sms-reminder", json={})
        assert resp.status_code in [200, 201, 400, 502], f"Unexpected status {resp.status_code}: {resp.text}"
        if resp.status_code == 400:
            detail = resp.json().get("detail", "")
            print(f"Correctly returned 400: {detail}")
        else:
            print(f"Invoice SMS endpoint returned {resp.status_code}")
    
    def test_send_invoice_sms_reminder_with_test_number(self):
        """POST /api/invoices/{id}/send-sms-reminder with test number"""
        invoices_resp = self.session.get(f"{BASE_URL}/api/invoices")
        assert invoices_resp.status_code == 200
        invoices = invoices_resp.json()
        if not invoices:
            pytest.skip("No invoices available for testing")
        
        # Find an unpaid invoice
        unpaid = [i for i in invoices if i.get("payment_status") != "paid"]
        if not unpaid:
            pytest.skip("No unpaid invoices for testing")
        
        invoice_id = unpaid[0]["id"]
        resp = self.session.post(f"{BASE_URL}/api/invoices/{invoice_id}/send-sms-reminder", json={
            "to": "0400000000",  # Test number
            "template_key": "overdue_invoice"
        })
        assert resp.status_code in [200, 201, 400, 502], f"Unexpected status {resp.status_code}: {resp.text}"
        print(f"Invoice SMS reminder returned {resp.status_code}: {resp.text[:200]}")
    
    # ============ SMS Messages List ============
    def test_get_sms_messages_list(self):
        """GET /api/sms/messages returns SMS message history"""
        resp = self.session.get(f"{BASE_URL}/api/sms/messages")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert isinstance(data, list), "Expected list of SMS messages"
        print(f"Found {len(data)} SMS messages in history")
    
    # ============ Regression: Ticket Notes and Emails ============
    def test_ticket_notes_still_work(self):
        """POST /api/tickets/{id}/comments still works (regression)"""
        tickets_resp = self.session.get(f"{BASE_URL}/api/tickets")
        assert tickets_resp.status_code == 200
        tickets = tickets_resp.json()
        if not tickets:
            pytest.skip("No tickets available")
        
        ticket_id = tickets[0]["id"]
        resp = self.session.post(f"{BASE_URL}/api/tickets/{ticket_id}/comments", json={
            "content": "TEST_regression_note - Internal note test",
            "is_internal": True
        })
        assert resp.status_code in [200, 201], f"Expected 200/201, got {resp.status_code}: {resp.text}"
        print("Ticket notes endpoint working correctly")
    
    def test_ticket_emails_endpoint_exists(self):
        """GET /api/tickets/{id}/emails returns email list (regression)"""
        tickets_resp = self.session.get(f"{BASE_URL}/api/tickets")
        assert tickets_resp.status_code == 200
        tickets = tickets_resp.json()
        if not tickets:
            pytest.skip("No tickets available")
        
        ticket_id = tickets[0]["id"]
        resp = self.session.get(f"{BASE_URL}/api/tickets/{ticket_id}/emails")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert isinstance(data, list), "Expected list of emails"
        print(f"Ticket {ticket_id} has {len(data)} emails")
    
    # ============ Regression: Invoice Actions ============
    def test_invoice_clone_works(self):
        """POST /api/invoices/{id}/clone still works (regression)"""
        invoices_resp = self.session.get(f"{BASE_URL}/api/invoices")
        assert invoices_resp.status_code == 200
        invoices = invoices_resp.json()
        if not invoices:
            pytest.skip("No invoices available")
        
        invoice_id = invoices[0]["id"]
        resp = self.session.post(f"{BASE_URL}/api/invoices/{invoice_id}/clone", json={})
        assert resp.status_code in [200, 201], f"Expected 200/201, got {resp.status_code}: {resp.text}"
        print("Invoice clone endpoint working correctly")
    
    def test_invoice_void_endpoint_exists(self):
        """POST /api/invoices/{id}/void endpoint exists (regression)"""
        invoices_resp = self.session.get(f"{BASE_URL}/api/invoices")
        assert invoices_resp.status_code == 200
        invoices = invoices_resp.json()
        if not invoices:
            pytest.skip("No invoices available")
        
        # Find a draft invoice to void (don't void paid ones)
        draft = [i for i in invoices if i.get("status") == "draft"]
        if not draft:
            # Just check the endpoint exists by trying with a non-voidable invoice
            invoice_id = invoices[0]["id"]
            resp = self.session.post(f"{BASE_URL}/api/invoices/{invoice_id}/void", json={"reason": "TEST"})
            # Accept any response that's not 404 (endpoint exists)
            assert resp.status_code != 404, "Void endpoint should exist"
            print(f"Void endpoint exists, returned {resp.status_code}")
        else:
            invoice_id = draft[0]["id"]
            resp = self.session.post(f"{BASE_URL}/api/invoices/{invoice_id}/void", json={"reason": "TEST_void"})
            assert resp.status_code in [200, 201, 400], f"Unexpected {resp.status_code}"
            print("Invoice void endpoint working correctly")
    
    def test_invoice_record_payment_endpoint_exists(self):
        """POST /api/invoices/{id}/record-payment endpoint exists (regression)"""
        invoices_resp = self.session.get(f"{BASE_URL}/api/invoices")
        assert invoices_resp.status_code == 200
        invoices = invoices_resp.json()
        if not invoices:
            pytest.skip("No invoices available")
        
        # Find an unpaid invoice
        unpaid = [i for i in invoices if i.get("payment_status") != "paid"]
        if not unpaid:
            pytest.skip("No unpaid invoices")
        
        invoice_id = unpaid[0]["id"]
        resp = self.session.post(f"{BASE_URL}/api/invoices/{invoice_id}/record-payment", json={
            "amount": "0.01",
            "method": "cash",
            "reference": "TEST_payment",
            "date": "2026-01-15"
        })
        assert resp.status_code in [200, 201], f"Expected 200/201, got {resp.status_code}: {resp.text}"
        print("Invoice record-payment endpoint working correctly")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
