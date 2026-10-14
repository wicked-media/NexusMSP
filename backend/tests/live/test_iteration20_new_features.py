"""
Iteration 20 - Testing 4 New Frontend Feature Backend APIs:
1. Phone Rentals (Rental devices & Agreements)
2. Vendors Management 
3. Ticket Categories & Issue Types
4. Networking Dashboard (alerts, bandwidth, firmware)
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    raise ValueError("REACT_APP_BACKEND_URL not set")

class TestAuth:
    """Authentication for API access"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.json()["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestRentalDevices(TestAuth):
    """Tests for Phone Rental Device Inventory APIs"""
    
    def test_get_yealink_models(self, headers):
        """Test getting Yealink phone models list"""
        response = requests.get(f"{BASE_URL}/api/rental-devices/models", headers=headers)
        assert response.status_code == 200
        models = response.json()
        assert isinstance(models, list)
        assert len(models) > 0
        assert "Yealink T54W" in models or any("T54" in m for m in models)
        print(f"SUCCESS: Got {len(models)} Yealink models")
    
    def test_get_rental_devices(self, headers):
        """Test getting rental device inventory"""
        response = requests.get(f"{BASE_URL}/api/rental-devices", headers=headers)
        assert response.status_code == 200
        devices = response.json()
        assert isinstance(devices, list)
        print(f"SUCCESS: Got {len(devices)} rental devices in inventory")
        return devices
    
    def test_create_rental_device(self, headers):
        """Test adding a new device to inventory"""
        test_serial = f"TEST-{uuid.uuid4().hex[:8].upper()}"
        payload = {
            "model_name": "Yealink T54W",
            "serial_number": test_serial,
            "mac_address": "80:5E:C0:AA:BB:CC",
            "condition": "new",
            "purchase_price": 299.00,
            "notes": "Test device for iteration 20"
        }
        response = requests.post(f"{BASE_URL}/api/rental-devices", headers=headers, json=payload)
        assert response.status_code == 200, f"Create failed: {response.text}"
        device = response.json()
        assert device["serial_number"] == test_serial
        assert device["model_name"] == "Yealink T54W"
        assert device["status"] == "available"
        print(f"SUCCESS: Created rental device {test_serial}")
        return device
    
    def test_update_rental_device(self, headers):
        """Test updating a rental device"""
        # First get devices
        devices_resp = requests.get(f"{BASE_URL}/api/rental-devices", headers=headers)
        devices = devices_resp.json()
        if not devices:
            pytest.skip("No devices to update")
        
        device_id = devices[0]["id"]
        response = requests.put(f"{BASE_URL}/api/rental-devices/{device_id}", headers=headers, json={
            "notes": "Updated by iteration 20 test"
        })
        assert response.status_code == 200
        print(f"SUCCESS: Updated rental device {device_id}")


class TestRentalAgreements(TestAuth):
    """Tests for Rental Agreement APIs"""
    
    def test_get_rental_stats(self, headers):
        """Test getting rental statistics"""
        response = requests.get(f"{BASE_URL}/api/rentals/stats", headers=headers)
        assert response.status_code == 200
        stats = response.json()
        assert "total_agreements" in stats
        assert "active" in stats
        assert "total_devices" in stats
        assert "available_devices" in stats
        assert "total_revenue" in stats
        print(f"SUCCESS: Rental stats - {stats['total_agreements']} agreements, {stats['active']} active")
    
    def test_get_rentals(self, headers):
        """Test getting rental agreements list"""
        response = requests.get(f"{BASE_URL}/api/rentals", headers=headers)
        assert response.status_code == 200
        rentals = response.json()
        assert isinstance(rentals, list)
        print(f"SUCCESS: Got {len(rentals)} rental agreements")
        
        # Verify structure if data exists
        if rentals:
            rental = rentals[0]
            assert "id" in rental
            assert "client_name" in rental
            assert "device_model" in rental
            assert "status" in rental
            print(f"  First rental: {rental['client_name']} - {rental['device_model']} ({rental['status']})")
        return rentals
    
    def test_get_rental_by_id(self, headers):
        """Test getting a specific rental agreement"""
        rentals_resp = requests.get(f"{BASE_URL}/api/rentals", headers=headers)
        rentals = rentals_resp.json()
        if not rentals:
            pytest.skip("No rentals to fetch")
        
        rental_id = rentals[0]["id"]
        response = requests.get(f"{BASE_URL}/api/rentals/{rental_id}", headers=headers)
        assert response.status_code == 200
        rental = response.json()
        assert rental["id"] == rental_id
        print(f"SUCCESS: Got rental details for {rental['client_name']}")


