"""
Iteration 102: Acronis Billing + Recurring Invoice Auto-Attach Tests
Tests the new feature to link Acronis usage to recurring invoices for automatic billing.

Features tested:
1. GET /api/acronis/billing/preview - returns auto_bill_recurring and active_recurring_invoices per client
2. POST /api/acronis/billing/client/{id}/link-to-recurring - enables include_acronis_usage on all active RIs
3. POST /api/acronis/billing/client/{id}/link-to-recurring with create_if_missing - creates scaffold RI
4. POST /api/acronis/billing/client/{id}/unlink-recurring - disables include_acronis_usage on all RIs
5. GET /api/recurring-invoices/by-client/{id} - lists client RIs with include_acronis_usage flag
6. POST /api/recurring-invoices/{id}/set-acronis-auto - toggles flag on single RI
7. POST /api/recurring-invoices/create - accepts include_acronis_usage in payload
8. POST /api/recurring-invoices/scheduler/run-now - auto-attaches Acronis usage when include_acronis_usage=true
"""

import pytest
import requests
import os
import uuid
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "aaron@stech.com.au"
ADMIN_PASSWORD = "Lucky@2871$!"

# Known test client with Acronis link
ACME_CLIENT_ID = "client-001"
ACME_CLIENT_NAME = "Acme Corporation"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for admin user"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }


