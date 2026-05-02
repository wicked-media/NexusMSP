"""
Test suite for Power Features - 24 compounding composites
Iteration 140: Testing all 24 endpoints in power_features.py

Endpoints tested:
1. POST /api/tickets/{id}/smart-assign - Smart tech assignment
2. GET /api/tickets/{id}/doppelganger-resolution - Similar ticket resolution suggestion
3. POST /api/ai/apology-queue/scan - Sentiment apology queue scan
4. POST /api/sla-radar/auto-page - SLA auto-paging
5. POST /api/payment-promises/reconcile - Payment promise reconciliation
6. GET /api/team/{tech_id}/rebalance-suggestions - Tech workload rebalance
7. POST /api/patches/anomalies/{patch_id}/pause-trmm - Pause TRMM broadcasts
8. GET /api/finance/unbilled-dollars - Unbilled time dollars
9. GET /api/finance/revenue-at-risk - Revenue at risk aggregation
10. GET /api/finance/pricing-compliance - Pricing compliance violations
11. GET /api/command-center - Command center overview
12. GET /api/clients/{id}/dossier.pdf - Client dossier PDF
13. GET /api/briefings/monday-prep - Monday prep briefing
14. GET /api/team/leaderboard - Team leaderboard
15. GET /api/team/streaks - Drill streaks
16. GET /api/clients/{id}/monthly-recap - Monthly recap (Claude)
17. GET /api/clients/{id}/insurance-action-plan - Insurance action plan
18. GET /api/clients/{id}/pre-call-brief - Pre-call brief (Claude)
19. GET /api/team/{id}/daily-briefing - Daily tech briefing (Claude)
20. GET /api/tickets/{id}/scope-drift - Scope drift analysis
21. POST /api/tickets/quality-audit - Quality audit (Claude)
22. GET /api/forecasting/capacity - Capacity forecast
23. GET /api/clients/{id}/benchmark - Client benchmark
24. POST/GET /api/security/insurance-vault/schedule - Insurance vault scheduling
"""

import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://rmm-psa-build.preview.emergentagent.com"


