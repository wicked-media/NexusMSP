"""
Billing Pro Backend Tests - Iteration 159
Tests for all new Billing Pro endpoints including:
- Smart numbering scheme
- Bulk invoice actions
- MRR analytics
- Generation calendar
- Warehouses
- Inventory snapshot
- Suggest retail / margin calculator
- Bulk product import
- Tier pricing
- Indexation
- Proration
- Approval workflow
- Tax compliance settings
- FX rates
- Retainers
- Deposit invoices
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    data = response.json()
    return data.get("token")

@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestSmartNumbering:
    """Smart invoice numbering endpoints"""
    
    def test_get_numbering_defaults(self, headers):
        """GET /api/billing-pro/numbering returns default config"""
        r = requests.get(f"{BASE_URL}/api/billing-pro/numbering", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "format" in data
        assert "fy_start_month" in data
        assert "next_seq" in data
        print(f"✓ Numbering defaults: format={data.get('format')}, fy_start={data.get('fy_start_month')}")
    
    def test_save_numbering(self, headers):
        """PUT /api/billing-pro/numbering saves config"""
        payload = {
            "format": "INV-{YYYY}-{SEQ:05d}",
            "fy_start_month": 7,
            "next_seq": 100,
            "fy_reset": True
        }
        r = requests.put(f"{BASE_URL}/api/billing-pro/numbering", json=payload, headers=headers)
        assert r.status_code == 200
        assert "message" in r.json()
        print("✓ Numbering saved")
    
    def test_preview_numbering(self, headers):
        """POST /api/billing-pro/numbering/preview returns formatted sample"""
        payload = {
            "format": "INV-{YYYY}-{SEQ:05d}",
            "fy_start_month": 7,
            "next_seq": 42
        }
        r = requests.post(f"{BASE_URL}/api/billing-pro/numbering/preview", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "sample" in data
        assert "INV-" in data["sample"]
        print(f"✓ Preview sample: {data['sample']}")


class TestMRRAnalytics:
    """MRR analytics endpoint"""
    
    def test_mrr_analytics(self, headers):
        """GET /api/billing-pro/recurring/mrr-analytics returns MRR breakdown"""
        r = requests.get(f"{BASE_URL}/api/billing-pro/recurring/mrr-analytics", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "current_mrr" in data
        assert "new_mrr_this_month" in data
        assert "cancelled_mrr" in data
        assert "by_month" in data
        assert isinstance(data["by_month"], list)
        assert len(data["by_month"]) == 13  # 13 months
        print(f"✓ MRR Analytics: current_mrr=${data['current_mrr']}, new=${data['new_mrr_this_month']}, churn=${data['cancelled_mrr']}")


class TestGenerationCalendar:
    """Generation calendar endpoint"""
    
    def test_calendar(self, headers):
        """GET /api/billing-pro/recurring/calendar returns forecast"""
        r = requests.get(f"{BASE_URL}/api/billing-pro/recurring/calendar?months=3", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "months" in data
        assert isinstance(data["months"], list)
        assert "horizon" in data
        assert "total_events" in data
        print(f"✓ Calendar: {data['total_events']} events over {len(data['months'])} months")


class TestBulkInvoiceActions:
    """Bulk invoice actions"""
    
    def test_bulk_action_requires_params(self, headers):
        """POST /api/billing-pro/invoices/bulk-action requires invoice_ids and action"""
        r = requests.post(f"{BASE_URL}/api/billing-pro/invoices/bulk-action", json={}, headers=headers)
        assert r.status_code == 400
        print("✓ Bulk action validation works")
    
    def test_export_csv(self, headers):
        """POST /api/billing-pro/invoices/export-csv returns CSV"""
        r = requests.post(f"{BASE_URL}/api/billing-pro/invoices/export-csv", json={"filter": {"status": "all"}}, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "csv" in data
        assert "count" in data
        assert "filename" in data
        assert data["csv"].startswith("Invoice #")  # CSV header
        print(f"✓ Export CSV: {data['count']} invoices, filename={data['filename']}")


class TestWarehouses:
    """Warehouse/location endpoints"""
    
    def test_list_warehouses(self, headers):
        """GET /api/billing-pro/warehouses returns at least 1 default"""
        r = requests.get(f"{BASE_URL}/api/billing-pro/warehouses", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        print(f"✓ Warehouses: {len(data)} locations")
    
    def test_create_and_delete_warehouse(self, headers):
        """POST creates, DELETE removes warehouse"""
        # Create
        payload = {"name": f"TEST_Warehouse_{uuid.uuid4().hex[:6]}", "code": "TST", "address": "123 Test St"}
        r = requests.post(f"{BASE_URL}/api/billing-pro/warehouses", json=payload, headers=headers)
        assert r.status_code == 200
        wh = r.json()
        assert "id" in wh
        wh_id = wh["id"]
        print(f"✓ Created warehouse: {wh['name']}")
        
        # Delete
        r2 = requests.delete(f"{BASE_URL}/api/billing-pro/warehouses/{wh_id}", headers=headers)
        assert r2.status_code == 200
        print(f"✓ Deleted warehouse: {wh_id}")


class TestInventorySnapshot:
    """Inventory snapshot endpoint"""
    
    def test_snapshot(self, headers):
        """GET /api/billing-pro/products/inventory/snapshot returns totals"""
        r = requests.get(f"{BASE_URL}/api/billing-pro/products/inventory/snapshot", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "total_units" in data
        assert "total_value_cost" in data
        assert "by_category" in data
        assert "low_stock" in data
        print(f"✓ Snapshot: {data['total_units']} units, cost=${data['total_value_cost']}, low_stock={data['low_stock_count']}")


class TestSuggestRetail:
    """Margin calculator / suggest retail"""
    
    def test_suggest_retail(self, headers):
        """POST /api/billing-pro/products/suggest-retail calculates retail price"""
        payload = {"cost_price": 100, "target_margin_pct": 35}
        r = requests.post(f"{BASE_URL}/api/billing-pro/products/suggest-retail", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "suggested_retail" in data
        assert "markup_pct" in data
        # 35% margin on $100 cost = $153.85 retail
        assert abs(data["suggested_retail"] - 153.85) < 0.1
        assert abs(data["markup_pct"] - 53.8) < 1
        print(f"✓ Suggest retail: cost=$100, margin=35% → retail=${data['suggested_retail']}, markup={data['markup_pct']}%")


class TestBulkImport:
    """Bulk product CSV import"""
    
    def test_bulk_import(self, headers):
        """POST /api/billing-pro/products/bulk-import imports CSV"""
        csv_text = "Name,SKU,Category,Vendor,Cost Price,Retail Price,Stock,Reorder,Tax Rate,Description\nTEST_Import_Product,TEST-IMP-001,Hardware,TestVendor,50,100,10,5,10,Test import product"
        r = requests.post(f"{BASE_URL}/api/billing-pro/products/bulk-import", json={"csv_text": csv_text}, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "inserted" in data or "updated" in data
        assert data.get("inserted", 0) + data.get("updated", 0) >= 1
        print(f"✓ Bulk import: inserted={data.get('inserted', 0)}, updated={data.get('updated', 0)}")


class TestTierPricing:
    """Quantity-break tier pricing"""
    
    def test_tier_pricing_flow(self, headers):
        """PUT saves tiers, GET /price-for-qty returns tier price"""
        # First get a product
        r = requests.get(f"{BASE_URL}/api/products", headers=headers)
        assert r.status_code == 200
        products = r.json()
        if not products:
            pytest.skip("No products to test tier pricing")
        
        product_id = products[0]["id"]
        
        # Save tiers
        tiers = [
            {"min_qty": 1, "unit_price": 100},
            {"min_qty": 10, "unit_price": 90},
            {"min_qty": 50, "unit_price": 80}
        ]
        r = requests.put(f"{BASE_URL}/api/billing-pro/products/{product_id}/pricing-tiers", json={"tiers": tiers}, headers=headers)
        assert r.status_code == 200
        print(f"✓ Saved {len(tiers)} tiers for product {product_id}")
        
        # Get price for qty=25 (should be $90)
        r = requests.get(f"{BASE_URL}/api/billing-pro/products/{product_id}/price-for-qty?qty=25", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["unit_price"] == 90
        print(f"✓ Price for qty=25: ${data['unit_price']} (tier 10+)")


class TestApprovalWorkflow:
    """Approval workflow settings"""
    
    def test_get_approval_settings(self, headers):
        """GET /api/billing-pro/settings/approval returns config"""
        r = requests.get(f"{BASE_URL}/api/billing-pro/settings/approval", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "enabled" in data
        assert "threshold" in data
        print(f"✓ Approval settings: enabled={data['enabled']}, threshold=${data['threshold']}")
    
    def test_save_approval_settings(self, headers):
        """PUT /api/billing-pro/settings/approval saves config"""
        payload = {"enabled": True, "threshold": 5000, "approver_role": "admin"}
        r = requests.put(f"{BASE_URL}/api/billing-pro/settings/approval", json=payload, headers=headers)
        assert r.status_code == 200
        print("✓ Approval settings saved")


class TestTaxCompliance:
    """Tax compliance settings"""
    
    def test_get_tax_compliance(self, headers):
        """GET /api/billing-pro/settings/tax-compliance returns config"""
        r = requests.get(f"{BASE_URL}/api/billing-pro/settings/tax-compliance", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "country" in data
        assert "gst_pct" in data
        print(f"✓ Tax compliance: country={data['country']}, gst={data['gst_pct']}%")
    
    def test_save_tax_compliance(self, headers):
        """PUT /api/billing-pro/settings/tax-compliance saves config"""
        payload = {"country": "AU", "abn": "12345678901", "gst_registered": True, "gst_pct": 10}
        r = requests.put(f"{BASE_URL}/api/billing-pro/settings/tax-compliance", json=payload, headers=headers)
        assert r.status_code == 200
        print("✓ Tax compliance saved")


class TestFXRate:
    """FX rate endpoint"""
    
    def test_fx_rate(self, headers):
        """GET /api/billing-pro/fx/rate returns numeric rate"""
        r = requests.get(f"{BASE_URL}/api/billing-pro/fx/rate?base=AUD&target=USD", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "rate" in data
        assert isinstance(data["rate"], (int, float))
        assert data["rate"] > 0
        print(f"✓ FX rate: AUD→USD = {data['rate']}")


class TestRetainers:
    """Retainer / pre-paid hours"""
    
    def test_retainer_flow(self, headers):
        """GET returns 0 by default, POST /topup adds, POST /draw deducts"""
        # Get a client
        r = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert r.status_code == 200
        clients = r.json()
        if not clients:
            pytest.skip("No clients to test retainers")
        
        client_id = clients[0]["id"]
        
        # Get retainer (should be 0 or existing)
        r = requests.get(f"{BASE_URL}/api/billing-pro/retainers/{client_id}", headers=headers)
        assert r.status_code == 200
        data = r.json()
        initial_balance = data.get("balance_hours", 0)
        print(f"✓ Initial retainer balance: {initial_balance}h")
        
        # Top up
        r = requests.post(f"{BASE_URL}/api/billing-pro/retainers/{client_id}/topup", json={"hours": 10, "rate": 150}, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["balance_hours"] == initial_balance + 10
        print(f"✓ Topped up 10h, new balance: {data['balance_hours']}h")
        
        # Draw
        r = requests.post(f"{BASE_URL}/api/billing-pro/retainers/{client_id}/draw", json={"hours": 2}, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["balance_hours"] == initial_balance + 10 - 2
        print(f"✓ Drew 2h, new balance: {data['balance_hours']}h")


class TestDepositInvoice:
    """Deposit invoice creation"""
    
    def test_create_deposit(self, headers):
        """POST /api/billing-pro/invoices/{id}/create-deposit creates deposit invoice"""
        # Get an invoice
        r = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        assert r.status_code == 200
        invoices = r.json()
        if not invoices:
            pytest.skip("No invoices to test deposit creation")
        
        invoice_id = invoices[0]["id"]
        parent_total = invoices[0].get("total", 0)
        
        r = requests.post(f"{BASE_URL}/api/billing-pro/invoices/{invoice_id}/create-deposit", json={"pct": 50}, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data.get("is_deposit") == True
        assert data.get("deposit_pct") == 50
        expected_amount = round(parent_total * 0.5, 2)
        assert abs(data.get("total", 0) - expected_amount) < 0.01
        print(f"✓ Created deposit invoice: {data.get('invoice_number')}, amount=${data.get('total')}")


class TestIndexation:
    """CPI / Annual indexation"""
    
    def test_set_indexation(self, headers):
        """POST /api/billing-pro/recurring/{ri_id}/set-indexation enables indexation"""
        # Get a recurring invoice
        r = requests.get(f"{BASE_URL}/api/recurring-invoices/list", headers=headers)
        assert r.status_code == 200
        ris = r.json()
        if not ris:
            pytest.skip("No recurring invoices to test indexation")
        
        ri_id = ris[0]["id"]
        
        payload = {"enabled": True, "pct": 3.5, "anniversary_date": "2026-07-01"}
        r = requests.post(f"{BASE_URL}/api/billing-pro/recurring/{ri_id}/set-indexation", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "indexation" in data
        assert data["indexation"]["enabled"] == True
        assert data["indexation"]["pct"] == 3.5
        print(f"✓ Set indexation: {data['indexation']['pct']}% on {data['indexation']['anniversary_date']}")


class TestProration:
    """Mid-cycle proration"""
    
    def test_prorate(self, headers):
        """POST /api/billing-pro/recurring/{ri_id}/prorate returns prorated amount"""
        # Get a recurring invoice
        r = requests.get(f"{BASE_URL}/api/recurring-invoices/list", headers=headers)
        assert r.status_code == 200
        ris = r.json()
        if not ris:
            pytest.skip("No recurring invoices to test proration")
        
        ri_id = ris[0]["id"]
        
        payload = {"quantity_delta": 1, "unit_price": 100, "description": "Add 1 seat"}
        r = requests.post(f"{BASE_URL}/api/billing-pro/recurring/{ri_id}/prorate", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "prorated_amount" in data
        assert "remaining_days" in data
        assert "period_days" in data
        print(f"✓ Proration: {data['remaining_days']}/{data['period_days']} days, prorated=${data['prorated_amount']}")


class TestInvoiceCreationWithPerLineTax:
    """Invoice creation with per-line tax and discount"""
    
    def test_create_invoice_with_line_tax(self, headers):
        """POST /api/invoices with per-line tax_rate and discount_pct"""
        # Get a client
        r = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert r.status_code == 200
        clients = r.json()
        if not clients:
            pytest.skip("No clients to test invoice creation")
        
        client_id = clients[0]["id"]
        
        payload = {
            "client_id": client_id,
            "due_date": "2026-02-28",
            "tax_rate": 10,
            "discount_pct": 5,
            "line_items": [
                {"name": "Service A", "quantity": 2, "unit_price": 100, "tax_rate": 10, "discount_pct": 0},
                {"name": "Service B", "quantity": 1, "unit_price": 50, "tax_rate": 0, "discount_pct": 10}
            ]
        }
        r = requests.post(f"{BASE_URL}/api/invoices", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "id" in data
        assert "invoice_number" in data
        # Line A: 2*100 = 200, Line B: 1*50*(1-0.1) = 45, subtotal = 245
        # Invoice discount 5% = 12.25, discounted = 232.75
        # Tax on line A (200 * 0.95 * 10%) = 19, line B has 0% tax
        print(f"✓ Created invoice {data['invoice_number']}: subtotal=${data.get('subtotal')}, tax=${data.get('tax')}, total=${data.get('total')}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/invoices/{data['id']}", headers=headers)


class TestSmartNumberingOnInvoiceCreate:
    """Smart numbering applies to new invoices"""
    
    def test_smart_numbering_applied(self, headers):
        """Saving a numbering format with {YYYY} {SEQ:05d} causes new invoices to use that format"""
        # Save numbering format
        payload = {"format": "TEST-{YYYY}-{SEQ:05d}", "fy_start_month": 7, "next_seq": 1, "fy_reset": False}
        r = requests.put(f"{BASE_URL}/api/billing-pro/numbering", json=payload, headers=headers)
        assert r.status_code == 200
        
        # Get a client
        r = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = r.json()
        if not clients:
            pytest.skip("No clients")
        
        # Create invoice
        inv_payload = {
            "client_id": clients[0]["id"],
            "due_date": "2026-03-01",
            "line_items": [{"name": "Test", "quantity": 1, "unit_price": 100}]
        }
        r = requests.post(f"{BASE_URL}/api/invoices", json=inv_payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        
        # Check invoice number matches format
        inv_num = data.get("invoice_number", "")
        assert inv_num.startswith("TEST-2026-") or inv_num.startswith("TEST-2025-")
        print(f"✓ Smart numbering applied: {inv_num}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/invoices/{data['id']}", headers=headers)
        
        # Reset numbering to default
        requests.put(f"{BASE_URL}/api/billing-pro/numbering", json={"format": "INV-{YYYY}-{SEQ:05d}", "fy_start_month": 7, "next_seq": 1}, headers=headers)


class TestApprovalWorkflowOnInvoice:
    """Approval workflow triggers pending_approval status"""
    
    def test_large_invoice_needs_approval(self, headers):
        """When approval enabled with threshold, large invoice gets status='pending_approval'"""
        # Enable approval with low threshold
        r = requests.put(f"{BASE_URL}/api/billing-pro/settings/approval", json={"enabled": True, "threshold": 100, "approver_role": "admin"}, headers=headers)
        assert r.status_code == 200
        
        # Get a client
        r = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = r.json()
        if not clients:
            pytest.skip("No clients")
        
        # Create invoice over threshold
        inv_payload = {
            "client_id": clients[0]["id"],
            "due_date": "2026-03-01",
            "line_items": [{"name": "Big Service", "quantity": 1, "unit_price": 500}]
        }
        r = requests.post(f"{BASE_URL}/api/invoices", json=inv_payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        
        # Check status is pending_approval
        assert data.get("status") == "pending_approval"
        print(f"✓ Large invoice ({data.get('total')}) got status=pending_approval")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/invoices/{data['id']}", headers=headers)
        
        # Disable approval
        requests.put(f"{BASE_URL}/api/billing-pro/settings/approval", json={"enabled": False, "threshold": 5000}, headers=headers)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
