"""
Iteration 136: Testing 4 new differentiator features
1. Client Churn Risk Score with save actions
2. Invoice DisputeShield PDF evidence packet
3. Auto-Incident Postmortem from War Room
4. Client Whisper Mode VIP context rail on tickets
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Authentication failed")

@pytest.fixture(scope="module")
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


# ============ 1. CHURN RISK SCORE ============

class TestChurnRiskScore:
    """Test client churn risk scoring endpoints"""
    
    def test_churn_risk_for_client(self, headers):
        """GET /api/clients/{client_id}/churn-risk returns score, band, drivers, actions"""
        # Use client-001 (Acme Corporation) which should exist
        response = requests.get(f"{BASE_URL}/api/clients/client-001/churn-risk", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Validate required fields
        assert "client_id" in data
        assert "client_name" in data
        assert "score" in data
        assert isinstance(data["score"], int)
        assert 0 <= data["score"] <= 100
        
        assert "band" in data
        assert data["band"] in ["low", "medium", "high", "critical"]
        
        assert "drivers" in data
        assert isinstance(data["drivers"], list)
        
        assert "suggested_actions" in data
        assert isinstance(data["suggested_actions"], list)
        
        assert "signals" in data
        signals = data["signals"]
        assert "tix_30d" in signals
        assert "tix_prev" in signals
        assert "vol_delta" in signals
        assert "sla_breaches" in signals
        assert "unpaid" in signals
        assert "overdue" in signals
        assert "offline_devices" in signals
        assert "warning_devices" in signals
        assert "critical_open" in signals
        
        assert "generated_at" in data
        print(f"Churn risk for client-001: score={data['score']}, band={data['band']}, drivers={len(data['drivers'])}")
    
    def test_churn_risk_not_found(self, headers):
        """GET /api/clients/{invalid}/churn-risk returns 404"""
        response = requests.get(f"{BASE_URL}/api/clients/nonexistent-client-xyz/churn-risk", headers=headers)
        assert response.status_code == 404
    
    def test_churn_risk_overview(self, headers):
        """GET /api/churn-risk/overview returns top at-risk clients"""
        response = requests.get(f"{BASE_URL}/api/churn-risk/overview", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "top" in data
        assert isinstance(data["top"], list)
        assert "total_clients" in data
        assert "generated_at" in data
        
        # Validate each entry in top list
        for entry in data["top"][:5]:
            assert "client_id" in entry
            assert "client_name" in entry
            assert "score" in entry
            assert "band" in entry
            assert "top_driver" in entry
        
        # Verify sorted descending by score
        scores = [e["score"] for e in data["top"]]
        assert scores == sorted(scores, reverse=True), "Top list should be sorted by score descending"
        
        print(f"Churn overview: {len(data['top'])} clients, total={data['total_clients']}")


# ============ 2. INVOICE DISPUTE SHIELD PDF ============

class TestDisputeShieldPdf:
    """Test invoice dispute shield PDF generation"""
    
    @pytest.fixture(scope="class")
    def test_invoice_id(self, headers):
        """Get or create a test invoice"""
        # First try to get existing invoices
        response = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        if response.status_code == 200 and response.json():
            return response.json()[0]["id"]
        
        # Create one if none exist
        response = requests.post(f"{BASE_URL}/api/invoices", json={
            "client_id": "client-001",
            "due_date": "2026-02-28",
            "line_items": [{"name": "Test Service", "quantity": 1, "unit_price": 100}],
            "tax_rate": 10
        }, headers=headers)
        if response.status_code in [200, 201]:
            return response.json()["id"]
        pytest.skip("Could not get or create test invoice")
    
    def test_dispute_shield_pdf_valid(self, headers, test_invoice_id, auth_token):
        """GET /api/invoices/{id}/dispute-shield.pdf returns valid PDF"""
        url = f"{BASE_URL}/api/invoices/{test_invoice_id}/dispute-shield.pdf?token={auth_token}"
        response = requests.get(url)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Verify content type
        assert "application/pdf" in response.headers.get("Content-Type", "")
        
        # Verify PDF header
        content = response.content
        assert content[:8] == b"%PDF-1.3" or content[:8] == b"%PDF-1.4", f"Expected PDF header, got: {content[:20]}"
        
        # Verify reasonable size (should have content)
        assert len(content) > 500, f"PDF too small: {len(content)} bytes"
        
        print(f"Dispute Shield PDF: {len(content)} bytes, valid PDF header")
    
    def test_dispute_shield_pdf_no_token(self, test_invoice_id):
        """GET /api/invoices/{id}/dispute-shield.pdf without token returns 401"""
        url = f"{BASE_URL}/api/invoices/{test_invoice_id}/dispute-shield.pdf"
        response = requests.get(url)
        assert response.status_code == 401
    
    def test_dispute_shield_pdf_not_found(self, auth_token):
        """GET /api/invoices/{invalid}/dispute-shield.pdf returns 404"""
        url = f"{BASE_URL}/api/invoices/nonexistent-invoice-xyz/dispute-shield.pdf?token={auth_token}"
        response = requests.get(url)
        assert response.status_code == 404


# ============ 3. AUTO-INCIDENT POSTMORTEM ============

class TestAutoPostmortem:
    """Test auto-incident postmortem generation for war rooms"""
    
    @pytest.fixture(scope="class")
    def resolved_warroom_id(self, headers):
        """Get or create a resolved war room for testing"""
        # Check for existing resolved war rooms
        response = requests.get(f"{BASE_URL}/api/warroom?include_resolved=true", headers=headers)
        if response.status_code == 200:
            for wr in response.json():
                if wr.get("status") == "resolved":
                    return wr["id"]
        
        # Create and resolve a war room
        create_resp = requests.post(f"{BASE_URL}/api/warroom", json={
            "title": "TEST Postmortem War Room",
            "severity": "P2",
            "summary": "Test incident for postmortem generation"
        }, headers=headers)
        
        if create_resp.status_code not in [200, 201]:
            pytest.skip("Could not create war room")
        
        wr_id = create_resp.json().get("war_room", {}).get("id") or create_resp.json().get("id")
        if not wr_id:
            pytest.skip("Could not get war room ID")
        
        # Add a message
        requests.post(f"{BASE_URL}/api/warroom/{wr_id}/messages", json={
            "body": "Initial investigation started"
        }, headers=headers)
        
        # Resolve it
        resolve_resp = requests.post(f"{BASE_URL}/api/warroom/{wr_id}/resolve", json={
            "resolved_notes": "Issue resolved - root cause was network misconfiguration"
        }, headers=headers)
        
        if resolve_resp.status_code != 200:
            pytest.skip(f"Could not resolve war room: {resolve_resp.text}")
        
        return wr_id
    
    @pytest.fixture(scope="class")
    def active_warroom_id(self, headers):
        """Get or create an active (non-resolved) war room"""
        response = requests.get(f"{BASE_URL}/api/warroom", headers=headers)
        if response.status_code == 200:
            for wr in response.json():
                if wr.get("status") != "resolved":
                    return wr["id"]
        
        # Create one
        create_resp = requests.post(f"{BASE_URL}/api/warroom", json={
            "title": "TEST Active War Room",
            "severity": "P3",
            "summary": "Active incident"
        }, headers=headers)
        
        if create_resp.status_code in [200, 201]:
            return create_resp.json().get("war_room", {}).get("id") or create_resp.json().get("id")
        pytest.skip("Could not create active war room")
    
    def test_postmortem_generation(self, headers, resolved_warroom_id):
        """POST /api/warroom/{wr_id}/postmortem generates AI postmortem"""
        response = requests.post(f"{BASE_URL}/api/warroom/{resolved_warroom_id}/postmortem", json={}, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Validate required fields
        assert "id" in data
        assert "summary" in data
        assert "timeline" in data
        assert isinstance(data["timeline"], list)
        assert "root_cause" in data
        assert "impact" in data
        assert "what_went_well" in data
        assert isinstance(data["what_went_well"], list)
        assert "what_went_poorly" in data
        assert isinstance(data["what_went_poorly"], list)
        assert "action_items" in data
        assert isinstance(data["action_items"], list)
        
        # Validate action items structure
        for item in data["action_items"]:
            assert "owner" in item or "task" in item
        
        assert "war_room_id" in data
        assert "title" in data
        assert "severity" in data
        assert "generated_at" in data
        assert "generated_by" in data
        
        print(f"Postmortem generated: {len(data['timeline'])} timeline items, {len(data['action_items'])} action items")
        return data["id"]
    
    def test_postmortem_not_resolved_400(self, headers, active_warroom_id):
        """POST /api/warroom/{wr_id}/postmortem on non-resolved returns 400"""
        response = requests.post(f"{BASE_URL}/api/warroom/{active_warroom_id}/postmortem", json={}, headers=headers)
        assert response.status_code == 400, f"Expected 400 for non-resolved war room, got {response.status_code}"
    
    def test_get_postmortem(self, headers, resolved_warroom_id):
        """GET /api/postmortems/{pm_id} returns saved postmortem"""
        # First generate one
        gen_resp = requests.post(f"{BASE_URL}/api/warroom/{resolved_warroom_id}/postmortem", json={}, headers=headers)
        if gen_resp.status_code != 200:
            pytest.skip("Could not generate postmortem")
        
        pm_id = gen_resp.json()["id"]
        
        # Now fetch it
        response = requests.get(f"{BASE_URL}/api/postmortems/{pm_id}", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["id"] == pm_id
        assert "summary" in data
        assert "timeline" in data
        print(f"Retrieved postmortem {pm_id}")
    
    def test_get_postmortem_not_found(self, headers):
        """GET /api/postmortems/{invalid} returns 404"""
        response = requests.get(f"{BASE_URL}/api/postmortems/nonexistent-pm-xyz", headers=headers)
        assert response.status_code == 404


# ============ 4. CLIENT WHISPER MODE ============

class TestWhisperMode:
    """Test client whisper mode VIP context endpoint"""
    
    def test_whisper_contact_by_email(self, headers):
        """GET /api/whisper/contact?email=X returns VIP context"""
        # First get a client with contact_email
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        if clients_resp.status_code != 200:
            pytest.skip("Could not fetch clients")
        
        clients = clients_resp.json()
        test_email = None
        for c in clients:
            if c.get("contact_email"):
                test_email = c["contact_email"]
                break
        
        if not test_email:
            # Try contacts collection
            contacts_resp = requests.get(f"{BASE_URL}/api/contacts", headers=headers)
            if contacts_resp.status_code == 200 and contacts_resp.json():
                test_email = contacts_resp.json()[0].get("email")
        
        if not test_email:
            pytest.skip("No contact email found in test data")
        
        response = requests.get(f"{BASE_URL}/api/whisper/contact?email={test_email}", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Validate contact info
        assert "contact" in data
        contact = data["contact"]
        assert "name" in contact
        assert "email" in contact
        assert "role" in contact
        assert "is_vip" in contact
        assert "notes" in contact
        
        # Validate client info
        assert "client" in data
        client = data["client"]
        assert "id" in client
        assert "name" in client
        assert "tier" in client
        assert "health_score" in client
        
        # Validate other fields
        assert "recent_tickets" in data
        assert isinstance(data["recent_tickets"], list)
        
        assert "finance" in data
        finance = data["finance"]
        assert "unpaid" in finance
        assert "overdue" in finance
        assert "total_overdue" in finance
        
        assert "churn" in data
        
        assert "escalations_ever" in data
        assert "preferred_tech" in data
        assert "generated_at" in data
        
        print(f"Whisper contact: {contact['name']}, VIP={contact['is_vip']}, client={client['name']}")
    
    def test_whisper_contact_not_found(self, headers):
        """GET /api/whisper/contact?email=unknown returns 404"""
        response = requests.get(f"{BASE_URL}/api/whisper/contact?email=nonexistent-email-xyz@nowhere.com", headers=headers)
        assert response.status_code == 404


# ============ REGRESSION TESTS ============

class TestRegressionIteration135:
    """Regression tests for iteration 135 features"""
    
    def test_invoice_templates_list(self, headers):
        """Invoice templates endpoint still works"""
        response = requests.get(f"{BASE_URL}/api/invoice-templates", headers=headers)
        assert response.status_code == 200
    
    def test_kiosk_list(self, headers):
        """Kiosk endpoint still works"""
        response = requests.get(f"{BASE_URL}/api/kiosks", headers=headers)
        assert response.status_code == 200
    
    def test_threat_radar(self, headers):
        """Threat radar endpoint still works"""
        response = requests.get(f"{BASE_URL}/api/threat-radar", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "generated_at" in data
    
    def test_health_certificate_endpoint(self, headers, auth_token):
        """Health certificate PDF endpoint still works"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/health-certificate.pdf?token={auth_token}")
        assert response.status_code == 200
        assert "application/pdf" in response.headers.get("Content-Type", "")


class TestRegressionIteration134:
    """Regression tests for iteration 134 QBR features"""
    
    def test_qbr_list(self, headers):
        """QBR list endpoint still works"""
        response = requests.get(f"{BASE_URL}/api/qbr", headers=headers)
        assert response.status_code == 200
    
    def test_blueprints_list(self, headers):
        """Blueprints endpoint still works"""
        response = requests.get(f"{BASE_URL}/api/blueprints", headers=headers)
        assert response.status_code == 200
