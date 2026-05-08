"""
Iteration 156: Billing Reconciliation & Device Backup Plans Testing

Tests for:
1. GET /api/billing/reconcile-recurring/{ri_id} - Reconcile recurring invoice
2. PUT /api/billing/recurring/{ri_id}/line-items/{idx}/link-policy - Link line item to Acronis policy
3. GET /api/devices/{device_id}/acronis - Get device Acronis info (backup plans, activities)
4. PUT /api/devices/{device_id}/acronis-link - Link device to Acronis resource
"""

import pytest
import requests
import os

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
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def recurring_invoices(headers):
    """Get list of recurring invoices"""
    response = requests.get(f"{BASE_URL}/api/recurring-invoices/list", headers=headers)
    if response.status_code == 200:
        return response.json()
    return []


@pytest.fixture(scope="module")
def devices(headers):
    """Get list of devices"""
    response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
    if response.status_code == 200:
        return response.json()
    return []


@pytest.fixture(scope="module")
def acronis_policies(headers):
    """Get list of Acronis policies"""
    response = requests.get(f"{BASE_URL}/api/acronis/policies", headers=headers)
    if response.status_code == 200:
        data = response.json()
        return data.get("items", []) if isinstance(data, dict) else data
    return []


# ============ BILLING RECONCILE ENDPOINT TESTS ============

