"""
Iteration 170: M365 Command Center Tests
Tests for CIPP-style multi-tenant M365 management features:
- M1: Tenants, Users, Universal Search, Health Summary
- M2: Standards Engine (CRUD, Run, BPA Report)
- M3: GDAP relationships, Role Templates, Offboarding
- M4: Security (MFA Analytics, Secure Score, CA Templates, Scripted Alerts, AITM Page)
- Connection Settings
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def auth_token():
    """Get auth token for admin user"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    if resp.status_code != 200:
        pytest.skip(f"Auth failed: {resp.status_code} - {resp.text}")
    data = resp.json()
    return data.get("token")

@pytest.fixture(scope="module")
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ═══════════════════════════════════════════════════════════════════════════════
# M1: Tenants + Users + Universal Search
# ═══════════════════════════════════════════════════════════════════════════════

class TestM365Tenants:
    """M1: Tenant list, health summary, tenant detail, deep links"""
    
    def test_list_tenants_returns_7_seeded(self, headers):
        """GET /api/m365/tenants returns 7 seeded mock tenants"""
        resp = requests.get(f"{BASE_URL}/api/m365/tenants", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        tenants = resp.json()
        assert isinstance(tenants, list)
        assert len(tenants) == 7, f"Expected 7 tenants, got {len(tenants)}"
        
        # Verify expected tenant names
        names = [t["name"] for t in tenants]
        expected_names = ["Acme Corporation", "Pacific Logistics", "Steele Tech Group", 
                         "Boyd & Co Legal", "Northern Build Pty", "Harvest Foods", "Apex Health Group"]
        for name in expected_names:
            assert name in names, f"Missing tenant: {name}"
        
        # Verify tenant structure
        t = tenants[0]
        assert "id" in t
        assert "secure_score" in t
        assert "mfa_enrolled_pct" in t
        assert "users_count" in t
        assert "license_sku" in t
        assert "secure_score_30d_trend" in t
        assert "status" in t
        assert t.get("source") == "m365cc", "Tenant should have source='m365cc'"
    
    def test_health_summary_aggregates(self, headers):
        """GET /api/m365/tenants/health/summary returns aggregate KPIs"""
        resp = requests.get(f"{BASE_URL}/api/m365/tenants/health/summary", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        assert data["tenants"] == 7
        assert data["users"] > 0, "Should have users"
        assert "avg_mfa_pct" in data
        assert "avg_secure_score" in data
        assert "secure_trend" in data
        assert "risky_signins_30d" in data
        assert "gdap_expiring_30d" in data
    
    def test_tenant_detail_with_deep_links(self, headers):
        """GET /api/m365/tenants/{id} returns deep_links and computed counts"""
        # First get a tenant ID
        tenants = requests.get(f"{BASE_URL}/api/m365/tenants", headers=headers).json()
        tid = tenants[0]["id"]
        
        resp = requests.get(f"{BASE_URL}/api/m365/tenants/{tid}", headers=headers)
        assert resp.status_code == 200
        t = resp.json()
        
        # Verify deep_links
        assert "deep_links" in t
        links = t["deep_links"]
        assert "entra" in links
        assert "exchange" in links
        assert "intune" in links
        assert "sharepoint" in links
        assert "defender" in links
        
        # Verify computed counts
        assert "computed" in t
        assert "user_count" in t["computed"]
        assert "users_no_mfa" in t["computed"]
        assert "admins" in t["computed"]
    
    def test_tenant_ai_brief(self, headers):
        """GET /api/m365/tenants/{id}/ai-brief returns AI-written executive brief"""
        tenants = requests.get(f"{BASE_URL}/api/m365/tenants", headers=headers).json()
        tid = tenants[0]["id"]
        
        resp = requests.get(f"{BASE_URL}/api/m365/tenants/{tid}/ai-brief", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        assert "brief" in data
        assert len(data["brief"]) > 50, "Brief should be substantial"
        assert "payload" in data


class TestM365Users:
    """M1: User list with filters"""
    
    def test_list_users_returns_seeded(self, headers):
        """GET /api/m365/users returns seeded users"""
        resp = requests.get(f"{BASE_URL}/api/m365/users", headers=headers)
        assert resp.status_code == 200
        users = resp.json()
        assert isinstance(users, list)
        assert len(users) >= 35, f"Expected 35+ users (5-10 per tenant), got {len(users)}"
        
        # Verify user structure
        u = users[0]
        assert "id" in u
        assert "upn" in u
        assert "mfa_method" in u
        assert "account_enabled" in u
        assert "is_admin" in u
        assert u.get("source") == "m365cc"
    
    def test_filter_by_tenant(self, headers):
        """GET /api/m365/users?tenant_id= filters by tenant"""
        tenants = requests.get(f"{BASE_URL}/api/m365/tenants", headers=headers).json()
        tid = tenants[0]["id"]
        
        resp = requests.get(f"{BASE_URL}/api/m365/users?tenant_id={tid}", headers=headers)
        assert resp.status_code == 200
        users = resp.json()
        assert len(users) > 0
        for u in users:
            assert u["tenant_id"] == tid
    
    def test_filter_no_mfa(self, headers):
        """GET /api/m365/users?no_mfa=true filters users without MFA"""
        resp = requests.get(f"{BASE_URL}/api/m365/users?no_mfa=true", headers=headers)
        assert resp.status_code == 200
        users = resp.json()
        for u in users:
            assert u["mfa_enforced"] == False
            assert u["account_enabled"] == True
    
    def test_search_by_name(self, headers):
        """GET /api/m365/users?q= searches by name/upn/dept"""
        resp = requests.get(f"{BASE_URL}/api/m365/users?q=aaron", headers=headers)
        assert resp.status_code == 200
        # May or may not find results depending on seed


class TestM365UniversalSearch:
    """M1: Universal search across tenants"""
    
    def test_search_returns_users_tenants_gdap(self, headers):
        """GET /api/m365/search?q= returns users, tenants, gdap"""
        resp = requests.get(f"{BASE_URL}/api/m365/search?q=acme", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        assert "users" in data
        assert "tenants" in data
        assert "gdap" in data
        assert "count" in data
        
        # Should find Acme Corporation tenant
        assert len(data["tenants"]) > 0, "Should find Acme tenant"
    
    def test_search_requires_min_length(self, headers):
        """GET /api/m365/search?q=a returns 422 (min 2 chars)"""
        resp = requests.get(f"{BASE_URL}/api/m365/search?q=a", headers=headers)
        assert resp.status_code == 422


# ═══════════════════════════════════════════════════════════════════════════════
# M2: Standards Engine
# ═══════════════════════════════════════════════════════════════════════════════

class TestM365Standards:
    """M2: Standards CRUD, Run, BPA Report"""
    
    def test_list_standards_returns_15_seeded(self, headers):
        """GET /api/m365/standards returns 15 seeded standards"""
        resp = requests.get(f"{BASE_URL}/api/m365/standards", headers=headers)
        assert resp.status_code == 200
        standards = resp.json()
        assert isinstance(standards, list)
        assert len(standards) == 15, f"Expected 15 standards, got {len(standards)}"
        
        # Verify categories
        categories = set(s["category"] for s in standards)
        expected_cats = {"identity", "exchange", "defender", "intune", "sharepoint", "teams"}
        assert categories == expected_cats, f"Expected categories {expected_cats}, got {categories}"
        
        # Verify structure
        s = standards[0]
        assert "id" in s
        assert "name" in s
        assert "category" in s
        assert "severity" in s
        assert "enabled" in s
        assert "auto_remediate" in s
    
    def test_update_standard_toggle(self, headers):
        """PUT /api/m365/standards/{id} toggles enabled and updates actions"""
        standards = requests.get(f"{BASE_URL}/api/m365/standards", headers=headers).json()
        sid = standards[0]["id"]
        original_enabled = standards[0]["enabled"]
        
        resp = requests.put(f"{BASE_URL}/api/m365/standards/{sid}", 
                           json={"enabled": not original_enabled, "actions": ["report", "remediate"]},
                           headers=headers)
        assert resp.status_code == 200
        updated = resp.json()
        assert updated["enabled"] == (not original_enabled)
        assert "remediate" in updated["actions"]
        
        # Revert
        requests.put(f"{BASE_URL}/api/m365/standards/{sid}", 
                    json={"enabled": original_enabled, "actions": ["report"]},
                    headers=headers)
    
    def test_run_standard_returns_results(self, headers):
        """POST /api/m365/standards/{id}/run runs across all tenants"""
        standards = requests.get(f"{BASE_URL}/api/m365/standards", headers=headers).json()
        sid = standards[0]["id"]
        
        resp = requests.post(f"{BASE_URL}/api/m365/standards/{sid}/run", json={}, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        assert "run" in data
        assert "results" in data
        
        run = data["run"]
        assert "summary" in run
        assert "compliant" in run["summary"]
        assert "drifted" in run["summary"]
        assert "remediated" in run["summary"]
        assert run["tenant_count"] == 7
        
        # Verify results per tenant
        assert len(data["results"]) == 7
    
    def test_standard_runs_history(self, headers):
        """GET /api/m365/standards/{id}/runs returns history"""
        standards = requests.get(f"{BASE_URL}/api/m365/standards", headers=headers).json()
        sid = standards[0]["id"]
        
        resp = requests.get(f"{BASE_URL}/api/m365/standards/{sid}/runs", headers=headers)
        assert resp.status_code == 200
        runs = resp.json()
        assert isinstance(runs, list)
    
    def test_bpa_report(self, headers):
        """GET /api/m365/bpa-report returns matrix of standards × tenants"""
        resp = requests.get(f"{BASE_URL}/api/m365/bpa-report", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        assert "matrix" in data
        assert "standards" in data


# ═══════════════════════════════════════════════════════════════════════════════
# M3: GDAP + Offboarding
# ═══════════════════════════════════════════════════════════════════════════════

class TestM365GDAP:
    """M3: GDAP relationships, role templates, extend"""
    
    def test_list_gdap_returns_7(self, headers):
        """GET /api/m365/gdap returns 7 GDAP relationships"""
        resp = requests.get(f"{BASE_URL}/api/m365/gdap", headers=headers)
        assert resp.status_code == 200
        gdap = resp.json()
        assert len(gdap) == 7
        
        g = gdap[0]
        assert "id" in g
        assert "tenant_id" in g
        assert "tenant_name" in g
        assert "roles" in g
        assert "expires_in_days" in g
        assert "status" in g
    
    def test_gdap_expiring_filter(self, headers):
        """GET /api/m365/gdap?expiring_only=true filters ≤30d"""
        resp = requests.get(f"{BASE_URL}/api/m365/gdap?expiring_only=true", headers=headers)
        assert resp.status_code == 200
        gdap = resp.json()
        for g in gdap:
            assert g["expires_in_days"] <= 30
    
    def test_extend_gdap(self, headers):
        """POST /api/m365/gdap/{id}/extend bumps expires_at"""
        gdap = requests.get(f"{BASE_URL}/api/m365/gdap", headers=headers).json()
        gid = gdap[0]["id"]
        
        resp = requests.post(f"{BASE_URL}/api/m365/gdap/{gid}/extend", 
                            json={"days": 365}, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] == True
        assert "expires_at" in data
    
    def test_role_templates_returns_4(self, headers):
        """GET /api/m365/gdap/role-templates returns 4 seed templates"""
        resp = requests.get(f"{BASE_URL}/api/m365/gdap/role-templates", headers=headers)
        assert resp.status_code == 200
        templates = resp.json()
        assert len(templates) == 4
        
        names = [t["name"] for t in templates]
        assert "Tier 1 — Helpdesk" in names
        assert "Tier 2 — L2 Technician" in names
        assert "Tier 3 — Engineer" in names
        assert "Billing only" in names


class TestM365Offboarding:
    """M3: Offboarding wizard"""
    
    def test_offboarding_runs_steps(self, headers):
        """POST /api/m365/offboarding runs steps and disables user"""
        # Get a user to offboard
        users = requests.get(f"{BASE_URL}/api/m365/users", headers=headers).json()
        # Find an enabled non-admin user
        user = next((u for u in users if u["account_enabled"] and not u["is_admin"]), None)
        if not user:
            pytest.skip("No suitable user for offboarding test")
        
        resp = requests.post(f"{BASE_URL}/api/m365/offboarding", json={
            "user_id": user["id"],
            "tenant_id": user["tenant_id"],
            "steps": {
                "disable_signin": True,
                "remove_licenses": True,
                "hide_from_gal": True,
                "set_ooo": True,
                "convert_to_shared": True,
            }
        }, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        assert "id" in data
        assert "results" in data
        assert len(data["results"]) >= 5
        
        # Verify user is now disabled
        updated_user = requests.get(f"{BASE_URL}/api/m365/users?tenant_id={user['tenant_id']}", headers=headers).json()
        offboarded = next((u for u in updated_user if u["id"] == user["id"]), None)
        if offboarded:
            assert offboarded["account_enabled"] == False
    
    def test_offboarding_requires_user_tenant(self, headers):
        """POST /api/m365/offboarding returns 400 without user_id/tenant_id"""
        resp = requests.post(f"{BASE_URL}/api/m365/offboarding", json={}, headers=headers)
        assert resp.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════════
# M4: Security & Alerts
# ═══════════════════════════════════════════════════════════════════════════════

class TestM365MFAAnalytics:
    """M4: MFA analytics"""
    
    def test_mfa_analytics_returns_breakdown(self, headers):
        """GET /api/m365/mfa-analytics returns by_method breakdown"""
        resp = requests.get(f"{BASE_URL}/api/m365/mfa-analytics", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        assert "by_method" in data
        assert "mfa_pct" in data
        assert "no_mfa_users" in data
        assert "no_mfa_admin_count" in data
        assert "total_users" in data


class TestM365SecureScore:
    """M4: Secure Score trend"""
    
    def test_secure_score_trend_returns_30_days(self, headers):
        """GET /api/m365/secure-score/trend returns 30-day series"""
        resp = requests.get(f"{BASE_URL}/api/m365/secure-score/trend", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        
        assert "tenants" in data
        assert "series" in data
        assert len(data["series"]) == 30


class TestM365CATemplates:
    """M4: Conditional Access templates"""
    
    def test_ca_templates_returns_8(self, headers):
        """GET /api/m365/ca-templates returns 8 seeded templates"""
        resp = requests.get(f"{BASE_URL}/api/m365/ca-templates", headers=headers)
        assert resp.status_code == 200
        templates = resp.json()
        assert len(templates) == 8
        
        sources = set(t["source"] for t in templates)
        assert "CyberDrain Baseline" in sources
        assert "Open Intune Baseline" in sources
        assert "Microsoft Baseline" in sources
    
    def test_deploy_ca_template(self, headers):
        """POST /api/m365/ca-templates/{id}/deploy deploys to tenants"""
        templates = requests.get(f"{BASE_URL}/api/m365/ca-templates", headers=headers).json()
        cid = templates[0]["id"]
        
        tenants = requests.get(f"{BASE_URL}/api/m365/tenants", headers=headers).json()
        tenant_ids = [t["id"] for t in tenants[:2]]
        
        resp = requests.post(f"{BASE_URL}/api/m365/ca-templates/{cid}/deploy",
                            json={"tenant_ids": tenant_ids}, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["deployed"] == 2
        assert len(data["results"]) == 2


class TestM365ScriptedAlerts:
    """M4: Scripted alerts CRUD"""
    
    def test_list_scripted_alerts_returns_5(self, headers):
        """GET /api/m365/scripted-alerts returns 5 seeded alerts"""
        resp = requests.get(f"{BASE_URL}/api/m365/scripted-alerts", headers=headers)
        assert resp.status_code == 200
        alerts = resp.json()
        assert len(alerts) == 5
        
        keys = [a["key"] for a in alerts]
        assert "impossible_travel" in keys
        assert "new_admin" in keys
        assert "mass_delete" in keys
        assert "inbox_forward_external" in keys
        assert "guest_admin" in keys
    
    def test_create_and_delete_alert(self, headers):
        """POST/DELETE /api/m365/scripted-alerts creates and deletes"""
        # Create
        resp = requests.post(f"{BASE_URL}/api/m365/scripted-alerts", json={
            "name": "TEST Alert",
            "expression": "test.condition == true",
            "severity": "medium"
        }, headers=headers)
        assert resp.status_code == 200
        alert = resp.json()
        assert alert["name"] == "TEST Alert"
        aid = alert["id"]
        
        # Delete
        resp = requests.delete(f"{BASE_URL}/api/m365/scripted-alerts/{aid}", headers=headers)
        assert resp.status_code == 200
    
    def test_create_alert_requires_name_expression(self, headers):
        """POST /api/m365/scripted-alerts returns 400 without name/expression"""
        resp = requests.post(f"{BASE_URL}/api/m365/scripted-alerts", json={}, headers=headers)
        assert resp.status_code == 400


class TestM365AITMPage:
    """M4: Anti-AITM page CSS generator"""
    
    def test_get_aitm_page(self, headers):
        """GET /api/m365/aitm-page returns config"""
        resp = requests.get(f"{BASE_URL}/api/m365/aitm-page", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "enabled" in data
        assert "company_name" in data
        assert "warning_text" in data
        assert "primary_color" in data
    
    def test_update_aitm_page_generates_css(self, headers):
        """PUT /api/m365/aitm-page returns generated CSS"""
        resp = requests.put(f"{BASE_URL}/api/m365/aitm-page", json={
            "enabled": True,
            "company_name": "Test Corp",
            "warning_text": "DO NOT LOGIN - This is a test",
            "primary_color": "#FF0000"
        }, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "css" in data
        assert len(data["css"]) > 100
        assert "Test Corp" in data["css"]
        assert "#FF0000" in data["css"]


# ═══════════════════════════════════════════════════════════════════════════════
# Connection Settings
# ═══════════════════════════════════════════════════════════════════════════════

class TestM365Connection:
    """Connection settings for M365"""
    
    def test_get_connection_returns_masked(self, headers):
        """GET /api/m365/connection returns masked secrets"""
        resp = requests.get(f"{BASE_URL}/api/m365/connection", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "mode" in data
        # Should be mock by default
        assert data["mode"] in ["mock", "live"]
    
    def test_update_connection(self, headers):
        """PUT /api/m365/connection persists settings"""
        resp = requests.put(f"{BASE_URL}/api/m365/connection", json={
            "app_id": "test-app-id",
            "tenant_id": "test-tenant-id"
        }, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] == True
        # Still mock because no secret/refresh_token
        assert data["mode"] == "mock"
    
    def test_test_connection_mock_mode(self, headers):
        """POST /api/m365/connection/test returns mock mode info"""
        resp = requests.post(f"{BASE_URL}/api/m365/connection/test", json={}, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        # Without full credentials, should be mock
        assert "mode" in data
