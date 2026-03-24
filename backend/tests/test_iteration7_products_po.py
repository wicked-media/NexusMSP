"""
Iteration 7 Backend API Tests:
- Products CRUD endpoints
- Purchase Orders CRUD endpoints
- Technicians overview route fix verification
- Product categories
- PO stats
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = "https://rmm-psa-build.preview.emergentagent.com"


class TestAuth:
    """Authentication - get token for subsequent tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        return data["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestTechniciansRouting(TestAuth):
    """Verify technician route fix - /api/technicians/overview must return array"""
    
    def test_technicians_overview_returns_array(self, headers):
        """The route fix: /overview must come BEFORE /{tech_id} routes"""
        response = requests.get(f"{BASE_URL}/api/technicians/overview", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"Technicians overview returned {len(data)} technicians")
        
    def test_technicians_overview_has_stats(self, headers):
        """Each technician should have computed stats"""
        response = requests.get(f"{BASE_URL}/api/technicians/overview", headers=headers)
        data = response.json()
        assert len(data) > 0, "No technicians found"
        
        tech = data[0]
        required_fields = ["id", "name", "email", "assigned_count", "open_count", 
                          "no_notes_count", "overdue_count", "resolved_count", "hours_this_week"]
        for field in required_fields:
            assert field in tech, f"Missing field: {field}"
        print(f"First technician: {tech['name']} - open: {tech['open_count']}, no_notes: {tech['no_notes_count']}")
    
    def test_technician_dashboard(self, headers):
        """Test individual technician dashboard"""
        overview = requests.get(f"{BASE_URL}/api/technicians/overview", headers=headers).json()
        if not overview:
            pytest.skip("No technicians available")
        
        tech_id = overview[0]["id"]
        response = requests.get(f"{BASE_URL}/api/technicians/{tech_id}/dashboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "technician" in data
        assert "stats" in data
        assert "open_tickets" in data
        assert "no_notes_tickets" in data
        print(f"Dashboard for {data['technician']['name']}: {data['stats']}")


class TestProductsAPI(TestAuth):
    """Products CRUD operations"""
    
    created_product_id = None
    
    def test_get_products(self, headers):
        """GET /api/products - list all products"""
        response = requests.get(f"{BASE_URL}/api/products", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} products")
    
    def test_get_product_categories(self, headers):
        """GET /api/products/categories - list categories"""
        response = requests.get(f"{BASE_URL}/api/products/categories", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Categories: {data}")
    
    def test_create_product(self, headers):
        """POST /api/products - create new product"""
        unique_sku = f"TEST-{uuid.uuid4().hex[:8].upper()}"
        payload = {
            "name": f"TEST Product {unique_sku}",
            "sku": unique_sku,
            "description": "Test product for iteration 7",
            "category": "Hardware",
            "vendor": "Test Vendor",
            "cost_price": 100.00,
            "retail_price": 150.00,
            "tax_rate": 10.0,
            "quantity_in_stock": 25,
            "reorder_level": 5,
            "unit": "each",
            "is_active": True,
            "is_taxable": True,
            "is_recurring": False
        }
        response = requests.post(f"{BASE_URL}/api/products", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["name"] == payload["name"]
        assert data["sku"] == payload["sku"]
        assert data["cost_price"] == payload["cost_price"]
        TestProductsAPI.created_product_id = data["id"]
        print(f"Created product: {data['name']} (ID: {data['id']})")
    
    def test_get_product_by_id(self, headers):
        """GET /api/products/{id} - get single product"""
        if not TestProductsAPI.created_product_id:
            pytest.skip("No product created")
        
        response = requests.get(f"{BASE_URL}/api/products/{TestProductsAPI.created_product_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == TestProductsAPI.created_product_id
        print(f"Retrieved product: {data['name']}")
    
    def test_update_product(self, headers):
        """PUT /api/products/{id} - update product"""
        if not TestProductsAPI.created_product_id:
            pytest.skip("No product created")
        
        payload = {
            "name": "TEST Product UPDATED",
            "retail_price": 175.00,
            "quantity_in_stock": 30
        }
        response = requests.put(f"{BASE_URL}/api/products/{TestProductsAPI.created_product_id}", 
                               json=payload, headers=headers)
        assert response.status_code == 200
        
        # Verify update persisted
        verify = requests.get(f"{BASE_URL}/api/products/{TestProductsAPI.created_product_id}", headers=headers)
        data = verify.json()
        assert data["name"] == "TEST Product UPDATED"
        assert data["retail_price"] == 175.00
        assert data["quantity_in_stock"] == 30
        print(f"Updated product: {data['name']}, price: ${data['retail_price']}")
    
    def test_search_products(self, headers):
        """GET /api/products?search= - search functionality"""
        response = requests.get(f"{BASE_URL}/api/products?search=TEST", headers=headers)
        assert response.status_code == 200
        data = response.json()
        print(f"Search 'TEST' returned {len(data)} products")
    
    def test_filter_products_by_category(self, headers):
        """GET /api/products?category= - filter by category"""
        response = requests.get(f"{BASE_URL}/api/products?category=Hardware", headers=headers)
        assert response.status_code == 200
        data = response.json()
        for product in data:
            assert product["category"] == "Hardware"
        print(f"Hardware category has {len(data)} products")
    
    def test_delete_product(self, headers):
        """DELETE /api/products/{id} - delete product"""
        if not TestProductsAPI.created_product_id:
            pytest.skip("No product created")
        
        response = requests.delete(f"{BASE_URL}/api/products/{TestProductsAPI.created_product_id}", headers=headers)
        assert response.status_code == 200
        
        # Verify deletion
        verify = requests.get(f"{BASE_URL}/api/products/{TestProductsAPI.created_product_id}", headers=headers)
        assert verify.status_code == 404
        print("Product deleted successfully")


class TestPurchaseOrdersAPI(TestAuth):
    """Purchase Orders CRUD operations"""
    
    created_po_id = None
    product_for_po = None
    
    def test_get_purchase_orders_stats(self, headers):
        """GET /api/purchase-orders/stats - get PO statistics"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders/stats", headers=headers)
        assert response.status_code == 200
        data = response.json()
        required_fields = ["total", "draft", "submitted", "received", "total_value", "pending_value"]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"
        print(f"PO Stats: total={data['total']}, draft={data['draft']}, total_value=${data['total_value']}")
    
    def test_get_purchase_orders(self, headers):
        """GET /api/purchase-orders - list all POs"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} purchase orders")
    
    def test_create_purchase_order_with_line_items(self, headers):
        """POST /api/purchase-orders - create PO with line items"""
        # First create a product for the line item
        product_payload = {
            "name": "TEST_PO_Product",
            "sku": f"TEST-PO-{uuid.uuid4().hex[:6].upper()}",
            "category": "Hardware",
            "vendor": "Test Vendor",
            "cost_price": 500.00,
            "retail_price": 700.00,
            "tax_rate": 8.0,
            "quantity_in_stock": 10,
            "is_active": True
        }
        prod_response = requests.post(f"{BASE_URL}/api/products", json=product_payload, headers=headers)
        assert prod_response.status_code == 200
        product = prod_response.json()
        TestPurchaseOrdersAPI.product_for_po = product["id"]
        
        # Create PO with line item
        po_payload = {
            "vendor": "TEST Dell Technologies",
            "vendor_contact": "John Smith",
            "vendor_email": "vendor@dell.com",
            "status": "draft",
            "line_items": [
                {
                    "product_id": product["id"],
                    "product_name": product["name"],
                    "quantity": 5,
                    "unit_price": 500.00
                }
            ],
            "subtotal": 2500.00,
            "tax": 200.00,
            "shipping": 50.00,
            "total": 2750.00,
            "notes": "Test purchase order",
            "ship_to": "123 Test Street",
            "expected_delivery": "2026-04-01"
        }
        response = requests.post(f"{BASE_URL}/api/purchase-orders", json=po_payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "po_number" in data
        assert data["vendor"] == po_payload["vendor"]
        assert len(data["line_items"]) == 1
        assert data["total"] == 2750.00
        TestPurchaseOrdersAPI.created_po_id = data["id"]
        print(f"Created PO: {data['po_number']} (ID: {data['id']})")
    
    def test_get_purchase_order_by_id(self, headers):
        """GET /api/purchase-orders/{id} - get single PO"""
        if not TestPurchaseOrdersAPI.created_po_id:
            pytest.skip("No PO created")
        
        response = requests.get(f"{BASE_URL}/api/purchase-orders/{TestPurchaseOrdersAPI.created_po_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == TestPurchaseOrdersAPI.created_po_id
        print(f"Retrieved PO: {data['po_number']}")
    
    def test_update_purchase_order_status_draft_to_submitted(self, headers):
        """PUT /api/purchase-orders/{id} - status workflow draft -> submitted"""
        if not TestPurchaseOrdersAPI.created_po_id:
            pytest.skip("No PO created")
        
        response = requests.put(f"{BASE_URL}/api/purchase-orders/{TestPurchaseOrdersAPI.created_po_id}", 
                               json={"status": "submitted"}, headers=headers)
        assert response.status_code == 200
        
        # Verify update
        verify = requests.get(f"{BASE_URL}/api/purchase-orders/{TestPurchaseOrdersAPI.created_po_id}", headers=headers)
        data = verify.json()
        assert data["status"] == "submitted"
        print("PO status updated to 'submitted'")
    
    def test_update_purchase_order_status_submitted_to_received(self, headers):
        """PUT /api/purchase-orders/{id} - status workflow submitted -> received"""
        if not TestPurchaseOrdersAPI.created_po_id:
            pytest.skip("No PO created")
        
        response = requests.put(f"{BASE_URL}/api/purchase-orders/{TestPurchaseOrdersAPI.created_po_id}", 
                               json={"status": "received"}, headers=headers)
        assert response.status_code == 200
        
        # Verify update
        verify = requests.get(f"{BASE_URL}/api/purchase-orders/{TestPurchaseOrdersAPI.created_po_id}", headers=headers)
        data = verify.json()
        assert data["status"] == "received"
        print("PO status updated to 'received'")
    
    def test_search_purchase_orders(self, headers):
        """GET /api/purchase-orders?search= - search POs"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders?search=TEST", headers=headers)
        assert response.status_code == 200
        data = response.json()
        print(f"Search 'TEST' returned {len(data)} POs")
    
    def test_filter_purchase_orders_by_status(self, headers):
        """GET /api/purchase-orders?status= - filter by status"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders?status=received", headers=headers)
        assert response.status_code == 200
        data = response.json()
        for po in data:
            assert po["status"] == "received"
        print(f"Status 'received' filter returned {len(data)} POs")
    
    def test_delete_purchase_order(self, headers):
        """DELETE /api/purchase-orders/{id} - delete PO"""
        if not TestPurchaseOrdersAPI.created_po_id:
            pytest.skip("No PO created")
        
        response = requests.delete(f"{BASE_URL}/api/purchase-orders/{TestPurchaseOrdersAPI.created_po_id}", headers=headers)
        assert response.status_code == 200
        
        # Verify deletion
        verify = requests.get(f"{BASE_URL}/api/purchase-orders/{TestPurchaseOrdersAPI.created_po_id}", headers=headers)
        assert verify.status_code == 404
        print("PO deleted successfully")
    
    def test_cleanup_test_product(self, headers):
        """Cleanup: delete the product created for PO testing"""
        if TestPurchaseOrdersAPI.product_for_po:
            requests.delete(f"{BASE_URL}/api/products/{TestPurchaseOrdersAPI.product_for_po}", headers=headers)
            print("Test product cleaned up")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
