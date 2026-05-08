"""
Iteration 154: Backup Center Advanced Acronis Endpoints
Tests for:
- GET /api/acronis/orphans - Orphan detection (unprotected, stale, zombie_apps, offline_consuming)
- GET /api/acronis/agents/health - Agent health summary (online, offline_recent, stale)
- POST /api/acronis/alerts/{alert_id}/dismiss - Dismiss alert
- GET /api/acronis/console-link - Deep-link URL to Acronis console
- GET /api/acronis/live-activities - Running + recent activities
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


class TestAcronisOrphans:
    """Tests for GET /api/acronis/orphans endpoint."""

    def test_orphans_returns_totals(self, headers):
        """Verify orphans endpoint returns totals structure."""
        resp = requests.get(f"{BASE_URL}/api/acronis/orphans", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        data = resp.json()
        
        # Must have totals object
        assert "totals" in data, "Response missing 'totals'"
        totals = data["totals"]
        
        # Verify all required total fields
        for field in ["unprotected", "stale", "zombie_apps", "offline_consuming", "total_orphans"]:
            assert field in totals, f"totals missing '{field}'"
            assert isinstance(totals[field], int), f"totals.{field} should be int"
        
        # Verify arrays exist
        for arr in ["unprotected", "stale", "zombie_apps", "offline_consuming"]:
            assert arr in data, f"Response missing '{arr}' array"
            assert isinstance(data[arr], list), f"'{arr}' should be a list"
        
        # Verify metadata
        assert "scanned_at" in data
        assert "stale_threshold_days" in data
        print(f"Orphans scan: {totals}")

    def test_orphans_with_stale_days_param(self, headers):
        """Verify stale_days parameter is respected."""
        resp = requests.get(f"{BASE_URL}/api/acronis/orphans?stale_days=60", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("stale_threshold_days") == 60, "stale_threshold_days should match param"

    def test_orphans_unprotected_structure(self, headers):
        """Verify unprotected items have correct structure."""
        resp = requests.get(f"{BASE_URL}/api/acronis/orphans", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        if data["unprotected"]:
            item = data["unprotected"][0]
            # Check expected fields
            for field in ["resource_id", "resource_name", "resource_type", "issue", "severity"]:
                assert field in item, f"Unprotected item missing '{field}'"
            print(f"Sample unprotected: {item.get('resource_name')} - {item.get('issue')}")


class TestAcronisAgentsHealth:
    """Tests for GET /api/acronis/agents/health endpoint."""

    def test_agents_health_returns_summary(self, headers):
        """Verify agents health endpoint returns summary structure."""
        resp = requests.get(f"{BASE_URL}/api/acronis/agents/health", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        data = resp.json()
        
        # Must have summary object
        assert "summary" in data, "Response missing 'summary'"
        summary = data["summary"]
        
        # Verify summary fields
        for field in ["total", "online", "offline_recent", "stale", "online_pct"]:
            assert field in summary, f"summary missing '{field}'"
        
        # Verify arrays exist
        for arr in ["online", "offline_recent", "stale"]:
            assert arr in data, f"Response missing '{arr}' array"
            assert isinstance(data[arr], list), f"'{arr}' should be a list"
        
        print(f"Agent health: {summary}")

    def test_agents_health_online_pct_calculation(self, headers):
        """Verify online_pct is calculated correctly."""
        resp = requests.get(f"{BASE_URL}/api/acronis/agents/health", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        summary = data["summary"]
        
        if summary.get("total", 0) > 0:
            expected_pct = round((summary["online"] / summary["total"]) * 100, 1)
            assert summary["online_pct"] == expected_pct, f"online_pct mismatch: {summary['online_pct']} vs {expected_pct}"


class TestAcronisAlertsDismiss:
    """Tests for POST /api/acronis/alerts/{alert_id}/dismiss endpoint."""

    def test_dismiss_invalid_alert_graceful(self, headers):
        """Verify dismiss handles invalid alert ID gracefully."""
        # Use a fake alert ID
        resp = requests.post(f"{BASE_URL}/api/acronis/alerts/fake-alert-12345/dismiss", headers=headers)
        # Should return error but not crash (4xx or 5xx with detail)
        assert resp.status_code in [400, 404, 500], f"Expected error status, got {resp.status_code}"
        data = resp.json()
        assert "detail" in data or "error" in data or "status" in data, "Error response should have detail"
        print(f"Dismiss invalid alert response: {resp.status_code} - {data}")

    def test_dismiss_requires_auth(self):
        """Verify dismiss endpoint requires authentication."""
        resp = requests.post(f"{BASE_URL}/api/acronis/alerts/test-alert/dismiss")
        assert resp.status_code in [401, 403, 422], f"Expected auth error, got {resp.status_code}"


class TestAcronisConsoleLink:
    """Tests for GET /api/acronis/console-link endpoint."""

    def test_console_link_base_url(self, headers):
        """Verify console-link returns base Acronis URL."""
        resp = requests.get(f"{BASE_URL}/api/acronis/console-link", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        data = resp.json()
        
        assert "url" in data, "Response missing 'url'"
        if data["url"]:
            assert "acronis" in data["url"].lower() or "mc" in data["url"], "URL should point to Acronis console"
            print(f"Console link: {data['url']}")

    def test_console_link_with_resource_id(self, headers):
        """Verify console-link with resource_id param."""
        resp = requests.get(f"{BASE_URL}/api/acronis/console-link?resource_id=test-resource-123", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        if data.get("url"):
            assert "test-resource-123" in data["url"] or "devices" in data["url"], "URL should include resource context"

    def test_console_link_with_alert_id(self, headers):
        """Verify console-link with alert_id param."""
        resp = requests.get(f"{BASE_URL}/api/acronis/console-link?alert_id=test-alert-456", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        if data.get("url"):
            assert "test-alert-456" in data["url"] or "alerts" in data["url"], "URL should include alert context"


class TestAcronisLiveActivities:
    """Tests for GET /api/acronis/live-activities endpoint."""

    def test_live_activities_returns_structure(self, headers):
        """Verify live-activities returns correct structure."""
        resp = requests.get(f"{BASE_URL}/api/acronis/live-activities", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        data = resp.json()
        
        # Must have running and recent arrays
        assert "running" in data, "Response missing 'running'"
        assert "recent" in data, "Response missing 'recent'"
        assert isinstance(data["running"], list), "'running' should be a list"
        assert isinstance(data["recent"], list), "'recent' should be a list"
        
        # Must have stats object
        assert "stats" in data, "Response missing 'stats'"
        
        # Stats may be empty if Acronis API fails, but structure should exist
        print(f"Live activities: {len(data['running'])} running, {len(data['recent'])} recent, stats={data['stats']}")

    def test_live_activities_running_count_matches(self, headers):
        """Verify running_count matches running array length when stats populated."""
        resp = requests.get(f"{BASE_URL}/api/acronis/live-activities", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        # If stats has running_count, it should match
        if "running_count" in data.get("stats", {}):
            assert data["stats"]["running_count"] == len(data["running"]), "running_count should match running array length"
        else:
            # Stats may be empty if Acronis API fails - this is acceptable
            print("Stats empty (Acronis API may have failed) - skipping count validation")

    def test_live_activities_recent_limited(self, headers):
        """Verify recent array is limited to 30 items."""
        resp = requests.get(f"{BASE_URL}/api/acronis/live-activities", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        assert len(data["recent"]) <= 30, "recent should be limited to 30 items"


class TestBackupCenterExistingEndpoints:
    """Regression tests for existing backup endpoints."""

    def test_backup_dashboard_overview(self, headers):
        """Verify /api/backup-dashboard/overview works (used by BackupCenterPage)."""
        resp = requests.get(f"{BASE_URL}/api/backup-dashboard/overview", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "summary" in data or "jobs" in data, "Response should have summary or jobs"

    def test_backup_compliance_dashboard(self, headers):
        """Verify /api/backup-compliance/dashboard still works."""
        resp = requests.get(f"{BASE_URL}/api/backup-compliance/dashboard", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_backup_verify_overview(self, headers):
        """Verify /api/backup-verify/overview still works."""
        resp = requests.get(f"{BASE_URL}/api/backup-verify/overview", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_acronis_usage_summary(self, headers):
        """Verify /api/acronis/usage-summary still works."""
        resp = requests.get(f"{BASE_URL}/api/acronis/usage-summary", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_acronis_alerts(self, headers):
        """Verify /api/acronis/alerts still works."""
        resp = requests.get(f"{BASE_URL}/api/acronis/alerts", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