class TestVendors(TestAuth):
    """Tests for Vendor Management APIs"""
    
    def test_get_vendors(self, headers):
        """Test getting vendor list"""
        response = requests.get(f"{BASE_URL}/api/vendors", headers=headers)
        assert response.status_code == 200
        vendors = response.json()
        assert isinstance(vendors, list)
        print(f"SUCCESS: Got {len(vendors)} vendors")
        
        if vendors:
            v = vendors[0]
            assert "id" in v
            assert "name" in v
            assert "category" in v
            print(f"  First vendor: {v['name']} ({v['category']})")
        return vendors
    
    def test_create_vendor(self, headers):
        """Test creating a new vendor"""
        payload = {
            "name": f"TEST Vendor {uuid.uuid4().hex[:6]}",
            "contact_name": "Test Contact",
            "email": "test@vendor.com",
            "phone": "+61 2 1234 5678",
            "category": "hardware",
            "payment_terms": "Net 30",
            "country": "Australia",
            "abn": "12 345 678 901"
        }
        response = requests.post(f"{BASE_URL}/api/vendors", headers=headers, json=payload)
        assert response.status_code == 200, f"Create failed: {response.text}"
        vendor = response.json()
        assert vendor["name"] == payload["name"]
        assert vendor["category"] == "hardware"
        assert vendor["is_active"] == True
        print(f"SUCCESS: Created vendor {vendor['name']}")
        return vendor
    
    def test_get_vendor_detail(self, headers):
        """Test getting vendor detail with purchase orders"""
        vendors_resp = requests.get(f"{BASE_URL}/api/vendors", headers=headers)
        vendors = vendors_resp.json()
        if not vendors:
            pytest.skip("No vendors to fetch")
        
        vendor_id = vendors[0]["id"]
        response = requests.get(f"{BASE_URL}/api/vendors/{vendor_id}", headers=headers)
        assert response.status_code == 200
        vendor = response.json()
        assert "purchase_orders" in vendor  # Should include PO list
        print(f"SUCCESS: Got vendor detail for {vendor['name']} with {len(vendor.get('purchase_orders', []))} POs")
    
    def test_update_vendor(self, headers):
        """Test updating a vendor"""
        vendors_resp = requests.get(f"{BASE_URL}/api/vendors", headers=headers)
        vendors = vendors_resp.json()
        if not vendors:
            pytest.skip("No vendors to update")
        
        vendor_id = vendors[0]["id"]
        response = requests.put(f"{BASE_URL}/api/vendors/{vendor_id}", headers=headers, json={
            "notes": "Updated by iteration 20 test"
        })
        assert response.status_code == 200
        print(f"SUCCESS: Updated vendor {vendor_id}")
    
    def test_vendors_category_filter(self, headers):
        """Test vendor category filtering"""
        response = requests.get(f"{BASE_URL}/api/vendors?category=hardware", headers=headers)
        assert response.status_code == 200
        vendors = response.json()
        for v in vendors:
            assert v["category"] == "hardware", f"Expected hardware, got {v['category']}"
        print(f"SUCCESS: Category filter returned {len(vendors)} hardware vendors")


