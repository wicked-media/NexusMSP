"""
Iteration 88 - Recurring Invoices & Invoice Templates Testing
Tests the complete overhaul of the recurring billing module including:
- Recurring invoices CRUD, toggle, generate-now, duplicate
- Invoice templates CRUD and apply
- Stats (MRR, ARR, active count, due this week)
"""
import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
TEST_CREDENTIALS = {"email": "aaron@stech.com.au", "password": "Lucky@2871$!"}


class TestRecurringInvoicesModule:
    """Test recurring invoices and invoice templates endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth token for all tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login to get token
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json=TEST_CREDENTIALS)
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip(f"Auth failed: {login_resp.status_code}")
    
    # ============== RECURRING INVOICES LIST & STATS ==============
    
    def test_get_recurring_invoices_list(self):
        """GET /api/recurring-invoices/list - should return 6 seeded recurring invoices"""
        resp = self.session.get(f"{BASE_URL}/api/recurring-invoices/list")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Response should be a list"
        assert len(data) >= 6, f"Expected at least 6 recurring invoices, got {len(data)}"
        # Verify structure of first item
        ri = data[0]
        assert "id" in ri, "Missing id field"
        assert "client_name" in ri, "Missing client_name field"
        assert "amount" in ri, "Missing amount field"
        assert "frequency" in ri, "Missing frequency field"
        assert "status" in ri, "Missing status field"
        assert "line_items" in ri, "Missing line_items field"
        print(f"✓ GET /api/recurring-invoices/list returned {len(data)} recurring invoices")
    
    def test_get_recurring_stats(self):
        """GET /api/recurring-invoices/stats - should return MRR, ARR, active count, due this week"""
        resp = self.session.get(f"{BASE_URL}/api/recurring-invoices/stats")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        # Verify all expected fields
        assert "mrr" in data, "Missing mrr field"
        assert "arr" in data, "Missing arr field"
        assert "active" in data, "Missing active field"
        assert "due_this_week" in data, "Missing due_this_week field"
        assert "total" in data, "Missing total field"
        assert "by_frequency" in data, "Missing by_frequency field"
        # Verify values are reasonable
        assert data["mrr"] > 0, "MRR should be positive"
        assert data["arr"] > 0, "ARR should be positive"
        assert data["active"] >= 0, "Active count should be non-negative"
        print(f"✓ Stats: MRR=${data['mrr']}, ARR=${data['arr']}, Active={data['active']}, Due this week={data['due_this_week']}")
    
    def test_get_single_recurring_invoice(self):
        """GET /api/recurring-invoices/{id} - should return a single recurring invoice"""
        resp = self.session.get(f"{BASE_URL}/api/recurring-invoices/ri-001")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["id"] == "ri-001", "ID mismatch"
        assert data["client_name"] == "Acme Corporation", "Client name mismatch"
        print(f"✓ GET /api/recurring-invoices/ri-001 returned {data['client_name']}")
    
    def test_get_nonexistent_recurring_invoice(self):
        """GET /api/recurring-invoices/{id} - should return 404 for nonexistent"""
        resp = self.session.get(f"{BASE_URL}/api/recurring-invoices/ri-nonexistent")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("✓ GET nonexistent recurring invoice returns 404")
    
    # ============== CREATE RECURRING INVOICE ==============
    
    def test_create_recurring_invoice(self):
        """POST /api/recurring-invoices/create - should create a new recurring invoice with line items"""
        payload = {
            "client_id": "client-test",
            "client_name": "TEST_RecurringClient",
            "description": "TEST Monthly IT Support",
            "frequency": "monthly",
            "payment_terms": "net_30",
            "tax_rate": 10,
            "currency": "AUD",
            "notes": "Test recurring invoice",
            "auto_send": False,
            "start_date": datetime.now().strftime("%Y-%m-%d"),
            "line_items": [
                {"description": "IT Support - 10 endpoints", "quantity": 10, "rate": 50, "amount": 500},
                {"description": "Cloud Backup", "quantity": 1, "rate": 200, "amount": 200}
            ]
        }
        resp = self.session.post(f"{BASE_URL}/api/recurring-invoices/create", json=payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "id" in data, "Missing id in response"
        assert data["client_name"] == "TEST_RecurringClient", "Client name mismatch"
        assert data["description"] == "TEST Monthly IT Support", "Description mismatch"
        assert data["frequency"] == "monthly", "Frequency mismatch"
        assert data["status"] == "active", "New recurring invoice should be active"
        assert len(data["line_items"]) == 2, "Should have 2 line items"
        # Verify amount calculation (subtotal + tax)
        assert data["subtotal"] == 700, f"Subtotal should be 700, got {data['subtotal']}"
        assert data["amount"] == 770, f"Total should be 770 (700 + 10% tax), got {data['amount']}"
        self.created_ri_id = data["id"]
        print(f"✓ Created recurring invoice {data['id']} with amount ${data['amount']}")
        return data["id"]
    
    # ============== UPDATE RECURRING INVOICE ==============
    
    def test_update_recurring_invoice(self):
        """PUT /api/recurring-invoices/{id} - should update description, line items, frequency"""
        # First create one to update
        create_payload = {
            "client_id": "client-update-test",
            "client_name": "TEST_UpdateClient",
            "description": "Original Description",
            "frequency": "monthly",
            "tax_rate": 10,
            "line_items": [{"description": "Service A", "quantity": 1, "rate": 100, "amount": 100}]
        }
        create_resp = self.session.post(f"{BASE_URL}/api/recurring-invoices/create", json=create_payload)
        assert create_resp.status_code == 200
        ri_id = create_resp.json()["id"]
        
        # Update it
        update_payload = {
            "description": "Updated Description",
            "frequency": "quarterly",
            "line_items": [
                {"description": "Service A Updated", "quantity": 2, "rate": 150, "amount": 300},
                {"description": "Service B New", "quantity": 1, "rate": 200, "amount": 200}
            ],
            "notes": "Updated notes"
        }
        resp = self.session.put(f"{BASE_URL}/api/recurring-invoices/{ri_id}", json=update_payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        # Verify update by fetching
        get_resp = self.session.get(f"{BASE_URL}/api/recurring-invoices/{ri_id}")
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data["description"] == "Updated Description", "Description not updated"
        assert data["frequency"] == "quarterly", "Frequency not updated"
        assert len(data["line_items"]) == 2, "Line items not updated"
        assert data["subtotal"] == 500, f"Subtotal should be 500, got {data['subtotal']}"
        print(f"✓ Updated recurring invoice {ri_id}")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/recurring-invoices/{ri_id}")
    
    # ============== TOGGLE RECURRING INVOICE ==============
    
    def test_toggle_recurring_invoice(self):
        """POST /api/recurring-invoices/{id}/toggle - should pause/activate"""
        # Create a test recurring invoice
        create_payload = {
            "client_id": "client-toggle-test",
            "client_name": "TEST_ToggleClient",
            "description": "Toggle Test",
            "frequency": "monthly",
            "line_items": [{"description": "Service", "quantity": 1, "rate": 100, "amount": 100}]
        }
        create_resp = self.session.post(f"{BASE_URL}/api/recurring-invoices/create", json=create_payload)
        assert create_resp.status_code == 200
        ri_id = create_resp.json()["id"]
        initial_status = create_resp.json()["status"]
        assert initial_status == "active", "New RI should be active"
        
        # Toggle to paused
        toggle_resp = self.session.post(f"{BASE_URL}/api/recurring-invoices/{ri_id}/toggle")
        assert toggle_resp.status_code == 200, f"Expected 200, got {toggle_resp.status_code}"
        assert toggle_resp.json()["status"] == "paused", "Should be paused after toggle"
        
        # Toggle back to active
        toggle_resp2 = self.session.post(f"{BASE_URL}/api/recurring-invoices/{ri_id}/toggle")
        assert toggle_resp2.status_code == 200
        assert toggle_resp2.json()["status"] == "active", "Should be active after second toggle"
        print(f"✓ Toggle recurring invoice {ri_id}: active -> paused -> active")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/recurring-invoices/{ri_id}")
    
    # ============== GENERATE NOW ==============
    
    def test_generate_invoice_now(self):
        """POST /api/recurring-invoices/{id}/generate-now - should create a real invoice"""
        # Create a test recurring invoice
        create_payload = {
            "client_id": "client-gen-test",
            "client_name": "TEST_GenerateClient",
            "description": "Generate Now Test",
            "frequency": "monthly",
            "payment_terms": "net_30",
            "tax_rate": 10,
            "line_items": [{"description": "Monthly Service", "quantity": 1, "rate": 500, "amount": 500}]
        }
        create_resp = self.session.post(f"{BASE_URL}/api/recurring-invoices/create", json=create_payload)
        assert create_resp.status_code == 200
        ri_id = create_resp.json()["id"]
        
        # Generate invoice now
        gen_resp = self.session.post(f"{BASE_URL}/api/recurring-invoices/{ri_id}/generate-now")
        assert gen_resp.status_code == 200, f"Expected 200, got {gen_resp.status_code}: {gen_resp.text}"
        data = gen_resp.json()
        assert "invoice_id" in data, "Missing invoice_id in response"
        assert "invoice_number" in data, "Missing invoice_number in response"
        assert "message" in data, "Missing message in response"
        assert data["amount"] == 550, f"Generated invoice amount should be 550, got {data['amount']}"
        print(f"✓ Generated invoice {data['invoice_number']} from recurring {ri_id}")
        
        # Verify the recurring invoice stats were updated
        get_resp = self.session.get(f"{BASE_URL}/api/recurring-invoices/{ri_id}")
        assert get_resp.status_code == 200
        ri_data = get_resp.json()
        assert ri_data["invoices_generated"] >= 1, "invoices_generated should be incremented"
        assert ri_data["total_billed"] >= 550, "total_billed should be updated"
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/recurring-invoices/{ri_id}")
    
    # ============== DUPLICATE ==============
    
    def test_duplicate_recurring_invoice(self):
        """POST /api/recurring-invoices/{id}/duplicate - should clone a recurring invoice"""
        # Create a test recurring invoice
        create_payload = {
            "client_id": "client-dup-test",
            "client_name": "TEST_DuplicateClient",
            "description": "Duplicate Test",
            "frequency": "monthly",
            "line_items": [{"description": "Service", "quantity": 1, "rate": 300, "amount": 300}]
        }
        create_resp = self.session.post(f"{BASE_URL}/api/recurring-invoices/create", json=create_payload)
        assert create_resp.status_code == 200
        original_id = create_resp.json()["id"]
        
        # Duplicate it
        dup_resp = self.session.post(f"{BASE_URL}/api/recurring-invoices/{original_id}/duplicate")
        assert dup_resp.status_code == 200, f"Expected 200, got {dup_resp.status_code}: {dup_resp.text}"
        data = dup_resp.json()
        assert data["id"] != original_id, "Duplicate should have different ID"
        assert "(Copy)" in data["description"], "Duplicate description should contain (Copy)"
        assert data["status"] == "paused", "Duplicate should be paused by default"
        assert data["invoices_generated"] == 0, "Duplicate should have 0 invoices generated"
        assert data["total_billed"] == 0, "Duplicate should have 0 total billed"
        print(f"✓ Duplicated {original_id} to {data['id']}")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/recurring-invoices/{original_id}")
        self.session.delete(f"{BASE_URL}/api/recurring-invoices/{data['id']}")
    
    # ============== DELETE ==============
    
    def test_delete_recurring_invoice(self):
        """DELETE /api/recurring-invoices/{id} - should delete a recurring invoice"""
        # Create one to delete
        create_payload = {
            "client_id": "client-del-test",
            "client_name": "TEST_DeleteClient",
            "description": "Delete Test",
            "frequency": "monthly",
            "line_items": [{"description": "Service", "quantity": 1, "rate": 100, "amount": 100}]
        }
        create_resp = self.session.post(f"{BASE_URL}/api/recurring-invoices/create", json=create_payload)
        assert create_resp.status_code == 200
        ri_id = create_resp.json()["id"]
        
        # Delete it
        del_resp = self.session.delete(f"{BASE_URL}/api/recurring-invoices/{ri_id}")
        assert del_resp.status_code == 200, f"Expected 200, got {del_resp.status_code}"
        
        # Verify it's gone
        get_resp = self.session.get(f"{BASE_URL}/api/recurring-invoices/{ri_id}")
        assert get_resp.status_code == 404, "Deleted RI should return 404"
        print(f"✓ Deleted recurring invoice {ri_id}")
    
    def test_delete_nonexistent_recurring_invoice(self):
        """DELETE /api/recurring-invoices/{id} - should return 404 for nonexistent"""
        resp = self.session.delete(f"{BASE_URL}/api/recurring-invoices/ri-nonexistent-xyz")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("✓ Delete nonexistent recurring invoice returns 404")


class TestInvoiceTemplates:
    """Test invoice templates endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth token for all tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json=TEST_CREDENTIALS)
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip(f"Auth failed: {login_resp.status_code}")
    
    def test_get_invoice_templates(self):
        """GET /api/invoice-templates - should return 5 seeded templates"""
        resp = self.session.get(f"{BASE_URL}/api/invoice-templates")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Response should be a list"
        assert len(data) >= 5, f"Expected at least 5 templates, got {len(data)}"
        # Verify structure
        tpl = data[0]
        assert "id" in tpl, "Missing id field"
        assert "name" in tpl, "Missing name field"
        assert "line_items" in tpl, "Missing line_items field"
        assert "category" in tpl, "Missing category field"
        print(f"✓ GET /api/invoice-templates returned {len(data)} templates")
    
    def test_create_invoice_template(self):
        """POST /api/invoice-templates - should create a new template with line items"""
        payload = {
            "name": "TEST_CustomTemplate",
            "description": "Test template for automation",
            "category": "consulting",
            "tax_rate": 10,
            "payment_terms": "net_14",
            "notes": "Test notes",
            "line_items": [
                {"description": "Consulting Hour", "quantity": 1, "rate": 150, "amount": 150},
                {"description": "Travel Expense", "quantity": 1, "rate": 50, "amount": 50}
            ]
        }
        resp = self.session.post(f"{BASE_URL}/api/invoice-templates", json=payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "id" in data, "Missing id in response"
        assert data["name"] == "TEST_CustomTemplate", "Name mismatch"
        assert data["category"] == "consulting", "Category mismatch"
        assert len(data["line_items"]) == 2, "Should have 2 line items"
        assert data["usage_count"] == 0, "New template should have 0 usage count"
        print(f"✓ Created template {data['id']}: {data['name']}")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/invoice-templates/{data['id']}")
    
    def test_apply_template_to_client(self):
        """POST /api/invoice-templates/{id}/apply - should create recurring invoice from template"""
        # First get a template
        templates_resp = self.session.get(f"{BASE_URL}/api/invoice-templates")
        assert templates_resp.status_code == 200
        templates = templates_resp.json()
        assert len(templates) > 0, "No templates available"
        template_id = templates[0]["id"]
        template_name = templates[0]["name"]
        
        # Apply template to a client
        apply_payload = {
            "client_id": "client-apply-test",
            "client_name": "TEST_ApplyTemplateClient",
            "frequency": "monthly",
            "start_date": datetime.now().strftime("%Y-%m-%d"),
            "auto_send": False
        }
        resp = self.session.post(f"{BASE_URL}/api/invoice-templates/{template_id}/apply", json=apply_payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "id" in data, "Missing id in response"
        assert data["client_name"] == "TEST_ApplyTemplateClient", "Client name mismatch"
        assert data["frequency"] == "monthly", "Frequency mismatch"
        assert data["status"] == "active", "Applied template should create active RI"
        print(f"✓ Applied template {template_id} to create recurring invoice {data['id']}")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/recurring-invoices/{data['id']}")
    
    def test_delete_invoice_template(self):
        """DELETE /api/invoice-templates/{id} - should delete a template"""
        # Create one to delete
        create_payload = {
            "name": "TEST_DeleteTemplate",
            "description": "To be deleted",
            "category": "general",
            "line_items": [{"description": "Item", "quantity": 1, "rate": 100, "amount": 100}]
        }
        create_resp = self.session.post(f"{BASE_URL}/api/invoice-templates", json=create_payload)
        assert create_resp.status_code == 200
        tpl_id = create_resp.json()["id"]
        
        # Delete it
        del_resp = self.session.delete(f"{BASE_URL}/api/invoice-templates/{tpl_id}")
        assert del_resp.status_code == 200, f"Expected 200, got {del_resp.status_code}"
        print(f"✓ Deleted template {tpl_id}")
    
    def test_delete_nonexistent_template(self):
        """DELETE /api/invoice-templates/{id} - should return 404 for nonexistent"""
        resp = self.session.delete(f"{BASE_URL}/api/invoice-templates/it-nonexistent-xyz")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("✓ Delete nonexistent template returns 404")


class TestRecurringInvoicesHistory:
    """Test generation history endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth token for all tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json=TEST_CREDENTIALS)
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip(f"Auth failed: {login_resp.status_code}")
    
    def test_get_generation_history(self):
        """GET /api/recurring-invoices/{id}/history - should return generation history"""
        resp = self.session.get(f"{BASE_URL}/api/recurring-invoices/ri-001/history")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "History should be a list"
        print(f"✓ GET /api/recurring-invoices/ri-001/history returned {len(data)} entries")
    
    def test_get_history_nonexistent(self):
        """GET /api/recurring-invoices/{id}/history - should return 404 for nonexistent"""
        resp = self.session.get(f"{BASE_URL}/api/recurring-invoices/ri-nonexistent/history")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("✓ GET history for nonexistent RI returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
