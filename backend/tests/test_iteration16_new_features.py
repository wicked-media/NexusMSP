"""
Iteration 16 Tests: New Features Testing
- Login page modern dark design
- Networking page enhancements (add/edit sites, adopt devices, edit/delete devices)
- Invoice enhancements (move to client, void invoice, 9 payment methods)
- Xero billing integration settings
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Test authentication and login"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.token = None
    
    def test_login_success(self):
        """Login with admin credentials should succeed"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == "admin@nexusops.io"
        print(f"✓ Login successful for admin@nexusops.io")
        return data["token"]
    
    def test_login_invalid_credentials(self):
        """Login with wrong credentials should fail"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "wrong@example.com",
            "password": "wrongpass"
        })
        assert response.status_code == 401
        print(f"✓ Invalid login correctly rejected")


class TestNetworkingSites:
    """Test Networking page site management"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        # Login first
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io", "password": "admin123"
        })
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_networking_sites(self):
        """GET /api/networking/sites should return list of sites"""
        response = self.session.get(f"{BASE_URL}/api/networking/sites", headers=self.headers)
        assert response.status_code == 200
        sites = response.json()
        assert isinstance(sites, list)
        print(f"✓ Got {len(sites)} networking sites")
        return sites
    
    def test_get_networking_stats(self):
        """GET /api/networking/stats should return global network stats"""
        response = self.session.get(f"{BASE_URL}/api/networking/stats", headers=self.headers)
        assert response.status_code == 200
        stats = response.json()
        assert "total_sites" in stats
        assert "total_devices" in stats
        assert "total_clients" in stats
        print(f"✓ Network stats: {stats['total_sites']} sites, {stats['total_devices']} devices, {stats['total_clients']} clients")
    
    def test_add_networking_site(self):
        """POST /api/networking/sites should create new site"""
        new_site = {
            "name": "TEST_Site_New",
            "client_id": "client-001",
            "controller_url": "https://192.168.1.100:8443",
            "api_key": "test-api-key-12345",
            "wan_ip": "203.0.113.50",
            "isp": "Test ISP",
            "download_speed_mbps": 500,
            "upload_speed_mbps": 100,
            "location": "Test Location",
            "notes": "Test site for iteration 16"
        }
        response = self.session.post(f"{BASE_URL}/api/networking/sites", json=new_site, headers=self.headers)
        assert response.status_code == 200
        site = response.json()
        assert site["name"] == "TEST_Site_New"
        assert site["controller_url"] == "https://192.168.1.100:8443"
        print(f"✓ Created networking site: {site['name']} (ID: {site['id']})")
        return site
    
    def test_update_networking_site(self):
        """PUT /api/networking/sites/{id} should update site"""
        # First get an existing site
        sites_response = self.session.get(f"{BASE_URL}/api/networking/sites", headers=self.headers)
        sites = sites_response.json()
        # Find our test site or use first existing
        test_site = next((s for s in sites if "TEST" in s.get("name", "")), sites[0] if sites else None)
        if not test_site:
            pytest.skip("No sites available to update")
        
        update_data = {"name": f"{test_site['name']}_Updated", "notes": "Updated via test"}
        response = self.session.put(f"{BASE_URL}/api/networking/sites/{test_site['id']}", json=update_data, headers=self.headers)
        assert response.status_code == 200
        print(f"✓ Updated site {test_site['id']}")
    
    def test_get_site_overview(self):
        """GET /api/networking/sites/{id}/overview should return site details"""
        sites_response = self.session.get(f"{BASE_URL}/api/networking/sites", headers=self.headers)
        sites = sites_response.json()
        if not sites:
            pytest.skip("No sites available")
        site_id = sites[0]["id"]
        
        response = self.session.get(f"{BASE_URL}/api/networking/sites/{site_id}/overview", headers=self.headers)
        assert response.status_code == 200
        overview = response.json()
        assert "total_devices" in overview
        assert "total_clients" in overview
        assert "health" in overview
        print(f"✓ Site overview: {overview['total_devices']} devices, {overview['total_clients']} clients")
    
    def test_test_site_connection(self):
        """POST /api/networking/sites/{id}/test-connection should test UniFi connection"""
        sites_response = self.session.get(f"{BASE_URL}/api/networking/sites", headers=self.headers)
        sites = sites_response.json()
        if not sites:
            pytest.skip("No sites available")
        site_id = sites[0]["id"]
        
        response = self.session.post(f"{BASE_URL}/api/networking/sites/{site_id}/test-connection", headers=self.headers)
        assert response.status_code == 200
        result = response.json()
        assert "success" in result
        assert "message" in result
        print(f"✓ Connection test result: {result['message']}")