class TestTicketCategories(TestAuth):
    """Tests for Ticket Categories & Issue Types APIs"""
    
    def test_get_active_ticket_categories(self, headers):
        """Test getting active ticket categories"""
        response = requests.get(f"{BASE_URL}/api/ticket-categories", headers=headers)
        assert response.status_code == 200
        cats = response.json()
        assert isinstance(cats, list)
        assert len(cats) > 0  # Should have default categories
        
        # Verify structure
        cat = cats[0]
        assert "id" in cat
        assert "name" in cat
        assert "issue_types" in cat
        assert isinstance(cat["issue_types"], list)
        print(f"SUCCESS: Got {len(cats)} active ticket categories")
        
        total_issues = sum(len(c.get("issue_types", [])) for c in cats)
        print(f"  Total issue types across all categories: {total_issues}")
        return cats
    
    def test_get_all_ticket_categories(self, headers):
        """Test getting all categories including inactive"""
        response = requests.get(f"{BASE_URL}/api/ticket-categories/all", headers=headers)
        assert response.status_code == 200
        cats = response.json()
        assert isinstance(cats, list)
        print(f"SUCCESS: Got {len(cats)} total categories (including inactive)")
    
    def test_default_categories_exist(self, headers):
        """Test that 8 default categories exist"""
        response = requests.get(f"{BASE_URL}/api/ticket-categories/all", headers=headers)
        cats = response.json()
        
        expected_names = ["Hardware", "Software", "Network", "Security", 
                        "Email & Collaboration", "Cloud & Server", 
                        "User Onboarding/Offboarding", "Service Request"]
        
        cat_names = [c["name"] for c in cats]
        for expected in expected_names:
            assert expected in cat_names, f"Missing default category: {expected}"
        print(f"SUCCESS: All 8 default ticket categories present")
    
    def test_create_ticket_category(self, headers):
        """Test creating a new ticket category"""
        payload = {
            "name": f"TEST Category {uuid.uuid4().hex[:6]}",
            "description": "Test category created by iteration 20",
            "icon": "folder",
            "color": "#3b82f6",
            "sort_order": 99,
            "issue_types": []
        }
        response = requests.post(f"{BASE_URL}/api/ticket-categories", headers=headers, json=payload)
        assert response.status_code == 200, f"Create failed: {response.text}"
        cat = response.json()
        assert cat["name"] == payload["name"]
        assert cat["is_active"] == True
        print(f"SUCCESS: Created ticket category {cat['name']}")
        return cat
    
    def test_add_issue_type_to_category(self, headers):
        """Test adding an issue type to a category"""
        cats_resp = requests.get(f"{BASE_URL}/api/ticket-categories", headers=headers)
        cats = cats_resp.json()
        if not cats:
            pytest.skip("No categories to add issue to")
        
        cat_id = cats[0]["id"]
        payload = {
            "name": f"TEST Issue {uuid.uuid4().hex[:6]}",
            "description": "Test issue type",
            "priority": "medium"
        }
        response = requests.post(f"{BASE_URL}/api/ticket-categories/{cat_id}/issue-types", headers=headers, json=payload)
        assert response.status_code == 200
        result = response.json()
        assert "issue" in result
        print(f"SUCCESS: Added issue type '{payload['name']}' to category {cat_id}")
    
    def test_issue_type_priorities(self, headers):
        """Test that issue types have valid priorities"""
        response = requests.get(f"{BASE_URL}/api/ticket-categories", headers=headers)
        cats = response.json()
        
        valid_priorities = ["critical", "high", "medium", "low"]
        for cat in cats:
            for issue in cat.get("issue_types", []):
                assert issue.get("priority") in valid_priorities, f"Invalid priority: {issue.get('priority')}"
        print("SUCCESS: All issue types have valid priorities")


