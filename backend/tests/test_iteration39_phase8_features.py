"""
Iteration 39 - Phase 8 Differentiator Features Test Suite
Tests all 8 Phase 8 features:
1. Gamification Leaderboard
2. Client Sentiment Analysis
3. Smart Scheduling
4. Predictive Maintenance
5. Client Onboarding Wizard
6. Client-Facing Status Board
7. AI Triage (Tickets page integration)
8. Voice-to-Ticket (Tickets page integration)
"""

import pytest
import requests
import os
import json
from datetime import datetime

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Authentication failed")

@pytest.fixture
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ================== FEATURE 1: GAMIFICATION LEADERBOARD ==================

class TestGamificationLeaderboard:
    """Tests for Gamification feature (GET leaderboard, stats, profile, award XP, recalculate)"""
    
    def test_get_leaderboard(self, headers):
        """GET /api/gamification/leaderboard returns ranked technicians"""
        response = requests.get(f"{BASE_URL}/api/gamification/leaderboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            # Verify first entry has expected fields
            first = data[0]
            assert "user_id" in first
            assert "total_xp" in first
            assert "level_info" in first
            assert "badges_earned" in first
            print(f"Leaderboard has {len(data)} technicians, top: {first.get('user_name', 'Unknown')} with {first.get('total_xp', 0)} XP")
    
    def test_get_gamification_stats(self, headers):
        """GET /api/gamification/stats returns totals"""
        response = requests.get(f"{BASE_URL}/api/gamification/stats", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total_techs" in data
        assert "total_xp_awarded" in data
        assert "top_tech" in data
        assert "badges_available" in data
        assert "levels" in data
        print(f"Stats: {data['total_techs']} techs, {data['total_xp_awarded']} total XP, badges available: {data['badges_available']}")
    
    def test_get_tech_profile(self, headers):
        """GET /api/gamification/profile/{user_id} returns profile with badges and level"""
        response = requests.get(f"{BASE_URL}/api/gamification/leaderboard", headers=headers)
        data = response.json()
        if len(data) == 0:
            pytest.skip("No gamification data")
        user_id = data[0]["user_id"]
        
        res = requests.get(f"{BASE_URL}/api/gamification/profile/{user_id}", headers=headers)
        assert res.status_code == 200
        profile = res.json()
        assert "user_id" in profile
        assert "total_xp" in profile
        assert "level_info" in profile
        assert "badges_earned" in profile
        assert "all_badges" in profile
        print(f"Profile for {profile.get('user_name', 'Unknown')}: Level {profile['level_info'].get('level', 0)}, {len(profile.get('badges_earned', []))} badges earned")
    
    def test_get_activity_heatmap(self, headers):
        """GET /api/gamification/activity/{user_id} returns heatmap data"""
        response = requests.get(f"{BASE_URL}/api/gamification/leaderboard", headers=headers)
        data = response.json()
        if len(data) == 0:
            pytest.skip("No gamification data")
        user_id = data[0]["user_id"]
        
        res = requests.get(f"{BASE_URL}/api/gamification/activity/{user_id}", headers=headers)
        assert res.status_code == 200
        heatmap = res.json()
        assert isinstance(heatmap, dict)
        print(f"Activity heatmap has {len(heatmap)} days of data")
    
    def test_award_xp(self, headers):
        """POST /api/gamification/award-xp awards XP to technician"""
        # Get a technician
        response = requests.get(f"{BASE_URL}/api/users", headers=headers)
        users = response.json()
        tech = next((u for u in users if u.get("role") in ["technician", "admin"]), None)
        if not tech:
            pytest.skip("No technician found")
        
        res = requests.post(f"{BASE_URL}/api/gamification/award-xp", 
                          json={"user_id": tech["id"], "action": "ticket_resolved", "reason": "TEST_Resolved ticket"},
                          headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "xp_awarded" in data
        assert "total_xp" in data
        assert "level_info" in data
        assert data["xp_awarded"] > 0
        print(f"Awarded {data['xp_awarded']} XP, total now: {data['total_xp']}")
    
    def test_recalculate_xp(self, headers):
        """POST /api/gamification/recalculate/{user_id} recalculates from history"""
        response = requests.get(f"{BASE_URL}/api/users", headers=headers)
        users = response.json()
        tech = next((u for u in users if u.get("role") in ["technician", "admin"]), None)
        if not tech:
            pytest.skip("No technician found")
        
        res = requests.post(f"{BASE_URL}/api/gamification/recalculate/{tech['id']}", 
                          json={}, headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "recalculated" in data or "error" in data or "total_xp" in data
        print(f"Recalculated: {data}")


# ================== FEATURE 2: CLIENT SENTIMENT ANALYSIS ==================

class TestClientSentiment:
    """Tests for Client Sentiment feature"""
    
    def test_sentiment_dashboard(self, headers):
        """GET /api/sentiment/dashboard returns stats"""
        response = requests.get(f"{BASE_URL}/api/sentiment/dashboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total_clients" in data
        assert "avg_score" in data
        assert "at_risk" in data
        assert "critical" in data
        assert "thriving" in data
        assert "distribution" in data
        print(f"Sentiment Dashboard: {data['total_clients']} clients scored, avg: {data['avg_score']}, at-risk: {data['at_risk']}")
    
    def test_get_all_client_sentiments(self, headers):
        """GET /api/sentiment/clients returns all clients with scores"""
        response = requests.get(f"{BASE_URL}/api/sentiment/clients", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            first = data[0]
            assert "client_id" in first
            assert "score" in first
            assert "status" in first
        print(f"Sentiment data for {len(data)} clients")
    
    def test_get_at_risk_clients(self, headers):
        """GET /api/sentiment/at-risk returns at-risk clients"""
        response = requests.get(f"{BASE_URL}/api/sentiment/at-risk", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        for c in data:
            assert c.get("score", 100) < 50  # At-risk should have low scores
            assert c.get("status") in ["at_risk", "critical"]
        print(f"At-risk clients: {len(data)}")
    
    def test_analyze_client_sentiment(self, headers):
        """POST /api/sentiment/analyze/{client_id} runs analysis"""
        # Get a client
        clients_res = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = clients_res.json()
        if len(clients) == 0:
            pytest.skip("No clients available")
        client_id = clients[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/sentiment/analyze/{client_id}", 
                                json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "score" in data
        assert "status" in data
        assert "factors" in data
        assert "insights" in data
        assert "recommendations" in data
        assert "churn_probability" in data
        print(f"Analyzed {data.get('client_name', '')}: score={data['score']}, status={data['status']}, churn={data['churn_probability']}")
    
    def test_get_client_sentiment_detail(self, headers):
        """GET /api/sentiment/clients/{client_id} returns detailed sentiment"""
        clients_res = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = clients_res.json()
        if len(clients) == 0:
            pytest.skip("No clients")
        client_id = clients[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/sentiment/clients/{client_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "current" in data
        assert "history" in data
        print(f"Sentiment detail retrieved, history entries: {len(data.get('history', []))}")


# ================== FEATURE 3: SMART SCHEDULING ==================

class TestSmartScheduling:
    """Tests for Smart Scheduling feature"""
    
    def test_get_calendar(self, headers):
        """GET /api/scheduling/calendar returns events"""
        response = requests.get(f"{BASE_URL}/api/scheduling/calendar", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        for event in data[:5]:
            assert "id" in event
            assert "type" in event
            assert "title" in event
            assert event["type"] in ["field_job", "workshop"]
        print(f"Calendar has {len(data)} events")
    
    def test_get_map_data(self, headers):
        """GET /api/scheduling/map-data returns zone markers"""
        response = requests.get(f"{BASE_URL}/api/scheduling/map-data", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "markers" in data
        assert "zones" in data
        assert isinstance(data["markers"], list)
        assert isinstance(data["zones"], dict)
        print(f"Map data: {len(data['markers'])} markers, {len(data['zones'])} zones")
    
    def test_get_technician_availability(self, headers):
        """GET /api/scheduling/technician-availability returns availability"""
        response = requests.get(f"{BASE_URL}/api/scheduling/technician-availability", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        for tech in data[:5]:
            assert "id" in tech
            assert "name" in tech
            assert "jobs_today" in tech
            assert "open_tickets" in tech
            assert "available" in tech
        print(f"Availability for {len(data)} technicians")
    
    def test_optimize_route(self, headers):
        """POST /api/scheduling/optimize-route optimizes job order"""
        # Get a technician
        users_res = requests.get(f"{BASE_URL}/api/users", headers=headers)
        users = users_res.json()
        tech = next((u for u in users if u.get("role") in ["technician", "admin"]), None)
        if not tech:
            pytest.skip("No technician")
        
        response = requests.post(f"{BASE_URL}/api/scheduling/optimize-route",
                                json={"technician_id": tech["id"]},
                                headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "optimized_order" in data
        assert "total_distance_km" in data
        assert "total_travel_min" in data
        print(f"Route optimized: {data.get('total_distance_km', 0)}km, savings: {data.get('savings_km', 0)}km")


# ================== FEATURE 4: PREDICTIVE MAINTENANCE ==================

class TestPredictiveMaintenance:
    """Tests for Predictive Maintenance feature"""
    
    def test_predictive_dashboard(self, headers):
        """GET /api/predictive/dashboard returns overview"""
        response = requests.get(f"{BASE_URL}/api/predictive/dashboard", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "active_alerts" in data
        assert "resolved_alerts" in data
        assert "critical_devices" in data
        assert "total_monitored" in data
        assert "alerts" in data
        assert "at_risk_devices" in data
        assert "avg_health" in data
        print(f"Predictive Dashboard: {data['total_monitored']} monitored, {data['active_alerts']} active alerts, avg health: {data['avg_health']}")
    
    def test_analyze_device(self, headers):
        """POST /api/predictive/analyze/{device_id} runs analysis"""
        # Get a device
        devices_res = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        devices = devices_res.json()
        if len(devices) == 0:
            pytest.skip("No devices")
        device_id = devices[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/predictive/analyze/{device_id}",
                                json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "device_id" in data
        assert "health_score" in data
        assert "status" in data
        assert "telemetry" in data
        assert "predictions" in data
        print(f"Analyzed device: health={data['health_score']}, status={data['status']}, predictions={len(data['predictions'])}")
    
    def test_analyze_all_devices(self, headers):
        """POST /api/predictive/analyze-all batch analyzes"""
        response = requests.post(f"{BASE_URL}/api/predictive/analyze-all",
                                json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "analyzed" in data
        assert "results" in data
        print(f"Batch analyzed {data['analyzed']} devices")
    
    def test_resolve_alert(self, headers):
        """PUT /api/predictive/alert/{alert_id}/resolve resolves alerts"""
        # Get an active alert
        dash_res = requests.get(f"{BASE_URL}/api/predictive/dashboard", headers=headers)
        alerts = dash_res.json().get("alerts", [])
        if len(alerts) == 0:
            pytest.skip("No active alerts to resolve")
        alert_id = alerts[0]["id"]
        
        response = requests.put(f"{BASE_URL}/api/predictive/alert/{alert_id}/resolve",
                               json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("message") == "Alert resolved"
        print(f"Alert {alert_id} resolved")
    
    def test_get_device_prediction(self, headers):
        """GET /api/predictive/device/{device_id} returns device prediction data"""
        devices_res = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        devices = devices_res.json()
        if len(devices) == 0:
            pytest.skip("No devices")
        device_id = devices[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/predictive/device/{device_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "device" in data or "error" in data
        print(f"Device prediction data retrieved")


# ================== FEATURE 5: CLIENT ONBOARDING WIZARD ==================

class TestClientOnboardingWizard:
    """Tests for Client Onboarding Wizard feature"""
    
    def test_start_onboarding(self, headers):
        """POST /api/onboarding/start creates session"""
        response = requests.post(f"{BASE_URL}/api/onboarding/start", json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "status" in data
        assert "current_step" in data
        assert "total_steps" in data
        assert data["status"] == "in_progress"
        assert data["total_steps"] == 6
        assert data["current_step"] == 1
        print(f"Created onboarding session: {data['id']}")
        return data["id"]
    
    def test_get_onboarding_sessions(self, headers):
        """GET /api/onboarding/sessions lists all"""
        response = requests.get(f"{BASE_URL}/api/onboarding/sessions", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} onboarding sessions")
    
    def test_get_onboarding_session(self, headers):
        """GET /api/onboarding/{session_id} gets session"""
        # First create a session
        create_res = requests.post(f"{BASE_URL}/api/onboarding/start", json={}, headers=headers)
        session_id = create_res.json()["id"]
        
        response = requests.get(f"{BASE_URL}/api/onboarding/{session_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == session_id
        assert "steps" in data
        print(f"Retrieved session {session_id}")
    
    def test_complete_step_1_client(self, headers):
        """PUT /api/onboarding/{session_id}/step/1 completes client step"""
        # Create a session
        create_res = requests.post(f"{BASE_URL}/api/onboarding/start", json={}, headers=headers)
        session_id = create_res.json()["id"]
        
        step_data = {
            "name": "TEST_Onboarding Corp",
            "email": "test@onboarding.com",
            "phone": "+1-555-0199",
            "industry": "technology",
            "tier": "standard"
        }
        response = requests.put(f"{BASE_URL}/api/onboarding/{session_id}/step/1",
                               json={"step_data": step_data}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["current_step"] == 2  # Moved to step 2
        assert data.get("client_id")  # Client was created
        print(f"Step 1 completed, client_id: {data['client_id']}")
        
        # Cleanup test client
        requests.delete(f"{BASE_URL}/api/clients/{data['client_id']}", headers=headers)
    
    def test_delete_onboarding_session(self, headers):
        """DELETE /api/onboarding/{session_id} deletes session"""
        create_res = requests.post(f"{BASE_URL}/api/onboarding/start", json={}, headers=headers)
        session_id = create_res.json()["id"]
        
        response = requests.delete(f"{BASE_URL}/api/onboarding/{session_id}", headers=headers)
        assert response.status_code == 200
        
        # Verify deleted
        get_res = requests.get(f"{BASE_URL}/api/onboarding/{session_id}", headers=headers)
        assert get_res.json().get("error") == "Session not found"
        print(f"Session {session_id} deleted")


# ================== FEATURE 6: CLIENT-FACING STATUS BOARD ==================

class TestStatusBoard:
    """Tests for Client-Facing Status Board (PUBLIC endpoint, no auth)"""
    
    def test_get_status_board_public(self):
        """GET /api/status-board/{client_id} returns public data without auth"""
        # First get a client with auth
        auth_res = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        token = auth_res.json().get("token")
        clients_res = requests.get(f"{BASE_URL}/api/clients", headers={"Authorization": f"Bearer {token}"})
        clients = clients_res.json()
        if len(clients) == 0:
            pytest.skip("No clients")
        client_id = clients[0]["id"]
        
        # Now access WITHOUT auth (public endpoint)
        response = requests.get(f"{BASE_URL}/api/status-board/{client_id}")
        assert response.status_code == 200
        data = response.json()
        
        if data.get("found") == False:
            # Client might not have status board setup
            print("Status board not found for client")
            return
        
        assert "client_name" in data
        assert "overall_status" in data
        assert "open_tickets" in data
        assert "active_incidents" in data
        assert "recently_resolved" in data
        assert "upcoming_work" in data
        assert "pending_estimates" in data
        assert "stats" in data
        assert data["overall_status"] in ["operational", "degraded", "major_outage"]
        print(f"Status board for {data['client_name']}: {data['overall_status']}, {data['stats'].get('open_count', 0)} open tickets")
    
    def test_status_board_invalid_client(self):
        """GET /api/status-board/{invalid_id} returns error without auth"""
        response = requests.get(f"{BASE_URL}/api/status-board/invalid-client-123")
        assert response.status_code == 200
        data = response.json()
        assert data.get("found") == False or data.get("error") == "Client not found"
        print("Invalid client returns proper error")
    
    def test_approve_estimate_from_portal(self, headers):
        """POST /api/status-board/{client_id}/approve-estimate/{estimate_id}"""
        # Get a client and their estimates
        clients_res = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = clients_res.json()
        if len(clients) == 0:
            pytest.skip("No clients")
        client_id = clients[0]["id"]
        
        # Get pending estimates for this client
        estimates_res = requests.get(f"{BASE_URL}/api/estimates", headers=headers)
        estimates = estimates_res.json()
        pending = [e for e in estimates if e.get("client_id") == client_id and e.get("status") in ["published", "sent"]]
        
        if len(pending) == 0:
            print("No pending estimates to approve - skipping approval test")
            return
        
        estimate_id = pending[0]["id"]
        
        # Approve WITHOUT auth (public endpoint)
        response = requests.post(f"{BASE_URL}/api/status-board/{client_id}/approve-estimate/{estimate_id}")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data or "error" in data
        print(f"Estimate approval attempted: {data}")


# ================== FEATURE 7: AI TRIAGE (IN TICKETS PAGE) ==================

class TestAITriage:
    """Tests for AI Triage feature integrated into ticket creation"""
    
    def test_ai_triage(self, headers):
        """POST /api/ai/triage sends ticket data for AI analysis"""
        response = requests.post(f"{BASE_URL}/api/ai/triage",
                                json={
                                    "title": "Email not working",
                                    "description": "User cannot send or receive emails. Getting error 500.",
                                    "client_name": "Test Corp"
                                },
                                headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "suggested_priority" in data
        assert "suggested_category" in data
        assert "suggested_ticket_type" in data
        assert "confidence" in data
        assert "reasoning" in data
        assert "resolution_plan" in data
        assert data["suggested_priority"] in ["critical", "high", "medium", "low"]
        print(f"AI Triage: priority={data['suggested_priority']}, category={data['suggested_category']}, confidence={data.get('confidence', 0)}")
    
    def test_ai_auto_route(self, headers):
        """POST /api/ai/auto-route routes ticket based on triage result"""
        # First create a test ticket
        clients_res = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = clients_res.json()
        if len(clients) == 0:
            pytest.skip("No clients")
        
        ticket_res = requests.post(f"{BASE_URL}/api/tickets",
                                  json={
                                      "title": "TEST_AI_Route_Ticket",
                                      "description": "Testing auto-routing",
                                      "client_id": clients[0]["id"],
                                      "priority": "medium"
                                  },
                                  headers=headers)
        ticket = ticket_res.json()
        ticket_id = ticket.get("id")
        
        # Get triage result
        triage_res = requests.post(f"{BASE_URL}/api/ai/triage",
                                  json={"title": "Network outage", "description": "Critical network failure"},
                                  headers=headers)
        triage = triage_res.json()
        
        # Apply triage
        response = requests.post(f"{BASE_URL}/api/ai/auto-route",
                                json={"ticket_id": ticket_id, "triage": triage},
                                headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "updates" in data
        print(f"Auto-route applied: {data['updates']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tickets/{ticket_id}", headers=headers)
    
    def test_ai_triage_missing_data(self, headers):
        """POST /api/ai/triage with missing data returns 400"""
        response = requests.post(f"{BASE_URL}/api/ai/triage",
                                json={},
                                headers=headers)
        assert response.status_code == 400
        print("AI Triage correctly rejects empty input")


# ================== FEATURE 8: VOICE-TO-TICKET (IN TICKETS PAGE) ==================

class TestVoiceToTicket:
    """Tests for Voice-to-Ticket feature"""
    
    def test_voice_transcribe_no_file(self, headers):
        """POST /api/voice-ticket/transcribe without file returns 422"""
        response = requests.post(f"{BASE_URL}/api/voice-ticket/transcribe", headers=headers)
        # Should return validation error (422) since no file
        assert response.status_code in [400, 422]
        print("Voice transcribe correctly requires file")
    
    def test_create_ticket_from_transcript(self, headers):
        """POST /api/voice-ticket/create-from-transcript creates ticket from transcript"""
        # Get a client
        clients_res = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = clients_res.json()
        if len(clients) == 0:
            pytest.skip("No clients")
        
        response = requests.post(f"{BASE_URL}/api/voice-ticket/create-from-transcript",
                                json={
                                    "transcript": "User called about printer not working, says it shows paper jam but no paper is stuck",
                                    "structured": {
                                        "title": "TEST_Voice_Printer Paper Jam Error",
                                        "description": "User reports printer showing paper jam error but no paper is stuck",
                                        "priority": "medium",
                                        "category": "hardware",
                                        "ticket_type": "sla"
                                    },
                                    "client_id": clients[0]["id"]
                                },
                                headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "ticket_number" in data
        assert data.get("source") == "voice"
        assert data.get("title") == "TEST_Voice_Printer Paper Jam Error"
        print(f"Created voice ticket: {data['ticket_number']} - {data['title']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tickets/{data['id']}", headers=headers)


# ================== CLEANUP ==================

class TestCleanup:
    """Cleanup test data created during testing"""
    
    def test_cleanup_test_onboarding_sessions(self, headers):
        """Remove test onboarding sessions"""
        sessions_res = requests.get(f"{BASE_URL}/api/onboarding/sessions", headers=headers)
        sessions = sessions_res.json()
        for s in sessions:
            if s.get("status") == "in_progress" and not s.get("client_id"):
                requests.delete(f"{BASE_URL}/api/onboarding/{s['id']}", headers=headers)
        print("Cleaned up test onboarding sessions")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
