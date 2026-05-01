"""
Iteration 135 Tests: Invoice PDF Templates, AI Why-on-fire, Auto-Quote, Threat Radar, Health Certificate, Kiosk
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Authentication failed - skipping authenticated tests")

@pytest.fixture(scope="module")
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============ Invoice PDF Templates ============

class TestInvoicePdfTemplates:
    """Invoice PDF Template Builder CRUD and preview tests"""
    
    created_template_id = None
    
    def test_create_template(self, headers):
        """POST /api/invoice-templates creates template with default blocks"""
        response = requests.post(f"{BASE_URL}/api/invoice-templates", json={
            "name": "TEST_Template_135",
            "doc_type": "invoice",
            "layout": "classic",
            "density": "standard"
        }, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["name"] == "TEST_Template_135"
        assert data["doc_type"] == "invoice"
        assert data["layout"] == "classic"
        assert "blocks" in data
        assert len(data["blocks"]) > 0  # Default blocks should be created
        TestInvoicePdfTemplates.created_template_id = data["id"]
        print(f"Created template: {data['id']}")
    
    def test_list_templates(self, headers):
        """GET /api/invoice-templates returns list"""
        response = requests.get(f"{BASE_URL}/api/invoice-templates", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} templates")
    
    def test_get_template_by_id(self, headers):
        """GET /api/invoice-templates/{id} returns template"""
        if not TestInvoicePdfTemplates.created_template_id:
            pytest.skip("No template created")
        response = requests.get(f"{BASE_URL}/api/invoice-templates/{TestInvoicePdfTemplates.created_template_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == TestInvoicePdfTemplates.created_template_id
        assert "blocks" in data
    
    def test_update_template(self, headers):
        """PUT /api/invoice-templates/{id} updates template"""
        if not TestInvoicePdfTemplates.created_template_id:
            pytest.skip("No template created")
        response = requests.put(f"{BASE_URL}/api/invoice-templates/{TestInvoicePdfTemplates.created_template_id}", json={
            "name": "TEST_Template_135_Updated",
            "layout": "minimal"
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "TEST_Template_135_Updated"
        assert data["layout"] == "minimal"
    
    def test_set_default_template(self, headers):
        """POST /api/invoice-templates/{id}/set-default sets is_default=true"""
        if not TestInvoicePdfTemplates.created_template_id:
            pytest.skip("No template created")
        response = requests.post(f"{BASE_URL}/api/invoice-templates/{TestInvoicePdfTemplates.created_template_id}/set-default", json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        # Verify it's now default
        get_resp = requests.get(f"{BASE_URL}/api/invoice-templates/{TestInvoicePdfTemplates.created_template_id}", headers=headers)
        assert get_resp.json().get("is_default") == True
    
    def test_preview_template_pdf(self, headers):
        """POST /api/invoice-templates/{id}/preview returns PDF"""
        if not TestInvoicePdfTemplates.created_template_id:
            pytest.skip("No template created")
        response = requests.post(f"{BASE_URL}/api/invoice-templates/{TestInvoicePdfTemplates.created_template_id}/preview", json={}, headers=headers)
        assert response.status_code == 200
        assert response.headers.get("content-type") == "application/pdf"
        assert response.content[:8] == b"%PDF-1.3" or response.content[:8] == b"%PDF-1.4"
        print(f"Preview PDF size: {len(response.content)} bytes")
    
    def test_preview_pdf_get_with_token(self, auth_token):
        """GET /api/invoice-templates/{id}/preview-pdf?token=... returns PDF"""
        if not TestInvoicePdfTemplates.created_template_id:
            pytest.skip("No template created")
        response = requests.get(f"{BASE_URL}/api/invoice-templates/{TestInvoicePdfTemplates.created_template_id}/preview-pdf?token={auth_token}")
        assert response.status_code == 200
        assert response.headers.get("content-type") == "application/pdf"
        print(f"GET preview PDF size: {len(response.content)} bytes")
    
    def test_validation_bad_layout(self, headers):
        """POST /api/invoice-templates with invalid layout returns 400"""
        response = requests.post(f"{BASE_URL}/api/invoice-templates", json={
            "name": "TEST_Bad_Layout",
            "layout": "invalid_layout"
        }, headers=headers)
        assert response.status_code == 400
    
    def test_validation_bad_density(self, headers):
        """PUT with invalid density returns 400"""
        if not TestInvoicePdfTemplates.created_template_id:
            pytest.skip("No template created")
        response = requests.put(f"{BASE_URL}/api/invoice-templates/{TestInvoicePdfTemplates.created_template_id}", json={
            "density": "invalid_density"
        }, headers=headers)
        assert response.status_code == 400
    
    def test_validation_bad_hex_color(self, headers):
        """PUT with invalid hex color returns 400"""
        if not TestInvoicePdfTemplates.created_template_id:
            pytest.skip("No template created")
        response = requests.put(f"{BASE_URL}/api/invoice-templates/{TestInvoicePdfTemplates.created_template_id}", json={
            "primary_color": "not-a-hex"
        }, headers=headers)
        assert response.status_code == 400
    
    def test_delete_template(self, headers):
        """DELETE /api/invoice-templates/{id} removes template"""
        if not TestInvoicePdfTemplates.created_template_id:
            pytest.skip("No template created")
        response = requests.delete(f"{BASE_URL}/api/invoice-templates/{TestInvoicePdfTemplates.created_template_id}", headers=headers)
        assert response.status_code == 200
        # Verify deleted
        get_resp = requests.get(f"{BASE_URL}/api/invoice-templates/{TestInvoicePdfTemplates.created_template_id}", headers=headers)
        assert get_resp.status_code == 404


# ============ AI Why-on-fire ============

class TestWhyOnFire:
    """AI Why-on-fire diagnosis tests"""
    
    def test_why_on_fire_ticket(self, headers):
        """POST /api/ai/why-on-fire/ticket/{id} returns diagnosis"""
        # First get a ticket
        tickets_resp = requests.get(f"{BASE_URL}/api/tickets?limit=1", headers=headers)
        if tickets_resp.status_code != 200 or not tickets_resp.json():
            pytest.skip("No tickets available")
        ticket_id = tickets_resp.json()[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/ai/why-on-fire/ticket/{ticket_id}", json={}, headers=headers)
        # May return 503 if AI not configured, or 200 with diagnosis
        assert response.status_code in [200, 503], f"Unexpected status: {response.status_code}"
        if response.status_code == 200:
            data = response.json()
            assert "diagnosis" in data
            assert "severity" in data
            assert "entity_type" in data
            assert data["entity_type"] == "ticket"
            assert "generated_at" in data
            print(f"Diagnosis severity: {data.get('severity')}, next_steps: {len(data.get('next_steps', []))}")
    
    def test_why_on_fire_device(self, headers):
        """POST /api/ai/why-on-fire/device/{id} returns diagnosis"""
        devices_resp = requests.get(f"{BASE_URL}/api/devices?limit=1", headers=headers)
        if devices_resp.status_code != 200 or not devices_resp.json():
            pytest.skip("No devices available")
        device_id = devices_resp.json()[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/ai/why-on-fire/device/{device_id}", json={}, headers=headers)
        assert response.status_code in [200, 503]
        if response.status_code == 200:
            data = response.json()
            assert data["entity_type"] == "device"
    
    def test_why_on_fire_client(self, headers):
        """POST /api/ai/why-on-fire/client/{id} returns diagnosis"""
        clients_resp = requests.get(f"{BASE_URL}/api/clients?limit=1", headers=headers)
        if clients_resp.status_code != 200 or not clients_resp.json():
            pytest.skip("No clients available")
        client_id = clients_resp.json()[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/ai/why-on-fire/client/{client_id}", json={}, headers=headers)
        assert response.status_code in [200, 503]
        if response.status_code == 200:
            data = response.json()
            assert data["entity_type"] == "client"
    
    def test_why_on_fire_invalid_entity_type(self, headers):
        """POST /api/ai/why-on-fire/invalid/123 returns 400"""
        response = requests.post(f"{BASE_URL}/api/ai/why-on-fire/invalid/123", json={}, headers=headers)
        assert response.status_code == 400
    
    def test_why_on_fire_not_found(self, headers):
        """POST /api/ai/why-on-fire/ticket/nonexistent returns 404"""
        response = requests.post(f"{BASE_URL}/api/ai/why-on-fire/ticket/nonexistent-id-12345", json={}, headers=headers)
        assert response.status_code == 404


# ============ Auto-Quote ============

class TestAutoQuote:
    """Auto-Quote from ticket conversation tests"""
    
    def test_auto_quote_from_ticket(self, headers):
        """POST /api/tickets/{id}/auto-quote returns quote draft"""
        tickets_resp = requests.get(f"{BASE_URL}/api/tickets?limit=1", headers=headers)
        if tickets_resp.status_code != 200 or not tickets_resp.json():
            pytest.skip("No tickets available")
        ticket_id = tickets_resp.json()[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/tickets/{ticket_id}/auto-quote", json={}, headers=headers)
        assert response.status_code in [200, 503], f"Unexpected status: {response.status_code}"
        if response.status_code == 200:
            data = response.json()
            assert "title" in data
            assert "line_items" in data
            assert isinstance(data["line_items"], list)
            assert "subtotal" in data
            assert "total" in data
            assert "ticket_id" in data
            assert data["ticket_id"] == ticket_id
            assert "generated_at" in data
            print(f"Auto-quote: {len(data['line_items'])} items, total: ${data.get('total', 0)}")
    
    def test_auto_quote_not_found(self, headers):
        """POST /api/tickets/nonexistent/auto-quote returns 404"""
        response = requests.post(f"{BASE_URL}/api/tickets/nonexistent-id-12345/auto-quote", json={}, headers=headers)
        assert response.status_code == 404


# ============ Threat Radar ============

class TestThreatRadar:
    """Threat Radar ticker tests"""
    
    def test_threat_radar(self, headers):
        """GET /api/threat-radar returns items and generated_at"""
        response = requests.get(f"{BASE_URL}/api/threat-radar", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert isinstance(data["items"], list)
        assert "generated_at" in data
        print(f"Threat radar: {len(data['items'])} items")
        # If items exist, verify structure
        if data["items"]:
            item = data["items"][0]
            assert "kind" in item
            assert "title" in item
            assert "severity" in item


# ============ Health Certificate PDF ============

class TestHealthCertificate:
    """Client Health Certificate PDF tests"""
    
    def test_health_certificate_pdf(self, auth_token, headers):
        """GET /api/clients/{id}/health-certificate.pdf?token=... returns PDF"""
        clients_resp = requests.get(f"{BASE_URL}/api/clients?limit=1", headers=headers)
        if clients_resp.status_code != 200 or not clients_resp.json():
            pytest.skip("No clients available")
        client_id = clients_resp.json()[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/clients/{client_id}/health-certificate.pdf?token={auth_token}")
        assert response.status_code == 200
        assert response.headers.get("content-type") == "application/pdf"
        assert response.content[:8] == b"%PDF-1.3" or response.content[:8] == b"%PDF-1.4"
        print(f"Health certificate PDF size: {len(response.content)} bytes")
    
    def test_health_certificate_no_token(self, headers):
        """GET /api/clients/{id}/health-certificate.pdf without token returns 401"""
        clients_resp = requests.get(f"{BASE_URL}/api/clients?limit=1", headers=headers)
        if clients_resp.status_code != 200 or not clients_resp.json():
            pytest.skip("No clients available")
        client_id = clients_resp.json()[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/clients/{client_id}/health-certificate.pdf")
        assert response.status_code == 401
    
    def test_health_certificate_not_found(self, auth_token):
        """GET /api/clients/nonexistent/health-certificate.pdf returns 404"""
        response = requests.get(f"{BASE_URL}/api/clients/nonexistent-id-12345/health-certificate.pdf?token={auth_token}")
        assert response.status_code == 404


# ============ Kiosk ============

class TestKiosk:
    """Walk-in Kiosk tests"""
    
    kiosk_token = None
    kiosk_id = None
    
    def test_register_kiosk(self, headers):
        """POST /api/kiosk/register creates kiosk and returns token"""
        response = requests.post(f"{BASE_URL}/api/kiosk/register", json={
            "name": "TEST_Kiosk_135"
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "kiosk_token" in data
        assert data["name"] == "TEST_Kiosk_135"
        TestKiosk.kiosk_token = data["kiosk_token"]
        TestKiosk.kiosk_id = data["id"]
        print(f"Created kiosk: {data['id']}, token: {data['kiosk_token'][:10]}...")
    
    def test_list_kiosks(self, headers):
        """GET /api/kiosk returns list of kiosks"""
        response = requests.get(f"{BASE_URL}/api/kiosk", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} kiosks")
    
    def test_kiosk_lookup_missing_params(self):
        """POST /api/kiosk/lookup without kiosk_token+email returns 400"""
        response = requests.post(f"{BASE_URL}/api/kiosk/lookup", json={})
        assert response.status_code == 400
    
    def test_kiosk_lookup_unknown_email(self):
        """POST /api/kiosk/lookup with unknown email returns 404"""
        if not TestKiosk.kiosk_token:
            pytest.skip("No kiosk created")
        response = requests.post(f"{BASE_URL}/api/kiosk/lookup", json={
            "kiosk_token": TestKiosk.kiosk_token,
            "email": "nonexistent-email-12345@test.com"
        })
        assert response.status_code == 404
    
    def test_kiosk_dashboard_invalid_token(self):
        """GET /api/kiosk/invalid-token/dashboard returns 404"""
        response = requests.get(f"{BASE_URL}/api/kiosk/invalid-token-12345/dashboard?client_id=test")
        assert response.status_code == 404
    
    def test_kiosk_dashboard_valid_token(self, headers):
        """GET /api/kiosk/{token}/dashboard?client_id=X returns dashboard data"""
        if not TestKiosk.kiosk_token:
            pytest.skip("No kiosk created")
        # Get a client
        clients_resp = requests.get(f"{BASE_URL}/api/clients?limit=1", headers=headers)
        if clients_resp.status_code != 200 or not clients_resp.json():
            pytest.skip("No clients available")
        client_id = clients_resp.json()[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/kiosk/{TestKiosk.kiosk_token}/dashboard?client_id={client_id}")
        assert response.status_code == 200
        data = response.json()
        assert "client" in data
        assert "tickets" in data
        assert "estimates" in data
        assert "invoices" in data
        print(f"Kiosk dashboard: {len(data['tickets'])} tickets, {len(data['estimates'])} estimates, {len(data['invoices'])} invoices")
    
    def test_kiosk_approve_estimate_not_found(self):
        """POST /api/kiosk/{token}/estimate/nonexistent/approve returns 404"""
        if not TestKiosk.kiosk_token:
            pytest.skip("No kiosk created")
        response = requests.post(f"{BASE_URL}/api/kiosk/{TestKiosk.kiosk_token}/estimate/nonexistent-id/approve", json={
            "approver_name": "Test User"
        })
        assert response.status_code == 404
    
    def test_kiosk_approve_estimate_missing_name(self):
        """POST /api/kiosk/{token}/estimate/{id}/approve without approver_name returns 400"""
        if not TestKiosk.kiosk_token:
            pytest.skip("No kiosk created")
        response = requests.post(f"{BASE_URL}/api/kiosk/{TestKiosk.kiosk_token}/estimate/test-id/approve", json={})
        assert response.status_code == 400
    
    def test_delete_kiosk(self, headers):
        """DELETE /api/kiosk/{id} removes kiosk"""
        if not TestKiosk.kiosk_id:
            pytest.skip("No kiosk created")
        response = requests.delete(f"{BASE_URL}/api/kiosk/{TestKiosk.kiosk_id}", headers=headers)
        assert response.status_code == 200


# ============ Regression Tests ============

class TestRegression:
    """Regression tests for existing features"""
    
    def test_blueprints_page_loads(self, headers):
        """GET /api/blueprints returns list"""
        response = requests.get(f"{BASE_URL}/api/blueprints", headers=headers)
        assert response.status_code == 200
    
    def test_qbr_endpoint(self, headers):
        """GET /api/qbr/{client_id} works"""
        clients_resp = requests.get(f"{BASE_URL}/api/clients?limit=1", headers=headers)
        if clients_resp.status_code != 200 or not clients_resp.json():
            pytest.skip("No clients available")
        client_id = clients_resp.json()[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/qbr/{client_id}", headers=headers)
        # May return 200 or 503 if AI not configured
        assert response.status_code in [200, 503]
    
    def test_warroom_list(self, headers):
        """GET /api/warrooms returns list"""
        response = requests.get(f"{BASE_URL}/api/warrooms", headers=headers)
        assert response.status_code == 200
    
    def test_tech_roster(self, headers):
        """GET /api/tech-roster returns roster"""
        response = requests.get(f"{BASE_URL}/api/tech-roster", headers=headers)
        assert response.status_code == 200


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
