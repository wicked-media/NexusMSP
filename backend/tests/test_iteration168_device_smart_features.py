"""
Iteration 168 — Device Smart Features Testing
Tests for:
1. AI Diagnose (single device + ticket posting)
2. Live Metrics (with synthetic fallback)
3. Screenshot to Ticket
4. Fleet Health Score
5. Fleet Insights (AI summary)
6. Bulk Diagnose (fan-out)
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

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
    assert response.status_code == 200, f"Login failed: {response.text}"
    data = response.json()
    return data.get("token")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def test_device_id(headers):
    """Get first available device ID"""
    response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
    assert response.status_code == 200
    devices = response.json()
    assert len(devices) > 0, "No devices found for testing"
    return devices[0]["id"]


@pytest.fixture(scope="module")
def test_ticket_id(headers):
    """Get first available ticket ID"""
    response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
    assert response.status_code == 200
    tickets = response.json()
    if isinstance(tickets, dict):
        tickets = tickets.get("tickets", [])
    assert len(tickets) > 0, "No tickets found for testing"
    return tickets[0]["id"]


@pytest.fixture(scope="module")
def two_device_ids(headers):
    """Get two device IDs for bulk testing"""
    response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
    assert response.status_code == 200
    devices = response.json()
    assert len(devices) >= 2, "Need at least 2 devices for bulk testing"
    return [devices[0]["id"], devices[1]["id"]]


class TestAIDiagnose:
    """AI Diagnose endpoint tests"""

    def test_ai_diagnose_empty_body(self, headers, test_device_id):
        """POST /api/devices/{id}/ai-diagnose with empty body returns diagnosis"""
        response = requests.post(
            f"{BASE_URL}/api/devices/{test_device_id}/ai-diagnose",
            json={},
            headers=headers
        )
        assert response.status_code == 200, f"AI diagnose failed: {response.text}"
        data = response.json()
        
        # Verify required fields
        assert "severity" in data, "Missing severity field"
        assert data["severity"] in ["low", "medium", "high", "critical"], f"Invalid severity: {data['severity']}"
        assert "diagnosis" in data, "Missing diagnosis field"
        assert isinstance(data["diagnosis"], str), "Diagnosis should be a string"
        assert "actions" in data, "Missing actions field"
        assert isinstance(data["actions"], list), "Actions should be a list"
        assert "signals" in data, "Missing signals field"
        
        print(f"AI Diagnose result: severity={data['severity']}, diagnosis length={len(data['diagnosis'])}")

    def test_ai_diagnose_with_ticket_id(self, headers, test_device_id, test_ticket_id):
        """POST /api/devices/{id}/ai-diagnose with ticket_id posts comment to ticket"""
        response = requests.post(
            f"{BASE_URL}/api/devices/{test_device_id}/ai-diagnose",
            json={"ticket_id": test_ticket_id},
            headers=headers
        )
        assert response.status_code == 200, f"AI diagnose with ticket failed: {response.text}"
        data = response.json()
        
        # Verify diagnosis fields
        assert "severity" in data
        assert "diagnosis" in data
        assert isinstance(data["diagnosis"], str), "Diagnosis should be a string"
        assert "actions" in data
        
        # Verify posted_to_ticket flag
        assert data.get("posted_to_ticket") == True, "Should have posted_to_ticket=true"
        
        print(f"AI Diagnose posted to ticket: {test_ticket_id}")

    def test_ai_diagnose_invalid_device(self, headers):
        """POST /api/devices/{invalid}/ai-diagnose returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/devices/invalid-device-id-xyz/ai-diagnose",
            json={},
            headers=headers
        )
        assert response.status_code == 404