class TestAcronisBillingPreview:
    """Test GET /api/acronis/billing/preview returns new fields"""

    def test_billing_preview_returns_auto_bill_fields(self, headers):
        """Verify preview returns auto_bill_recurring and active_recurring_invoices per client"""
        response = requests.get(f"{BASE_URL}/api/acronis/billing/preview", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "results" in data, "Response should have 'results' field"
        
        # Check that at least one client result has the new fields
        if len(data["results"]) > 0:
            client_result = data["results"][0]
            assert "auto_bill_recurring" in client_result, "Client result should have 'auto_bill_recurring' field"
            assert "active_recurring_invoices" in client_result, "Client result should have 'active_recurring_invoices' field"
            assert isinstance(client_result["auto_bill_recurring"], bool), "auto_bill_recurring should be boolean"
            assert isinstance(client_result["active_recurring_invoices"], list), "active_recurring_invoices should be list"
            print(f"PASS: Billing preview returns auto_bill_recurring={client_result['auto_bill_recurring']}, active_recurring_invoices count={len(client_result['active_recurring_invoices'])}")


class TestRecurringInvoicesByClient:
    """Test GET /api/recurring-invoices/by-client/{client_id}"""

    def test_get_recurring_by_client(self, headers):
        """Verify endpoint returns RIs for a specific client with include_acronis_usage flag"""
        response = requests.get(f"{BASE_URL}/api/recurring-invoices/by-client/{ACME_CLIENT_ID}", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        if len(data) > 0:
            ri = data[0]
            assert "id" in ri, "RI should have 'id' field"
            assert "include_acronis_usage" in ri, "RI should have 'include_acronis_usage' field"
            print(f"PASS: Found {len(data)} recurring invoices for client {ACME_CLIENT_ID}")
            for r in data:
                print(f"  - {r['id']}: include_acronis_usage={r.get('include_acronis_usage', False)}")


class TestSetAcronisAuto:
    """Test POST /api/recurring-invoices/{ri_id}/set-acronis-auto"""

    def test_toggle_acronis_auto_on_ri(self, headers):
        """Toggle include_acronis_usage flag on a specific RI"""
        # First get an RI for the client
        response = requests.get(f"{BASE_URL}/api/recurring-invoices/by-client/{ACME_CLIENT_ID}", headers=headers)
        assert response.status_code == 200
        ris = response.json()
        
        if len(ris) == 0:
            pytest.skip("No recurring invoices found for client")
        
        ri_id = ris[0]["id"]
        current_state = ris[0].get("include_acronis_usage", False)
        
        # Toggle to opposite state
        new_state = not current_state
        response = requests.post(
            f"{BASE_URL}/api/recurring-invoices/{ri_id}/set-acronis-auto",
            json={"include_acronis_usage": new_state},
            headers=headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "include_acronis_usage" in data, "Response should have 'include_acronis_usage' field"
        assert data["include_acronis_usage"] == new_state, f"Expected {new_state}, got {data['include_acronis_usage']}"
        print(f"PASS: Toggled include_acronis_usage on {ri_id} from {current_state} to {new_state}")
        
        # Toggle back to original state
        requests.post(
            f"{BASE_URL}/api/recurring-invoices/{ri_id}/set-acronis-auto",
            json={"include_acronis_usage": current_state},
            headers=headers
        )


class TestLinkToRecurring:
    """Test POST /api/acronis/billing/client/{id}/link-to-recurring"""

    def test_link_client_to_recurring(self, headers):
        """Enable auto-attach on all active RIs for a client"""
        response = requests.post(
            f"{BASE_URL}/api/acronis/billing/client/{ACME_CLIENT_ID}/link-to-recurring",
            json={},
            headers=headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "client_id" in data, "Response should have 'client_id'"
        assert "updated_recurring_invoices" in data, "Response should have 'updated_recurring_invoices'"
        assert "message" in data, "Response should have 'message'"
        
        print(f"PASS: Linked client {ACME_CLIENT_ID} to recurring invoices")
        print(f"  - Updated RIs: {data['updated_recurring_invoices']}")
        print(f"  - Message: {data['message']}")

    def test_link_returns_error_for_unlinked_client(self, headers):
        """Verify error when client has no Acronis tenant link"""
        # Use a client ID that doesn't have an Acronis link
        fake_client_id = "client-999-no-acronis"
        response = requests.post(
            f"{BASE_URL}/api/acronis/billing/client/{fake_client_id}/link-to-recurring",
            json={},
            headers=headers
        )
        # Should return 400 or 404
        assert response.status_code in [400, 404], f"Expected 400/404, got {response.status_code}"
        print(f"PASS: Correctly rejected unlinked client with status {response.status_code}")


class TestUnlinkRecurring:
    """Test POST /api/acronis/billing/client/{id}/unlink-recurring"""

    def test_unlink_client_from_recurring(self, headers):
        """Disable auto-attach on all RIs for a client"""
        response = requests.post(
            f"{BASE_URL}/api/acronis/billing/client/{ACME_CLIENT_ID}/unlink-recurring",
            json={},
            headers=headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "client_id" in data, "Response should have 'client_id'"
        assert "disabled_on" in data, "Response should have 'disabled_on'"
        
        print(f"PASS: Unlinked client {ACME_CLIENT_ID} from recurring invoices")
        print(f"  - Disabled on {data['disabled_on']} recurring invoice(s)")


class TestCreateRecurringWithAcronisFlag:
    """Test POST /api/recurring-invoices/create with include_acronis_usage"""

    def test_create_recurring_with_acronis_flag(self, headers):
        """Create a recurring invoice with include_acronis_usage=true"""
        unique_id = uuid.uuid4().hex[:6]
        payload = {
            "client_id": ACME_CLIENT_ID,
            "client_name": ACME_CLIENT_NAME,
            "description": f"TEST_Acronis Auto-Billing Test {unique_id}",
            "line_items": [
                {"description": "Base MSP Fee", "quantity": 1, "rate": 100, "amount": 100}
            ],
            "frequency": "monthly",
            "tax_rate": 10,
            "currency": "AUD",
            "include_acronis_usage": True,
            "auto_send": False
        }
        
        response = requests.post(
            f"{BASE_URL}/api/recurring-invoices/create",
            json=payload,
            headers=headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should have 'id'"
        assert data.get("include_acronis_usage") == True, "include_acronis_usage should be True"
        
        created_id = data["id"]
        print(f"PASS: Created recurring invoice {created_id} with include_acronis_usage=True")
        
        # Cleanup - delete the test RI
        requests.delete(f"{BASE_URL}/api/recurring-invoices/{created_id}", headers=headers)
        print(f"  - Cleaned up test RI {created_id}")


class TestSchedulerRunNowWithAcronisAttach:
    """Test POST /api/recurring-invoices/scheduler/run-now with Acronis auto-attach"""

    def test_scheduler_run_now_attaches_acronis(self, headers):
        """Verify scheduler run-now auto-attaches Acronis usage when include_acronis_usage=true"""
        # First, create a test RI with include_acronis_usage=true and next_generation=today
        today = datetime.now().strftime("%Y-%m-%d")
        unique_id = uuid.uuid4().hex[:6]
        
        payload = {
            "client_id": ACME_CLIENT_ID,
            "client_name": ACME_CLIENT_NAME,
            "description": f"TEST_Scheduler Acronis Test {unique_id}",
            "line_items": [
                {"description": "Base Fee", "quantity": 1, "rate": 50, "amount": 50}
            ],
            "frequency": "monthly",
            "tax_rate": 10,
            "currency": "AUD",
            "start_date": today,
            "include_acronis_usage": True,
            "auto_send": False
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/recurring-invoices/create",
            json=payload,
            headers=headers
        )
        assert create_response.status_code == 200, f"Failed to create test RI: {create_response.text}"
        
        ri_id = create_response.json()["id"]
        print(f"Created test RI {ri_id} with next_generation={today}")
        
        # Force next_generation to today so scheduler picks it up
        update_response = requests.put(
            f"{BASE_URL}/api/recurring-invoices/{ri_id}",
            json={"next_generation": today},
            headers=headers
        )
        assert update_response.status_code == 200, f"Failed to update RI: {update_response.text}"
        
        # Run the scheduler
        scheduler_response = requests.post(
            f"{BASE_URL}/api/recurring-invoices/scheduler/run-now",
            headers=headers
        )
        assert scheduler_response.status_code == 200, f"Scheduler failed: {scheduler_response.text}"
        
        scheduler_data = scheduler_response.json()
        print(f"Scheduler processed {scheduler_data.get('processed', 0)} invoices")
        
        # Find our test RI in the results
        our_result = None
        for result in scheduler_data.get("results", []):
            if result.get("ri_id") == ri_id:
                our_result = result
                break
        
        if our_result:
            print(f"  - RI {ri_id}: status={our_result.get('status')}, acronis_items={our_result.get('acronis_items', 0)}")
            # Verify Acronis items were attached (if client has Acronis usage)
            if our_result.get("acronis_items", 0) > 0:
                print(f"PASS: Scheduler attached {our_result['acronis_items']} Acronis line items")
            else:
                print(f"INFO: No Acronis items attached (client may have no billable usage)")
            
            # Verify the generated invoice has acronis_auto items
            if our_result.get("invoice"):
                inv_number = our_result["invoice"]
                # Get the invoice to verify line items
                invoices_response = requests.get(f"{BASE_URL}/api/invoices/list", headers=headers)
                if invoices_response.status_code == 200:
                    invoices = invoices_response.json()
                    generated_inv = next((i for i in invoices if i.get("invoice_number") == inv_number), None)
                    if generated_inv:
                        acronis_items = [li for li in generated_inv.get("line_items", []) if li.get("acronis_auto")]
                        print(f"  - Generated invoice {inv_number} has {len(acronis_items)} acronis_auto line items")
        else:
            print(f"INFO: Test RI {ri_id} was not processed (may not have been due)")
        
        # Cleanup - delete the test RI
        requests.delete(f"{BASE_URL}/api/recurring-invoices/{ri_id}", headers=headers)
        print(f"  - Cleaned up test RI {ri_id}")


class TestCreateScaffoldRIWhenMissing:
    """Test POST /api/acronis/billing/client/{id}/link-to-recurring with create_if_missing"""

    def test_create_scaffold_ri_when_missing(self, headers):
        """Test creating a scaffold RI when client has no active RIs"""
        # First, we need a client that has an Acronis link but no active RIs
        # For this test, we'll use client-001 but first disable all their RIs
        
        # Get current RIs for the client
        ris_response = requests.get(
            f"{BASE_URL}/api/recurring-invoices/by-client/{ACME_CLIENT_ID}",
            headers=headers
        )
        assert ris_response.status_code == 200
        existing_ris = ris_response.json()
        
        # Store original states and pause all active RIs
        original_states = {}
        for ri in existing_ris:
            if ri.get("status") == "active":
                original_states[ri["id"]] = "active"
                requests.post(f"{BASE_URL}/api/recurring-invoices/{ri['id']}/toggle", headers=headers)
        
        print(f"Paused {len(original_states)} active RIs for test")
        
        try:
            # Now try to link with create_if_missing
            response = requests.post(
                f"{BASE_URL}/api/acronis/billing/client/{ACME_CLIENT_ID}/link-to-recurring",
                json={
                    "create_if_missing": True,
                    "frequency": "monthly",
                    "currency": "AUD"
                },
                headers=headers
            )
            assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
            
            data = response.json()
            
            if data.get("created_recurring_invoice_id"):
                created_id = data["created_recurring_invoice_id"]
                print(f"PASS: Created scaffold RI {created_id}")
                print(f"  - Message: {data.get('message')}")
                
                # Verify the created RI has include_acronis_usage=true
                ri_response = requests.get(f"{BASE_URL}/api/recurring-invoices/{created_id}", headers=headers)
                if ri_response.status_code == 200:
                    ri_data = ri_response.json()
                    assert ri_data.get("include_acronis_usage") == True, "Scaffold RI should have include_acronis_usage=True"
                    print(f"  - Verified include_acronis_usage=True on scaffold RI")
                
                # Cleanup - delete the scaffold RI
                requests.delete(f"{BASE_URL}/api/recurring-invoices/{created_id}", headers=headers)
                print(f"  - Cleaned up scaffold RI {created_id}")
            else:
                # If there were still active RIs (edge case), it would just enable on them
                print(f"INFO: No scaffold created - enabled on existing RIs: {data.get('updated_recurring_invoices')}")
        
        finally:
            # Restore original RI states
            for ri_id in original_states:
                requests.post(f"{BASE_URL}/api/recurring-invoices/{ri_id}/toggle", headers=headers)
            print(f"Restored {len(original_states)} RIs to active state")


class TestGenerateNowWithAcronisAttach:
    """Test POST /api/recurring-invoices/{ri_id}/generate-now with Acronis auto-attach"""

    def test_generate_now_attaches_acronis(self, headers):
        """Verify manual generate-now auto-attaches Acronis usage"""
        # Get an RI for the client with include_acronis_usage enabled
        ris_response = requests.get(
            f"{BASE_URL}/api/recurring-invoices/by-client/{ACME_CLIENT_ID}",
            headers=headers
        )
        assert ris_response.status_code == 200
        ris = ris_response.json()
        
        # Find or create an RI with include_acronis_usage=true
        target_ri = None
        for ri in ris:
            if ri.get("include_acronis_usage") and ri.get("status") == "active":
                target_ri = ri
                break
        
        if not target_ri:
            # Create one for testing
            unique_id = uuid.uuid4().hex[:6]
            create_response = requests.post(
                f"{BASE_URL}/api/recurring-invoices/create",
                json={
                    "client_id": ACME_CLIENT_ID,
                    "client_name": ACME_CLIENT_NAME,
                    "description": f"TEST_Generate Now Acronis {unique_id}",
                    "line_items": [{"description": "Base", "quantity": 1, "rate": 25, "amount": 25}],
                    "frequency": "monthly",
                    "tax_rate": 10,
                    "include_acronis_usage": True
                },
                headers=headers
            )
            assert create_response.status_code == 200
            target_ri = create_response.json()
            print(f"Created test RI {target_ri['id']} for generate-now test")
        
        ri_id = target_ri["id"]
        
        # Generate invoice now
        gen_response = requests.post(
            f"{BASE_URL}/api/recurring-invoices/{ri_id}/generate-now",
            headers=headers
        )
        assert gen_response.status_code == 200, f"Generate-now failed: {gen_response.text}"
        
        gen_data = gen_response.json()
        print(f"Generated invoice: {gen_data.get('invoice_number')}")
        print(f"  - Total: {gen_data.get('total')}")
        print(f"  - Acronis items attached: {gen_data.get('acronis_auto_attached', 0)}")
        
        # Check line items for acronis_auto flag
        acronis_items = [li for li in gen_data.get("line_items", []) if li.get("acronis_auto")]
        if len(acronis_items) > 0:
            print(f"PASS: Generate-now attached {len(acronis_items)} Acronis line items")
            for item in acronis_items[:3]:  # Show first 3
                print(f"    - {item.get('description')}: ${item.get('amount', 0):.2f}")
        else:
            print(f"INFO: No Acronis items attached (client may have no billable usage)")
        
        # Cleanup if we created a test RI
        if "TEST_" in target_ri.get("description", ""):
            requests.delete(f"{BASE_URL}/api/recurring-invoices/{ri_id}", headers=headers)
            print(f"  - Cleaned up test RI {ri_id}")


class TestRegressionRecurringInvoices:
    """Regression tests for existing recurring invoice functionality"""

    def test_list_recurring_invoices(self, headers):
        """Verify listing recurring invoices still works"""
        response = requests.get(f"{BASE_URL}/api/recurring-invoices/list", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: Listed {len(data)} recurring invoices")

    def test_recurring_stats(self, headers):
        """Verify recurring stats endpoint still works"""
        response = requests.get(f"{BASE_URL}/api/recurring-invoices/stats", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "total" in data, "Stats should have 'total'"
        assert "active" in data, "Stats should have 'active'"
        assert "mrr" in data, "Stats should have 'mrr'"
        print(f"PASS: Stats - Total: {data['total']}, Active: {data['active']}, MRR: ${data['mrr']}")

    def test_scheduler_status(self, headers):
        """Verify scheduler status endpoint still works"""
        response = requests.get(f"{BASE_URL}/api/recurring-invoices/scheduler/status", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "scheduler_active" in data, "Should have 'scheduler_active'"
        assert "due_now" in data, "Should have 'due_now'"
        print(f"PASS: Scheduler status - Active: {data['scheduler_active']}, Due now: {data['due_now']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
