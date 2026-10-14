"""
Iteration 38: Testing 6 major features
1. Estimates CRUD - Create, list, view, status changes, convert to invoice, delete
2. Unified Tickets - Type filters (SLA, Workshop, Cabling/WISP) 
3. Ticket Worksheets - Add items, check/uncheck with audit trail
4. Job Numbering Configuration in Settings
5. Splynx Non-Payment UI Tab
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json().get("token")

@pytest.fixture(scope="module")
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============== ESTIMATES CRUD TESTS ==============

class TestEstimatesCRUD:
    """Test Estimates module - CRUD operations and lifecycle"""
    
    created_estimate_id = None
    
    def test_get_estimates_list(self, headers):
        """GET /api/estimates - list all estimates"""
        response = requests.get(f"{BASE_URL}/api/estimates", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} estimates")
    
    def test_get_estimates_stats(self, headers):
        """GET /api/estimates/stats/summary - get estimate stats"""
        response = requests.get(f"{BASE_URL}/api/estimates/stats/summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "by_status" in data
        assert "total_value" in data
        assert "approved_value" in data
        print(f"Stats: {data['total']} estimates, ${data['total_value']} total value")
    
    def test_create_estimate(self, headers):
        """POST /api/estimates - create new estimate"""
        # First get a client
        clients_res = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = clients_res.json()
        client_id = clients[0]["id"] if clients else ""
        client_name = clients[0]["name"] if clients else "Test Client"
        
        payload = {
            "title": "TEST_Estimate_Iteration38",
            "description": "Test estimate created during iteration 38 testing",
            "client_id": client_id,
            "client_name": client_name,
            "client_email": "test@example.com",
            "line_items": [
                {"description": "IT Support Service", "quantity": 5, "unit_price": 100},
                {"description": "Hardware Installation", "quantity": 2, "unit_price": 250}
            ],
            "tax_rate": 10,
            "discount": 0,
            "valid_until": "2026-02-28",
            "notes": "Test notes for estimate"
        }
        
        response = requests.post(f"{BASE_URL}/api/estimates", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Validate response structure
        assert "id" in data
        assert "estimate_number" in data
        assert data["estimate_number"].startswith("EST-")
        assert data["status"] == "draft"
        assert data["title"] == "TEST_Estimate_Iteration38"
        
        # Validate calculated values
        # Subtotal: 5*100 + 2*250 = 500 + 500 = 1000
        # Tax: 1000 * 10% = 100
        # Total: 1100
        assert data["subtotal"] == 1000.0
        assert data["tax_amount"] == 100.0
        assert data["total"] == 1100.0
        
        TestEstimatesCRUD.created_estimate_id = data["id"]
        print(f"Created estimate: {data['estimate_number']} - ${data['total']}")
    
    def test_get_estimate_detail(self, headers):
        """GET /api/estimates/{id} - get single estimate"""
        est_id = TestEstimatesCRUD.created_estimate_id
        if not est_id:
            pytest.skip("No estimate created")
        
        response = requests.get(f"{BASE_URL}/api/estimates/{est_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == est_id
        assert data["title"] == "TEST_Estimate_Iteration38"
        assert len(data["line_items"]) == 2
        print(f"Retrieved estimate detail: {data['estimate_number']}")
    
    def test_update_estimate_status_to_published(self, headers):
        """PUT /api/estimates/{id}/status - change from draft to published"""
        est_id = TestEstimatesCRUD.created_estimate_id
        if not est_id:
            pytest.skip("No estimate created")
        
        response = requests.put(f"{BASE_URL}/api/estimates/{est_id}/status", 
                                json={"status": "published"}, headers=headers)
        assert response.status_code == 200
        
        # Verify status changed
        get_res = requests.get(f"{BASE_URL}/api/estimates/{est_id}", headers=headers)
        assert get_res.json()["status"] == "published"
        assert get_res.json()["published_at"] is not None
        print("Status changed to: published")
    
    def test_update_estimate_status_to_sent(self, headers):
        """PUT /api/estimates/{id}/status - change from published to sent"""
        est_id = TestEstimatesCRUD.created_estimate_id
        if not est_id:
            pytest.skip("No estimate created")
        
        response = requests.put(f"{BASE_URL}/api/estimates/{est_id}/status",
                                json={"status": "sent"}, headers=headers)
        assert response.status_code == 200
        
        get_res = requests.get(f"{BASE_URL}/api/estimates/{est_id}", headers=headers)
        assert get_res.json()["status"] == "sent"
        assert get_res.json()["sent_at"] is not None
        print("Status changed to: sent")
    
    def test_update_estimate_status_to_approved(self, headers):
        """PUT /api/estimates/{id}/status - change to approved"""
        est_id = TestEstimatesCRUD.created_estimate_id
        if not est_id:
            pytest.skip("No estimate created")
        
        response = requests.put(f"{BASE_URL}/api/estimates/{est_id}/status",
                                json={"status": "approved"}, headers=headers)
        assert response.status_code == 200
        
        get_res = requests.get(f"{BASE_URL}/api/estimates/{est_id}", headers=headers)
        assert get_res.json()["status"] == "approved"
        assert get_res.json()["approved_at"] is not None
        print("Status changed to: approved")
    
    def test_get_estimate_audit_log(self, headers):
        """GET /api/estimates/{id}/audit-log - verify audit trail"""
        est_id = TestEstimatesCRUD.created_estimate_id
        if not est_id:
            pytest.skip("No estimate created")
        
        response = requests.get(f"{BASE_URL}/api/estimates/{est_id}/audit-log", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 4  # created + 3 status changes
        actions = [log["action"] for log in data]
        assert "created" in actions
        print(f"Audit log has {len(data)} entries")
    
    def test_convert_estimate_to_invoice(self, headers):
        """POST /api/estimates/{id}/convert-to-invoice - convert approved estimate"""
        est_id = TestEstimatesCRUD.created_estimate_id
        if not est_id:
            pytest.skip("No estimate created")
        
        response = requests.post(f"{BASE_URL}/api/estimates/{est_id}/convert-to-invoice", 
                                 json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "invoice_id" in data
        assert "message" in data
        assert "INV-" in data["message"]
        
        # Verify estimate status changed to converted
        get_res = requests.get(f"{BASE_URL}/api/estimates/{est_id}", headers=headers)
        assert get_res.json()["status"] == "converted"
        assert get_res.json()["converted_to_invoice"] is not None
        print(f"Converted to invoice: {data['message']}")
    
    def test_delete_estimate(self, headers):
        """DELETE /api/estimates/{id} - delete test estimate"""
        est_id = TestEstimatesCRUD.created_estimate_id
        if not est_id:
            pytest.skip("No estimate created")
        
        response = requests.delete(f"{BASE_URL}/api/estimates/{est_id}", headers=headers)
        assert response.status_code == 200
        
        # Verify deleted
        get_res = requests.get(f"{BASE_URL}/api/estimates/{est_id}", headers=headers)
        assert get_res.status_code == 404
        print("Estimate deleted successfully")


# ============== TICKET WORKSHEETS TESTS ==============

class TestTicketWorksheets:
    """Test ticket worksheet functionality - checklist items with audit trail"""
    
    ticket_id = None
    worksheet_item_id = None
    
    def test_get_ticket_for_worksheets(self, headers):
        """Get a ticket to test worksheets on"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200
        tickets = response.json()
        assert len(tickets) > 0, "Need at least 1 ticket to test worksheets"
        TestTicketWorksheets.ticket_id = tickets[0]["id"]
        print(f"Using ticket: {tickets[0].get('ticket_number', tickets[0]['id'])}")
    
    def test_get_empty_worksheet(self, headers):
        """GET /api/tickets/{id}/worksheet - get worksheet (may be empty)"""
        tid = TestTicketWorksheets.ticket_id
        if not tid:
            pytest.skip("No ticket found")
        
        response = requests.get(f"{BASE_URL}/api/tickets/{tid}/worksheet", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Worksheet has {len(data)} items")
    
    def test_add_worksheet_item(self, headers):
        """POST /api/tickets/{id}/worksheet - add checklist item"""
        tid = TestTicketWorksheets.ticket_id
        if not tid:
            pytest.skip("No ticket found")
        
        response = requests.post(f"{BASE_URL}/api/tickets/{tid}/worksheet",
                                 json={"item": "TEST_Verify issue reproduced"}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["item"] == "TEST_Verify issue reproduced"
        assert data["checked"] == False
        assert data["added_by"] is not None
        TestTicketWorksheets.worksheet_item_id = data["id"]
        print(f"Added worksheet item: {data['id']}")
    
    def test_check_worksheet_item(self, headers):
        """POST /api/tickets/{id}/worksheet/check - check item with audit"""
        tid = TestTicketWorksheets.ticket_id
        item_id = TestTicketWorksheets.worksheet_item_id
        if not tid or not item_id:
            pytest.skip("No ticket or worksheet item")
        
        response = requests.post(f"{BASE_URL}/api/tickets/{tid}/worksheet/check",
                                 json={"item_id": item_id, "checked": True}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "completed" in data
        assert "total" in data
        
        # Verify item is now checked
        get_res = requests.get(f"{BASE_URL}/api/tickets/{tid}/worksheet", headers=headers)
        items = get_res.json()
        checked_item = next((i for i in items if i["id"] == item_id), None)
        assert checked_item is not None
        assert checked_item["checked"] == True
        assert checked_item["checked_by_name"] is not None
        assert checked_item["checked_at"] is not None
        print(f"Item checked by: {checked_item['checked_by_name']}")
    
    def test_uncheck_worksheet_item(self, headers):
        """POST /api/tickets/{id}/worksheet/check - uncheck item"""
        tid = TestTicketWorksheets.ticket_id
        item_id = TestTicketWorksheets.worksheet_item_id
        if not tid or not item_id:
            pytest.skip("No ticket or worksheet item")
        
        response = requests.post(f"{BASE_URL}/api/tickets/{tid}/worksheet/check",
                                 json={"item_id": item_id, "checked": False}, headers=headers)
        assert response.status_code == 200
        print("Item unchecked successfully")
    
    def test_get_worksheet_templates(self, headers):
        """GET /api/worksheet-templates - get default templates"""
        response = requests.get(f"{BASE_URL}/api/worksheet-templates", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "sla" in data
        assert "workshop" in data
        assert "cabling_wisp" in data
        assert len(data["sla"]) >= 5  # At least 5 SLA items
        assert len(data["workshop"]) >= 6  # At least 6 workshop items
        print(f"Templates: SLA({len(data['sla'])}), Workshop({len(data['workshop'])}), Cabling({len(data['cabling_wisp'])})")


# ============== JOB NUMBERING SETTINGS TESTS ==============

class TestJobNumberingSettings:
    """Test job numbering configuration in settings"""
    
    def test_get_job_numbering_settings(self, headers):
        """GET /api/settings/job-numbering - get current prefixes"""
        response = requests.get(f"{BASE_URL}/api/settings/job-numbering", headers=headers)
        assert response.status_code == 200
        data = response.json()
        # May have default values or existing config
        assert isinstance(data, dict)
        print(f"Current job numbering: {data}")
    
    def test_save_job_numbering_settings(self, headers):
        """PUT /api/settings/job-numbering - save prefix configuration"""
        payload = {
            "sla_prefix": "SLA-",
            "workshop_prefix": "WS-",
            "cabling_prefix": "CW-"
        }
        response = requests.put(f"{BASE_URL}/api/settings/job-numbering", json=payload, headers=headers)
        assert response.status_code == 200
        
        # Verify saved
        get_res = requests.get(f"{BASE_URL}/api/settings/job-numbering", headers=headers)
        data = get_res.json()
        assert data.get("sla_prefix") == "SLA-"
        assert data.get("workshop_prefix") == "WS-"
        assert data.get("cabling_prefix") == "CW-"
        print("Job numbering settings saved successfully")


# ============== SPLYNX NON-PAYMENT TESTS ==============

class TestSplynxNonPayment:
    """Test Splynx non-payment endpoint (MOCKED integration)"""
    
    def test_get_splynx_overview(self, headers):
        """GET /api/splynx/overview - ISP health overview"""
        response = requests.get(f"{BASE_URL}/api/splynx/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        # Mocked data structure
        assert "linked_clients" in data or isinstance(data, dict)
        print(f"Splynx overview: {data.get('linked_clients', 0)} linked clients")
    
    def test_get_splynx_non_payment(self, headers):
        """GET /api/splynx/non-payment - non-payment tracker"""
        response = requests.get(f"{BASE_URL}/api/splynx/non-payment", headers=headers)
        assert response.status_code == 200
        data = response.json()
        # Should return overdue customers data or empty
        assert data is None or isinstance(data, dict)
        if data:
            print(f"Non-payment data: {data.get('total_overdue_count', 0)} overdue customers")
        else:
            print("Non-payment data: empty/null (mocked)")


# ============== UNIFIED TICKETS TESTS ==============

class TestUnifiedTickets:
    """Test unified tickets with type filtering (SLA, Workshop, Cabling)"""
    
    def test_get_tickets(self, headers):
        """GET /api/tickets - SLA tickets list"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"SLA tickets: {len(data)}")
    
    def test_get_workshop_jobs(self, headers):
        """GET /api/workshop/jobs - workshop jobs list"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Workshop jobs: {len(data)}")
    
    def test_get_workshop_stats(self, headers):
        """GET /api/workshop/stats - workshop statistics"""
        response = requests.get(f"{BASE_URL}/api/workshop/stats", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        print(f"Workshop stats: {data}")
    
    def test_get_field_jobs(self, headers):
        """GET /api/field-jobs - cabling/WISP jobs list"""
        response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Field/Cabling jobs: {len(data)}")
    
    def test_get_field_jobs_stats(self, headers):
        """GET /api/field-jobs/stats/summary - field job statistics"""
        response = requests.get(f"{BASE_URL}/api/field-jobs/stats/summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        print(f"Field jobs stats: {data}")


# ============== REGRESSION TESTS ==============

class TestRegression:
    """Regression tests for existing functionality"""
    
    def test_health_check(self, headers):
        """GET /api/ - API health check"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "operational"
        print(f"API version: {data.get('message', 'unknown')}")
    
    def test_clients_list(self, headers):
        """GET /api/clients - clients list"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Clients: {len(data)}")
    
    def test_invoices_list(self, headers):
        """GET /api/invoices - invoices list (for convert estimate)"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Invoices: {len(data)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
