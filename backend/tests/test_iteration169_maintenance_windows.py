"""
Iteration 169: Maintenance Window Scheduler Tests
Tests for the new maintenance window feature that allows scheduling patch windows
for multiple devices with AI-summarized results.

Endpoints tested:
- POST /api/maintenance-windows - Create a maintenance window
- GET /api/maintenance-windows - List windows with optional status filter
- GET /api/maintenance-windows/{id} - Get window detail with runs
- GET /api/maintenance-windows/stats/summary - Stats summary (route collision test)
- POST /api/maintenance-windows/{id}/run-now - Trigger immediate execution
- DELETE /api/maintenance-windows/{id} - Cancel a scheduled window
"""

import pytest
import requests
import os
import time
from datetime import datetime, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token using admin credentials"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    data = response.json()
    return data["token"]

@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers for API requests"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}

@pytest.fixture(scope="module")
def test_devices(headers):
    """Get some device IDs for testing"""
    response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
    assert response.status_code == 200
    devices = response.json()
    # Return first 3 device IDs
    return [d["id"] for d in devices[:3]] if len(devices) >= 3 else [d["id"] for d in devices]

@pytest.fixture(scope="module")
def test_ticket(headers):
    """Get a ticket ID for parent_ticket_id testing"""
    response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
    assert response.status_code == 200
    tickets = response.json()
    return tickets[0]["id"] if tickets else None


class TestMaintenanceWindowValidation:
    """Test validation rules for maintenance window creation"""
    
    def test_create_window_empty_device_ids_returns_400(self, headers):
        """Empty device_ids should return 400"""
        response = requests.post(f"{BASE_URL}/api/maintenance-windows", headers=headers, json={
            "device_ids": [],
            "actions": ["install-patches"],
            "scheduled_at": (datetime.utcnow() + timedelta(hours=2)).isoformat()
        })
        assert response.status_code == 400
        assert "device_ids" in response.json().get("detail", "").lower()
    
    def test_create_window_invalid_action_returns_400(self, headers, test_devices):
        """Invalid action should return 400"""
        if not test_devices:
            pytest.skip("No devices available")
        response = requests.post(f"{BASE_URL}/api/maintenance-windows", headers=headers, json={
            "device_ids": test_devices[:1],
            "actions": ["invalid-action-xyz"],
            "scheduled_at": (datetime.utcnow() + timedelta(hours=2)).isoformat()
        })
        assert response.status_code == 400
        assert "invalid action" in response.json().get("detail", "").lower()
    
    def test_create_window_missing_scheduled_at_returns_400(self, headers, test_devices):
        """Missing scheduled_at should return 400"""
        if not test_devices:
            pytest.skip("No devices available")
        response = requests.post(f"{BASE_URL}/api/maintenance-windows", headers=headers, json={
            "device_ids": test_devices[:1],
            "actions": ["install-patches"]
        })
        assert response.status_code == 400
        assert "scheduled_at" in response.json().get("detail", "").lower()
    
    def test_create_window_bad_scheduled_at_format_returns_400(self, headers, test_devices):
        """Bad scheduled_at format should return 400"""
        if not test_devices:
            pytest.skip("No devices available")
        response = requests.post(f"{BASE_URL}/api/maintenance-windows", headers=headers, json={
            "device_ids": test_devices[:1],
            "actions": ["install-patches"],
            "scheduled_at": "not-a-date"
        })
        assert response.status_code == 400
    
    def test_create_window_over_200_devices_returns_400(self, headers):
        """More than 200 devices should return 400"""
        fake_ids = [f"fake-device-{i}" for i in range(201)]
        response = requests.post(f"{BASE_URL}/api/maintenance-windows", headers=headers, json={
            "device_ids": fake_ids,
            "actions": ["install-patches"],
            "scheduled_at": (datetime.utcnow() + timedelta(hours=2)).isoformat()
        })
        assert response.status_code == 400
        assert "200" in response.json().get("detail", "")


