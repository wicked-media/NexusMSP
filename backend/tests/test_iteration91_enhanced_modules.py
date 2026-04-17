"""
Iteration 91 - Enhanced Modules Testing
Tests for: Profitability Heatmap, Contract Profitability, CSAT Surveys, 
Patch Compliance, Network Topology, Alert Rules Engine
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication for subsequent tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        return data["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        """Headers with auth token"""
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestProfitabilityHeatmap(TestAuth):
    """Profitability Heatmap API tests"""
    
    def test_get_profitability_data(self, headers):
        """GET /api/profitability-heatmap/data - returns summary + client profitability list"""
        response = requests.get(f"{BASE_URL}/api/profitability-heatmap/data", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify summary structure
        assert "summary" in data
        summary = data["summary"]
        assert "total_mrr" in summary
        assert "total_cost" in summary
        assert "total_profit" in summary
        assert "avg_margin" in summary
        assert "unprofitable" in summary
        
        # Verify clients list
        assert "clients" in data
        assert isinstance(data["clients"], list)
        if len(data["clients"]) > 0:
            client = data["clients"][0]
            assert "client_id" in client
            assert "client_name" in client
            assert "mrr" in client
            assert "cost" in client
            assert "profit" in client
            assert "margin_pct" in client
            assert "status" in client


class TestContractProfitability(TestAuth):
    """Contract Profitability API tests"""
    
    def test_get_contract_profit_overview(self, headers):
        """GET /api/contract-profit/overview - returns contracts with profit/margin data"""
        response = requests.get(f"{BASE_URL}/api/contract-profit/overview", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify summary structure
        assert "summary" in data
        summary = data["summary"]
        assert "total_contracts" in summary
        assert "profitable" in summary
        assert "marginal" in summary
        assert "unprofitable" in summary
        assert "total_profit" in summary
        assert "net" in summary
        
        # Verify contracts list
        assert "contracts" in data
        assert isinstance(data["contracts"], list)
        if len(data["contracts"]) > 0:
            contract = data["contracts"][0]
            assert "client_name" in contract
            assert "contract_name" in contract
            assert "monthly_value" in contract
            assert "total_cost" in contract
            assert "profit" in contract
            assert "margin_pct" in contract
            assert "status" in contract


class TestCSATSurveys(TestAuth):
    """CSAT Surveys API tests"""
    
    def test_seed_demo_data(self, headers):
        """POST /api/csat/seed-demo - generates 30 demo survey responses"""
        response = requests.post(f"{BASE_URL}/api/csat/seed-demo", json={}, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data or "count" in data or "seeded" in data
    
    def test_get_csat_dashboard(self, headers):
        """GET /api/csat/dashboard - returns avg_score, distribution, by_tech, by_client"""
        response = requests.get(f"{BASE_URL}/api/csat/dashboard", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify dashboard structure
        assert "avg_score" in data
        assert "total_responses" in data
        assert "distribution" in data
        assert "by_tech" in data
        assert "by_client" in data
        
        # Verify distribution is a dict with 1-5 keys
        assert isinstance(data["distribution"], dict)
        
        # Verify by_tech and by_client are lists
        assert isinstance(data["by_tech"], list)
        assert isinstance(data["by_client"], list)
    
    def test_get_csat_surveys(self, headers):
        """GET /api/csat/surveys - returns list of survey responses"""
        response = requests.get(f"{BASE_URL}/api/csat/surveys", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)


class TestPatchCompliance(TestAuth):
    """Patch Compliance API tests"""
    
    def test_get_patch_compliance_overview(self, headers):
        """GET /api/patch-compliance/overview - returns compliance summary + policies + devices"""
        response = requests.get(f"{BASE_URL}/api/patch-compliance/overview", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify summary structure
        assert "summary" in data
        summary = data["summary"]
        assert "compliance_pct" in summary
        assert "total_devices" in summary
        assert "compliant" in summary
        assert "needs_attention" in summary
        assert "critical" in summary
        
        # Verify policies list
        assert "policies" in data
        assert isinstance(data["policies"], list)
        
        # Verify devices list
        assert "devices" in data
        assert isinstance(data["devices"], list)
    
    def test_get_patch_compliance_rings(self, headers):
        """GET /api/patch-compliance/rings - returns 4 deployment rings"""
        response = requests.get(f"{BASE_URL}/api/patch-compliance/rings", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list)
        assert len(data) == 4, f"Expected 4 rings, got {len(data)}"
        
        # Verify ring structure
        for ring in data:
            assert "id" in ring
            assert "name" in ring
            assert "description" in ring
            assert "delay_days" in ring
            assert "device_count" in ring
            assert "auto_approve" in ring


class TestNetworkTopology(TestAuth):
    """Network Topology API tests"""
    
    def test_get_topology_all(self, headers):
        """GET /api/topology/all - returns client topology summary"""
        response = requests.get(f"{BASE_URL}/api/topology/all", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list)
        if len(data) > 0:
            client = data[0]
            assert "client_id" in client
            assert "client_name" in client
            assert "device_count" in client
            assert "health_pct" in client
    
    def test_get_topology_by_client(self, headers):
        """GET /api/topology/{client_id} - returns nodes and edges for network map"""
        # First get list of clients
        response = requests.get(f"{BASE_URL}/api/topology/all", headers=headers)
        assert response.status_code == 200
        clients = response.json()
        
        if len(clients) > 0:
            client_id = clients[0]["client_id"]
            response = requests.get(f"{BASE_URL}/api/topology/{client_id}", headers=headers)
            assert response.status_code == 200, f"Failed: {response.text}"
            data = response.json()
            
            # Verify topology structure
            assert "client_id" in data or "client_name" in data
            assert "nodes" in data
            assert "edges" in data
            assert isinstance(data["nodes"], list)
            assert isinstance(data["edges"], list)
            
            # Verify node structure if nodes exist
            if len(data["nodes"]) > 0:
                node = data["nodes"][0]
                assert "id" in node
                assert "label" in node
                assert "type" in node
                assert "status" in node


class TestAlertRules(TestAuth):
    """Alert Rules Engine API tests"""
    
    def test_get_alert_rules(self, headers):
        """GET /api/alert-rules - returns seeded alert rules"""
        response = requests.get(f"{BASE_URL}/api/alert-rules", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list)
        assert len(data) >= 5, f"Expected at least 5 seeded rules, got {len(data)}"
        
        # Verify rule structure
        rule = data[0]
        assert "id" in rule
        assert "name" in rule
        assert "metric" in rule
        assert "operator" in rule
        assert "threshold" in rule
        assert "severity" in rule
        assert "enabled" in rule
        assert "actions" in rule
    
    def test_get_alert_rules_options(self, headers):
        """GET /api/alert-rules/options - returns metrics, operators, actions"""
        response = requests.get(f"{BASE_URL}/api/alert-rules/options", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "metrics" in data
        assert "operators" in data
        assert "actions" in data
        
        assert isinstance(data["metrics"], list)
        assert len(data["metrics"]) > 0
        
        assert isinstance(data["operators"], list)
        assert len(data["operators"]) > 0
        
        # Verify metric structure
        metric = data["metrics"][0]
        assert "id" in metric
        assert "label" in metric
    
    def test_get_alert_rules_stats(self, headers):
        """GET /api/alert-rules/stats - returns rule statistics"""
        response = requests.get(f"{BASE_URL}/api/alert-rules/stats", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "total" in data
        assert "active" in data
        assert "total_triggered" in data
    
    def test_create_alert_rule(self, headers):
        """POST /api/alert-rules - creates a new rule"""
        new_rule = {
            "name": "TEST_Memory High Alert",
            "description": "Test rule for memory monitoring",
            "metric": "memory_usage",
            "operator": "greater_than",
            "threshold": 95,
            "duration_minutes": 5,
            "severity": "high",
            "cooldown_minutes": 30,
            "scope": "all",
            "actions": [{"type": "create_ticket", "config": {"priority": "high"}}]
        }
        
        response = requests.post(f"{BASE_URL}/api/alert-rules", json=new_rule, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "id" in data
        assert data["name"] == new_rule["name"]
        assert data["metric"] == new_rule["metric"]
        assert data["threshold"] == new_rule["threshold"]
        
        # Store rule ID for cleanup
        TestAlertRules.created_rule_id = data["id"]
    
    def test_toggle_alert_rule(self, headers):
        """POST /api/alert-rules/{id}/toggle - enables/disables a rule"""
        # Get existing rules
        response = requests.get(f"{BASE_URL}/api/alert-rules", headers=headers)
        rules = response.json()
        
        if len(rules) > 0:
            rule_id = rules[0]["id"]
            original_state = rules[0]["enabled"]
            
            # Toggle the rule
            response = requests.post(f"{BASE_URL}/api/alert-rules/{rule_id}/toggle", json={}, headers=headers)
            assert response.status_code == 200, f"Failed: {response.text}"
            data = response.json()
            
            assert "enabled" in data
            assert data["enabled"] != original_state
            
            # Toggle back to original state
            response = requests.post(f"{BASE_URL}/api/alert-rules/{rule_id}/toggle", json={}, headers=headers)
            assert response.status_code == 200
    
    def test_delete_alert_rule(self, headers):
        """DELETE /api/alert-rules/{id} - deletes a rule"""
        # Delete the test rule we created
        if hasattr(TestAlertRules, 'created_rule_id'):
            rule_id = TestAlertRules.created_rule_id
            response = requests.delete(f"{BASE_URL}/api/alert-rules/{rule_id}", headers=headers)
            assert response.status_code == 200, f"Failed: {response.text}"
            
            # Verify deletion
            response = requests.get(f"{BASE_URL}/api/alert-rules", headers=headers)
            rules = response.json()
            rule_ids = [r["id"] for r in rules]
            assert rule_id not in rule_ids


class TestAICopilot(TestAuth):
    """AI Copilot API tests"""
    
    def test_copilot_chat(self, headers):
        """POST /api/copilot/chat - responds with AI-generated answer"""
        response = requests.post(f"{BASE_URL}/api/copilot/chat", json={
            "message": "What is the current ticket count?"
        }, headers=headers, timeout=30)
        
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "reply" in data or "response" in data or "message" in data or "answer" in data or "content" in data


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
