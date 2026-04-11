"""
Iteration 74 - Enhanced Recurring Billing Module + Invoice Email Feature Tests
Tests for:
1. Recurring tab KPI stats (MRR, ARR, Active Templates, Due for Generation, Total Templates)
2. 12-Month Revenue Forecast endpoint
3. Recurring template CRUD with enhanced fields (contract dates, payment terms, escalation, auto-send, auto-generate)
4. Generate Now and Batch Generate functionality
5. Recurring template history endpoint
6. Invoice Email feature (mocked email sending)
"""

import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestRecurringBillingEnhanced:
    """Tests for enhanced recurring billing module"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth token for all tests"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
    
    # ============== RECURRING FORECAST TESTS ==============
    
    def test_get_recurring_forecast(self):
        """Test GET /api/xero/recurring/forecast returns MRR, ARR, active_count, and 12-month forecast"""
        response = requests.get(f"{BASE_URL}/api/xero/recurring/forecast", headers=self.headers)
        assert response.status_code == 200, f"Forecast failed: {response.text}"
        data = response.json()
        
        # Verify forecast structure
        assert "mrr" in data, "Missing MRR in forecast"
        assert "arr" in data, "Missing ARR in forecast"
        assert "active_count" in data, "Missing active_count in forecast"
        assert "forecast" in data, "Missing forecast array"
        
        # Verify MRR/ARR are numbers
        assert isinstance(data["mrr"], (int, float)), "MRR should be a number"
        assert isinstance(data["arr"], (int, float)), "ARR should be a number"
        assert isinstance(data["active_count"], int), "active_count should be an integer"
        
        # Verify forecast has 12 months
        assert len(data["forecast"]) == 12, f"Expected 12 months in forecast, got {len(data['forecast'])}"
        
        # Verify each forecast entry has month and projected
        for entry in data["forecast"]:
            assert "month" in entry, "Missing month in forecast entry"
            assert "projected" in entry, "Missing projected in forecast entry"
        
        print(f"Forecast: MRR=${data['mrr']}, ARR=${data['arr']}, Active={data['active_count']}")
    
    # ============== RECURRING CRUD TESTS ==============
    
    def test_get_recurring_templates(self):
        """Test GET /api/xero/recurring returns templates with enhanced fields"""
        response = requests.get(f"{BASE_URL}/api/xero/recurring", headers=self.headers)
        assert response.status_code == 200, f"Get recurring failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Expected list of recurring templates"
        
        if len(data) > 0:
            template = data[0]
            # Verify enhanced fields exist
            assert "client_name" in template, "Missing client_name"
            assert "description" in template, "Missing description"
            assert "frequency" in template, "Missing frequency"
            assert "amount" in template, "Missing amount"
            assert "status" in template, "Missing status"
            assert "next_generation" in template, "Missing next_generation"
            assert "invoices_generated" in template, "Missing invoices_generated"
            
            # Verify new enhanced fields
            assert "payment_terms" in template, "Missing payment_terms"
            assert "contract_start" in template, "Missing contract_start"
            assert "escalation_percent" in template, "Missing escalation_percent"
            assert "auto_send" in template, "Missing auto_send"
            assert "auto_generate" in template, "Missing auto_generate"
            assert "total_billed" in template, "Missing total_billed"
            assert "total_collected" in template, "Missing total_collected"
            assert "line_items" in template, "Missing line_items"
            
            print(f"Found {len(data)} recurring templates with enhanced fields")
    
    def test_create_recurring_template_with_enhanced_fields(self):
        """Test POST /api/xero/recurring creates template with all new fields"""
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        next_year = (datetime.now() + timedelta(days=365)).strftime("%Y-%m-%d")
        
        payload = {
            "client_name": "TEST_Recurring_Client",
            "email": "test@recurring.com",
            "description": "TEST_Monthly IT Support Services",
            "frequency": "monthly",
            "payment_terms": 14,
            "tax_rate": 10,
            "contract_start": datetime.now().strftime("%Y-%m-%d"),
            "contract_end": next_year,
            "escalation_percent": 3.5,
            "auto_generate": True,
            "auto_send": True,
            "notes": "Test recurring template with all enhanced fields",
            "line_items": [
                {"description": "Monthly IT Support", "quantity": 1, "unit_price": 1500},
                {"description": "Cloud Backup Service", "quantity": 1, "unit_price": 200}
            ]
        }
        
        response = requests.post(f"{BASE_URL}/api/xero/recurring", json=payload, headers=self.headers)
        assert response.status_code == 200, f"Create recurring failed: {response.text}"
        data = response.json()
        
        # Verify created template
        assert data["client_name"] == payload["client_name"]
        assert data["description"] == payload["description"]
        assert data["frequency"] == payload["frequency"]
        assert data["payment_terms"] == payload["payment_terms"]
        assert data["escalation_percent"] == payload["escalation_percent"]
        assert data["auto_send"] == payload["auto_send"]
        assert data["auto_generate"] == payload["auto_generate"]
        assert data["contract_start"] == payload["contract_start"]
        assert data["contract_end"] == payload["contract_end"]
        assert data["status"] == "active"
        assert "id" in data
        
        # Verify amount calculation (subtotal + tax)
        expected_subtotal = 1500 + 200
        expected_tax = expected_subtotal * 0.1
        expected_total = expected_subtotal + expected_tax
        assert data["amount"] == expected_total, f"Expected amount {expected_total}, got {data['amount']}"
        
        self.created_rec_id = data["id"]
        print(f"Created recurring template: {data['id']} with amount ${data['amount']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/xero/recurring/{data['id']}", headers=self.headers)
    
    def test_update_recurring_template(self):
        """Test PUT /api/xero/recurring/{id} updates template"""
        # First create a template
        payload = {
            "client_name": "TEST_Update_Client",
            "description": "TEST_Service to Update",
            "frequency": "monthly",
            "payment_terms": 14,
            "line_items": [{"description": "Service", "quantity": 1, "unit_price": 1000}]
        }
        create_resp = requests.post(f"{BASE_URL}/api/xero/recurring", json=payload, headers=self.headers)
        assert create_resp.status_code == 200
        rec_id = create_resp.json()["id"]
        
        # Update the template
        update_payload = {
            "client_name": "TEST_Updated_Client",
            "description": "TEST_Updated Service Description",
            "payment_terms": 30,
            "escalation_percent": 5,
            "auto_send": True,
            "notes": "Updated notes"
        }
        update_resp = requests.put(f"{BASE_URL}/api/xero/recurring/{rec_id}", json=update_payload, headers=self.headers)
        assert update_resp.status_code == 200, f"Update failed: {update_resp.text}"
        
        # Verify update by fetching
        get_resp = requests.get(f"{BASE_URL}/api/xero/recurring", headers=self.headers)
        templates = get_resp.json()
        updated = next((t for t in templates if t["id"] == rec_id), None)
        
        assert updated is not None, "Updated template not found"
        assert updated["client_name"] == update_payload["client_name"]
        assert updated["description"] == update_payload["description"]
        assert updated["payment_terms"] == update_payload["payment_terms"]
        assert updated["escalation_percent"] == update_payload["escalation_percent"]
        assert updated["auto_send"] == update_payload["auto_send"]
        
        print(f"Updated recurring template: {rec_id}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/xero/recurring/{rec_id}", headers=self.headers)
    
    def test_delete_recurring_template(self):
        """Test DELETE /api/xero/recurring/{id} deletes template"""
        # Create a template to delete
        payload = {
            "client_name": "TEST_Delete_Client",
            "description": "TEST_Service to Delete",
            "frequency": "monthly",
            "line_items": [{"description": "Service", "quantity": 1, "unit_price": 500}]
        }
        create_resp = requests.post(f"{BASE_URL}/api/xero/recurring", json=payload, headers=self.headers)
        assert create_resp.status_code == 200
        rec_id = create_resp.json()["id"]
        
        # Delete the template
        delete_resp = requests.delete(f"{BASE_URL}/api/xero/recurring/{rec_id}", headers=self.headers)
        assert delete_resp.status_code == 200, f"Delete failed: {delete_resp.text}"
        
        # Verify deletion
        get_resp = requests.get(f"{BASE_URL}/api/xero/recurring", headers=self.headers)
        templates = get_resp.json()
        deleted = next((t for t in templates if t["id"] == rec_id), None)
        assert deleted is None, "Template should be deleted"
        
        print(f"Deleted recurring template: {rec_id}")
    
    def test_toggle_recurring_pause_resume(self):
        """Test PUT /api/xero/recurring/{id}/toggle pauses and resumes template"""
        # Create a template
        payload = {
            "client_name": "TEST_Toggle_Client",
            "description": "TEST_Service to Toggle",
            "frequency": "monthly",
            "line_items": [{"description": "Service", "quantity": 1, "unit_price": 800}]
        }
        create_resp = requests.post(f"{BASE_URL}/api/xero/recurring", json=payload, headers=self.headers)
        assert create_resp.status_code == 200
        rec_id = create_resp.json()["id"]
        initial_status = create_resp.json()["status"]
        assert initial_status == "active"
        
        # Toggle to pause
        toggle_resp = requests.put(f"{BASE_URL}/api/xero/recurring/{rec_id}/toggle", headers=self.headers)
        assert toggle_resp.status_code == 200
        assert toggle_resp.json()["status"] == "paused"
        
        # Toggle back to active
        toggle_resp2 = requests.put(f"{BASE_URL}/api/xero/recurring/{rec_id}/toggle", headers=self.headers)
        assert toggle_resp2.status_code == 200
        assert toggle_resp2.json()["status"] == "active"
        
        print(f"Toggle test passed for template: {rec_id}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/xero/recurring/{rec_id}", headers=self.headers)
    
    # ============== GENERATE INVOICE TESTS ==============
    
    def test_generate_invoice_from_recurring(self):
        """Test POST /api/xero/recurring/{id}/generate creates invoice from template"""
        # Create a template
        payload = {
            "client_name": "TEST_Generate_Client",
            "description": "TEST_Service for Invoice Generation",
            "frequency": "monthly",
            "payment_terms": 14,
            "auto_send": False,
            "line_items": [{"description": "Monthly Service", "quantity": 1, "unit_price": 1200}]
        }
        create_resp = requests.post(f"{BASE_URL}/api/xero/recurring", json=payload, headers=self.headers)
        assert create_resp.status_code == 200
        rec_id = create_resp.json()["id"]
        
        # Generate invoice
        gen_resp = requests.post(f"{BASE_URL}/api/xero/recurring/{rec_id}/generate", headers=self.headers)
        assert gen_resp.status_code == 200, f"Generate failed: {gen_resp.text}"
        invoice = gen_resp.json()
        
        # Verify invoice was created
        assert "id" in invoice
        assert "invoice_number" in invoice
        assert invoice["client_name"] == payload["client_name"]
        assert invoice["recurring_id"] == rec_id
        assert invoice["status"] == "DRAFT"  # auto_send was False
        
        print(f"Generated invoice {invoice['invoice_number']} from recurring template")
        
        # Verify template was updated
        get_resp = requests.get(f"{BASE_URL}/api/xero/recurring", headers=self.headers)
        templates = get_resp.json()
        updated_template = next((t for t in templates if t["id"] == rec_id), None)
        assert updated_template["invoices_generated"] >= 1
        assert updated_template["total_billed"] > 0
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/xero/recurring/{rec_id}", headers=self.headers)
    
    def test_batch_generate_recurring(self):
        """Test POST /api/xero/recurring/batch-generate generates all due invoices"""
        response = requests.post(f"{BASE_URL}/api/xero/recurring/batch-generate", headers=self.headers)
        assert response.status_code == 200, f"Batch generate failed: {response.text}"
        data = response.json()
        
        assert "message" in data
        assert "generated" in data
        assert isinstance(data["generated"], int)
        
        print(f"Batch generate result: {data['message']}, generated {data['generated']} invoices")
    
    def test_get_recurring_history(self):
        """Test GET /api/xero/recurring/{id}/history returns generated invoices"""
        # Get existing recurring templates
        get_resp = requests.get(f"{BASE_URL}/api/xero/recurring", headers=self.headers)
        templates = get_resp.json()
        
        if len(templates) > 0:
            rec_id = templates[0]["id"]
            
            # Get history
            history_resp = requests.get(f"{BASE_URL}/api/xero/recurring/{rec_id}/history", headers=self.headers)
            assert history_resp.status_code == 200, f"Get history failed: {history_resp.text}"
            history = history_resp.json()
            
            assert isinstance(history, list), "History should be a list"
            
            if len(history) > 0:
                invoice = history[0]
                assert "id" in invoice
                assert "invoice_number" in invoice
                assert "status" in invoice
                assert "total" in invoice
                
            print(f"Found {len(history)} invoices in history for template {rec_id}")
        else:
            pytest.skip("No recurring templates to test history")


class TestInvoiceEmail:
    """Tests for invoice email feature (MOCKED)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth token for all tests"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
    
    def test_send_invoice_email(self):
        """Test POST /api/xero/invoices/{id}/email sends (mocked) email"""
        # Get existing invoices
        inv_resp = requests.get(f"{BASE_URL}/api/xero/invoices", headers=self.headers)
        assert inv_resp.status_code == 200
        invoices = inv_resp.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices to test email")
        
        invoice = invoices[0]
        invoice_id = invoice["id"]
        
        # Send email
        email_payload = {
            "to_email": "test@example.com",
            "subject": f"Invoice {invoice['invoice_number']} from NexusOps",
            "message": f"Please find attached invoice {invoice['invoice_number']} for ${invoice['total']}."
        }
        
        email_resp = requests.post(f"{BASE_URL}/api/xero/invoices/{invoice_id}/email", json=email_payload, headers=self.headers)
        assert email_resp.status_code == 200, f"Email failed: {email_resp.text}"
        data = email_resp.json()
        
        assert "message" in data
        assert "email" in data
        assert data["email"]["to_email"] == email_payload["to_email"]
        assert data["email"]["subject"] == email_payload["subject"]
        assert data["email"]["status"] == "sent"
        
        print(f"Email sent (mocked) for invoice {invoice['invoice_number']} to {email_payload['to_email']}")
    
    def test_send_invoice_email_missing_recipient(self):
        """Test POST /api/xero/invoices/{id}/email fails without recipient"""
        # Get existing invoices
        inv_resp = requests.get(f"{BASE_URL}/api/xero/invoices", headers=self.headers)
        invoices = inv_resp.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices to test email")
        
        invoice_id = invoices[0]["id"]
        
        # Send email without recipient
        email_payload = {
            "to_email": "",
            "subject": "Test Subject",
            "message": "Test message"
        }
        
        email_resp = requests.post(f"{BASE_URL}/api/xero/invoices/{invoice_id}/email", json=email_payload, headers=self.headers)
        assert email_resp.status_code == 400, "Should fail without recipient email"
        
        print("Email validation test passed - missing recipient rejected")
    
    def test_get_invoice_emails(self):
        """Test GET /api/xero/invoices/{id}/emails returns email history"""
        # Get existing invoices
        inv_resp = requests.get(f"{BASE_URL}/api/xero/invoices", headers=self.headers)
        invoices = inv_resp.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices to test email history")
        
        invoice_id = invoices[0]["id"]
        
        # Get email history
        emails_resp = requests.get(f"{BASE_URL}/api/xero/invoices/{invoice_id}/emails", headers=self.headers)
        assert emails_resp.status_code == 200, f"Get emails failed: {emails_resp.text}"
        emails = emails_resp.json()
        
        assert isinstance(emails, list), "Emails should be a list"
        
        if len(emails) > 0:
            email = emails[0]
            assert "id" in email
            assert "to_email" in email
            assert "subject" in email
            assert "sent_at" in email
            
        print(f"Found {len(emails)} emails for invoice {invoice_id}")
    
    def test_email_updates_draft_to_authorised(self):
        """Test that emailing a DRAFT invoice updates status to AUTHORISED"""
        # Create a new invoice
        inv_payload = {
            "client_name": "TEST_Email_Status_Client",
            "line_items": [{"description": "Test Service", "quantity": 1, "unit_price": 500}]
        }
        create_resp = requests.post(f"{BASE_URL}/api/xero/invoices", json=inv_payload, headers=self.headers)
        assert create_resp.status_code == 200
        invoice = create_resp.json()
        invoice_id = invoice["id"]
        assert invoice["status"] == "DRAFT"
        
        # Send email
        email_payload = {
            "to_email": "client@test.com",
            "subject": "Your Invoice",
            "message": "Please pay"
        }
        email_resp = requests.post(f"{BASE_URL}/api/xero/invoices/{invoice_id}/email", json=email_payload, headers=self.headers)
        assert email_resp.status_code == 200
        
        # Verify status changed
        get_resp = requests.get(f"{BASE_URL}/api/xero/invoices", headers=self.headers)
        invoices = get_resp.json()
        updated_invoice = next((i for i in invoices if i["id"] == invoice_id), None)
        
        assert updated_invoice is not None
        assert updated_invoice["status"] == "AUTHORISED", f"Expected AUTHORISED, got {updated_invoice['status']}"
        
        print(f"Invoice {invoice_id} status updated from DRAFT to AUTHORISED after email")


