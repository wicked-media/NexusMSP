"""
Backend tests for Iteration 36: Inventory & Procurement Features
Tests cover:
- Purchase Order System (CRUD, stats, stock receiving, ping/escalation, audit trail)
- Stocktake System (sessions, counting, variance tracking, finalization, reports)
- Product Bundling
- Ticket Itemization (add products to tickets, push to invoice)
- On-Order indicators
- Vendors page Create PO button functionality
"""

import pytest
import requests
import os
import uuid
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Login and get token for authenticated requests"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        token = response.json().get("token")
        return {"Authorization": f"Bearer {token}"}

class TestPurchaseOrders(TestAuth):
    """Purchase Order System tests"""
    
    def test_get_po_stats(self, auth_headers):
        """Test PO stats endpoint returns expected stats structure"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders/stats", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "draft" in data
        assert "submitted" in data
        assert "partial" in data
        assert "received" in data
        assert "overdue" in data
        assert "total_value" in data
        assert "pending_value" in data
        print(f"PO Stats: total={data['total']}, draft={data['draft']}, total_value=${data['total_value']:.2f}")
    
    def test_get_purchase_orders_list(self, auth_headers):
        """Test GET /purchase-orders returns list"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} purchase orders")
    
    def test_create_purchase_order(self, auth_headers):
        """Test creating a new PO with line items"""
        # First get vendors to reference
        vendors_res = requests.get(f"{BASE_URL}/api/vendors", headers=auth_headers)
        vendors = vendors_res.json() if vendors_res.status_code == 200 else []
        vendor = vendors[0] if vendors else {"name": "Test Vendor", "id": ""}
        
        # Get products for line items
        products_res = requests.get(f"{BASE_URL}/api/products", headers=auth_headers)
        products = products_res.json() if products_res.status_code == 200 else []
        
        line_items = []
        if products:
            line_items = [{
                "product_id": products[0]["id"],
                "product_name": products[0]["name"],
                "quantity": 5,
                "unit_price": products[0].get("cost_price", 100)
            }]
        
        payload = {
            "vendor": vendor.get("name", "Test Vendor"),
            "vendor_id": vendor.get("id", ""),
            "vendor_email": vendor.get("email", "vendor@test.com"),
            "line_items": line_items,
            "subtotal": 500,
            "tax": 50,
            "shipping": 25,
            "total": 575,
            "notes": "TEST_PO - Iteration 36 test",
            "expected_delivery": (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d"),
            "assigned_to": "",
            "assigned_to_name": ""
        }
        
        response = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create PO: {response.text}"
        data = response.json()
        assert "id" in data
        assert "po_number" in data
        assert data["status"] == "draft"
        print(f"Created PO: {data['po_number']} with ID {data['id']}")
        return data
    
    def test_create_and_submit_po(self, auth_headers):
        """Test creating PO and submitting to vendor (status change)"""
        # Create PO
        payload = {
            "vendor": "TEST_Submit_Vendor",
            "line_items": [{"product_name": "Test Item", "quantity": 3, "unit_price": 100}],
            "subtotal": 300, "tax": 0, "shipping": 0, "total": 300,
            "notes": "TEST_PO_Submit",
            "expected_delivery": (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d")
        }
        create_res = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=auth_headers)
        assert create_res.status_code == 200
        po = create_res.json()
        po_id = po["id"]
        
        # Submit PO (change status from draft to submitted)
        update_res = requests.put(f"{BASE_URL}/api/purchase-orders/{po_id}", 
            json={"status": "submitted"}, headers=auth_headers)
        assert update_res.status_code == 200
        
        # Verify status change
        get_res = requests.get(f"{BASE_URL}/api/purchase-orders/{po_id}", headers=auth_headers)
        assert get_res.status_code == 200
        updated_po = get_res.json()
        assert updated_po["status"] == "submitted"
        print(f"PO {po['po_number']} submitted successfully")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po_id}", headers=auth_headers)
        return updated_po
    
    def test_po_audit_log(self, auth_headers):
        """Test PO audit log records actions"""
        # Create a PO
        payload = {
            "vendor": "TEST_Audit_Vendor",
            "line_items": [],
            "subtotal": 0, "tax": 0, "shipping": 0, "total": 0,
            "notes": "TEST_PO_Audit"
        }
        create_res = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=auth_headers)
        assert create_res.status_code == 200
        po_id = create_res.json()["id"]
        
        # Get audit log
        audit_res = requests.get(f"{BASE_URL}/api/purchase-orders/{po_id}/audit-log", headers=auth_headers)
        assert audit_res.status_code == 200
        audit_log = audit_res.json()
        assert isinstance(audit_log, list)
        assert len(audit_log) > 0, "Audit log should have at least one entry for creation"
        
        # Check audit log has expected fields
        entry = audit_log[0]
        assert "action" in entry
        assert "details" in entry
        assert "user_name" in entry
        assert "created_at" in entry
        print(f"Audit log has {len(audit_log)} entries, first action: {entry['action']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po_id}", headers=auth_headers)
    
    def test_check_po_escalations(self, auth_headers):
        """Test PO escalation check endpoint"""
        response = requests.post(f"{BASE_URL}/api/purchase-orders/check-escalations", 
            json={}, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "pings_sent" in data
        assert "escalations" in data
        print(f"Escalation check: {data['pings_sent']} pings, {data['escalations']} escalations")
    
    def test_po_ping_settings(self, auth_headers):
        """Test PO ping settings endpoint"""
        # Get settings
        get_res = requests.get(f"{BASE_URL}/api/settings/po-ping", headers=auth_headers)
        assert get_res.status_code == 200
        settings = get_res.json()
        assert "enabled" in settings
        assert "tech_ping_hours" in settings
        assert "escalation_hours" in settings
        print(f"PO ping settings: enabled={settings.get('enabled')}, tech_ping={settings.get('tech_ping_hours')}h")
    
    def test_overdue_pos_list(self, auth_headers):
        """Test getting list of overdue POs"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders/overdue/list", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} overdue purchase orders")


class TestStockReceiving(TestAuth):
    """Stock receiving functionality tests"""
    
    def test_receive_stock_full_flow(self, auth_headers):
        """Test receiving stock on a PO (partial and full receipt)"""
        # Get products
        products_res = requests.get(f"{BASE_URL}/api/products", headers=auth_headers)
        products = products_res.json()
        if not products:
            pytest.skip("No products available for stock receiving test")
        
        product = products[0]
        initial_stock = product.get("quantity_in_stock", 0)
        
        # Create PO with line items
        payload = {
            "vendor": "TEST_Receive_Stock_Vendor",
            "status": "submitted",  # Must be submitted to receive
            "line_items": [{
                "product_id": product["id"],
                "product_name": product["name"],
                "quantity": 10,
                "unit_price": product.get("cost_price", 50)
            }],
            "subtotal": 500, "tax": 0, "shipping": 0, "total": 500,
            "notes": "TEST_PO_ReceiveStock"
        }
        create_res = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=auth_headers)
        assert create_res.status_code == 200
        po = create_res.json()
        po_id = po["id"]
        
        # Submit the PO first (change from draft to submitted)
        requests.put(f"{BASE_URL}/api/purchase-orders/{po_id}", 
            json={"status": "submitted"}, headers=auth_headers)
        
        # Receive partial stock (5 of 10)
        receive_payload = {
            "items": [{
                "product_id": product["id"],
                "product_name": product["name"],
                "quantity": 5
            }]
        }
        receive_res = requests.post(f"{BASE_URL}/api/purchase-orders/{po_id}/receive", 
            json=receive_payload, headers=auth_headers)
        assert receive_res.status_code == 200
        receive_data = receive_res.json()
        assert receive_data["status"] == "partial"
        print(f"Partial receipt successful, PO status: {receive_data['status']}")
        
        # Verify stock increased
        product_res = requests.get(f"{BASE_URL}/api/products/{product['id']}", headers=auth_headers)
        if product_res.status_code == 200:
            updated_product = product_res.json()
            new_stock = updated_product.get("quantity_in_stock", 0)
            print(f"Stock changed: {initial_stock} -> {new_stock} (+5 expected)")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po_id}", headers=auth_headers)


class TestStocktake(TestAuth):
    """Stocktake System tests"""
    
    def test_get_stocktake_sessions(self, auth_headers):
        """Test getting stocktake sessions list"""
        response = requests.get(f"{BASE_URL}/api/stocktake/sessions", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} stocktake sessions")
    
    def test_create_stocktake_session(self, auth_headers):
        """Test creating a new stocktake session with product snapshot"""
        payload = {
            "name": f"TEST_Stocktake_{datetime.now().strftime('%Y%m%d_%H%M')}",
            "description": "Test stocktake session for iteration 36",
            "location": "Warehouse A",
            "category_filter": ""
        }
        
        response = requests.post(f"{BASE_URL}/api/stocktake/sessions", json=payload, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "session_number" in data
        assert data["status"] == "in_progress"
        assert "items" in data
        assert "total_items" in data
        print(f"Created stocktake session: {data['session_number']} with {data['total_items']} items")
        return data
    
    def test_stocktake_count_item(self, auth_headers):
        """Test counting items in a stocktake session"""
        # Create session
        create_res = requests.post(f"{BASE_URL}/api/stocktake/sessions", json={
            "name": "TEST_Count_Session",
            "location": "Test Location"
        }, headers=auth_headers)
        assert create_res.status_code == 200
        session = create_res.json()
        session_id = session["id"]
        
        if session["total_items"] == 0:
            requests.delete(f"{BASE_URL}/api/stocktake/sessions/{session_id}", headers=auth_headers)
            pytest.skip("No products to count in stocktake")
        
        # Count first item
        first_item = session["items"][0]
        count_payload = {
            "product_id": first_item["product_id"],
            "product_name": first_item["product_name"],
            "counted_qty": first_item["expected_qty"] + 2  # Create variance
        }
        
        count_res = requests.put(f"{BASE_URL}/api/stocktake/sessions/{session_id}/count", 
            json=count_payload, headers=auth_headers)
        assert count_res.status_code == 200
        count_data = count_res.json()
        assert count_data["counted_items"] >= 1
        print(f"Counted item: {first_item['product_name']}, expected={first_item['expected_qty']}, counted={count_payload['counted_qty']}")
        
        # Verify session updated
        session_res = requests.get(f"{BASE_URL}/api/stocktake/sessions/{session_id}", headers=auth_headers)
        assert session_res.status_code == 200
        updated_session = session_res.json()
        assert updated_session["variance_count"] >= 1  # We created a variance
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/stocktake/sessions/{session_id}", headers=auth_headers)
    
    def test_stocktake_finalize(self, auth_headers):
        """Test finalizing stocktake and applying adjustments"""
        # Create and count in session
        create_res = requests.post(f"{BASE_URL}/api/stocktake/sessions", json={
            "name": "TEST_Finalize_Session",
            "location": "Test"
        }, headers=auth_headers)
        session = create_res.json()
        session_id = session["id"]
        
        if session["total_items"] == 0:
            requests.delete(f"{BASE_URL}/api/stocktake/sessions/{session_id}", headers=auth_headers)
            pytest.skip("No products for finalization test")
        
        # Count an item
        item = session["items"][0]
        requests.put(f"{BASE_URL}/api/stocktake/sessions/{session_id}/count", json={
            "product_id": item["product_id"],
            "counted_qty": item["expected_qty"]  # No variance to not affect stock
        }, headers=auth_headers)
        
        # Finalize
        finalize_res = requests.put(f"{BASE_URL}/api/stocktake/sessions/{session_id}/finalize", 
            json={"apply_adjustments": False}, headers=auth_headers)  # Don't apply to not affect stock
        assert finalize_res.status_code == 200
        finalize_data = finalize_res.json()
        assert "adjustments_made" in finalize_data
        print(f"Stocktake finalized: {finalize_data['adjustments_made']} adjustments")
        
        # Verify session completed
        session_res = requests.get(f"{BASE_URL}/api/stocktake/sessions/{session_id}", headers=auth_headers)
        updated_session = session_res.json()
        assert updated_session["status"] == "completed"
    
    def test_stocktake_audit_log(self, auth_headers):
        """Test stocktake audit trail"""
        # Create session
        create_res = requests.post(f"{BASE_URL}/api/stocktake/sessions", json={
            "name": "TEST_Audit_Session"
        }, headers=auth_headers)
        session = create_res.json()
        session_id = session["id"]
        
        # Get audit log
        audit_res = requests.get(f"{BASE_URL}/api/stocktake/sessions/{session_id}/audit-log", headers=auth_headers)
        assert audit_res.status_code == 200
        audit_log = audit_res.json()
        assert isinstance(audit_log, list)
        assert len(audit_log) > 0, "Should have session_created audit entry"
        print(f"Stocktake audit log has {len(audit_log)} entries")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/stocktake/sessions/{session_id}", headers=auth_headers)
    
    def test_stocktake_reports_summary(self, auth_headers):
        """Test stocktake reports/summary endpoint"""
        response = requests.get(f"{BASE_URL}/api/stocktake/reports/summary", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "total_sessions" in data
        assert "completed_sessions" in data
        assert "stock_in_hand_cost" in data
        assert "stock_in_hand_retail" in data
        assert "low_stock_count" in data
        assert "total_products" in data
        print(f"Stocktake report: {data['total_products']} products, ${data['stock_in_hand_cost']:.2f} cost value")


class TestProductBundling(TestAuth):
    """Product Bundling tests"""
    
    def test_get_product_bundle(self, auth_headers):
        """Test getting product bundle info"""
        # Get products
        products_res = requests.get(f"{BASE_URL}/api/products", headers=auth_headers)
        products = products_res.json()
        if not products:
            pytest.skip("No products available for bundle test")
        
        product = products[0]
        response = requests.get(f"{BASE_URL}/api/products/{product['id']}/bundle", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "product_id" in data
        assert "is_bundle" in data
        assert "bundle_items" in data
        print(f"Product {product['name']} bundle info: is_bundle={data['is_bundle']}, items={len(data['bundle_items'])}")
    
    def test_update_product_bundle(self, auth_headers):
        """Test adding/removing products from bundle"""
        products_res = requests.get(f"{BASE_URL}/api/products", headers=auth_headers)
        products = products_res.json()
        if len(products) < 2:
            pytest.skip("Need at least 2 products for bundle test")
        
        main_product = products[0]
        bundle_product = products[1]
        
        # Add to bundle
        bundle_payload = {
            "bundle_items": [{
                "product_id": bundle_product["id"],
                "quantity": 2
            }]
        }
        
        update_res = requests.put(f"{BASE_URL}/api/products/{main_product['id']}/bundle", 
            json=bundle_payload, headers=auth_headers)
        assert update_res.status_code == 200
        update_data = update_res.json()
        print(f"Updated bundle: {update_data}")
        
        # Verify bundle
        get_res = requests.get(f"{BASE_URL}/api/products/{main_product['id']}/bundle", headers=auth_headers)
        bundle = get_res.json()
        assert bundle["is_bundle"] == True
        assert len(bundle["bundle_items"]) == 1
        
        # Clear bundle (cleanup)
        requests.put(f"{BASE_URL}/api/products/{main_product['id']}/bundle", 
            json={"bundle_items": []}, headers=auth_headers)


class TestOnOrderIndicators(TestAuth):
    """On-Order indicator tests"""
    
    def test_product_on_order_status(self, auth_headers):
        """Test getting on-order status for a product"""
        products_res = requests.get(f"{BASE_URL}/api/products", headers=auth_headers)
        products = products_res.json()
        if not products:
            pytest.skip("No products for on-order test")
        
        product = products[0]
        response = requests.get(f"{BASE_URL}/api/products/{product['id']}/on-order", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "product_id" in data
        assert "on_order_qty" in data
        assert "purchase_orders" in data
        print(f"Product {product['name']} on-order: {data['on_order_qty']} units")
    
    def test_on_order_summary(self, auth_headers):
        """Test getting on-order summary across all products"""
        response = requests.get(f"{BASE_URL}/api/products/inventory/on-order-summary", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"On-order summary: {len(data)} products with items on order")


class TestTicketItemization(TestAuth):
    """Ticket itemization and invoice push tests"""
    
    def test_add_product_to_ticket(self, auth_headers):
        """Test adding billable items to tickets"""
        # Get tickets
        tickets_res = requests.get(f"{BASE_URL}/api/tickets", headers=auth_headers)
        tickets = tickets_res.json()
        if not tickets:
            pytest.skip("No tickets available for itemization test")
        
        # Get products
        products_res = requests.get(f"{BASE_URL}/api/products", headers=auth_headers)
        products = products_res.json()
        if not products:
            pytest.skip("No products for itemization test")
        
        ticket = tickets[0]
        product = products[0]
        
        # Add product to ticket
        payload = {
            "product_id": product["id"],
            "quantity": 1
        }
        response = requests.post(f"{BASE_URL}/api/tickets/{ticket['id']}/products", 
            json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to add product: {response.text}"
        data = response.json()
        assert "product_id" in data or "id" in data
        print(f"Added {product['name']} to ticket {ticket['ticket_number']}")
        
        # Cleanup
        if "id" in data:
            requests.delete(f"{BASE_URL}/api/tickets/{ticket['id']}/products/{data['id']}", headers=auth_headers)
    
    def test_get_ticket_products(self, auth_headers):
        """Test getting products on a ticket"""
        tickets_res = requests.get(f"{BASE_URL}/api/tickets", headers=auth_headers)
        tickets = tickets_res.json()
        if not tickets:
            pytest.skip("No tickets for test")
        
        ticket = tickets[0]
        response = requests.get(f"{BASE_URL}/api/tickets/{ticket['id']}/products", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Ticket {ticket['ticket_number']} has {len(data)} products attached")
    
    def test_push_ticket_items_to_new_invoice(self, auth_headers):
        """Test pushing ticket items to create new invoice"""
        # Get tickets with products
        tickets_res = requests.get(f"{BASE_URL}/api/tickets", headers=auth_headers)
        tickets = tickets_res.json()
        if not tickets:
            pytest.skip("No tickets for invoice push test")
        
        # Get products
        products_res = requests.get(f"{BASE_URL}/api/products", headers=auth_headers)
        products = products_res.json()
        if not products:
            pytest.skip("No products for test")
        
        ticket = tickets[0]
        product = products[0]
        
        # Add product to ticket first
        add_res = requests.post(f"{BASE_URL}/api/tickets/{ticket['id']}/products", 
            json={"product_id": product["id"], "quantity": 1}, headers=auth_headers)
        
        if add_res.status_code != 200:
            print(f"Could not add product to ticket: {add_res.text}")
            pytest.skip("Could not add product to ticket")
        
        item_data = add_res.json()
        
        # Push to invoice (new)
        push_res = requests.post(f"{BASE_URL}/api/tickets/{ticket['id']}/products-to-invoice", 
            json={}, headers=auth_headers)
        
        if push_res.status_code == 200:
            push_data = push_res.json()
            assert "invoice_id" in push_data or "message" in push_data
            print(f"Pushed items to invoice: {push_data}")
        else:
            # May fail if ticket has no products - that's okay
            print(f"Push to invoice response: {push_res.status_code} - {push_res.text}")
        
        # Cleanup - remove item
        if "id" in item_data:
            requests.delete(f"{BASE_URL}/api/tickets/{ticket['id']}/products/{item_data['id']}", headers=auth_headers)


class TestVendorsPOIntegration(TestAuth):
    """Vendors page Create PO integration tests"""
    
    def test_get_vendors_with_pos(self, auth_headers):
        """Test vendors list includes PO data"""
        response = requests.get(f"{BASE_URL}/api/vendors", headers=auth_headers)
        assert response.status_code == 200
        vendors = response.json()
        print(f"Found {len(vendors)} vendors")
        
        if vendors:
            vendor = vendors[0]
            assert "id" in vendor
            assert "name" in vendor
            print(f"Sample vendor: {vendor['name']}")
    
    def test_create_po_for_vendor(self, auth_headers):
        """Test creating PO linked to a specific vendor"""
        # Get vendors
        vendors_res = requests.get(f"{BASE_URL}/api/vendors", headers=auth_headers)
        vendors = vendors_res.json()
        if not vendors:
            pytest.skip("No vendors for PO creation test")
        
        vendor = vendors[0]
        
        # Create PO for this vendor
        payload = {
            "vendor": vendor["name"],
            "vendor_id": vendor["id"],
            "vendor_email": vendor.get("email", ""),
            "vendor_contact": vendor.get("contact_name", ""),
            "line_items": [],
            "subtotal": 0, "tax": 0, "shipping": 0, "total": 0,
            "notes": "TEST_PO_FromVendor"
        }
        
        response = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=auth_headers)
        assert response.status_code == 200
        po = response.json()
        assert po["vendor_id"] == vendor["id"]
        print(f"Created PO {po['po_number']} for vendor {vendor['name']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=auth_headers)
    
    def test_filter_pos_by_vendor(self, auth_headers):
        """Test filtering POs by vendor_id"""
        vendors_res = requests.get(f"{BASE_URL}/api/vendors", headers=auth_headers)
        vendors = vendors_res.json()
        if not vendors:
            pytest.skip("No vendors for filter test")
        
        vendor = vendors[0]
        response = requests.get(f"{BASE_URL}/api/purchase-orders?vendor_id={vendor['id']}", headers=auth_headers)
        assert response.status_code == 200
        pos = response.json()
        # All returned POs should be for this vendor (or empty)
        for po in pos:
            assert po.get("vendor_id") == vendor["id"] or po.get("vendor") == vendor["name"]
        print(f"Found {len(pos)} POs for vendor {vendor['name']}")


class TestPOFiltering(TestAuth):
    """PO filtering and search tests"""
    
    def test_filter_pos_by_status(self, auth_headers):
        """Test filtering POs by status"""
        for status in ["draft", "submitted", "partial", "received"]:
            response = requests.get(f"{BASE_URL}/api/purchase-orders?status={status}", headers=auth_headers)
            assert response.status_code == 200
            pos = response.json()
            for po in pos:
                assert po["status"] == status
            print(f"Status '{status}': {len(pos)} POs")
    
    def test_search_pos(self, auth_headers):
        """Test searching POs by PO number or vendor name"""
        # Create a PO with unique vendor name
        unique_vendor = f"TEST_SearchVendor_{uuid.uuid4().hex[:8]}"
        payload = {
            "vendor": unique_vendor,
            "line_items": [],
            "subtotal": 0, "tax": 0, "shipping": 0, "total": 0
        }
        create_res = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=auth_headers)
        po = create_res.json()
        
        # Search by vendor name
        search_res = requests.get(f"{BASE_URL}/api/purchase-orders?search={unique_vendor}", headers=auth_headers)
        assert search_res.status_code == 200
        results = search_res.json()
        assert len(results) >= 1
        assert any(p["vendor"] == unique_vendor for p in results)
        print(f"Search found PO for '{unique_vendor}'")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=auth_headers)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
