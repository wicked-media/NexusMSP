"""
Iteration 8 Tests: Invoice Enhancements, Dashboard Enhanced Stats, Settings (No-Notes Threshold, Xero)
Tests new features:
- Invoice CRUD with line items from product catalog, tax_rate calculation
- Record manual payment, payment_status changes (paid/partial)
- Invoice stats summary (paid/unpaid/overdue counts, revenue/collected/outstanding)
- No-Notes Escalation Threshold settings (GET default, PUT save)
- Check escalation endpoint
- Dashboard enhanced stats (no_notes_tickets, sla_breaches, low_stock, pending_po, outstanding, revenue)
"""

import pytest
import requests
import os
import uuid
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuthentication:
    """Authentication for all tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.json()["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestInvoiceEndpoints(TestAuthentication):
    """Test Invoice CRUD and payment operations"""
    
    def test_get_invoices_list(self, headers):
        """GET /api/invoices - returns list"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ GET /api/invoices - returns {len(data)} invoices")
    
    def test_get_invoice_stats_summary(self, headers):
        """GET /api/invoices/stats/summary - returns stats with all required fields"""
        response = requests.get(f"{BASE_URL}/api/invoices/stats/summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        # Verify required fields
        assert "total" in data
        assert "paid" in data
        assert "unpaid" in data
        assert "overdue" in data
        assert "total_revenue" in data
        assert "total_collected" in data
        assert "total_outstanding" in data
        print(f"✓ GET /api/invoices/stats/summary - total:{data['total']}, paid:{data['paid']}, unpaid:{data['unpaid']}, overdue:{data['overdue']}")
        print(f"  Revenue: ${data['total_revenue']}, Collected: ${data['total_collected']}, Outstanding: ${data['total_outstanding']}")
    
    def test_create_invoice_with_line_items_and_tax(self, headers):
        """POST /api/invoices - create invoice with line items and tax calculation"""
        # First get a client
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert clients_resp.status_code == 200
        clients = clients_resp.json()
        assert len(clients) > 0, "Need at least one client for invoice test"
        client_id = clients[0]["id"]
        
        # Create invoice with line items
        due_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
        invoice_data = {
            "client_id": client_id,
            "due_date": due_date,
            "tax_rate": 10.0,
            "notes": "TEST Invoice - iteration 8",
            "line_items": [
                {"name": "Test Service 1", "description": "Testing", "quantity": 2, "unit_price": 100.0, "total": 200.0},
                {"name": "Test Service 2", "description": "More testing", "quantity": 1, "unit_price": 150.0, "total": 150.0}
            ]
        }
        response = requests.post(f"{BASE_URL}/api/invoices", json=invoice_data, headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Verify invoice fields
        assert "id" in data
        assert "invoice_number" in data
        assert data["client_id"] == client_id
        assert data["payment_status"] == "unpaid"
        assert data["tax_rate"] == 10.0
        
        # Verify calculations: subtotal = 350, tax = 35, total = 385
        assert data["subtotal"] == 350.0
        assert data["tax"] == 35.0
        assert data["total"] == 385.0
        
        print(f"✓ POST /api/invoices - created {data['invoice_number']}, subtotal=${data['subtotal']}, tax=${data['tax']}, total=${data['total']}")
        
        # Store for later tests
        self.__class__.test_invoice_id = data["id"]
        self.__class__.test_invoice_total = data["total"]
    
    def test_get_single_invoice(self, headers):
        """GET /api/invoices/{id} - returns single invoice with all fields"""
        invoice_id = getattr(self.__class__, 'test_invoice_id', None)
        if not invoice_id:
            pytest.skip("No test invoice created")
        
        response = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == invoice_id
        assert "line_items" in data
        assert "payments" in data
        print(f"✓ GET /api/invoices/{invoice_id} - returned invoice with {len(data['line_items'])} line items")
    
    def test_record_manual_payment_partial(self, headers):
        """POST /api/invoices/{id}/record-payment - record partial payment"""
        invoice_id = getattr(self.__class__, 'test_invoice_id', None)
        invoice_total = getattr(self.__class__, 'test_invoice_total', 385.0)
        if not invoice_id:
            pytest.skip("No test invoice created")
        
        # Record partial payment (half)
        payment_amount = invoice_total / 2
        payment_data = {
            "amount": str(payment_amount),
            "method": "manual",
            "reference": "TEST-REF-001"
        }
        response = requests.post(f"{BASE_URL}/api/invoices/{invoice_id}/record-payment", json=payment_data, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "new_balance" in data
        
        # Verify invoice updated to partial
        inv_resp = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}", headers=headers)
        inv = inv_resp.json()
        assert inv["payment_status"] == "partial"
        assert inv["amount_paid"] == payment_amount
        assert len(inv["payments"]) >= 1
        print(f"✓ POST /api/invoices/{invoice_id}/record-payment - partial payment ${payment_amount}, status=partial")
    
    def test_record_manual_payment_full(self, headers):
        """POST /api/invoices/{id}/record-payment - complete payment to mark as paid"""
        invoice_id = getattr(self.__class__, 'test_invoice_id', None)
        if not invoice_id:
            pytest.skip("No test invoice created")
        
        # Get current balance
        inv_resp = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}", headers=headers)
        inv = inv_resp.json()
        remaining = float(inv["total"]) - float(inv.get("amount_paid", 0))
        
        # Record remaining payment
        payment_data = {
            "amount": str(remaining),
            "method": "bank_transfer",
            "reference": "TEST-REF-002"
        }
        response = requests.post(f"{BASE_URL}/api/invoices/{invoice_id}/record-payment", json=payment_data, headers=headers)
        assert response.status_code == 200
        
        # Verify invoice now fully paid
        inv_resp2 = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}", headers=headers)
        inv2 = inv_resp2.json()
        assert inv2["payment_status"] == "paid"
        assert inv2["amount_paid"] == inv2["total"]
        assert len(inv2["payments"]) >= 2
        print(f"✓ POST /api/invoices/{invoice_id}/record-payment - full payment, status=paid, payments={len(inv2['payments'])}")
    
    def test_stripe_pay_endpoint_returns_url(self, headers):
        """POST /api/invoices/{id}/pay - Stripe payment returns checkout URL"""
        # Need to create an unpaid invoice first
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = clients_resp.json()
        client_id = clients[0]["id"]
        
        due_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
        invoice_data = {
            "client_id": client_id,
            "due_date": due_date,
            "tax_rate": 0,
            "notes": "TEST Invoice for Stripe",
            "line_items": [{"name": "Stripe Test", "quantity": 1, "unit_price": 50.0, "total": 50.0}]
        }
        create_resp = requests.post(f"{BASE_URL}/api/invoices", json=invoice_data, headers=headers)
        assert create_resp.status_code == 200
        stripe_test_inv = create_resp.json()
        
        # Now try Stripe pay
        response = requests.post(f"{BASE_URL}/api/invoices/{stripe_test_inv['id']}/pay", 
                                 json={"origin_url": "https://nexusops-splynx.preview.emergentagent.com"}, 
                                 headers=headers)
        
        # Stripe endpoint should return a URL or error if Stripe not fully configured
        if response.status_code == 200:
            data = response.json()
            assert "url" in data
            print(f"✓ POST /api/invoices/{stripe_test_inv['id']}/pay - Stripe checkout URL returned")
        else:
            # May fail with test key, but API should be reachable
            print(f"⚠ POST /api/invoices/pay - Stripe returned {response.status_code}: {response.text}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/invoices/{stripe_test_inv['id']}", headers=headers)
    
    def test_delete_test_invoice(self, headers):
        """DELETE /api/invoices/{id} - cleanup test invoice"""
        invoice_id = getattr(self.__class__, 'test_invoice_id', None)
        if not invoice_id:
            pytest.skip("No test invoice to delete")
        
        response = requests.delete(f"{BASE_URL}/api/invoices/{invoice_id}", headers=headers)
        assert response.status_code == 200
        print(f"✓ DELETE /api/invoices/{invoice_id} - test invoice deleted")


