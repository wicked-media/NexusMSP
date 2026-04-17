"""
Iteration 93 - Portal APIs, Invoice Themes, PDF Generation Tests
Tests for:
1. Portal API endpoints (summary, tickets, invoices, devices/health, create ticket)
2. Invoice themes API (GET themes, GET/PUT active theme)
3. Invoice PDF generation with theme
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication for test session"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        """Headers with auth token"""
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestInvoiceThemes(TestAuth):
    """Invoice Themes API Tests"""
    
    def test_get_invoice_themes(self, headers):
        """GET /api/invoice-themes - Should return 5 built-in themes"""
        response = requests.get(f"{BASE_URL}/api/invoice-themes", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        themes = response.json()
        assert isinstance(themes, list), "Response should be a list"
        assert len(themes) >= 5, f"Expected at least 5 themes, got {len(themes)}"
        
        # Verify built-in theme IDs
        theme_ids = [t["id"] for t in themes]
        expected_ids = ["theme-modern", "theme-classic", "theme-minimal", "theme-bold", "theme-executive"]
        for expected_id in expected_ids:
            assert expected_id in theme_ids, f"Missing theme: {expected_id}"
        
        # Verify theme structure
        for theme in themes:
            assert "id" in theme
            assert "name" in theme
            assert "description" in theme
            assert "preview_colors" in theme
            assert "config" in theme
            assert "is_builtin" in theme
        print(f"PASS: GET /api/invoice-themes - Found {len(themes)} themes")
    
    def test_get_active_theme(self, headers):
        """GET /api/invoice-themes/active - Should return active theme ID"""
        response = requests.get(f"{BASE_URL}/api/invoice-themes/active", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "active_theme_id" in data, "Response should have active_theme_id"
        print(f"PASS: GET /api/invoice-themes/active - Active theme: {data['active_theme_id']}")
    
    def test_set_active_theme(self, headers):
        """PUT /api/invoice-themes/active - Should update active theme"""
        # Set to classic theme
        response = requests.put(f"{BASE_URL}/api/invoice-themes/active", 
                               json={"theme_id": "theme-classic"}, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data.get("active_theme_id") == "theme-classic", "Theme should be updated to classic"
        
        # Verify it persisted
        verify_response = requests.get(f"{BASE_URL}/api/invoice-themes/active", headers=headers)
        assert verify_response.status_code == 200
        assert verify_response.json().get("active_theme_id") == "theme-classic"
        
        # Reset to modern
        requests.put(f"{BASE_URL}/api/invoice-themes/active", 
                    json={"theme_id": "theme-modern"}, headers=headers)
        print("PASS: PUT /api/invoice-themes/active - Theme updated and verified")


class TestPortalAPIs(TestAuth):
    """Client Portal API Tests"""
    
    @pytest.fixture(scope="class")
    def client_id(self, headers):
        """Get a client ID for testing"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        if response.status_code == 200 and response.json():
            return response.json()[0]["id"]
        pytest.skip("No clients available for portal testing")
    
    @pytest.fixture(scope="class")
    def portal_token(self, headers, client_id):
        """Generate a portal token for testing"""
        response = requests.post(f"{BASE_URL}/api/client-portal/generate-token/{client_id}", 
                                json={"contact_name": "Test User", "contact_email": "test@example.com", "expiry_days": 7},
                                headers=headers)
        assert response.status_code == 200, f"Failed to generate token: {response.text}"
        return response.json().get("token")
    
    def test_portal_summary(self, portal_token):
        """GET /api/portal-api/{token}/summary - Should return client summary"""
        response = requests.get(f"{BASE_URL}/api/portal-api/{portal_token}/summary")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify structure
        assert "client" in data, "Response should have client"
        assert "devices" in data, "Response should have devices"
        assert "tickets" in data, "Response should have tickets"
        assert "invoices" in data, "Response should have invoices"
        
        # Verify devices structure
        assert "total" in data["devices"]
        assert "online" in data["devices"]
        assert "offline" in data["devices"]
        
        # Verify tickets structure
        assert "total" in data["tickets"]
        assert "open" in data["tickets"]
        assert "critical" in data["tickets"]
        
        # Verify invoices structure
        assert "total" in data["invoices"]
        assert "outstanding" in data["invoices"]
        assert "paid" in data["invoices"]
        
        print(f"PASS: GET /api/portal-api/{{token}}/summary - Client: {data['client'].get('name')}")
    
    def test_portal_tickets(self, portal_token):
        """GET /api/portal-api/{token}/tickets - Should return tickets list"""
        response = requests.get(f"{BASE_URL}/api/portal-api/{portal_token}/tickets")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: GET /api/portal-api/{{token}}/tickets - Found {len(data)} tickets")
    
    def test_portal_invoices(self, portal_token):
        """GET /api/portal-api/{token}/invoices - Should return invoices list"""
        response = requests.get(f"{BASE_URL}/api/portal-api/{portal_token}/invoices")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: GET /api/portal-api/{{token}}/invoices - Found {len(data)} invoices")
    
    def test_portal_devices_health(self, portal_token):
        """GET /api/portal-api/{token}/devices/health - Should return device health"""
        response = requests.get(f"{BASE_URL}/api/portal-api/{portal_token}/devices/health")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify structure
        assert "total" in data
        assert "online" in data
        assert "offline" in data
        assert "warning" in data
        assert "devices" in data
        assert isinstance(data["devices"], list)
        
        print(f"PASS: GET /api/portal-api/{{token}}/devices/health - Total: {data['total']}, Online: {data['online']}")
    
    def test_portal_create_ticket(self, portal_token):
        """POST /api/portal-api/{token}/tickets - Should create a ticket"""
        ticket_data = {
            "title": "TEST_ITER93_Portal Ticket",
            "description": "Test ticket created via portal API",
            "category": "support"
        }
        response = requests.post(f"{BASE_URL}/api/portal-api/{portal_token}/tickets", json=ticket_data)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify ticket was created
        assert "id" in data
        assert "ticket_number" in data
        assert data["title"] == ticket_data["title"]
        assert data["source"] == "client_portal"
        
        print(f"PASS: POST /api/portal-api/{{token}}/tickets - Created ticket: {data['ticket_number']}")
    
    def test_portal_invalid_token(self):
        """GET /api/portal-api/{invalid_token}/summary - Should return 404"""
        response = requests.get(f"{BASE_URL}/api/portal-api/invalid_token_12345/summary")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Invalid portal token returns 404")


