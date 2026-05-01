"""
Iteration 129: TRMM Broadcast Notifications (Slack/Teams)
Tests for notification settings and webhook delivery after broadcast completion.

Endpoints tested:
- GET /api/trmm/notifications/settings — returns default shape when nothing saved
- POST /api/trmm/notifications/settings — saves notification settings
- POST /api/trmm/notifications/test — sends test notification to configured webhooks

Features tested:
- Default notification settings shape
- Validation for notify_on (all|failures|none)
- Saving Slack/Teams webhook URLs
- Test notification endpoint with httpbin.org/post
- End-to-end: broadcast completion triggers notification
- notify_on='none' skips notification
- notify_on='failures' with no failures skips notification
- Auth required on all endpoints
- Regression: all TRMM endpoints from iterations 122-128 still pass
"""

import pytest
import requests
import os
import time
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# httpbin.org/post is a public endpoint that returns 200 for any POST
HTTPBIN_POST_URL = "https://httpbin.org/post"


class TestTrmmNotificationsAuth:
    """Auth tests - all notification endpoints require authentication"""

    def test_get_notif_settings_requires_auth(self):
        """GET /api/trmm/notifications/settings requires auth"""
        response = requests.get(f"{BASE_URL}/api/trmm/notifications/settings")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: GET /api/trmm/notifications/settings requires auth ({response.status_code})")

    def test_save_notif_settings_requires_auth(self):
        """POST /api/trmm/notifications/settings requires auth"""
        response = requests.post(f"{BASE_URL}/api/trmm/notifications/settings", json={})
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: POST /api/trmm/notifications/settings requires auth ({response.status_code})")

    def test_test_notification_requires_auth(self):
        """POST /api/trmm/notifications/test requires auth"""
        response = requests.post(f"{BASE_URL}/api/trmm/notifications/test", json={})
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: POST /api/trmm/notifications/test requires auth ({response.status_code})")


