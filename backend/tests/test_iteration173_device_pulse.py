"""Iteration 173 â€” Devices Command Center (Fleet Pulse) backend tests.

Covers all 11 endpoints declared in /app/backend/app/routers/device_pulse.py
plus tag update and saved-views CRUD + quick-scripts run.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8001").rstrip("/")
LOGIN_EMAIL = "aaron@stech.com.au"
LOGIN_PASSWORD = "Lucky@2871$!"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    assert token, f"No token in login response: {r.json()}"
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def sample_device_id(auth_headers):
    r = requests.get(f"{BASE_URL}/api/devices", headers=auth_headers, timeout=20)
    assert r.status_code == 200
    devs = r.json()
    if isinstance(devs, dict):
        devs = devs.get("devices") or devs.get("items") or []
    assert len(devs) > 0, "No seeded devices for tests"
    return devs[0].get("id")


# â”€â”€â”€ Fleet Pulse Wall â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class TestFleetPulse:
    def test_pulse_shape(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/devices/pulse", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "tiles" in data
        assert isinstance(data["tiles"], list)
        assert len(data["tiles"]) > 0
        t = data["tiles"][0]
        for k in ("id", "name", "health", "cpu", "ram", "disk", "cpu_spark", "ram_spark", "disk_spark"):
            assert k in t, f"Missing {k} in tile"
        assert 0 <= t["health"] <= 100
        assert len(t["cpu_spark"]) == 24
        assert len(t["ram_spark"]) == 24
        assert len(t["disk_spark"]) == 24


# â”€â”€â”€ Risk Heatmap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class TestRiskHeatmap:
    def test_heatmap_shape(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/devices/risk-heatmap", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "cells" in data and "clients" in data and "types" in data
        if data["cells"]:
            c = data["cells"][0]
            assert c["color"] in ("emerald", "amber", "red")
            for k in ("client", "type", "count", "avg_health"):
                assert k in c


# â”€â”€â”€ Lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class TestLifecycle:
    def test_lifecycle_shape(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/devices/lifecycle", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "devices" in data and "summary" in data
        for k in ("overdue", "due_now", "refresh_soon", "ok"):
            assert k in data["summary"]
        if data["devices"]:
            d = data["devices"][0]
            for k in ("age_years", "days_to_eol", "status"):
                assert k in d
            assert d["status"] in ("ok", "refresh-soon", "due-now", "overdue")


# â”€â”€â”€ Top Risks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class TestTopRisks:
    def test_risks(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/devices/top-risks", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "risks" in data
        assert len(data["risks"]) <= 5
        for risk in data["risks"]:
            for k in ("id", "severity", "title", "subtitle"):
                assert k in risk


# â”€â”€â”€ Anomalies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class TestAnomalies:
    def test_anomalies(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/devices/anomalies", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "anomalies" in data
        assert len(data["anomalies"]) >= 1
        a = data["anomalies"][0]
        for k in ("id", "device_name", "title", "severity", "category"):
            assert k in a


# â”€â”€â”€ Activity Ticker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class TestActivityTicker:
    def test_ticker(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/devices/activity-ticker", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "events" in data
        assert len(data["events"]) >= 1
        e = data["events"][0]
        for k in ("kind", "icon", "label", "ts"):
            assert k in e
        assert e["kind"] in ("checkin", "alert", "maintenance")


# â”€â”€â”€ Top Talkers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class TestTopTalkers:
    def test_top_talkers(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/devices/top-talkers", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        for key in ("cpu", "ram", "disk"):
            assert key in data
            assert isinstance(data[key], list)
            assert len(data[key]) <= 5
            for d in data[key]:
                for k in ("name", "client", "value"):
                    assert k in d


# â”€â”€â”€ Offline Watch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class TestOfflineWatch:
    def test_offline_watch(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/devices/offline-watch", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "devices" in data and "minutes" in data
        assert isinstance(data["devices"], list)


# â”€â”€â”€ Saved Views CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class TestSavedViews:
    def test_saved_views_lifecycle(self, auth_headers):
        # Create
        r = requests.post(f"{BASE_URL}/api/devices/saved-views",
                          headers=auth_headers,
                          json={"name": "TEST_view_iter173", "filters": {"status": "online"}},
                          timeout=20)
        assert r.status_code == 200, r.text
        view = r.json()
        assert view.get("id")
        assert view["name"] == "TEST_view_iter173"
        view_id = view["id"]

        # List
        r = requests.get(f"{BASE_URL}/api/devices/saved-views", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert any(v.get("id") == view_id for v in rows), "Created view not in list"

        # Delete
        r = requests.delete(f"{BASE_URL}/api/devices/saved-views/{view_id}", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        assert r.json().get("deleted") is True

        # Verify gone
        r = requests.delete(f"{BASE_URL}/api/devices/saved-views/{view_id}", headers=auth_headers, timeout=20)
        assert r.status_code == 404

    def test_saved_view_missing_name(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/devices/saved-views",
                          headers=auth_headers, json={"filters": {}}, timeout=20)
        assert r.status_code == 400


# â”€â”€â”€ Quick Scripts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class TestQuickScripts:
    def test_catalog(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/devices/quick-scripts", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "scripts" in data
        assert len(data["scripts"]) >= 10
        for s in data["scripts"]:
            for k in ("id", "name", "category", "description"):
                assert k in s

    def test_run_valid(self, auth_headers, sample_device_id):
        r = requests.post(f"{BASE_URL}/api/devices/quick-scripts/run",
                          headers=auth_headers,
                          json={"script_id": "qs-flushdns", "device_ids": [sample_device_id]},
                          timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        run = data.get("run") or data
        assert run.get("status") == "queued"
        assert run.get("script_id") == "qs-flushdns"

    def test_run_invalid_script(self, auth_headers, sample_device_id):
        r = requests.post(f"{BASE_URL}/api/devices/quick-scripts/run",
                          headers=auth_headers,
                          json={"script_id": "qs-DOES-NOT-EXIST", "device_ids": [sample_device_id]},
                          timeout=20)
        assert r.status_code == 404

    def test_run_missing_params(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/devices/quick-scripts/run",
                          headers=auth_headers, json={"script_id": "qs-flushdns"}, timeout=20)
        assert r.status_code == 400


# â”€â”€â”€ Tags â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class TestTags:
    def test_update_tags_ok(self, auth_headers, sample_device_id):
        r = requests.post(f"{BASE_URL}/api/devices/{sample_device_id}/tags",
                          headers=auth_headers,
                          json={"tags": ["TEST_iter173", "qa"]},
                          timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == sample_device_id
        assert "TEST_iter173" in data["tags"]

    def test_update_tags_missing(self, auth_headers, sample_device_id):
        r = requests.post(f"{BASE_URL}/api/devices/{sample_device_id}/tags",
                          headers=auth_headers, json={}, timeout=20)
        assert r.status_code == 400

    def test_update_tags_unknown_device(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/devices/non-existent-device-id/tags",
                          headers=auth_headers, json={"tags": ["x"]}, timeout=20)
        assert r.status_code == 404
