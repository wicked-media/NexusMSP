"""
Iteration 9 Backend Tests - Phase 2 Features
Tests for: Time Tracking, Assets, Leads/CRM, Projects, Dashboard, Invoices, Settings
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSetup:
    """Setup and authentication tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.json().get("token")
    
    @pytest.fixture
    def auth_headers(self, auth_token):
        """Headers with auth token"""
        return {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }


class TestAssetStats(TestSetup):
    """Test Asset Stats endpoint (route fix verification)"""
    
    def test_assets_stats_returns_200(self, auth_headers):
        """GET /api/assets/stats - should return stats (route fix verified)"""
        response = requests.get(f"{BASE_URL}/api/assets/stats", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        # Verify required fields
        assert "total" in data, "Missing 'total' field"
        assert "active" in data, "Missing 'active' field"
        assert "total_value" in data, "Missing 'total_value' field"
        assert "warranty_expiring_soon" in data, "Missing 'warranty_expiring_soon' field"
        assert "warranty_expired" in data, "Missing 'warranty_expired' field"
        print(f"Assets stats: total={data['total']}, active={data['active']}, value=${data['total_value']}")
    
    def test_assets_expiring_returns_200(self, auth_headers):
        """GET /api/assets/expiring - should return assets with warranty info"""
        response = requests.get(f"{BASE_URL}/api/assets/expiring", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        print(f"Expiring assets count: {len(data)}")
        # Check structure if there are any expiring assets
        if len(data) > 0:
            assert "days_remaining" in data[0], "Missing 'days_remaining' field"
            assert "is_expired" in data[0], "Missing 'is_expired' field"


class TestInvoiceStats(TestSetup):
    """Test Invoice Stats endpoint (route fix verification)"""
    
    def test_invoices_stats_summary_returns_200(self, auth_headers):
        """GET /api/invoices/stats/summary - should return stats (route fix verified)"""
        response = requests.get(f"{BASE_URL}/api/invoices/stats/summary", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        # Verify required fields
        assert "total" in data, "Missing 'total' field"
        assert "paid" in data, "Missing 'paid' field"
        assert "unpaid" in data, "Missing 'unpaid' field"
        assert "overdue" in data, "Missing 'overdue' field"
        assert "total_revenue" in data, "Missing 'total_revenue' field"
        assert "total_collected" in data, "Missing 'total_collected' field"
        assert "total_outstanding" in data, "Missing 'total_outstanding' field"
        print(f"Invoice stats: total={data['total']}, paid={data['paid']}, unpaid={data['unpaid']}, overdue={data['overdue']}")


class TestTimeTracking(TestSetup):
    """Test Time Tracking endpoints"""
    
    def test_time_entries_weekly_summary_returns_200(self, auth_headers):
        """GET /api/time-entries/weekly-summary - returns weekly time breakdown"""
        response = requests.get(f"{BASE_URL}/api/time-entries/weekly-summary", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        # Verify required fields
        assert "week_start" in data, "Missing 'week_start' field"
        assert "total_hours" in data, "Missing 'total_hours' field"
        assert "billable_hours" in data, "Missing 'billable_hours' field"
        assert "non_billable_hours" in data, "Missing 'non_billable_hours' field"
        assert "by_user" in data, "Missing 'by_user' field"
        assert "by_day" in data, "Missing 'by_day' field"
        assert "total_entries" in data, "Missing 'total_entries' field"
        print(f"Weekly summary: total_hours={data['total_hours']}, billable={data['billable_hours']}, entries={data['total_entries']}")
    
    def test_time_entries_list_returns_200(self, auth_headers):
        """GET /api/time-entries - returns list of time entries"""
        response = requests.get(f"{BASE_URL}/api/time-entries", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        print(f"Time entries count: {len(data)}")


class TestDashboardEnhanced(TestSetup):
    """Test Dashboard Enhanced Stats endpoint"""
    
    def test_dashboard_enhanced_stats_returns_all_fields(self, auth_headers):
        """GET /api/dashboard/enhanced-stats - returns all 13 operational stats"""
        response = requests.get(f"{BASE_URL}/api/dashboard/enhanced-stats", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        # Verify all 13+ required fields
        required_fields = [
            "open_tickets", "total_devices", "online_devices", "total_clients",
            "total_revenue", "total_collected", "outstanding", "unpaid_invoices",
            "overdue_invoices", "no_notes_tickets", "low_stock_products",
            "pending_purchase_orders", "sla_breaches", "total_mrr"
        ]
        for field in required_fields:
            assert field in data, f"Missing '{field}' field"
            assert isinstance(data[field], (int, float)), f"'{field}' should be numeric"
        print(f"Dashboard stats: open_tickets={data['open_tickets']}, no_notes={data['no_notes_tickets']}, sla_breaches={data['sla_breaches']}")


class TestInvoiceCRUD(TestSetup):
    """Test Invoice CRUD operations"""
    
    def test_create_invoice_with_line_items(self, auth_headers):
        """POST /api/invoices - creates invoice with line items and tax calculation"""
        # First get a client
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=auth_headers)
        assert clients_resp.status_code == 200
        clients = clients_resp.json()
        assert len(clients) > 0, "No clients found for invoice test"
        client_id = clients[0]["id"]
        
        invoice_data = {
            "client_id": client_id,
            "due_date": (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d"),
            "tax_rate": 10.0,
            "line_items": [
                {"description": "Test Service", "quantity": 2, "unit_price": 100.0, "total": 200.0},
                {"description": "Test Product", "quantity": 1, "unit_price": 50.0, "total": 50.0}
            ],
            "notes": "Test invoice for iteration 9"
        }
        response = requests.post(f"{BASE_URL}/api/invoices", json=invoice_data, headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify tax calculation
        assert data["subtotal"] == 250.0, f"Expected subtotal 250, got {data['subtotal']}"
        assert data["tax"] == 25.0, f"Expected tax 25 (10% of 250), got {data['tax']}"
        assert data["total"] == 275.0, f"Expected total 275, got {data['total']}"
        assert data["payment_status"] == "unpaid", f"Expected unpaid status, got {data['payment_status']}"
        
        print(f"Created invoice: {data['invoice_number']}, subtotal=${data['subtotal']}, tax=${data['tax']}, total=${data['total']}")
        return data["id"]
    
    def test_record_payment_changes_status(self, auth_headers):
        """POST /api/invoices/{id}/record-payment - verify payment status changes"""
        # Create a new invoice for this test
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=auth_headers)
        clients = clients_resp.json()
        client_id = clients[0]["id"]
        
        invoice_data = {
            "client_id": client_id,
            "due_date": (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d"),
            "tax_rate": 0,
            "line_items": [{"description": "Payment test", "quantity": 1, "unit_price": 100.0, "total": 100.0}],
        }
        create_resp = requests.post(f"{BASE_URL}/api/invoices", json=invoice_data, headers=auth_headers)
        assert create_resp.status_code == 200
        invoice_id = create_resp.json()["id"]
        
        # Record partial payment
        payment_resp = requests.post(
            f"{BASE_URL}/api/invoices/{invoice_id}/record-payment",
            json={"amount": 50, "method": "cash", "reference": "TEST-PARTIAL"},
            headers=auth_headers
        )
        assert payment_resp.status_code == 200
        assert payment_resp.json()["new_balance"] == 50, "Expected remaining balance of 50"
        
        # Check invoice status changed to partial
        invoice_resp = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}", headers=auth_headers)
        assert invoice_resp.status_code == 200
        assert invoice_resp.json()["payment_status"] == "partial", "Expected 'partial' status after partial payment"
        
        # Record remaining payment
        payment_resp2 = requests.post(
            f"{BASE_URL}/api/invoices/{invoice_id}/record-payment",
            json={"amount": 50, "method": "cash", "reference": "TEST-FINAL"},
            headers=auth_headers
        )
        assert payment_resp2.status_code == 200
        assert payment_resp2.json()["new_balance"] == 0, "Expected remaining balance of 0"
        
        # Check invoice status changed to paid
        invoice_resp2 = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}", headers=auth_headers)
        assert invoice_resp2.status_code == 200
        assert invoice_resp2.json()["payment_status"] == "paid", "Expected 'paid' status after full payment"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/invoices/{invoice_id}", headers=auth_headers)
        print("Payment flow test passed: unpaid -> partial -> paid")


class TestLeadsCRM(TestSetup):
    """Test Leads/CRM endpoints"""
    
    def test_leads_list_returns_200(self, auth_headers):
        """GET /api/leads - returns list of leads"""
        response = requests.get(f"{BASE_URL}/api/leads", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        print(f"Leads count: {len(data)}")
        # Check structure if there are leads
        if len(data) > 0:
            lead = data[0]
            assert "pipeline_stage" in lead or "status" in lead, "Missing pipeline_stage or status field"
    
    def test_create_lead(self, auth_headers):
        """POST /api/leads - creates a new lead"""
        lead_data = {
            "company_name": "TEST_Lead Corp",
            "contact_name": "Test Contact",
            "email": "test@testlead.com",
            "phone": "555-1234",
            "source": "website",
            "estimated_value": 5000.0,
            "notes": "Test lead from iteration 9"
        }
        response = requests.post(f"{BASE_URL}/api/leads", json=lead_data, headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["company_name"] == "TEST_Lead Corp"
        assert data["status"] == "new" or data.get("pipeline_stage") == 1
        print(f"Created lead: {data['company_name']}, status={data.get('status')}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/leads/{data['id']}", headers=auth_headers)


class TestProjects(TestSetup):
    """Test Projects endpoints"""
    
    def test_projects_list_returns_200(self, auth_headers):
        """GET /api/projects - returns list of projects"""
        response = requests.get(f"{BASE_URL}/api/projects", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        print(f"Projects count: {len(data)}")
    
    def test_project_tasks_returns_200(self, auth_headers):
        """GET /api/project-tasks - returns list of project tasks"""
        response = requests.get(f"{BASE_URL}/api/project-tasks", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        print(f"Project tasks count: {len(data)}")


class TestSettings(TestSetup):
    """Test Settings endpoints"""
    
    def test_no_notes_threshold_get(self, auth_headers):
        """GET /api/settings/no-notes-threshold - returns threshold settings"""
        response = requests.get(f"{BASE_URL}/api/settings/no-notes-threshold", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "enabled" in data, "Missing 'enabled' field"
        assert "threshold_hours" in data, "Missing 'threshold_hours' field"
        print(f"No-notes threshold: enabled={data['enabled']}, hours={data['threshold_hours']}")
    
    def test_xero_settings_get(self, auth_headers):
        """GET /api/settings/xero - returns Xero integration settings"""
        response = requests.get(f"{BASE_URL}/api/settings/xero", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        print(f"Xero settings: connected={data.get('connected', False)}")


class TestRegressionProducts(TestSetup):
    """Regression tests for Products"""
    
    def test_products_crud_still_works(self, auth_headers):
        """GET /api/products - regression test"""
        response = requests.get(f"{BASE_URL}/api/products", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        print(f"Products count: {len(data)}")


class TestRegressionPurchaseOrders(TestSetup):
    """Regression tests for Purchase Orders"""
    
    def test_purchase_orders_still_works(self, auth_headers):
        """GET /api/purchase-orders - regression test"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        print(f"Purchase orders count: {len(data)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
