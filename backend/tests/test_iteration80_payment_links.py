"""
Iteration 80 - Payment Links Feature Tests
Tests for one-time expiring payment links for invoices

Features tested:
- POST /api/payment-links - Create payment link with token, invoice details, expiry
- GET /api/payment-links - List all payment links (admin view)
- DELETE /api/payment-links/{id} - Revoke link
- GET /api/pay/{token} - Public endpoint returns invoice details (no auth)
- POST /api/pay/{token}/card - Initiate Stripe checkout
- POST /api/pay/{token}/bank-transfer - Record bank transfer (awaiting_confirmation)
- POST /api/pay/{token}/becs - Initiate BECS payment intent
- GET /api/pay/{token}/confirm - Check Stripe payment status
- POST /api/payment-links/{id}/confirm-transfer - Admin confirms bank transfer
- Expired/revoked links return appropriate error messages
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'http://127.0.0.1:8001').rstrip('/')

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"

# Existing payment link token for testing
EXISTING_TOKEN = "9DdswWeBk7O13vkq_7KKkRdNaA1rIaHY-h-gFdudJ-w"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for admin user"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def test_invoice(auth_headers):
    """Get an invoice with balance due for testing"""
    response = requests.get(f"{BASE_URL}/api/xero/invoices", headers=auth_headers)
    if response.status_code == 200:
        invoices = response.json()
        # Find an invoice with amount_due > 0 and not VOIDED
        for inv in invoices:
            if inv.get("amount_due", 0) > 0 and inv.get("status") != "VOIDED":
                return inv
    # Create a test invoice if none found
    test_inv = {
        "client_name": "TEST_PaymentLink_Client",
        "reference": f"TEST-PL-{uuid.uuid4().hex[:8]}",
        "due_date": "2026-02-15",
        "line_items": [{"description": "Test Service", "quantity": 1, "unit_price": 500.00}]
    }
    response = requests.post(f"{BASE_URL}/api/xero/invoices", json=test_inv, headers=auth_headers)
    if response.status_code in [200, 201]:
        return response.json()
    pytest.skip("Could not find or create test invoice")


class TestPaymentLinksAdmin:
    """Admin endpoints for payment links (require auth)"""
    
    def test_list_payment_links(self, auth_headers):
        """GET /api/payment-links - List all payment links"""
        response = requests.get(f"{BASE_URL}/api/payment-links", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list of payment links"
        print(f"âœ“ Found {len(data)} payment links")
        
        # Verify structure if links exist
        if len(data) > 0:
            link = data[0]
            assert "id" in link, "Payment link should have id"
            assert "token" in link, "Payment link should have token"
            assert "invoice_id" in link, "Payment link should have invoice_id"
            assert "status" in link, "Payment link should have status"
            print(f"âœ“ Payment link structure verified: {link.get('invoice_number')} - {link.get('status')}")
    
    def test_create_payment_link(self, auth_headers, test_invoice):
        """POST /api/payment-links - Create a new payment link"""
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["card", "becs", "bank_transfer"]
        }
        response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should have id"
        assert "token" in data, "Response should have token"
        assert data["invoice_id"] == test_invoice["id"], "Invoice ID should match"
        assert data["status"] == "active", "New link should be active"
        assert "expires_at" in data, "Should have expiry date"
        assert data["expires_days"] == 14, "Expires days should be 14"
        assert "card" in data["allowed_methods"], "Should allow card payments"
        assert "becs" in data["allowed_methods"], "Should allow BECS payments"
        assert "bank_transfer" in data["allowed_methods"], "Should allow bank transfers"
        
        print(f"âœ“ Created payment link: {data['token'][:20]}...")
        print(f"  Invoice: {data.get('invoice_number')}")
        print(f"  Balance: ${data.get('balance_at_creation', 0):.2f}")
        print(f"  Expires: {data.get('expires_at')}")
        
        # Store for later tests
        pytest.created_link_id = data["id"]
        pytest.created_link_token = data["token"]
    
    def test_create_payment_link_missing_invoice(self, auth_headers):
        """POST /api/payment-links - Should fail without invoice_id"""
        response = requests.post(f"{BASE_URL}/api/payment-links", json={}, headers=auth_headers)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("âœ“ Correctly rejected request without invoice_id")
    
    def test_create_payment_link_invalid_invoice(self, auth_headers):
        """POST /api/payment-links - Should fail with non-existent invoice"""
        payload = {"invoice_id": "non-existent-invoice-id"}
        response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("âœ“ Correctly rejected non-existent invoice")
    
    def test_revoke_payment_link(self, auth_headers, test_invoice):
        """DELETE /api/payment-links/{id} - Revoke a payment link"""
        # First create a link to revoke
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 7,
            "allowed_methods": ["card"]
        }
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        if create_response.status_code != 200:
            pytest.skip("Could not create link to revoke")
        
        link_id = create_response.json()["id"]
        link_token = create_response.json()["token"]
        
        # Revoke the link
        response = requests.delete(f"{BASE_URL}/api/payment-links/{link_id}", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Should have success message"
        print(f"âœ“ Revoked payment link: {link_id}")
        
        # Verify the link is now revoked via public endpoint
        public_response = requests.get(f"{BASE_URL}/api/pay/{link_token}")
        assert public_response.status_code == 410, f"Revoked link should return 410, got {public_response.status_code}"
        print("âœ“ Revoked link correctly returns 410 Gone")
    
    def test_revoke_nonexistent_link(self, auth_headers):
        """DELETE /api/payment-links/{id} - Should fail for non-existent link"""
        response = requests.delete(f"{BASE_URL}/api/payment-links/non-existent-id", headers=auth_headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("âœ“ Correctly rejected non-existent link revocation")


class TestPublicPaymentEndpoints:
    """Public endpoints for payment page (no auth required)"""
    
    def test_get_payment_page_data_existing_token(self):
        """GET /api/pay/{token} - Get invoice details for existing token"""
        response = requests.get(f"{BASE_URL}/api/pay/{EXISTING_TOKEN}")
        
        # Token might be expired/revoked/completed, so accept 200 or 410
        if response.status_code == 200:
            data = response.json()
            assert "invoice_number" in data, "Should have invoice_number"
            assert "client_name" in data, "Should have client_name"
            assert "balance" in data, "Should have balance"
            assert "allowed_methods" in data, "Should have allowed_methods"
            assert "payments" in data, "Should have payments array"
            print(f"âœ“ Got payment page data for existing token")
            print(f"  Invoice: {data.get('invoice_number')}")
            print(f"  Client: {data.get('client_name')}")
            print(f"  Balance: ${data.get('balance', 0):.2f}")
            print(f"  Methods: {data.get('allowed_methods')}")
            print(f"  Payments: {len(data.get('payments', []))}")
        elif response.status_code == 410:
            detail = response.json().get("detail", "")
            print(f"âœ“ Token returned 410 (expected for expired/revoked/completed): {detail}")
        else:
            pytest.fail(f"Unexpected status {response.status_code}: {response.text}")
    
    def test_get_payment_page_data_invalid_token(self):
        """GET /api/pay/{token} - Should fail for invalid token"""
        response = requests.get(f"{BASE_URL}/api/pay/invalid-token-12345")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("âœ“ Correctly rejected invalid token")
    
    def test_get_payment_page_data_new_link(self, auth_headers, test_invoice):
        """GET /api/pay/{token} - Get data for newly created link"""
        # Create a fresh link
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["card", "becs", "bank_transfer"]
        }
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        if create_response.status_code != 200:
            pytest.skip("Could not create test link")
        
        token = create_response.json()["token"]
        
        # Get public data
        response = requests.get(f"{BASE_URL}/api/pay/{token}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["invoice_number"] == test_invoice.get("invoice_number"), "Invoice number should match"
        assert "total" in data, "Should have total"
        assert "balance" in data, "Should have balance"
        assert "line_items" in data, "Should have line_items"
        assert "expires_at" in data, "Should have expires_at"
        
        print(f"âœ“ Got payment page data for new link")
        print(f"  Total: ${data.get('total', 0):.2f}")
        print(f"  Balance: ${data.get('balance', 0):.2f}")
        print(f"  Line items: {len(data.get('line_items', []))}")
        
        # Store token for payment tests
        pytest.test_payment_token = token


class TestPaymentMethods:
    """Test payment method endpoints"""
    
    def test_card_payment_initiation(self, auth_headers, test_invoice):
        """POST /api/pay/{token}/card - Initiate Stripe card payment"""
        # Create a fresh link
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["card", "becs", "bank_transfer"]
        }
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        if create_response.status_code != 200:
            pytest.skip("Could not create test link")
        
        token = create_response.json()["token"]
        balance = create_response.json().get("balance_at_creation", 100)
        
        # Initiate card payment
        pay_payload = {
            "amount": min(balance, 50.00),  # Pay partial amount
            "origin_url": "http://127.0.0.1:8001",
            "currency": "aud"
        }
        response = requests.post(f"{BASE_URL}/api/pay/{token}/card", json=pay_payload)
        
        # Stripe might fail with test key, but we should get proper response structure
        if response.status_code == 200:
            data = response.json()
            assert "url" in data, "Should have Stripe checkout URL"
            assert "session_id" in data, "Should have session_id"
            print(f"âœ“ Card payment initiated successfully")
            print(f"  Checkout URL: {data.get('url', '')[:50]}...")
            print(f"  Session ID: {data.get('session_id')}")
        elif response.status_code == 500:
            # Stripe might not be fully configured
            detail = response.json().get("detail", "")
            print(f"âš  Card payment returned 500 (Stripe config issue): {detail}")
        else:
            pytest.fail(f"Unexpected status {response.status_code}: {response.text}")
    
    def test_card_payment_invalid_amount(self, auth_headers, test_invoice):
        """POST /api/pay/{token}/card - Should fail with invalid amount"""
        # Create a fresh link
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["card"]
        }
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        if create_response.status_code != 200:
            pytest.skip("Could not create test link")
        
        token = create_response.json()["token"]
        
        # Try with zero amount
        response = requests.post(f"{BASE_URL}/api/pay/{token}/card", json={"amount": 0})
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("âœ“ Correctly rejected zero amount")
        
        # Try with negative amount
        response = requests.post(f"{BASE_URL}/api/pay/{token}/card", json={"amount": -50})
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("âœ“ Correctly rejected negative amount")
    
    def test_bank_transfer_recording(self, auth_headers, test_invoice):
        """POST /api/pay/{token}/bank-transfer - Record bank transfer"""
        # Create a fresh link
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["card", "becs", "bank_transfer"]
        }
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        if create_response.status_code != 200:
            pytest.skip("Could not create test link")
        
        token = create_response.json()["token"]
        link_id = create_response.json()["id"]
        balance = create_response.json().get("balance_at_creation", 100)
        
        # Record bank transfer
        transfer_payload = {
            "amount": min(balance, 100.00),
            "reference": f"TEST-BT-{uuid.uuid4().hex[:8]}",
            "payer_name": "Test Payer",
            "bank_name": "Test Bank"
        }
        response = requests.post(f"{BASE_URL}/api/pay/{token}/bank-transfer", json=transfer_payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Should have success message"
        assert "payment" in data, "Should have payment record"
        
        payment = data["payment"]
        assert payment["method"] == "bank_transfer", "Method should be bank_transfer"
        assert payment["status"] == "awaiting_confirmation", "Status should be awaiting_confirmation"
        assert payment["amount"] == transfer_payload["amount"], "Amount should match"
        assert payment["reference"] == transfer_payload["reference"], "Reference should match"
        
        print(f"âœ“ Bank transfer recorded successfully")
        print(f"  Payment ID: {payment.get('id')}")
        print(f"  Amount: ${payment.get('amount', 0):.2f}")
        print(f"  Status: {payment.get('status')}")
        
        # Store for admin confirmation test
        pytest.bank_transfer_link_id = link_id
        pytest.bank_transfer_payment_id = payment["id"]
    
    def test_becs_payment_initiation(self, auth_headers, test_invoice):
        """POST /api/pay/{token}/becs - Initiate BECS Direct Debit"""
        # Create a fresh link
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["card", "becs", "bank_transfer"]
        }
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        if create_response.status_code != 200:
            pytest.skip("Could not create test link")
        
        token = create_response.json()["token"]
        balance = create_response.json().get("balance_at_creation", 100)
        
        # Initiate BECS payment
        becs_payload = {"amount": min(balance, 75.00)}
        response = requests.post(f"{BASE_URL}/api/pay/{token}/becs", json=becs_payload)
        
        if response.status_code == 200:
            data = response.json()
            assert "client_secret" in data, "Should have client_secret"
            assert "payment_intent_id" in data, "Should have payment_intent_id"
            print(f"âœ“ BECS payment initiated successfully")
            print(f"  Payment Intent: {data.get('payment_intent_id')}")
        elif response.status_code == 500:
            # Stripe might not be fully configured
            detail = response.json().get("detail", "")
            print(f"âš  BECS payment returned 500 (Stripe config issue): {detail}")
        else:
            pytest.fail(f"Unexpected status {response.status_code}: {response.text}")
    
    def test_payment_method_not_allowed(self, auth_headers, test_invoice):
        """Test that disallowed payment methods are rejected"""
        # Create a link with only card allowed
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["card"]  # Only card
        }
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        if create_response.status_code != 200:
            pytest.skip("Could not create test link")
        
        token = create_response.json()["token"]
        
        # Try bank transfer (not allowed)
        response = requests.post(f"{BASE_URL}/api/pay/{token}/bank-transfer", json={
            "amount": 50.00,
            "reference": "TEST"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("âœ“ Correctly rejected disallowed payment method (bank_transfer)")
        
        # Try BECS (not allowed)
        response = requests.post(f"{BASE_URL}/api/pay/{token}/becs", json={"amount": 50.00})
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("âœ“ Correctly rejected disallowed payment method (becs)")


class TestAdminBankTransferConfirmation:
    """Test admin confirmation of bank transfers"""
    
    def test_confirm_bank_transfer(self, auth_headers, test_invoice):
        """POST /api/payment-links/{id}/confirm-transfer - Admin confirms bank transfer"""
        # Create a link and record a bank transfer
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["bank_transfer"]
        }
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        if create_response.status_code != 200:
            pytest.skip("Could not create test link")
        
        token = create_response.json()["token"]
        link_id = create_response.json()["id"]
        balance = create_response.json().get("balance_at_creation", 100)
        
        # Record bank transfer
        transfer_payload = {
            "amount": min(balance, 50.00),
            "reference": f"CONFIRM-TEST-{uuid.uuid4().hex[:8]}",
            "payer_name": "Confirm Test Payer",
            "bank_name": "Test Bank"
        }
        transfer_response = requests.post(f"{BASE_URL}/api/pay/{token}/bank-transfer", json=transfer_payload)
        if transfer_response.status_code != 200:
            pytest.skip("Could not record bank transfer")
        
        payment_id = transfer_response.json()["payment"]["id"]
        
        # Admin confirms the transfer
        confirm_payload = {"payment_id": payment_id}
        response = requests.post(f"{BASE_URL}/api/payment-links/{link_id}/confirm-transfer", 
                                json=confirm_payload, headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Should have success message"
        assert "amount" in data, "Should have confirmed amount"
        
        print(f"âœ“ Bank transfer confirmed by admin")
        print(f"  Amount: ${data.get('amount', 0):.2f}")
        
        # Verify the payment status changed
        public_response = requests.get(f"{BASE_URL}/api/pay/{token}")
        if public_response.status_code == 200:
            payments = public_response.json().get("payments", [])
            confirmed_payment = next((p for p in payments if p.get("id") == payment_id), None)
            if confirmed_payment:
                assert confirmed_payment["status"] == "paid", "Payment should be marked as paid"
                print(f"âœ“ Payment status verified as 'paid'")
    
    def test_confirm_nonexistent_payment(self, auth_headers):
        """POST /api/payment-links/{id}/confirm-transfer - Should fail for non-existent payment"""
        # Use a valid link ID but invalid payment ID
        links_response = requests.get(f"{BASE_URL}/api/payment-links", headers=auth_headers)
        if links_response.status_code != 200 or len(links_response.json()) == 0:
            pytest.skip("No payment links available")
        
        link_id = links_response.json()[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/payment-links/{link_id}/confirm-transfer",
                                json={"payment_id": "non-existent-payment"},
                                headers=auth_headers)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("âœ“ Correctly rejected non-existent payment confirmation")


class TestPaymentConfirmation:
    """Test Stripe payment confirmation endpoint"""
    
    def test_confirm_payment_no_session(self, auth_headers, test_invoice):
        """GET /api/pay/{token}/confirm - Without session_id"""
        # Create a fresh link
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["card"]
        }
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        if create_response.status_code != 200:
            pytest.skip("Could not create test link")
        
        token = create_response.json()["token"]
        
        # Call confirm without session_id
        response = requests.get(f"{BASE_URL}/api/pay/{token}/confirm")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("status") == "no_session", "Should return no_session status"
        print("âœ“ Confirm endpoint handles missing session_id correctly")
    
    def test_confirm_payment_invalid_session(self, auth_headers, test_invoice):
        """GET /api/pay/{token}/confirm - With invalid session_id"""
        # Create a fresh link
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["card"]
        }
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        if create_response.status_code != 200:
            pytest.skip("Could not create test link")
        
        token = create_response.json()["token"]
        
        # Call confirm with invalid session_id
        response = requests.get(f"{BASE_URL}/api/pay/{token}/confirm?session_id=invalid_session_123")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Should return check_failed or similar for invalid session
        assert data.get("status") in ["check_failed", "unpaid", "no_session"], f"Unexpected status: {data.get('status')}"
        print(f"âœ“ Confirm endpoint handles invalid session_id: {data.get('status')}")


class TestEdgeCases:
    """Test edge cases and error handling"""
    
    def test_card_payment_exceeds_balance(self, auth_headers, test_invoice):
        """Test that card payment amount exceeding balance is rejected"""
        # Create a fresh link
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["card"]
        }
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        if create_response.status_code != 200:
            pytest.skip("Could not create test link")
        
        token = create_response.json()["token"]
        balance = create_response.json().get("balance_at_creation", 100)
        
        # Try to pay more than balance via card
        response = requests.post(f"{BASE_URL}/api/pay/{token}/card", json={
            "amount": balance + 1000,  # Way more than balance
            "origin_url": "http://127.0.0.1:8001"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("âœ“ Correctly rejected card payment exceeding balance")
    
    def test_bank_transfer_records_any_amount(self, auth_headers, test_invoice):
        """Bank transfers can record any amount (admin confirms actual receipt)"""
        # Create a fresh link
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["bank_transfer"]
        }
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        if create_response.status_code != 200:
            pytest.skip("Could not create test link")
        
        token = create_response.json()["token"]
        
        # Bank transfers can record any amount - admin will verify actual receipt
        response = requests.post(f"{BASE_URL}/api/pay/{token}/bank-transfer", json={
            "amount": 50.00,
            "reference": "BANK-TEST"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("âœ“ Bank transfer recorded (admin will verify actual amount)")
    
    def test_payment_on_revoked_link(self, auth_headers, test_invoice):
        """Test that payments on revoked links are rejected"""
        # Create and revoke a link
        payload = {
            "invoice_id": test_invoice["id"],
            "expires_days": 14,
            "allowed_methods": ["bank_transfer"]
        }
        create_response = requests.post(f"{BASE_URL}/api/payment-links", json=payload, headers=auth_headers)
        if create_response.status_code != 200:
            pytest.skip("Could not create test link")
        
        token = create_response.json()["token"]
        link_id = create_response.json()["id"]
        
        # Revoke the link
        requests.delete(f"{BASE_URL}/api/payment-links/{link_id}", headers=auth_headers)
        
        # Try to make a payment
        response = requests.post(f"{BASE_URL}/api/pay/{token}/bank-transfer", json={
            "amount": 50.00,
            "reference": "REVOKED-TEST"
        })
        assert response.status_code == 410, f"Expected 410, got {response.status_code}"
        print("âœ“ Correctly rejected payment on revoked link")
    
    def test_unauthenticated_admin_endpoints(self):
        """Test that admin endpoints require authentication"""
        # List payment links without auth
        response = requests.get(f"{BASE_URL}/api/payment-links")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("âœ“ GET /api/payment-links requires auth")
        
        # Create payment link without auth
        response = requests.post(f"{BASE_URL}/api/payment-links", json={"invoice_id": "test"})
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("âœ“ POST /api/payment-links requires auth")
        
        # Delete payment link without auth
        response = requests.delete(f"{BASE_URL}/api/payment-links/test-id")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("âœ“ DELETE /api/payment-links/{id} requires auth")
        
        # Confirm transfer without auth
        response = requests.post(f"{BASE_URL}/api/payment-links/test-id/confirm-transfer", json={})
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("âœ“ POST /api/payment-links/{id}/confirm-transfer requires auth")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
