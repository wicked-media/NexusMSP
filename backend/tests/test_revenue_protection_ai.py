"""
Revenue Protection AI Bundle - Backend API Tests
Tests for: SLA Radar, Sentiment Tracker, Payment Promise Tracker, Estimate Follow-up AI, Invoice Explainer
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json().get("access_token")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers for API calls"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============ 1. SLA RADAR TESTS ============

class TestSLARadar:
    """Tests for GET /api/sla-radar endpoint"""
    
    def test_sla_radar_returns_200(self, headers):
        """SLA Radar endpoint should return 200 with at_risk array"""
        response = requests.get(f"{BASE_URL}/api/sla-radar", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "at_risk" in data, "Response should contain 'at_risk' array"
        assert "danger_zone_count" in data, "Response should contain 'danger_zone_count'"
        assert "generated_at" in data, "Response should contain 'generated_at'"
        
        # Validate at_risk structure if items exist
        if len(data["at_risk"]) > 0:
            item = data["at_risk"][0]
            assert "ticket_id" in item, "at_risk item should have ticket_id"
            assert "ticket_number" in item, "at_risk item should have ticket_number"
            assert "title" in item, "at_risk item should have title"
            assert "client_name" in item, "at_risk item should have client_name"
            assert "score" in item, "at_risk item should have score"
            assert "minutes_to_breach" in item, "at_risk item should have minutes_to_breach"
            assert "reasons" in item, "at_risk item should have reasons"
            
            # Score should be >= 60 (threshold for at_risk)
            assert item["score"] >= 60, f"Score should be >= 60, got {item['score']}"
        
        print(f"SLA Radar: {len(data['at_risk'])} at-risk tickets, {data['danger_zone_count']} in danger zone")
    
    def test_sla_radar_requires_auth(self):
        """SLA Radar should require authentication"""
        response = requests.get(f"{BASE_URL}/api/sla-radar")
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"


# ============ 2. SENTIMENT TRACKER TESTS ============

class TestSentimentTracker:
    """Tests for GET /api/tickets/{ticket_id}/sentiment endpoint"""
    
    def test_sentiment_with_known_ticket(self, headers):
        """Sentiment endpoint should work with TKT-001"""
        # First get a ticket to use
        tickets_resp = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert tickets_resp.status_code == 200
        tickets = tickets_resp.json()
        
        if len(tickets) == 0:
            pytest.skip("No tickets available for sentiment test")
        
        # Use first ticket
        ticket = tickets[0]
        ticket_id = ticket["id"]
        
        response = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}/sentiment", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "ticket_id" in data, "Response should contain ticket_id"
        assert "trend" in data, "Response should contain trend"
        assert "message_count" in data, "Response should contain message_count"
        
        # If enough messages, should have score data
        if data.get("trend") != "insufficient_data":
            assert "latest_score" in data, "Should have latest_score when sufficient data"
            assert "reasoning" in data, "Should have reasoning when sufficient data"
        
        print(f"Sentiment for {ticket_id}: trend={data.get('trend')}, score={data.get('latest_score')}")
    
    def test_sentiment_404_for_invalid_ticket(self, headers):
        """Sentiment should return 404 for non-existent ticket"""
        response = requests.get(f"{BASE_URL}/api/tickets/invalid-ticket-id-xyz/sentiment", headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
    
    def test_sentiment_requires_auth(self):
        """Sentiment endpoint should require authentication"""
        response = requests.get(f"{BASE_URL}/api/tickets/TKT-001/sentiment")
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"


# ============ 3. PAYMENT PROMISE TRACKER TESTS ============

class TestPaymentPromiseTracker:
    """Tests for payment promise endpoints"""
    
    @pytest.fixture(scope="class")
    def test_invoice(self, headers):
        """Get or create a test invoice"""
        # Get existing invoices
        inv_resp = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        assert inv_resp.status_code == 200
        invoices = inv_resp.json()
        
        if len(invoices) > 0:
            return invoices[0]
        
        # Create one if none exist
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = clients_resp.json()
        if len(clients) == 0:
            pytest.skip("No clients available to create invoice")
        
        create_resp = requests.post(f"{BASE_URL}/api/invoices", json={
            "client_id": clients[0]["id"],
            "due_date": "2026-02-15",
            "line_items": [{"name": "Test Service", "quantity": 1, "unit_price": 100}],
            "tax_rate": 10
        }, headers=headers)
        assert create_resp.status_code in [200, 201], f"Failed to create invoice: {create_resp.text}"
        return create_resp.json()
    
    def test_create_payment_promise(self, headers, test_invoice):
        """POST /api/invoices/{id}/promises should create a promise"""
        invoice_id = test_invoice["id"]
        
        response = requests.post(f"{BASE_URL}/api/invoices/{invoice_id}/promises", json={
            "text": "They said they will pay by next Friday via bank transfer",
            "promised_by": "John from accounts"
        }, headers=headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should contain promise id"
        assert "invoice_id" in data, "Response should contain invoice_id"
        assert data["invoice_id"] == invoice_id
        assert "promised_date" in data, "Response should contain promised_date (may be null)"
        assert "confidence" in data, "Response should contain confidence"
        assert "method" in data, "Response should contain method"
        assert "status" in data, "Response should contain status"
        assert data["status"] == "pending", "New promise should be pending"
        
        print(f"Created promise: date={data.get('promised_date')}, confidence={data.get('confidence')}, method={data.get('method')}")
        return data
    
    def test_list_payment_promises(self, headers):
        """GET /api/payment-promises should list promises"""
        response = requests.get(f"{BASE_URL}/api/payment-promises", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        if len(data) > 0:
            promise = data[0]
            assert "id" in promise
            assert "invoice_id" in promise
            assert "status" in promise
        
        print(f"Found {len(data)} payment promises")
    
    def test_list_promises_with_status_filter(self, headers):
        """GET /api/payment-promises?status=pending should filter by status"""
        response = requests.get(f"{BASE_URL}/api/payment-promises?status=pending", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        for promise in data:
            assert promise["status"] == "pending", f"Expected pending status, got {promise['status']}"
    
    def test_update_payment_promise_status(self, headers, test_invoice):
        """PUT /api/payment-promises/{id} should update status"""
        # First create a promise
        invoice_id = test_invoice["id"]
        create_resp = requests.post(f"{BASE_URL}/api/invoices/{invoice_id}/promises", json={
            "text": "TEST_Promise to pay tomorrow",
            "promised_by": "Test User"
        }, headers=headers)
        assert create_resp.status_code == 200
        promise = create_resp.json()
        promise_id = promise["id"]
        
        # Update to 'kept'
        update_resp = requests.put(f"{BASE_URL}/api/payment-promises/{promise_id}", json={
            "status": "kept"
        }, headers=headers)
        assert update_resp.status_code == 200, f"Expected 200, got {update_resp.status_code}: {update_resp.text}"
        
        updated = update_resp.json()
        assert updated["status"] == "kept", f"Expected status 'kept', got {updated['status']}"
        assert "resolved_at" in updated, "Should have resolved_at timestamp"
        
        print(f"Updated promise {promise_id} to status: kept")
    
    def test_update_promise_invalid_status(self, headers, test_invoice):
        """PUT /api/payment-promises/{id} should reject invalid status"""
        # Create a promise first
        invoice_id = test_invoice["id"]
        create_resp = requests.post(f"{BASE_URL}/api/invoices/{invoice_id}/promises", json={
            "text": "TEST_Another promise",
            "promised_by": "Test"
        }, headers=headers)
        assert create_resp.status_code == 200
        promise_id = create_resp.json()["id"]
        
        # Try invalid status
        update_resp = requests.put(f"{BASE_URL}/api/payment-promises/{promise_id}", json={
            "status": "invalid_status"
        }, headers=headers)
        assert update_resp.status_code == 400, f"Expected 400 for invalid status, got {update_resp.status_code}"
    
    def test_promise_requires_text(self, headers, test_invoice):
        """POST /api/invoices/{id}/promises should require text"""
        invoice_id = test_invoice["id"]
        response = requests.post(f"{BASE_URL}/api/invoices/{invoice_id}/promises", json={
            "promised_by": "Someone"
        }, headers=headers)
        assert response.status_code == 400, f"Expected 400 without text, got {response.status_code}"


# ============ 4. ESTIMATE FOLLOW-UP AI TESTS ============

class TestEstimateFollowupAI:
    """Tests for POST /api/estimates/{id}/followup-draft endpoint"""
    
    @pytest.fixture(scope="class")
    def test_estimate(self, headers):
        """Get or create a non-approved estimate for testing"""
        # Get existing estimates
        est_resp = requests.get(f"{BASE_URL}/api/estimates", headers=headers)
        assert est_resp.status_code == 200
        estimates = est_resp.json()
        
        # Find a non-approved estimate
        for est in estimates:
            if est.get("status") not in ["approved", "draft"]:
                return est
        
        # Create one if none suitable exist
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = clients_resp.json()
        if len(clients) == 0:
            pytest.skip("No clients available to create estimate")
        
        create_resp = requests.post(f"{BASE_URL}/api/estimates", json={
            "title": "TEST_Followup Test Estimate",
            "client_id": clients[0]["id"],
            "client_name": clients[0]["name"],
            "line_items": [{"description": "Test Service", "quantity": 1, "unit_price": 500}],
            "tax_rate": 10
        }, headers=headers)
        assert create_resp.status_code in [200, 201], f"Failed to create estimate: {create_resp.text}"
        estimate = create_resp.json()
        
        # Mark as published (not draft, not approved)
        status_resp = requests.put(f"{BASE_URL}/api/estimates/{estimate['id']}/status", json={
            "status": "published"
        }, headers=headers)
        
        # Refresh
        get_resp = requests.get(f"{BASE_URL}/api/estimates/{estimate['id']}", headers=headers)
        return get_resp.json()
    
    def test_followup_draft_success(self, headers, test_estimate):
        """POST /api/estimates/{id}/followup-draft should generate AI draft"""
        estimate_id = test_estimate["id"]
        
        # This calls AI, may take a few seconds
        response = requests.post(f"{BASE_URL}/api/estimates/{estimate_id}/followup-draft", json={}, headers=headers, timeout=60)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "likely_objection" in data, "Response should contain likely_objection"
        assert "subject" in data, "Response should contain subject"
        assert "body" in data, "Response should contain body"
        assert "tone" in data, "Response should contain tone"
        assert "cta" in data, "Response should contain cta"
        assert "estimate_id" in data, "Response should contain estimate_id"
        assert "generated_at" in data, "Response should contain generated_at"
        
        print(f"Followup draft: objection={data.get('likely_objection')}, tone={data.get('tone')}")
    
    def test_followup_draft_400_for_approved(self, headers):
        """POST /api/estimates/{id}/followup-draft should return 400 if approved"""
        # Get estimates and find an approved one, or create and approve
        est_resp = requests.get(f"{BASE_URL}/api/estimates", headers=headers)
        estimates = est_resp.json()
        
        approved = None
        for est in estimates:
            if est.get("status") == "approved":
                approved = est
                break
        
        if not approved:
            # Create and approve one
            clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
            clients = clients_resp.json()
            if len(clients) == 0:
                pytest.skip("No clients to create estimate")
            
            create_resp = requests.post(f"{BASE_URL}/api/estimates", json={
                "title": "TEST_Approved Estimate",
                "client_id": clients[0]["id"],
                "client_name": clients[0]["name"],
                "line_items": [{"description": "Test", "quantity": 1, "unit_price": 100}]
            }, headers=headers)
            if create_resp.status_code not in [200, 201]:
                pytest.skip("Could not create estimate")
            approved = create_resp.json()
            
            # Approve it
            requests.put(f"{BASE_URL}/api/estimates/{approved['id']}/status", json={"status": "approved"}, headers=headers)
        
        # Now test followup on approved estimate
        response = requests.post(f"{BASE_URL}/api/estimates/{approved['id']}/followup-draft", json={}, headers=headers)
        assert response.status_code == 400, f"Expected 400 for approved estimate, got {response.status_code}"
    
    def test_followup_draft_404_for_invalid(self, headers):
        """POST /api/estimates/{id}/followup-draft should return 404 for invalid ID"""
        response = requests.post(f"{BASE_URL}/api/estimates/invalid-id-xyz/followup-draft", json={}, headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"


# ============ 5. INVOICE EXPLAINER TESTS ============

class TestInvoiceExplainer:
    """Tests for GET /api/invoices/{id}/explainer endpoint"""
    
    @pytest.fixture(scope="class")
    def test_invoice(self, headers):
        """Get or create a test invoice"""
        inv_resp = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        assert inv_resp.status_code == 200
        invoices = inv_resp.json()
        
        if len(invoices) > 0:
            return invoices[0]
        
        # Create one
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = clients_resp.json()
        if len(clients) == 0:
            pytest.skip("No clients available")
        
        create_resp = requests.post(f"{BASE_URL}/api/invoices", json={
            "client_id": clients[0]["id"],
            "due_date": "2026-02-15",
            "line_items": [{"name": "Managed Services", "quantity": 1, "unit_price": 1500}],
            "tax_rate": 10
        }, headers=headers)
        assert create_resp.status_code in [200, 201]
        return create_resp.json()
    
    def test_invoice_explainer_success(self, headers, test_invoice):
        """GET /api/invoices/{id}/explainer should return AI summary"""
        invoice_id = test_invoice["id"]
        
        # This calls AI, may take a few seconds
        response = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}/explainer", headers=headers, timeout=60)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "invoice_id" in data, "Response should contain invoice_id"
        assert "invoice_number" in data, "Response should contain invoice_number"
        assert "summary" in data, "Response should contain summary"
        assert "stats" in data, "Response should contain stats"
        assert "generated_at" in data, "Response should contain generated_at"
        
        # Validate stats structure
        stats = data["stats"]
        assert "tickets" in stats, "Stats should contain tickets count"
        assert "critical" in stats, "Stats should contain critical count"
        assert "devices" in stats, "Stats should contain devices count"
        assert "period_start" in stats, "Stats should contain period_start"
        assert "period_end" in stats, "Stats should contain period_end"
        
        print(f"Invoice explainer: {len(data['summary'])} chars, {stats['tickets']} tickets, {stats['devices']} devices")
    
    def test_invoice_explainer_404_for_invalid(self, headers):
        """GET /api/invoices/{id}/explainer should return 404 for invalid ID"""
        response = requests.get(f"{BASE_URL}/api/invoices/invalid-invoice-xyz/explainer", headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
    
    def test_invoice_explainer_requires_auth(self):
        """Invoice explainer should require authentication"""
        response = requests.get(f"{BASE_URL}/api/invoices/some-id/explainer")
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"


# ============ CLEANUP ============

@pytest.fixture(scope="module", autouse=True)
def cleanup(headers):
    """Cleanup test data after all tests"""
    yield
    # Cleanup TEST_ prefixed data
    try:
        # Clean up test promises
        promises_resp = requests.get(f"{BASE_URL}/api/payment-promises", headers=headers)
        if promises_resp.status_code == 200:
            for p in promises_resp.json():
                if "TEST_" in (p.get("raw_text") or ""):
                    requests.delete(f"{BASE_URL}/api/payment-promises/{p['id']}", headers=headers)
        
        # Clean up test estimates
        est_resp = requests.get(f"{BASE_URL}/api/estimates", headers=headers)
        if est_resp.status_code == 200:
            for e in est_resp.json():
                if "TEST_" in (e.get("title") or ""):
                    requests.delete(f"{BASE_URL}/api/estimates/{e['id']}", headers=headers)
    except Exception as ex:
        print(f"Cleanup warning: {ex}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
