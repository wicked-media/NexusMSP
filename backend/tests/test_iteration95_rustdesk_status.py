"""
Iteration 95 - RustDesk Live Status Polling & Bug Fixes Testing
Tests:
1. RustDesk status-map API: GET /api/rustdesk/live/status-map
2. RustDesk quick-connect URI format: POST /api/rustdesk/quick-connect
3. Invoice download endpoint (for popup blocker fix verification)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestRustDeskStatusMap:
    """Test RustDesk live status-map endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login to get token
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.token = login_resp.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    def test_status_map_endpoint_returns_correct_structure(self):
        """GET /api/rustdesk/live/status-map returns {status_map, server_configured, peer_count}"""
        resp = self.session.get(f"{BASE_URL}/api/rustdesk/live/status-map")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        # Verify response structure
        assert "status_map" in data, "Response missing 'status_map' field"
        assert "server_configured" in data, "Response missing 'server_configured' field"
        
        # status_map should be a dict (can be empty if server not accessible)
        assert isinstance(data["status_map"], dict), "status_map should be a dictionary"
        
        # server_configured should be boolean
        assert isinstance(data["server_configured"], bool), "server_configured should be boolean"
        
        # If server is configured, peer_count should be present
        if data["server_configured"]:
            assert "peer_count" in data, "Response missing 'peer_count' when server is configured"
            assert isinstance(data["peer_count"], int), "peer_count should be an integer"
        
        print(f"Status map endpoint returned: server_configured={data['server_configured']}, peer_count={data.get('peer_count', 0)}, status_map keys={list(data['status_map'].keys())[:5]}")
    
    def test_status_map_requires_auth(self):
        """GET /api/rustdesk/live/status-map requires authentication"""
        session = requests.Session()
        resp = session.get(f"{BASE_URL}/api/rustdesk/live/status-map")
        assert resp.status_code in [401, 403, 422], f"Expected auth error, got {resp.status_code}"


