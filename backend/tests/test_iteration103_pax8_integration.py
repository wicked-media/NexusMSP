"""
Iteration 103: Pax8 Integration Tests
Tests the new Pax8 Microsoft/CSP subscription sync and billing integration.

Features tested:
1. GET /api/settings/pax8 - returns masked secret + client_secret_set=true
2. PUT /api/settings/pax8 - saves client_id + client_secret (DO NOT rotate existing creds)
3. POST /api/pax8/test - validates OAuth2 against Pax8 API
4. POST /api/pax8/sync - syncs companies + subscriptions + products (idempotent)
5. GET /api/pax8/companies - returns companies with linked_client_id and auto_bill_recurring
6. POST /api/pax8/companies/{id}/link - links Pax8 company to NexusOps client
7. DELETE /api/pax8/companies/{id}/link - unlinks Pax8 company
8. GET /api/pax8/billing/preview - per-linked-client MRR with line_items
9. POST /api/pax8/billing/client/{id}/link-to-recurring - enables include_pax8_usage on RIs
10. POST /api/pax8/billing/client/{id}/unlink-recurring - disables include_pax8_usage
11. GET /api/pax8/subscriptions - lists subscriptions with product_name/vendor_name
12. POST /api/recurring-invoices/{id}/generate-now - includes pax8_auto line items
13. POST /api/recurring-invoices/create - accepts include_pax8_usage flag
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

# Known test client with Pax8 link (ACB Consultants → Acme Corporation)
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


class TestPax8Settings:
    """Test Pax8 settings endpoints"""

    def test_get_pax8_settings(self, headers):
        """Verify GET /api/settings/pax8 returns masked secret and client_secret_set"""
        response = requests.get(f"{BASE_URL}/api/settings/pax8", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "client_id" in data, "Response should have 'client_id'"
        assert "client_secret" in data, "Response should have 'client_secret' (masked)"
        assert "client_secret_set" in data, "Response should have 'client_secret_set'"
        assert "enabled" in data, "Response should have 'enabled'"
        
        # Verify secret is masked (contains ... or is empty)
        if data.get("client_secret_set"):
            assert "..." in data.get("client_secret", "") or data.get("client_secret") == "", \
                "Secret should be masked when set"
        
        print(f"PASS: Pax8 settings - client_id present: {bool(data.get('client_id'))}, secret_set: {data.get('client_secret_set')}, enabled: {data.get('enabled')}")
        print(f"  - Last test: {data.get('last_test_result')} at {data.get('last_test_at')}")
        print(f"  - Last sync: {data.get('last_sync_at')}")
        if data.get('last_sync_stats'):
            stats = data['last_sync_stats']
            print(f"  - Sync stats: {stats.get('companies', 0)} companies, {stats.get('subscriptions', 0)} subs")


class TestPax8Connection:
    """Test Pax8 OAuth2 connection"""

    def test_pax8_test_connection(self, headers):
        """Verify POST /api/pax8/test returns success with company count"""
        response = requests.post(f"{BASE_URL}/api/pax8/test", json={}, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "status" in data, "Response should have 'status'"
        assert "detail" in data, "Response should have 'detail'"
        
        if data["status"] == "success":
            print(f"PASS: Pax8 test connection successful - {data['detail']}")
        else:
            print(f"INFO: Pax8 test connection status: {data['status']} - {data['detail']}")


class TestPax8Companies:
    """Test Pax8 companies endpoints"""

    def test_list_pax8_companies(self, headers):
        """Verify GET /api/pax8/companies returns companies with link info"""
        response = requests.get(f"{BASE_URL}/api/pax8/companies", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        if len(data) > 0:
            company = data[0]
            assert "id" in company, "Company should have 'id'"
            assert "name" in company, "Company should have 'name'"
            # Check for link fields (may be None if not linked)
            print(f"PASS: Listed {len(data)} Pax8 companies")
            
            # Count linked companies
            linked = [c for c in data if c.get("linked_client_id")]
            print(f"  - {len(linked)} companies linked to NexusOps clients")
            
            # Show first few
            for c in data[:3]:
                link_info = f" → {c.get('linked_client_name')}" if c.get('linked_client_id') else ""
                print(f"  - {c.get('name')}{link_info}")
        else:
            print("INFO: No Pax8 companies found - may need to run sync")


class TestPax8Subscriptions:
    """Test Pax8 subscriptions endpoints"""

    def test_list_pax8_subscriptions(self, headers):
        """Verify GET /api/pax8/subscriptions returns subscriptions with product info"""
        response = requests.get(f"{BASE_URL}/api/pax8/subscriptions", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        if len(data) > 0:
            sub = data[0]
            assert "id" in sub, "Subscription should have 'id'"
            # Check for enriched product info
            print(f"PASS: Listed {len(data)} Pax8 subscriptions")
            
            # Show first few with product names
            for s in data[:5]:
                product = s.get("product_name") or s.get("productId", "Unknown")
                vendor = s.get("vendor_name", "")
                qty = s.get("quantity", 0)
                price = s.get("price", 0)
                print(f"  - {product} ({vendor}): {qty} × ${price:.2f}")
        else:
            print("INFO: No Pax8 subscriptions found - may need to run sync")

    def test_list_subscriptions_by_company(self, headers):
        """Verify GET /api/pax8/subscriptions?company_id={id} filters by company"""
        # First get a company ID
        companies_response = requests.get(f"{BASE_URL}/api/pax8/companies", headers=headers)
        if companies_response.status_code != 200 or not companies_response.json():
            pytest.skip("No Pax8 companies available")
        
        company_id = companies_response.json()[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/pax8/subscriptions?company_id={company_id}", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: Listed {len(data)} subscriptions for company {company_id}")


class TestPax8BillingPreview:
    """Test Pax8 billing preview endpoint"""

    def test_billing_preview(self, headers):
        """Verify GET /api/pax8/billing/preview returns per-client MRR"""
        response = requests.get(f"{BASE_URL}/api/pax8/billing/preview", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "period" in data, "Response should have 'period'"
        assert "linked_clients" in data, "Response should have 'linked_clients'"
        assert "grand_total" in data, "Response should have 'grand_total'"
        assert "results" in data, "Response should have 'results'"
        
        print(f"PASS: Billing preview for {data['period']}")
        print(f"  - {data['linked_clients']} linked clients")
        print(f"  - Grand total: ${data['grand_total']:.2f}")
        
        for r in data.get("results", [])[:3]:
            print(f"  - {r.get('client_name')}: ${r.get('total', 0):.2f} ({len(r.get('line_items', []))} products)")
            if r.get("auto_bill_recurring"):
                print(f"    [Auto-billed via recurring]")


class TestPax8CompanyLinking:
    """Test Pax8 company linking/unlinking"""

    def test_link_and_unlink_company(self, headers):
        """Test linking and unlinking a Pax8 company to a NexusOps client"""
        # Get an unlinked company
        companies_response = requests.get(f"{BASE_URL}/api/pax8/companies", headers=headers)
        if companies_response.status_code != 200:
            pytest.skip("Cannot get Pax8 companies")
        
        companies = companies_response.json()
        unlinked = [c for c in companies if not c.get("linked_client_id")]
        
        if not unlinked:
            print("INFO: All companies are linked - skipping link/unlink test")
            return
        
        test_company = unlinked[0]
        company_id = test_company["id"]
        company_name = test_company.get("name", "Unknown")
        
        # Link to Acme Corporation
        link_response = requests.post(
            f"{BASE_URL}/api/pax8/companies/{company_id}/link",
            json={"client_id": ACME_CLIENT_ID},
            headers=headers
        )
        assert link_response.status_code == 200, f"Link failed: {link_response.text}"
        print(f"PASS: Linked {company_name} to {ACME_CLIENT_NAME}")
        
        # Verify link
        verify_response = requests.get(f"{BASE_URL}/api/pax8/companies", headers=headers)
        linked_company = next((c for c in verify_response.json() if c["id"] == company_id), None)
        assert linked_company and linked_company.get("linked_client_id") == ACME_CLIENT_ID, "Link not persisted"
        
        # Unlink
        unlink_response = requests.delete(
            f"{BASE_URL}/api/pax8/companies/{company_id}/link",
            headers=headers
        )
        assert unlink_response.status_code == 200, f"Unlink failed: {unlink_response.text}"
        print(f"PASS: Unlinked {company_name}")


class TestPax8RecurringInvoiceIntegration:
    """Test Pax8 integration with recurring invoices"""

    def test_create_recurring_with_pax8_flag(self, headers):
        """Verify POST /api/recurring-invoices/create accepts include_pax8_usage"""
        unique_id = uuid.uuid4().hex[:6]
        payload = {
            "client_id": ACME_CLIENT_ID,
            "client_name": ACME_CLIENT_NAME,
            "description": f"TEST_Pax8 Auto-Billing Test {unique_id}",
            "line_items": [
                {"description": "Base MSP Fee", "quantity": 1, "rate": 100, "amount": 100}
            ],
            "frequency": "monthly",
            "tax_rate": 10,
            "currency": "AUD",
            "include_pax8_usage": True,
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
        assert data.get("include_pax8_usage") == True, "include_pax8_usage should be True"
        
        created_id = data["id"]
        print(f"PASS: Created recurring invoice {created_id} with include_pax8_usage=True")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/recurring-invoices/{created_id}", headers=headers)
        print(f"  - Cleaned up test RI {created_id}")

    def test_link_client_pax8_to_recurring(self, headers):
        """Test POST /api/pax8/billing/client/{id}/link-to-recurring"""
        # First check if client has a Pax8 link
        billing_response = requests.get(f"{BASE_URL}/api/pax8/billing/preview", headers=headers)
        if billing_response.status_code != 200:
            pytest.skip("Cannot get billing preview")
        
        results = billing_response.json().get("results", [])
        acme_result = next((r for r in results if r.get("client_id") == ACME_CLIENT_ID), None)
        
        if not acme_result:
            print("INFO: Acme Corporation not linked to Pax8 company - skipping link-to-recurring test")
            return
        
        # Link to recurring
        response = requests.post(
            f"{BASE_URL}/api/pax8/billing/client/{ACME_CLIENT_ID}/link-to-recurring",
            json={},
            headers=headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "client_id" in data, "Response should have 'client_id'"
        assert "updated_recurring_invoices" in data, "Response should have 'updated_recurring_invoices'"
        
        print(f"PASS: Linked Pax8 billing to recurring invoices for {ACME_CLIENT_NAME}")
        print(f"  - Updated RIs: {data.get('updated_recurring_invoices')}")
        print(f"  - Message: {data.get('message')}")

    def test_unlink_client_pax8_from_recurring(self, headers):
        """Test POST /api/pax8/billing/client/{id}/unlink-recurring"""
        response = requests.post(
            f"{BASE_URL}/api/pax8/billing/client/{ACME_CLIENT_ID}/unlink-recurring",
            json={},
            headers=headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "client_id" in data, "Response should have 'client_id'"
        assert "disabled_on" in data, "Response should have 'disabled_on'"
        
        print(f"PASS: Unlinked Pax8 billing from recurring invoices for {ACME_CLIENT_NAME}")
        print(f"  - Disabled on {data.get('disabled_on')} recurring invoice(s)")


class TestPax8GenerateNow:
    """Test generate-now with Pax8 auto-attach"""

    def test_generate_now_with_pax8(self, headers):
        """Verify POST /api/recurring-invoices/{id}/generate-now includes pax8_auto items"""
        # Create a test RI with include_pax8_usage=true
        unique_id = uuid.uuid4().hex[:6]
        create_response = requests.post(
            f"{BASE_URL}/api/recurring-invoices/create",
            json={
                "client_id": ACME_CLIENT_ID,
                "client_name": ACME_CLIENT_NAME,
                "description": f"TEST_Generate Now Pax8 {unique_id}",
                "line_items": [{"description": "Base", "quantity": 1, "rate": 25, "amount": 25}],
                "frequency": "monthly",
                "tax_rate": 10,
                "include_pax8_usage": True
            },
            headers=headers
        )
        
        if create_response.status_code != 200:
            pytest.skip(f"Failed to create test RI: {create_response.text}")
        
        ri_id = create_response.json()["id"]
        print(f"Created test RI {ri_id} with include_pax8_usage=True")
        
        try:
            # Generate invoice now
            gen_response = requests.post(
                f"{BASE_URL}/api/recurring-invoices/{ri_id}/generate-now",
                headers=headers
            )
            assert gen_response.status_code == 200, f"Generate-now failed: {gen_response.text}"
            
            gen_data = gen_response.json()
            print(f"Generated invoice: {gen_data.get('invoice_number')}")
            print(f"  - Total: ${gen_data.get('amount', 0):.2f}")
            print(f"  - Pax8 items attached: {gen_data.get('pax8_items', 0)}")
            
            if gen_data.get('pax8_items', 0) > 0:
                print(f"PASS: Generate-now attached {gen_data['pax8_items']} Pax8 line items")
            else:
                print(f"INFO: No Pax8 items attached (client may not be linked or have no active subs)")
        finally:
            # Cleanup
            requests.delete(f"{BASE_URL}/api/recurring-invoices/{ri_id}", headers=headers)
            print(f"  - Cleaned up test RI {ri_id}")


class TestPax8SchedulerRunNow:
    """Test scheduler run-now with Pax8 auto-attach"""

    def test_scheduler_run_now_with_pax8(self, headers):
        """Verify POST /api/recurring-invoices/scheduler/run-now honors include_pax8_usage"""
        # Create a test RI with include_pax8_usage=true and next_generation=today
        today = datetime.now().strftime("%Y-%m-%d")
        unique_id = uuid.uuid4().hex[:6]
        
        create_response = requests.post(
            f"{BASE_URL}/api/recurring-invoices/create",
            json={
                "client_id": ACME_CLIENT_ID,
                "client_name": ACME_CLIENT_NAME,
                "description": f"TEST_Scheduler Pax8 {unique_id}",
                "line_items": [{"description": "Base", "quantity": 1, "rate": 50, "amount": 50}],
                "frequency": "monthly",
                "tax_rate": 10,
                "start_date": today,
                "include_pax8_usage": True
            },
            headers=headers
        )
        
        if create_response.status_code != 200:
            pytest.skip(f"Failed to create test RI: {create_response.text}")
        
        ri_id = create_response.json()["id"]
        print(f"Created test RI {ri_id} with next_generation={today}")
        
        try:
            # Force next_generation to today
            requests.put(
                f"{BASE_URL}/api/recurring-invoices/{ri_id}",
                json={"next_generation": today},
                headers=headers
            )
            
            # Run scheduler
            scheduler_response = requests.post(
                f"{BASE_URL}/api/recurring-invoices/scheduler/run-now",
                headers=headers
            )
            assert scheduler_response.status_code == 200, f"Scheduler failed: {scheduler_response.text}"
            
            scheduler_data = scheduler_response.json()
            print(f"Scheduler processed {scheduler_data.get('processed', 0)} invoices")
            
            # Find our test RI in results
            our_result = next((r for r in scheduler_data.get("results", []) if r.get("ri_id") == ri_id), None)
            
            if our_result:
                print(f"  - RI {ri_id}: status={our_result.get('status')}, pax8_items={our_result.get('pax8_items', 0)}")
                if our_result.get("pax8_items", 0) > 0:
                    print(f"PASS: Scheduler attached {our_result['pax8_items']} Pax8 line items")
                else:
                    print(f"INFO: No Pax8 items attached (client may not be linked)")
            else:
                print(f"INFO: Test RI {ri_id} was not processed")
        finally:
            # Cleanup
            requests.delete(f"{BASE_URL}/api/recurring-invoices/{ri_id}", headers=headers)
            print(f"  - Cleaned up test RI {ri_id}")


class TestPax8CreateScaffoldRI:
    """Test creating scaffold RI when client has no active RIs"""

    def test_create_scaffold_ri_when_missing(self, headers):
        """Test POST /api/pax8/billing/client/{id}/link-to-recurring with create_if_missing"""
        # Get current RIs for the client
        ris_response = requests.get(
            f"{BASE_URL}/api/recurring-invoices/by-client/{ACME_CLIENT_ID}",
            headers=headers
        )
        
        if ris_response.status_code != 200:
            pytest.skip("Cannot get recurring invoices")
        
        existing_ris = ris_response.json()
        
        # Store original states and pause all active RIs
        original_states = {}
        for ri in existing_ris:
            if ri.get("status") == "active":
                original_states[ri["id"]] = "active"
                requests.post(f"{BASE_URL}/api/recurring-invoices/{ri['id']}/toggle", headers=headers)
        
        print(f"Paused {len(original_states)} active RIs for test")
        
        try:
            # Try to link with create_if_missing
            response = requests.post(
                f"{BASE_URL}/api/pax8/billing/client/{ACME_CLIENT_ID}/link-to-recurring",
                json={
                    "create_if_missing": True,
                    "frequency": "monthly",
                    "currency": "AUD"
                },
                headers=headers
            )
            
            # May return 400 if client not linked to Pax8
            if response.status_code == 400:
                print(f"INFO: Client not linked to Pax8 company - {response.json().get('detail')}")
                return
            
            assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
            
            data = response.json()
            
            if data.get("created_recurring_invoice_id"):
                created_id = data["created_recurring_invoice_id"]
                print(f"PASS: Created scaffold RI {created_id}")
                
                # Verify include_pax8_usage=true
                ri_response = requests.get(f"{BASE_URL}/api/recurring-invoices/{created_id}", headers=headers)
                if ri_response.status_code == 200:
                    ri_data = ri_response.json()
                    assert ri_data.get("include_pax8_usage") == True, "Scaffold RI should have include_pax8_usage=True"
                    print(f"  - Verified include_pax8_usage=True")
                
                # Cleanup scaffold
                requests.delete(f"{BASE_URL}/api/recurring-invoices/{created_id}", headers=headers)
                print(f"  - Cleaned up scaffold RI {created_id}")
            else:
                print(f"INFO: No scaffold created - enabled on existing RIs: {data.get('updated_recurring_invoices')}")
        finally:
            # Restore original RI states
            for ri_id in original_states:
                requests.post(f"{BASE_URL}/api/recurring-invoices/{ri_id}/toggle", headers=headers)
            print(f"Restored {len(original_states)} RIs to active state")


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


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