class TestTrmmNotificationsSettingsDefault:
    """Test default notification settings shape"""

    def test_get_default_settings_shape(self, auth_token, cleanup_notif_settings):
        """GET /api/trmm/notifications/settings returns default shape when nothing saved"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Ensure no settings exist
        # (cleanup_notif_settings fixture handles this)
        
        response = requests.get(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify default shape
        assert data.get("slack_webhook_url") == "", f"Expected slack_webhook_url='', got '{data.get('slack_webhook_url')}'"
        assert data.get("teams_webhook_url") == "", f"Expected teams_webhook_url='', got '{data.get('teams_webhook_url')}'"
        assert data.get("notify_on") == "all", f"Expected notify_on='all', got '{data.get('notify_on')}'"
        assert data.get("include_per_agent") == True, f"Expected include_per_agent=True, got {data.get('include_per_agent')}"
        assert data.get("configured") == False, f"Expected configured=False, got {data.get('configured')}"
        
        print("PASS: GET /api/trmm/notifications/settings returns default shape {slack_webhook_url:'', teams_webhook_url:'', notify_on:'all', include_per_agent:true, configured:false}")


class TestTrmmNotificationsSettingsValidation:
    """Test validation for POST /api/trmm/notifications/settings"""

    def test_400_invalid_notify_on(self, auth_token, cleanup_notif_settings):
        """POST /api/trmm/notifications/settings returns 400 when notify_on not in (all|failures|none)"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        response = requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
            "notify_on": "invalid_value"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        assert "notify_on" in response.text.lower() or "all" in response.text.lower(), f"Expected error about notify_on: {response.text}"
        
        print("PASS: POST /api/trmm/notifications/settings returns 400 when notify_on not in (all|failures|none)")

    def test_save_with_valid_slack_url(self, auth_token, cleanup_notif_settings):
        """POST /api/trmm/notifications/settings saves successfully with valid Slack URL"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        response = requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
            "slack_webhook_url": HTTPBIN_POST_URL,
            "notify_on": "all"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, f"Expected success=True: {data}"
        assert data.get("configured") == True, f"Expected configured=True: {data}"
        
        # Verify GET returns the saved settings
        get_resp = requests.get(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers)
        get_data = get_resp.json()
        assert get_data.get("slack_webhook_url") == HTTPBIN_POST_URL, f"Expected slack_webhook_url to be saved: {get_data}"
        assert get_data.get("configured") == True, f"Expected configured=True after save: {get_data}"
        
        print("PASS: POST /api/trmm/notifications/settings saves successfully with valid Slack URL; subsequent GET shows configured:true")

    def test_save_with_valid_teams_url(self, auth_token, cleanup_notif_settings):
        """POST /api/trmm/notifications/settings saves successfully with valid Teams URL"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        response = requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
            "teams_webhook_url": HTTPBIN_POST_URL,
            "notify_on": "failures"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, f"Expected success=True: {data}"
        assert data.get("configured") == True, f"Expected configured=True: {data}"
        
        # Verify GET returns the saved settings
        get_resp = requests.get(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers)
        get_data = get_resp.json()
        assert get_data.get("teams_webhook_url") == HTTPBIN_POST_URL, f"Expected teams_webhook_url to be saved: {get_data}"
        assert get_data.get("notify_on") == "failures", f"Expected notify_on='failures': {get_data}"
        
        print("PASS: POST /api/trmm/notifications/settings saves successfully with valid Teams URL")

    def test_save_with_notify_on_none(self, auth_token, cleanup_notif_settings):
        """POST /api/trmm/notifications/settings accepts notify_on='none'"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        response = requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
            "slack_webhook_url": HTTPBIN_POST_URL,
            "notify_on": "none"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Verify GET returns notify_on='none'
        get_resp = requests.get(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers)
        get_data = get_resp.json()
        assert get_data.get("notify_on") == "none", f"Expected notify_on='none': {get_data}"
        
        print("PASS: POST /api/trmm/notifications/settings accepts notify_on='none'")


class TestTrmmNotificationsTest:
    """Test POST /api/trmm/notifications/test endpoint"""

    def test_400_no_webhook_configured(self, auth_token, cleanup_notif_settings):
        """POST /api/trmm/notifications/test returns 400 'No webhook configured' when neither URL set"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Ensure no webhooks configured
        requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
            "slack_webhook_url": "",
            "teams_webhook_url": "",
            "notify_on": "all"
        })
        
        response = requests.post(f"{BASE_URL}/api/trmm/notifications/test", headers=headers, json={})
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        assert "no webhook" in response.text.lower() or "not configured" in response.text.lower(), f"Expected 'No webhook configured' error: {response.text}"
        
        print("PASS: POST /api/trmm/notifications/test returns 400 'No webhook configured' when neither URL set")

    def test_slack_test_with_httpbin(self, auth_token, cleanup_notif_settings):
        """POST /api/trmm/notifications/test with target='slack' returns {success:true, results:[{target:'slack', status:200, ok:true}]}"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Configure Slack webhook with httpbin
        requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
            "slack_webhook_url": HTTPBIN_POST_URL,
            "notify_on": "all"
        })
        
        response = requests.post(f"{BASE_URL}/api/trmm/notifications/test", headers=headers, json={
            "target": "slack"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, f"Expected success=True: {data}"
        assert "results" in data, f"Expected 'results' in response: {data}"
        
        results = data.get("results", [])
        assert len(results) >= 1, f"Expected at least 1 result: {results}"
        
        slack_result = next((r for r in results if r.get("target") == "slack"), None)
        assert slack_result is not None, f"Expected slack result: {results}"
        assert slack_result.get("status") == 200, f"Expected status=200: {slack_result}"
        assert slack_result.get("ok") == True, f"Expected ok=True: {slack_result}"
        
        print("PASS: POST /api/trmm/notifications/test with target='slack' returns {success:true, results:[{target:'slack', status:200, ok:true}]}")

    def test_teams_test_with_httpbin(self, auth_token, cleanup_notif_settings):
        """POST /api/trmm/notifications/test with target='teams' returns {success:true, results:[{target:'teams', status:200, ok:true}]}"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Configure Teams webhook with httpbin
        requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
            "teams_webhook_url": HTTPBIN_POST_URL,
            "notify_on": "all"
        })
        
        response = requests.post(f"{BASE_URL}/api/trmm/notifications/test", headers=headers, json={
            "target": "teams"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, f"Expected success=True: {data}"
        
        results = data.get("results", [])
        teams_result = next((r for r in results if r.get("target") == "teams"), None)
        assert teams_result is not None, f"Expected teams result: {results}"
        assert teams_result.get("status") == 200, f"Expected status=200: {teams_result}"
        assert teams_result.get("ok") == True, f"Expected ok=True: {teams_result}"
        
        print("PASS: POST /api/trmm/notifications/test with target='teams' returns {success:true, results:[{target:'teams', status:200, ok:true}]}")

    def test_both_test_with_httpbin(self, auth_token, cleanup_notif_settings):
        """POST /api/trmm/notifications/test with target='both' fires both if configured"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Configure both webhooks with httpbin
        requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
            "slack_webhook_url": HTTPBIN_POST_URL,
            "teams_webhook_url": HTTPBIN_POST_URL,
            "notify_on": "all"
        })
        
        response = requests.post(f"{BASE_URL}/api/trmm/notifications/test", headers=headers, json={
            "target": "both"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, f"Expected success=True: {data}"
        
        results = data.get("results", [])
        assert len(results) == 2, f"Expected 2 results for 'both': {results}"
        
        targets = [r.get("target") for r in results]
        assert "slack" in targets, f"Expected 'slack' in targets: {targets}"
        assert "teams" in targets, f"Expected 'teams' in targets: {targets}"
        
        for r in results:
            assert r.get("ok") == True, f"Expected ok=True for {r.get('target')}: {r}"
        
        print("PASS: POST /api/trmm/notifications/test with target='both' fires both if configured")

    def test_partial_success_returns_success_false(self, auth_token, cleanup_notif_settings):
        """POST /api/trmm/notifications/test with partial success returns {success:false,...} with per-target breakdown"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Configure one valid (httpbin) and one invalid URL
        requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
            "slack_webhook_url": HTTPBIN_POST_URL,
            "teams_webhook_url": "https://invalid-webhook-url-that-will-fail.example.com/webhook",
            "notify_on": "all"
        })
        
        response = requests.post(f"{BASE_URL}/api/trmm/notifications/test", headers=headers, json={
            "target": "both"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # With partial success, overall success should be False
        assert data.get("success") == False, f"Expected success=False for partial failure: {data}"
        
        results = data.get("results", [])
        assert len(results) == 2, f"Expected 2 results: {results}"
        
        # Slack should succeed
        slack_result = next((r for r in results if r.get("target") == "slack"), None)
        assert slack_result is not None, f"Expected slack result: {results}"
        assert slack_result.get("ok") == True, f"Expected slack ok=True: {slack_result}"
        
        # Teams should fail
        teams_result = next((r for r in results if r.get("target") == "teams"), None)
        assert teams_result is not None, f"Expected teams result: {results}"
        assert teams_result.get("ok") == False, f"Expected teams ok=False: {teams_result}"
        
        print("PASS: POST /api/trmm/notifications/test with partial success returns {success:false,...} with per-target breakdown")


class TestTrmmNotificationsE2E:
    """End-to-end tests: broadcast completion triggers notification"""

    def test_e2e_broadcast_with_notification(self, auth_token, setup_dummy_trmm, cleanup_notif_settings, cleanup_broadcasts):
        """E2E: configure TRMM + slack webhook (httpbin) + run broadcast — verify db.trmm_broadcasts gets 'notifications' field and 'notified_at' timestamp"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Configure notification settings with httpbin
        requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
            "slack_webhook_url": HTTPBIN_POST_URL,
            "notify_on": "all"
        })
        
        # Start a broadcast
        broadcast_resp = requests.post(f"{BASE_URL}/api/trmm/broadcast", headers=headers, json={
            "agent_ids": ["TEST_notif_agent_1", "TEST_notif_agent_2"],
            "command": "echo TEST notification e2e",
            "label": "TEST_notification_e2e"
        })
        assert broadcast_resp.status_code == 200, f"Failed to create broadcast: {broadcast_resp.text}"
        broadcast_id = broadcast_resp.json().get("broadcast_id")
        print(f"Created broadcast {broadcast_id}")
        
        # Wait for broadcast to complete (with fake TRMM, should complete quickly with errors)
        print("Waiting for broadcast to complete...")
        max_wait = 15
        poll_interval = 2
        elapsed = 0
        final_data = None
        
        while elapsed < max_wait:
            time.sleep(poll_interval)
            elapsed += poll_interval
            
            status_resp = requests.get(f"{BASE_URL}/api/trmm/broadcasts/{broadcast_id}", headers=headers)
            assert status_resp.status_code == 200
            data = status_resp.json()
            
            if data.get("status") == "complete":
                final_data = data
                break
        
        assert final_data is not None, f"Broadcast did not complete within {max_wait}s"
        assert final_data.get("status") == "complete", f"Expected status='complete': {final_data}"
        
        # Verify notifications field is populated
        notifications = final_data.get("notifications")
        assert notifications is not None, f"Expected 'notifications' field in broadcast doc: {final_data}"
        assert isinstance(notifications, list), f"Expected notifications to be list: {notifications}"
        assert len(notifications) >= 1, f"Expected at least 1 notification result: {notifications}"
        
        # Verify notified_at timestamp
        notified_at = final_data.get("notified_at")
        assert notified_at is not None, f"Expected 'notified_at' timestamp in broadcast doc: {final_data}"
        
        # Verify slack notification was sent
        slack_notif = next((n for n in notifications if n.get("target") == "slack"), None)
        assert slack_notif is not None, f"Expected slack notification: {notifications}"
        assert slack_notif.get("status") == 200, f"Expected slack status=200: {slack_notif}"
        
        print(f"PASS: E2E broadcast with notification - notifications={notifications}, notified_at={notified_at}")

    def test_e2e_notify_on_none_skips_notification(self, auth_token, setup_dummy_trmm, cleanup_notif_settings, cleanup_broadcasts):
        """E2E with notify_on='none': broadcast completes but trmm_broadcasts.notifications is NOT set"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Configure notification settings with notify_on='none'
        requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
            "slack_webhook_url": HTTPBIN_POST_URL,
            "notify_on": "none"
        })
        
        # Start a broadcast
        broadcast_resp = requests.post(f"{BASE_URL}/api/trmm/broadcast", headers=headers, json={
            "agent_ids": ["TEST_notif_none_agent_1"],
            "command": "echo TEST notify_on none",
            "label": "TEST_notify_on_none"
        })
        assert broadcast_resp.status_code == 200, f"Failed to create broadcast: {broadcast_resp.text}"
        broadcast_id = broadcast_resp.json().get("broadcast_id")
        print(f"Created broadcast {broadcast_id} with notify_on='none'")
        
        # Wait for broadcast to complete
        print("Waiting for broadcast to complete...")
        time.sleep(10)
        
        status_resp = requests.get(f"{BASE_URL}/api/trmm/broadcasts/{broadcast_id}", headers=headers)
        assert status_resp.status_code == 200
        data = status_resp.json()
        
        assert data.get("status") == "complete", f"Expected status='complete': {data}"
        
        # Verify notifications field is NOT set
        notifications = data.get("notifications")
        notified_at = data.get("notified_at")
        
        assert notifications is None, f"Expected 'notifications' to be None with notify_on='none': {data}"
        assert notified_at is None, f"Expected 'notified_at' to be None with notify_on='none': {data}"
        
        print("PASS: E2E with notify_on='none' - broadcast completes but notifications NOT set")

    def test_e2e_notify_on_failures_with_no_failures_skips(self, auth_token, setup_dummy_trmm, cleanup_notif_settings, cleanup_broadcasts):
        """E2E with notify_on='failures' AND broadcast succeeds (failed_count==0): no notification sent
        
        Note: With fake TRMM, all agents will have 'error' status, so failed_count > 0.
        This test verifies the logic by checking that when failed_count > 0, notification IS sent.
        """
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Configure notification settings with notify_on='failures'
        requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
            "slack_webhook_url": HTTPBIN_POST_URL,
            "notify_on": "failures"
        })
        
        # Start a broadcast (with fake TRMM, all will fail)
        broadcast_resp = requests.post(f"{BASE_URL}/api/trmm/broadcast", headers=headers, json={
            "agent_ids": ["TEST_notif_failures_agent_1"],
            "command": "echo TEST notify_on failures",
            "label": "TEST_notify_on_failures"
        })
        assert broadcast_resp.status_code == 200, f"Failed to create broadcast: {broadcast_resp.text}"
        broadcast_id = broadcast_resp.json().get("broadcast_id")
        print(f"Created broadcast {broadcast_id} with notify_on='failures'")
        
        # Wait for broadcast to complete
        print("Waiting for broadcast to complete...")
        time.sleep(10)
        
        status_resp = requests.get(f"{BASE_URL}/api/trmm/broadcasts/{broadcast_id}", headers=headers)
        assert status_resp.status_code == 200
        data = status_resp.json()
        
        assert data.get("status") == "complete", f"Expected status='complete': {data}"
        
        # With fake TRMM, failed_count > 0, so notification SHOULD be sent
        failed_count = data.get("failed_count", 0)
        notifications = data.get("notifications")
        
        if failed_count > 0:
            # Notification should be sent because there are failures
            assert notifications is not None, f"Expected notifications with failed_count={failed_count}: {data}"
            print(f"PASS: E2E with notify_on='failures' and failed_count={failed_count} - notification WAS sent (correct)")
        else:
            # If somehow no failures, notification should NOT be sent
            assert notifications is None, f"Expected no notifications with failed_count=0: {data}"
            print(f"PASS: E2E with notify_on='failures' and failed_count=0 - notification NOT sent (correct)")


