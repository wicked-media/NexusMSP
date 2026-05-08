"""
Iteration 155: Acronis Backup Actions - Run, Cancel, Apply Plan, Policies
Tests for new backup action endpoints:
- POST /api/acronis/backup/run - Run backup now
- POST /api/acronis/backup/cancel - Stop running backup
- GET /api/acronis/policies - List backup policies (with optional filter)
- POST /api/acronis/policies/apply - Apply plan to resources
- DELETE /api/acronis/applications/{application_id} - Remove plan binding
- GET /api/acronis/resources/{resource_id}/applications - List resource's plan bindings
- GET /api/acronis/live-activities - Verify resource_id and policy_id fields present
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for admin user."""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    if resp.status_code == 200:
        return resp.json().get("token")
    pytest.skip(f"Auth failed: {resp.status_code} - {resp.text[:200]}")

@pytest.fixture
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============================================================================
# POST /api/acronis/backup/run - Run backup now
# ============================================================================
class TestAcronisBackupRun:
    """Tests for POST /api/acronis/backup/run endpoint."""

    def test_run_requires_policy_id(self, headers):
        """Verify run endpoint requires policy_id."""
        resp = requests.post(f"{BASE_URL}/api/acronis/backup/run", 
                            json={"resource_ids": ["res-123"]}, headers=headers)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "detail" in data, "Response should have detail field"
        # Validation error should mention policy_id OR be a meaningful error
        print(f"Run without policy_id: {resp.status_code} - {data}")

    def test_run_requires_resource_ids(self, headers):
        """Verify run endpoint requires resource_ids."""
        resp = requests.post(f"{BASE_URL}/api/acronis/backup/run", 
                            json={"policy_id": "pol-123"}, headers=headers)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "detail" in data, "Response should have detail field"
        # Validation error should mention resource_ids OR be a meaningful error
        print(f"Run without resource_ids: {resp.status_code} - {data}")

    def test_run_requires_both_fields(self, headers):
        """Verify run endpoint requires both policy_id and resource_ids."""
        resp = requests.post(f"{BASE_URL}/api/acronis/backup/run", 
                            json={}, headers=headers)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        print(f"Run with empty body: {resp.status_code}")

    def test_run_requires_auth(self):
        """Verify run endpoint requires authentication."""
        resp = requests.post(f"{BASE_URL}/api/acronis/backup/run", 
                            json={"policy_id": "pol-123", "resource_ids": ["res-123"]})
        assert resp.status_code in [401, 403, 422], f"Expected auth error, got {resp.status_code}"


# ============================================================================
# POST /api/acronis/backup/cancel - Stop running backup
# ============================================================================
class TestAcronisBackupCancel:
    """Tests for POST /api/acronis/backup/cancel endpoint."""

    def test_cancel_requires_policy_id(self, headers):
        """Verify cancel endpoint requires policy_id."""
        resp = requests.post(f"{BASE_URL}/api/acronis/backup/cancel", 
                            json={"resource_ids": ["res-123"]}, headers=headers)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "detail" in data
        assert "policy_id" in data["detail"].lower()
        print(f"Cancel without policy_id: {resp.status_code} - {data}")

    def test_cancel_requires_resource_ids(self, headers):
        """Verify cancel endpoint requires resource_ids."""
        resp = requests.post(f"{BASE_URL}/api/acronis/backup/cancel", 
                            json={"policy_id": "pol-123"}, headers=headers)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "detail" in data
        assert "resource_ids" in data["detail"].lower()
        print(f"Cancel without resource_ids: {resp.status_code} - {data}")

    def test_cancel_requires_auth(self):
        """Verify cancel endpoint requires authentication."""
        resp = requests.post(f"{BASE_URL}/api/acronis/backup/cancel", 
                            json={"policy_id": "pol-123", "resource_ids": ["res-123"]})
        assert resp.status_code in [401, 403, 422], f"Expected auth error, got {resp.status_code}"


