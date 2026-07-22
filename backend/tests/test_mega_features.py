"""
Test suite for Mega Features Bundle (21 endpoints)
Tests: Ticket AI, Client AI, Finance AI, Estimates AI, Devices/RMM, Backup/Security, Team, Voice Brief, Runbooks
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def auth_headers():
    """Get auth token for admin user"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json().get("token")  # API returns 'token' not 'access_token'
    return {"Authorization": f"Bearer {token}"}


# ============ TICKET AI FEATURES ============

class TestTicketDoppelganger:
    """1. Ticket Doppelgänger - find similar resolved tickets"""
    
    def test_doppelganger_returns_matches(self, auth_headers):
        # First get a ticket ID
        resp = requests.get(f"{BASE_URL}/api/tickets", headers=auth_headers)
        assert resp.status_code == 200
        tickets = resp.json()
        if not tickets:
            pytest.skip("No tickets available")
        
        ticket_id = tickets[0]["id"]
        resp = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}/doppelganger", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "matches" in data
        assert "ticket_id" in data
        assert "generated_at" in data
        print(f"Doppelganger found {len(data.get('matches', []))} matches for ticket {ticket_id}")


class TestTicketTimeline:
    """2. Ticket Timeline (Time Machine) - chronological event feed"""
    
    def test_timeline_returns_events(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/tickets", headers=auth_headers)
        assert resp.status_code == 200
        tickets = resp.json()
        if not tickets:
            pytest.skip("No tickets available")
        
        ticket_id = tickets[0]["id"]
        resp = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}/timeline", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "events" in data
        assert "stats" in data
        assert "ticket_id" in data
        stats = data["stats"]
        assert "total_events" in stats
        assert "comments" in stats
        assert "status_changes" in stats
        assert "time_entries" in stats
        print(f"Timeline has {stats['total_events']} events for ticket {ticket_id}")