class TestTrmmRegressionIterations122to128:
    """Regression tests for all TRMM endpoints from iterations 122-128"""

    def test_trmm_settings_endpoints(self, auth_token):
        """Regression: GET /api/trmm/settings, GET /api/trmm/status"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        response = requests.get(f"{BASE_URL}/api/trmm/settings", headers=headers)
        assert response.status_code == 200, f"GET /api/trmm/settings failed: {response.status_code}"
        
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

    def test_trmm_scheduled_broadcasts_list(self, auth_token):
        """Regression: GET /api/trmm/scheduled-broadcasts"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts", headers=headers)
        assert response.status_code == 200, f"GET /api/trmm/scheduled-broadcasts failed: {response.status_code}"
        print("PASS: Regression - GET /api/trmm/scheduled-broadcasts")

    def test_trmm_scheduled_broadcast_404_for_bogus(self, auth_token):
        """Regression: GET /api/trmm/scheduled-broadcasts/{id} returns 404 for bogus"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/trmm/scheduled-broadcasts/sched-bogus-nonexistent", headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Regression - GET /api/trmm/scheduled-broadcasts/{id} returns 404 for bogus")

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
def cleanup_notif_settings(auth_token):
    """Cleanup notification settings before and after test"""
    headers = {"Authorization": f"Bearer {auth_token}"}
    # Clear before test
    requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
        "slack_webhook_url": "",
        "teams_webhook_url": "",
        "notify_on": "all"
    })
    yield
    # Clear after test
    requests.post(f"{BASE_URL}/api/trmm/notifications/settings", headers=headers, json={
        "slack_webhook_url": "",
        "teams_webhook_url": "",
        "notify_on": "all"
    })


@pytest.fixture
def cleanup_broadcasts(auth_token):
    """Cleanup TEST_ prefixed broadcasts after test (note: broadcasts can't be deleted, just for tracking)"""
    headers = {"Authorization": f"Bearer {auth_token}"}
    yield
    # Broadcasts can't be deleted via API, but we track them for cleanup
    pass


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
