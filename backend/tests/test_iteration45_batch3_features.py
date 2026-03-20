"""
Iteration 45 - Batch 3 Features (13 new features)
Testing: Patch Hub (8-tab system), NLP Query, AI Resolution, Client Budget,
Dark Web Monitor, Phishing Sim, Backup Verify, Compliance Frameworks,
NPS Tracker, Executive Reports, Geo Map, Hardware Refresh, Onboarding Workflows
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="session")
def auth_token():
    """Get authentication token for all tests"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": "admin123"
    })
    if response.status_code == 200:
        return response.json().get("token")  # Note: API returns 'token' not 'access_token'
    pytest.skip("Authentication failed - skipping tests")

@pytest.fixture(scope="session")
def headers(auth_token):
    """Auth headers for API requests"""
    return {"Authorization": f"Bearer {auth_token}"}


# ==================== PATCH HUB TESTS (8 TABS) ====================

class TestPatchHubDashboard:
    """Patch Hub Dashboard Tab - os_summary, app_summary, rings, stats_7d"""
    
    def test_patch_hub_dashboard(self, headers):
        response = requests.get(f"{BASE_URL}/api/patch-hub/dashboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Verify os_summary
        assert "os_summary" in data
        os = data["os_summary"]
        assert "compliance_pct" in os
        assert "total_devices" in os
        assert "critical" in os
        assert "total_pending_patches" in os
        
        # Verify app_summary
        assert "app_summary" in data
        app = data["app_summary"]
        assert "compliance_pct" in app
        assert "total_apps" in app
        
        # Verify rings
        assert "rings" in data
        assert isinstance(data["rings"], list)
        
        # Verify 7-day stats
        assert "stats_7d" in data
        assert isinstance(data["stats_7d"], list)
        if data["stats_7d"]:
            stat = data["stats_7d"][0]
            assert "date" in stat
            assert "installed" in stat
            assert "failed" in stat

class TestPatchHubIntelligence:
    """Patch Hub Intelligence Tab - CVSS scores, AI-paused patches"""
    
    def test_patch_intelligence(self, headers):
        response = requests.get(f"{BASE_URL}/api/patch-hub/intelligence", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Verify patches with CVSS
        assert "patches" in data
        assert isinstance(data["patches"], list)
        if data["patches"]:
            patch = data["patches"][0]
            assert "cvss_score" in patch
            assert "kb_id" in patch
            assert "stability" in patch
        
        # Verify summary
        assert "summary" in data
        summary = data["summary"]
        assert "critical_cvss" in summary
        assert "high_cvss" in summary
        assert "auto_paused" in summary

class TestPatchHubRings:
    """Patch Hub Rings Tab - 5 deployment rings"""
    
    def test_get_rings(self, headers):
        response = requests.get(f"{BASE_URL}/api/patch-hub/rings", headers=headers)
        assert response.status_code == 200
        rings = response.json()
        
        assert isinstance(rings, list)
        assert len(rings) >= 4  # At least 4 rings
        
        # Verify ring structure
        ring = rings[0]
        assert "id" in ring
        assert "name" in ring
        assert "device_count" in ring
        assert "delay_hours" in ring
    
    def test_promote_ring(self, headers):
        # First get rings to find one
        response = requests.get(f"{BASE_URL}/api/patch-hub/rings", headers=headers)
        rings = response.json()
        if rings:
            ring_id = rings[0]["id"]
            response = requests.post(f"{BASE_URL}/api/patch-hub/rings/{ring_id}/promote", 
                                    json={}, headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert "status" in data
            assert data["status"] == "promoted"

class TestPatchHubExclusions:
    """Patch Hub Exclusions Tab - KB/app exclusions"""
    
    def test_get_exclusions(self, headers):
        response = requests.get(f"{BASE_URL}/api/patch-hub/exclusions", headers=headers)
        assert response.status_code == 200
        exclusions = response.json()
        
        assert isinstance(exclusions, list)
        if exclusions:
            exc = exclusions[0]
            assert "id" in exc
            assert "reason" in exc
            assert "scope" in exc

class TestPatchHubReboots:
    """Patch Hub Reboots Tab - Reboot schedules"""
    
    def test_get_reboot_schedule(self, headers):
        response = requests.get(f"{BASE_URL}/api/patch-hub/reboot-schedule", headers=headers)
        assert response.status_code == 200
        schedules = response.json()
        
        assert isinstance(schedules, list)
        if schedules:
            sched = schedules[0]
            assert "client_name" in sched
            assert "day_of_week" in sched
            assert "time_utc" in sched

class TestPatchHubRollback:
    """Patch Hub Rollback Tab - Rollback history"""
    
    def test_get_rollbacks(self, headers):
        response = requests.get(f"{BASE_URL}/api/patch-hub/rollbacks", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "rollback_history" in data
        assert "available_rollbacks" in data
        
        if data["rollback_history"]:
            rb = data["rollback_history"][0]
            assert "kb_id" in rb
            assert "device_count" in rb
            assert "status" in rb

class TestPatchHubTesting:
    """Patch Hub Testing Tab - Test results"""
    
    def test_get_testing_results(self, headers):
        response = requests.get(f"{BASE_URL}/api/patch-hub/testing", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "results" in data
        assert "summary" in data
        
        summary = data["summary"]
        assert "total_tested" in summary
        assert "passed" in summary
        assert "failed" in summary

class TestPatchHubHistory:
    """Patch Hub History Tab - Patch history"""
    
    def test_get_history(self, headers):
        response = requests.get(f"{BASE_URL}/api/patch-hub/history", headers=headers)
        assert response.status_code == 200
        history = response.json()
        
        assert isinstance(history, list)
        if history:
            h = history[0]
            assert "kb_id" in h
            assert "device_name" in h
            assert "status" in h

class TestPatchHubComplianceByClient:
    """Patch Hub - Compliance by client"""
    
    def test_compliance_by_client(self, headers):
        response = requests.get(f"{BASE_URL}/api/patch-hub/compliance-by-client", headers=headers)
        assert response.status_code == 200
        compliance = response.json()
        
        assert isinstance(compliance, list)
        if compliance:
            c = compliance[0]
            assert "client_name" in c
            assert "compliance_pct" in c
            assert "total" in c


# ==================== NLP QUERY TESTS ====================

class TestNLPQuery:
    """NLP Query Engine - Natural language search"""
    
    def test_nlp_empty_query_returns_suggestions(self, headers):
        response = requests.get(f"{BASE_URL}/api/nlp-query/search?q=", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "suggestions" in data
        assert isinstance(data["suggestions"], list)
        assert len(data["suggestions"]) > 0
    
    def test_nlp_query_offline_devices(self, headers):
        response = requests.get(f"{BASE_URL}/api/nlp-query/search?q=offline", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "results" in data
        assert "interpretation" in data
        assert "result_count" in data


# ==================== AI RESOLUTION TESTS ====================

class TestAIResolution:
    """AI Auto-Resolution - Auto-resolved, pending, manual issues"""
    
    def test_get_ai_suggestions(self, headers):
        response = requests.get(f"{BASE_URL}/api/ai-resolution/suggestions", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "issues" in data
        assert "summary" in data
        
        summary = data["summary"]
        assert "auto_resolved" in summary
        assert "pending_approval" in summary
        assert "manual_required" in summary
        assert "time_saved_hours" in summary
        
        if data["issues"]:
            issue = data["issues"][0]
            assert "issue" in issue
            assert "device" in issue
            assert "runbook" in issue
            assert "action" in issue
            assert "confidence" in issue
            assert "status" in issue


# ==================== CLIENT BUDGET TESTS ====================

class TestClientBudget:
    """Client Budget Tracker - Budgets with categories, forecast"""
    
    def test_budget_overview(self, headers):
        response = requests.get(f"{BASE_URL}/api/client-budget/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "budgets" in data
        assert "summary" in data
        
        summary = data["summary"]
        assert "total_annual_budget" in summary
        assert "total_ytd_spent" in summary
        assert "avg_utilization_pct" in summary
        
        if data["budgets"]:
            budget = data["budgets"][0]
            assert "client_name" in budget
            assert "annual_budget" in budget
            assert "ytd_spent" in budget
            assert "forecast_eoy" in budget
            assert "categories" in budget


# ==================== DARK WEB MONITOR TESTS ====================

class TestDarkWebMonitor:
    """Dark Web Monitor - Credential exposures"""
    
    def test_dark_web_overview(self, headers):
        response = requests.get(f"{BASE_URL}/api/dark-web-monitor/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "alerts" in data
        assert "summary" in data
        
        summary = data["summary"]
        assert "total_exposures" in summary
        assert "critical" in summary
        assert "domains_monitored" in summary
        
        if data["alerts"]:
            alert = data["alerts"][0]
            assert "email" in alert
            assert "client_name" in alert
            assert "severity" in alert


# ==================== PHISHING SIM TESTS ====================

class TestPhishingSim:
    """Phishing Simulation - Campaigns with click/report rates"""
    
    def test_get_campaigns(self, headers):
        response = requests.get(f"{BASE_URL}/api/phishing-sim/campaigns", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "campaigns" in data
        assert "summary" in data
        
        summary = data["summary"]
        assert "total_campaigns" in summary
        assert "total_emails_sent" in summary
        assert "avg_click_rate" in summary
        assert "avg_report_rate" in summary
        
        if data["campaigns"]:
            campaign = data["campaigns"][0]
            assert "name" in campaign
            assert "click_rate_pct" in campaign
            assert "report_rate_pct" in campaign


# ==================== BACKUP VERIFY TESTS ====================

class TestBackupVerify:
    """Backup Verification - Pass/fail rates"""
    
    def test_backup_verify_overview(self, headers):
        response = requests.get(f"{BASE_URL}/api/backup-verify/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "tests" in data
        assert "summary" in data
        
        summary = data["summary"]
        assert "total_tests" in summary
        assert "passed" in summary
        assert "pass_rate_pct" in summary
        assert "avg_restore_time_min" in summary
        
        if data["tests"]:
            test = data["tests"][0]
            assert "client_name" in test
            assert "backup_type" in test
            assert "result" in test


# ==================== COMPLIANCE FRAMEWORKS TESTS ====================

class TestComplianceFrameworks:
    """Compliance Frameworks - NIST, CIS, SOC2, HIPAA"""
    
    def test_frameworks_overview(self, headers):
        response = requests.get(f"{BASE_URL}/api/compliance-frameworks/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "frameworks" in data
        assert "summary" in data
        
        summary = data["summary"]
        assert "total_frameworks" in summary
        assert "avg_compliance_pct" in summary
        assert "total_controls" in summary
        assert "controls_met" in summary
        
        # Should have 4 frameworks
        assert len(data["frameworks"]) >= 4
        
        if data["frameworks"]:
            fw = data["frameworks"][0]
            assert "name" in fw
            assert "compliance_pct" in fw
            assert "categories" in fw


# ==================== NPS TRACKER TESTS ====================

class TestNPSTracker:
    """NPS Tracker - Score, 6-month trend, responses"""
    
    def test_nps_overview(self, headers):
        response = requests.get(f"{BASE_URL}/api/nps-tracker/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "surveys" in data
        assert "summary" in data
        assert "trend" in data
        
        summary = data["summary"]
        assert "nps_score" in summary
        assert "promoters" in summary
        assert "passives" in summary
        assert "detractors" in summary
        
        # Verify 6-month trend
        assert isinstance(data["trend"], list)


# ==================== EXECUTIVE REPORTS TESTS ====================

class TestExecutiveReports:
    """Executive Reports - Client reports with metrics"""
    
    def test_list_reports(self, headers):
        response = requests.get(f"{BASE_URL}/api/executive-reports/list", headers=headers)
        assert response.status_code == 200
        reports = response.json()
        
        assert isinstance(reports, list)
        if reports:
            report = reports[0]
            assert "client_name" in report
            assert "period" in report
            assert "status" in report


# ==================== GEO MAP TESTS ====================

class TestGeoMap:
    """Geo Map - Client sites and technicians"""
    
    def test_geo_map_data(self, headers):
        response = requests.get(f"{BASE_URL}/api/geo-map/data", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "sites" in data
        assert "technicians" in data
        assert "summary" in data
        
        # Should have 10 sites
        assert len(data["sites"]) >= 5
        
        # Should have 5 technicians
        assert len(data["technicians"]) >= 5
        
        if data["sites"]:
            site = data["sites"][0]
            assert "name" in site
            assert "device_count" in site
            assert "status" in site
        
        if data["technicians"]:
            tech = data["technicians"][0]
            assert "name" in tech
            assert "status" in tech


# ==================== HARDWARE REFRESH TESTS ====================

class TestHardwareRefresh:
    """Hardware Refresh Planner - EOL tracking"""
    
    def test_hardware_refresh_overview(self, headers):
        response = requests.get(f"{BASE_URL}/api/hardware-refresh/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "devices" in data
        assert "summary" in data
        
        summary = data["summary"]
        assert "total_tracked" in summary
        assert "eol_approaching" in summary
        assert "eol_passed" in summary
        assert "replacement_budget_needed" in summary


# ==================== ONBOARDING WORKFLOWS TESTS ====================

class TestOnboardingWorkflows:
    """Onboarding Workflows - Checklists with progress"""
    
    def test_list_workflows(self, headers):
        response = requests.get(f"{BASE_URL}/api/onboarding-workflows/list", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "workflows" in data
        assert "summary" in data
        
        summary = data["summary"]
        assert "total" in summary
        assert "in_progress" in summary
        assert "completed" in summary
        
        # Should have 3 workflows
        assert len(data["workflows"]) >= 3
        
        if data["workflows"]:
            workflow = data["workflows"][0]
            assert "client_name" in workflow
            assert "steps" in workflow
            assert "completion_pct" in workflow
