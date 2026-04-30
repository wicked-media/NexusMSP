"""
Iteration 128: TRMM Scheduled Broadcasts Tests
Tests for scheduled TRMM broadcasts - queue commands/scripts for future execution
with optional repeat (daily/weekly).

Endpoints tested:
- POST /api/trmm/scheduled-broadcasts (create scheduled broadcast)
- GET /api/trmm/scheduled-broadcasts (list pending)
- GET /api/trmm/scheduled-broadcasts/{id} (get single)
- DELETE /api/trmm/scheduled-broadcasts/{id} (cancel)
- Scheduler loop execution (execute_due_scheduled_broadcasts)
"""

import pytest
import requests
import os
import time
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestTrmmScheduledBroadcastsAuth:
    """Auth tests - all endpoints require authentication"""

    def test_create_scheduled_broadcast_requires_auth(self):
        """POST /api/trmm/scheduled-broadcasts requires auth"""
        response = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", json={})
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: POST /api/trmm/scheduled-broadcasts requires auth ({response.status_code})")

    def test_list_scheduled_broadcasts_requires_auth(self):
        """GET /api/trmm/scheduled-broadcasts requires auth"""
        response = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: GET /api/trmm/scheduled-broadcasts requires auth ({response.status_code})")

    def test_get_scheduled_broadcast_requires_auth(self):
        """GET /api/trmm/scheduled-broadcasts/{id} requires auth"""
        response = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts/sched-test123")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: GET /api/trmm/scheduled-broadcasts/{id} requires auth ({response.status_code})")

    def test_cancel_scheduled_broadcast_requires_auth(self):
        """DELETE /api/trmm/scheduled-broadcasts/{id} requires auth"""
        response = requests.delete(f"{BASE_URL}/api/trmm/scheduled-broadcasts/sched-test123")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: DELETE /api/trmm/scheduled-broadcasts/{id} requires auth ({response.status_code})")


class TestTrmmScheduledBroadcastsValidation:
    """Validation tests - 400/503 errors for invalid input"""

    @pytest.fixture(autouse=True)
    def setup(self, auth_token, cleanup_trmm_settings):
        """Setup for each test"""
        self.token = auth_token
        self.headers = {"Authorization": f"Bearer {auth_token}"}

    def test_503_when_trmm_not_configured(self, auth_token):
        """POST /api/trmm/scheduled-broadcasts returns 503 when TRMM not configured"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        # First ensure TRMM is not configured
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=headers)
        
        run_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        response = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["agent-1"],
            "command": "echo test",
            "run_at": run_at
        })
        assert response.status_code == 503, f"Expected 503, got {response.status_code}: {response.text}"
        print("PASS: POST /api/trmm/scheduled-broadcasts returns 503 when TRMM not configured")

    def test_400_missing_agent_ids(self, auth_token, setup_dummy_trmm):
        """POST /api/trmm/scheduled-broadcasts returns 400 for missing agent_ids"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        run_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        response = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "command": "echo test",
            "run_at": run_at
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        assert "agent_ids" in response.text.lower()
        print("PASS: POST /api/trmm/scheduled-broadcasts returns 400 for missing agent_ids")

    def test_400_empty_agent_ids(self, auth_token, setup_dummy_trmm):
        """POST /api/trmm/scheduled-broadcasts returns 400 for empty agent_ids"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        run_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        response = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": [],
            "command": "echo test",
            "run_at": run_at
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        print("PASS: POST /api/trmm/scheduled-broadcasts returns 400 for empty agent_ids")

    def test_400_missing_command_and_script_id(self, auth_token, setup_dummy_trmm):
        """POST /api/trmm/scheduled-broadcasts returns 400 for missing command AND script_id"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        run_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        response = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["agent-1"],
            "run_at": run_at
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        assert "command" in response.text.lower() or "script" in response.text.lower()
        print("PASS: POST /api/trmm/scheduled-broadcasts returns 400 for missing command AND script_id")

    def test_400_missing_run_at(self, auth_token, setup_dummy_trmm):
        """POST /api/trmm/scheduled-broadcasts returns 400 for missing run_at"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["agent-1"],
            "command": "echo test"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        assert "run_at" in response.text.lower()
        print("PASS: POST /api/trmm/scheduled-broadcasts returns 400 for missing run_at")

    def test_400_invalid_run_at_format(self, auth_token, setup_dummy_trmm):
        """POST /api/trmm/scheduled-broadcasts returns 400 for invalid run_at (bad ISO)"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["agent-1"],
            "command": "echo test",
            "run_at": "not-a-valid-date"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        assert "iso" in response.text.lower() or "datetime" in response.text.lower()
        print("PASS: POST /api/trmm/scheduled-broadcasts returns 400 for invalid run_at (bad ISO)")

    def test_400_invalid_repeat_value(self, auth_token, setup_dummy_trmm):
        """POST /api/trmm/scheduled-broadcasts returns 400 for repeat not in (once|daily|weekly)"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        run_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        response = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["agent-1"],
            "command": "echo test",
            "run_at": run_at,
            "repeat": "monthly"  # Invalid
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        assert "repeat" in response.text.lower() or "once" in response.text.lower()
        print("PASS: POST /api/trmm/scheduled-broadcasts returns 400 for repeat not in (once|daily|weekly)")

    def test_400_too_many_agents(self, auth_token, setup_dummy_trmm):
        """POST /api/trmm/scheduled-broadcasts returns 400 when agent_ids > 200"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        run_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        agent_ids = [f"agent-{i}" for i in range(201)]  # 201 agents
        response = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": agent_ids,
            "command": "echo test",
            "run_at": run_at
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        assert "200" in response.text or "many" in response.text.lower()
        print("PASS: POST /api/trmm/scheduled-broadcasts returns 400 when agent_ids > 200")


