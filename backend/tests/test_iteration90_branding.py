"""
Iteration 90 - Platform Branding & White-Label Testing
Tests:
1. GET /api/settings/branding - Get branding config (auth required)
2. GET /api/settings/branding/public - Get public branding (no auth)
3. PUT /api/settings/branding - Update branding settings
4. POST /api/settings/branding/upload-logo - Upload logo (multipart)
"""
import pytest
import requests
import os
import io

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

class TestBrandingAPIs:
    """Platform Branding API Tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session with auth"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get token
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        token = login_response.json().get("token")
        assert token, "No token received"
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        yield
    
    def test_01_get_branding_public_no_auth(self):
        """Test GET /api/settings/branding/public - No auth required"""
        response = requests.get(f"{BASE_URL}/api/settings/branding/public")
        assert response.status_code == 200, f"Public branding failed: {response.text}"
        
        data = response.json()
        # Verify expected fields exist
        assert "company_name" in data, "Missing company_name"
        assert "company_logo_url" in data, "Missing company_logo_url"
        assert "company_icon_url" in data, "Missing company_icon_url"
        assert "primary_color" in data, "Missing primary_color"
        assert "login_tagline" in data, "Missing login_tagline"
        assert "login_features" in data, "Missing login_features"
        assert "powered_by_visible" in data, "Missing powered_by_visible"
        
        # Verify data types
        assert isinstance(data["company_name"], str)
        assert isinstance(data["login_features"], list)
        assert isinstance(data["powered_by_visible"], bool)
        
        print(f"Public branding: company_name={data['company_name']}, features={data['login_features']}")
    
    def test_02_get_branding_with_auth(self):
        """Test GET /api/settings/branding - Auth required"""
        response = self.session.get(f"{BASE_URL}/api/settings/branding", headers=self.headers)
        assert response.status_code == 200, f"Get branding failed: {response.text}"
        
        data = response.json()
        # Full branding config should have more fields
        assert "company_name" in data
        assert "primary_color" in data
        assert "secondary_color" in data
        assert "accent_color" in data
        assert "login_tagline" in data
        assert "login_features" in data
        assert "powered_by_visible" in data
        assert "invoice_header_text" in data or "invoice_logo_url" in data
        
        print(f"Full branding config: {list(data.keys())}")
    
    def test_03_get_branding_without_auth_fails(self):
        """Test GET /api/settings/branding without auth returns 401"""
        response = requests.get(f"{BASE_URL}/api/settings/branding")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_04_update_branding_company_name(self):
        """Test PUT /api/settings/branding - Update company name"""
        # Get current branding
        get_response = self.session.get(f"{BASE_URL}/api/settings/branding", headers=self.headers)
        assert get_response.status_code == 200
        original = get_response.json()
        original_name = original.get("company_name", "NexusOps")
        
        # Update with test value
        test_name = "TEST_BrandingCo"
        update_data = {
            "company_name": test_name,
            "primary_color": original.get("primary_color", "#10b981"),
            "secondary_color": original.get("secondary_color", "#8b5cf6"),
            "accent_color": original.get("accent_color", "#06b6d4"),
        }
        
        response = self.session.put(f"{BASE_URL}/api/settings/branding", json=update_data, headers=self.headers)
        assert response.status_code == 200, f"Update branding failed: {response.text}"
        
        # Verify update persisted
        verify_response = self.session.get(f"{BASE_URL}/api/settings/branding", headers=self.headers)
        assert verify_response.status_code == 200
        updated = verify_response.json()
        assert updated["company_name"] == test_name, f"Company name not updated: {updated['company_name']}"
        
        # Restore original
        restore_data = {"company_name": original_name}
        self.session.put(f"{BASE_URL}/api/settings/branding", json=restore_data, headers=self.headers)
        
        print(f"Branding update test passed: {original_name} -> {test_name} -> {original_name}")
    
    def test_05_update_branding_colors(self):
        """Test PUT /api/settings/branding - Update brand colors"""
        # Get current
        get_response = self.session.get(f"{BASE_URL}/api/settings/branding", headers=self.headers)
        original = get_response.json()
        
        # Update colors
        test_colors = {
            "primary_color": "#ff5733",
            "secondary_color": "#33ff57",
            "accent_color": "#3357ff",
        }
        
        response = self.session.put(f"{BASE_URL}/api/settings/branding", json=test_colors, headers=self.headers)
        assert response.status_code == 200, f"Update colors failed: {response.text}"
        
        # Verify
        verify = self.session.get(f"{BASE_URL}/api/settings/branding", headers=self.headers)
        updated = verify.json()
        assert updated["primary_color"] == "#ff5733"
        assert updated["secondary_color"] == "#33ff57"
        assert updated["accent_color"] == "#3357ff"
        
        # Restore
        restore = {
            "primary_color": original.get("primary_color", "#10b981"),
            "secondary_color": original.get("secondary_color", "#8b5cf6"),
            "accent_color": original.get("accent_color", "#06b6d4"),
        }
        self.session.put(f"{BASE_URL}/api/settings/branding", json=restore, headers=self.headers)
        
        print("Brand colors update test passed")
    
    def test_06_update_branding_login_customization(self):
        """Test PUT /api/settings/branding - Update login page customization"""
        # Get current
        get_response = self.session.get(f"{BASE_URL}/api/settings/branding", headers=self.headers)
        original = get_response.json()
        
        # Update login customization
        test_data = {
            "login_tagline": "TEST_Tagline for testing",
            "login_features": ["Feature1", "Feature2", "Feature3"],
            "powered_by_visible": False,
        }
        
        response = self.session.put(f"{BASE_URL}/api/settings/branding", json=test_data, headers=self.headers)
        assert response.status_code == 200, f"Update login customization failed: {response.text}"
        
        # Verify
        verify = self.session.get(f"{BASE_URL}/api/settings/branding", headers=self.headers)
        updated = verify.json()
        assert updated["login_tagline"] == "TEST_Tagline for testing"
        assert updated["login_features"] == ["Feature1", "Feature2", "Feature3"]
        assert updated["powered_by_visible"] == False
        
        # Restore
        restore = {
            "login_tagline": original.get("login_tagline", ""),
            "login_features": original.get("login_features", []),
            "powered_by_visible": original.get("powered_by_visible", True),
        }
        self.session.put(f"{BASE_URL}/api/settings/branding", json=restore, headers=self.headers)
        
        print("Login customization update test passed")
    
    def test_07_update_branding_invoice_email(self):
        """Test PUT /api/settings/branding - Update invoice/email branding"""
        # Get current
        get_response = self.session.get(f"{BASE_URL}/api/settings/branding", headers=self.headers)
        original = get_response.json()
        
        # Update invoice/email branding
        test_data = {
            "invoice_header_text": "TEST_Header | ABN 12 345 678 901",
            "invoice_footer_text": "TEST_Footer | Payment terms: Net 30",
            "email_sender_name": "TEST_Support Team",
            "email_footer_text": "TEST_Company | 123 Test St",
        }
        
        response = self.session.put(f"{BASE_URL}/api/settings/branding", json=test_data, headers=self.headers)
        assert response.status_code == 200, f"Update invoice/email branding failed: {response.text}"
        
        # Verify
        verify = self.session.get(f"{BASE_URL}/api/settings/branding", headers=self.headers)
        updated = verify.json()
        assert updated.get("invoice_header_text") == "TEST_Header | ABN 12 345 678 901"
        assert updated.get("invoice_footer_text") == "TEST_Footer | Payment terms: Net 30"
        assert updated.get("email_sender_name") == "TEST_Support Team"
        assert updated.get("email_footer_text") == "TEST_Company | 123 Test St"
        
        # Restore
        restore = {
            "invoice_header_text": original.get("invoice_header_text", ""),
            "invoice_footer_text": original.get("invoice_footer_text", ""),
            "email_sender_name": original.get("email_sender_name", ""),
            "email_footer_text": original.get("email_footer_text", ""),
        }
        self.session.put(f"{BASE_URL}/api/settings/branding", json=restore, headers=self.headers)
        
        print("Invoice/email branding update test passed")
    
    def test_08_public_branding_reflects_changes(self):
        """Test that public branding endpoint reflects saved changes"""
        # Update branding
        test_data = {
            "company_name": "TEST_PublicCheck",
            "login_tagline": "TEST_Public tagline",
        }
        
        response = self.session.put(f"{BASE_URL}/api/settings/branding", json=test_data, headers=self.headers)
        assert response.status_code == 200
        
        # Check public endpoint (no auth)
        public_response = requests.get(f"{BASE_URL}/api/settings/branding/public")
        assert public_response.status_code == 200
        public_data = public_response.json()
        
        assert public_data["company_name"] == "TEST_PublicCheck"
        assert public_data["login_tagline"] == "TEST_Public tagline"
        
        # Restore
        self.session.put(f"{BASE_URL}/api/settings/branding", json={
            "company_name": "STech Solutions",
            "login_tagline": "Your trusted IT partner",
        }, headers=self.headers)
        
        print("Public branding reflects changes correctly")
    
    def test_09_upload_logo_company(self):
        """Test POST /api/settings/branding/upload-logo?logo_type=company"""
        # Create a simple test image (1x1 PNG)
        png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
        
        # Use requests directly without session to avoid content-type issues
        files = {"file": ("test_logo.png", png_data, "image/png")}
        headers = {"Authorization": self.headers["Authorization"]}
        
        response = requests.post(
            f"{BASE_URL}/api/settings/branding/upload-logo?logo_type=company",
            files=files,
            headers=headers
        )
        assert response.status_code == 200, f"Upload logo failed: {response.text}"
        
        data = response.json()
        assert "url" in data, "No URL returned"
        assert data["url"].startswith("/uploads/branding/")
        
        print(f"Logo upload successful: {data['url']}")
    
    def test_10_upload_logo_icon(self):
        """Test POST /api/settings/branding/upload-logo?logo_type=icon"""
        png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
        
        files = {"file": ("test_icon.png", png_data, "image/png")}
        headers = {"Authorization": self.headers["Authorization"]}
        
        response = requests.post(
            f"{BASE_URL}/api/settings/branding/upload-logo?logo_type=icon",
            files=files,
            headers=headers
        )
        assert response.status_code == 200, f"Upload icon failed: {response.text}"
        
        data = response.json()
        assert "url" in data
        print(f"Icon upload successful: {data['url']}")
    
    def test_11_upload_logo_invoice(self):
        """Test POST /api/settings/branding/upload-logo?logo_type=invoice"""
        png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
        
        files = {"file": ("test_invoice_logo.png", png_data, "image/png")}
        headers = {"Authorization": self.headers["Authorization"]}
        
        response = requests.post(
            f"{BASE_URL}/api/settings/branding/upload-logo?logo_type=invoice",
            files=files,
            headers=headers
        )
        assert response.status_code == 200, f"Upload invoice logo failed: {response.text}"
        
        data = response.json()
        assert "url" in data
        print(f"Invoice logo upload successful: {data['url']}")
    
    def test_12_upload_logo_invalid_file_type(self):
        """Test upload with non-image file returns 400"""
        files = {"file": ("test.txt", b"not an image", "text/plain")}
        headers = {"Authorization": self.headers["Authorization"]}
        
        response = requests.post(
            f"{BASE_URL}/api/settings/branding/upload-logo?logo_type=company",
            files=files,
            headers=headers
        )
        assert response.status_code == 400, f"Expected 400 for non-image, got {response.status_code}"
        print("Invalid file type correctly rejected")


class TestRecurringInvoiceAddLine:
    """Test recurring invoice Add Line functionality"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session with auth"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200
        token = login_response.json().get("token")
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        yield
    
    def test_13_create_recurring_invoice_with_line_items(self):
        """Test creating recurring invoice with multiple line items"""
        # Get a client
        clients_response = self.session.get(f"{BASE_URL}/api/clients", headers=self.headers)
        assert clients_response.status_code == 200
        clients = clients_response.json()
        if not clients:
            pytest.skip("No clients available for testing")
        
        client_id = clients[0]["id"]
        
        # Create recurring invoice with multiple line items
        ri_data = {
            "client_id": client_id,
            "frequency": "monthly",
            "next_invoice_date": "2026-02-01",
            "line_items": [
                {"description": "TEST_Line Item 1", "quantity": "1", "rate": "100", "amount": "100"},
                {"description": "TEST_Line Item 2", "quantity": "2", "rate": "50", "amount": "100"},
                {"description": "TEST_Line Item 3", "quantity": "3", "rate": "25", "amount": "75"},
            ],
            "subtotal": 275,
            "tax": 27.5,
            "total": 302.5,
            "status": "active",
        }
        
        response = self.session.post(f"{BASE_URL}/api/recurring-invoices/create", json=ri_data, headers=self.headers)
        assert response.status_code in [200, 201], f"Create recurring invoice failed: {response.text}"
        
        created = response.json()
        ri_id = created.get("id")
        assert ri_id, "No ID returned"
        
        # Verify line items
        assert len(created.get("line_items", [])) == 3, f"Expected 3 line items, got {len(created.get('line_items', []))}"
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/recurring-invoices/{ri_id}", headers=self.headers)
        
        print(f"Created recurring invoice with 3 line items: {ri_id}")
    
    def test_14_update_recurring_invoice_add_line_item(self):
        """Test updating recurring invoice to add more line items"""
        # Get a client
        clients_response = self.session.get(f"{BASE_URL}/api/clients", headers=self.headers)
        clients = clients_response.json()
        if not clients:
            pytest.skip("No clients available")
        
        client_id = clients[0]["id"]
        
        # Create with 1 line item
        ri_data = {
            "client_id": client_id,
            "frequency": "monthly",
            "next_invoice_date": "2026-02-01",
            "line_items": [
                {"description": "TEST_Initial Line", "quantity": "1", "rate": "100", "amount": "100"},
            ],
            "subtotal": 100,
            "tax": 10,
            "total": 110,
            "status": "active",
        }
        
        create_response = self.session.post(f"{BASE_URL}/api/recurring-invoices/create", json=ri_data, headers=self.headers)
        assert create_response.status_code in [200, 201]
        ri_id = create_response.json().get("id")
        
        # Update to add more line items
        update_data = {
            "line_items": [
                {"description": "TEST_Initial Line", "quantity": "1", "rate": "100", "amount": "100"},
                {"description": "TEST_Added Line 1", "quantity": "2", "rate": "50", "amount": "100"},
                {"description": "TEST_Added Line 2", "quantity": "1", "rate": "75", "amount": "75"},
            ],
            "subtotal": 275,
            "tax": 27.5,
            "total": 302.5,
        }
        
        update_response = self.session.put(f"{BASE_URL}/api/recurring-invoices/{ri_id}", json=update_data, headers=self.headers)
        assert update_response.status_code == 200, f"Update failed: {update_response.text}"
        
        # Verify
        get_response = self.session.get(f"{BASE_URL}/api/recurring-invoices/{ri_id}", headers=self.headers)
        assert get_response.status_code == 200
        updated = get_response.json()
        assert len(updated.get("line_items", [])) == 3, f"Expected 3 line items after update"
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/recurring-invoices/{ri_id}", headers=self.headers)
        
        print(f"Successfully added line items to recurring invoice: {ri_id}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