class TestBillingReconcileEndpoint:
    """Tests for GET /api/billing/reconcile-recurring/{ri_id}"""

    def test_reconcile_requires_auth(self):
        """Reconcile endpoint requires authentication"""
        response = requests.get(f"{BASE_URL}/api/billing/reconcile-recurring/test-id")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: Reconcile endpoint requires authentication")

    def test_reconcile_not_found(self, headers):
        """Reconcile returns 404 for non-existent invoice"""
        response = requests.get(f"{BASE_URL}/api/billing/reconcile-recurring/nonexistent-id-12345", headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Reconcile returns 404 for non-existent invoice")

    def test_reconcile_valid_invoice(self, headers, recurring_invoices):
        """Reconcile returns proper structure for valid invoice"""
        if not recurring_invoices:
            pytest.skip("No recurring invoices available")
        
        ri = recurring_invoices[0]
        ri_id = ri.get("id")
        response = requests.get(f"{BASE_URL}/api/billing/reconcile-recurring/{ri_id}", headers=headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "recurring_invoice_id" in data, "Missing recurring_invoice_id"
        assert data["recurring_invoice_id"] == ri_id, "Invoice ID mismatch"
        assert "summary" in data, "Missing summary"
        assert "line_items" in data, "Missing line_items"
        
        # Verify summary structure
        summary = data["summary"]
        assert "total_line_items" in summary, "Missing total_line_items in summary"
        assert "policy_linked" in summary, "Missing policy_linked in summary"
        assert "drift_count" in summary, "Missing drift_count in summary"
        assert "bill_shock_amount" in summary, "Missing bill_shock_amount in summary"
        
        print(f"PASS: Reconcile returns proper structure - {summary['total_line_items']} line items, {summary['policy_linked']} linked, drift_count={summary['drift_count']}, bill_shock={summary['bill_shock_amount']}")

    def test_reconcile_line_item_structure(self, headers, recurring_invoices):
        """Reconcile line items have correct structure"""
        if not recurring_invoices:
            pytest.skip("No recurring invoices available")
        
        ri = recurring_invoices[0]
        ri_id = ri.get("id")
        response = requests.get(f"{BASE_URL}/api/billing/reconcile-recurring/{ri_id}", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        line_items = data.get("line_items", [])
        
        if not line_items:
            pytest.skip("No line items in this invoice")
        
        li = line_items[0]
        required_fields = ["description", "quantity_billed", "unit_price", "policy_id", "policy_linked", 
                          "actual_count", "drift", "drift_severity", "bill_shock_amount", "mapped_devices"]
        
        for field in required_fields:
            assert field in li, f"Missing field: {field}"
        
        print(f"PASS: Line item has all required fields: {list(li.keys())}")


# ============ LINK POLICY ENDPOINT TESTS ============

class TestLinkPolicyEndpoint:
    """Tests for PUT /api/billing/recurring/{ri_id}/line-items/{idx}/link-policy"""

    def test_link_policy_requires_auth(self):
        """Link policy endpoint requires authentication"""
        response = requests.put(
            f"{BASE_URL}/api/billing/recurring/test-id/line-items/0/link-policy",
            json={"acronis_policy_id": "test"}
        )
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: Link policy endpoint requires authentication")

    def test_link_policy_not_found(self, headers):
        """Link policy returns 404 for non-existent invoice"""
        response = requests.put(
            f"{BASE_URL}/api/billing/recurring/nonexistent-id-12345/line-items/0/link-policy",
            json={"acronis_policy_id": "test"},
            headers=headers
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Link policy returns 404 for non-existent invoice")

    def test_link_policy_invalid_index(self, headers, recurring_invoices):
        """Link policy returns 400 for invalid line item index"""
        if not recurring_invoices:
            pytest.skip("No recurring invoices available")
        
        ri = recurring_invoices[0]
        ri_id = ri.get("id")
        
        # Try with very large index
        response = requests.put(
            f"{BASE_URL}/api/billing/recurring/{ri_id}/line-items/9999/link-policy",
            json={"acronis_policy_id": "test"},
            headers=headers
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        print("PASS: Link policy returns 400 for invalid index")

    def test_link_policy_negative_index(self, headers, recurring_invoices):
        """Link policy returns 400 for negative line item index"""
        if not recurring_invoices:
            pytest.skip("No recurring invoices available")
        
        ri = recurring_invoices[0]
        ri_id = ri.get("id")
        
        response = requests.put(
            f"{BASE_URL}/api/billing/recurring/{ri_id}/line-items/-1/link-policy",
            json={"acronis_policy_id": "test"},
            headers=headers
        )
        # Could be 400 or 422 depending on validation
        assert response.status_code in [400, 422], f"Expected 400/422, got {response.status_code}"
        print("PASS: Link policy handles negative index")

    def test_link_and_unlink_policy(self, headers, recurring_invoices, acronis_policies):
        """Link and unlink a policy to a line item"""
        if not recurring_invoices:
            pytest.skip("No recurring invoices available")
        if not acronis_policies:
            pytest.skip("No Acronis policies available")
        
        ri = recurring_invoices[0]
        ri_id = ri.get("id")
        line_items = ri.get("line_items", [])
        
        if not line_items:
            pytest.skip("No line items in this invoice")
        
        policy = acronis_policies[0]
        policy_id = policy.get("id")
        
        # Link policy
        response = requests.put(
            f"{BASE_URL}/api/billing/recurring/{ri_id}/line-items/0/link-policy",
            json={"acronis_policy_id": policy_id},
            headers=headers
        )
        assert response.status_code == 200, f"Link failed: {response.status_code} - {response.text}"
        data = response.json()
        assert "message" in data, "Missing message in response"
        assert data["message"] == "Linked", f"Expected 'Linked', got {data['message']}"
        print(f"PASS: Linked policy {policy_id} to line item 0")
        
        # Verify via reconcile
        reconcile_resp = requests.get(f"{BASE_URL}/api/billing/reconcile-recurring/{ri_id}", headers=headers)
        assert reconcile_resp.status_code == 200
        reconcile_data = reconcile_resp.json()
        li = reconcile_data["line_items"][0]
        assert li["policy_id"] == policy_id, f"Policy ID not set: {li['policy_id']}"
        assert li["policy_linked"] == True, "policy_linked should be True"
        print(f"PASS: Verified policy linked via reconcile - actual_count={li['actual_count']}, drift={li['drift']}")
        
        # Unlink policy
        response = requests.put(
            f"{BASE_URL}/api/billing/recurring/{ri_id}/line-items/0/link-policy",
            json={"acronis_policy_id": None},
            headers=headers
        )
        assert response.status_code == 200, f"Unlink failed: {response.status_code}"
        data = response.json()
        assert data["message"] == "Unlinked", f"Expected 'Unlinked', got {data['message']}"
        print("PASS: Unlinked policy from line item 0")


# ============ DEVICE ACRONIS INFO ENDPOINT TESTS ============

class TestDeviceAcronisInfoEndpoint:
    """Tests for GET /api/devices/{device_id}/acronis"""

    def test_device_acronis_requires_auth(self):
        """Device Acronis endpoint requires authentication"""
        response = requests.get(f"{BASE_URL}/api/devices/test-id/acronis")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: Device Acronis endpoint requires authentication")

    def test_device_acronis_not_found(self, headers):
        """Device Acronis returns 404 for non-existent device"""
        response = requests.get(f"{BASE_URL}/api/devices/nonexistent-device-12345/acronis", headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Device Acronis returns 404 for non-existent device")

    def test_device_acronis_valid_device(self, headers, devices):
        """Device Acronis returns proper structure for valid device"""
        if not devices:
            pytest.skip("No devices available")
        
        device = devices[0]
        device_id = device.get("id")
        response = requests.get(f"{BASE_URL}/api/devices/{device_id}/acronis", headers=headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "device_id" in data, "Missing device_id"
        assert data["device_id"] == device_id, "Device ID mismatch"
        assert "acronis_resource_id" in data, "Missing acronis_resource_id"
        assert "matched_by" in data, "Missing matched_by"
        assert data["matched_by"] in ["explicit", "name_match", "none"], f"Invalid matched_by: {data['matched_by']}"
        assert "applications" in data, "Missing applications"
        assert "recent_activities" in data, "Missing recent_activities"
        
        print(f"PASS: Device Acronis info - matched_by={data['matched_by']}, resource_id={data['acronis_resource_id']}, apps={len(data['applications'])}, activities={len(data['recent_activities'])}")

    def test_device_acronis_applications_structure(self, headers, devices):
        """Device Acronis applications have correct structure"""
        if not devices:
            pytest.skip("No devices available")
        
        # Find a device with acronis_resource_id
        device = None
        for d in devices:
            if d.get("acronis_resource_id") or d.get("acronis_id"):
                device = d
                break
        
        if not device:
            # Just use first device
            device = devices[0]
        
        device_id = device.get("id")
        response = requests.get(f"{BASE_URL}/api/devices/{device_id}/acronis", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        apps = data.get("applications", [])
        
        if not apps:
            print(f"PASS: Device has no applications (matched_by={data['matched_by']})")
            return
        
        app = apps[0]
        expected_fields = ["application_id", "policy_id", "policy_name", "policy_type", "enabled", "state"]
        for field in expected_fields:
            assert field in app, f"Missing field in application: {field}"
        
        print(f"PASS: Application structure correct - {len(apps)} apps, first: {app['policy_name']}")


# ============ DEVICE ACRONIS LINK ENDPOINT TESTS ============

class TestDeviceAcronisLinkEndpoint:
    """Tests for PUT /api/devices/{device_id}/acronis-link"""

    def test_device_link_requires_auth(self):
        """Device Acronis link endpoint requires authentication"""
        response = requests.put(
            f"{BASE_URL}/api/devices/test-id/acronis-link",
            json={"acronis_resource_id": "test"}
        )
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: Device Acronis link endpoint requires authentication")

    def test_device_link_not_found(self, headers):
        """Device Acronis link returns 404 for non-existent device"""
        response = requests.put(
            f"{BASE_URL}/api/devices/nonexistent-device-12345/acronis-link",
            json={"acronis_resource_id": "test"},
            headers=headers
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Device Acronis link returns 404 for non-existent device")

    def test_device_link_and_unlink(self, headers, devices):
        """Link and unlink Acronis resource to device"""
        if not devices:
            pytest.skip("No devices available")
        
        device = devices[0]
        device_id = device.get("id")
        original_resource_id = device.get("acronis_resource_id")
        
        test_resource_id = "TEST_RESOURCE_ID_12345"
        
        # Link
        response = requests.put(
            f"{BASE_URL}/api/devices/{device_id}/acronis-link",
            json={"acronis_resource_id": test_resource_id},
            headers=headers
        )
        assert response.status_code == 200, f"Link failed: {response.status_code} - {response.text}"
        data = response.json()
        assert data["message"] == "Linked", f"Expected 'Linked', got {data['message']}"
        assert data["acronis_resource_id"] == test_resource_id
        print(f"PASS: Linked device to resource {test_resource_id}")
        
        # Verify via GET
        verify_resp = requests.get(f"{BASE_URL}/api/devices/{device_id}/acronis", headers=headers)
        assert verify_resp.status_code == 200
        verify_data = verify_resp.json()
        assert verify_data["acronis_resource_id"] == test_resource_id
        assert verify_data["matched_by"] == "explicit"
        print("PASS: Verified link via GET - matched_by=explicit")
        
        # Restore original (unlink or restore)
        restore_id = original_resource_id if original_resource_id else None
        response = requests.put(
            f"{BASE_URL}/api/devices/{device_id}/acronis-link",
            json={"acronis_resource_id": restore_id},
            headers=headers
        )
        assert response.status_code == 200
        print(f"PASS: Restored original resource_id: {restore_id}")


# ============ REGRESSION TESTS ============

class TestRegressionRecurringInvoices:
    """Regression tests for existing recurring invoice functionality"""

    def test_list_recurring_invoices(self, headers):
        """List recurring invoices still works"""
        response = requests.get(f"{BASE_URL}/api/recurring-invoices/list", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        print(f"PASS: List recurring invoices - {len(data)} invoices")

    def test_recurring_invoices_stats(self, headers):
        """Recurring invoices stats still works"""
        response = requests.get(f"{BASE_URL}/api/recurring-invoices/stats", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "mrr" in data or "active" in data, "Expected stats fields"
        print(f"PASS: Recurring invoices stats - {data}")

    def test_toggle_recurring_invoice(self, headers, recurring_invoices):
        """Toggle recurring invoice still works"""
        if not recurring_invoices:
            pytest.skip("No recurring invoices available")
        
        ri = recurring_invoices[0]
        ri_id = ri.get("id")
        original_status = ri.get("status")
        
        # Toggle
        response = requests.post(f"{BASE_URL}/api/recurring-invoices/{ri_id}/toggle", headers=headers)
        assert response.status_code == 200, f"Toggle failed: {response.status_code}"
        data = response.json()
        new_status = data.get("status")
        print(f"PASS: Toggle recurring invoice - {original_status} -> {new_status}")
        
        # Toggle back
        response = requests.post(f"{BASE_URL}/api/recurring-invoices/{ri_id}/toggle", headers=headers)
        assert response.status_code == 200
        print("PASS: Toggled back")


class TestRegressionDevices:
    """Regression tests for existing device functionality"""

    def test_list_devices(self, headers):
        """List devices still works"""
        response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        print(f"PASS: List devices - {len(data)} devices")

    def test_device_detail(self, headers, devices):
        """Device detail still works"""
        if not devices:
            pytest.skip("No devices available")
        
        device = devices[0]
        device_id = device.get("id")
        response = requests.get(f"{BASE_URL}/api/devices/{device_id}/detail", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "device" in data, "Expected device in response"
        print(f"PASS: Device detail - {data['device'].get('name')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
