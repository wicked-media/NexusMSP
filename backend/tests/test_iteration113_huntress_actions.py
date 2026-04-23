"""
Iteration 113: Huntress Incident Response Actions Testing
Tests for:
- POST /api/huntress/incident-reports/{id}/action (close/resolve/assign/comment/acknowledge)
- POST /api/huntress/agents/{id}/isolate
- POST /api/huntress/agents/{id}/release
- GET /api/huntress/actions (audit log)
- Auth requirements (401/403 without token)
- 503 when Huntress not configured
- 400 for invalid action types
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"

# Huntress test credentials (will fail Huntress API but should return graceful fallback)
HUNTRESS_TEST_KEY = "test-key"
HUNTRESS_TEST_SECRET = "test-secret"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text[:200]}")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="function")
def setup_huntress_creds(headers):
    """Setup Huntress credentials before test, cleanup after"""
    # Save test credentials
    response = requests.post(f"{BASE_URL}/api/huntress/settings", json={
        "api_key": HUNTRESS_TEST_KEY,
        "secret_key": HUNTRESS_TEST_SECRET
    }, headers=headers)
    assert response.status_code == 200, f"Failed to save Huntress settings: {response.text}"
    
    yield
    
    # Cleanup - remove credentials
    requests.delete(f"{BASE_URL}/api/huntress/settings", headers=headers)


@pytest.fixture(scope="function")
def ensure_no_huntress_creds(headers):
    """Ensure Huntress is NOT configured"""
    requests.delete(f"{BASE_URL}/api/huntress/settings", headers=headers)
    yield
    # No cleanup needed


class TestHuntressActionEndpointsWithoutAuth:
    """Test that all action endpoints require authentication"""
    
    def test_incident_action_requires_auth(self):
        """POST /api/huntress/incident-reports/{id}/action without token returns 401/403"""
        response = requests.post(f"{BASE_URL}/api/huntress/incident-reports/INC-001/action", json={
            "action": "close",
            "note": "test"
        })
        assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"
    
    def test_agent_isolate_requires_auth(self):
        """POST /api/huntress/agents/{id}/isolate without token returns 401/403"""
        response = requests.post(f"{BASE_URL}/api/huntress/agents/agent-001/isolate", json={})
        assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"
    
    def test_agent_release_requires_auth(self):
        """POST /api/huntress/agents/{id}/release without token returns 401/403"""
        response = requests.post(f"{BASE_URL}/api/huntress/agents/agent-001/release", json={})
        assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"
    
    def test_actions_audit_requires_auth(self):
        """GET /api/huntress/actions without token returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/huntress/actions")
        assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"


class TestHuntressActionsNotConfigured:
    """Test action endpoints when Huntress is NOT configured - should return 503"""
    
    def test_incident_action_not_configured(self, headers, ensure_no_huntress_creds):
        """POST /api/huntress/incident-reports/{id}/action returns 503 when not configured"""
        response = requests.post(f"{BASE_URL}/api/huntress/incident-reports/INC-001/action", json={
            "action": "close",
            "note": "test"
        }, headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}: {response.text}"
        data = response.json()
        assert "not configured" in data.get("detail", "").lower(), f"Expected 'not configured' message, got: {data}"
    
    def test_agent_isolate_not_configured(self, headers, ensure_no_huntress_creds):
        """POST /api/huntress/agents/{id}/isolate returns 503 when not configured"""
        response = requests.post(f"{BASE_URL}/api/huntress/agents/agent-001/isolate", json={}, headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}: {response.text}"
        data = response.json()
        assert "not configured" in data.get("detail", "").lower()
    
    def test_agent_release_not_configured(self, headers, ensure_no_huntress_creds):
        """POST /api/huntress/agents/{id}/release returns 503 when not configured"""
        response = requests.post(f"{BASE_URL}/api/huntress/agents/agent-001/release", json={}, headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}: {response.text}"
        data = response.json()
        assert "not configured" in data.get("detail", "").lower()