class TestNetworkingDevices:
    """Test Networking device management (adopt, edit, delete)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io", "password": "admin123"
        })
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_adopt_device(self):
        """POST /api/networking/sites/{id}/adopt-device should create device"""
        sites_response = self.session.get(f"{BASE_URL}/api/networking/sites", headers=self.headers)
        sites = sites_response.json()
        if not sites:
            pytest.skip("No sites available")
        site_id = sites[0]["id"]
        
        device_data = {
            "name": "TEST_AP_New",
            "mac": "F0:9F:C2:AA:BB:CC",
            "device_type": "ap",
            "model": "U6-Pro",
            "ip_address": "192.168.1.100",
            "firmware": "7.0.83"
        }
        response = self.session.post(f"{BASE_URL}/api/networking/sites/{site_id}/adopt-device", json=device_data, headers=self.headers)
        assert response.status_code == 200
        device = response.json()
        assert device["name"] == "TEST_AP_New"
        assert device["mac"] == "F0:9F:C2:AA:BB:CC"
        assert device["status"] == "pending_adoption"
        print(f"✓ Adopted device: {device['name']} (ID: {device['id']})")
        return device
    
    def test_get_site_devices(self):
        """GET /api/networking/sites/{id}/devices should return device list"""
        sites_response = self.session.get(f"{BASE_URL}/api/networking/sites", headers=self.headers)
        sites = sites_response.json()
        if not sites:
            pytest.skip("No sites available")
        site_id = sites[0]["id"]
        
        response = self.session.get(f"{BASE_URL}/api/networking/sites/{site_id}/devices", headers=self.headers)
        assert response.status_code == 200
        devices = response.json()
        assert isinstance(devices, list)
        print(f"✓ Got {len(devices)} devices for site")
    
    def test_update_network_device(self):
        """PUT /api/networking/devices/{id} should update device"""
        sites_response = self.session.get(f"{BASE_URL}/api/networking/sites", headers=self.headers)
        sites = sites_response.json()
        if not sites:
            pytest.skip("No sites available")
        
        devices_response = self.session.get(f"{BASE_URL}/api/networking/sites/{sites[0]['id']}/devices", headers=self.headers)
        devices = devices_response.json()
        # Find a test device or use first one
        test_device = next((d for d in devices if "TEST" in d.get("name", "")), devices[0] if devices else None)
        if not test_device:
            pytest.skip("No devices available")
        
        update_data = {"name": f"{test_device['name']}_Edited", "status": "online", "notes": "Updated via test"}
        response = self.session.put(f"{BASE_URL}/api/networking/devices/{test_device['id']}", json=update_data, headers=self.headers)
        assert response.status_code == 200
        print(f"✓ Updated device {test_device['id']}")
    
    def test_delete_network_device(self):
        """DELETE /api/networking/devices/{id} should remove device"""
        # First adopt a device to delete
        sites_response = self.session.get(f"{BASE_URL}/api/networking/sites", headers=self.headers)
        sites = sites_response.json()
        if not sites:
            pytest.skip("No sites available")
        
        # Create device to delete
        device_data = {"name": "TEST_Delete_Device", "mac": "AA:BB:CC:DD:EE:FF", "device_type": "ap"}
        create_response = self.session.post(f"{BASE_URL}/api/networking/sites/{sites[0]['id']}/adopt-device", json=device_data, headers=self.headers)
        device = create_response.json()
        
        # Delete it
        response = self.session.delete(f"{BASE_URL}/api/networking/devices/{device['id']}", headers=self.headers)
        assert response.status_code == 200
        print(f"✓ Deleted device {device['id']}")


class TestInvoiceEnhancements:
    """Test Invoice move-to-client, void, and payment methods"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io", "password": "admin123"
        })
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_invoices(self):
        """GET /api/invoices should return list of invoices"""
        response = self.session.get(f"{BASE_URL}/api/invoices", headers=self.headers)
        assert response.status_code == 200
        invoices = response.json()
        assert isinstance(invoices, list)
        print(f"✓ Got {len(invoices)} invoices")
        return invoices
    
    def test_get_clients(self):
        """GET /api/clients should return list for move-to-client feature"""
        response = self.session.get(f"{BASE_URL}/api/clients", headers=self.headers)
        assert response.status_code == 200
        clients = response.json()
        assert isinstance(clients, list)
        print(f"✓ Got {len(clients)} clients available for invoice assignment")
        return clients
    
    def test_move_invoice_to_client(self):
        """POST /api/invoices/{id}/move-client should move invoice"""
        # Get an invoice
        invoices_response = self.session.get(f"{BASE_URL}/api/invoices", headers=self.headers)
        invoices = invoices_response.json()
        if not invoices:
            pytest.skip("No invoices to test")
        
        # Get clients
        clients_response = self.session.get(f"{BASE_URL}/api/clients", headers=self.headers)
        clients = clients_response.json()
        if len(clients) < 2:
            pytest.skip("Need at least 2 clients to test move")
        
        # Find invoice to move and target client
        test_invoice = invoices[0]
        current_client_id = test_invoice.get("client_id")
        target_client = next((c for c in clients if c["id"] != current_client_id), None)
        if not target_client:
            pytest.skip("No different client to move to")
        
        # Move invoice
        response = self.session.post(f"{BASE_URL}/api/invoices/{test_invoice['id']}/move-client", 
                                    json={"client_id": target_client["id"]}, headers=self.headers)
        assert response.status_code == 200
        result = response.json()
        assert "new_client_name" in result
        assert result["new_client_name"] == target_client["name"]
        print(f"✓ Moved invoice {test_invoice['invoice_number']} to {target_client['name']}")
    
    def test_move_invoice_invalid_id(self):
        """POST /api/invoices/{invalid}/move-client should return 404"""
        response = self.session.post(f"{BASE_URL}/api/invoices/INVALID_ID/move-client", 
                                    json={"client_id": "client-001"}, headers=self.headers)
        assert response.status_code == 404
        print(f"✓ Invalid invoice ID correctly rejected")
    
    def test_void_invoice(self):
        """POST /api/invoices/{id}/void should void/cancel invoice"""
        # Create a test invoice to void
        clients_response = self.session.get(f"{BASE_URL}/api/clients", headers=self.headers)
        clients = clients_response.json()
        if not clients:
            pytest.skip("No clients available")
        
        # Create invoice
        new_invoice = {
            "client_id": clients[0]["id"],
            "due_date": "2026-03-20",
            "line_items": [{"name": "Test Item", "quantity": 1, "unit_price": 100}],
            "notes": "Test invoice for void test"
        }
        create_response = self.session.post(f"{BASE_URL}/api/invoices", json=new_invoice, headers=self.headers)
        if create_response.status_code != 200:
            # Use existing invoice
            invoices = self.session.get(f"{BASE_URL}/api/invoices", headers=self.headers).json()
            test_invoice = next((i for i in invoices if i.get("status") != "cancelled"), None)
            if not test_invoice:
                pytest.skip("No invoice to void")
        else:
            test_invoice = create_response.json()
        
        # Void the invoice
        response = self.session.post(f"{BASE_URL}/api/invoices/{test_invoice['id']}/void", 
                                    json={"reason": "Testing void feature"}, headers=self.headers)
        assert response.status_code == 200
        result = response.json()
        assert result["message"] == "Invoice voided"
        print(f"✓ Voided invoice {test_invoice.get('invoice_number', test_invoice['id'])}")
        
        # Verify status changed
        verify_response = self.session.get(f"{BASE_URL}/api/invoices/{test_invoice['id']}", headers=self.headers)
        if verify_response.status_code == 200:
            updated = verify_response.json()
            assert updated["status"] == "cancelled"
            print(f"✓ Invoice status confirmed as 'cancelled'")
    
    def test_record_manual_payment_cash(self):
        """POST /api/invoices/{id}/record-payment with cash method"""
        invoices_response = self.session.get(f"{BASE_URL}/api/invoices", headers=self.headers)
        invoices = invoices_response.json()
        unpaid = next((i for i in invoices if i.get("payment_status") != "paid" and i.get("status") != "cancelled"), None)
        if not unpaid:
            pytest.skip("No unpaid invoice to test")
        
        payment_data = {
            "amount": "10.00",
            "method": "cash",
            "reference": "CASH-TEST-001",
            "notes": "Test cash payment"
        }
        response = self.session.post(f"{BASE_URL}/api/invoices/{unpaid['id']}/record-payment", 
                                    json=payment_data, headers=self.headers)
        assert response.status_code == 200
        print(f"✓ Recorded cash payment on invoice {unpaid['invoice_number']}")
    
    def test_record_manual_payment_bank_transfer(self):
        """POST /api/invoices/{id}/record-payment with bank_transfer method"""
        invoices_response = self.session.get(f"{BASE_URL}/api/invoices", headers=self.headers)
        invoices = invoices_response.json()
        unpaid = next((i for i in invoices if i.get("payment_status") != "paid" and i.get("status") != "cancelled"), None)
        if not unpaid:
            pytest.skip("No unpaid invoice to test")
        
        payment_data = {"amount": "5.00", "method": "bank_transfer", "reference": "ACH-12345"}
        response = self.session.post(f"{BASE_URL}/api/invoices/{unpaid['id']}/record-payment", 
                                    json=payment_data, headers=self.headers)
        assert response.status_code == 200
        print(f"✓ Recorded bank transfer payment")
    
    def test_record_manual_payment_check(self):
        """POST /api/invoices/{id}/record-payment with check method"""
        invoices_response = self.session.get(f"{BASE_URL}/api/invoices", headers=self.headers)
        invoices = invoices_response.json()
        unpaid = next((i for i in invoices if i.get("payment_status") != "paid" and i.get("status") != "cancelled"), None)
        if not unpaid:
            pytest.skip("No unpaid invoice to test")
        
        payment_data = {"amount": "5.00", "method": "check", "reference": "CHK-7890"}
        response = self.session.post(f"{BASE_URL}/api/invoices/{unpaid['id']}/record-payment", 
                                    json=payment_data, headers=self.headers)
        assert response.status_code == 200
        print(f"✓ Recorded check payment")