class TestPowerFeaturesAuth:
    """Test authentication for power features"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        # API returns 'token' not 'access_token'
        assert "token" in data, "No token in response"
        return data["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        """Get auth headers"""
        return {"Authorization": f"Bearer {auth_token}"}
    
    @pytest.fixture(scope="class")
    def user_id(self, headers):
        """Get a user ID for team endpoints"""
        response = requests.get(f"{BASE_URL}/api/users", headers=headers)
        if response.status_code == 200:
            users = response.json()
            if isinstance(users, list) and len(users) > 0:
                return users[0].get("id")
        return None


class TestChainReactionEndpoints(TestPowerFeaturesAuth):
    """Test chain reaction / automation endpoints (1-7)"""
    
    def test_01_smart_assign(self, headers):
        """POST /api/tickets/{id}/smart-assign - returns top_pick with tech_id/name/score/reason + alternatives[]"""
        response = requests.post(f"{BASE_URL}/api/tickets/TKT-001/smart-assign", headers=headers)
        assert response.status_code == 200, f"Smart assign failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "ticket_id" in data, "Missing ticket_id"
        assert "top_pick" in data, "Missing top_pick"
        assert "alternatives" in data, "Missing alternatives"
        assert "generated_at" in data, "Missing generated_at"
        
        # Validate top_pick structure
        top_pick = data["top_pick"]
        assert "tech_id" in top_pick, "top_pick missing tech_id"
        assert "name" in top_pick, "top_pick missing name"
        assert "score" in top_pick, "top_pick missing score"
        assert "reason" in top_pick, "top_pick missing reason"
        
        print(f"Smart assign top pick: {top_pick.get('name')} (score: {top_pick.get('score')})")
    
    def test_02_doppelganger_resolution(self, headers):
        """GET /api/tickets/{id}/doppelganger-resolution - returns suggestion with resolution_notes and similarity_score"""
        response = requests.get(f"{BASE_URL}/api/tickets/TKT-001/doppelganger-resolution", headers=headers)
        assert response.status_code == 200, f"Doppelganger resolution failed: {response.text}"
        data = response.json()
        
        # Validate response structure - ticket_id may not be present if no suggestion
        # suggestion can be None if no similar ticket found
        if data.get("suggestion"):
            suggestion = data["suggestion"]
            assert "resolution_notes" in suggestion, "suggestion missing resolution_notes"
            assert "similarity_score" in suggestion, "suggestion missing similarity_score"
            print(f"Found similar ticket with {suggestion.get('similarity_score')}% match")
        else:
            assert "reason" in data, "Missing reason when no suggestion"
            print(f"No similar ticket found: {data.get('reason')}")
        
        # Test passes as long as we get a valid response structure
        assert "suggestion" in data or "reason" in data, "Response must have suggestion or reason"
    
    def test_03_apology_queue_scan(self, headers):
        """POST /api/ai/apology-queue/scan - returns queued_new and queue[]"""
        response = requests.post(f"{BASE_URL}/api/ai/apology-queue/scan", headers=headers)
        assert response.status_code == 200, f"Apology queue scan failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "queued_new" in data, "Missing queued_new"
        assert "queue" in data, "Missing queue"
        assert "generated_at" in data, "Missing generated_at"
        assert isinstance(data["queue"], list), "queue should be a list"
        
        print(f"Apology queue: {data.get('queued_new')} new, {len(data.get('queue', []))} total pending")
    
    def test_04_sla_auto_page(self, headers):
        """POST /api/sla-radar/auto-page?min_score=70 - returns scanned and new_pages_fired"""
        response = requests.post(f"{BASE_URL}/api/sla-radar/auto-page?min_score=70", headers=headers)
        assert response.status_code == 200, f"SLA auto-page failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "scanned" in data, "Missing scanned"
        assert "new_pages_fired" in data, "Missing new_pages_fired"
        
        print(f"SLA auto-page: scanned {data.get('scanned')}, fired {data.get('new_pages_fired')} pages")
    
    def test_05_payment_promises_reconcile(self, headers):
        """POST /api/payment-promises/reconcile - returns broken_count and clients_bumped"""
        response = requests.post(f"{BASE_URL}/api/payment-promises/reconcile", headers=headers)
        assert response.status_code == 200, f"Payment promises reconcile failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "broken_count" in data, "Missing broken_count"
        assert "clients_bumped" in data, "Missing clients_bumped"
        
        print(f"Payment reconcile: {data.get('broken_count')} broken, {data.get('clients_bumped')} clients bumped")
    
    def test_06_rebalance_suggestions(self, headers, user_id):
        """GET /api/team/{tech_id}/rebalance-suggestions - returns offload_candidates[]"""
        if not user_id:
            pytest.skip("No user ID available")
        
        response = requests.get(f"{BASE_URL}/api/team/{user_id}/rebalance-suggestions", headers=headers)
        assert response.status_code == 200, f"Rebalance suggestions failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "tech_id" in data, "Missing tech_id"
        assert "offload_candidates" in data, "Missing offload_candidates"
        assert "generated_at" in data, "Missing generated_at"
        assert isinstance(data["offload_candidates"], list), "offload_candidates should be a list"
        
        print(f"Rebalance: {len(data.get('offload_candidates', []))} offload candidates for {data.get('tech_name')}")
    
    def test_07_pause_trmm_for_patch(self, headers):
        """POST /api/patches/anomalies/KB1234567/pause-trmm - returns broadcasts_paused count"""
        response = requests.post(f"{BASE_URL}/api/patches/anomalies/KB1234567/pause-trmm", headers=headers)
        assert response.status_code == 200, f"Pause TRMM failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "patch_id" in data, "Missing patch_id"
        assert "broadcasts_paused" in data, "Missing broadcasts_paused"
        assert data["patch_id"] == "KB1234567", "patch_id mismatch"
        
        print(f"Paused {data.get('broadcasts_paused')} TRMM broadcasts for {data.get('patch_id')}")


class TestRevenueAmplifierEndpoints(TestPowerFeaturesAuth):
    """Test revenue amplifier endpoints (8-10)"""
    
    def test_08_unbilled_dollars(self, headers):
        """GET /api/finance/unbilled-dollars - returns total_dollars, by_client[], top_tickets[]"""
        response = requests.get(f"{BASE_URL}/api/finance/unbilled-dollars", headers=headers)
        assert response.status_code == 200, f"Unbilled dollars failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "total_dollars" in data, "Missing total_dollars"
        assert "by_client" in data, "Missing by_client"
        assert "top_tickets" in data, "Missing top_tickets"
        assert isinstance(data["by_client"], list), "by_client should be a list"
        assert isinstance(data["top_tickets"], list), "top_tickets should be a list"
        
        print(f"Unbilled: ${data.get('total_dollars')} total")
    
    def test_09_revenue_at_risk(self, headers):
        """GET /api/finance/revenue-at-risk - returns total_at_risk, breakdown{}, top_churn_clients[]"""
        response = requests.get(f"{BASE_URL}/api/finance/revenue-at-risk", headers=headers)
        assert response.status_code == 200, f"Revenue at risk failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "total_at_risk" in data, "Missing total_at_risk"
        assert "breakdown" in data, "Missing breakdown"
        assert "top_churn_clients" in data, "Missing top_churn_clients"
        
        # Validate breakdown structure
        breakdown = data["breakdown"]
        assert "aged_ar" in breakdown, "breakdown missing aged_ar"
        assert "overdue_60plus" in breakdown, "breakdown missing overdue_60plus"
        assert "cold_estimates_risk_weighted" in breakdown, "breakdown missing cold_estimates_risk_weighted"
        assert "high_churn_annual_risk" in breakdown, "breakdown missing high_churn_annual_risk"
        
        print(f"Revenue at risk: ${data.get('total_at_risk')} total")
    
    def test_10_pricing_compliance(self, headers):
        """GET /api/finance/pricing-compliance - returns total_underpriced_dollars, total_below_margin_dollars, top_violations[]"""
        response = requests.get(f"{BASE_URL}/api/finance/pricing-compliance", headers=headers)
        assert response.status_code == 200, f"Pricing compliance failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "total_underpriced_dollars" in data, "Missing total_underpriced_dollars"
        assert "total_below_margin_dollars" in data, "Missing total_below_margin_dollars"
        assert "top_violations" in data, "Missing top_violations"
        assert isinstance(data["top_violations"], list), "top_violations should be a list"
        
        print(f"Pricing compliance: ${data.get('total_underpriced_dollars')} underpriced, ${data.get('total_below_margin_dollars')} below margin")


class TestUnifiedScreenEndpoints(TestPowerFeaturesAuth):
    """Test unified screen endpoints (11-13)"""
    
    def test_11_command_center(self, headers):
        """GET /api/command-center - returns sla_hot[], sentiment_escalations_24h, patch_anomaly_count, overloaded_techs[]"""
        response = requests.get(f"{BASE_URL}/api/command-center", headers=headers)
        assert response.status_code == 200, f"Command center failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "sla_hot" in data, "Missing sla_hot"
        assert "sentiment_escalations_24h" in data, "Missing sentiment_escalations_24h"
        assert "patch_anomaly_count" in data, "Missing patch_anomaly_count"
        assert "overloaded_techs" in data, "Missing overloaded_techs"
        assert isinstance(data["sla_hot"], list), "sla_hot should be a list"
        assert isinstance(data["overloaded_techs"], list), "overloaded_techs should be a list"
        
        print(f"Command center: {len(data.get('sla_hot', []))} SLA hot, {data.get('sentiment_escalations_24h')} escalations")
    
    def test_12_client_dossier_pdf(self, headers):
        """GET /api/clients/{id}/dossier.pdf - returns application/pdf"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/dossier.pdf", headers=headers)
        assert response.status_code == 200, f"Client dossier PDF failed: {response.text}"
        
        # Validate content type
        content_type = response.headers.get("content-type", "")
        assert "application/pdf" in content_type, f"Expected PDF content type, got {content_type}"
        
        # Validate PDF header
        content = response.content
        assert content.startswith(b"%PDF"), "Response does not start with PDF header"
        assert len(content) > 1000, f"PDF too small: {len(content)} bytes"
        
        # Check Content-Disposition header
        content_disp = response.headers.get("content-disposition", "")
        assert "attachment" in content_disp, "Missing attachment disposition"
        assert ".pdf" in content_disp, "Missing .pdf in filename"
        
        print(f"Client dossier PDF: {len(content)} bytes")
    
    def test_13_monday_prep(self, headers):
        """GET /api/briefings/monday-prep - returns tickets{}, finance{}, focus_areas[]"""
        response = requests.get(f"{BASE_URL}/api/briefings/monday-prep", headers=headers)
        assert response.status_code == 200, f"Monday prep failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "tickets" in data, "Missing tickets"
        assert "finance" in data, "Missing finance"
        assert "focus_areas" in data, "Missing focus_areas"
        
        # Validate tickets structure
        tickets = data["tickets"]
        assert "new" in tickets, "tickets missing new"
        assert "closed" in tickets, "tickets missing closed"
        assert "open_now" in tickets, "tickets missing open_now"
        assert "criticals_open" in tickets, "tickets missing criticals_open"
        
        # Validate finance structure
        finance = data["finance"]
        assert "overdue_total" in finance, "finance missing overdue_total"
        assert "cold_estimates_count" in finance, "finance missing cold_estimates_count"
        
        print(f"Monday prep: {tickets.get('new')} new, {tickets.get('closed')} closed, {len(data.get('focus_areas', []))} focus areas")