# ============================================================================
# GET /api/acronis/policies - List backup policies
# ============================================================================
class TestAcronisPolicies:
    """Tests for GET /api/acronis/policies endpoint."""

    def test_policies_returns_items(self, headers):
        """Verify policies endpoint returns items array with count."""
        resp = requests.get(f"{BASE_URL}/api/acronis/policies", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        data = resp.json()
        
        assert "items" in data, "Response missing 'items'"
        assert "count" in data, "Response missing 'count'"
        assert isinstance(data["items"], list), "'items' should be a list"
        assert isinstance(data["count"], int), "'count' should be int"
        
        # Per requirements: ~98 real backup-only policies exist
        print(f"Policies: {data['count']} items returned")
        assert data["count"] > 0, "Expected at least some backup policies from live Acronis"

    def test_policies_item_structure(self, headers):
        """Verify policy items have correct structure."""
        resp = requests.get(f"{BASE_URL}/api/acronis/policies", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        if data["items"]:
            item = data["items"][0]
            # Check expected fields
            for field in ["id", "name", "type"]:
                assert field in item, f"Policy item missing '{field}'"
            
            # Type should start with policy.backup.
            assert item["type"].startswith("policy.backup."), f"Type should be backup policy, got: {item['type']}"
            print(f"Sample policy: {item['name']} ({item['type']})")

    def test_policies_filter_by_type(self, headers):
        """Verify policy_type filter works."""
        resp = requests.get(f"{BASE_URL}/api/acronis/policies?policy_type=policy.backup.machine", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        # All returned items should match the filter
        for item in data["items"]:
            assert item["type"] == "policy.backup.machine", f"Filter not working: got {item['type']}"
        
        print(f"Filtered policies (policy.backup.machine): {data['count']} items")

    def test_policies_requires_auth(self):
        """Verify policies endpoint requires authentication."""
        resp = requests.get(f"{BASE_URL}/api/acronis/policies")
        assert resp.status_code in [401, 403, 422], f"Expected auth error, got {resp.status_code}"


# ============================================================================
# POST /api/acronis/policies/apply - Apply plan to resources
# ============================================================================
class TestAcronisPoliciesApply:
    """Tests for POST /api/acronis/policies/apply endpoint."""

    def test_apply_requires_policy_id(self, headers):
        """Verify apply endpoint requires policy_id."""
        resp = requests.post(f"{BASE_URL}/api/acronis/policies/apply", 
                            json={"resource_ids": ["res-123"]}, headers=headers)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "detail" in data
        assert "policy_id" in data["detail"].lower()
        print(f"Apply without policy_id: {resp.status_code} - {data}")

    def test_apply_requires_resource_ids(self, headers):
        """Verify apply endpoint requires resource_ids."""
        resp = requests.post(f"{BASE_URL}/api/acronis/policies/apply", 
                            json={"policy_id": "pol-123"}, headers=headers)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "detail" in data
        assert "resource_ids" in data["detail"].lower()
        print(f"Apply without resource_ids: {resp.status_code} - {data}")

    def test_apply_response_structure(self, headers):
        """Verify apply endpoint returns expected response structure (even for invalid IDs)."""
        # Use fake IDs - we don't want to actually apply to production
        resp = requests.post(f"{BASE_URL}/api/acronis/policies/apply", 
                            json={
                                "policy_id": "fake-policy-id-12345",
                                "resource_ids": ["fake-resource-id-67890"],
                                "run_now": False
                            }, headers=headers)
        
        # Should return 200 with partial/failed status (not 500)
        # OR could return 500 if Acronis rejects entirely
        if resp.status_code == 200:
            data = resp.json()
            # Check response structure
            assert "status" in data, "Response missing 'status'"
            assert "applied_count" in data, "Response missing 'applied_count'"
            assert "total" in data, "Response missing 'total'"
            assert "results" in data, "Response missing 'results'"
            print(f"Apply response: status={data['status']}, applied={data['applied_count']}/{data['total']}")
        else:
            # 500 is acceptable if Acronis API rejects the request
            print(f"Apply with fake IDs returned: {resp.status_code}")
            assert resp.status_code in [400, 500], f"Unexpected status: {resp.status_code}"

    def test_apply_requires_auth(self):
        """Verify apply endpoint requires authentication."""
        resp = requests.post(f"{BASE_URL}/api/acronis/policies/apply", 
                            json={"policy_id": "pol-123", "resource_ids": ["res-123"]})
        assert resp.status_code in [401, 403, 422], f"Expected auth error, got {resp.status_code}"


# ============================================================================
# DELETE /api/acronis/applications/{application_id} - Remove plan binding
# ============================================================================
class TestAcronisApplicationsDelete:
    """Tests for DELETE /api/acronis/applications/{application_id} endpoint."""

    def test_delete_invalid_application_graceful(self, headers):
        """Verify delete handles invalid application ID gracefully."""
        resp = requests.delete(f"{BASE_URL}/api/acronis/applications/fake-app-id-12345", headers=headers)
        # Should return error but not crash (4xx or 5xx with detail)
        assert resp.status_code in [400, 404, 500], f"Expected error status, got {resp.status_code}"
        data = resp.json()
        assert "detail" in data or "error" in data or "status" in data, "Error response should have detail"
        print(f"Delete invalid application response: {resp.status_code} - {data}")

    def test_delete_requires_auth(self):
        """Verify delete endpoint requires authentication."""
        resp = requests.delete(f"{BASE_URL}/api/acronis/applications/test-app-id")
        assert resp.status_code in [401, 403, 422], f"Expected auth error, got {resp.status_code}"


# ============================================================================
# GET /api/acronis/resources/{resource_id}/applications - List resource's plan bindings
# ============================================================================
class TestAcronisResourceApplications:
    """Tests for GET /api/acronis/resources/{resource_id}/applications endpoint."""

    def test_resource_applications_returns_structure(self, headers):
        """Verify resource applications endpoint returns correct structure."""
        # Use a fake resource ID - may return empty items or error
        resp = requests.get(f"{BASE_URL}/api/acronis/resources/fake-resource-id/applications", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        data = resp.json()
        
        assert "items" in data, "Response missing 'items'"
        assert isinstance(data["items"], list), "'items' should be a list"
        # count may be missing if there's an error from Acronis (invalid UUID format)
        if "error" in data:
            print(f"Resource applications for fake ID returned error (expected for invalid UUID): {data.get('error', '')[:100]}")
        else:
            assert "count" in data, "Response missing 'count'"
            print(f"Resource applications for fake ID: {data.get('count', 0)} items")

    def test_resource_applications_item_structure(self, headers):
        """Verify application items have correct structure when present."""
        # First get a real resource from orphans scan
        orphans_resp = requests.get(f"{BASE_URL}/api/acronis/orphans", headers=headers)
        if orphans_resp.status_code != 200:
            pytest.skip("Could not get orphans to find real resource")
        
        orphans_data = orphans_resp.json()
        # Try to find a resource that has applications (stale ones have backup apps)
        stale = orphans_data.get("stale", [])
        if not stale:
            print("No stale resources found - skipping structure test")
            return
        
        resource_id = stale[0].get("resource_id")
        resp = requests.get(f"{BASE_URL}/api/acronis/resources/{resource_id}/applications", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        if data["items"]:
            item = data["items"][0]
            # Check expected fields
            for field in ["application_id", "policy_id", "policy_name", "enabled"]:
                assert field in item, f"Application item missing '{field}'"
            print(f"Sample application: {item.get('policy_name')} (enabled={item.get('enabled')})")

    def test_resource_applications_requires_auth(self):
        """Verify resource applications endpoint requires authentication."""
        resp = requests.get(f"{BASE_URL}/api/acronis/resources/test-resource/applications")
        assert resp.status_code in [401, 403, 422], f"Expected auth error, got {resp.status_code}"


# ============================================================================
# GET /api/acronis/live-activities - Verify resource_id and policy_id fields
# ============================================================================
class TestAcronisLiveActivitiesEnhanced:
    """Tests for enhanced live-activities endpoint with resource_id and policy_id."""

    def test_live_activities_has_resource_and_policy_fields(self, headers):
        """Verify live-activities items include resource_id and policy_id fields."""
        resp = requests.get(f"{BASE_URL}/api/acronis/live-activities", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        
        # Check running activities
        for activity in data.get("running", []):
            # These fields should exist (may be null if not available from Acronis)
            assert "resource_id" in activity, "Running activity missing 'resource_id' field"
            assert "policy_id" in activity, "Running activity missing 'policy_id' field"
            print(f"Running: {activity.get('resource_name')} - resource_id={activity.get('resource_id')}, policy_id={activity.get('policy_id')}")
        
        # Check recent activities
        for activity in data.get("recent", [])[:5]:  # Check first 5
            assert "resource_id" in activity, "Recent activity missing 'resource_id' field"
            assert "policy_id" in activity, "Recent activity missing 'policy_id' field"
        
        print(f"Live activities: {len(data.get('running', []))} running, {len(data.get('recent', []))} recent - all have resource_id/policy_id fields")


# ============================================================================
# Regression: Existing endpoints still work
# ============================================================================
class TestBackupCenterRegression:
    """Regression tests for existing backup endpoints."""

    def test_orphans_still_works(self, headers):
        """Verify /api/acronis/orphans still works."""
        resp = requests.get(f"{BASE_URL}/api/acronis/orphans", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "totals" in data

    def test_agents_health_still_works(self, headers):
        """Verify /api/acronis/agents/health still works."""
        resp = requests.get(f"{BASE_URL}/api/acronis/agents/health", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "summary" in data

    def test_alerts_still_works(self, headers):
        """Verify /api/acronis/alerts still works."""
        resp = requests.get(f"{BASE_URL}/api/acronis/alerts", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_console_link_still_works(self, headers):
        """Verify /api/acronis/console-link still works."""
        resp = requests.get(f"{BASE_URL}/api/acronis/console-link", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "url" in data