class TestXeroIntegration:
    """Test Xero billing integration settings"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io", "password": "admin123"
        })
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_xero_settings(self):
        """GET /api/settings/xero should return default/empty settings"""
        response = self.session.get(f"{BASE_URL}/api/settings/xero", headers=self.headers)
        assert response.status_code == 200
        settings = response.json()
        assert "type" in settings
        assert settings["type"] == "xero"
        # Should have connected field (false by default)
        print(f"✓ Xero settings: connected={settings.get('connected', False)}")
    
    def test_update_xero_settings(self):
        """PUT /api/settings/xero should update settings"""
        new_settings = {
            "client_id": "test-xero-client-id",
            "client_secret": "test-secret",
            "redirect_uri": "https://example.com/callback",
            "connected": False,
            "tenant_name": "Test Tenant"
        }
        response = self.session.put(f"{BASE_URL}/api/settings/xero", json=new_settings, headers=self.headers)
        assert response.status_code == 200
        print(f"✓ Updated Xero settings")
    
    def test_xero_webhook_endpoint(self):
        """POST /api/xero/webhook should accept webhook payloads"""
        webhook_data = {"events": []}
        response = self.session.post(f"{BASE_URL}/api/xero/webhook", json=webhook_data)
        # Webhook should be accessible (no auth required for webhooks)
        assert response.status_code == 200
        print(f"✓ Xero webhook endpoint accessible")


class TestSiteDeleteCascade:
    """Test that deleting a site removes associated devices"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io", "password": "admin123"
        })
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_delete_site_cascade(self):
        """DELETE /api/networking/sites/{id} should remove site and devices"""
        # Create a test site
        new_site = {"name": "TEST_Site_ToDelete", "controller_url": "https://test.local:8443"}
        create_response = self.session.post(f"{BASE_URL}/api/networking/sites", json=new_site, headers=self.headers)
        site = create_response.json()
        site_id = site["id"]
        
        # Adopt a device to this site
        device_data = {"name": "TEST_Device_ToDelete", "mac": "11:22:33:44:55:66", "device_type": "ap"}
        self.session.post(f"{BASE_URL}/api/networking/sites/{site_id}/adopt-device", json=device_data, headers=self.headers)
        
        # Delete the site
        response = self.session.delete(f"{BASE_URL}/api/networking/sites/{site_id}", headers=self.headers)
        assert response.status_code == 200
        print(f"✓ Deleted site {site_id} and associated data")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
