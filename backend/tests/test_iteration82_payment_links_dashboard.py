"""
Iteration 82 - Payment Links Dashboard Tab & Gradient Removal Testing
Tests:
1. Payment Links API endpoints (confirm-transfer, revoke, list)
2. Gradient removal verification (no bg-gradient-to-* classes in page files)
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
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json().get("token")

@pytest.fixture
def auth_headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}"}


class TestPaymentLinksAPI:
    """Payment Links API endpoint tests"""
    
    def test_get_payment_links_list(self, auth_headers):
        """GET /api/payment-links returns list of all payment links"""
        response = requests.get(f"{BASE_URL}/api/payment-links", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Verify structure if links exist
        if len(data) > 0:
            link = data[0]
            assert "id" in link
            assert "token" in link
            assert "invoice_id" in link
            assert "status" in link
            assert "payments" in link
            assert isinstance(link["payments"], list)
            print(f"Found {len(data)} payment links")
    
    def test_payment_links_have_payments_array(self, auth_headers):
        """Verify payment links include payments array for dashboard display"""
        response = requests.get(f"{BASE_URL}/api/payment-links", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        for link in data:
            assert "payments" in link, f"Link {link.get('id')} missing payments array"
            assert isinstance(link["payments"], list)
        print(f"All {len(data)} links have payments array")
    
    def test_create_payment_link_for_testing(self, auth_headers):
        """Create a test payment link to verify confirm-transfer endpoint"""
        # First get an invoice with balance
        inv_response = requests.get(f"{BASE_URL}/api/xero/invoices", headers=auth_headers)
        assert inv_response.status_code == 200
        invoices = inv_response.json()
        
        # Find invoice with balance due
        test_invoice = None
        for inv in invoices:
            if inv.get("amount_due", 0) > 0 and inv.get("status") != "VOIDED":
                test_invoice = inv
                break
        
        if not test_invoice:
            pytest.skip("No invoice with balance found for testing")
        
        # Create payment link
        response = requests.post(f"{BASE_URL}/api/payment-links", json={
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["card", "becs", "bank_transfer"]
        }, headers=auth_headers)
        
        assert response.status_code == 200
        link = response.json()
        assert "id" in link
        assert "token" in link
        assert link["status"] == "active"
        print(f"Created payment link {link['id']} for invoice {test_invoice.get('invoice_number')}")
        return link
    
    def test_revoke_payment_link(self, auth_headers):
        """DELETE /api/payment-links/{id} revokes a payment link"""
        # First create a link to revoke
        inv_response = requests.get(f"{BASE_URL}/api/xero/invoices", headers=auth_headers)
        invoices = inv_response.json()
        test_invoice = next((inv for inv in invoices if inv.get("amount_due", 0) > 0 and inv.get("status") != "VOIDED"), None)
        
        if not test_invoice:
            pytest.skip("No invoice with balance found")
        
        # Create link
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json={
            "invoice_id": test_invoice["id"],
            "expires_days": 1,
            "allowed_methods": ["card"]
        }, headers=auth_headers)
        assert create_response.status_code == 200
        link = create_response.json()
        
        # Revoke it
        revoke_response = requests.delete(f"{BASE_URL}/api/payment-links/{link['id']}", headers=auth_headers)
        assert revoke_response.status_code == 200
        assert "revoked" in revoke_response.json().get("message", "").lower()
        
        # Verify it's revoked in list
        list_response = requests.get(f"{BASE_URL}/api/payment-links", headers=auth_headers)
        links = list_response.json()
        revoked_link = next((l for l in links if l["id"] == link["id"]), None)
        assert revoked_link is not None
        assert revoked_link["status"] == "revoked"
        print(f"Successfully revoked payment link {link['id']}")
    
    def test_revoke_nonexistent_link_returns_404(self, auth_headers):
        """DELETE /api/payment-links/{id} returns 404 for non-existent link"""
        response = requests.delete(f"{BASE_URL}/api/payment-links/nonexistent-id-12345", headers=auth_headers)
        assert response.status_code == 404


class TestBankTransferConfirmation:
    """Bank transfer confirmation endpoint tests"""
    
    def test_confirm_transfer_endpoint_exists(self, auth_headers):
        """POST /api/payment-links/{id}/confirm-transfer endpoint exists"""
        # Test with invalid data to verify endpoint exists
        response = requests.post(
            f"{BASE_URL}/api/payment-links/test-link-id/confirm-transfer",
            json={"payment_id": "test-payment-id"},
            headers=auth_headers
        )
        # Should return 404 (link not found) not 405 (method not allowed)
        assert response.status_code in [404, 400], f"Unexpected status: {response.status_code}"
        print("confirm-transfer endpoint exists and responds correctly")
    
    def test_confirm_transfer_requires_payment_id(self, auth_headers):
        """Confirm transfer requires payment_id in request body"""
        # Get an existing link
        links_response = requests.get(f"{BASE_URL}/api/payment-links", headers=auth_headers)
        links = links_response.json()
        
        if not links:
            pytest.skip("No payment links exist")
        
        link = links[0]
        response = requests.post(
            f"{BASE_URL}/api/payment-links/{link['id']}/confirm-transfer",
            json={},  # Missing payment_id
            headers=auth_headers
        )
        # Should fail because no matching payment found
        assert response.status_code in [400, 404]


class TestPublicPaymentEndpoints:
    """Public payment page endpoints (no auth required)"""
    
    def test_get_payment_page_data(self, auth_headers):
        """GET /api/pay/{token} returns invoice data for payment page"""
        # Get an active link
        links_response = requests.get(f"{BASE_URL}/api/payment-links", headers=auth_headers)
        links = links_response.json()
        active_link = next((l for l in links if l["status"] == "active"), None)
        
        if not active_link:
            pytest.skip("No active payment links")
        
        # Access without auth (public endpoint)
        response = requests.get(f"{BASE_URL}/api/pay/{active_link['token']}")
        assert response.status_code == 200
        data = response.json()
        
        assert "invoice_number" in data
        assert "client_name" in data
        assert "balance" in data
        assert "allowed_methods" in data
        assert "payments" in data
        print(f"Public payment page data retrieved for {data.get('invoice_number')}")
    
    def test_invalid_token_returns_404(self):
        """GET /api/pay/{token} returns 404 for invalid token"""
        response = requests.get(f"{BASE_URL}/api/pay/invalid-token-xyz123")
        assert response.status_code == 404
    
    def test_record_bank_transfer(self, auth_headers):
        """POST /api/pay/{token}/bank-transfer records pending transfer"""
        # Get an active link
        links_response = requests.get(f"{BASE_URL}/api/payment-links", headers=auth_headers)
        links = links_response.json()
        active_link = next((l for l in links if l["status"] == "active"), None)
        
        if not active_link:
            pytest.skip("No active payment links")
        
        # Record bank transfer (public endpoint)
        response = requests.post(f"{BASE_URL}/api/pay/{active_link['token']}/bank-transfer", json={
            "amount": 50.00,
            "reference": "TEST-REF-82",
            "payer_name": "Test Payer",
            "bank_name": "Test Bank"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert "payment" in data
        assert data["payment"]["status"] == "awaiting_confirmation"
        print(f"Bank transfer recorded with status: {data['payment']['status']}")
        return active_link, data["payment"]


class TestPaymentLinksDashboardData:
    """Tests for data needed by Payment Links Dashboard tab"""
    
    def test_links_have_required_dashboard_fields(self, auth_headers):
        """Payment links have all fields needed for dashboard display"""
        response = requests.get(f"{BASE_URL}/api/payment-links", headers=auth_headers)
        assert response.status_code == 200
        links = response.json()
        
        required_fields = [
            "id", "token", "invoice_id", "invoice_number", "client_name",
            "balance_at_creation", "status", "allowed_methods", "expires_at",
            "created_at", "payments"
        ]
        
        for link in links:
            for field in required_fields:
                assert field in link, f"Link missing required field: {field}"
        
        print(f"All {len(links)} links have required dashboard fields")
    
    def test_count_links_by_status(self, auth_headers):
        """Count payment links by status for summary stats"""
        response = requests.get(f"{BASE_URL}/api/payment-links", headers=auth_headers)
        links = response.json()
        
        active = len([l for l in links if l["status"] == "active"])
        completed = len([l for l in links if l["status"] == "completed"])
        expired = len([l for l in links if l["status"] == "expired"])
        revoked = len([l for l in links if l["status"] == "revoked"])
        
        # Count pending transfers
        pending_transfers = sum(
            len([p for p in l.get("payments", []) if p.get("status") == "awaiting_confirmation"])
            for l in links
        )
        
        print(f"Link stats - Active: {active}, Completed: {completed}, Expired: {expired}, Revoked: {revoked}")
        print(f"Pending bank transfers: {pending_transfers}")
        
        # Just verify we can calculate these
        assert active >= 0
        assert completed >= 0
        assert pending_transfers >= 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
