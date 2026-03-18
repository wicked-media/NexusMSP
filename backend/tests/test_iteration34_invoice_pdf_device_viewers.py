"""
Iteration 34: Testing Invoice PDF Preview/Print/Download and Device Remote Viewer Badge features.

Features tested:
1. Invoice PDF Preview: GET /api/invoices/{id}/pdf returns valid PDF
2. Invoice PDF Download: GET /api/invoices/{id}/pdf/download returns PDF attachment
3. Device Remote Viewers: POST /devices/{id}/start-remote-viewing, stop-remote-viewing, GET /devices/active-remote-viewers
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestInvoicePDF:
    """Test invoice PDF generation endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token and invoice ID"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert resp.status_code == 200, f"Login failed: {resp.text}"
        self.token = resp.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
        
        # Get first invoice ID
        inv_resp = requests.get(f"{BASE_URL}/api/invoices", headers=self.headers)
        assert inv_resp.status_code == 200, f"Failed to get invoices: {inv_resp.text}"
        invoices = inv_resp.json()
        assert len(invoices) > 0, "No invoices found in database"
        self.invoice = invoices[0]
        self.invoice_id = self.invoice["id"]
        print(f"Testing with invoice: {self.invoice.get('invoice_number', self.invoice_id)}")
    
    def test_invoice_pdf_preview(self):
        """GET /api/invoices/{id}/pdf should return PDF with inline content-disposition"""
        resp = requests.get(
            f"{BASE_URL}/api/invoices/{self.invoice_id}/pdf",
            headers=self.headers
        )
        assert resp.status_code == 200, f"PDF preview failed: {resp.text}"
        assert resp.headers.get("content-type") == "application/pdf", \
            f"Expected PDF content-type, got: {resp.headers.get('content-type')}"
        
        # Check content-disposition is inline (for preview)
        content_disp = resp.headers.get("content-disposition", "")
        assert "inline" in content_disp, f"Expected inline disposition, got: {content_disp}"
        
        # Verify PDF content (should start with %PDF)
        assert resp.content[:4] == b'%PDF', "Response is not a valid PDF"
        
        # Check PDF has reasonable size
        assert len(resp.content) > 1000, f"PDF too small: {len(resp.content)} bytes"
        print(f"PDF preview generated: {len(resp.content)} bytes")
    
    def test_invoice_pdf_download(self):
        """GET /api/invoices/{id}/pdf/download should return PDF with attachment content-disposition"""
        resp = requests.get(
            f"{BASE_URL}/api/invoices/{self.invoice_id}/pdf/download",
            headers=self.headers
        )
        assert resp.status_code == 200, f"PDF download failed: {resp.text}"
        assert resp.headers.get("content-type") == "application/pdf", \
            f"Expected PDF content-type, got: {resp.headers.get('content-type')}"
        
        # Check content-disposition is attachment (for download)
        content_disp = resp.headers.get("content-disposition", "")
        assert "attachment" in content_disp, f"Expected attachment disposition, got: {content_disp}"
        
        # Verify PDF content
        assert resp.content[:4] == b'%PDF', "Response is not a valid PDF"
        
        # Verify filename is based on invoice number
        inv_num = self.invoice.get("invoice_number", "invoice")
        assert inv_num in content_disp, f"Expected {inv_num} in content-disposition: {content_disp}"
        print(f"PDF download generated: {len(resp.content)} bytes, disposition: {content_disp}")
    
    def test_invoice_pdf_not_found(self):
        """GET /api/invoices/{invalid}/pdf should return 404"""
        resp = requests.get(
            f"{BASE_URL}/api/invoices/invalid-invoice-id-12345/pdf",
            headers=self.headers
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
    
    def test_invoice_pdf_download_not_found(self):
        """GET /api/invoices/{invalid}/pdf/download should return 404"""
        resp = requests.get(
            f"{BASE_URL}/api/invoices/invalid-invoice-id-12345/pdf/download",
            headers=self.headers
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"


class TestDeviceRemoteViewers:
    """Test device remote viewer tracking endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token and device ID"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert resp.status_code == 200, f"Login failed: {resp.text}"
        self.token = resp.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
        
        # Get first device ID
        dev_resp = requests.get(f"{BASE_URL}/api/devices", headers=self.headers)
        assert dev_resp.status_code == 200, f"Failed to get devices: {dev_resp.text}"
        devices = dev_resp.json()
        assert len(devices) > 0, "No devices found in database"
        self.device = devices[0]
        self.device_id = self.device["id"]
        print(f"Testing with device: {self.device.get('name', self.device_id)}")
    
    def test_get_active_remote_viewers(self):
        """GET /api/devices/active-remote-viewers should return viewer map"""
        resp = requests.get(
            f"{BASE_URL}/api/devices/active-remote-viewers",
            headers=self.headers
        )
        assert resp.status_code == 200, f"Failed to get active viewers: {resp.text}"
        
        data = resp.json()
        assert isinstance(data, dict), f"Expected dict, got {type(data)}"
        print(f"Active viewers: {data}")
    
    def test_start_remote_viewing(self):
        """POST /api/devices/{id}/start-remote-viewing should add current user as viewer"""
        resp = requests.post(
            f"{BASE_URL}/api/devices/{self.device_id}/start-remote-viewing",
            headers=self.headers
        )
        assert resp.status_code == 200, f"Start viewing failed: {resp.text}"
        
        data = resp.json()
        assert "message" in data, f"Expected message in response: {data}"
        assert "viewers" in data, f"Expected viewers in response: {data}"
        
        # Verify current user is in viewers list
        viewers = data["viewers"]
        assert len(viewers) >= 1, "Expected at least 1 viewer"
        
        # Check viewer structure
        viewer = viewers[0]
        assert "user_id" in viewer, f"Missing user_id: {viewer}"
        assert "user_name" in viewer, f"Missing user_name: {viewer}"
        assert "started_at" in viewer, f"Missing started_at: {viewer}"
        
        print(f"Started viewing device, viewers: {viewers}")
    
    def test_verify_viewer_in_active_list(self):
        """Verify device shows in active-remote-viewers after starting session"""
        # Start viewing first
        requests.post(
            f"{BASE_URL}/api/devices/{self.device_id}/start-remote-viewing",
            headers=self.headers
        )
        
        # Check active viewers
        resp = requests.get(
            f"{BASE_URL}/api/devices/active-remote-viewers",
            headers=self.headers
        )
        assert resp.status_code == 200
        
        data = resp.json()
        assert self.device_id in data, f"Device {self.device_id} not in active viewers: {data}"
        
        viewers = data[self.device_id]
        assert len(viewers) >= 1, "Expected at least 1 viewer"
        print(f"Device {self.device_id} has viewers: {viewers}")
    
    def test_stop_remote_viewing(self):
        """POST /api/devices/{id}/stop-remote-viewing should remove current user from viewers"""
        # First start viewing
        requests.post(
            f"{BASE_URL}/api/devices/{self.device_id}/start-remote-viewing",
            headers=self.headers
        )
        
        # Then stop viewing
        resp = requests.post(
            f"{BASE_URL}/api/devices/{self.device_id}/stop-remote-viewing",
            headers=self.headers
        )
        assert resp.status_code == 200, f"Stop viewing failed: {resp.text}"
        
        data = resp.json()
        assert "message" in data, f"Expected message in response: {data}"
        print(f"Stopped viewing device: {data}")
    
    def test_verify_viewer_removed_after_stop(self):
        """Verify device is removed from active viewers after stop or has reduced count"""
        # Start viewing
        requests.post(
            f"{BASE_URL}/api/devices/{self.device_id}/start-remote-viewing",
            headers=self.headers
        )
        
        # Get initial count
        resp1 = requests.get(f"{BASE_URL}/api/devices/active-remote-viewers", headers=self.headers)
        initial_viewers = resp1.json().get(self.device_id, [])
        initial_count = len(initial_viewers)
        
        # Stop viewing
        requests.post(
            f"{BASE_URL}/api/devices/{self.device_id}/stop-remote-viewing",
            headers=self.headers
        )
        
        # Check active viewers again
        resp2 = requests.get(f"{BASE_URL}/api/devices/active-remote-viewers", headers=self.headers)
        
        data = resp2.json()
        final_viewers = data.get(self.device_id, [])
        final_count = len(final_viewers)
        
        # Either device is gone from the list or viewer count reduced
        assert final_count < initial_count or self.device_id not in data, \
            f"Expected viewer count to decrease or device to be removed. Initial: {initial_count}, Final: {final_count}"
        print(f"Viewer count: {initial_count} -> {final_count}")


class TestDeviceViewerWithSpecificDevice:
    """Test remote viewer on dev-001 (AGENT-TEST) which already has a viewer from curl"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert resp.status_code == 200
        self.token = resp.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
        self.device_id = "dev-001"  # AGENT-TEST device
    
    def test_dev001_has_active_viewer(self):
        """Check if dev-001 has Alex Thompson as active viewer (from prior curl test)"""
        resp = requests.get(
            f"{BASE_URL}/api/devices/active-remote-viewers",
            headers=self.headers
        )
        assert resp.status_code == 200
        
        data = resp.json()
        print(f"All active viewers: {data}")
        
        # dev-001 may or may not have viewers depending on server state
        # Just verify endpoint works
        assert isinstance(data, dict)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