class TestTrmmScheduledBroadcastsCRUD:
    """CRUD tests for scheduled broadcasts"""

    def test_create_scheduled_broadcast_success(self, auth_token, setup_dummy_trmm, cleanup_scheduled_broadcasts):
        """POST /api/trmm/scheduled-broadcasts success returns {success:true, id:'sched-...', run_at, repeat}"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        run_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        response = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["TEST_agent-1", "TEST_agent-2"],
            "command": "echo TEST scheduled broadcast",
            "run_at": run_at,
            "repeat": "once",
            "label": "TEST_scheduled_broadcast"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") is True
        assert data.get("id", "").startswith("sched-")
        assert "run_at" in data
        assert data.get("repeat") == "once"
        print(f"PASS: POST /api/trmm/scheduled-broadcasts success returns {{success:true, id:'{data['id']}', run_at, repeat}}")
        return data["id"]

    def test_create_scheduled_broadcast_with_script_id(self, auth_token, setup_dummy_trmm, cleanup_scheduled_broadcasts):
        """POST /api/trmm/scheduled-broadcasts with script_id instead of command"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        run_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        response = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["TEST_agent-1"],
            "script_id": 123,
            "run_at": run_at,
            "repeat": "daily",
            "label": "TEST_script_scheduled"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") is True
        assert data.get("repeat") == "daily"
        print("PASS: POST /api/trmm/scheduled-broadcasts with script_id instead of command")

    def test_create_scheduled_broadcast_weekly_repeat(self, auth_token, setup_dummy_trmm, cleanup_scheduled_broadcasts):
        """POST /api/trmm/scheduled-broadcasts with repeat=weekly"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        run_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        response = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["TEST_agent-1"],
            "command": "echo weekly test",
            "run_at": run_at,
            "repeat": "weekly",
            "label": "TEST_weekly_scheduled"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") is True
        assert data.get("repeat") == "weekly"
        print("PASS: POST /api/trmm/scheduled-broadcasts with repeat=weekly")

    def test_list_scheduled_broadcasts_pending(self, auth_token, setup_dummy_trmm, cleanup_scheduled_broadcasts):
        """GET /api/trmm/scheduled-broadcasts returns pending scheduled items, sorted by run_at ASC"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Create two scheduled broadcasts with different run_at times
        run_at_1 = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        run_at_2 = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()  # Earlier
        
        requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["TEST_agent-1"],
            "command": "echo test 1",
            "run_at": run_at_1,
            "label": "TEST_list_1"
        })
        requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["TEST_agent-2"],
            "command": "echo test 2",
            "run_at": run_at_2,
            "label": "TEST_list_2"
        })
        
        response = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        
        # Filter to our test items
        test_items = [d for d in data if d.get("label", "").startswith("TEST_list_")]
        assert len(test_items) >= 2, f"Expected at least 2 test items, got {len(test_items)}"
        
        # Verify sorted by run_at ASC (earlier first)
        if len(test_items) >= 2:
            # The one with run_at_2 (earlier) should come first
            assert test_items[0]["label"] == "TEST_list_2", "Expected earlier run_at to be first"
        
        print("PASS: GET /api/trmm/scheduled-broadcasts returns pending scheduled items, sorted by run_at ASC")

    def test_list_scheduled_broadcasts_include_completed(self, auth_token, setup_dummy_trmm, cleanup_scheduled_broadcasts):
        """GET /api/trmm/scheduled-broadcasts?include_completed=true also shows completed/cancelled"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Create and cancel a scheduled broadcast
        run_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        create_resp = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["TEST_agent-1"],
            "command": "echo test cancelled",
            "run_at": run_at,
            "label": "TEST_cancelled_item"
        })
        sched_id = create_resp.json().get("id")
        
        # Cancel it
        requests.delete(f"{BASE_URL}/api/trmm/scheduled-broadcasts/{sched_id}", headers=headers)
        
        # List without include_completed - should NOT include cancelled
        response = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers)
        data = response.json()
        cancelled_in_list = [d for d in data if d.get("id") == sched_id]
        assert len(cancelled_in_list) == 0, "Cancelled item should not appear in default list"
        
        # List with include_completed=true - should include cancelled
        response = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts?include_completed=true", headers=headers)
        data = response.json()
        cancelled_in_list = [d for d in data if d.get("id") == sched_id]
        assert len(cancelled_in_list) == 1, "Cancelled item should appear with include_completed=true"
        assert cancelled_in_list[0].get("status") == "cancelled"
        
        print("PASS: GET /api/trmm/scheduled-broadcasts?include_completed=true also shows completed/cancelled")

    def test_get_scheduled_broadcast_by_id(self, auth_token, setup_dummy_trmm, cleanup_scheduled_broadcasts):
        """GET /api/trmm/scheduled-broadcasts/{id} returns full doc"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        run_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        
        create_resp = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["TEST_agent-1", "TEST_agent-2"],
            "command": "echo test get by id",
            "run_at": run_at,
            "repeat": "daily",
            "label": "TEST_get_by_id"
        })
        sched_id = create_resp.json().get("id")
        
        response = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts/{sched_id}", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert data.get("id") == sched_id
        assert data.get("agent_ids") == ["TEST_agent-1", "TEST_agent-2"]
        assert data.get("command") == "echo test get by id"
        assert data.get("repeat") == "daily"
        assert data.get("status") == "pending"
        assert data.get("runs_count") == 0
        
        print("PASS: GET /api/trmm/scheduled-broadcasts/{id} returns full doc")

    def test_get_scheduled_broadcast_404_for_bogus_id(self, auth_token, setup_dummy_trmm):
        """GET /api/trmm/scheduled-broadcasts/{id} returns 404 for bogus id"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts/sched-bogus-nonexistent", headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        print("PASS: GET /api/trmm/scheduled-broadcasts/{id} returns 404 for bogus id")

    def test_cancel_scheduled_broadcast(self, auth_token, setup_dummy_trmm, cleanup_scheduled_broadcasts):
        """DELETE /api/trmm/scheduled-broadcasts/{id} cancels pending item (status=cancelled)"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        run_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        
        create_resp = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["TEST_agent-1"],
            "command": "echo test cancel",
            "run_at": run_at,
            "label": "TEST_cancel_item"
        })
        sched_id = create_resp.json().get("id")
        
        # Cancel it
        response = requests.delete(f"{BASE_URL}/api/trmm/scheduled-broadcasts/{sched_id}", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") is True
        
        # Verify status is cancelled
        get_resp = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts/{sched_id}", headers=headers)
        assert get_resp.json().get("status") == "cancelled"
        
        print("PASS: DELETE /api/trmm/scheduled-broadcasts/{id} cancels pending item (status=cancelled)")

    def test_cancel_already_cancelled_returns_404(self, auth_token, setup_dummy_trmm, cleanup_scheduled_broadcasts):
        """DELETE /api/trmm/scheduled-broadcasts/{id} returns 404 for already-cancelled"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        run_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        
        create_resp = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["TEST_agent-1"],
            "command": "echo test double cancel",
            "run_at": run_at,
            "label": "TEST_double_cancel"
        })
        sched_id = create_resp.json().get("id")
        
        # Cancel it first time
        requests.delete(f"{BASE_URL}/api/trmm/scheduled-broadcasts/{sched_id}", headers=headers)
        
        # Try to cancel again
        response = requests.delete(f"{BASE_URL}/api/trmm/scheduled-broadcasts/{sched_id}", headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        
        print("PASS: DELETE /api/trmm/scheduled-broadcasts/{id} returns 404 for already-cancelled")

    def test_cancel_bogus_id_returns_404(self, auth_token, setup_dummy_trmm):
        """DELETE /api/trmm/scheduled-broadcasts/{id} returns 404 for bogus id"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.delete(f"{BASE_URL}/api/trmm/scheduled-broadcasts/sched-bogus-nonexistent", headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        print("PASS: DELETE /api/trmm/scheduled-broadcasts/{id} returns 404 for bogus id")


class TestTrmmSchedulerLoop:
    """End-to-end scheduler loop tests"""

    def test_scheduler_loop_once_repeat(self, auth_token, setup_dummy_trmm, cleanup_scheduled_broadcasts, cleanup_broadcasts):
        """E2E: create schedule with run_at=5s in past, wait ~35s, verify status='completed' for repeat=once"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Create a schedule with run_at in the past (5 seconds ago)
        run_at = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
        create_resp = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["TEST_scheduler_agent_1"],
            "command": "echo TEST scheduler loop once",
            "run_at": run_at,
            "repeat": "once",
            "label": "TEST_scheduler_once"
        })
        assert create_resp.status_code == 200, f"Failed to create: {create_resp.text}"
        sched_id = create_resp.json().get("id")
        print(f"Created scheduled broadcast {sched_id} with run_at in past")
        
        # Wait for scheduler loop to pick it up (runs every 30s, with 20s initial delay)
        print("Waiting 35 seconds for scheduler loop...")
        time.sleep(35)
        
        # Check the scheduled broadcast status
        get_resp = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts/{sched_id}", headers=headers)
        assert get_resp.status_code == 200, f"Failed to get: {get_resp.text}"
        data = get_resp.json()
        
        assert data.get("status") == "completed", f"Expected status='completed', got '{data.get('status')}'"
        assert data.get("runs_count") == 1, f"Expected runs_count=1, got {data.get('runs_count')}"
        assert data.get("last_broadcast_id") is not None, "Expected last_broadcast_id to be set"
        assert data.get("last_broadcast_id", "").startswith("bcast-"), f"Expected last_broadcast_id to start with 'bcast-', got '{data.get('last_broadcast_id')}'"
        
        # Verify the broadcast doc exists
        bcast_id = data.get("last_broadcast_id")
        bcast_resp = requests.get(f"{BASE_URL}/api/trmm/broadcasts/{bcast_id}", headers=headers)
        assert bcast_resp.status_code == 200, f"Broadcast doc not found: {bcast_resp.text}"
        bcast_data = bcast_resp.json()
        assert bcast_data.get("scheduled_id") == sched_id, "Broadcast should reference scheduled_id"
        
        print(f"PASS: E2E scheduler loop test (once): status='completed', runs_count=1, last_broadcast_id='{bcast_id}'")

    def test_scheduler_loop_daily_repeat(self, auth_token, setup_dummy_trmm, cleanup_scheduled_broadcasts, cleanup_broadcasts):
        """E2E: create schedule with run_at=5s in past + repeat=daily, wait ~35s, verify status stays 'pending' but run_at bumped +24h"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Create a schedule with run_at in the past (5 seconds ago) and repeat=daily
        original_run_at = datetime.now(timezone.utc) - timedelta(seconds=5)
        create_resp = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["TEST_scheduler_agent_2"],
            "command": "echo TEST scheduler loop daily",
            "run_at": original_run_at.isoformat(),
            "repeat": "daily",
            "label": "TEST_scheduler_daily"
        })
        assert create_resp.status_code == 200, f"Failed to create: {create_resp.text}"
        sched_id = create_resp.json().get("id")
        print(f"Created scheduled broadcast {sched_id} with run_at in past, repeat=daily")
        
        # Wait for scheduler loop to pick it up
        print("Waiting 35 seconds for scheduler loop...")
        time.sleep(35)
        
        # Check the scheduled broadcast status
        get_resp = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts/{sched_id}", headers=headers)
        assert get_resp.status_code == 200, f"Failed to get: {get_resp.text}"
        data = get_resp.json()
        
        # For daily repeat, status should stay 'pending' and run_at should be bumped
        assert data.get("status") == "pending", f"Expected status='pending' for daily repeat, got '{data.get('status')}'"
        assert data.get("runs_count") == 1, f"Expected runs_count=1, got {data.get('runs_count')}"
        
        # Verify run_at was bumped by ~24 hours
        new_run_at = datetime.fromisoformat(data.get("run_at").replace("Z", "+00:00"))
        expected_min = original_run_at + timedelta(hours=23)  # Allow some tolerance
        assert new_run_at > expected_min, f"Expected run_at to be bumped +24h, got {new_run_at}"
        
        print(f"PASS: E2E scheduler loop test (daily): status='pending', runs_count=1, run_at bumped to {new_run_at}")

    def test_cancelled_schedules_not_picked_up(self, auth_token, setup_dummy_trmm, cleanup_scheduled_broadcasts):
        """Cancelled schedules do NOT get picked up by the loop"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Create a schedule with run_at in the past
        run_at = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
        create_resp = requests.post(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers, json={
            "agent_ids": ["TEST_scheduler_agent_3"],
            "command": "echo TEST cancelled should not run",
            "run_at": run_at,
            "repeat": "once",
            "label": "TEST_scheduler_cancelled"
        })
        sched_id = create_resp.json().get("id")
        
        # Cancel it immediately
        requests.delete(f"{BASE_URL}/api/trmm/scheduled-broadcasts/{sched_id}", headers=headers)
        print(f"Created and cancelled scheduled broadcast {sched_id}")
        
        # Wait for scheduler loop
        print("Waiting 35 seconds for scheduler loop...")
        time.sleep(35)
        
        # Check the scheduled broadcast - should still be cancelled, not completed
        get_resp = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts/{sched_id}", headers=headers)
        data = get_resp.json()
        
        assert data.get("status") == "cancelled", f"Expected status='cancelled', got '{data.get('status')}'"
        assert data.get("runs_count") == 0, f"Expected runs_count=0 for cancelled, got {data.get('runs_count')}"
        assert data.get("last_broadcast_id") is None, "Cancelled schedule should not have last_broadcast_id"
        
        print("PASS: Cancelled schedules do NOT get picked up by the loop")


class TestTrmmRegressionIterations122to127:
    """Regression tests for all TRMM endpoints from iterations 122-127"""

    def test_trmm_settings_endpoints(self, auth_token):
        """Regression: GET /api/trmm/settings, GET /api/trmm/status"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # GET settings
        response = requests.get(f"{BASE_URL}/api/trmm/settings", headers=headers)
        assert response.status_code == 200, f"GET /api/trmm/settings failed: {response.status_code}"
        
        # GET status (alias)
        response = requests.get(f"{BASE_URL}/api/trmm/status", headers=headers)
        assert response.status_code == 200, f"GET /api/trmm/status failed: {response.status_code}"
        
        print("PASS: Regression - GET /api/trmm/settings, GET /api/trmm/status")

    def test_trmm_summary_endpoint(self, auth_token):
        """Regression: GET /api/trmm/summary"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/trmm/summary", headers=headers)
        assert response.status_code == 200, f"GET /api/trmm/summary failed: {response.status_code}"
        print("PASS: Regression - GET /api/trmm/summary")

    def test_trmm_test_endpoint(self, auth_token):
        """Regression: GET /api/trmm/test"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/trmm/test", headers=headers)
        assert response.status_code == 200, f"GET /api/trmm/test failed: {response.status_code}"
        print("PASS: Regression - GET /api/trmm/test")

    def test_trmm_auto_link_503_when_not_configured(self, auth_token, cleanup_trmm_settings):
        """Regression: POST /api/trmm/auto-link returns 503 when not configured"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        # Ensure not configured
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=headers)
        
        response = requests.post(f"{BASE_URL}/api/trmm/auto-link", headers=headers, json={})
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print("PASS: Regression - POST /api/trmm/auto-link returns 503 when not configured")

    def test_trmm_linked_devices(self, auth_token):
        """Regression: GET /api/trmm/linked-devices"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/trmm/linked-devices", headers=headers)
        assert response.status_code == 200, f"GET /api/trmm/linked-devices failed: {response.status_code}"
        print("PASS: Regression - GET /api/trmm/linked-devices")

    def test_trmm_agents_503_when_not_configured(self, auth_token, cleanup_trmm_settings):
        """Regression: GET /api/trmm/agents returns 503 when not configured"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/trmm/agents", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print("PASS: Regression - GET /api/trmm/agents returns 503 when not configured")

    def test_trmm_clients_503_when_not_configured(self, auth_token, cleanup_trmm_settings):
        """Regression: GET /api/trmm/clients returns 503 when not configured"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/trmm/clients", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print("PASS: Regression - GET /api/trmm/clients returns 503 when not configured")

    def test_trmm_scripts_503_when_not_configured(self, auth_token, cleanup_trmm_settings):
        """Regression: GET /api/trmm/scripts returns 503 when not configured"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/trmm/scripts", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print("PASS: Regression - GET /api/trmm/scripts returns 503 when not configured")

    def test_trmm_scripts_favorites_mine(self, auth_token):
        """Regression: GET /api/trmm/scripts/favorites/mine"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/trmm/scripts/favorites/mine", headers=headers)
        assert response.status_code == 200, f"GET /api/trmm/scripts/favorites/mine failed: {response.status_code}"
        print("PASS: Regression - GET /api/trmm/scripts/favorites/mine")

    def test_trmm_agent_services_graceful(self, auth_token, cleanup_trmm_settings):
        """Regression: GET /api/trmm/agents/{id}/services returns graceful 200"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/trmm/agents/test-agent/services", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("success") is False
        print("PASS: Regression - GET /api/trmm/agents/{id}/services returns graceful 200")

    def test_trmm_agent_processes_graceful(self, auth_token, cleanup_trmm_settings):
        """Regression: GET /api/trmm/agents/{id}/processes returns graceful 200"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/trmm/agents/test-agent/processes", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("success") is False
        print("PASS: Regression - GET /api/trmm/agents/{id}/processes returns graceful 200")

    def test_trmm_agent_software_graceful(self, auth_token, cleanup_trmm_settings):
        """Regression: GET /api/trmm/agents/{id}/software returns graceful 200"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/trmm/agents/test-agent/software", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("success") is False
        print("PASS: Regression - GET /api/trmm/agents/{id}/software returns graceful 200")

    def test_trmm_agent_winupdates_graceful(self, auth_token, cleanup_trmm_settings):
        """Regression: GET /api/trmm/agents/{id}/winupdates returns graceful 200"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/trmm/agents/test-agent/winupdates", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("success") is False
        print("PASS: Regression - GET /api/trmm/agents/{id}/winupdates returns graceful 200")

    def test_trmm_runs_404_for_bogus(self, auth_token):
        """Regression: GET /api/trmm/runs/bogus returns 404"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/trmm/runs/bogus-nonexistent", headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Regression - GET /api/trmm/runs/bogus returns 404")

    def test_trmm_actions_log(self, auth_token):
        """Regression: GET /api/trmm/actions/log"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/trmm/actions/log", headers=headers)
        assert response.status_code == 200, f"GET /api/trmm/actions/log failed: {response.status_code}"
        print("PASS: Regression - GET /api/trmm/actions/log")

    def test_trmm_broadcast_503_when_not_configured(self, auth_token, cleanup_trmm_settings):
        """Regression: POST /api/trmm/broadcast returns 503 when not configured"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        requests.delete(f"{BASE_URL}/api/trmm/settings", headers=headers)
        
        response = requests.post(f"{BASE_URL}/api/trmm/broadcast", headers=headers, json={
            "agent_ids": ["agent-1"],
            "command": "echo test"
        })
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print("PASS: Regression - POST /api/trmm/broadcast returns 503 when not configured")

    def test_trmm_broadcasts_list(self, auth_token):
        """Regression: GET /api/trmm/broadcasts"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/trmm/broadcasts", headers=headers)
        assert response.status_code == 200, f"GET /api/trmm/broadcasts failed: {response.status_code}"
        print("PASS: Regression - GET /api/trmm/broadcasts")

    def test_trmm_broadcast_404_for_bogus(self, auth_token):
        """Regression: GET /api/trmm/broadcasts/{id} returns 404 for bogus"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/trmm/broadcasts/bcast-bogus-nonexistent", headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Regression - GET /api/trmm/broadcasts/{id} returns 404 for bogus")

    def test_remote_providers_active(self, auth_token):
        """Regression: GET /api/remote-providers/active"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/remote-providers/active", headers=headers)
        assert response.status_code == 200, f"GET /api/remote-providers/active failed: {response.status_code}"
        print("PASS: Regression - GET /api/remote-providers/active")


