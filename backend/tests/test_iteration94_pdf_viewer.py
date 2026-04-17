"""
Iteration 94 - PDF Viewer/Preview System Testing
Tests for:
- Contract PDF generation (inline and download)
- PO PDF preview
- Invoice Theme preview PDF
- Invoice PDF preview (existing)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"


class TestPdfViewerSystem:
    """Tests for PDF viewer/preview endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token for all tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get token
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.token = login_response.json().get("token")
        assert self.token, "No token returned"
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    # ============ CONTRACT PDF TESTS ============
    
    def test_get_contracts_list(self):
        """Get list of contracts to find a valid contract ID"""
        response = self.session.get(f"{BASE_URL}/api/contracts")
        assert response.status_code == 200, f"Failed to get contracts: {response.text}"
        contracts = response.json()
        assert isinstance(contracts, list), "Contracts should be a list"
        print(f"Found {len(contracts)} contracts")
        return contracts
    
    def test_contract_pdf_preview_inline(self):
        """Test GET /api/contracts/{id}/pdf?token=JWT returns PDF inline"""
        # First get a contract
        contracts = self.test_get_contracts_list()
        if not contracts:
            pytest.skip("No contracts available for testing")
        
        contract_id = contracts[0]["id"]
        contract_name = contracts[0].get("name", "Unknown")
        print(f"Testing PDF preview for contract: {contract_name} ({contract_id})")
        
        # Request PDF with token as query param
        response = requests.get(
            f"{BASE_URL}/api/contracts/{contract_id}/pdf",
            params={"token": self.token}
        )
        
        assert response.status_code == 200, f"Contract PDF preview failed: {response.status_code} - {response.text}"
        assert response.headers.get("content-type") == "application/pdf", f"Expected PDF content-type, got: {response.headers.get('content-type')}"
        
        # Check Content-Disposition is inline
        content_disp = response.headers.get("content-disposition", "")
        assert "inline" in content_disp, f"Expected inline disposition, got: {content_disp}"
        print(f"Contract PDF preview SUCCESS - Content-Disposition: {content_disp}")
    
    def test_contract_pdf_download_attachment(self):
        """Test GET /api/contracts/{id}/pdf/download?token=JWT returns PDF as attachment"""
        contracts = self.test_get_contracts_list()
        if not contracts:
            pytest.skip("No contracts available for testing")
        
        contract_id = contracts[0]["id"]
        
        response = requests.get(
            f"{BASE_URL}/api/contracts/{contract_id}/pdf/download",
            params={"token": self.token}
        )
        
        assert response.status_code == 200, f"Contract PDF download failed: {response.status_code}"
        assert response.headers.get("content-type") == "application/pdf"
        
        # Check Content-Disposition is attachment
        content_disp = response.headers.get("content-disposition", "")
        assert "attachment" in content_disp, f"Expected attachment disposition, got: {content_disp}"
        print(f"Contract PDF download SUCCESS - Content-Disposition: {content_disp}")
    
    def test_contract_pdf_invalid_id(self):
        """Test contract PDF with invalid ID returns 404"""
        response = requests.get(
            f"{BASE_URL}/api/contracts/invalid-contract-id-12345/pdf",
            params={"token": self.token}
        )
        assert response.status_code == 404, f"Expected 404 for invalid contract, got: {response.status_code}"
        print("Contract PDF 404 for invalid ID - PASS")
    
    def test_contract_pdf_no_token(self):
        """Test contract PDF without token returns 401"""
        contracts = self.test_get_contracts_list()
        if not contracts:
            pytest.skip("No contracts available for testing")
        
        contract_id = contracts[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/contracts/{contract_id}/pdf")
        assert response.status_code in [401, 422], f"Expected 401/422 without token, got: {response.status_code}"
        print("Contract PDF 401 without token - PASS")
    
    # ============ PURCHASE ORDER PDF TESTS ============
    
    def test_get_purchase_orders_list(self):
        """Get list of purchase orders to find a valid PO ID"""
        response = self.session.get(f"{BASE_URL}/api/purchase-orders")
        assert response.status_code == 200, f"Failed to get POs: {response.text}"
        pos = response.json()
        assert isinstance(pos, list), "POs should be a list"
        print(f"Found {len(pos)} purchase orders")
        return pos
    
    def test_po_pdf_preview_inline(self):
        """Test GET /api/purchase-orders/{id}/pdf/preview?token=JWT returns PDF inline"""
        pos = self.test_get_purchase_orders_list()
        if not pos:
            pytest.skip("No purchase orders available for testing")
        
        po_id = pos[0]["id"]
        po_number = pos[0].get("po_number", "Unknown")
        print(f"Testing PDF preview for PO: {po_number} ({po_id})")
        
        response = requests.get(
            f"{BASE_URL}/api/purchase-orders/{po_id}/pdf/preview",
            params={"token": self.token}
        )
        
        assert response.status_code == 200, f"PO PDF preview failed: {response.status_code} - {response.text}"
        assert response.headers.get("content-type") == "application/pdf", f"Expected PDF content-type, got: {response.headers.get('content-type')}"
        
        content_disp = response.headers.get("content-disposition", "")
        assert "inline" in content_disp, f"Expected inline disposition, got: {content_disp}"
        print(f"PO PDF preview SUCCESS - Content-Disposition: {content_disp}")
    
    def test_po_pdf_preview_invalid_id(self):
        """Test PO PDF preview with invalid ID returns 404"""
        response = requests.get(
            f"{BASE_URL}/api/purchase-orders/invalid-po-id-12345/pdf/preview",
            params={"token": self.token}
        )
        assert response.status_code == 404, f"Expected 404 for invalid PO, got: {response.status_code}"
        print("PO PDF preview 404 for invalid ID - PASS")
    
    def test_po_pdf_preview_no_token(self):
        """Test PO PDF preview without token returns 401"""
        pos = self.test_get_purchase_orders_list()
        if not pos:
            pytest.skip("No purchase orders available for testing")
        
        po_id = pos[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/purchase-orders/{po_id}/pdf/preview")
        assert response.status_code in [401, 422], f"Expected 401/422 without token, got: {response.status_code}"
        print("PO PDF preview 401 without token - PASS")
    
    # ============ INVOICE THEME PREVIEW PDF TESTS ============
    
    def test_invoice_theme_classic_preview_pdf(self):
        """Test GET /api/invoice-themes/theme-classic/preview-pdf?token=JWT returns sample PDF"""
        response = requests.get(
            f"{BASE_URL}/api/invoice-themes/theme-classic/preview-pdf",
            params={"token": self.token}
        )
        
        assert response.status_code == 200, f"Theme classic preview failed: {response.status_code} - {response.text}"
        assert response.headers.get("content-type") == "application/pdf"
        
        content_disp = response.headers.get("content-disposition", "")
        assert "inline" in content_disp, f"Expected inline disposition, got: {content_disp}"
        assert "theme-preview.pdf" in content_disp, f"Expected theme-preview.pdf filename, got: {content_disp}"
        print(f"Theme classic preview PDF SUCCESS - Content-Disposition: {content_disp}")
    
    def test_invoice_theme_executive_preview_pdf(self):
        """Test GET /api/invoice-themes/theme-executive/preview-pdf?token=JWT returns sample PDF"""
        response = requests.get(
            f"{BASE_URL}/api/invoice-themes/theme-executive/preview-pdf",
            params={"token": self.token}
        )
        
        assert response.status_code == 200, f"Theme executive preview failed: {response.status_code} - {response.text}"
        assert response.headers.get("content-type") == "application/pdf"
        print("Theme executive preview PDF SUCCESS")
    
    def test_invoice_theme_modern_preview_pdf(self):
        """Test GET /api/invoice-themes/theme-modern/preview-pdf?token=JWT returns sample PDF"""
        response = requests.get(
            f"{BASE_URL}/api/invoice-themes/theme-modern/preview-pdf",
            params={"token": self.token}
        )
        
        assert response.status_code == 200, f"Theme modern preview failed: {response.status_code}"
        assert response.headers.get("content-type") == "application/pdf"
        print("Theme modern preview PDF SUCCESS")
    
    def test_invoice_theme_minimal_preview_pdf(self):
        """Test GET /api/invoice-themes/theme-minimal/preview-pdf?token=JWT returns sample PDF"""
        response = requests.get(
            f"{BASE_URL}/api/invoice-themes/theme-minimal/preview-pdf",
            params={"token": self.token}
        )
        
        assert response.status_code == 200, f"Theme minimal preview failed: {response.status_code}"
        assert response.headers.get("content-type") == "application/pdf"
        print("Theme minimal preview PDF SUCCESS")
    
    def test_invoice_theme_bold_preview_pdf(self):
        """Test GET /api/invoice-themes/theme-bold/preview-pdf?token=JWT returns sample PDF"""
        response = requests.get(
            f"{BASE_URL}/api/invoice-themes/theme-bold/preview-pdf",
            params={"token": self.token}
        )
        
        assert response.status_code == 200, f"Theme bold preview failed: {response.status_code}"
        assert response.headers.get("content-type") == "application/pdf"
        print("Theme bold preview PDF SUCCESS")
    
    def test_invoice_theme_preview_no_token(self):
        """Test theme preview without token returns 401"""
        response = requests.get(f"{BASE_URL}/api/invoice-themes/theme-classic/preview-pdf")
        assert response.status_code in [401, 422], f"Expected 401/422 without token, got: {response.status_code}"
        print("Theme preview 401 without token - PASS")
    
    def test_invoice_theme_preview_invalid_theme(self):
        """Test theme preview with invalid theme ID still works (uses empty config)"""
        response = requests.get(
            f"{BASE_URL}/api/invoice-themes/invalid-theme-xyz/preview-pdf",
            params={"token": self.token}
        )
        # Should still return 200 with default/empty theme config
        assert response.status_code == 200, f"Invalid theme preview should still work, got: {response.status_code}"
        print("Invalid theme preview returns PDF with default config - PASS")
    
    # ============ INVOICE PDF TESTS (EXISTING) ============
    
    def test_get_invoices_list(self):
        """Get list of invoices to find a valid invoice ID"""
        response = self.session.get(f"{BASE_URL}/api/xero/invoices")
        if response.status_code != 200:
            # Try alternative endpoint
            response = self.session.get(f"{BASE_URL}/api/invoices")
        
        assert response.status_code == 200, f"Failed to get invoices: {response.text}"
        invoices = response.json()
        assert isinstance(invoices, list), "Invoices should be a list"
        print(f"Found {len(invoices)} invoices")
        return invoices
    
    def test_invoice_pdf_preview(self):
        """Test GET /api/invoices/{id}/pdf?token=JWT returns PDF inline"""
        invoices = self.test_get_invoices_list()
        if not invoices:
            pytest.skip("No invoices available for testing")
        
        invoice_id = invoices[0]["id"]
        invoice_number = invoices[0].get("invoice_number", "Unknown")
        print(f"Testing PDF preview for invoice: {invoice_number} ({invoice_id})")
        
        response = requests.get(
            f"{BASE_URL}/api/invoices/{invoice_id}/pdf",
            params={"token": self.token}
        )
        
        assert response.status_code == 200, f"Invoice PDF preview failed: {response.status_code} - {response.text}"
        assert response.headers.get("content-type") == "application/pdf"
        
        content_disp = response.headers.get("content-disposition", "")
        assert "inline" in content_disp, f"Expected inline disposition, got: {content_disp}"
        print(f"Invoice PDF preview SUCCESS - Content-Disposition: {content_disp}")
    
    def test_invoice_pdf_download(self):
        """Test GET /api/invoices/{id}/pdf/download?token=JWT returns PDF as attachment"""
        invoices = self.test_get_invoices_list()
        if not invoices:
            pytest.skip("No invoices available for testing")
        
        invoice_id = invoices[0]["id"]
        
        response = requests.get(
            f"{BASE_URL}/api/invoices/{invoice_id}/pdf/download",
            params={"token": self.token}
        )
        
        assert response.status_code == 200, f"Invoice PDF download failed: {response.status_code}"
        assert response.headers.get("content-type") == "application/pdf"
        
        content_disp = response.headers.get("content-disposition", "")
        assert "attachment" in content_disp, f"Expected attachment disposition, got: {content_disp}"
        print(f"Invoice PDF download SUCCESS - Content-Disposition: {content_disp}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