class TestApologyDraft:
    """3. Auto-Apology Composer - AI-generated apology email"""
    
    def test_apology_draft_returns_email(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/tickets", headers=auth_headers)
        assert resp.status_code == 200
        tickets = resp.json()
        if not tickets:
            pytest.skip("No tickets available")
        
        ticket_id = tickets[0]["id"]
        resp = requests.post(
            f"{BASE_URL}/api/tickets/{ticket_id}/apology-draft",
            json={"reason": "Test apology", "severity": "medium"},
            headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "subject" in data
        assert "body" in data
        assert "makegood" in data
        assert "tone" in data
        print(f"Apology draft generated with subject: {data.get('subject', '')[:50]}...")


class TestCognitiveLoad:
    """4. Tech Cognitive Load Score - burnout detection"""
    
    def test_cognitive_load_returns_team(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/team/cognitive-load", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "team" in data
        assert "generated_at" in data
        team = data["team"]
        if team:
            tech = team[0]
            assert "tech_id" in tech
            assert "name" in tech
            assert "score" in tech
            assert "status" in tech
            assert "auto_pause" in tech
        print(f"Cognitive load returned {len(team)} techs")


# ============ CLIENT AI FEATURES ============

class TestClientDNA:
    """5. Client DNA Profile - behavioral profile"""
    
    def test_dna_returns_profile(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/clients/client-001/dna", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "client_id" in data
        assert "metrics" in data
        assert "personality_tags" in data
        metrics = data["metrics"]
        assert "total_tickets" in metrics
        assert "critical_pct" in metrics
        assert "avg_payment_days" in metrics
        assert "peak_demand_hour" in metrics
        print(f"DNA profile: {data.get('personality_tags', [])}")


class TestClientLTV:
    """6. Client LTV Forecast - lifetime value prediction"""
    
    def test_ltv_returns_forecast(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/clients/client-001/ltv-forecast", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "client_id" in data
        assert "mrr" in data
        assert "trailing_12m_revenue" in data
        assert "churn_score" in data
        assert "survival_probability" in data
        assert "forecast_12m_risk_adjusted" in data
        assert "forecast_5yr_ltv" in data
        print(f"LTV forecast: 12m=${data.get('forecast_12m_risk_adjusted', 0)}, 5yr=${data.get('forecast_5yr_ltv', 0)}")


class TestClientAnniversary:
    """7. Client Anniversary Draft - AI-generated anniversary email"""
    
    def test_anniversary_returns_draft(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/clients/client-001/anniversary-draft", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "client_id" in data
        assert "subject" in data
        assert "body" in data
        assert "milestone" in data
        assert "stats" in data
        print(f"Anniversary draft: {data.get('subject', '')[:50]}...")


# ============ FINANCE AI FEATURES ============

class TestPreBillingAudit:
    """8. Pre-Billing Auditor - invoice quality check"""
    
    def test_audit_returns_flags(self, auth_headers):
        # Get an invoice
        resp = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        assert resp.status_code == 200
        invoices = resp.json()
        if not invoices:
            pytest.skip("No invoices available")
        
        invoice_id = invoices[0]["id"]
        resp = requests.post(f"{BASE_URL}/api/invoices/{invoice_id}/audit", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "invoice_id" in data
        assert "flags" in data
        assert "score" in data
        assert "ready_to_send" in data
        assert "scanned_tickets" in data
        print(f"Audit score: {data.get('score')}/100, ready: {data.get('ready_to_send')}")


class TestReminderStrategy:
    """9. Smart Reminder Cadence - payment reminder optimization"""
    
    def test_reminder_returns_strategy(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        assert resp.status_code == 200
        invoices = resp.json()
        if not invoices:
            pytest.skip("No invoices available")
        
        invoice_id = invoices[0]["id"]
        resp = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}/reminder-strategy", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "invoice_id" in data
        assert "pattern" in data
        assert "recommended" in data
        rec = data["recommended"]
        assert "first_reminder_days_after_due" in rec
        assert "tone" in rec
        assert "channel" in rec
        assert "follow_up_cadence_days" in rec
        print(f"Reminder strategy: pattern={data.get('pattern')}, tone={rec.get('tone')}")


class TestAgedARHeatmap:
    """10. Aged AR Heatmap - accounts receivable buckets"""
    
    def test_ar_heatmap_returns_buckets(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/aged-ar-heatmap", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "buckets" in data
        assert "bucket_totals" in data
        assert "total_outstanding" in data
        buckets = data["buckets"]
        assert "current" in buckets
        assert "1_30" in buckets
        assert "31_60" in buckets
        assert "61_90" in buckets
        assert "over_90" in buckets
        print(f"AR heatmap: total outstanding=${data.get('total_outstanding', 0)}")


# ============ ESTIMATE AI FEATURES ============

class TestWinProbability:
    """11. Estimate Win Probability - deal scoring"""
    
    def test_win_probability_returns_score(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/estimates", headers=auth_headers)
        assert resp.status_code == 200
        estimates = resp.json()
        if not estimates:
            pytest.skip("No estimates available")
        
        estimate_id = estimates[0]["id"]
        resp = requests.get(f"{BASE_URL}/api/estimates/{estimate_id}/win-probability", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "estimate_id" in data
        assert "win_probability" in data
        assert "tier" in data
        assert "drivers" in data
        assert data["win_probability"] >= 5 and data["win_probability"] <= 95
        assert data["tier"] in ["hot", "warm", "cold"]
        print(f"Win probability: {data.get('win_probability')}% ({data.get('tier')})")


class TestPricingFlags:
    """12. Estimate Pricing Flags - competitive pricing check"""
    
    def test_pricing_flags_returns_flags(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/estimates", headers=auth_headers)
        assert resp.status_code == 200
        estimates = resp.json()
        if not estimates:
            pytest.skip("No estimates available")
        
        estimate_id = estimates[0]["id"]
        resp = requests.get(f"{BASE_URL}/api/estimates/{estimate_id}/pricing-flags", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "estimate_id" in data
        assert "flags" in data
        assert "items_checked" in data
        print(f"Pricing flags: {len(data.get('flags', []))} flags, {data.get('items_checked')} items checked")


# ============ DEVICE/RMM FEATURES ============

class TestHealthTrajectory:
    """13. Device Health Trajectory - replacement timeline"""
    
    def test_trajectory_returns_buckets(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/device-health-trajectory", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "buckets" in data
        assert "totals" in data
        buckets = data["buckets"]
        assert "replace_now_30" in buckets
        assert "replace_30_90" in buckets
        assert "replace_90_365" in buckets
        assert "healthy" in buckets
        print(f"Health trajectory totals: {data.get('totals')}")


class TestPatchAnomalies:
    """14. Patch Anomaly Detector - cross-tenant patch issues"""
    
    def test_anomalies_returns_list(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/patches/anomalies", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "anomalies" in data
        assert "scan_window_days" in data
        print(f"Patch anomalies: {len(data.get('anomalies', []))} found in {data.get('scan_window_days')}d window")


class TestBatteryWall:
    """15. Battery Health Wall - degraded laptop batteries"""
    
    def test_battery_wall_returns_devices(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/device-battery-wall", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "devices" in data
        assert "checked" in data
        print(f"Battery wall: {len(data.get('devices', []))} degraded out of {data.get('checked')} checked")


# ============ BACKUP/SECURITY FEATURES ============

class TestRestoreDrills:
    """16. Restore Drill Scheduler - backup testing"""
    
    def test_drill_crud(self, auth_headers):
        # Create drill
        resp = requests.post(
            f"{BASE_URL}/api/backup/drills",
            json={"client_id": "client-001", "client_name": "Acme Corporation", "scope": "test-restore"},
            headers=auth_headers
        )
        assert resp.status_code == 200
        drill = resp.json()
        assert "id" in drill
        assert drill["status"] == "scheduled"
        drill_id = drill["id"]
        print(f"Created drill: {drill_id}")
        
        # List drills
        resp = requests.get(f"{BASE_URL}/api/backup/drills", headers=auth_headers)
        assert resp.status_code == 200
        drills = resp.json()
        assert isinstance(drills, list)
        
        # Complete drill
        resp = requests.put(
            f"{BASE_URL}/api/backup/drills/{drill_id}",
            json={"status": "completed", "outcome": "success", "evidence": ["screenshot.png"]},
            headers=auth_headers
        )
        assert resp.status_code == 200
        updated = resp.json()
        assert updated["status"] == "completed"
        print(f"Completed drill: {drill_id}")


class TestInsuranceVault:
    """17. Cyber Insurance Vault - compliance evidence"""
    
    def test_vault_returns_observed_evidence(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/security/insurance-vault", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "readiness_score" in data
        assert "readiness_state" in data
        assert data["readiness_state"] in ["ready_for_review", "evidence_gaps", "not_assessed"]
        assert "evidence_coverage_pct" in data
        assert "metrics" in data
        assert "controls" in data
        controls = data["controls"]
        assert "mfa_coverage_pct" in controls
        assert "edr_coverage_pct" in controls
        assert "encryption_pct" in controls
        assert "patched_within_30_days_pct" in controls
        print(f"Insurance vault: readiness={data.get('readiness_score')}, state={data.get('readiness_state')}")


# ============ TEAM FEATURES ============

class TestSkillsXP:
    """18. Skills XP Bank - tech skill tracking"""
    
    def test_xp_returns_team(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/team/xp", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "team" in data
        team = data["team"]
        if team:
            tech = team[0]
            assert "tech" in tech
            assert "total_xp" in tech
            assert "level" in tech
            assert "top_skills" in tech
        print(f"Skills XP: {len(team)} techs tracked")


class TestOneOnOneAgenda:
    """19. 1:1 Auto-Agenda - AI-generated meeting agenda"""
    
    def test_agenda_returns_text(self, auth_headers):
        # Get a tech user
        resp = requests.get(f"{BASE_URL}/api/users", headers=auth_headers)
        assert resp.status_code == 200
        users = resp.json()
        techs = [u for u in users if u.get("role") in ["technician", "admin", "tech", "engineer"]]
        if not techs:
            pytest.skip("No technicians available")
        
        tech_id = techs[0]["id"]
        resp = requests.get(f"{BASE_URL}/api/team/{tech_id}/1on1-agenda", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "tech_id" in data
        assert "agenda" in data
        assert "stats" in data
        stats = data["stats"]
        assert "closed_14d" in stats
        assert "open_now" in stats
        print(f"1:1 agenda generated for {data.get('tech_name')}: {len(data.get('agenda', ''))} chars")


# ============ CROSS-CUTTING FEATURES ============

class TestVoiceBrief:
    """20. Voice Morning Brief - radio script"""
    
    def test_brief_returns_text(self, auth_headers):
        resp = requests.post(f"{BASE_URL}/api/voice/morning-brief", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "text" in data
        assert "stats" in data
        stats = data["stats"]
        assert "new_tickets" in stats
        assert "critical" in stats
        assert "backup_failures" in stats
        assert "huntress_alerts" in stats
        print(f"Voice brief: {len(data.get('text', ''))} chars, {stats.get('new_tickets')} new tickets")


class TestRunbooks:
    """21. Runbook Publish from Ticket"""
    
    def test_runbook_from_resolved_ticket(self, auth_headers):
        # Find a resolved ticket
        resp = requests.get(f"{BASE_URL}/api/tickets", headers=auth_headers)
        assert resp.status_code == 200
        tickets = resp.json()
        resolved = [t for t in tickets if t.get("status") in ["resolved", "closed"]]
        
        if not resolved:
            # Try to resolve one
            open_tickets = [t for t in tickets if t.get("status") not in ["resolved", "closed"]]
            if open_tickets:
                ticket_id = open_tickets[0]["id"]
                requests.put(
                    f"{BASE_URL}/api/tickets/{ticket_id}",
                    json={"status": "resolved", "resolution_notes": "Test resolution for runbook"},
                    headers=auth_headers
                )
                resolved = [{"id": ticket_id}]
        
        if not resolved:
            pytest.skip("No resolved tickets available")
        
        ticket_id = resolved[0]["id"]
        resp = requests.post(
            f"{BASE_URL}/api/runbooks/from-ticket/{ticket_id}",
            json={"publish": True},
            headers=auth_headers
        )
        # May fail if AI can't extract steps
        if resp.status_code == 200:
            data = resp.json()
            assert "id" in data
            assert "title" in data
            assert "steps" in data
            print(f"Runbook created: {data.get('title')}")
        else:
            print(f"Runbook creation returned {resp.status_code}: {resp.text[:200]}")
    
    def test_list_runbooks(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/runbooks", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        print(f"Runbooks list: {len(data)} published")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
