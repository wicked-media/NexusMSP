"""
Iteration 146: Finance Intelligence - 9 Differentiator Features
Tests for Products & Invoices PLUS features:
1. Smart Product Catalog (margin insights, price history, price-change tracking)
2. Product Kits/Bundles (CRUD + apply-to-ticket)
3. Per-Client Price Book
4. Subscription Drift Detector
5. Cash Flow Forecast (30/60/90)
6. Late-payment Predictor
7. Margin per Invoice
8. Predictive Auto-Quote nudge
9. Pre-Emptive DisputeShield scan
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if resp.status_code == 200:
        return resp.json().get("token")
    pytest.skip(f"Auth failed: {resp.status_code} - {resp.text}")


@pytest.fixture(scope="module")
def api(auth_token):
    """Authenticated session"""
    session = requests.Session()
    session.headers.update({
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    })
    return session


# ═══════════════════════ 1) SMART PRODUCT CATALOG ═══════════════════════

class TestProductMarginInsights:
    """Tests for GET /api/finance/product-margin-insights"""
    
    def test_product_margin_insights_returns_200(self, api):
        resp = api.get(f"{BASE_URL}/api/finance/product-margin-insights")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
    def test_product_margin_insights_structure(self, api):
        resp = api.get(f"{BASE_URL}/api/finance/product-margin-insights")
        data = resp.json()
        # Verify top-level keys
        assert "products" in data, "Missing 'products' key"
        assert "summary" in data, "Missing 'summary' key"
        # Verify summary structure
        summary = data["summary"]
        assert "count" in summary
        assert "low_margin_count" in summary
        assert "cost_erosion_count" in summary
        assert "avg_margin_pct" in summary
        print(f"✓ Product margin insights: {summary['count']} products, {summary['avg_margin_pct']}% avg margin")
        
    def test_product_margin_insights_product_fields(self, api):
        resp = api.get(f"{BASE_URL}/api/finance/product-margin-insights")
        data = resp.json()
        if data["products"]:
            p = data["products"][0]
            required_fields = ["id", "name", "cost_price", "retail_price", "margin_pct", "status"]
            for field in required_fields:
                assert field in p, f"Missing field '{field}' in product"
            print(f"✓ First product: {p['name']} - margin {p['margin_pct']}%, status: {p['status']}")


class TestProductPriceHistory:
    """Tests for price history and price change recording"""
    
    def test_get_price_history_returns_200(self, api):
        # First get a product ID
        resp = api.get(f"{BASE_URL}/api/finance/product-margin-insights")
        products = resp.json().get("products", [])
        if not products:
            pytest.skip("No products available")
        product_id = products[0]["id"]
        
        resp = api.get(f"{BASE_URL}/api/finance/product/{product_id}/price-history")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "product_id" in data
        assert "history" in data
        print(f"✓ Price history for {product_id}: {len(data['history'])} entries")
        
    def test_get_price_history_404_for_invalid_product(self, api):
        resp = api.get(f"{BASE_URL}/api/finance/product/invalid-product-id/price-history")
        assert resp.status_code == 404
        
    def test_record_price_change(self, api):
        # Get a product
        resp = api.get(f"{BASE_URL}/api/finance/product-margin-insights")
        products = resp.json().get("products", [])
        if not products:
            pytest.skip("No products available")
        product_id = products[0]["id"]
        original_cost = products[0]["cost_price"]
        original_retail = products[0]["retail_price"]
        
        # Record a price change
        resp = api.post(f"{BASE_URL}/api/finance/product/{product_id}/price-change", json={
            "cost_price": original_cost + 1,
            "retail_price": original_retail + 2,
            "reason": "TEST_price_change_iteration146"
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("ok") is True
        assert "entry" in data
        print(f"✓ Price change recorded for {product_id}")
        
        # Revert the price change
        api.post(f"{BASE_URL}/api/finance/product/{product_id}/price-change", json={
            "cost_price": original_cost,
            "retail_price": original_retail,
            "reason": "TEST_revert_iteration146"
        })


# ═══════════════════════ 2) PRODUCT KITS / BUNDLES ═══════════════════════

class TestProductKits:
    """Tests for Product Kits CRUD"""
    
    def test_list_kits_returns_200(self, api):
        resp = api.get(f"{BASE_URL}/api/product-kits")
        assert resp.status_code == 200
        data = resp.json()
        assert "kits" in data
        assert "count" in data
        print(f"✓ Listed {data['count']} kits")
        
    def test_create_kit_success(self, api):
        # Get a product to add to kit
        resp = api.get(f"{BASE_URL}/api/products")
        products = resp.json() if isinstance(resp.json(), list) else resp.json().get("products", [])
        product_id = products[0]["id"] if products else None
        
        kit_name = f"TEST_Kit_{uuid.uuid4().hex[:8]}"
        payload = {
            "name": kit_name,
            "description": "Test kit for iteration 146",
            "items": [{"product_id": product_id, "quantity": 2}] if product_id else [],
            "labor_hours": 2,
            "labor_rate": 150,
            "category": "test"
        }
        resp = api.post(f"{BASE_URL}/api/product-kits", json=payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("name") == kit_name
        assert "id" in data
        print(f"✓ Created kit: {kit_name} (id: {data['id']})")
        return data["id"]
        
    def test_create_kit_400_when_name_missing(self, api):
        resp = api.post(f"{BASE_URL}/api/product-kits", json={
            "description": "No name kit"
        })
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        
    def test_update_kit(self, api):
        # Create a kit first
        kit_name = f"TEST_UpdateKit_{uuid.uuid4().hex[:8]}"
        resp = api.post(f"{BASE_URL}/api/product-kits", json={"name": kit_name})
        kit_id = resp.json()["id"]
        
        # Update it
        resp = api.put(f"{BASE_URL}/api/product-kits/{kit_id}", json={
            "name": kit_name + "_updated",
            "labor_hours": 5
        })
        assert resp.status_code == 200
        assert resp.json().get("ok") is True
        print(f"✓ Updated kit {kit_id}")
        
        # Cleanup
        api.delete(f"{BASE_URL}/api/product-kits/{kit_id}")
        
    def test_update_kit_404_for_invalid_id(self, api):
        resp = api.put(f"{BASE_URL}/api/product-kits/invalid-kit-id", json={"name": "test"})
        assert resp.status_code == 404
        
    def test_delete_kit(self, api):
        # Create a kit
        kit_name = f"TEST_DeleteKit_{uuid.uuid4().hex[:8]}"
        resp = api.post(f"{BASE_URL}/api/product-kits", json={"name": kit_name})
        kit_id = resp.json()["id"]
        
        # Delete it
        resp = api.delete(f"{BASE_URL}/api/product-kits/{kit_id}")
        assert resp.status_code == 200
        assert resp.json().get("deleted") is True
        print(f"✓ Deleted kit {kit_id}")
        
    def test_delete_kit_404_for_invalid_id(self, api):
        resp = api.delete(f"{BASE_URL}/api/product-kits/invalid-kit-id")
        assert resp.status_code == 404


class TestApplyKitToTicket:
    """Tests for POST /api/tickets/{ticket_id}/apply-kit/{kit_id}"""
    
    def test_apply_kit_to_ticket(self, api):
        # Get a ticket
        resp = api.get(f"{BASE_URL}/api/tickets?limit=1")
        tickets = resp.json() if isinstance(resp.json(), list) else resp.json().get("tickets", [])
        if not tickets:
            pytest.skip("No tickets available")
        ticket_id = tickets[0]["id"]
        
        # Create a kit with a product
        resp = api.get(f"{BASE_URL}/api/products")
        products = resp.json() if isinstance(resp.json(), list) else resp.json().get("products", [])
        if not products:
            pytest.skip("No products available")
        
        kit_name = f"TEST_ApplyKit_{uuid.uuid4().hex[:8]}"
        resp = api.post(f"{BASE_URL}/api/product-kits", json={
            "name": kit_name,
            "items": [{"product_id": products[0]["id"], "quantity": 1}]
        })
        kit_id = resp.json()["id"]
        
        # Apply kit to ticket
        resp = api.post(f"{BASE_URL}/api/tickets/{ticket_id}/apply-kit/{kit_id}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("ok") is True
        assert "attached_count" in data
        print(f"✓ Applied kit to ticket {ticket_id}: {data['attached_count']} products attached")
        
        # Cleanup
        api.delete(f"{BASE_URL}/api/product-kits/{kit_id}")
        
    def test_apply_kit_404_invalid_ticket(self, api):
        # Create a kit
        resp = api.post(f"{BASE_URL}/api/product-kits", json={"name": f"TEST_Kit_{uuid.uuid4().hex[:8]}"})
        kit_id = resp.json()["id"]
        
        resp = api.post(f"{BASE_URL}/api/tickets/invalid-ticket/apply-kit/{kit_id}")
        assert resp.status_code == 404
        
        # Cleanup
        api.delete(f"{BASE_URL}/api/product-kits/{kit_id}")
        
    def test_apply_kit_404_invalid_kit(self, api):
        resp = api.get(f"{BASE_URL}/api/tickets?limit=1")
        tickets = resp.json() if isinstance(resp.json(), list) else resp.json().get("tickets", [])
        if not tickets:
            pytest.skip("No tickets available")
        
        resp = api.post(f"{BASE_URL}/api/tickets/{tickets[0]['id']}/apply-kit/invalid-kit")
        assert resp.status_code == 404


# ═══════════════════════ 3) PER-CLIENT PRICE BOOK ═══════════════════════

class TestClientPriceBook:
    """Tests for Client Price Book endpoints"""
    
    def test_get_price_book_returns_200(self, api):
        # Get a client
        resp = api.get(f"{BASE_URL}/api/clients?limit=1")
        clients = resp.json() if isinstance(resp.json(), list) else resp.json().get("clients", [])
        if not clients:
            pytest.skip("No clients available")
        client_id = clients[0]["id"]
        
        resp = api.get(f"{BASE_URL}/api/clients/{client_id}/price-book")
        assert resp.status_code == 200
        data = resp.json()
        assert "overrides" in data
        assert "count" in data
        print(f"✓ Price book for client {client_id}: {data['count']} overrides")
        
    def test_upsert_price_override(self, api):
        # Get client and product
        resp = api.get(f"{BASE_URL}/api/clients?limit=1")
        clients = resp.json() if isinstance(resp.json(), list) else resp.json().get("clients", [])
        if not clients:
            pytest.skip("No clients available")
        client_id = clients[0]["id"]
        
        resp = api.get(f"{BASE_URL}/api/products")
        products = resp.json() if isinstance(resp.json(), list) else resp.json().get("products", [])
        if not products:
            pytest.skip("No products available")
        product_id = products[0]["id"]
        
        # Create override
        resp = api.post(f"{BASE_URL}/api/clients/{client_id}/price-book", json={
            "product_id": product_id,
            "override_price": 99.99,
            "reason": "TEST_override_iteration146"
        })
        assert resp.status_code == 200
        assert resp.json().get("ok") is True
        print(f"✓ Created price override for client {client_id}, product {product_id}")
        
        # Cleanup
        api.delete(f"{BASE_URL}/api/clients/{client_id}/price-book/{product_id}")
        
    def test_upsert_price_override_400_no_product_id(self, api):
        resp = api.get(f"{BASE_URL}/api/clients?limit=1")
        clients = resp.json() if isinstance(resp.json(), list) else resp.json().get("clients", [])
        if not clients:
            pytest.skip("No clients available")
        
        resp = api.post(f"{BASE_URL}/api/clients/{clients[0]['id']}/price-book", json={
            "override_price": 50
        })
        assert resp.status_code == 400
        
    def test_delete_price_override(self, api):
        # Get client and product
        resp = api.get(f"{BASE_URL}/api/clients?limit=1")
        clients = resp.json() if isinstance(resp.json(), list) else resp.json().get("clients", [])
        if not clients:
            pytest.skip("No clients available")
        client_id = clients[0]["id"]
        
        resp = api.get(f"{BASE_URL}/api/products")
        products = resp.json() if isinstance(resp.json(), list) else resp.json().get("products", [])
        if not products:
            pytest.skip("No products available")
        product_id = products[0]["id"]
        
        # Create then delete
        api.post(f"{BASE_URL}/api/clients/{client_id}/price-book", json={
            "product_id": product_id,
            "override_price": 88.88,
            "reason": "TEST_delete_iteration146"
        })
        
        resp = api.delete(f"{BASE_URL}/api/clients/{client_id}/price-book/{product_id}")
        assert resp.status_code == 200
        assert resp.json().get("deleted") is True
        print(f"✓ Deleted price override")
        
    def test_get_client_price_for_product(self, api):
        # Get client and product
        resp = api.get(f"{BASE_URL}/api/clients?limit=1")
        clients = resp.json() if isinstance(resp.json(), list) else resp.json().get("clients", [])
        if not clients:
            pytest.skip("No clients available")
        client_id = clients[0]["id"]
        
        resp = api.get(f"{BASE_URL}/api/products")
        products = resp.json() if isinstance(resp.json(), list) else resp.json().get("products", [])
        if not products:
            pytest.skip("No products available")
        product_id = products[0]["id"]
        
        resp = api.get(f"{BASE_URL}/api/clients/{client_id}/price-for/{product_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert "price" in data
        assert "source" in data
        assert data["source"] in ["standard", "client_override"]
        print(f"✓ Price for client {client_id}, product {product_id}: ${data['price']} ({data['source']})")


# ═══════════════════════ 4) SUBSCRIPTION DRIFT DETECTOR ═══════════════════════

class TestSubscriptionDrift:
    """Tests for GET /api/subscription-drift"""
    
    def test_subscription_drift_returns_200(self, api):
        resp = api.get(f"{BASE_URL}/api/subscription-drift")
        assert resp.status_code == 200
        
    def test_subscription_drift_structure(self, api):
        resp = api.get(f"{BASE_URL}/api/subscription-drift")
        data = resp.json()
        assert "findings" in data
        assert "count" in data
        assert "total_monthly_waste_aud" in data
        assert "annual_waste_aud" in data
        print(f"✓ Subscription drift: {data['count']} findings, ${data['total_monthly_waste_aud']}/mo waste")


# ═══════════════════════ 5) CASH FLOW FORECAST ═══════════════════════

class TestCashFlowForecast:
    """Tests for GET /api/finance/cash-flow-forecast"""
    
    def test_cash_flow_forecast_returns_200(self, api):
        resp = api.get(f"{BASE_URL}/api/finance/cash-flow-forecast")
        assert resp.status_code == 200
        
    def test_cash_flow_forecast_structure(self, api):
        resp = api.get(f"{BASE_URL}/api/finance/cash-flow-forecast")
        data = resp.json()
        assert "projected" in data
        assert "risk_adjusted" in data
        assert "total_open_invoice_balance" in data
        assert "generated_at" in data
        
        # Check projected buckets
        projected = data["projected"]
        assert "30d" in projected
        assert "60d" in projected
        assert "90d" in projected
        
        print(f"✓ Cash flow forecast: 30d=${projected['30d']}, 60d=${projected['60d']}, 90d=${projected['90d']}")


# ═══════════════════════ 6) LATE-PAYMENT PREDICTOR ═══════════════════════

class TestLatePaymentRisk:
    """Tests for late payment risk endpoints"""
    
    def test_late_payment_risk_overview_returns_200(self, api):
        resp = api.get(f"{BASE_URL}/api/finance/invoices/late-payment-risk")
        assert resp.status_code == 200
        
    def test_late_payment_risk_overview_structure(self, api):
        resp = api.get(f"{BASE_URL}/api/finance/invoices/late-payment-risk")
        data = resp.json()
        assert "invoices" in data
        assert "summary" in data
        
        summary = data["summary"]
        assert "high_risk" in summary
        assert "medium_risk" in summary
        assert "low_risk" in summary
        assert "total" in summary
        print(f"✓ Late payment risk: {summary['total']} invoices scored (H:{summary['high_risk']}, M:{summary['medium_risk']}, L:{summary['low_risk']})")
        
    def test_late_payment_risk_invoice_fields(self, api):
        resp = api.get(f"{BASE_URL}/api/finance/invoices/late-payment-risk")
        data = resp.json()
        if data["invoices"]:
            inv = data["invoices"][0]
            assert "score" in inv
            assert "band" in inv
            assert "reasons" in inv
            assert inv["band"] in ["high", "medium", "low"]
            print(f"✓ First invoice: score={inv['score']}, band={inv['band']}")
            
    def test_single_invoice_late_risk(self, api):
        # Get an invoice
        resp = api.get(f"{BASE_URL}/api/invoices?limit=1")
        invoices = resp.json() if isinstance(resp.json(), list) else resp.json().get("invoices", [])
        if not invoices:
            pytest.skip("No invoices available")
        invoice_id = invoices[0]["id"]
        
        resp = api.get(f"{BASE_URL}/api/invoices/{invoice_id}/late-risk")
        assert resp.status_code == 200
        data = resp.json()
        assert "score" in data
        assert "band" in data
        assert "reasons" in data
        print(f"✓ Invoice {invoice_id} late risk: score={data['score']}, band={data['band']}")
        
    def test_single_invoice_late_risk_404(self, api):
        resp = api.get(f"{BASE_URL}/api/invoices/invalid-invoice-id/late-risk")
        assert resp.status_code == 404


# ═══════════════════════ 7) MARGIN PER INVOICE ═══════════════════════

class TestInvoiceMargin:
    """Tests for invoice margin endpoints"""
    
    def test_invoice_margin_returns_200(self, api):
        resp = api.get(f"{BASE_URL}/api/invoices?limit=1")
        invoices = resp.json() if isinstance(resp.json(), list) else resp.json().get("invoices", [])
        if not invoices:
            pytest.skip("No invoices available")
        invoice_id = invoices[0]["id"]
        
        resp = api.get(f"{BASE_URL}/api/invoices/{invoice_id}/margin")
        assert resp.status_code == 200
        
    def test_invoice_margin_structure(self, api):
        resp = api.get(f"{BASE_URL}/api/invoices?limit=1")
        invoices = resp.json() if isinstance(resp.json(), list) else resp.json().get("invoices", [])
        if not invoices:
            pytest.skip("No invoices available")
        invoice_id = invoices[0]["id"]
        
        resp = api.get(f"{BASE_URL}/api/invoices/{invoice_id}/margin")
        data = resp.json()
        assert "revenue" in data
        assert "cost" in data
        assert "cost_breakdown" in data
        assert "profit" in data
        assert "margin_pct" in data
        print(f"✓ Invoice {invoice_id} margin: revenue=${data['revenue']}, profit=${data['profit']}, margin={data['margin_pct']}%")
        
    def test_invoice_margin_404(self, api):
        resp = api.get(f"{BASE_URL}/api/invoices/invalid-invoice-id/margin")
        assert resp.status_code == 404
        
    def test_margin_overview_returns_200(self, api):
        resp = api.get(f"{BASE_URL}/api/finance/margin-overview?days=90")
        assert resp.status_code == 200
        
    def test_margin_overview_structure(self, api):
        resp = api.get(f"{BASE_URL}/api/finance/margin-overview?days=90")
        data = resp.json()
        assert "window_days" in data
        assert "total_revenue" in data
        assert "total_cost" in data
        assert "total_profit" in data
        assert "margin_pct" in data
        assert "clients" in data
        print(f"✓ Margin overview (90d): revenue=${data['total_revenue']}, profit=${data['total_profit']}, margin={data['margin_pct']}%")


# ═══════════════════════ 8) PREDICTIVE AUTO-QUOTE TRIGGER ═══════════════════════

class TestQuoteNudge:
    """Tests for POST /api/tickets/{ticket_id}/quote-nudge"""
    
    def test_quote_nudge_returns_200(self, api):
        resp = api.get(f"{BASE_URL}/api/tickets?limit=1")
        tickets = resp.json() if isinstance(resp.json(), list) else resp.json().get("tickets", [])
        if not tickets:
            pytest.skip("No tickets available")
        ticket_id = tickets[0]["id"]
        
        resp = api.post(f"{BASE_URL}/api/tickets/{ticket_id}/quote-nudge")
        assert resp.status_code == 200
        
    def test_quote_nudge_structure(self, api):
        resp = api.get(f"{BASE_URL}/api/tickets?limit=1")
        tickets = resp.json() if isinstance(resp.json(), list) else resp.json().get("tickets", [])
        if not tickets:
            pytest.skip("No tickets available")
        ticket_id = tickets[0]["id"]
        
        resp = api.post(f"{BASE_URL}/api/tickets/{ticket_id}/quote-nudge")
        data = resp.json()
        assert "should_quote" in data
        assert "score" in data
        assert "signals" in data
        assert isinstance(data["should_quote"], bool)
        assert isinstance(data["score"], (int, float))
        print(f"✓ Quote nudge for ticket {ticket_id}: should_quote={data['should_quote']}, score={data['score']}")
        
    def test_quote_nudge_404(self, api):
        resp = api.post(f"{BASE_URL}/api/tickets/invalid-ticket-id/quote-nudge")
        assert resp.status_code == 404


# ═══════════════════════ 9) PRE-EMPTIVE DISPUTESHIELD SCAN ═══════════════════════

class TestDisputeScan:
    """Tests for POST /api/invoices/{invoice_id}/dispute-scan"""
    
    def test_dispute_scan_returns_200(self, api):
        resp = api.get(f"{BASE_URL}/api/invoices?limit=1")
        invoices = resp.json() if isinstance(resp.json(), list) else resp.json().get("invoices", [])
        if not invoices:
            pytest.skip("No invoices available")
        invoice_id = invoices[0]["id"]
        
        resp = api.post(f"{BASE_URL}/api/invoices/{invoice_id}/dispute-scan")
        assert resp.status_code == 200
        
    def test_dispute_scan_structure(self, api):
        resp = api.get(f"{BASE_URL}/api/invoices?limit=1")
        invoices = resp.json() if isinstance(resp.json(), list) else resp.json().get("invoices", [])
        if not invoices:
            pytest.skip("No invoices available")
        invoice_id = invoices[0]["id"]
        
        resp = api.post(f"{BASE_URL}/api/invoices/{invoice_id}/dispute-scan")
        data = resp.json()
        assert "flags" in data
        # Model can be "heuristic-only" or "claude-sonnet-4-5"
        assert "model" in data or "error" in data
        print(f"✓ Dispute scan for invoice {invoice_id}: {len(data.get('flags', []))} flags, model={data.get('model', 'N/A')}")
        
    def test_dispute_scan_404(self, api):
        resp = api.post(f"{BASE_URL}/api/invoices/invalid-invoice-id/dispute-scan")
        assert resp.status_code == 404


# ═══════════════════════ REGRESSION TESTS ═══════════════════════

class TestRegressionEndpoints:
    """Regression tests for existing endpoints"""
    
    def test_products_endpoint(self, api):
        resp = api.get(f"{BASE_URL}/api/products")
        assert resp.status_code == 200
        print("✓ /api/products still works")
        
    def test_invoices_endpoint(self, api):
        resp = api.get(f"{BASE_URL}/api/invoices")
        assert resp.status_code == 200
        print("✓ /api/invoices still works")
        
    def test_help_copilot_endpoint(self, api):
        resp = api.post(f"{BASE_URL}/api/help/copilot", json={"question": "How do I create a ticket?"})
        assert resp.status_code == 200
        data = resp.json()
        assert "answer" in data
        print("✓ /api/help/copilot still works")
        
    def test_atmosphere_endpoint(self, api):
        resp = api.get(f"{BASE_URL}/api/atmosphere")
        assert resp.status_code == 200
        print("✓ /api/atmosphere still works")
        
    def test_change_freezes_endpoint(self, api):
        resp = api.get(f"{BASE_URL}/api/change-freezes")
        assert resp.status_code == 200
        print("✓ /api/change-freezes still works")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
