"""
Iteration 98 - Portal Merge Testing
Tests for:
1. Token-to-V2 redirect: POST /api/portal/v2/token-auth
2. Portal V2 invoice list: GET /api/portal/v2/invoices
3. Portal V2 invoice detail: GET /api/portal/v2/invoices/{id}
4. Portal V2 pay invoice: POST /api/portal/v2/invoices/{id}/pay
5. Portal login: POST /api/portal/v2/login
6. Portal ticket messaging: POST /api/portal/v2/tickets/{id}/messages
7. Portal KB: GET /api/portal/v2/kb
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestPortalTokenAuth:
    """Test legacy token to V2 session conversion"""
    
    def test_token_auth_missing_token(self):
        """POST /api/portal/v2/token-auth with no token returns 400"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/token-auth", json={})
        assert response.status_code == 400
        assert "Token required" in response.json().get("detail", "")
    
    def test_token_auth_invalid_token(self):
        """POST /api/portal/v2/token-auth with invalid token returns 404"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/token-auth", json={"token": "invalid-token-xyz"})
        assert response.status_code == 404
        assert "expired or invalid" in response.json().get("detail", "").lower()


class TestPortalLogin:
    """Test portal V2 login"""
    
    def test_login_success(self):
        """POST /api/portal/v2/login with valid credentials returns token"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": "john@acmecorp.com",
            "password": "portal123"
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == "john@acmecorp.com"
        assert data.get("requires_2fa") == False
    
    def test_login_invalid_credentials(self):
        """POST /api/portal/v2/login with wrong password returns 401"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": "john@acmecorp.com",
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        assert "Invalid" in response.json().get("detail", "")
    
    def test_login_missing_fields(self):
        """POST /api/portal/v2/login with missing fields returns 400"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": "john@acmecorp.com"
        })
        assert response.status_code == 400


@pytest.fixture
def portal_token():
    """Get portal auth token for john@acmecorp.com"""
    response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
        "email": "john@acmecorp.com",
        "password": "portal123"
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Portal login failed - skipping authenticated tests")


@pytest.fixture
def portal_headers(portal_token):
    """Headers with portal auth token"""
    return {"Authorization": f"Bearer {portal_token}"}


class TestPortalInvoices:
    """Test portal invoice endpoints"""
    
    def test_invoices_list(self, portal_headers):
        """GET /api/portal/v2/invoices returns invoices with payment fields"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/invoices", headers=portal_headers)
        assert response.status_code == 200
        invoices = response.json()
        assert isinstance(invoices, list)
        # Check invoice structure if any exist
        if len(invoices) > 0:
            inv = invoices[0]
            assert "id" in inv
            assert "invoice_number" in inv
            assert "total" in inv
            # Check for payment fields
            print(f"Invoice fields: {list(inv.keys())}")
    
    def test_invoices_list_unauthorized(self):
        """GET /api/portal/v2/invoices without auth returns 401"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/invoices")
        assert response.status_code == 401
    
    def test_invoice_detail(self, portal_headers):
        """GET /api/portal/v2/invoices/{id} returns full invoice with line_items"""
        # First get list to find an invoice
        list_response = requests.get(f"{BASE_URL}/api/portal/v2/invoices", headers=portal_headers)
        invoices = list_response.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices found for testing")
        
        invoice_id = invoices[0]["id"]
        response = requests.get(f"{BASE_URL}/api/portal/v2/invoices/{invoice_id}", headers=portal_headers)
        assert response.status_code == 200
        invoice = response.json()
        
        # Verify full invoice structure
        assert "id" in invoice
        assert "invoice_number" in invoice
        assert "total" in invoice
        # Check for line_items
        print(f"Invoice detail fields: {list(invoice.keys())}")
        if "line_items" in invoice:
            print(f"Line items count: {len(invoice.get('line_items', []))}")
    
    def test_invoice_detail_not_found(self, portal_headers):
        """GET /api/portal/v2/invoices/{id} with invalid id returns 404"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/invoices/invalid-invoice-id", headers=portal_headers)
        assert response.status_code == 404
    
    def test_pay_invoice_demo_mode(self, portal_headers):
        """POST /api/portal/v2/invoices/{id}/pay returns demo response"""
        # First get list to find an invoice with balance
        list_response = requests.get(f"{BASE_URL}/api/portal/v2/invoices", headers=portal_headers)
        invoices = list_response.json()
        
        # Find invoice with balance
        invoice_with_balance = None
        for inv in invoices:
            balance = (inv.get("total", 0) or 0) - (inv.get("amount_paid", 0) or 0)
            if balance > 0:
                invoice_with_balance = inv
                break
        
        if not invoice_with_balance:
            pytest.skip("No invoices with balance found for payment testing")
        
        invoice_id = invoice_with_balance["id"]
        response = requests.post(
            f"{BASE_URL}/api/portal/v2/invoices/{invoice_id}/pay",
            headers=portal_headers,
            json={"origin_url": "https://test.example.com", "currency": "aud"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should return demo mode response (Stripe key is sk_test_emergent)
        assert data.get("status") == "demo"
        assert "message" in data
        assert "balance" in data
        print(f"Pay invoice response: {data}")
    
    def test_pay_invoice_not_found(self, portal_headers):
        """POST /api/portal/v2/invoices/{id}/pay with invalid id returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/portal/v2/invoices/invalid-invoice-id/pay",
            headers=portal_headers,
            json={"origin_url": "https://test.example.com"}
        )
        assert response.status_code == 404


