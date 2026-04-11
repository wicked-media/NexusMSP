"""
Iteration 78 - Client Health Score Dashboard Tests
Tests for:
- GET /api/client-health/dashboard - Dashboard with KPIs, distribution, alerts, trends
- GET /api/client-health/scores - All client health scores with metrics breakdown
- GET /api/client-health/{client_id}/detail - Detailed health for single client
- POST /api/client-health/snapshot - Take point-in-time health snapshot
- GET /api/client-health/alert-config - Get alert threshold configuration
- PUT /api/client-health/alert-config - Update alert thresholds
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')

class TestClientHealthDashboard:
    """Client Health Dashboard API Tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - authenticate and get token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get token
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.token = login_response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    # ===== Dashboard Endpoint Tests =====
    
    def test_get_health_dashboard(self):
        """Test GET /api/client-health/dashboard returns all expected fields"""
        response = self.session.get(f"{BASE_URL}/api/client-health/dashboard")
        assert response.status_code == 200, f"Dashboard failed: {response.text}"
        
        data = response.json()
        # Verify required fields
        assert "total" in data, "Missing 'total' field"
        assert "avg_health" in data, "Missing 'avg_health' field"
        assert "distribution" in data, "Missing 'distribution' field"
        assert "at_risk" in data, "Missing 'at_risk' field"
        assert "top_clients" in data, "Missing 'top_clients' field"
        assert "alerts" in data, "Missing 'alerts' field"
        
        # Verify data types
        assert isinstance(data["total"], int), "total should be int"
        assert isinstance(data["avg_health"], (int, float)), "avg_health should be numeric"
        assert isinstance(data["distribution"], dict), "distribution should be dict"
        assert isinstance(data["at_risk"], list), "at_risk should be list"
        assert isinstance(data["top_clients"], list), "top_clients should be list"
        assert isinstance(data["alerts"], list), "alerts should be list"
        
        # Verify trend data if present
        if "trend" in data:
            assert isinstance(data["trend"], list), "trend should be list"
        
        print(f"Dashboard: {data['total']} clients, avg health: {data['avg_health']}, alerts: {len(data['alerts'])}")
    
    def test_dashboard_distribution_values(self):
        """Test dashboard distribution contains valid status keys"""
        response = self.session.get(f"{BASE_URL}/api/client-health/dashboard")
        assert response.status_code == 200
        
        data = response.json()
        dist = data.get("distribution", {})
        valid_statuses = ["thriving", "healthy", "needs_attention", "at_risk", "critical"]
        
        for status in dist.keys():
            assert status in valid_statuses, f"Invalid status '{status}' in distribution"
        
        # Sum of distribution should equal total
        total_from_dist = sum(dist.values())
        assert total_from_dist == data["total"], f"Distribution sum {total_from_dist} != total {data['total']}"
        
        print(f"Distribution: {dist}")
    
    def test_dashboard_at_risk_clients(self):
        """Test at_risk clients have health_score < 50"""
        response = self.session.get(f"{BASE_URL}/api/client-health/dashboard")
        assert response.status_code == 200
        
        data = response.json()
        for client in data.get("at_risk", []):
            assert client.get("health_score", 100) < 50, f"At-risk client {client.get('client_name')} has score >= 50"
        
        print(f"At-risk clients: {len(data.get('at_risk', []))}")
    
    def test_dashboard_alerts_structure(self):
        """Test alerts have required fields"""
        response = self.session.get(f"{BASE_URL}/api/client-health/dashboard")
        assert response.status_code == 200
        
        data = response.json()
        for alert in data.get("alerts", [])[:5]:  # Check first 5
            assert "id" in alert, "Alert missing 'id'"
            assert "client_name" in alert, "Alert missing 'client_name'"
            assert "message" in alert, "Alert missing 'message'"
            assert "severity" in alert, "Alert missing 'severity'"
        
        print(f"Alerts count: {len(data.get('alerts', []))}")
    
    # ===== Scores Endpoint Tests =====
    
    def test_get_all_health_scores(self):
        """Test GET /api/client-health/scores returns array of client scores"""
        response = self.session.get(f"{BASE_URL}/api/client-health/scores")
        assert response.status_code == 200, f"Scores failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Scores should return a list"
        assert len(data) > 0, "Should have at least one client"
        
        # Verify first client structure
        client = data[0]
        required_fields = ["client_id", "client_name", "health_score", "status", "metrics", "risk_factors", "positive_factors"]
        for field in required_fields:
            assert field in client, f"Client missing '{field}' field"
        
        # Verify metrics breakdown
        metrics = client.get("metrics", {})
        metric_fields = ["ticket_health", "device_health", "payment_health", "backup_health", "security_health", "engagement"]
        for mf in metric_fields:
            assert mf in metrics, f"Metrics missing '{mf}'"
        
        print(f"Total clients with scores: {len(data)}")
        return data[0]["client_id"]  # Return first client_id for detail test
    
    def test_scores_sorted_by_health(self):
        """Test scores are sorted by health_score ascending (worst first)"""
        response = self.session.get(f"{BASE_URL}/api/client-health/scores")
        assert response.status_code == 200
        
        data = response.json()
        scores = [c["health_score"] for c in data]
        assert scores == sorted(scores), "Scores should be sorted ascending (worst first)"
        
        print(f"Score range: {scores[0]} to {scores[-1]}")
    
    def test_scores_health_range(self):
        """Test all health scores are between 0 and 100"""
        response = self.session.get(f"{BASE_URL}/api/client-health/scores")
        assert response.status_code == 200
        
        data = response.json()
        for client in data:
            score = client.get("health_score", -1)
            assert 0 <= score <= 100, f"Client {client.get('client_name')} has invalid score: {score}"
    
    # ===== Client Detail Endpoint Tests =====
    
    def test_get_client_health_detail(self):
        """Test GET /api/client-health/{client_id}/detail returns detailed health"""
        # First get a valid client_id
        scores_response = self.session.get(f"{BASE_URL}/api/client-health/scores")
        assert scores_response.status_code == 200
        client_id = scores_response.json()[0]["client_id"]
        
        # Get detail
        response = self.session.get(f"{BASE_URL}/api/client-health/{client_id}/detail")
        assert response.status_code == 200, f"Detail failed: {response.text}"
        
        data = response.json()
        # Verify all expected fields
        assert data["client_id"] == client_id, "client_id mismatch"
        assert "client_name" in data, "Missing client_name"
        assert "health_score" in data, "Missing health_score"
        assert "status" in data, "Missing status"
        assert "metrics" in data, "Missing metrics"
        assert "details" in data, "Missing details"
        assert "risk_factors" in data, "Missing risk_factors"
        assert "positive_factors" in data, "Missing positive_factors"
        assert "trend" in data, "Missing trend"
        assert "recent_tickets" in data, "Missing recent_tickets"
        assert "recent_invoices" in data, "Missing recent_invoices"
        
        # Verify details breakdown
        details = data.get("details", {})
        detail_fields = ["open_tickets", "critical_tickets", "devices", "online_devices", "overdue_invoices", "backup_success_rate", "security_alerts"]
        for df in detail_fields:
            assert df in details, f"Details missing '{df}'"
        
        print(f"Client detail: {data['client_name']} - Score: {data['health_score']}, Status: {data['status']}")
    
    def test_client_detail_not_found(self):
        """Test 404 for non-existent client"""
        response = self.session.get(f"{BASE_URL}/api/client-health/nonexistent-client-id/detail")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
    
    # ===== Snapshot Endpoint Tests =====
    
    def test_take_health_snapshot(self):
        """Test POST /api/client-health/snapshot creates snapshot"""
        response = self.session.post(f"{BASE_URL}/api/client-health/snapshot", json={})
        assert response.status_code == 200, f"Snapshot failed: {response.text}"
        
        data = response.json()
        assert "message" in data, "Missing message"
        assert "date" in data, "Missing date"
        assert "avg_health" in data, "Missing avg_health"
        
        print(f"Snapshot: {data['message']}, Date: {data['date']}, Avg: {data['avg_health']}")
    
    # ===== Alert Config Endpoint Tests =====
    
    def test_get_alert_config(self):
        """Test GET /api/client-health/alert-config returns config"""
        response = self.session.get(f"{BASE_URL}/api/client-health/alert-config")
        assert response.status_code == 200, f"Alert config GET failed: {response.text}"
        
        data = response.json()
        # Verify expected fields
        assert "critical_threshold" in data, "Missing critical_threshold"
        assert "warning_threshold" in data, "Missing warning_threshold"
        assert "notify_on_decline" in data, "Missing notify_on_decline"
        assert "auto_create_ticket" in data, "Missing auto_create_ticket"
        
        # Verify types
        assert isinstance(data["critical_threshold"], int), "critical_threshold should be int"
        assert isinstance(data["warning_threshold"], int), "warning_threshold should be int"
        assert isinstance(data["notify_on_decline"], bool), "notify_on_decline should be bool"
        assert isinstance(data["auto_create_ticket"], bool), "auto_create_ticket should be bool"
        
        print(f"Alert config: critical={data['critical_threshold']}, warning={data['warning_threshold']}")
    
    def test_update_alert_config(self):
        """Test PUT /api/client-health/alert-config updates config"""
        # Get current config
        get_response = self.session.get(f"{BASE_URL}/api/client-health/alert-config")
        original_config = get_response.json()
        
        # Update config
        new_config = {
            "critical_threshold": 25,
            "warning_threshold": 55,
            "notify_on_decline": True,
            "decline_amount": 15,
            "notify_email": "test@example.com",
            "auto_create_ticket": False
        }
        
        response = self.session.put(f"{BASE_URL}/api/client-health/alert-config", json=new_config)
        assert response.status_code == 200, f"Alert config PUT failed: {response.text}"
        
        data = response.json()
        assert data["critical_threshold"] == 25, "critical_threshold not updated"
        assert data["warning_threshold"] == 55, "warning_threshold not updated"
        assert data["notify_on_decline"] == True, "notify_on_decline not updated"
        assert data["auto_create_ticket"] == False, "auto_create_ticket not updated"
        
        # Verify persistence with GET
        verify_response = self.session.get(f"{BASE_URL}/api/client-health/alert-config")
        verify_data = verify_response.json()
        assert verify_data["critical_threshold"] == 25, "Config not persisted"
        
        # Restore original config
        self.session.put(f"{BASE_URL}/api/client-health/alert-config", json=original_config)
        
        print("Alert config update and persistence verified")
    
    # ===== Integration Tests =====
    
    def test_dashboard_scores_consistency(self):
        """Test dashboard total matches scores count"""
        dashboard_response = self.session.get(f"{BASE_URL}/api/client-health/dashboard")
        scores_response = self.session.get(f"{BASE_URL}/api/client-health/scores")
        
        assert dashboard_response.status_code == 200
        assert scores_response.status_code == 200
        
        dashboard_total = dashboard_response.json()["total"]
        scores_count = len(scores_response.json())
        
        assert dashboard_total == scores_count, f"Dashboard total {dashboard_total} != scores count {scores_count}"
        
        print(f"Consistency check passed: {dashboard_total} clients")
    
    def test_detail_matches_scores(self):
        """Test client detail health_score matches scores endpoint"""
        scores_response = self.session.get(f"{BASE_URL}/api/client-health/scores")
        assert scores_response.status_code == 200
        
        # Get first client
        first_client = scores_response.json()[0]
        client_id = first_client["client_id"]
        
        # Get detail
        detail_response = self.session.get(f"{BASE_URL}/api/client-health/{client_id}/detail")
        assert detail_response.status_code == 200
        
        detail_data = detail_response.json()
        
        # Scores should match
        assert detail_data["health_score"] == first_client["health_score"], "Health scores don't match"
        assert detail_data["status"] == first_client["status"], "Status doesn't match"
        
        print(f"Detail matches scores for {first_client['client_name']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