class TestGamificationEndpoints(TestPowerFeaturesAuth):
    """Test gamification endpoints (14-15)"""
    
    def test_14_team_leaderboard(self, headers):
        """GET /api/team/leaderboard - returns leaderboard[] with rank, name, total_xp, level, etc."""
        response = requests.get(f"{BASE_URL}/api/team/leaderboard", headers=headers)
        assert response.status_code == 200, f"Team leaderboard failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "leaderboard" in data, "Missing leaderboard"
        assert isinstance(data["leaderboard"], list), "leaderboard should be a list"
        
        # Validate leaderboard entry structure if not empty
        if data["leaderboard"]:
            entry = data["leaderboard"][0]
            assert "rank" in entry, "entry missing rank"
            assert "name" in entry, "entry missing name"
            assert "total_xp" in entry, "entry missing total_xp"
            assert "level" in entry, "entry missing level"
            assert "closed_tickets" in entry, "entry missing closed_tickets"
            assert "drills_led" in entry, "entry missing drills_led"
            assert "runbooks_published" in entry, "entry missing runbooks_published"
        
        print(f"Leaderboard: {len(data.get('leaderboard', []))} techs")
    
    def test_15_drill_streaks(self, headers):
        """GET /api/team/streaks - returns streaks[] with tech, current_week_streak, total_drills"""
        response = requests.get(f"{BASE_URL}/api/team/streaks", headers=headers)
        assert response.status_code == 200, f"Drill streaks failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "streaks" in data, "Missing streaks"
        assert isinstance(data["streaks"], list), "streaks should be a list"
        
        # Validate streak entry structure if not empty
        if data["streaks"]:
            entry = data["streaks"][0]
            assert "tech" in entry, "entry missing tech"
            assert "current_week_streak" in entry, "entry missing current_week_streak"
            assert "total_drills" in entry, "entry missing total_drills"
        
        print(f"Streaks: {len(data.get('streaks', []))} techs with drills")