class TestHuntressIncidentActions:
    """Test incident action endpoint with valid actions - expect graceful fallback"""
    
    def test_close_action_graceful_fallback(self, headers, setup_huntress_creds):
        """POST /api/huntress/incident-reports/{id}/action with action=close returns 200 with success:false"""
        response = requests.post(f"{BASE_URL}/api/huntress/incident-reports/INC-TEST-001/action", json={
            "action": "close",
            "note": "Closing incident for testing"
        }, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        # Huntress will reject with test creds - expect success:false with message
        assert "success" in data, f"Response missing 'success' field: {data}"
        assert data["success"] == False, f"Expected success:false (Huntress rejects test creds), got: {data}"
        assert "message" in data or "hint" in data, f"Expected message or hint in response: {data}"
    
    def test_resolve_action_graceful_fallback(self, headers, setup_huntress_creds):
        """POST /api/huntress/incident-reports/{id}/action with action=resolve returns 200 with success:false"""
        response = requests.post(f"{BASE_URL}/api/huntress/incident-reports/INC-TEST-002/action", json={
            "action": "resolve",
            "note": "Resolved for testing"
        }, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == False
    
    def test_assign_action_graceful_fallback(self, headers, setup_huntress_creds):
        """POST /api/huntress/incident-reports/{id}/action with action=assign returns 200 with success:false"""
        response = requests.post(f"{BASE_URL}/api/huntress/incident-reports/INC-TEST-003/action", json={
            "action": "assign",
            "assignee": "test@example.com"
        }, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == False
    
    def test_comment_action_graceful_fallback(self, headers, setup_huntress_creds):
        """POST /api/huntress/incident-reports/{id}/action with action=comment returns 200 with success:false"""
        response = requests.post(f"{BASE_URL}/api/huntress/incident-reports/INC-TEST-004/action", json={
            "action": "comment",
            "note": "Adding a test comment"
        }, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == False
    
    def test_acknowledge_action_graceful_fallback(self, headers, setup_huntress_creds):
        """POST /api/huntress/incident-reports/{id}/action with action=acknowledge returns 200 with success:false"""
        response = requests.post(f"{BASE_URL}/api/huntress/incident-reports/INC-TEST-005/action", json={
            "action": "acknowledge",
            "note": "Acknowledged for testing"
        }, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == False


class TestHuntressInvalidActions:
    """Test that invalid action types return 400"""
    
    def test_invalid_action_returns_400(self, headers, setup_huntress_creds):
        """POST /api/huntress/incident-reports/{id}/action with invalid action returns 400"""
        response = requests.post(f"{BASE_URL}/api/huntress/incident-reports/INC-TEST/action", json={
            "action": "invalid_action",
            "note": "test"
        }, headers=headers)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        data = response.json()
        assert "close|resolve|assign|comment|acknowledge" in data.get("detail", "").lower() or "action must be" in data.get("detail", "").lower()
    
    def test_empty_action_returns_400(self, headers, setup_huntress_creds):
        """POST /api/huntress/incident-reports/{id}/action with empty action returns 400"""
        response = requests.post(f"{BASE_URL}/api/huntress/incident-reports/INC-TEST/action", json={
            "action": "",
            "note": "test"
        }, headers=headers)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
    
    def test_delete_action_returns_400(self, headers, setup_huntress_creds):
        """POST /api/huntress/incident-reports/{id}/action with action=delete returns 400"""
        response = requests.post(f"{BASE_URL}/api/huntress/incident-reports/INC-TEST/action", json={
            "action": "delete",
            "note": "test"
        }, headers=headers)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"


class TestHuntressAgentActions:
    """Test agent isolate/release endpoints - expect graceful fallback"""
    
    def test_isolate_agent_graceful_fallback(self, headers, setup_huntress_creds):
        """POST /api/huntress/agents/{id}/isolate returns 200 with success:false"""
        response = requests.post(f"{BASE_URL}/api/huntress/agents/agent-test-001/isolate", json={
            "note": "Isolating for testing"
        }, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "success" in data, f"Response missing 'success' field: {data}"
        assert data["success"] == False, f"Expected success:false (Huntress rejects test creds), got: {data}"
        # Should have status_code or message
        assert "status_code" in data or "message" in data, f"Expected status_code or message: {data}"
    
    def test_release_agent_graceful_fallback(self, headers, setup_huntress_creds):
        """POST /api/huntress/agents/{id}/release returns 200 with success:false"""
        response = requests.post(f"{BASE_URL}/api/huntress/agents/agent-test-002/release", json={
            "note": "Releasing for testing"
        }, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == False


class TestHuntressActionsAuditLog:
    """Test the audit log endpoint"""
    
    def test_actions_audit_log_returns_list(self, headers, setup_huntress_creds):
        """GET /api/huntress/actions returns list of action attempts"""
        # First, perform an action to ensure there's data
        requests.post(f"{BASE_URL}/api/huntress/incident-reports/INC-AUDIT-TEST/action", json={
            "action": "acknowledge",
            "note": "Audit test"
        }, headers=headers)
        
        # Now fetch the audit log
        response = requests.get(f"{BASE_URL}/api/huntress/actions?limit=10", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got: {type(data)}"
        
        # Should have at least one entry
        assert len(data) > 0, "Expected at least one audit entry"
        
        # Check structure of first entry
        entry = data[0]
        assert "timestamp" in entry, f"Entry missing timestamp: {entry}"
        assert "action" in entry or "incident_id" in entry or "agent_id" in entry, f"Entry missing action/incident_id/agent_id: {entry}"
    
    def test_actions_audit_sorted_desc(self, headers, setup_huntress_creds):
        """GET /api/huntress/actions returns entries sorted by timestamp desc"""
        response = requests.get(f"{BASE_URL}/api/huntress/actions?limit=20", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        if len(data) >= 2:
            # Check that timestamps are in descending order
            timestamps = [entry.get("timestamp", "") for entry in data]
            assert timestamps == sorted(timestamps, reverse=True), "Audit log not sorted by timestamp desc"
    
    def test_actions_audit_persists_incident_action(self, headers, setup_huntress_creds):
        """Verify incident action is persisted to audit log"""
        unique_id = f"INC-PERSIST-{int(time.time())}"
        
        # Perform action
        requests.post(f"{BASE_URL}/api/huntress/incident-reports/{unique_id}/action", json={
            "action": "close",
            "note": "Persistence test"
        }, headers=headers)
        
        # Fetch audit log
        response = requests.get(f"{BASE_URL}/api/huntress/actions?limit=50", headers=headers)
        data = response.json()
        
        # Find our entry
        found = any(entry.get("incident_id") == unique_id for entry in data)
        assert found, f"Action for {unique_id} not found in audit log"
    
    def test_actions_audit_persists_agent_action(self, headers, setup_huntress_creds):
        """Verify agent isolate/release is persisted to audit log"""
        unique_id = f"agent-persist-{int(time.time())}"
        
        # Perform isolate action
        requests.post(f"{BASE_URL}/api/huntress/agents/{unique_id}/isolate", json={}, headers=headers)
        
        # Fetch audit log
        response = requests.get(f"{BASE_URL}/api/huntress/actions?limit=50", headers=headers)
        data = response.json()
        
        # Find our entry
        found = any(entry.get("agent_id") == unique_id for entry in data)
        assert found, f"Isolate action for {unique_id} not found in audit log"


class TestHuntressActionsResponseShape:
    """Test the response shape of action endpoints"""
    
    def test_incident_action_response_has_required_fields(self, headers, setup_huntress_creds):
        """Incident action response should have success, message/hint fields"""
        response = requests.post(f"{BASE_URL}/api/huntress/incident-reports/INC-SHAPE-TEST/action", json={
            "action": "close",
            "note": "Shape test"
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Must have success field
        assert "success" in data, f"Missing 'success' field: {data}"
        
        # When success is false, should have message or hint
        if not data["success"]:
            assert "message" in data or "hint" in data, f"Failed response missing message/hint: {data}"
    
    def test_agent_isolate_response_has_required_fields(self, headers, setup_huntress_creds):
        """Agent isolate response should have success, status_code/message fields"""
        response = requests.post(f"{BASE_URL}/api/huntress/agents/agent-shape-test/isolate", json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "success" in data, f"Missing 'success' field: {data}"
        if not data["success"]:
            assert "status_code" in data or "message" in data, f"Failed response missing status_code/message: {data}"


class TestHuntressSettingsCleanup:
    """Cleanup test - ensure settings can be removed"""
    
    def test_cleanup_huntress_settings(self, headers):
        """DELETE /api/huntress/settings removes credentials"""
        response = requests.delete(f"{BASE_URL}/api/huntress/settings", headers=headers)
        assert response.status_code == 200
        
        # Verify not configured
        status_response = requests.get(f"{BASE_URL}/api/huntress/status", headers=headers)
        assert status_response.status_code == 200
        assert status_response.json().get("configured") == False