class TestRecurringKPIs:
    """Tests for recurring billing KPI calculations"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth token for all tests"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
    
    def test_mrr_calculation(self):
        """Test MRR is calculated correctly from active templates"""
        # Get forecast
        forecast_resp = requests.get(f"{BASE_URL}/api/xero/recurring/forecast", headers=self.headers)
        assert forecast_resp.status_code == 200
        forecast = forecast_resp.json()
        
        # Get recurring templates
        rec_resp = requests.get(f"{BASE_URL}/api/xero/recurring", headers=self.headers)
        templates = rec_resp.json()
        
        # Calculate expected MRR
        active_templates = [t for t in templates if t.get("status") == "active"]
        expected_mrr = 0
        for t in active_templates:
            freq = t.get("frequency", "monthly")
            amount = t.get("amount", 0)
            if freq == "monthly":
                expected_mrr += amount
            elif freq == "quarterly":
                expected_mrr += amount / 3
            elif freq == "yearly":
                expected_mrr += amount / 12
            elif freq == "weekly":
                expected_mrr += amount * 4.33
            elif freq == "fortnightly":
                expected_mrr += amount * 2.17
        
        # Allow small rounding difference
        assert abs(forecast["mrr"] - expected_mrr) < 1, f"MRR mismatch: expected {expected_mrr}, got {forecast['mrr']}"
        
        print(f"MRR calculation verified: ${forecast['mrr']}")
    
    def test_arr_is_mrr_times_12(self):
        """Test ARR equals MRR * 12"""
        forecast_resp = requests.get(f"{BASE_URL}/api/xero/recurring/forecast", headers=self.headers)
        assert forecast_resp.status_code == 200
        forecast = forecast_resp.json()
        
        expected_arr = forecast["mrr"] * 12
        assert abs(forecast["arr"] - expected_arr) < 1, f"ARR should be MRR*12: expected {expected_arr}, got {forecast['arr']}"
        
        print(f"ARR verified: ${forecast['arr']} = ${forecast['mrr']} * 12")
    
    def test_active_count_matches_templates(self):
        """Test active_count matches number of active templates"""
        forecast_resp = requests.get(f"{BASE_URL}/api/xero/recurring/forecast", headers=self.headers)
        forecast = forecast_resp.json()
        
        rec_resp = requests.get(f"{BASE_URL}/api/xero/recurring", headers=self.headers)
        templates = rec_resp.json()
        
        active_count = len([t for t in templates if t.get("status") == "active"])
        assert forecast["active_count"] == active_count, f"Active count mismatch: expected {active_count}, got {forecast['active_count']}"
        
        print(f"Active count verified: {forecast['active_count']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