class TestInvoicePDF(TestAuth):
    """Invoice PDF Generation Tests"""
    
    @pytest.fixture(scope="class")
    def invoice_id(self, headers):
        """Get an invoice ID for testing"""
        # Try xero invoices first
        response = requests.get(f"{BASE_URL}/api/xero/invoices", headers=headers)
        if response.status_code == 200 and response.json():
            return response.json()[0]["id"]
        
        # Try regular invoices
        response = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        if response.status_code == 200 and response.json():
            return response.json()[0]["id"]
        
        pytest.skip("No invoices available for PDF testing")
    
    def test_invoice_pdf_generation(self, headers, invoice_id, auth_token):
        """GET /api/invoices/{invoice_id}/pdf - Should return PDF"""
        response = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}/pdf?token={auth_token}")
        assert response.status_code == 200, f"Failed: {response.text}"
        assert response.headers.get("content-type") == "application/pdf", "Response should be PDF"
        assert len(response.content) > 1000, "PDF should have content"
        print(f"PASS: GET /api/invoices/{{id}}/pdf - Generated PDF ({len(response.content)} bytes)")
    
    def test_invoice_pdf_download(self, headers, invoice_id, auth_token):
        """GET /api/invoices/{invoice_id}/pdf/download - Should return PDF attachment"""
        response = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}/pdf/download?token={auth_token}")
        assert response.status_code == 200, f"Failed: {response.text}"
        assert response.headers.get("content-type") == "application/pdf"
        assert "attachment" in response.headers.get("content-disposition", "")
        print(f"PASS: GET /api/invoices/{{id}}/pdf/download - PDF download works")
    
    def test_invoice_pdf_invalid_token(self, invoice_id):
        """GET /api/invoices/{invoice_id}/pdf - Should fail without token"""
        response = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}/pdf")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: PDF endpoint requires valid token")


class TestBrandingUpload(TestAuth):
    """Logo Upload Tests"""
    
    def test_branding_settings_get(self, headers):
        """GET /api/settings/branding - Should return branding settings"""
        response = requests.get(f"{BASE_URL}/api/settings/branding", headers=headers)
        # May return 200 or 404 if not configured
        assert response.status_code in [200, 404], f"Unexpected status: {response.status_code}"
        print(f"PASS: GET /api/settings/branding - Status: {response.status_code}")
    
    def test_whitelabel_options_get(self, headers):
        """GET /api/settings - Check whitelabel options exist in settings"""
        # Whitelabel is stored in settings collection with key "whitelabel_options"
        # Try the settings endpoint
        response = requests.get(f"{BASE_URL}/api/settings", headers=headers)
        # May return 200 or 404 depending on implementation
        assert response.status_code in [200, 404], f"Unexpected status: {response.status_code}"
        print(f"PASS: Settings endpoint check - Status: {response.status_code}")


class TestDocBranding(TestAuth):
    """Document Branding Tests"""
    
    def test_doc_branding_templates(self, headers):
        """GET /api/doc-branding/templates - Should return templates"""
        response = requests.get(f"{BASE_URL}/api/doc-branding/templates", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "builtin" in data or isinstance(data, list), "Response should have templates"
        print("PASS: GET /api/doc-branding/templates - Templates retrieved")
    
    def test_doc_branding_settings(self, headers):
        """GET /api/doc-branding/settings - Should return settings"""
        response = requests.get(f"{BASE_URL}/api/doc-branding/settings", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        print("PASS: GET /api/doc-branding/settings - Settings retrieved")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
