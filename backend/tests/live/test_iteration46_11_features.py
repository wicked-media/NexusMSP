"""
Iteration 46 - Testing 11 New Features (Phase F)
Features: Self-Healing, Predictive Failure, Usage Billing, Pricing Calculator,
Comms Timeline, QBR Generator, Zero Trust, Webhook Builder, Git Scripts, 
Late Payment AI, Ransomware Tabletop
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")

@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ─── 1. AI Self-Healing Tests ───
class TestSelfHealing:
    """Self-Healing AI Engine - /self-healing endpoints"""
    
    def test_dashboard(self, headers):
        """Test GET /api/self-healing/dashboard - loads dashboard with events"""
        response = requests.get(f"{BASE_URL}/api/self-healing/dashboard", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "events" in data, "Response missing 'events'"
        assert "summary" in data, "Response missing 'summary'"
        assert "runbook_stats" in data, "Response missing 'runbook_stats'"
        assert "timeline_24h" in data, "Response missing 'timeline_24h'"
        # Verify summary structure
        summary = data["summary"]
        assert "healed" in summary
        assert "heal_rate_pct" in summary
        assert "total_time_saved_hours" in summary
        print(f"✓ Self-Healing Dashboard: {summary['healed']} healed, {summary['heal_rate_pct']}% success rate")
    
    def test_runbooks_list(self, headers):
        """Test GET /api/self-healing/runbooks - lists runbooks"""
        response = requests.get(f"{BASE_URL}/api/self-healing/runbooks", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Runbooks should be a list"
        assert len(data) > 0, "Should have at least one runbook"
        # Verify runbook structure
        rb = data[0]
        assert "name" in rb
        assert "steps" in rb
        assert "success_rate_pct" in rb
        print(f"✓ Self-Healing Runbooks: {len(data)} runbooks available")
    
    def test_simulate_issue(self, headers):
        """Test POST /api/self-healing/simulate - triggers simulation"""
        payload = {
            "issue_type": "disk_space_low",
            "description": "Test simulation from pytest",
            "severity": "medium"
        }
        response = requests.post(f"{BASE_URL}/api/self-healing/simulate", json=payload, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "id" in data, "Simulated event should have an ID"
        assert data.get("simulated") == True, "Event should be marked as simulated"
        assert data.get("status") in ["detected", "executing"], f"Unexpected status: {data.get('status')}"
        print(f"✓ Simulated issue created: {data['id']} - status: {data['status']}")


# ─── 2. Predictive Failure Tests ───
class TestPredictiveFailure:
    """Predictive Failure Detection - /predictive-failure endpoints"""
    
    def test_overview(self, headers):
        """Test GET /api/predictive-failure/overview"""
        response = requests.get(f"{BASE_URL}/api/predictive-failure/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "predictions" in data
        assert "summary" in data
        summary = data["summary"]
        assert "total_predictions" in summary
        assert "critical" in summary
        assert "accuracy_pct" in summary
        # Verify prediction structure
        if len(data["predictions"]) > 0:
            pred = data["predictions"][0]
            assert "risk_level" in pred
            assert "device_name" in pred
            assert "days_until_failure" in pred
        print(f"✓ Predictive Failure: {summary['total_predictions']} predictions, {summary['critical']} critical")


# ─── 3. Usage Billing Tests ───
class TestUsageBilling:
    """Usage-Based Billing - /usage-billing endpoints"""
    
    def test_overview(self, headers):
        """Test GET /api/usage-billing/overview"""
        response = requests.get(f"{BASE_URL}/api/usage-billing/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "plans" in data
        assert "summary" in data
        summary = data["summary"]
        assert "total_mrr" in summary
        assert "total_clients" in summary
        assert summary["total_mrr"] > 0, "MRR should be positive"
        print(f"✓ Usage Billing: ${summary['total_mrr']} MRR across {summary['total_clients']} clients")


# ─── 4. Pricing Calculator Tests ───
class TestPricingCalculator:
    """Dynamic Pricing Calculator - /pricing-calc endpoints"""
    
    def test_overview(self, headers):
        """Test GET /api/pricing-calc/overview"""
        response = requests.get(f"{BASE_URL}/api/pricing-calc/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "calculations" in data
        assert "defaults" in data
        defaults = data["defaults"]
        assert "labor_rate_hour" in defaults
        assert "target_margin_pct" in defaults
        print(f"✓ Pricing Calculator overview loaded with {len(data['calculations'])} calculations")
    
    def test_calculate(self, headers):
        """Test POST /api/pricing-calc/calculate"""
        payload = {
            "devices": 25,
            "users": 50,
            "labor_hours_month": 12,
            "labor_rate": 125,
            "target_margin_pct": 45
        }
        response = requests.post(f"{BASE_URL}/api/pricing-calc/calculate", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "suggested_mrr" in data
        assert "per_device" in data
        assert "per_user" in data
        assert "cost_breakdown" in data
        assert data["suggested_mrr"] > 0, "Suggested MRR should be positive"
        assert data["per_device"] > 0, "Per device rate should be positive"
        print(f"✓ Pricing Calculator: Suggested MRR ${data['suggested_mrr']}, per device ${data['per_device']}")


# ─── 5. Comms Timeline Tests ───
class TestCommsTimelineCompatibility:
    """Retired Comms Timeline API only exposes genuine client communication records."""
    
    def test_overview(self, headers):
        """Test GET /api/comms-timeline/overview - returns list of clients"""
        response = requests.get(f"{BASE_URL}/api/comms-timeline/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        # Note: This endpoint returns a list, not an object
        assert isinstance(data, list), "Overview should return a list"
        assert len(data) > 0, "Should list real clients even when no mail has been sent"
        client = data[0]
        assert "client_name" in client
        assert "total_interactions" in client
        print(f"✓ Comms Timeline Overview: {len(data)} clients")
    
    def test_client_detail(self, headers):
        """Test GET /api/comms-timeline/client/{name}"""
        overview = requests.get(f"{BASE_URL}/api/comms-timeline/overview", headers=headers).json()
        client_name = overview[0]["client_name"]
        response = requests.get(f"{BASE_URL}/api/comms-timeline/client/{client_name}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "events" in data
        assert "summary" in data
        assert data["client_name"] == client_name
        print(f"✓ Comms Timeline Client: {client_name} has {len(data['events'])} events")


# ─── 6. QBR Generator Tests ───
class TestQBRGenerator:
    """Quarterly Business Review Generator - /qbr-generator endpoints"""
    
    def test_list(self, headers):
        """Test GET /api/qbr-generator/list"""
        response = requests.get(f"{BASE_URL}/api/qbr-generator/list", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Should return a list of QBRs"
        if len(data) > 0:
            qbr = data[0]
            assert "client_name" in qbr
            assert "quarter" in qbr
            assert "status" in qbr
            if "sections" in qbr:
                assert "executive_summary" in qbr["sections"]
        print(f"✓ QBR Generator: {len(data)} QBR reports")


# ─── 7. Zero Trust Tests ───
class TestZeroTrust:
    """Zero Trust Policy Manager - /zero-trust endpoints"""
    
    def test_overview(self, headers):
        """Test GET /api/zero-trust/overview"""
        response = requests.get(f"{BASE_URL}/api/zero-trust/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "policies" in data
        assert "events" in data
        assert "summary" in data
        summary = data["summary"]
        assert "active" in summary
        assert "blocked_today" in summary
        assert "trust_score" in summary
        # Verify policy structure
        if len(data["policies"]) > 0:
            pol = data["policies"][0]
            assert "name" in pol
            assert "condition" in pol
            assert "action" in pol
        print(f"✓ Zero Trust: {summary['active']} active policies, {summary['blocked_today']} blocked today")


# ─── 8. Webhook Builder Tests ───
class TestWebhookBuilder:
    """Custom Webhook Builder - /webhook-builder endpoints"""
    
    def test_list(self, headers):
        """Test GET /api/webhook-builder/list"""
        response = requests.get(f"{BASE_URL}/api/webhook-builder/list", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Should return a list of webhooks"
        if len(data) > 0:
            hook = data[0]
            assert "name" in hook
            assert "trigger" in hook
            assert "url" in hook
            assert "status" in hook
        print(f"✓ Webhook Builder: {len(data)} webhooks configured")


# ─── 9. Git Scripts Tests ───
class TestGitScripts:
    """Git Script Library - /git-scripts endpoints"""
    
    def test_list(self, headers):
        """Test GET /api/git-scripts/list"""
        response = requests.get(f"{BASE_URL}/api/git-scripts/list", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Should return a list of scripts"
        if len(data) > 0:
            script = data[0]
            assert "name" in script
            assert "language" in script
            assert "content" in script
            assert "commits" in script
            assert "version" in script
        print(f"✓ Git Scripts: {len(data)} scripts in library")


# ─── 10. Late Payment AI Tests ───
class TestLatePayment:
    """Late Payment Predictor - /late-payment endpoints"""
    
    def test_predictions(self, headers):
        """Test GET /api/late-payment/predictions"""
        response = requests.get(f"{BASE_URL}/api/late-payment/predictions", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "predictions" in data
        assert "summary" in data
        summary = data["summary"]
        assert "total_clients" in summary
        assert "high_risk" in summary
        assert "total_at_risk" in summary
        # Verify prediction structure
        if len(data["predictions"]) > 0:
            pred = data["predictions"][0]
            assert "client_name" in pred
            assert "risk" in pred
            assert "probability_pct" in pred
        print(f"✓ Late Payment: {summary['total_clients']} clients, {summary['high_risk']} high risk, ${summary['total_at_risk']} at risk")


# ─── 11. Ransomware Tabletop Tests ───
class TestRansomwareTabletop:
    """Ransomware Tabletop Exercises - /ransomware-tabletop endpoints"""
    
    def test_scenarios(self, headers):
        """Test GET /api/ransomware-tabletop/scenarios"""
        response = requests.get(f"{BASE_URL}/api/ransomware-tabletop/scenarios", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Should return a list of scenarios"
        assert len(data) > 0, "Should have at least one scenario"
        scenario = data[0]
        assert "name" in scenario
        assert "description" in scenario
        assert "phases" in scenario
        assert "difficulty" in scenario
        print(f"✓ Ransomware Tabletop: {len(data)} scenarios available")
        return data[0]["id"]
    
    def test_start_drill(self, headers):
        """Test POST /api/ransomware-tabletop/start/{id}"""
        # First get scenarios to get a valid ID
        response = requests.get(f"{BASE_URL}/api/ransomware-tabletop/scenarios", headers=headers)
        scenarios = response.json()
        scenario_id = scenarios[0]["id"]
        
        # Start the drill
        response = requests.post(f"{BASE_URL}/api/ransomware-tabletop/start/{scenario_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data.get("status") == "in_progress"
        assert "phases" in data
        assert data["scenario_id"] == scenario_id
        print(f"✓ Started drill: {data['id']} - scenario: {data['scenario_name']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