class TestLiveMetrics:
    """Live Metrics endpoint tests"""

    def test_live_metrics_default(self, headers, test_device_id):
        """GET /api/devices/{id}/live-metrics returns metrics with series"""
        response = requests.get(
            f"{BASE_URL}/api/devices/{test_device_id}/live-metrics",
            headers=headers
        )
        assert response.status_code == 200, f"Live metrics failed: {response.text}"
        data = response.json()
        
        # Verify required fields
        assert "current" in data, "Missing current field"
        assert "series" in data, "Missing series field"
        assert "minutes" in data, "Missing minutes field"
        assert "online" in data, "Missing online field"
        
        # Verify current metrics structure
        current = data["current"]
        assert "cpu" in current, "Missing cpu in current"
        assert "memory" in current, "Missing memory in current"
        assert "disk" in current, "Missing disk in current"
        
        # Verify series is a list
        assert isinstance(data["series"], list), "Series should be a list"
        
        print(f"Live metrics: {len(data['series'])} data points, online={data['online']}")

    def test_live_metrics_with_minutes(self, headers, test_device_id):
        """GET /api/devices/{id}/live-metrics?minutes=15 respects minutes param"""
        response = requests.get(
            f"{BASE_URL}/api/devices/{test_device_id}/live-metrics?minutes=15",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["minutes"] == 15, "Minutes param not respected"

    def test_live_metrics_synthetic_fallback(self, headers, test_device_id):
        """Live metrics returns synthetic points when no agent data exists"""
        response = requests.get(
            f"{BASE_URL}/api/devices/{test_device_id}/live-metrics",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        
        # If series has synthetic points, verify structure
        series = data.get("series", [])
        if series and series[0].get("synthetic"):
            assert len(series) == 20, "Synthetic fallback should have 20 points"
            for point in series:
                assert point.get("synthetic") == True, "Synthetic points should have synthetic=true"
            print("Verified synthetic fallback with 20 points")
        else:
            print(f"Real agent data found: {len(series)} points")

    def test_live_metrics_invalid_device(self, headers):
        """GET /api/devices/{invalid}/live-metrics returns 404"""
        response = requests.get(
            f"{BASE_URL}/api/devices/invalid-device-id-xyz/live-metrics",
            headers=headers
        )
        assert response.status_code == 404


class TestScreenshotToTicket:
    """Screenshot to Ticket endpoint tests"""

    def test_screenshot_to_ticket(self, headers, test_device_id, test_ticket_id):
        """POST /api/devices/{id}/screenshot-to-ticket posts comment"""
        response = requests.post(
            f"{BASE_URL}/api/devices/{test_device_id}/screenshot-to-ticket",
            json={"ticket_id": test_ticket_id},
            headers=headers
        )
        assert response.status_code == 200, f"Screenshot to ticket failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "success" in data, "Missing success field"
        assert data["success"] == True, "Success should be true"
        assert "comment_id" in data, "Missing comment_id field"
        assert "pending" in data, "Missing pending field"
        # image_url can be null if TRMM not configured
        assert "image_url" in data, "Missing image_url field"
        
        print(f"Screenshot request: comment_id={data['comment_id']}, pending={data['pending']}")

    def test_screenshot_missing_ticket_id(self, headers, test_device_id):
        """POST /api/devices/{id}/screenshot-to-ticket without ticket_id returns 400"""
        response = requests.post(
            f"{BASE_URL}/api/devices/{test_device_id}/screenshot-to-ticket",
            json={},
            headers=headers
        )
        assert response.status_code == 400

    def test_screenshot_invalid_device(self, headers, test_ticket_id):
        """POST /api/devices/{invalid}/screenshot-to-ticket returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/devices/invalid-device-id-xyz/screenshot-to-ticket",
            json={"ticket_id": test_ticket_id},
            headers=headers
        )
        assert response.status_code == 404


class TestFleetHealth:
    """Fleet Health endpoint tests"""

    def test_fleet_health(self, headers):
        """GET /api/devices/fleet-health returns health score and counts"""
        response = requests.get(
            f"{BASE_URL}/api/devices/fleet-health",
            headers=headers
        )
        assert response.status_code == 200, f"Fleet health failed: {response.text}"
        data = response.json()
        
        # Verify score and band
        assert "score" in data, "Missing score field"
        assert isinstance(data["score"], int), "Score should be an integer"
        assert 0 <= data["score"] <= 100, f"Score out of range: {data['score']}"
        
        assert "band" in data, "Missing band field"
        assert data["band"] in ["excellent", "good", "fair", "poor"], f"Invalid band: {data['band']}"
        
        # Verify counts structure
        assert "counts" in data, "Missing counts field"
        counts = data["counts"]
        expected_count_keys = ["total", "online", "offline", "warning", "no_agent", "stale", "high_cpu", "high_mem", "low_disk"]
        for key in expected_count_keys:
            assert key in counts, f"Missing count key: {key}"
            assert isinstance(counts[key], int), f"Count {key} should be integer"
        
        print(f"Fleet health: score={data['score']}, band={data['band']}, total={counts['total']}")


class TestFleetInsights:
    """Fleet Insights endpoint tests (includes AI summary)"""

    def test_fleet_insights(self, headers):
        """GET /api/devices/fleet-insights returns health + AI summary + top 5 risky"""
        response = requests.get(
            f"{BASE_URL}/api/devices/fleet-insights",
            headers=headers
        )
        assert response.status_code == 200, f"Fleet insights failed: {response.text}"
        data = response.json()
        
        # Verify health fields (inherited from fleet-health)
        assert "score" in data, "Missing score field"
        assert "band" in data, "Missing band field"
        assert "counts" in data, "Missing counts field"
        
        # Verify AI summary
        assert "ai_summary" in data, "Missing ai_summary field"
        assert isinstance(data["ai_summary"], str), "AI summary should be a string"
        assert len(data["ai_summary"]) > 0, "AI summary should not be empty"
        
        # Verify top 5 risky
        assert "top_5_risky" in data, "Missing top_5_risky field"
        assert isinstance(data["top_5_risky"], list), "top_5_risky should be a list"
        assert len(data["top_5_risky"]) <= 5, "Should have at most 5 risky devices"
        
        # Verify risky device structure
        if data["top_5_risky"]:
            risky = data["top_5_risky"][0]
            assert "name" in risky, "Risky device missing name"
            assert "cpu" in risky, "Risky device missing cpu"
            assert "mem" in risky, "Risky device missing mem"
            assert "disk" in risky, "Risky device missing disk"
            assert "status" in risky, "Risky device missing status"
        
        print(f"Fleet insights: score={data['score']}, ai_summary length={len(data['ai_summary'])}, risky={len(data['top_5_risky'])}")


class TestBulkDiagnose:
    """Bulk Diagnose endpoint tests"""

    def test_bulk_diagnose(self, headers, two_device_ids):
        """POST /api/devices/bulk-diagnose with device_ids returns diagnoses"""
        response = requests.post(
            f"{BASE_URL}/api/devices/bulk-diagnose",
            json={"device_ids": two_device_ids},
            headers=headers,
            timeout=60  # AI calls can take time
        )
        assert response.status_code == 200, f"Bulk diagnose failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "count" in data, "Missing count field"
        assert data["count"] == len(two_device_ids), f"Count mismatch: {data['count']} vs {len(two_device_ids)}"
        
        assert "results" in data, "Missing results field"
        assert isinstance(data["results"], list), "Results should be a list"
        assert len(data["results"]) == len(two_device_ids), "Results count mismatch"
        
        # Verify each result
        for result in data["results"]:
            assert "device_id" in result, "Result missing device_id"
            assert "severity" in result, "Result missing severity"
            assert "diagnosis" in result, "Result missing diagnosis"
            assert isinstance(result["diagnosis"], str), "Diagnosis should be a string"
        
        print(f"Bulk diagnose: {data['count']} devices processed")

    def test_bulk_diagnose_empty_ids(self, headers):
        """POST /api/devices/bulk-diagnose with empty device_ids returns 400"""
        response = requests.post(
            f"{BASE_URL}/api/devices/bulk-diagnose",
            json={"device_ids": []},
            headers=headers
        )
        assert response.status_code == 400

    def test_bulk_diagnose_missing_ids(self, headers):
        """POST /api/devices/bulk-diagnose without device_ids returns 400"""
        response = requests.post(
            f"{BASE_URL}/api/devices/bulk-diagnose",
            json={},
            headers=headers
        )
        assert response.status_code == 400

    def test_bulk_diagnose_max_limit(self, headers):
        """POST /api/devices/bulk-diagnose with >25 devices returns 400"""
        fake_ids = [f"fake-device-{i}" for i in range(26)]
        response = requests.post(
            f"{BASE_URL}/api/devices/bulk-diagnose",
            json={"device_ids": fake_ids},
            headers=headers
        )
        assert response.status_code == 400


class TestEndpointRouting:
    """Verify endpoints are properly routed"""

    def test_device_smart_router_loaded(self, headers):
        """Verify device_smart router is auto-discovered and loaded"""
        # All these endpoints should be accessible (not 404 for route not found)
        endpoints = [
            ("GET", "/api/devices/fleet-health"),
            ("GET", "/api/devices/fleet-insights"),
        ]
        for method, path in endpoints:
            if method == "GET":
                response = requests.get(f"{BASE_URL}{path}", headers=headers)
            else:
                response = requests.post(f"{BASE_URL}{path}", json={}, headers=headers)
            # Should not be 404 (route not found) - 400/422 for bad params is OK
            assert response.status_code != 404, f"Route not found: {method} {path}"
            print(f"Route OK: {method} {path} -> {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
