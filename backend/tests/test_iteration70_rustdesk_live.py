"""
Iteration 70 - RustDesk Live API Integration Tests
Tests the new live RustDesk server API endpoints:
- GET /api/rustdesk/live/test-connection
- GET /api/rustdesk/live/peers
- POST /api/rustdesk/live/sync
- GET /api/rustdesk/live/audit
Plus regression tests for Notifications and Kanban
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    def test_login_success(self):
        """Test standard login with admin credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in response"
        assert data["token"], "token is empty"
        print(f"Login successful, token received")
        return data["token"]


class TestRustDeskLiveAPI:
    """Tests for new RustDesk Live API endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token before each test"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_rustdesk_config(self):
        """Test GET /api/rustdesk/config returns config structure"""
        response = requests.get(f"{BASE_URL}/api/rustdesk/config", headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        # Should have key and value structure
        assert "key" in data or "value" in data or "server_url" in data, f"Unexpected config structure: {data}"
        print(f"RustDesk config: {data}")
    
    def test_live_test_connection_endpoint_exists(self):
        """Test GET /api/rustdesk/live/test-connection endpoint exists and returns proper structure"""
        response = requests.get(f"{BASE_URL}/api/rustdesk/live/test-connection", headers=self.headers)
        assert response.status_code == 200, f"Endpoint failed: {response.text}"
        data = response.json()
        # Should return connection result structure
        assert "connected" in data, f"Missing 'connected' field: {data}"
        assert "message" in data or "server_url" in data, f"Missing message/server_url: {data}"
        print(f"Test connection result: connected={data.get('connected')}, message={data.get('message')}")
    
    def test_live_test_connection_graceful_failure(self):
        """Test that test-connection gracefully handles unreachable server"""
        response = requests.get(f"{BASE_URL}/api/rustdesk/live/test-connection", headers=self.headers)
        assert response.status_code == 200, f"Should return 200 even on failure: {response.text}"
        data = response.json()
        # Since server is unreachable, connected should be False
        assert isinstance(data.get("connected"), bool), "connected should be boolean"
        # Should have a message explaining the status
        assert data.get("message") or data.get("server_url"), "Should have message or server_url"
        print(f"Graceful failure test: {data}")
    
    def test_live_peers_endpoint_exists(self):
        """Test GET /api/rustdesk/live/peers endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/rustdesk/live/peers", headers=self.headers)
        # May return 400 if server not configured, or 502 if server unreachable, or 200 with empty peers
        assert response.status_code in [200, 400, 502], f"Unexpected status: {response.status_code} - {response.text}"
        if response.status_code == 200:
            data = response.json()
            assert "peers" in data, f"Missing 'peers' field: {data}"
            assert "count" in data, f"Missing 'count' field: {data}"
            print(f"Live peers: count={data.get('count')}, source={data.get('source')}")
        else:
            print(f"Live peers endpoint returned {response.status_code} (expected for unreachable server)")
    
    def test_live_sync_endpoint_exists(self):
        """Test POST /api/rustdesk/live/sync endpoint exists"""
        response = requests.post(f"{BASE_URL}/api/rustdesk/live/sync", json={}, headers=self.headers)
        # May return 400 if server not configured, or 502 if server unreachable, or 200 with sync result
        assert response.status_code in [200, 400, 502], f"Unexpected status: {response.status_code} - {response.text}"
        if response.status_code == 200:
            data = response.json()
            assert "synced" in data or "message" in data, f"Missing sync result fields: {data}"
            print(f"Sync result: {data}")
        else:
            print(f"Sync endpoint returned {response.status_code} (expected for unreachable server)")
    
    def test_live_audit_endpoint_exists(self):
        """Test GET /api/rustdesk/live/audit endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/rustdesk/live/audit", headers=self.headers)
        assert response.status_code == 200, f"Endpoint failed: {response.text}"
        data = response.json()
        assert "logs" in data, f"Missing 'logs' field: {data}"
        print(f"Audit logs: count={len(data.get('logs', []))}, source={data.get('source')}")


class TestRustDeskExistingEndpoints:
    """Tests for existing RustDesk endpoints (regression)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token before each test"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_all_devices(self):
        """Test GET /api/rustdesk/all-devices returns device list"""
        response = requests.get(f"{BASE_URL}/api/rustdesk/all-devices", headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Should return list of devices"
        print(f"All devices count: {len(data)}")
    
    def test_get_sessions(self):
        """Test GET /api/rustdesk/sessions returns session list"""
        response = requests.get(f"{BASE_URL}/api/rustdesk/sessions", headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Should return list of sessions"
        print(f"Sessions count: {len(data)}")
    
    def test_get_agent_deployments(self):
        """Test GET /api/rustdesk/agent-deployments returns deployment stats"""
        response = requests.get(f"{BASE_URL}/api/rustdesk/agent-deployments", headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "total" in data, "Missing 'total' field"
        assert "deployments" in data, "Missing 'deployments' field"
        print(f"Deployments: total={data.get('total')}, pending={data.get('pending')}, deployed={data.get('deployed')}")


class TestNotificationsRegression:
    """Regression tests for Notifications page"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token before each test"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_notifications(self):
        """Test GET /api/notifications returns notifications"""
        response = requests.get(f"{BASE_URL}/api/notifications", headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Should return list of notifications"
        print(f"Notifications count: {len(data)}")
    
    def test_generate_notifications(self):
        """Test POST /api/notifications/generate creates notifications"""
        response = requests.post(f"{BASE_URL}/api/notifications/generate", json={}, headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "generated" in data or "message" in data, f"Unexpected response: {data}"
        print(f"Generate notifications result: {data}")


class TestKanbanRegression:
    """Regression tests for Kanban board"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token before each test"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_kanban_board(self):
        """Test GET /api/kanban-tickets/board returns board with 5 columns"""
        response = requests.get(f"{BASE_URL}/api/kanban-tickets/board", headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "columns" in data, "Missing 'columns' field"
        columns = data["columns"]
        assert len(columns) == 5, f"Expected 5 columns, got {len(columns)}"
        column_ids = [c["id"] for c in columns]
        expected_ids = ["open", "in_progress", "waiting", "resolved", "closed"]
        for expected in expected_ids:
            assert expected in column_ids, f"Missing column: {expected}"
        print(f"Kanban board: {len(columns)} columns, column_ids={column_ids}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