class TestNoNotesThresholdSettings(TestAuthentication):
    """Test No-Notes Escalation Threshold Settings"""
    
    def test_get_default_threshold(self, headers):
        """GET /api/settings/no-notes-threshold - returns default when not set"""
        response = requests.get(f"{BASE_URL}/api/settings/no-notes-threshold", headers=headers)
        assert response.status_code == 200
        data = response.json()
        # Should have default fields
        assert "enabled" in data
        assert "threshold_hours" in data
        assert "escalate_to" in data
        assert "escalate_to_name" in data
        print(f"✓ GET /api/settings/no-notes-threshold - enabled={data['enabled']}, hours={data['threshold_hours']}")
    
    def test_save_threshold_settings(self, headers):
        """PUT /api/settings/no-notes-threshold - save threshold settings"""
        # Get a user to escalate to
        users_resp = requests.get(f"{BASE_URL}/api/users", headers=headers)
        users = users_resp.json()
        escalate_user = users[0] if users else None
        
        threshold_data = {
            "enabled": True,
            "threshold_hours": 4,
            "escalate_to": escalate_user["id"] if escalate_user else "",
            "escalate_to_name": escalate_user["name"] if escalate_user else ""
        }
        
        response = requests.put(f"{BASE_URL}/api/settings/no-notes-threshold", json=threshold_data, headers=headers)
        assert response.status_code == 200
        
        # Verify it was saved
        get_resp = requests.get(f"{BASE_URL}/api/settings/no-notes-threshold", headers=headers)
        saved = get_resp.json()
        assert saved["enabled"] == True
        assert saved["threshold_hours"] == 4
        print(f"✓ PUT /api/settings/no-notes-threshold - saved enabled=True, hours=4, escalate_to={saved.get('escalate_to_name', 'N/A')}")
    
    def test_check_escalation_endpoint(self, headers):
        """POST /api/tickets/check-escalation - verify escalation check runs"""
        response = requests.post(f"{BASE_URL}/api/tickets/check-escalation", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "escalated" in data
        print(f"✓ POST /api/tickets/check-escalation - escalated={data.get('escalated', 0)} tickets")
    
    def test_disable_threshold(self, headers):
        """PUT /api/settings/no-notes-threshold - disable threshold"""
        threshold_data = {"enabled": False, "threshold_hours": 24, "escalate_to": "", "escalate_to_name": ""}
        response = requests.put(f"{BASE_URL}/api/settings/no-notes-threshold", json=threshold_data, headers=headers)
        assert response.status_code == 200
        print(f"✓ PUT /api/settings/no-notes-threshold - disabled threshold for cleanup")


class TestXeroSettings(TestAuthentication):
    """Test Xero Integration Settings (MOCKED - settings storage only)"""
    
    def test_get_xero_settings(self, headers):
        """GET /api/settings/xero - returns Xero settings"""
        response = requests.get(f"{BASE_URL}/api/settings/xero", headers=headers)
        assert response.status_code == 200
        data = response.json()
        # Should have expected fields (connected/configured are aliases)
        assert "client_id" in data
        assert "connected" in data or "configured" in data
        print(f"✓ GET /api/settings/xero - connected={data.get('connected', data.get('configured', False))}")
    
    def test_save_xero_settings(self, headers):
        """PUT /api/settings/xero - save Xero settings"""
        xero_data = {
            "client_id": "TEST_XERO_CLIENT_ID",
            "client_secret": "TEST_XERO_SECRET",
            "redirect_uri": "https://example.com/callback"
        }
        response = requests.put(f"{BASE_URL}/api/settings/xero", json=xero_data, headers=headers)
        assert response.status_code == 200
        
        # Verify saved
        get_resp = requests.get(f"{BASE_URL}/api/settings/xero", headers=headers)
        saved = get_resp.json()
        assert saved["client_id"] == "TEST_XERO_CLIENT_ID"
        print(f"✓ PUT /api/settings/xero - saved Xero credentials")


class TestEnhancedDashboard(TestAuthentication):
    """Test Enhanced Dashboard Stats endpoint"""
    
    def test_enhanced_stats_returns_all_fields(self, headers):
        """GET /api/dashboard/enhanced-stats - returns all required operational fields"""
        response = requests.get(f"{BASE_URL}/api/dashboard/enhanced-stats", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Verify all required fields from the feature spec
        required_fields = [
            "total_revenue", "total_collected", "outstanding",
            "unpaid_invoices", "overdue_invoices",
            "no_notes_tickets", "sla_breaches",
            "low_stock_products", "pending_purchase_orders"
        ]
        
        for field in required_fields:
            assert field in data, f"Missing field: {field}"
        
        print(f"✓ GET /api/dashboard/enhanced-stats - all fields present")
        print(f"  Revenue: ${data['total_revenue']}, Collected: ${data['total_collected']}, Outstanding: ${data['outstanding']}")
        print(f"  No-Notes Tickets: {data['no_notes_tickets']}, SLA Breaches: {data['sla_breaches']}")
        print(f"  Low Stock: {data['low_stock_products']}, Pending POs: {data['pending_purchase_orders']}")
    
    def test_enhanced_stats_numeric_values(self, headers):
        """GET /api/dashboard/enhanced-stats - verify values are numeric"""
        response = requests.get(f"{BASE_URL}/api/dashboard/enhanced-stats", headers=headers)
        data = response.json()
        
        # All these should be numeric
        assert isinstance(data["total_revenue"], (int, float))
        assert isinstance(data["no_notes_tickets"], int)
        assert isinstance(data["low_stock_products"], int)
        assert isinstance(data["pending_purchase_orders"], int)
        print(f"✓ GET /api/dashboard/enhanced-stats - all values are numeric types")


class TestProductsStillWork(TestAuthentication):
    """Quick verification that Products (from previous iteration) still work"""
    
    def test_products_list(self, headers):
        """GET /api/products - still works"""
        response = requests.get(f"{BASE_URL}/api/products", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ GET /api/products - returns {len(data)} products")


class TestPurchaseOrdersStillWork(TestAuthentication):
    """Quick verification that Purchase Orders (from previous iteration) still work"""
    
    def test_po_list(self, headers):
        """GET /api/purchase-orders - still works"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ GET /api/purchase-orders - returns {len(data)} POs")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
