"""
Iteration 114: Huntress UI Features - ResponseTimeline and IdentityThreatPage
Tests for:
1. GET /api/huntress/actions - audit trail endpoint
2. GET /api/huntress/status - configuration status
3. GET /api/soc/identity-threats - identity threats endpoint
4. GET /api/huntress/incident-reports - for identity filtering
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHuntressActionsEndpoint:
    """Tests for GET /api/huntress/actions - Response Timeline data"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.token = login_response.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_huntress_actions_returns_200(self):
        """GET /api/huntress/actions should return 200"""
        response = requests.get(f"{BASE_URL}/api/huntress/actions", headers=self.headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    
    def test_get_huntress_actions_returns_list(self):
        """GET /api/huntress/actions should return a list"""
        response = requests.get(f"{BASE_URL}/api/huntress/actions", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
    
    def test_get_huntress_actions_with_limit(self):
        """GET /api/huntress/actions?limit=5 should respect limit"""
        response = requests.get(f"{BASE_URL}/api/huntress/actions?limit=5", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) <= 5, f"Expected max 5 items, got {len(data)}"
    
    def test_get_huntress_actions_row_structure(self):
        """Each action row should have required fields"""
        response = requests.get(f"{BASE_URL}/api/huntress/actions?limit=1", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        if len(data) > 0:
            row = data[0]
            # Check required fields
            assert "action" in row, "Missing 'action' field"
            assert "timestamp" in row, "Missing 'timestamp' field"
            assert "by" in row, "Missing 'by' field"
            assert "result" in row, "Missing 'result' field"
            # Check result structure
            assert "success" in row["result"], "Missing 'result.success' field"
    
    def test_get_huntress_actions_sorted_desc(self):
        """Actions should be sorted by timestamp descending"""
        response = requests.get(f"{BASE_URL}/api/huntress/actions?limit=10", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        if len(data) > 1:
            timestamps = [row.get("timestamp", "") for row in data]
            assert timestamps == sorted(timestamps, reverse=True), "Actions not sorted by timestamp desc"
    
    def test_get_huntress_actions_requires_auth(self):
        """GET /api/huntress/actions should require authentication"""
        response = requests.get(f"{BASE_URL}/api/huntress/actions")
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"


class TestHuntressStatusEndpoint:
    """Tests for GET /api/huntress/status"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200
        self.token = login_response.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_huntress_status_returns_200(self):
        """GET /api/huntress/status should return 200"""
        response = requests.get(f"{BASE_URL}/api/huntress/status", headers=self.headers)
        assert response.status_code == 200
    
    def test_get_huntress_status_has_configured_field(self):
        """Status should include 'configured' boolean"""
        response = requests.get(f"{BASE_URL}/api/huntress/status", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "configured" in data, "Missing 'configured' field"
        assert isinstance(data["configured"], bool), "'configured' should be boolean"


class TestIdentityThreatsEndpoint:
    """Tests for GET /api/soc/identity-threats"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200
        self.token = login_response.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_identity_threats_returns_200(self):
        """GET /api/soc/identity-threats should return 200"""
        response = requests.get(f"{BASE_URL}/api/soc/identity-threats", headers=self.headers)
        assert response.status_code == 200
    
    def test_get_identity_threats_has_threats_list(self):
        """Response should include 'threats' list"""
        response = requests.get(f"{BASE_URL}/api/soc/identity-threats", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "threats" in data, "Missing 'threats' field"
        assert isinstance(data["threats"], list), "'threats' should be a list"
    
    def test_get_identity_threats_has_summary(self):
        """Response should include 'summary' object"""
        response = requests.get(f"{BASE_URL}/api/soc/identity-threats", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "summary" in data, "Missing 'summary' field"
        summary = data["summary"]
        assert "total" in summary, "Missing 'summary.total'"
        assert "critical" in summary, "Missing 'summary.critical'"


class TestHuntressIncidentReportsEndpoint:
    """Tests for GET /api/huntress/incident-reports (used by IdentityThreatPage)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200
        self.token = login_response.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_incident_reports_returns_200_or_503(self):
        """GET /api/huntress/incident-reports should return 200 (configured) or 503 (not configured)"""
        response = requests.get(f"{BASE_URL}/api/huntress/incident-reports", headers=self.headers)
        assert response.status_code in [200, 503], f"Expected 200 or 503, got {response.status_code}"
    
    def test_get_incident_reports_with_limit(self):
        """GET /api/huntress/incident-reports?limit=10 should work"""
        response = requests.get(f"{BASE_URL}/api/huntress/incident-reports?limit=10", headers=self.headers)
        # May return 503 if not configured, which is acceptable
        assert response.status_code in [200, 503]


class TestRegressionHuntressSummary:
    """Regression tests for Huntress summary endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200
        self.token = login_response.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_huntress_summary_returns_200(self):
        """GET /api/huntress/summary should return 200"""
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=self.headers)
        assert response.status_code == 200
    
    def test_get_huntress_summary_has_configured_field(self):
        """Summary should include 'configured' field"""
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "configured" in data


class TestRegressionSOCDashboard:
    """Regression tests for SOC dashboard endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200
        self.token = login_response.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_soc_dashboard_returns_200(self):
        """GET /api/soc/dashboard should return 200"""
        response = requests.get(f"{BASE_URL}/api/soc/dashboard", headers=self.headers)
        assert response.status_code == 200