# ─────────────────────────── Fixtures ───────────────────────────

@pytest.fixture(scope="session")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    if response.status_code != 200:
        pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")
    # API returns 'token' not 'access_token'
    token = response.json().get("token") or response.json().get("access_token")
    if not token:
        pytest.skip("No token in login response")
    return token


@pytest.fixture
def setup_dummy_trmm(auth_token):
    """Setup dummy TRMM configuration for testing"""
    headers = {"Authorization": f"Bearer {auth_token}"}
    requests.post(f"{BASE_URL}/api/trmm/settings", headers=headers, json={
        "base_url": "https://dummy-trmm.test.local",
        "api_key": "test-api-key-12345678",
        "verify_tls": False
    })
    yield
    # Cleanup after test
    requests.delete(f"{BASE_URL}/api/trmm/settings", headers=headers)


@pytest.fixture
def cleanup_trmm_settings(auth_token):
    """Ensure TRMM settings are cleaned up"""
    headers = {"Authorization": f"Bearer {auth_token}"}
    yield
    requests.delete(f"{BASE_URL}/api/trmm/settings", headers=headers)


@pytest.fixture
def cleanup_scheduled_broadcasts(auth_token):
    """Cleanup TEST_ prefixed scheduled broadcasts after test"""
    headers = {"Authorization": f"Bearer {auth_token}"}
    yield
    # Get all scheduled broadcasts including completed
    response = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts?include_completed=true", headers=headers)
    if response.status_code == 200:
        for item in response.json():
            if item.get("label", "").startswith("TEST_") or "TEST_" in str(item.get("agent_ids", [])):
                # Try to cancel if pending
                requests.delete(f"{BASE_URL}/api/trmm/scheduled-broadcasts/{item['id']}", headers=headers)


@pytest.fixture
def cleanup_broadcasts(auth_token):
    """Cleanup TEST_ prefixed broadcasts after test"""
    headers = {"Authorization": f"Bearer {auth_token}"}
    yield
    # Note: We can't delete broadcasts, but they'll be cleaned up naturally
    # The scheduler tests create broadcasts that reference TEST_ agents
    pass


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
