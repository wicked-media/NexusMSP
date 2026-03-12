"""
Iteration 15 Tests: Products Module with Stock/Barcode + Networking (UniFi) Module
Tests cover:
- Products CRUD with barcode generation
- Stock movements (in/out/adjustment)
- Product instances with unique barcodes
- Product label endpoints
- Networking sites list and detail
- Networking devices and clients
- Networking stats
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication helper tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Login and get authentication token"""
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
        """Return auth headers"""
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestProductsEndpoints(TestAuth):
    """Products module API tests"""
    
    def test_get_products_list(self, headers):
        """Test GET /api/products returns product list"""
        response = requests.get(f"{BASE_URL}/api/products", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Products count: {len(data)}")
        if len(data) > 0:
            product = data[0]
            assert "id" in product
            assert "name" in product
            assert "sku" in product
            assert "retail_price" in product
            assert "quantity_in_stock" in product
            print(f"Sample product: {product['name']}, SKU: {product.get('sku')}, Barcode: {product.get('barcode')}")
    
    def test_get_product_categories(self, headers):
        """Test GET /api/products/categories"""
        response = requests.get(f"{BASE_URL}/api/products/categories", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Categories: {data}")
    
    def test_product_search_filter(self, headers):
        """Test GET /api/products with search parameter"""
        response = requests.get(f"{BASE_URL}/api/products?search=Dell", headers=headers)
        assert response.status_code == 200
        data = response.json()
        print(f"Search 'Dell' returned {len(data)} products")
    
    def test_product_category_filter(self, headers):
        """Test GET /api/products with category filter"""
        response = requests.get(f"{BASE_URL}/api/products?category=Hardware", headers=headers)
        assert response.status_code == 200
        data = response.json()
        print(f"Category 'Hardware' returned {len(data)} products")
    
    def test_create_product(self, headers):
        """Test POST /api/products - create new product"""
        unique_id = str(uuid.uuid4())[:8]
        payload = {
            "name": f"TEST_Product_{unique_id}",
            "sku": f"TST-{unique_id}",
            "description": "Test product for automation",
            "category": "Hardware",
            "vendor": "Test Vendor",
            "cost_price": 100.00,
            "retail_price": 150.00,
            "tax_rate": 10,
            "quantity_in_stock": 25,
            "reorder_level": 10,
            "unit": "each",
            "is_active": True,
            "is_taxable": True,
            "is_recurring": False
        }
        response = requests.post(f"{BASE_URL}/api/products", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == payload["name"]
        assert data["sku"] == payload["sku"]
        assert "id" in data
        assert "barcode" in data
        print(f"Created product: {data['name']}, ID: {data['id']}, Barcode: {data.get('barcode')}")
        return data["id"]
    
    def test_get_single_product(self, headers):
        """Test GET /api/products/{product_id}"""
        # First get list to find a product
        list_response = requests.get(f"{BASE_URL}/api/products", headers=headers)
        products = list_response.json()
        if len(products) > 0:
            product_id = products[0]["id"]
            response = requests.get(f"{BASE_URL}/api/products/{product_id}", headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert data["id"] == product_id
            print(f"Got product: {data['name']}")
    
    def test_update_product(self, headers):
        """Test PUT /api/products/{product_id}"""
        # Get a product to update
        list_response = requests.get(f"{BASE_URL}/api/products?search=TEST_", headers=headers)
        products = list_response.json()
        if len(products) > 0:
            product_id = products[0]["id"]
            payload = {
                "name": products[0]["name"] + " UPDATED",
                "retail_price": 175.00
            }
            response = requests.put(f"{BASE_URL}/api/products/{product_id}", json=payload, headers=headers)
            assert response.status_code == 200
            # Verify update
            get_response = requests.get(f"{BASE_URL}/api/products/{product_id}", headers=headers)
            updated = get_response.json()
            assert "UPDATED" in updated["name"]
            print(f"Updated product: {updated['name']}")


class TestProductBarcodeEndpoints(TestAuth):
    """Product barcode and label tests"""
    
    def test_generate_barcode(self, headers):
        """Test POST /api/products/{product_id}/generate-barcode"""
        list_response = requests.get(f"{BASE_URL}/api/products", headers=headers)
        products = list_response.json()
        if len(products) > 0:
            product_id = products[0]["id"]
            payload = {"barcode_value": f"BC-{product_id[:8]}", "barcode_type": "code128"}
            response = requests.post(f"{BASE_URL}/api/products/{product_id}/generate-barcode", json=payload, headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert "barcode" in data
            assert "barcode_image" in data
            print(f"Generated barcode: {data['barcode']}")
    
    def test_get_product_barcode(self, headers):
        """Test GET /api/products/{product_id}/barcode"""
        list_response = requests.get(f"{BASE_URL}/api/products", headers=headers)
        products = list_response.json()
        if len(products) > 0:
            product_id = products[0]["id"]
            response = requests.get(f"{BASE_URL}/api/products/{product_id}/barcode", headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert "barcode" in data or "name" in data
            print(f"Product barcode info retrieved")
    
    def test_get_product_label(self, headers):
        """Test GET /api/products/{product_id}/label"""
        list_response = requests.get(f"{BASE_URL}/api/products", headers=headers)
        products = list_response.json()
        if len(products) > 0:
            product_id = products[0]["id"]
            response = requests.get(f"{BASE_URL}/api/products/{product_id}/label", headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert "product_name" in data
            assert "barcode" in data
            print(f"Label data: {data['product_name']}, barcode: {data['barcode']}")


class TestStockMovements(TestAuth):
    """Stock movement and inventory tests"""
    
    def test_create_stock_movement_in(self, headers):
        """Test POST /api/products/{product_id}/stock-movement - Stock In"""
        list_response = requests.get(f"{BASE_URL}/api/products", headers=headers)
        products = list_response.json()
        if len(products) > 0:
            product_id = products[0]["id"]
            original_stock = products[0].get("quantity_in_stock", 0)
            payload = {
                "type": "in",
                "quantity": 5,
                "reason": "Test stock in from automation"
            }
            response = requests.post(f"{BASE_URL}/api/products/{product_id}/stock-movement", json=payload, headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert data["type"] == "in"
            assert data["quantity"] == 5
            assert data["new_stock"] == original_stock + 5
            print(f"Stock in: {original_stock} -> {data['new_stock']}")
    
    def test_create_stock_movement_out(self, headers):
        """Test POST /api/products/{product_id}/stock-movement - Stock Out"""
        list_response = requests.get(f"{BASE_URL}/api/products", headers=headers)
        products = list_response.json()
        if len(products) > 0:
            product_id = products[0]["id"]
            original_stock = products[0].get("quantity_in_stock", 0)
            payload = {
                "type": "out",
                "quantity": 2,
                "reason": "Test stock out from automation"
            }
            response = requests.post(f"{BASE_URL}/api/products/{product_id}/stock-movement", json=payload, headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert data["type"] == "out"
            print(f"Stock out: {data['previous_stock']} -> {data['new_stock']}")
    
    def test_create_stock_adjustment(self, headers):
        """Test POST /api/products/{product_id}/stock-movement - Adjustment"""
        list_response = requests.get(f"{BASE_URL}/api/products", headers=headers)
        products = list_response.json()
        if len(products) > 0:
            product_id = products[0]["id"]
            payload = {
                "type": "adjustment",
                "quantity": 50,
                "reason": "Inventory count correction"
            }
            response = requests.post(f"{BASE_URL}/api/products/{product_id}/stock-movement", json=payload, headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert data["new_stock"] == 50
            print(f"Stock adjustment set to: {data['new_stock']}")
    
    def test_get_stock_movements(self, headers):
        """Test GET /api/products/{product_id}/stock-movements"""
        list_response = requests.get(f"{BASE_URL}/api/products", headers=headers)
        products = list_response.json()
        if len(products) > 0:
            product_id = products[0]["id"]
            response = requests.get(f"{BASE_URL}/api/products/{product_id}/stock-movements", headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            print(f"Stock movements count: {len(data)}")
            if len(data) > 0:
                movement = data[0]
                assert "type" in movement
                assert "quantity" in movement
                assert "created_at" in movement


class TestProductInstances(TestAuth):
    """Product instances (individual tracked items) tests"""
    
    def test_create_product_instances(self, headers):
        """Test POST /api/products/{product_id}/instances"""
        list_response = requests.get(f"{BASE_URL}/api/products", headers=headers)
        products = list_response.json()
        if len(products) > 0:
            product_id = products[0]["id"]
            payload = {
                "count": 2,
                "location": "Test Warehouse"
            }
            response = requests.post(f"{BASE_URL}/api/products/{product_id}/instances", json=payload, headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 2
            for instance in data:
                assert "id" in instance
                assert "barcode" in instance
                assert "serial_number" in instance
                print(f"Created instance: {instance['barcode']}, SN: {instance['serial_number']}")
    
    def test_get_product_instances(self, headers):
        """Test GET /api/products/{product_id}/instances"""
        list_response = requests.get(f"{BASE_URL}/api/products", headers=headers)
        products = list_response.json()
        if len(products) > 0:
            product_id = products[0]["id"]
            response = requests.get(f"{BASE_URL}/api/products/{product_id}/instances", headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            print(f"Product instances count: {len(data)}")


class TestNetworkingSites(TestAuth):
    """Networking/UniFi sites tests"""
    
    def test_get_networking_sites(self, headers):
        """Test GET /api/networking/sites"""
        response = requests.get(f"{BASE_URL}/api/networking/sites", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Network sites count: {len(data)}")
        if len(data) > 0:
            site = data[0]
            assert "id" in site
            assert "name" in site
            assert "status" in site
            print(f"Sample site: {site['name']}, Status: {site['status']}")
    
    def test_get_networking_stats(self, headers):
        """Test GET /api/networking/stats"""
        response = requests.get(f"{BASE_URL}/api/networking/stats", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total_sites" in data
        assert "total_devices" in data
        assert "total_clients" in data
        assert "access_points" in data
        assert "switches" in data
        assert "gateways" in data
        print(f"Network stats: Sites={data['total_sites']}, Devices={data['total_devices']}, Clients={data['total_clients']}")
        print(f"Device types: APs={data['access_points']}, Switches={data['switches']}, Gateways={data['gateways']}")
    
    def test_get_single_site(self, headers):
        """Test GET /api/networking/sites/{site_id}"""
        list_response = requests.get(f"{BASE_URL}/api/networking/sites", headers=headers)
        sites = list_response.json()
        if len(sites) > 0:
            site_id = sites[0]["id"]
            response = requests.get(f"{BASE_URL}/api/networking/sites/{site_id}", headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert data["id"] == site_id
            print(f"Got site: {data['name']}")
    
    def test_get_site_overview(self, headers):
        """Test GET /api/networking/sites/{site_id}/overview"""
        list_response = requests.get(f"{BASE_URL}/api/networking/sites", headers=headers)
        sites = list_response.json()
        if len(sites) > 0:
            site_id = sites[0]["id"]
            response = requests.get(f"{BASE_URL}/api/networking/sites/{site_id}/overview", headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert "site" in data
            assert "total_devices" in data
            assert "total_clients" in data
            assert "access_points" in data
            assert "switches" in data
            assert "gateways" in data
            assert "health" in data
            print(f"Site overview: Devices={data['total_devices']}, Clients={data['total_clients']}")
            print(f"Health: WAN={data['health'].get('wan')}, LAN={data['health'].get('lan')}, WLAN={data['health'].get('wlan')}")


class TestNetworkingDevices(TestAuth):
    """Networking devices tests"""
    
    def test_get_site_devices(self, headers):
        """Test GET /api/networking/sites/{site_id}/devices"""
        list_response = requests.get(f"{BASE_URL}/api/networking/sites", headers=headers)
        sites = list_response.json()
        if len(sites) > 0:
            site_id = sites[0]["id"]
            response = requests.get(f"{BASE_URL}/api/networking/sites/{site_id}/devices", headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            print(f"Site devices count: {len(data)}")
            if len(data) > 0:
                device = data[0]
                assert "id" in device
                assert "name" in device
                assert "device_type" in device
                assert "status" in device
                print(f"Sample device: {device['name']}, Type: {device['device_type']}, Status: {device['status']}")
    
    def test_get_site_devices_filtered(self, headers):
        """Test GET /api/networking/sites/{site_id}/devices?device_type=ap"""
        list_response = requests.get(f"{BASE_URL}/api/networking/sites", headers=headers)
        sites = list_response.json()
        if len(sites) > 0:
            site_id = sites[0]["id"]
            response = requests.get(f"{BASE_URL}/api/networking/sites/{site_id}/devices?device_type=ap", headers=headers)
            assert response.status_code == 200
            data = response.json()
            for device in data:
                assert device["device_type"] == "ap"
            print(f"APs count: {len(data)}")


class TestNetworkingClients(TestAuth):
    """Networking clients tests"""
    
    def test_get_site_clients(self, headers):
        """Test GET /api/networking/sites/{site_id}/clients"""
        list_response = requests.get(f"{BASE_URL}/api/networking/sites", headers=headers)
        sites = list_response.json()
        if len(sites) > 0:
            site_id = sites[0]["id"]
            response = requests.get(f"{BASE_URL}/api/networking/sites/{site_id}/clients", headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            print(f"Site clients count: {len(data)}")
            if len(data) > 0:
                client = data[0]
                assert "id" in client
                assert "mac" in client
                assert "ip_address" in client
                print(f"Sample client: {client.get('name', 'Unknown')}, IP: {client['ip_address']}, MAC: {client['mac']}")


class TestProductDeletion(TestAuth):
    """Cleanup tests - Delete test products"""
    
    def test_delete_test_products(self, headers):
        """Test DELETE /api/products/{product_id} - cleanup TEST_ products"""
        list_response = requests.get(f"{BASE_URL}/api/products?search=TEST_", headers=headers)
        products = list_response.json()
        deleted_count = 0
        for product in products:
            if "TEST_" in product.get("name", ""):
                response = requests.delete(f"{BASE_URL}/api/products/{product['id']}", headers=headers)
                if response.status_code == 200:
                    deleted_count += 1
        print(f"Deleted {deleted_count} test products")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