class TestMaintenanceWindowCRUD:
    """Test CRUD operations for maintenance windows"""
    
    def test_create_window_success(self, headers, test_devices):
        """Create a maintenance window successfully"""
        if not test_devices:
            pytest.skip("No devices available")
        
        scheduled_time = (datetime.utcnow() + timedelta(hours=8)).isoformat()
        response = requests.post(f"{BASE_URL}/api/maintenance-windows", headers=headers, json={
            "name": "TEST_Patch Window - Iteration 169",
            "description": "Test maintenance window for iteration 169 testing",
            "device_ids": test_devices,
            "actions": ["install-patches", "run-checks"],
            "scheduled_at": scheduled_time,
            "notify_clients": False
        })
        assert response.status_code == 200, f"Create failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "id" in data
        assert data["name"] == "TEST_Patch Window - Iteration 169"
        assert data["status"] == "scheduled"
        assert "devices_meta" in data
        assert len(data["devices_meta"]) == len(test_devices)
        assert set(data["actions"]) == {"install-patches", "run-checks"}
        
        # Store for cleanup
        TestMaintenanceWindowCRUD.created_window_id = data["id"]
    
    def test_list_windows(self, headers):
        """List maintenance windows"""
        response = requests.get(f"{BASE_URL}/api/maintenance-windows", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Should have at least the one we created
        assert len(data) >= 1
    
    def test_list_windows_with_status_filter(self, headers):
        """List windows with status filter"""
        response = requests.get(f"{BASE_URL}/api/maintenance-windows?status=scheduled", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # All returned should be scheduled
        for w in data:
            assert w["status"] == "scheduled"
    
    def test_list_windows_with_limit(self, headers):
        """List windows with limit parameter"""
        response = requests.get(f"{BASE_URL}/api/maintenance-windows?limit=5", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) <= 5
    
    def test_get_window_detail(self, headers):
        """Get window detail with runs array"""
        window_id = getattr(TestMaintenanceWindowCRUD, 'created_window_id', None)
        if not window_id:
            pytest.skip("No window created")
        
        response = requests.get(f"{BASE_URL}/api/maintenance-windows/{window_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert data["id"] == window_id
        assert "runs" in data
        assert isinstance(data["runs"], list)
        assert "devices_meta" in data
        assert "actions" in data
    
    def test_get_nonexistent_window_returns_404(self, headers):
        """Get non-existent window returns 404"""
        response = requests.get(f"{BASE_URL}/api/maintenance-windows/nonexistent-id-xyz", headers=headers)
        assert response.status_code == 404


class TestMaintenanceWindowStats:
    """Test stats endpoint - important for route collision testing"""
    
    def test_stats_summary_endpoint(self, headers):
        """Stats summary endpoint should work (no route collision with /{wid})"""
        response = requests.get(f"{BASE_URL}/api/maintenance-windows/stats/summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "counts" in data
        assert "upcoming" in data
        assert isinstance(data["counts"], dict)
        assert isinstance(data["upcoming"], list)
        
        # Counts should have status keys
        counts = data["counts"]
        # At least one status should be present if we have windows
        valid_statuses = {"scheduled", "running", "completed", "cancelled"}
        for status in counts.keys():
            assert status in valid_statuses


class TestMaintenanceWindowExecution:
    """Test window execution (run-now) and cancellation"""
    
    def test_run_now_triggers_execution(self, headers, test_devices):
        """Run-now should trigger immediate execution"""
        if not test_devices:
            pytest.skip("No devices available")
        
        # Create a new window for this test
        scheduled_time = (datetime.utcnow() + timedelta(hours=24)).isoformat()
        create_resp = requests.post(f"{BASE_URL}/api/maintenance-windows", headers=headers, json={
            "name": "TEST_Run Now Test - Iteration 169",
            "device_ids": test_devices[:2],
            "actions": ["run-checks"],
            "scheduled_at": scheduled_time
        })
        assert create_resp.status_code == 200
        window_id = create_resp.json()["id"]
        
        # Trigger run-now
        run_resp = requests.post(f"{BASE_URL}/api/maintenance-windows/{window_id}/run-now", headers=headers)
        assert run_resp.status_code == 200
        data = run_resp.json()
        assert data["success"] == True
        assert data["status"] == "running"
        
        # Wait for execution to complete (should be quick with mocked actions)
        time.sleep(3)
        
        # Check status - should be completed
        detail_resp = requests.get(f"{BASE_URL}/api/maintenance-windows/{window_id}", headers=headers)
        assert detail_resp.status_code == 200
        detail = detail_resp.json()
        
        # Status should be running or completed
        assert detail["status"] in ("running", "completed")
        
        # Store for later verification
        TestMaintenanceWindowExecution.executed_window_id = window_id
    
    def test_run_now_completed_window_returns_400(self, headers):
        """Running a completed window should return 400"""
        window_id = getattr(TestMaintenanceWindowExecution, 'executed_window_id', None)
        if not window_id:
            pytest.skip("No executed window available")
        
        # Wait a bit more for completion
        time.sleep(5)
        
        # Check if completed
        detail_resp = requests.get(f"{BASE_URL}/api/maintenance-windows/{window_id}", headers=headers)
        if detail_resp.json().get("status") != "completed":
            pytest.skip("Window not yet completed")
        
        # Try to run again
        run_resp = requests.post(f"{BASE_URL}/api/maintenance-windows/{window_id}/run-now", headers=headers)
        assert run_resp.status_code == 400
    
    def test_completed_window_has_summary_counts_and_ai_summary(self, headers):
        """Completed window should have summary_counts and ai_summary"""
        window_id = getattr(TestMaintenanceWindowExecution, 'executed_window_id', None)
        if not window_id:
            pytest.skip("No executed window available")
        
        # Wait for AI summary generation
        time.sleep(5)
        
        detail_resp = requests.get(f"{BASE_URL}/api/maintenance-windows/{window_id}", headers=headers)
        assert detail_resp.status_code == 200
        detail = detail_resp.json()
        
        if detail["status"] == "completed":
            assert "summary_counts" in detail
            assert "ai_summary" in detail
            assert isinstance(detail["summary_counts"], dict)
            # AI summary should be a non-empty string
            assert isinstance(detail["ai_summary"], str)
            assert len(detail["ai_summary"]) > 0
            
            # Runs should be populated
            assert len(detail["runs"]) > 0
            for run in detail["runs"]:
                assert "device_id" in run
                assert "action" in run
                assert "status" in run
    
    def test_cancel_scheduled_window(self, headers, test_devices):
        """Cancel a scheduled window"""
        if not test_devices:
            pytest.skip("No devices available")
        
        # Create a window to cancel
        scheduled_time = (datetime.utcnow() + timedelta(hours=48)).isoformat()
        create_resp = requests.post(f"{BASE_URL}/api/maintenance-windows", headers=headers, json={
            "name": "TEST_Cancel Test - Iteration 169",
            "device_ids": test_devices[:1],
            "actions": ["reboot"],
            "scheduled_at": scheduled_time
        })
        assert create_resp.status_code == 200
        window_id = create_resp.json()["id"]
        
        # Cancel it
        cancel_resp = requests.delete(f"{BASE_URL}/api/maintenance-windows/{window_id}", headers=headers)
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["success"] == True
        
        # Verify status changed
        detail_resp = requests.get(f"{BASE_URL}/api/maintenance-windows/{window_id}", headers=headers)
        assert detail_resp.status_code == 200
        assert detail_resp.json()["status"] == "cancelled"
    
    def test_cancel_completed_window_returns_400(self, headers):
        """Cancelling a completed window should return 400"""
        window_id = getattr(TestMaintenanceWindowExecution, 'executed_window_id', None)
        if not window_id:
            pytest.skip("No executed window available")
        
        # Wait for completion
        time.sleep(3)
        
        detail_resp = requests.get(f"{BASE_URL}/api/maintenance-windows/{window_id}", headers=headers)
        if detail_resp.json().get("status") != "completed":
            pytest.skip("Window not yet completed")
        
        cancel_resp = requests.delete(f"{BASE_URL}/api/maintenance-windows/{window_id}", headers=headers)
        assert cancel_resp.status_code == 400


class TestMaintenanceWindowParentTicket:
    """Test parent ticket integration"""
    
    def test_window_with_parent_ticket_posts_comment(self, headers, test_devices, test_ticket):
        """Window with parent_ticket_id should post comment on completion"""
        if not test_devices:
            pytest.skip("No devices available")
        if not test_ticket:
            pytest.skip("No ticket available")
        
        # Create window with parent ticket
        scheduled_time = (datetime.utcnow() + timedelta(hours=24)).isoformat()
        create_resp = requests.post(f"{BASE_URL}/api/maintenance-windows", headers=headers, json={
            "name": "TEST_Parent Ticket Test - Iteration 169",
            "device_ids": test_devices[:1],
            "actions": ["run-checks"],
            "scheduled_at": scheduled_time,
            "parent_ticket_id": test_ticket
        })
        assert create_resp.status_code == 200
        window_id = create_resp.json()["id"]
        
        # Verify parent_ticket_id is set
        detail_resp = requests.get(f"{BASE_URL}/api/maintenance-windows/{window_id}", headers=headers)
        assert detail_resp.json()["parent_ticket_id"] == test_ticket
        
        # Trigger run-now
        run_resp = requests.post(f"{BASE_URL}/api/maintenance-windows/{window_id}/run-now", headers=headers)
        assert run_resp.status_code == 200
        
        # Wait for completion and comment posting
        time.sleep(8)
        
        # Check ticket comments for maintenance_window kind
        # Note: This verifies the comment was posted by checking the ticket's comments
        comments_resp = requests.get(f"{BASE_URL}/api/tickets/{test_ticket}/comments", headers=headers)
        if comments_resp.status_code == 200:
            comments = comments_resp.json()
            mw_comments = [c for c in comments if c.get("kind") == "maintenance_window"]
            # Should have at least one maintenance_window comment
            assert len(mw_comments) >= 1, "Expected maintenance_window comment to be posted"
            
            # Verify comment content
            latest_mw_comment = mw_comments[-1]
            assert "Maintenance Window Completed" in latest_mw_comment.get("content", "")


class TestMaintenanceWindowAllActions:
    """Test all valid actions"""
    
    def test_all_valid_actions_accepted(self, headers, test_devices):
        """All valid actions should be accepted"""
        if not test_devices:
            pytest.skip("No devices available")
        
        valid_actions = ["run-checks", "install-patches", "reboot", "run-script"]
        
        for action in valid_actions:
            scheduled_time = (datetime.utcnow() + timedelta(hours=100)).isoformat()
            response = requests.post(f"{BASE_URL}/api/maintenance-windows", headers=headers, json={
                "name": f"TEST_Action Test {action}",
                "device_ids": test_devices[:1],
                "actions": [action],
                "scheduled_at": scheduled_time
            })
            assert response.status_code == 200, f"Action {action} should be valid: {response.text}"
            
            # Clean up - cancel the window
            window_id = response.json()["id"]
            requests.delete(f"{BASE_URL}/api/maintenance-windows/{window_id}", headers=headers)


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_windows(self, headers):
        """Clean up TEST_ prefixed windows"""
        response = requests.get(f"{BASE_URL}/api/maintenance-windows?limit=100", headers=headers)
        if response.status_code == 200:
            windows = response.json()
            for w in windows:
                if w.get("name", "").startswith("TEST_") and w.get("status") == "scheduled":
                    requests.delete(f"{BASE_URL}/api/maintenance-windows/{w['id']}", headers=headers)
