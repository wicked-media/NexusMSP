"""
Iteration 99 - Testing Merged Modules (8 groups consolidated)
Tests:
1. Revenue Command Center (4→1): /revenue-forecast, /revenue-tracker, /revenue-tracking
2. AI Triage (3→1): /ticket-triage/analyze, /ai/auto-route
3. Backup Command Center (4→1): /backup-dashboard, /backup-compliance, /backup-verify
4. SLA Manager (4→1): /sla-timer, /sla-penalties, /sla-report-gen
5. Compliance Hub (4→1): /compliance-frameworks, /compliance-generator
6. Dispatch Center (3→1): /dispatch, /scheduling
7. Reports Hub (5→1): /reports, /executive-reports, /client-reports, /financial-reports, /roi-reports
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Authentication failed")

@pytest.fixture(scope="module")
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ── Revenue Command Center Tests ──

class TestRevenueCommandCenter:
    """Tests for merged Revenue module (4→1)"""
    
    def test_revenue_forecast_dashboard(self, headers):
        """GET /api/revenue-forecast/dashboard - MRR/ARR projections"""
        response = requests.get(f"{BASE_URL}/api/revenue-forecast/dashboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "summary" in data or "forecast" in data or "current_mrr" in data
    
    def test_revenue_tracker_overview(self, headers):
        """GET /api/revenue-tracker/overview - Revenue tracking"""
        response = requests.get(f"{BASE_URL}/api/revenue-tracker/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
    
    def test_revenue_tracking_dashboard(self, headers):
        """GET /api/revenue-tracking/dashboard - Revenue analytics"""
        response = requests.get(f"{BASE_URL}/api/revenue-tracking/dashboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)


# ── AI Triage Tests ──

class TestAITriage:
    """Tests for consolidated AI Triage (3→1)"""
    
    def test_keyword_triage_analyze(self, headers):
        """POST /api/ticket-triage/analyze - Keyword-based triage"""
        response = requests.post(f"{BASE_URL}/api/ticket-triage/analyze", headers=headers, json={
            "title": "Server down - critical outage",
            "description": "Production server is not responding. All users affected."
        })
        assert response.status_code == 200
        data = response.json()
        assert "triage" in data
        triage = data["triage"]
        assert "category" in triage
        assert "priority" in triage
        # Should detect critical priority due to keywords
        assert triage["priority"] in ["critical", "high"]
    
    def test_ai_auto_route_requires_ticket_id(self, headers):
        """POST /api/ai/auto-route - Requires ticket_id"""
        response = requests.post(f"{BASE_URL}/api/ai/auto-route", headers=headers, json={
            "triage": {"suggested_priority": "high"}
        })
        assert response.status_code == 400
        assert "ticket_id" in response.json().get("detail", "").lower()


# ── Backup Command Center Tests ──

class TestBackupCommandCenter:
    """Tests for merged Backup module (4→1)"""
    
    def test_backup_dashboard_overview(self, headers):
        """GET /api/backup-dashboard/overview - Backup status"""
        response = requests.get(f"{BASE_URL}/api/backup-dashboard/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
    
    def test_backup_compliance_dashboard(self, headers):
        """GET /api/backup-compliance/dashboard - Compliance scoring"""
        response = requests.get(f"{BASE_URL}/api/backup-compliance/dashboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
    
    def test_backup_verify_overview(self, headers):
        """GET /api/backup-verify/overview - Verification status"""
        response = requests.get(f"{BASE_URL}/api/backup-verify/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)


# ── SLA Manager Tests ──

class TestSLAManager:
    """Tests for merged SLA module (4→1)"""
    
    def test_sla_timer_active(self, headers):
        """GET /api/sla-timer/active - Active SLA timers"""
        response = requests.get(f"{BASE_URL}/api/sla-timer/active", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
    
    def test_sla_timer_predictions(self, headers):
        """GET /api/sla-timer/predictions - Breach predictions"""
        response = requests.get(f"{BASE_URL}/api/sla-timer/predictions", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
    
    def test_sla_penalties_dashboard(self, headers):
        """GET /api/sla-penalties/dashboard - Penalty tracking"""
        response = requests.get(f"{BASE_URL}/api/sla-penalties/dashboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
    
    def test_sla_report_gen_reports(self, headers):
        """GET /api/sla-report-gen/reports - SLA reports"""
        response = requests.get(f"{BASE_URL}/api/sla-report-gen/reports", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))


# ── Compliance Hub Tests ──

class TestComplianceHub:
    """Tests for merged Compliance module (4→1)"""
    
    def test_compliance_frameworks_overview(self, headers):
        """GET /api/compliance-frameworks/overview - Framework status"""
        response = requests.get(f"{BASE_URL}/api/compliance-frameworks/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
    
    def test_compliance_reports(self, headers):
        """GET /api/compliance/reports - Compliance reports"""
        response = requests.get(f"{BASE_URL}/api/compliance/reports", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
    
    def test_compliance_generator_reports(self, headers):
        """GET /api/compliance-generator/reports - Generated reports"""
        response = requests.get(f"{BASE_URL}/api/compliance-generator/reports", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))


# ── Dispatch Center Tests ──

class TestDispatchCenter:
    """Tests for merged Dispatch/Scheduling module (3→1)"""
    
    def test_dispatch_board(self, headers):
        """GET /api/dispatch/board - Dispatch board"""
        response = requests.get(f"{BASE_URL}/api/dispatch/board", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
    
    def test_scheduling_calendar(self, headers):
        """GET /api/scheduling/calendar - Calendar events"""
        response = requests.get(f"{BASE_URL}/api/scheduling/calendar", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
    
    def test_scheduling_technician_availability(self, headers):
        """GET /api/scheduling/technician-availability - Tech availability"""
        response = requests.get(f"{BASE_URL}/api/scheduling/technician-availability", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))


# ── Reports Hub Tests ──

class TestReportsHub:
    """Tests for merged Reports module (5→1)"""
    
    def test_reports_ticket_analytics(self, headers):
        """GET /api/reports/ticket-analytics - Operational reports"""
        response = requests.get(f"{BASE_URL}/api/reports/ticket-analytics", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
    
    def test_executive_reports_list(self, headers):
        """GET /api/executive-reports/list - Executive reports"""
        response = requests.get(f"{BASE_URL}/api/executive-reports/list", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
    
    def test_client_reports_history(self, headers):
        """GET /api/client-reports/history - Client reports"""
        response = requests.get(f"{BASE_URL}/api/client-reports/history", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
    
    def test_financial_revenue_summary(self, headers):
        """GET /api/reports/financial/revenue-summary - Financial reports"""
        response = requests.get(f"{BASE_URL}/api/reports/financial/revenue-summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
    
    def test_roi_reports(self, headers):
        """GET /api/roi-reports - ROI reports"""
        response = requests.get(f"{BASE_URL}/api/roi-reports", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))


# ── Backend Health Check ──

class TestBackendHealth:
    """Verify backend loads with all routers (no import errors)"""
    
    def test_auth_endpoint_works(self, headers):
        """GET /api/auth/me - Backend is running"""
        response = requests.get(f"{BASE_URL}/api/auth/me", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "email" in data
    
    def test_clients_endpoint_works(self, headers):
        """GET /api/clients - Core endpoint works"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