class TestRetentionEndpoints(TestPowerFeaturesAuth):
    """Test retention endpoints (16-18) - These use Claude AI"""
    
    def test_16_monthly_recap(self, headers):
        """GET /api/clients/{id}/monthly-recap - returns subject, body, highlight, stats (uses Claude)"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/monthly-recap", headers=headers, timeout=60)
        assert response.status_code == 200, f"Monthly recap failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "client_id" in data, "Missing client_id"
        assert "client_name" in data, "Missing client_name"
        assert "stats" in data, "Missing stats"
        # subject/body/highlight may be None if LLM fails to parse
        
        print(f"Monthly recap for {data.get('client_name')}: subject={data.get('subject', 'N/A')[:50] if data.get('subject') else 'N/A'}")
    
    def test_17_insurance_action_plan(self, headers):
        """GET /api/clients/{id}/insurance-action-plan - returns current_score, tier, actions[]"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/insurance-action-plan", headers=headers)
        assert response.status_code == 200, f"Insurance action plan failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "client_id" in data, "Missing client_id"
        assert "current_score" in data, "Missing current_score"
        assert "tier" in data, "Missing tier"
        assert "actions" in data, "Missing actions"
        assert isinstance(data["actions"], list), "actions should be a list"
        
        # Validate action structure if not empty
        if data["actions"]:
            action = data["actions"][0]
            assert "priority" in action, "action missing priority"
            assert "title" in action, "action missing title"
            assert "impact" in action, "action missing impact"
            assert "device_count" in action, "action missing device_count"
        
        print(f"Insurance plan: score {data.get('current_score')}/100, tier={data.get('tier')}, {len(data.get('actions', []))} actions")
    
    def test_18_pre_call_brief(self, headers):
        """GET /api/clients/{id}/pre-call-brief - returns topics_to_raise[], topics_to_avoid[], tone, one_liner (uses Claude)"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/pre-call-brief", headers=headers, timeout=60)
        assert response.status_code == 200, f"Pre-call brief failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "client_id" in data, "Missing client_id"
        assert "client_name" in data, "Missing client_name"
        assert "topics_to_raise" in data, "Missing topics_to_raise"
        assert "topics_to_avoid" in data, "Missing topics_to_avoid"
        assert isinstance(data["topics_to_raise"], list), "topics_to_raise should be a list"
        assert isinstance(data["topics_to_avoid"], list), "topics_to_avoid should be a list"
        
        print(f"Pre-call brief for {data.get('client_name')}: tone={data.get('tone')}, {len(data.get('topics_to_raise', []))} topics to raise")


class TestAIExtensionEndpoints(TestPowerFeaturesAuth):
    """Test AI extension endpoints (19-21)"""
    
    def test_19_daily_briefing(self, headers, user_id):
        """GET /api/team/{id}/daily-briefing - returns text + stats{} (uses Claude)"""
        if not user_id:
            pytest.skip("No user ID available")
        
        response = requests.get(f"{BASE_URL}/api/team/{user_id}/daily-briefing", headers=headers, timeout=60)
        assert response.status_code == 200, f"Daily briefing failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "tech_id" in data, "Missing tech_id"
        assert "tech_name" in data, "Missing tech_name"
        assert "stats" in data, "Missing stats"
        assert "text" in data, "Missing text"
        
        # Validate stats structure
        stats = data["stats"]
        assert "open" in stats, "stats missing open"
        assert "in_sla_danger" in stats, "stats missing in_sla_danger"
        assert "criticals" in stats, "stats missing criticals"
        
        print(f"Daily briefing for {data.get('tech_name')}: {stats.get('open')} open, {stats.get('criticals')} criticals")
    
    def test_20_scope_drift(self, headers):
        """GET /api/tickets/{id}/scope-drift - returns actual_minutes, expected_minutes, ratio, drift"""
        response = requests.get(f"{BASE_URL}/api/tickets/TKT-001/scope-drift", headers=headers)
        assert response.status_code == 200, f"Scope drift failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "ticket_id" in data, "Missing ticket_id"
        assert "actual_minutes" in data, "Missing actual_minutes"
        assert "expected_minutes" in data, "Missing expected_minutes"
        assert "drift" in data, "Missing drift"
        
        print(f"Scope drift: actual={data.get('actual_minutes')}min, expected={data.get('expected_minutes')}min, drift={data.get('drift')}")
    
    def test_21_quality_audit(self, headers):
        """POST /api/tickets/quality-audit - returns audited[] list (uses Claude)"""
        response = requests.post(
            f"{BASE_URL}/api/tickets/quality-audit",
            json={"sample_size": 3},
            headers=headers,
            timeout=120
        )
        assert response.status_code == 200, f"Quality audit failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "audited" in data, "Missing audited"
        assert isinstance(data["audited"], list), "audited should be a list"
        
        # Validate audited entry structure if not empty
        if data["audited"]:
            entry = data["audited"][0]
            assert "ticket_id" in entry, "entry missing ticket_id"
            assert "score" in entry, "entry missing score"
            assert "verdict" in entry, "entry missing verdict"
        
        print(f"Quality audit: {len(data.get('audited', []))} tickets audited")


class TestOperationsMoonshotEndpoints(TestPowerFeaturesAuth):
    """Test operations moonshot endpoints (22-24)"""
    
    def test_22_capacity_forecast(self, headers):
        """GET /api/forecasting/capacity - returns team{}, devices{}, backup{}, headline"""
        response = requests.get(f"{BASE_URL}/api/forecasting/capacity", headers=headers)
        assert response.status_code == 200, f"Capacity forecast failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "team" in data, "Missing team"
        assert "devices" in data, "Missing devices"
        assert "backup" in data, "Missing backup"
        assert "headline" in data, "Missing headline"
        
        # Validate team structure
        team = data["team"]
        assert "current_techs" in team, "team missing current_techs"
        assert "avg_load_per_tech" in team, "team missing avg_load_per_tech"
        assert "extra_techs_needed_90d" in team, "team missing extra_techs_needed_90d"
        
        # Validate devices structure
        devices = data["devices"]
        assert "replace_in_30" in devices, "devices missing replace_in_30"
        assert "replace_in_90" in devices, "devices missing replace_in_90"
        assert "replace_in_365" in devices, "devices missing replace_in_365"
        
        # Validate backup structure
        backup = data["backup"]
        assert "last_drill_days_ago" in backup, "backup missing last_drill_days_ago"
        assert "refresh_required" in backup, "backup missing refresh_required"
        
        print(f"Capacity forecast: {team.get('current_techs')} techs, headline: {data.get('headline')[:80]}")
    
    def test_23_client_benchmark(self, headers):
        """GET /api/clients/{id}/benchmark - returns comparisons[] + warnings[]"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/benchmark", headers=headers)
        assert response.status_code == 200, f"Client benchmark failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "client_id" in data, "Missing client_id"
        assert "comparisons" in data, "Missing comparisons"
        assert "warnings" in data, "Missing warnings"
        assert isinstance(data["comparisons"], list), "comparisons should be a list"
        assert isinstance(data["warnings"], list), "warnings should be a list"
        
        print(f"Client benchmark: {len(data.get('comparisons', []))} comparisons, {len(data.get('warnings', []))} warnings")
    
    def test_24_insurance_vault_schedule_create(self, headers):
        """POST /api/security/insurance-vault/schedule - creates a schedule row"""
        response = requests.post(
            f"{BASE_URL}/api/security/insurance-vault/schedule",
            json={
                "client_id": "client-001",
                "cadence": "weekly",
                "recipient_emails": ["test@example.com"]
            },
            headers=headers
        )
        assert response.status_code == 200, f"Insurance vault schedule create failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "id" in data, "Missing id"
        assert "client_id" in data, "Missing client_id"
        assert "cadence" in data, "Missing cadence"
        assert "recipient_emails" in data, "Missing recipient_emails"
        assert "active" in data, "Missing active"
        assert data["active"] == True, "Schedule should be active"
        
        print(f"Created insurance vault schedule: {data.get('id')}")
    
    def test_24_insurance_vault_schedule_list(self, headers):
        """GET /api/security/insurance-vault/schedule - lists schedules"""
        response = requests.get(f"{BASE_URL}/api/security/insurance-vault/schedule", headers=headers)
        assert response.status_code == 200, f"Insurance vault schedule list failed: {response.text}"
        data = response.json()
        
        # Validate response is a list
        assert isinstance(data, list), "Response should be a list"
        
        print(f"Insurance vault schedules: {len(data)} active")


class TestAuthRequired:
    """Test that endpoints require authentication"""
    
    def test_command_center_requires_auth(self):
        """Command center should require auth"""
        response = requests.get(f"{BASE_URL}/api/command-center")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_finance_unbilled_requires_auth(self):
        """Finance unbilled should require auth"""
        response = requests.get(f"{BASE_URL}/api/finance/unbilled-dollars")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_smart_assign_requires_auth(self):
        """Smart assign should require auth"""
        response = requests.post(f"{BASE_URL}/api/tickets/TKT-001/smart-assign")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