class TestRustDeskQuickConnect:
    """Test RustDesk quick-connect endpoint and URI format"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login to get token
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.token = login_resp.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    def test_quick_connect_returns_correct_uri_format(self):
        """POST /api/rustdesk/quick-connect returns connection_url in format rustdesk://ID@server_host"""
        test_rd_id = "123456789"
        resp = self.session.post(f"{BASE_URL}/api/rustdesk/quick-connect", json={
            "rustdesk_id": test_rd_id
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        # Verify response structure
        assert "connection_url" in data, "Response missing 'connection_url' field"
        assert "rustdesk_id" in data, "Response missing 'rustdesk_id' field"
        assert "message" in data, "Response missing 'message' field"
        
        connection_url = data["connection_url"]
        
        # Verify URI format: should be rustdesk://ID@host or rustdesk://ID (if no server configured)
        assert connection_url.startswith("rustdesk://"), f"connection_url should start with 'rustdesk://', got: {connection_url}"
        
        # Should NOT be the old incorrect format: rustdesk://connection/new/ID
        assert "connection/new" not in connection_url, f"connection_url should NOT contain 'connection/new', got: {connection_url}"
        
        # Should contain the RustDesk ID
        assert test_rd_id in connection_url, f"connection_url should contain the RustDesk ID '{test_rd_id}', got: {connection_url}"
        
        # If server is configured, should be in format rustdesk://ID@host
        if "@" in connection_url:
            parts = connection_url.replace("rustdesk://", "").split("@")
            assert len(parts) == 2, f"Expected format rustdesk://ID@host, got: {connection_url}"
            assert parts[0] == test_rd_id, f"ID part should be '{test_rd_id}', got: {parts[0]}"
            assert len(parts[1]) > 0, f"Host part should not be empty"
            print(f"Quick connect URI format correct: {connection_url}")
        else:
            # No server configured, just rustdesk://ID
            assert connection_url == f"rustdesk://{test_rd_id}", f"Expected 'rustdesk://{test_rd_id}', got: {connection_url}"
            print(f"Quick connect URI format correct (no server): {connection_url}")
    
    def test_quick_connect_requires_rustdesk_id(self):
        """POST /api/rustdesk/quick-connect requires rustdesk_id"""
        resp = self.session.post(f"{BASE_URL}/api/rustdesk/quick-connect", json={})
        assert resp.status_code == 400, f"Expected 400 for missing rustdesk_id, got {resp.status_code}"
    
    def test_quick_connect_requires_auth(self):
        """POST /api/rustdesk/quick-connect requires authentication"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        resp = session.post(f"{BASE_URL}/api/rustdesk/quick-connect", json={"rustdesk_id": "123456789"})
        assert resp.status_code in [401, 403, 422], f"Expected auth error, got {resp.status_code}"


class TestRustDeskDeviceConnect:
    """Test RustDesk device connect endpoint URI format"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login to get token
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.token = login_resp.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    def test_device_connect_returns_correct_uri_format(self):
        """POST /api/rustdesk/devices/{id}/connect returns correct URI format"""
        # First get a device with RustDesk ID
        devices_resp = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        assert devices_resp.status_code == 200, f"Failed to get devices: {devices_resp.text}"
        
        devices = devices_resp.json()
        rd_device = next((d for d in devices if d.get("rd_id") and d.get("rd_entry_id")), None)
        
        if not rd_device:
            pytest.skip("No RustDesk registered devices found to test connect endpoint")
        
        # Test connect endpoint
        resp = self.session.post(f"{BASE_URL}/api/rustdesk/devices/{rd_device['rd_entry_id']}/connect")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert "connection_url" in data, "Response missing 'connection_url' field"
        
        connection_url = data["connection_url"]
        
        # Verify URI format
        assert connection_url.startswith("rustdesk://"), f"connection_url should start with 'rustdesk://', got: {connection_url}"
        assert "connection/new" not in connection_url, f"connection_url should NOT contain 'connection/new', got: {connection_url}"
        
        print(f"Device connect URI format correct: {connection_url}")


class TestRustDeskConfig:
    """Test RustDesk config endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login to get token
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.token = login_resp.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    def test_get_rustdesk_config(self):
        """GET /api/rustdesk/config returns server configuration"""
        resp = self.session.get(f"{BASE_URL}/api/rustdesk/config")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        # Should have key and value structure
        assert "key" in data or "value" in data or "server_url" in data, "Response should have config structure"
        
        print(f"RustDesk config retrieved successfully")


class TestInvoiceDownload:
    """Test invoice download endpoint (for popup blocker fix verification)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login to get token
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.token = login_resp.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    def test_invoice_pdf_download_endpoint(self):
        """GET /api/invoices/{id}/pdf/download returns PDF with attachment disposition"""
        # Get an invoice first
        invoices_resp = self.session.get(f"{BASE_URL}/api/xero/invoices")
        assert invoices_resp.status_code == 200, f"Failed to get invoices: {invoices_resp.text}"
        
        invoices = invoices_resp.json()
        if not invoices:
            pytest.skip("No invoices found to test PDF download")
        
        invoice = invoices[0]
        
        # Test PDF download endpoint with token in query param
        resp = requests.get(f"{BASE_URL}/api/invoices/{invoice['id']}/pdf/download?token={self.token}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        # Verify content type is PDF
        content_type = resp.headers.get("Content-Type", "")
        assert "application/pdf" in content_type, f"Expected PDF content type, got: {content_type}"
        
        # Verify Content-Disposition is attachment (for download)
        content_disp = resp.headers.get("Content-Disposition", "")
        assert "attachment" in content_disp, f"Expected attachment disposition for download, got: {content_disp}"
        
        print(f"Invoice PDF download endpoint working correctly")


class TestDevicesEndpoint:
    """Test devices endpoint for status badges"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login to get token
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.token = login_resp.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    def test_devices_list_returns_status(self):
        """GET /api/devices returns devices with status field"""
        resp = self.session.get(f"{BASE_URL}/api/devices")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        devices = resp.json()
        if devices:
            device = devices[0]
            assert "status" in device, "Device should have 'status' field"
            assert device["status"] in ["online", "offline", "warning"], f"Invalid status: {device['status']}"
            print(f"Devices endpoint returns status correctly. Sample: {device.get('name')} - {device['status']}")
    
    def test_device_detail_returns_status(self):
        """GET /api/devices/{id}/detail returns device with status"""
        # Get a device first
        devices_resp = self.session.get(f"{BASE_URL}/api/devices")
        assert devices_resp.status_code == 200
        
        devices = devices_resp.json()
        if not devices:
            pytest.skip("No devices found")
        
        device_id = devices[0]["id"]
        
        resp = self.session.get(f"{BASE_URL}/api/devices/{device_id}/detail")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert "device" in data, "Response should have 'device' field"
        assert "status" in data["device"], "Device should have 'status' field"
        
        print(f"Device detail endpoint returns status correctly")


class TestContractPdfEndpoint:
    """Test contract PDF preview endpoint (still working after changes)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login to get token
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.token = login_resp.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    def test_contract_pdf_preview_endpoint(self):
        """GET /api/contracts/{id}/pdf returns PDF for preview"""
        # Get a contract first
        contracts_resp = self.session.get(f"{BASE_URL}/api/contracts")
        assert contracts_resp.status_code == 200, f"Failed to get contracts: {contracts_resp.text}"
        
        contracts = contracts_resp.json()
        if not contracts:
            pytest.skip("No contracts found to test PDF preview")
        
        contract = contracts[0]
        
        # Test PDF preview endpoint with token in query param
        resp = requests.get(f"{BASE_URL}/api/contracts/{contract['id']}/pdf?token={self.token}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        # Verify content type is PDF
        content_type = resp.headers.get("Content-Type", "")
        assert "application/pdf" in content_type, f"Expected PDF content type, got: {content_type}"
        
        print(f"Contract PDF preview endpoint working correctly")


class TestPurchaseOrderPdfEndpoint:
    """Test PO PDF preview endpoint (still working after changes)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login to get token
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.token = login_resp.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    def test_po_pdf_preview_endpoint(self):
        """GET /api/purchase-orders/{id}/pdf/preview returns PDF for preview"""
        # Get a PO first
        po_resp = self.session.get(f"{BASE_URL}/api/purchase-orders")
        assert po_resp.status_code == 200, f"Failed to get POs: {po_resp.text}"
        
        pos = po_resp.json()
        if not pos:
            pytest.skip("No purchase orders found to test PDF preview")
        
        po = pos[0]
        
        # Test PDF preview endpoint with token in query param
        resp = requests.get(f"{BASE_URL}/api/purchase-orders/{po['id']}/pdf/preview?token={self.token}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        # Verify content type is PDF
        content_type = resp.headers.get("Content-Type", "")
        assert "application/pdf" in content_type, f"Expected PDF content type, got: {content_type}"
        
        print(f"PO PDF preview endpoint working correctly")
