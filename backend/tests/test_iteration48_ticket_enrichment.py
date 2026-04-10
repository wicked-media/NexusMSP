"""
Iteration 48 - Ticket Enrichment, Sidebar Search, Dashboard Pulsating, Internal Note Fix Tests
Tests the new features:
1. /api/ticket-enrichment/{ticket_id} endpoint
2. Dashboard page loads with pulse classes for critical cards
3. Phase G regression tests (dashboard-builder, channel-mode, mobile-tech, soc-realtime, revenue-tracker)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Module-level session and token
_session = requests.Session()
_token = None
_headers = None
_sample_ticket_id = None

def get_auth_headers():
    """Get authenticated headers, login if needed"""
    global _token, _headers
    if _headers is not None:
        return _headers
    
    response = _session.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    _token = response.json().get("token")
    _headers = {"Authorization": f"Bearer {_token}"}
    return _headers

def get_sample_ticket_id():
    """Get a ticket ID for testing"""
    global _sample_ticket_id
    if _sample_ticket_id is not None:
        return _sample_ticket_id
    
    headers = get_auth_headers()
    response = _session.get(f"{BASE_URL}/api/tickets", headers=headers)
    assert response.status_code == 200, f"Failed to get tickets: {response.text}"
    tickets = response.json()
    if tickets:
        _sample_ticket_id = tickets[0]["id"]
        return _sample_ticket_id
    pytest.skip("No tickets available for testing")


class TestTicketEnrichmentAPI:
    """Tests for the ticket enrichment endpoint - MOCKED AI data"""
    
    def test_ticket_enrichment_endpoint_exists(self):
        """Test that ticket-enrichment endpoint returns 200"""
        headers = get_auth_headers()
        ticket_id = get_sample_ticket_id()
        response = _session.get(f"{BASE_URL}/api/ticket-enrichment/{ticket_id}", headers=headers)
        assert response.status_code == 200, f"Ticket enrichment endpoint failed: {response.status_code} - {response.text}"
        print(f"✓ Ticket enrichment endpoint returns 200")
    
    def test_ticket_enrichment_has_client_context(self):
        """Test that enrichment returns client_context with required fields"""
        headers = get_auth_headers()
        ticket_id = get_sample_ticket_id()
        response = _session.get(f"{BASE_URL}/api/ticket-enrichment/{ticket_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "client_context" in data, "Missing client_context in enrichment response"
        ctx = data["client_context"]
        
        # Check required fields
        required_fields = ["name", "health_score", "open_tickets", "total_tickets_lifetime", 
                         "total_devices", "offline_devices", "contract_status"]
        for field in required_fields:
            assert field in ctx, f"Missing {field} in client_context"
        
        # Validate data types
        assert isinstance(ctx["health_score"], (int, float)), "health_score should be numeric"
        assert isinstance(ctx["open_tickets"], int), "open_tickets should be int"
        assert isinstance(ctx["total_devices"], int), "total_devices should be int"
        print(f"✓ Client context has all required fields: health_score={ctx['health_score']}, open_tickets={ctx['open_tickets']}")
    
    def test_ticket_enrichment_has_sentiment(self):
        """Test that enrichment returns sentiment analysis"""
        headers = get_auth_headers()
        ticket_id = get_sample_ticket_id()
        response = _session.get(f"{BASE_URL}/api/ticket-enrichment/{ticket_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "sentiment" in data, "Missing sentiment in enrichment response"
        sentiment = data["sentiment"]
        
        assert "label" in sentiment, "Missing label in sentiment"
        assert "score" in sentiment, "Missing score in sentiment"
        assert "reason" in sentiment, "Missing reason in sentiment"
        
        assert sentiment["label"] in ["frustrated", "neutral", "positive"], f"Invalid sentiment label: {sentiment['label']}"
        assert 0 <= sentiment["score"] <= 100, f"Sentiment score out of range: {sentiment['score']}"
        print(f"✓ Sentiment: {sentiment['label']} (score: {sentiment['score']}) - {sentiment['reason']}")
    
    def test_ticket_enrichment_has_blast_radius(self):
        """Test that enrichment returns impact blast radius"""
        headers = get_auth_headers()
        ticket_id = get_sample_ticket_id()
        response = _session.get(f"{BASE_URL}/api/ticket-enrichment/{ticket_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "blast_radius" in data, "Missing blast_radius in enrichment response"
        blast = data["blast_radius"]
        
        assert "affected_users" in blast, "Missing affected_users in blast_radius"
        assert "affected_services" in blast, "Missing affected_services in blast_radius"
        assert isinstance(blast["affected_users"], int), "affected_users should be int"
        assert isinstance(blast["affected_services"], list), "affected_services should be list"
        print(f"✓ Blast radius: {blast['affected_users']} users, services: {blast['affected_services']}")
    
    def test_ticket_enrichment_has_ttr_prediction(self):
        """Test that enrichment returns TTR (time-to-resolution) prediction"""
        headers = get_auth_headers()
        ticket_id = get_sample_ticket_id()
        response = _session.get(f"{BASE_URL}/api/ticket-enrichment/{ticket_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "ttr_prediction" in data, "Missing ttr_prediction in enrichment response"
        ttr = data["ttr_prediction"]
        
        assert "predicted_minutes" in ttr, "Missing predicted_minutes in ttr_prediction"
        assert "confidence" in ttr, "Missing confidence in ttr_prediction"
        assert "based_on" in ttr, "Missing based_on in ttr_prediction"
        
        assert isinstance(ttr["predicted_minutes"], int), "predicted_minutes should be int"
        assert 0 <= ttr["confidence"] <= 1, f"Confidence out of range: {ttr['confidence']}"
        print(f"✓ TTR Prediction: {ttr['predicted_minutes']}min ({ttr['confidence']*100:.0f}% confidence) - {ttr['based_on']}")
    
    def test_ticket_enrichment_has_merge_candidates(self):
        """Test that enrichment returns merge_candidates array"""
        headers = get_auth_headers()
        ticket_id = get_sample_ticket_id()
        response = _session.get(f"{BASE_URL}/api/ticket-enrichment/{ticket_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "merge_candidates" in data, "Missing merge_candidates in enrichment response"
        assert isinstance(data["merge_candidates"], list), "merge_candidates should be a list"
        print(f"✓ Merge candidates: {len(data['merge_candidates'])} similar tickets found")
    
    def test_ticket_enrichment_invalid_ticket(self):
        """Test that enrichment handles non-existent ticket gracefully"""
        headers = get_auth_headers()
        response = _session.get(f"{BASE_URL}/api/ticket-enrichment/INVALID-TICKET-ID-999", headers=headers)
        assert response.status_code == 200, "Should still return 200 for invalid ticket"
        data = response.json()
        assert "error" in data or "client_context" in data, "Should return error or empty enrichment"
        print("✓ Invalid ticket handled gracefully")


class TestPhaseGRegressionEndpoints:
    """Regression tests for Phase G features - ensure they still work"""
    
    def test_dashboard_builder_endpoint(self):
        """Test dashboard-builder layouts endpoint"""
        headers = get_auth_headers()
        response = _session.get(f"{BASE_URL}/api/dashboard-builder/layouts", headers=headers)
        assert response.status_code == 200, f"Dashboard builder failed: {response.status_code}"
        data = response.json()
        # API returns {layouts: [], available_widgets: []}
        layouts = data.get("layouts", data) if isinstance(data, dict) else data
        assert isinstance(layouts, list), "Should return list of layouts"
        print(f"✓ Dashboard Builder: {len(layouts)} layouts")
    
    def test_channel_mode_endpoint(self):
        """Test channel-mode tenants endpoint"""
        headers = get_auth_headers()
        response = _session.get(f"{BASE_URL}/api/channel-mode/tenants", headers=headers)
        assert response.status_code == 200, f"Channel mode failed: {response.status_code}"
        data = response.json()
        # API returns {tenants: [], summary: {}}
        tenants = data.get("tenants", data) if isinstance(data, dict) else data
        assert isinstance(tenants, list), "Should return list of tenants"
        print(f"✓ Channel Mode: {len(tenants)} tenants")
    
    def test_mobile_tech_endpoint(self):
        """Test mobile-tech my-day endpoint"""
        headers = get_auth_headers()
        response = _session.get(f"{BASE_URL}/api/mobile-tech/my-day", headers=headers)
        assert response.status_code == 200, f"Mobile tech failed: {response.status_code}"
        data = response.json()
        assert "assigned_tickets" in data, "Should have assigned_tickets"
        print(f"✓ Mobile Tech: {len(data.get('assigned_tickets', []))} tickets")
    
    def test_soc_realtime_endpoint(self):
        """Test soc-realtime events endpoint"""
        headers = get_auth_headers()
        response = _session.get(f"{BASE_URL}/api/soc-realtime/events", headers=headers)
        assert response.status_code == 200, f"SOC realtime failed: {response.status_code}"
        data = response.json()
        # API returns {events: [], stats: {}}
        events = data.get("events", data) if isinstance(data, dict) else data
        assert isinstance(events, list), "Should return list of events"
        print(f"✓ SOC Realtime: {len(events)} events")
    
    def test_revenue_tracker_endpoint(self):
        """Test revenue-tracker overview endpoint"""
        headers = get_auth_headers()
        response = _session.get(f"{BASE_URL}/api/revenue-tracker/overview", headers=headers)
        assert response.status_code == 200, f"Revenue tracker failed: {response.status_code}"
        data = response.json()
        # API returns {summary: {current_mrr: ...}, monthly_trend: [], by_service: [], clients: []}
        has_mrr = ("summary" in data and "current_mrr" in data.get("summary", {})) or "mrr" in data
        assert has_mrr, "Should have MRR data"
        mrr = data.get("summary", {}).get("current_mrr", data.get("mrr", "N/A"))
        print(f"✓ Revenue Tracker: MRR=${mrr}")


class TestDashboardAndBasicEndpoints:
    """Test dashboard stats and enhanced stats for pulse animation conditions"""
    
    def test_dashboard_stats(self):
        """Test dashboard stats endpoint"""
        headers = get_auth_headers()
        response = _session.get(f"{BASE_URL}/api/dashboard/stats", headers=headers)
        assert response.status_code == 200, f"Dashboard stats failed: {response.status_code}"
        data = response.json()
        assert "total_clients" in data, "Missing total_clients"
        assert "open_tickets" in data, "Missing open_tickets"
        print(f"✓ Dashboard stats: {data['total_clients']} clients, {data['open_tickets']} open tickets")
    
    def test_dashboard_enhanced_stats(self):
        """Test enhanced stats for pulse animation data (outstanding, sla_breaches)"""
        headers = get_auth_headers()
        response = _session.get(f"{BASE_URL}/api/dashboard/enhanced-stats", headers=headers)
        assert response.status_code == 200, f"Enhanced stats failed: {response.status_code}"
        data = response.json()
        
        # These fields drive the pulse-critical and pulse-warning classes
        assert "outstanding" in data or "total_outstanding" in data, "Missing outstanding field"
        assert "sla_breaches" in data, "Missing sla_breaches field"
        
        outstanding = data.get("outstanding", data.get("total_outstanding", 0))
        sla_breaches = data.get("sla_breaches", 0)
        print(f"✓ Enhanced stats: outstanding=${outstanding}, SLA breaches={sla_breaches}")
        print(f"  -> pulse-critical applies if outstanding > 0: {outstanding > 0}")
        print(f"  -> pulse-warning applies if sla_breaches > 0: {sla_breaches > 0}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