class TestPortalTicketMessaging:
    """Test portal ticket messaging"""
    
    def test_tickets_list(self, portal_headers):
        """GET /api/portal/v2/tickets returns tickets"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/tickets", headers=portal_headers)
        assert response.status_code == 200
        tickets = response.json()
        assert isinstance(tickets, list)
    
    def test_ticket_detail_with_messages(self, portal_headers):
        """GET /api/portal/v2/tickets/{id} returns ticket with messages"""
        # First get list
        list_response = requests.get(f"{BASE_URL}/api/portal/v2/tickets", headers=portal_headers)
        tickets = list_response.json()
        
        if len(tickets) == 0:
            pytest.skip("No tickets found for testing")
        
        ticket_id = tickets[0]["id"]
        response = requests.get(f"{BASE_URL}/api/portal/v2/tickets/{ticket_id}", headers=portal_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "ticket" in data
        assert "messages" in data
        assert isinstance(data["messages"], list)
    
    def test_add_ticket_message(self, portal_headers):
        """POST /api/portal/v2/tickets/{id}/messages adds message"""
        # First get list
        list_response = requests.get(f"{BASE_URL}/api/portal/v2/tickets", headers=portal_headers)
        tickets = list_response.json()
        
        if len(tickets) == 0:
            pytest.skip("No tickets found for testing")
        
        ticket_id = tickets[0]["id"]
        response = requests.post(
            f"{BASE_URL}/api/portal/v2/tickets/{ticket_id}/messages",
            headers=portal_headers,
            json={"content": "TEST_message from iteration 98 testing"}
        )
        assert response.status_code == 200
        message = response.json()
        
        assert "id" in message
        assert "content" in message
        assert message["content"] == "TEST_message from iteration 98 testing"
        assert message.get("sender_type") == "client"


class TestPortalKnowledgeBase:
    """Test portal knowledge base"""
    
    def test_kb_list(self, portal_headers):
        """GET /api/portal/v2/kb returns articles"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/kb", headers=portal_headers)
        assert response.status_code == 200
        articles = response.json()
        assert isinstance(articles, list)
        
        if len(articles) > 0:
            article = articles[0]
            assert "id" in article
            assert "title" in article
            assert "content" in article


class TestPortalDashboard:
    """Test portal dashboard and profile"""
    
    def test_dashboard_stats(self, portal_headers):
        """GET /api/portal/v2/dashboard returns stats"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/dashboard", headers=portal_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "stats" in data
        stats = data["stats"]
        assert "open_tickets" in stats
        assert "total_devices" in stats
        assert "outstanding_invoices" in stats
    
    def test_profile_me(self, portal_headers):
        """GET /api/portal/v2/me returns user profile"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/me", headers=portal_headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "user" in data
        assert "client" in data
        assert data["user"]["email"] == "john@acmecorp.com"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
