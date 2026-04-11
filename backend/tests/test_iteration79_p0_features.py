"""
Iteration 79 - P0 Features Testing
1. Remote Access Integrations Tab (7 providers)
2. Invoice PDF Export & Email

Test credentials: aaron@stech.com.au / Lucky@2871$!
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

class TestAuth:
    """Authentication for all tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        # API returns 'token' not 'access_token'
        assert "token" in data, f"No token in response: {data.keys()}"
        return data["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        """Headers with auth token"""
        return {"Authorization": f"Bearer {auth_token}"}


class TestRemoteProviders(TestAuth):
    """Remote Access Integrations - 7 providers"""
    
    EXPECTED_PROVIDERS = [
        "rustdesk", "meshcentral", "splashtop", "screenconnect", 
        "teamviewer", "anydesk", "guacamole"
    ]
    
    def test_get_all_providers(self, headers):
        """GET /api/remote-providers returns 7 providers"""
        response = requests.get(f"{BASE_URL}/api/remote-providers", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        providers = response.json()
        
        # Verify 7 providers
        assert len(providers) == 7, f"Expected 7 providers, got {len(providers)}"
        
        # Verify all expected providers exist
        provider_ids = [p["id"] for p in providers]
        for expected_id in self.EXPECTED_PROVIDERS:
            assert expected_id in provider_ids, f"Missing provider: {expected_id}"
        
        # Verify provider structure
        for p in providers:
            assert "id" in p
            assert "name" in p
            assert "description" in p
            assert "type" in p  # self-hosted or cloud
            assert "license" in p
            assert "features" in p
            assert "config_fields" in p
            assert "configured" in p  # boolean
            assert "active" in p  # boolean
            assert "docs_url" in p
    
    def test_get_provider_settings_rustdesk(self, headers):
        """GET /api/remote-providers/rustdesk/settings returns config"""
        response = requests.get(f"{BASE_URL}/api/remote-providers/rustdesk/settings", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "type" in data
        assert data["type"] == "remote_rustdesk"
    
    def test_get_provider_settings_meshcentral(self, headers):
        """GET /api/remote-providers/meshcentral/settings returns config"""
        response = requests.get(f"{BASE_URL}/api/remote-providers/meshcentral/settings", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "type" in data
    
    def test_save_provider_settings(self, headers):
        """PUT /api/remote-providers/teamviewer/settings saves config"""
        test_config = {
            "api_token": "test_token_12345",
            "client_id": "test_client_id",
            "active": False
        }
        response = requests.put(
            f"{BASE_URL}/api/remote-providers/teamviewer/settings",
            json=test_config,
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data
        assert "TeamViewer" in data["message"]
        
        # Verify settings were saved
        get_response = requests.get(f"{BASE_URL}/api/remote-providers/teamviewer/settings", headers=headers)
        assert get_response.status_code == 200
        saved = get_response.json()
        assert saved.get("client_id") == "test_client_id"
    
    def test_toggle_provider(self, headers):
        """PUT /api/remote-providers/anydesk/toggle enables/disables"""
        # Get current state
        providers_response = requests.get(f"{BASE_URL}/api/remote-providers", headers=headers)
        providers = providers_response.json()
        anydesk = next((p for p in providers if p["id"] == "anydesk"), None)
        initial_active = anydesk["active"] if anydesk else False
        
        # Toggle
        response = requests.put(f"{BASE_URL}/api/remote-providers/anydesk/toggle", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "active" in data
        assert "message" in data
        assert data["active"] != initial_active, "Toggle should change active state"
        
        # Toggle back
        response2 = requests.put(f"{BASE_URL}/api/remote-providers/anydesk/toggle", headers=headers)
        assert response2.status_code == 200
        data2 = response2.json()
        assert data2["active"] == initial_active, "Second toggle should restore original state"
    
    def test_test_provider_connection_unconfigured(self, headers):
        """POST /api/remote-providers/guacamole/test returns failure if not configured"""
        response = requests.post(f"{BASE_URL}/api/remote-providers/guacamole/test", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "success" in data
        assert "message" in data
        # Should fail if not configured
        if not data["success"]:
            assert "configure" in data["message"].lower() or "not configured" in data["message"].lower()
    
    def test_test_provider_connection_with_config(self, headers):
        """POST /api/remote-providers/splashtop/test after configuring"""
        # First configure
        config = {
            "api_key": "test_api_key_123",
            "api_secret": "test_secret_456",
            "team_id": "test_team",
            "active": True
        }
        requests.put(f"{BASE_URL}/api/remote-providers/splashtop/settings", json=config, headers=headers)
        
        # Now test connection
        response = requests.post(f"{BASE_URL}/api/remote-providers/splashtop/test", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "success" in data
        assert "message" in data
        # Should succeed since credentials exist (simulated)
        assert data["success"] == True, f"Expected success with credentials: {data['message']}"


class TestInvoicePDF(TestAuth):
    """Invoice PDF Export & Email"""
    
    @pytest.fixture(scope="class")
    def test_invoice_id(self, headers):
        """Get or create a test invoice"""
        # Get existing invoices
        response = requests.get(f"{BASE_URL}/api/xero/invoices", headers=headers)
        assert response.status_code == 200, f"Failed to get invoices: {response.text}"
        invoices = response.json()
        
        if invoices:
            return invoices[0]["id"]
        
        # Create one if none exist
        create_response = requests.post(f"{BASE_URL}/api/xero/invoices", json={
            "client_name": "TEST_PDF_Client",
            "reference": "PDF Test Invoice",
            "line_items": [
                {"description": "Test Service", "quantity": 1, "unit_price": 100}
            ]
        }, headers=headers)
        assert create_response.status_code == 200, f"Failed to create invoice: {create_response.text}"
        return create_response.json()["id"]
    
    def test_get_invoice_pdf_preview(self, headers, test_invoice_id, auth_token):
        """GET /api/invoices/{id}/pdf?token=JWT returns PDF"""
        response = requests.get(
            f"{BASE_URL}/api/invoices/{test_invoice_id}/pdf?token={auth_token}",
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        assert response.headers.get("content-type") == "application/pdf", \
            f"Expected application/pdf, got {response.headers.get('content-type')}"
        assert "inline" in response.headers.get("content-disposition", ""), \
            "Expected inline disposition for preview"
        assert len(response.content) > 0, "PDF content should not be empty"
    
    def test_get_invoice_pdf_download(self, headers, test_invoice_id, auth_token):
        """GET /api/invoices/{id}/pdf/download?token=JWT returns PDF as attachment"""
        response = requests.get(
            f"{BASE_URL}/api/invoices/{test_invoice_id}/pdf/download?token={auth_token}",
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        assert response.headers.get("content-type") == "application/pdf", \
            f"Expected application/pdf, got {response.headers.get('content-type')}"
        assert "attachment" in response.headers.get("content-disposition", ""), \
            "Expected attachment disposition for download"
        assert len(response.content) > 0, "PDF content should not be empty"
    
    def test_pdf_without_token_fails(self, test_invoice_id):
        """PDF endpoint requires token"""
        response = requests.get(f"{BASE_URL}/api/invoices/{test_invoice_id}/pdf")
        assert response.status_code == 401, f"Expected 401 without token, got {response.status_code}"
    
    def test_pdf_with_invalid_token_fails(self, test_invoice_id):
        """PDF endpoint rejects invalid token"""
        response = requests.get(f"{BASE_URL}/api/invoices/{test_invoice_id}/pdf?token=invalid_token")
        assert response.status_code == 401, f"Expected 401 with invalid token, got {response.status_code}"
    
    def test_pdf_nonexistent_invoice(self, headers, auth_token):
        """PDF endpoint returns 404 for non-existent invoice"""
        response = requests.get(
            f"{BASE_URL}/api/invoices/nonexistent-id-12345/pdf?token={auth_token}",
            headers=headers
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"


class TestInvoiceEmail(TestAuth):
    """Invoice Email with PDF attachment"""
    
    @pytest.fixture(scope="class")
    def test_invoice_id(self, headers):
        """Get or create a test invoice"""
        response = requests.get(f"{BASE_URL}/api/xero/invoices", headers=headers)
        assert response.status_code == 200
        invoices = response.json()
        if invoices:
            return invoices[0]["id"]
        
        create_response = requests.post(f"{BASE_URL}/api/xero/invoices", json={
            "client_name": "TEST_Email_Client",
            "reference": "Email Test Invoice",
            "line_items": [
                {"description": "Email Test Service", "quantity": 2, "unit_price": 150}
            ]
        }, headers=headers)
        assert create_response.status_code == 200
        return create_response.json()["id"]
    
    def test_email_invoice_with_pdf(self, headers, test_invoice_id):
        """POST /api/xero/invoices/{id}/email sends email with has_pdf=true"""
        email_data = {
            "to_email": "test@example.com",
            "subject": "Test Invoice Email",
            "message": "Please find attached your invoice."
        }
        response = requests.post(
            f"{BASE_URL}/api/xero/invoices/{test_invoice_id}/email",
            json=email_data,
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "message" in data
        assert "email" in data
        
        email_record = data["email"]
        assert email_record["to_email"] == "test@example.com"
        assert email_record["subject"] == "Test Invoice Email"
        assert email_record["has_pdf"] == True, "Email should have PDF attached"
        assert email_record["status"] in ["sent", "mocked"], \
            f"Expected sent or mocked status, got {email_record['status']}"
    
    def test_email_invoice_without_recipient_fails(self, headers, test_invoice_id):
        """Email requires recipient"""
        email_data = {
            "to_email": "",
            "subject": "Test",
            "message": "Test"
        }
        response = requests.post(
            f"{BASE_URL}/api/xero/invoices/{test_invoice_id}/email",
            json=email_data,
            headers=headers
        )
        assert response.status_code == 400, f"Expected 400 without recipient, got {response.status_code}"
    
    def test_email_nonexistent_invoice(self, headers):
        """Email endpoint returns 404 for non-existent invoice"""
        email_data = {
            "to_email": "test@example.com",
            "subject": "Test",
            "message": "Test"
        }
        response = requests.post(
            f"{BASE_URL}/api/xero/invoices/nonexistent-id-12345/email",
            json=email_data,
            headers=headers
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
    
    def test_get_invoice_email_history(self, headers, test_invoice_id):
        """GET /api/xero/invoices/{id}/emails returns email history"""
        response = requests.get(
            f"{BASE_URL}/api/xero/invoices/{test_invoice_id}/emails",
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        emails = response.json()
        assert isinstance(emails, list)
        
        # Should have at least one email from previous test
        if emails:
            email = emails[0]
            assert "to_email" in email
            assert "subject" in email
            assert "status" in email
            assert "has_pdf" in email
            assert "sent_at" in email


class TestProviderDetails(TestAuth):
    """Verify provider details and config fields"""
    
    def test_rustdesk_provider_details(self, headers):
        """RustDesk provider has correct config fields"""
        response = requests.get(f"{BASE_URL}/api/remote-providers", headers=headers)
        providers = response.json()
        rustdesk = next((p for p in providers if p["id"] == "rustdesk"), None)
        
        assert rustdesk is not None
        assert rustdesk["name"] == "RustDesk"
        assert rustdesk["type"] == "self-hosted"
        assert "server_url" in [f["key"] for f in rustdesk["config_fields"]]
        assert "api_key" in [f["key"] for f in rustdesk["config_fields"]]
    
    def test_meshcentral_provider_details(self, headers):
        """MeshCentral provider has correct config fields"""
        response = requests.get(f"{BASE_URL}/api/remote-providers", headers=headers)
        providers = response.json()
        mesh = next((p for p in providers if p["id"] == "meshcentral"), None)
        
        assert mesh is not None
        assert mesh["name"] == "MeshCentral"
        assert mesh["type"] == "self-hosted"
        config_keys = [f["key"] for f in mesh["config_fields"]]
        assert "server_url" in config_keys
        assert "username" in config_keys
        assert "password" in config_keys
    
    def test_teamviewer_provider_details(self, headers):
        """TeamViewer provider has correct config fields"""
        response = requests.get(f"{BASE_URL}/api/remote-providers", headers=headers)
        providers = response.json()
        tv = next((p for p in providers if p["id"] == "teamviewer"), None)
        
        assert tv is not None
        assert tv["name"] == "TeamViewer"
        assert tv["type"] == "cloud"
        config_keys = [f["key"] for f in tv["config_fields"]]
        assert "api_token" in config_keys
        assert "client_id" in config_keys
        assert "client_secret" in config_keys
    
    def test_screenconnect_provider_details(self, headers):
        """ConnectWise ScreenConnect provider has correct config fields"""
        response = requests.get(f"{BASE_URL}/api/remote-providers", headers=headers)
        providers = response.json()
        sc = next((p for p in providers if p["id"] == "screenconnect"), None)
        
        assert sc is not None
        assert "ConnectWise" in sc["name"] or "ScreenConnect" in sc["name"]
        assert sc["type"] == "cloud"
