"""
Iteration 44 Test Suite - Phase D Security Features + Operations
Tests new 21 feature batch: Security Dashboard, Endpoint Security, Ransomware Canary,
Kanban Tickets, Recurring Invoices, Identity Threats, SOC Feed, Vulnerability Scanner,
Remediation Playbooks, Third Party Patching, Audit Trail, Password Rotation, Threat Timeline
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestAuth:
    """Authentication for API access"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.json().get("token")
    
    @pytest.fixture
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestSecurityDashboard(TestAuth):
    """Security Dashboard API tests"""
    
    def test_security_overview(self, headers):
        """Test GET /api/security-dashboard/overview returns summary data"""
        response = requests.get(f"{BASE_URL}/api/security-dashboard/overview", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify summary structure
        assert "summary" in data, "Missing summary in response"
        summary = data["summary"]
        assert "security_score" in summary, "Missing security_score"
        assert "total_endpoints" in summary, "Missing total_endpoints"
        assert "patch_compliance_pct" in summary, "Missing patch_compliance_pct"
        assert "active_threats" in summary, "Missing active_threats"
        assert "identity_alerts" in summary, "Missing identity_alerts"
        assert "canary_triggers" in summary, "Missing canary_triggers"
        
        # Verify data types
        assert isinstance(summary["security_score"], (int, float)), "security_score should be numeric"
        assert isinstance(summary["total_endpoints"], int), "total_endpoints should be int"
        print(f"Security Overview: score={summary['security_score']}, endpoints={summary['total_endpoints']}")
    
    def test_security_score_trend(self, headers):
        """Test GET /api/security-dashboard/score-trend returns trend data"""
        response = requests.get(f"{BASE_URL}/api/security-dashboard/score-trend", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "score-trend should return list"
        assert len(data) > 0, "score-trend should have data"
        assert "date" in data[0], "Each item should have date"
        assert "score" in data[0], "Each item should have score"
        print(f"Score trend: {len(data)} data points")


class TestEndpointSecurity(TestAuth):
    """Endpoint Security API tests"""
    
    def test_endpoint_scores(self, headers):
        """Test GET /api/endpoint-security/scores returns endpoint data"""
        response = requests.get(f"{BASE_URL}/api/endpoint-security/scores", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "summary" in data, "Missing summary"
        assert "scores" in data, "Missing scores"
        
        summary = data["summary"]
        assert "avg_score" in summary, "Missing avg_score"
        assert "a_count" in summary, "Missing grade counts"
        
        if data["scores"]:
            score = data["scores"][0]
            assert "device_id" in score, "Missing device_id"
            assert "overall_score" in score, "Missing overall_score"
            assert "grade" in score, "Missing grade"
        print(f"Endpoint scores: avg={summary['avg_score']}, total={len(data['scores'])} devices")


class TestRansomwareCanary(TestAuth):
    """Ransomware Canary API tests"""
    
    def test_canary_status(self, headers):
        """Test GET /api/ransomware-canary/status returns canary data"""
        response = requests.get(f"{BASE_URL}/api/ransomware-canary/status", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "summary" in data, "Missing summary"
        assert "canaries" in data, "Missing canaries"
        assert "triggers" in data, "Missing triggers"
        
        summary = data["summary"]
        assert "deployed" in summary, "Missing deployed count"
        assert "active" in summary, "Missing active count"
        assert "triggered" in summary, "Missing triggered count"
        print(f"Canary status: deployed={summary['deployed']}, active={summary['active']}, triggered={summary['triggered']}")


class TestKanbanTickets(TestAuth):
    """Kanban Board API tests"""
    
    def test_kanban_board(self, headers):
        """Test GET /api/kanban-tickets/board returns board data"""
        response = requests.get(f"{BASE_URL}/api/kanban-tickets/board", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "columns" in data, "Missing columns"
        assert "total_tickets" in data, "Missing total_tickets"
        assert isinstance(data["columns"], list), "columns should be list"
        
        # Verify column structure
        column_ids = [c["id"] for c in data["columns"]]
        assert "open" in column_ids, "Missing open column"
        assert "in_progress" in column_ids, "Missing in_progress column"
        print(f"Kanban board: {len(data['columns'])} columns, {data['total_tickets']} tickets")


class TestRecurringInvoices(TestAuth):
    """Recurring Invoices API tests"""
    
    def test_list_recurring_invoices(self, headers):
        """Test GET /api/recurring-invoices/list returns invoices"""
        response = requests.get(f"{BASE_URL}/api/recurring-invoices/list", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Should return list"
        if data:
            inv = data[0]
            assert "id" in inv, "Missing id"
            assert "client_name" in inv, "Missing client_name"
            assert "amount" in inv, "Missing amount"
            assert "frequency" in inv, "Missing frequency"
        print(f"Recurring invoices: {len(data)} found")


class TestIdentityThreats(TestAuth):
    """Identity Threats API tests"""
    
    def test_identity_overview(self, headers):
        """Test GET /api/identity-threats/overview returns threat data"""
        response = requests.get(f"{BASE_URL}/api/identity-threats/overview", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "summary" in data, "Missing summary"
        assert "threats" in data, "Missing threats"
        
        summary = data["summary"]
        assert "total_alerts" in summary, "Missing total_alerts"
        assert "active" in summary, "Missing active count"
        assert "critical" in summary, "Missing critical count"
        print(f"Identity threats: total={summary['total_alerts']}, active={summary['active']}, critical={summary['critical']}")


class TestSocFeed(TestAuth):
    """SOC Feed API tests"""
    
    def test_soc_events(self, headers):
        """Test GET /api/soc-feed/events returns events"""
        response = requests.get(f"{BASE_URL}/api/soc-feed/events", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Should return list"
        if data:
            event = data[0]
            assert "id" in event, "Missing id"
            assert "type" in event, "Missing type"
            assert "title" in event, "Missing title"
        print(f"SOC events: {len(data)} found")
    
    def test_soc_stats(self, headers):
        """Test GET /api/soc-feed/stats returns statistics"""
        response = requests.get(f"{BASE_URL}/api/soc-feed/stats", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "total_events" in data, "Missing total_events"
        assert "avg_response_time_min" in data, "Missing avg_response_time_min"
        print(f"SOC stats: {data['total_events']} events, avg response {data['avg_response_time_min']}min")


class TestVulnerabilityScanner(TestAuth):
    """Vulnerability Scanner API tests"""
    
    def test_vuln_overview(self, headers):
        """Test GET /api/vulnerability-scanner/overview returns summary"""
        response = requests.get(f"{BASE_URL}/api/vulnerability-scanner/overview", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "summary" in data, "Missing summary"
        assert "vulnerabilities" in data, "Missing vulnerabilities"
        
        summary = data["summary"]
        assert "total" in summary, "Missing total"
        assert "critical" in summary, "Missing critical"
        assert "high" in summary, "Missing high"
        print(f"Vulnerabilities: total={summary['total']}, critical={summary['critical']}, high={summary['high']}")
    
    def test_vulns_by_client(self, headers):
        """Test GET /api/vulnerability-scanner/by-client returns grouped data"""
        response = requests.get(f"{BASE_URL}/api/vulnerability-scanner/by-client", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Should return list"
        if data:
            assert "client_name" in data[0], "Missing client_name"
            assert "total" in data[0], "Missing total"
        print(f"Vuln by client: {len(data)} clients")


class TestRemediationPlaybooks(TestAuth):
    """Remediation Playbooks API tests"""
    
    def test_list_playbooks(self, headers):
        """Test GET /api/remediation-playbooks/list returns playbooks"""
        response = requests.get(f"{BASE_URL}/api/remediation-playbooks/list", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Should return list"
        if data:
            pb = data[0]
            assert "id" in pb, "Missing id"
            assert "name" in pb, "Missing name"
            assert "steps" in pb, "Missing steps"
        print(f"Playbooks: {len(data)} found")


class TestThirdPartyPatching(TestAuth):
    """Third Party Patching API tests"""
    
    def test_patching_overview(self, headers):
        """Test GET /api/third-party-patching/overview returns data"""
        response = requests.get(f"{BASE_URL}/api/third-party-patching/overview", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify structure
        assert isinstance(data, dict) or isinstance(data, list), "Should return dict or list"
        print(f"Third party patching: response received")


class TestAuditTrail(TestAuth):
    """Audit Trail API tests"""
    
    def test_audit_events(self, headers):
        """Test GET /api/audit-trail/events returns audit entries"""
        response = requests.get(f"{BASE_URL}/api/audit-trail/events", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Should return list"
        if data:
            event = data[0]
            assert "id" in event, "Missing id"
            assert "action" in event, "Missing action"
            assert "user" in event, "Missing user"
        print(f"Audit trail: {len(data)} events")
    
    def test_audit_summary(self, headers):
        """Test GET /api/audit-trail/summary returns summary"""
        response = requests.get(f"{BASE_URL}/api/audit-trail/summary", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "total_events" in data, "Missing total_events"
        print(f"Audit summary: {data['total_events']} total events")


class TestPasswordRotation(TestAuth):
    """Password Rotation API tests"""
    
    def test_rotation_policies(self, headers):
        """Test GET /api/password-rotation/policies returns policies"""
        response = requests.get(f"{BASE_URL}/api/password-rotation/policies", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Should return list"
        if data:
            policy = data[0]
            assert "id" in policy, "Missing id"
            assert "name" in policy, "Missing name"
            assert "rotation_days" in policy, "Missing rotation_days"
        print(f"Password rotation: {len(data)} policies")
    
    def test_rotation_history(self, headers):
        """Test GET /api/password-rotation/history returns history"""
        response = requests.get(f"{BASE_URL}/api/password-rotation/history", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Should return list"
        print(f"Password rotation history: {len(data)} records")


class TestThreatTimeline(TestAuth):
    """Threat Timeline API tests"""
    
    def test_threat_timeline(self, headers):
        """Test GET /api/threat-timeline/events returns timeline"""
        response = requests.get(f"{BASE_URL}/api/threat-timeline/events", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list) or "events" in data, "Should return list or dict with events"
        print(f"Threat timeline: response received")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