class TestNetworkingDashboard(TestAuth):
    """Tests for Enhanced Networking Dashboard APIs"""
    
    def test_get_networking_dashboard(self, headers):
        """Test getting networking dashboard with alerts, bandwidth, firmware"""
        response = requests.get(f"{BASE_URL}/api/networking/dashboard", headers=headers)
        assert response.status_code == 200
        dashboard = response.json()
        
        # Verify structure
        assert "summary" in dashboard
        assert "device_types" in dashboard
        assert "firmware_versions" in dashboard
        assert "offline_devices" in dashboard
        assert "site_bandwidth" in dashboard
        assert "alerts" in dashboard
        
        summary = dashboard["summary"]
        assert "total_sites" in summary
        assert "online_sites" in summary
        assert "total_devices" in summary
        assert "total_clients" in summary
        
        print(f"SUCCESS: Networking dashboard loaded")
        print(f"  Sites: {summary['online_sites']}/{summary['total_sites']} online")
        print(f"  Devices: {summary.get('online_devices', 0)}/{summary['total_devices']} online")
        print(f"  Clients: {summary['total_clients']}")
        print(f"  Alerts: {len(dashboard['alerts'])}")
        print(f"  Firmware versions: {len(dashboard['firmware_versions'])}")
        return dashboard
    
    def test_site_bandwidth_data(self, headers):
        """Test site bandwidth data in dashboard"""
        response = requests.get(f"{BASE_URL}/api/networking/dashboard", headers=headers)
        dashboard = response.json()
        
        site_bandwidth = dashboard.get("site_bandwidth", [])
        for sb in site_bandwidth:
            assert "site_id" in sb
            assert "name" in sb
            assert "status" in sb
            assert "device_count" in sb
            assert "client_count" in sb
            assert "rx_bytes" in sb
            assert "tx_bytes" in sb
        print(f"SUCCESS: Site bandwidth data valid for {len(site_bandwidth)} sites")
    
    def test_networking_stats(self, headers):
        """Test basic networking stats"""
        response = requests.get(f"{BASE_URL}/api/networking/stats", headers=headers)
        assert response.status_code == 200
        stats = response.json()
        
        assert "total_sites" in stats
        assert "online_sites" in stats
        assert "total_devices" in stats
        assert "access_points" in stats
        assert "switches" in stats
        assert "gateways" in stats
        print(f"SUCCESS: Networking stats - {stats['total_sites']} sites, {stats['total_devices']} devices")
    
    def test_networking_sites_list(self, headers):
        """Test getting networking sites"""
        response = requests.get(f"{BASE_URL}/api/networking/sites", headers=headers)
        assert response.status_code == 200
        sites = response.json()
        assert isinstance(sites, list)
        print(f"SUCCESS: Got {len(sites)} networking sites")
        
        if sites:
            site = sites[0]
            assert "id" in site
            assert "name" in site
            assert "status" in site
            print(f"  First site: {site['name']} ({site['status']})")


class TestIntegration(TestAuth):
    """Integration tests for cross-feature workflows"""
    
    def test_rentals_page_data_flow(self, headers):
        """Test that all data for rentals page is available"""
        # Get stats
        stats_resp = requests.get(f"{BASE_URL}/api/rentals/stats", headers=headers)
        assert stats_resp.status_code == 200
        
        # Get agreements
        agreements_resp = requests.get(f"{BASE_URL}/api/rentals", headers=headers)
        assert agreements_resp.status_code == 200
        
        # Get devices
        devices_resp = requests.get(f"{BASE_URL}/api/rental-devices", headers=headers)
        assert devices_resp.status_code == 200
        
        # Get models
        models_resp = requests.get(f"{BASE_URL}/api/rental-devices/models", headers=headers)
        assert models_resp.status_code == 200
        
        # Get clients (for creating agreements)
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert clients_resp.status_code == 200
        
        # Get vendors (for device purchase info)
        vendors_resp = requests.get(f"{BASE_URL}/api/vendors", headers=headers)
        assert vendors_resp.status_code == 200
        
        print("SUCCESS: All rentals page data endpoints working")
    
    def test_vendors_page_data_flow(self, headers):
        """Test that vendor detail includes purchase orders"""
        vendors_resp = requests.get(f"{BASE_URL}/api/vendors", headers=headers)
        vendors = vendors_resp.json()
        
        if vendors:
            vendor_id = vendors[0]["id"]
            detail_resp = requests.get(f"{BASE_URL}/api/vendors/{vendor_id}", headers=headers)
            assert detail_resp.status_code == 200
            detail = detail_resp.json()
            assert "purchase_orders" in detail
        
        print("SUCCESS: Vendor detail with POs working")
    
    def test_ticket_settings_page_data_flow(self, headers):
        """Test ticket categories with issue types"""
        cats_resp = requests.get(f"{BASE_URL}/api/ticket-categories/all", headers=headers)
        assert cats_resp.status_code == 200
        cats = cats_resp.json()
        
        # Verify each category has issue_types array
        for cat in cats:
            assert "issue_types" in cat
            assert isinstance(cat["issue_types"], list)
        
        active_cats = [c for c in cats if c.get("is_active")]
        inactive_cats = [c for c in cats if not c.get("is_active")]
        
        total_issues = sum(len(c.get("issue_types", [])) for c in active_cats)
        print(f"SUCCESS: {len(active_cats)} active categories, {len(inactive_cats)} inactive, {total_issues} issue types")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
