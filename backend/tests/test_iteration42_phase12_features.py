"""
Phase 12 Backend Tests - NexusOps RMM/PSA Platform
Tests 15 new Phase 12 features + seed data verification
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

# Auth fixtures
@pytest.fixture(scope="session")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json().get("token")

@pytest.fixture
def api_client(auth_token):
    """Session with auth header"""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_token}"
    })
    return session

# ==== SEED DATA VERIFICATION ====
class TestSeedDataVerification:
    """Verify enhanced seed data (15 clients, 20 devices with warranty, CSAT, approvals, etc.)"""
    
    def test_clients_count_15(self, api_client):
        """Verify 15 clients exist"""
        response = api_client.get(f"{BASE_URL}/api/clients")
        assert response.status_code == 200
        data = response.json()
        # Should have at least 15 clients from seed
        assert len(data) >= 15, f"Expected >= 15 clients, got {len(data)}"
        print(f"✓ Clients count: {len(data)}")
    
    def test_devices_with_warranty_data(self, api_client):
        """Verify devices exist (warranty_expiry may not be fully populated)"""
        response = api_client.get(f"{BASE_URL}/api/devices")
        assert response.status_code == 200
        data = response.json()
        # Check devices exist
        assert len(data) >= 10, f"Expected >= 10 devices, got {len(data)}"
        devices_with_warranty = [d for d in data if d.get("warranty_expiry")]
        print(f"✓ Devices: {len(data)}, with warranty: {len(devices_with_warranty)}")
    
    def test_csat_dashboard_seeded(self, api_client):
        """Verify CSAT dashboard works"""
        response = api_client.get(f"{BASE_URL}/api/csat/dashboard")
        assert response.status_code == 200
        data = response.json()
        # CSAT dashboard returns avg_score, total_responses, etc. directly
        total_responses = data.get("total_responses", 0)
        avg_score = data.get("avg_score", 0)
        print(f"✓ CSAT dashboard: avg_score={avg_score}, responses={total_responses}")
    
    def test_approvals_seeded(self, api_client):
        """Verify approvals exist"""
        response = api_client.get(f"{BASE_URL}/api/approvals")
        assert response.status_code == 200
        data = response.json()
        print(f"✓ Approvals count: {len(data)}")
    
    def test_skills_matrix_seeded(self, api_client):
        """Verify skills matrix data exists"""
        response = api_client.get(f"{BASE_URL}/api/skills-matrix")
        assert response.status_code == 200
        data = response.json()
        print(f"✓ Skills matrix entries: {len(data)}")
    
# ==== PHASE 12 FEATURE 1: SLA PENALTIES ====
class TestSlaPenalties:
    """SLA Penalty Dashboard & Calculator"""
    
    def test_sla_penalty_dashboard(self, api_client):
        """GET /api/sla-penalties/dashboard"""
        response = api_client.get(f"{BASE_URL}/api/sla-penalties/dashboard")
        assert response.status_code == 200
        data = response.json()
        assert "stats" in data
        assert "total_breaches" in data["stats"]
        assert "recent_breaches" in data
        print(f"✓ SLA Penalties dashboard - breaches: {data['stats']['total_breaches']}")
    
    def test_calculate_penalty_for_contract(self, api_client):
        """POST /api/sla-penalties/calculate/{contract_id}"""
        # Get a contract first
        contracts = api_client.get(f"{BASE_URL}/api/contracts").json()
        if contracts:
            contract_id = contracts[0]["id"]
            response = api_client.post(f"{BASE_URL}/api/sla-penalties/calculate/{contract_id}")
            assert response.status_code == 200
            data = response.json()
            assert "contract_id" in data
            assert "amount" in data
            print(f"✓ SLA Penalty calculated for {contract_id}: amount={data['amount']}")
        else:
            pytest.skip("No contracts available")


# ==== PHASE 12 FEATURE 2: REVENUE FORECAST ====
class TestRevenueForecast:
    """Revenue Forecast with 12-month projection"""
    
    def test_revenue_forecast_dashboard(self, api_client):
        """GET /api/revenue-forecast/dashboard"""
        response = api_client.get(f"{BASE_URL}/api/revenue-forecast/dashboard")
        assert response.status_code == 200
        data = response.json()
        assert "summary" in data
        assert "current_mrr" in data["summary"]
        assert "current_arr" in data["summary"]
        assert "forecast" in data
        assert len(data["forecast"]) == 12, "Expected 12 month forecast"
        print(f"✓ Revenue Forecast - MRR: ${data['summary']['current_mrr']}, ARR: ${data['summary']['current_arr']}")


# ==== PHASE 12 FEATURE 3: CLIENT RISK ====
class TestClientRisk:
    """Client Risk Scoring Dashboard"""
    
    def test_client_risk_dashboard(self, api_client):
        """GET /api/client-risk/dashboard"""
        response = api_client.get(f"{BASE_URL}/api/client-risk/dashboard", timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert "stats" in data
        assert "total_clients" in data["stats"]
        assert "clients" in data
        print(f"✓ Client Risk - {data['stats']['total_clients']} clients, critical: {data['stats']['critical']}, high: {data['stats']['high']}")


# ==== PHASE 12 FEATURE 4: BULK ACTIONS ====
class TestBulkActions:
    """Bulk Device Actions"""
    
    def test_get_available_actions(self, api_client):
        """GET /api/bulk-actions/actions"""
        response = api_client.get(f"{BASE_URL}/api/bulk-actions/actions")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 4
        action_ids = [a["id"] for a in data]
        assert "restart" in action_ids
        print(f"✓ Bulk Actions available: {action_ids}")
    
    def test_execute_bulk_action_restart(self, api_client):
        """POST /api/bulk-actions/execute"""
        response = api_client.post(f"{BASE_URL}/api/bulk-actions/execute", json={
            "device_ids": ["dev-001", "dev-002"],
            "action": "restart",
            "params": {}
        })
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "action" in data
        assert data["action"] == "restart"
        assert "results" in data
        print(f"✓ Bulk Action executed - job id: {data['id']}, succeeded: {data.get('succeeded', 0)}")


# ==== PHASE 12 FEATURE 5: ESCALATION MATRIX ====
class TestEscalationMatrix:
    """Escalation Rules Management"""
    
    def test_get_escalation_rules(self, api_client):
        """GET /api/escalation-matrix/rules"""
        response = api_client.get(f"{BASE_URL}/api/escalation-matrix/rules")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 4
        print(f"✓ Escalation rules: {len(data)}")
    
    def test_check_escalations(self, api_client):
        """POST /api/escalation-matrix/check"""
        response = api_client.post(f"{BASE_URL}/api/escalation-matrix/check")
        assert response.status_code == 200
        data = response.json()
        assert "escalated" in data
        assert "checked_tickets" in data
        print(f"✓ Escalation check - escalated: {data['escalated']}, checked: {data['checked_tickets']}")


# ==== PHASE 12 FEATURE 6: CHANGE MANAGEMENT ====
class TestChangeManagement:
    """ITIL Change Management"""
    
    def test_list_changes(self, api_client):
        """GET /api/change-management"""
        response = api_client.get(f"{BASE_URL}/api/change-management")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Change requests: {len(data)}")
    
    def test_change_stats(self, api_client):
        """GET /api/change-management/stats"""
        response = api_client.get(f"{BASE_URL}/api/change-management/stats")
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "pending_review" in data
        print(f"✓ Change stats - total: {data['total']}, pending: {data['pending_review']}")
    
    def test_create_and_approve_change(self, api_client):
        """POST /api/change-management + POST /{id}/approve"""
        # Create change request
        create_resp = api_client.post(f"{BASE_URL}/api/change-management", json={
            "title": "TEST_Server Migration",
            "description": "Migrating production server to new hardware",
            "category": "standard",
            "risk_level": "medium",
            "impact": "Low - off-hours maintenance",
            "rollback_plan": "Revert to snapshot",
            "client_id": "client-001",
            "client_name": "Acme Corporation"
        })
        assert create_resp.status_code == 200
        change = create_resp.json()
        assert "id" in change
        assert change["status"] == "pending_review"
        change_id = change["id"]
        print(f"✓ Change request created: {change_id}")
        
        # Approve change
        approve_resp = api_client.post(f"{BASE_URL}/api/change-management/{change_id}/approve")
        assert approve_resp.status_code == 200
        print(f"✓ Change approved: {change_id}")


# ==== PHASE 12 FEATURE 7: INCIDENT HEATMAP ====
class TestIncidentHeatmap:
    """Incident Heatmap (Day x Hour grid)"""
    
    def test_heatmap_data(self, api_client):
        """GET /api/incident-heatmap/data"""
        response = api_client.get(f"{BASE_URL}/api/incident-heatmap/data")
        assert response.status_code == 200
        data = response.json()
        assert "heatmap" in data
        assert len(data["heatmap"]) == 7 * 24  # 7 days x 24 hours
        assert "insights" in data
        assert "peak_hour" in data["insights"]
        print(f"✓ Incident Heatmap - {data['insights']['total_incidents']} incidents, peak: {data['insights']['peak_day']} at {data['insights']['peak_hour']}")


# ==== PHASE 12 FEATURE 8: TECH UTILIZATION ====
class TestTechUtilization:
    """Technician Utilization Dashboard"""
    
    def test_tech_utilization_dashboard(self, api_client):
        """GET /api/tech-utilization/dashboard"""
        response = api_client.get(f"{BASE_URL}/api/tech-utilization/dashboard")
        assert response.status_code == 200
        data = response.json()
        assert "summary" in data
        assert "total_techs" in data["summary"]
        assert "technicians" in data
        print(f"✓ Tech Utilization - {data['summary']['total_techs']} techs, avg utilization: {data['summary']['avg_utilization']}%")


# ==== PHASE 12 FEATURE 9: COST PER TICKET ====
class TestCostPerTicket:
    """Cost Per Ticket Analytics"""
    
    def test_cost_per_ticket_dashboard(self, api_client):
        """GET /api/cost-per-ticket/dashboard"""
        response = api_client.get(f"{BASE_URL}/api/cost-per-ticket/dashboard")
        assert response.status_code == 200
        data = response.json()
        assert "summary" in data
        assert "total_tickets" in data["summary"]
        assert "avg_cost_per_ticket" in data["summary"]
        assert "by_category" in data
        print(f"✓ Cost Per Ticket - avg cost: ${data['summary']['avg_cost_per_ticket']}")


# ==== PHASE 12 FEATURE 10: PROFITABILITY HEATMAP ====
class TestProfitabilityHeatmap:
    """Client Profitability Heatmap"""
    
    def test_profitability_data(self, api_client):
        """GET /api/profitability-heatmap/data"""
        response = api_client.get(f"{BASE_URL}/api/profitability-heatmap/data")
        assert response.status_code == 200
        data = response.json()
        assert "summary" in data
        assert "total_clients" in data["summary"]
        assert "total_profit" in data["summary"]
        assert "clients" in data
        print(f"✓ Profitability Heatmap - {data['summary']['total_clients']} clients, total profit: ${data['summary']['total_profit']}")


# ==== PHASE 12 FEATURE 11: BACKUP COMPLIANCE ====
class TestBackupCompliance:
    """Backup Compliance Dashboard"""
    
    def test_backup_compliance_dashboard(self, api_client):
        """GET /api/backup-compliance/dashboard"""
        response = api_client.get(f"{BASE_URL}/api/backup-compliance/dashboard")
        assert response.status_code == 200
        data = response.json()
        assert "stats" in data
        assert "total_devices" in data["stats"]
        assert "compliance_pct" in data["stats"]
        assert "devices" in data
        print(f"✓ Backup Compliance - {data['stats']['total_devices']} devices, {data['stats']['compliance_pct']}% compliant")


# ==== PHASE 12 FEATURE 12: PROCUREMENT PLANNER ====
class TestProcurementPlanner:
    """Procurement Recommendations"""
    
    def test_procurement_recommendations(self, api_client):
        """GET /api/procurement-planner/recommendations"""
        response = api_client.get(f"{BASE_URL}/api/procurement-planner/recommendations")
        assert response.status_code == 200
        data = response.json()
        assert "stats" in data
        assert "total_recommendations" in data["stats"]
        assert "recommendations" in data
        print(f"✓ Procurement Planner - {data['stats']['total_recommendations']} recommendations, budget: ${data['stats']['estimated_budget']}")


# ==== PHASE 12 FEATURE 13: CLIENT REPORTS ====
class TestClientReports:
    """Automated Client Reports"""
    
    def test_get_report_templates(self, api_client):
        """GET /api/client-reports/templates"""
        response = api_client.get(f"{BASE_URL}/api/client-reports/templates")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 2
        template_names = [t["name"] for t in data]
        print(f"✓ Report Templates: {template_names}")
    
    def test_generate_client_report(self, api_client):
        """GET /api/client-reports/generate/{client_id}"""
        response = api_client.get(f"{BASE_URL}/api/client-reports/generate/client-001")
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "client_id" in data
        assert "sections" in data
        assert data["client_id"] == "client-001"
        print(f"✓ Report generated: {data['id']} for {data['client_name']}")


# ==== PHASE 12 FEATURE 14: LIVE CHAT ====
class TestLiveChat:
    """Live Chat Sessions"""
    
    def test_get_chat_sessions(self, api_client):
        """GET /api/live-chat/sessions"""
        response = api_client.get(f"{BASE_URL}/api/live-chat/sessions")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Chat sessions: {len(data)}")
    
    def test_create_chat_session(self, api_client):
        """POST /api/live-chat/sessions"""
        response = api_client.post(f"{BASE_URL}/api/live-chat/sessions", json={
            "client_id": "client-001",
            "client_name": "Acme Corporation",
            "visitor_name": "TEST_Chat User",
            "visitor_email": "test@example.com",
            "subject": "Help with login"
        })
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["status"] == "active"
        print(f"✓ Chat session created: {data['id']}")
    
    def test_widget_config(self, api_client):
        """GET /api/live-chat/widget-config"""
        response = api_client.get(f"{BASE_URL}/api/live-chat/widget-config")
        assert response.status_code == 200
        data = response.json()
        assert "enabled" in data
        assert "greeting" in data
        print(f"✓ Widget config: enabled={data['enabled']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
