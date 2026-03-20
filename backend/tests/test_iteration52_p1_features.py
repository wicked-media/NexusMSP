"""
Iteration 52 - P1 Features Testing
1. AI-Powered Intelligent Ticket Routing
2. Client Self-Service Portal
3. Revenue-per-Ticket Tracking
4. Voice-to-Ticket
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication for all tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Auth failed: {response.text}"
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        """Get auth headers"""
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ==================== INTELLIGENT ROUTING TESTS ====================

class TestIntelligentRouting(TestAuth):
    """Tests for AI-Powered Intelligent Ticket Routing"""
    
    def test_routing_dashboard_returns_data(self, headers):
        """GET /intelligent-routing/dashboard returns technicians, rules, stats"""
        response = requests.get(f"{BASE_URL}/api/intelligent-routing/dashboard", headers=headers)
        assert response.status_code == 200, f"Dashboard failed: {response.text}"
        
        data = response.json()
        # Verify structure
        assert "technicians" in data, "Missing technicians in response"
        assert "routing_rules" in data, "Missing routing_rules in response"
        assert "stats" in data, "Missing stats in response"
        
        # Verify technicians have required fields
        if data["technicians"]:
            tech = data["technicians"][0]
            assert "id" in tech, "Technician missing id"
            assert "name" in tech, "Technician missing name"
            assert "skills" in tech, "Technician missing skills"
            assert "capacity" in tech, "Technician missing capacity"
            assert "open_tickets" in tech, "Technician missing open_tickets"
            assert "is_available" in tech, "Technician missing is_available"
        
        # Verify stats
        stats = data["stats"]
        assert "total_open" in stats, "Stats missing total_open"
        assert "unassigned" in stats, "Stats missing unassigned"
        assert "auto_routed_today" in stats, "Stats missing auto_routed_today"
        assert "routing_accuracy_pct" in stats, "Stats missing routing_accuracy_pct"
        print(f"Dashboard: {len(data['technicians'])} techs, {len(data['routing_rules'])} rules, {stats['unassigned']} unassigned")
    
    def test_route_single_ticket(self, headers):
        """POST /intelligent-routing/route-ticket/{id} assigns ticket with reasoning"""
        # First get a ticket
        tickets_resp = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert tickets_resp.status_code == 200
        tickets = tickets_resp.json()
        
        if tickets:
            ticket_id = tickets[0]["id"]
            response = requests.post(f"{BASE_URL}/api/intelligent-routing/route-ticket/{ticket_id}", headers=headers)
            assert response.status_code == 200, f"Route ticket failed: {response.text}"
            
            data = response.json()
            assert "assigned_to" in data, "Missing assigned_to"
            assert "tech_id" in data, "Missing tech_id"
            assert "confidence" in data, "Missing confidence"
            assert "method" in data, "Missing method"
            assert "reasoning" in data, "Missing reasoning"
            assert isinstance(data["reasoning"], list), "Reasoning should be a list"
            print(f"Routed ticket to {data['assigned_to']} with {data['confidence']}% confidence")
        else:
            pytest.skip("No tickets available to route")
    
    def test_route_ticket_not_found(self, headers):
        """POST /intelligent-routing/route-ticket/{invalid_id} returns 404"""
        response = requests.post(f"{BASE_URL}/api/intelligent-routing/route-ticket/invalid-ticket-id-999", headers=headers)
        assert response.status_code == 404
    
    def test_create_routing_rule(self, headers):
        """POST /intelligent-routing/rules creates a new routing rule"""
        rule_data = {
            "name": "TEST_Critical Security → Senior Tech",
            "priority": "critical",
            "category": "security",
            "route_to": "highest_skill",
            "enabled": True
        }
        response = requests.post(f"{BASE_URL}/api/intelligent-routing/rules", json=rule_data, headers=headers)
        assert response.status_code == 200, f"Create rule failed: {response.text}"
        
        data = response.json()
        assert "id" in data, "Rule missing id"
        assert data["name"] == rule_data["name"], "Rule name mismatch"
        assert data["priority"] == rule_data["priority"], "Rule priority mismatch"
        assert data["route_to"] == rule_data["route_to"], "Rule route_to mismatch"
        
        # Store for cleanup
        TestIntelligentRouting.test_rule_id = data["id"]
        print(f"Created rule: {data['id']}")
    
    def test_delete_routing_rule(self, headers):
        """DELETE /intelligent-routing/rules/{id} deletes a rule"""
        if hasattr(TestIntelligentRouting, 'test_rule_id'):
            response = requests.delete(f"{BASE_URL}/api/intelligent-routing/rules/{TestIntelligentRouting.test_rule_id}", headers=headers)
            assert response.status_code == 200, f"Delete rule failed: {response.text}"
            print(f"Deleted rule: {TestIntelligentRouting.test_rule_id}")
        else:
            pytest.skip("No test rule to delete")
    
    def test_bulk_route_tickets(self, headers):
        """POST /intelligent-routing/bulk-route routes all unassigned tickets"""
        response = requests.post(f"{BASE_URL}/api/intelligent-routing/bulk-route", headers=headers)
        assert response.status_code == 200, f"Bulk route failed: {response.text}"
        
        data = response.json()
        assert "routed" in data, "Missing routed count"
        assert "failed" in data, "Missing failed count"
        assert "results" in data, "Missing results array"
        print(f"Bulk route: {data['routed']} routed, {data['failed']} failed")


# ==================== REVENUE TRACKING TESTS ====================

class TestRevenueTracking(TestAuth):
    """Tests for Revenue-per-Ticket Tracking"""
    
    def test_revenue_dashboard(self, headers):
        """GET /revenue-tracking/dashboard returns comprehensive revenue data"""
        response = requests.get(f"{BASE_URL}/api/revenue-tracking/dashboard", headers=headers)
        assert response.status_code == 200, f"Revenue dashboard failed: {response.text}"
        
        data = response.json()
        # Verify top-level structure
        assert "summary" in data, "Missing summary"
        assert "tickets" in data, "Missing tickets"
        assert "by_client" in data, "Missing by_client"
        assert "by_tech" in data, "Missing by_tech"
        
        # Verify summary fields
        summary = data["summary"]
        assert "total_revenue" in summary, "Summary missing total_revenue"
        assert "total_cost" in summary, "Summary missing total_cost"
        assert "total_profit" in summary, "Summary missing total_profit"
        assert "overall_margin" in summary, "Summary missing overall_margin"
        assert "total_tickets" in summary, "Summary missing total_tickets"
        assert "avg_revenue_per_ticket" in summary, "Summary missing avg_revenue_per_ticket"
        
        print(f"Revenue Summary: ${summary['total_revenue']} revenue, ${summary['total_profit']} profit, {summary['overall_margin']}% margin")
    
    def test_revenue_ticket_details(self, headers):
        """Revenue data includes per-ticket profitability"""
        response = requests.get(f"{BASE_URL}/api/revenue-tracking/dashboard", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        if data["tickets"]:
            ticket = data["tickets"][0]
            assert "id" in ticket, "Ticket missing id"
            assert "total_revenue" in ticket, "Ticket missing total_revenue"
            assert "total_cost" in ticket, "Ticket missing total_cost"
            assert "profit" in ticket, "Ticket missing profit"
            assert "margin_pct" in ticket, "Ticket missing margin_pct"
            print(f"Sample ticket: ${ticket['total_revenue']} revenue, ${ticket['profit']} profit")
    
    def test_revenue_by_client(self, headers):
        """Revenue data includes per-client profitability"""
        response = requests.get(f"{BASE_URL}/api/revenue-tracking/dashboard", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        if data["by_client"]:
            client = data["by_client"][0]
            assert "client_name" in client, "Client missing name"
            assert "tickets" in client, "Client missing ticket count"
            assert "revenue" in client, "Client missing revenue"
            assert "profit" in client, "Client missing profit"
            assert "margin_pct" in client, "Client missing margin_pct"
            print(f"Top client: {client['client_name']} - ${client['revenue']} revenue")
    
    def test_revenue_by_tech(self, headers):
        """Revenue data includes per-technician profitability"""
        response = requests.get(f"{BASE_URL}/api/revenue-tracking/dashboard", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        if data["by_tech"]:
            tech = data["by_tech"][0]
            assert "tech_name" in tech, "Tech missing name"
            assert "tickets" in tech, "Tech missing ticket count"
            assert "revenue" in tech, "Tech missing revenue"
            assert "profit" in tech, "Tech missing profit"
            assert "revenue_per_hour" in tech, "Tech missing revenue_per_hour"
            print(f"Top tech: {tech['tech_name']} - ${tech['revenue_per_hour']}/hr")


# ==================== VOICE TICKET TESTS ====================

class TestVoiceTicket(TestAuth):
    """Tests for Voice-to-Ticket functionality"""
    
    def test_voice_transcribe_action(self, headers):
        """POST /voice-ticket/transcribe with action=transcribe extracts priority/category"""
        response = requests.post(f"{BASE_URL}/api/voice-ticket/transcribe", json={
            "transcript": "The network is down, this is urgent. VPN is not working for the accounting team.",
            "action": "transcribe"
        }, headers=headers)
        assert response.status_code == 200, f"Transcribe failed: {response.text}"
        
        data = response.json()
        assert "action" in data, "Missing action"
        assert data["action"] == "transcribed", "Action should be transcribed"
        assert "extracted" in data, "Missing extracted data"
        assert "priority" in data["extracted"], "Missing extracted priority"
        assert "category" in data["extracted"], "Missing extracted category"
        print(f"Extracted: priority={data['extracted']['priority']}, category={data['extracted']['category']}")
    
    def test_voice_urgent_detection(self, headers):
        """Voice transcription detects 'urgent' as critical priority"""
        response = requests.post(f"{BASE_URL}/api/voice-ticket/transcribe", json={
            "transcript": "This is urgent, the server is down!",
            "action": "transcribe"
        }, headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert data["extracted"]["priority"] == "critical", f"Expected critical, got {data['extracted']['priority']}"
        print(f"Urgent detected as: {data['extracted']['priority']}")
    
    def test_voice_network_category_detection(self, headers):
        """Voice transcription detects 'network' as networking category"""
        response = requests.post(f"{BASE_URL}/api/voice-ticket/transcribe", json={
            "transcript": "The network connection is slow",
            "action": "transcribe"
        }, headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert data["extracted"]["category"] == "networking", f"Expected networking, got {data['extracted']['category']}"
        print(f"Network detected as: {data['extracted']['category']}")
    
    def test_voice_create_ticket(self, headers):
        """POST /voice-ticket/transcribe with action=create creates a ticket"""
        response = requests.post(f"{BASE_URL}/api/voice-ticket/transcribe", json={
            "transcript": "TEST_VOICE: Critical security alert. Possible malware detected on workstation WS-042.",
            "action": "create"
        }, headers=headers)
        assert response.status_code == 200, f"Create ticket failed: {response.text}"
        
        data = response.json()
        assert data["action"] == "ticket_created", "Action should be ticket_created"
        assert "ticket" in data, "Missing ticket data"
        assert "id" in data["ticket"], "Ticket missing id"
        assert "title" in data["ticket"], "Ticket missing title"
        assert data["ticket"]["source"] == "voice", "Ticket source should be voice"
        assert "extracted" in data, "Missing extracted data"
        
        # Store for cleanup
        TestVoiceTicket.test_ticket_id = data["ticket"]["id"]
        print(f"Created voice ticket: {data['ticket']['id']}")
    
    def test_voice_no_transcript_error(self, headers):
        """Voice transcription returns error for empty transcript"""
        response = requests.post(f"{BASE_URL}/api/voice-ticket/transcribe", json={
            "transcript": "",
            "action": "transcribe"
        }, headers=headers)
        assert response.status_code == 400, "Should return 400 for empty transcript"
    
    def test_voice_history(self, headers):
        """GET /voice-ticket/history returns voice notes"""
        response = requests.get(f"{BASE_URL}/api/voice-ticket/history", headers=headers)
        assert response.status_code == 200, f"Voice history failed: {response.text}"
        # Returns a list (may be empty)
        assert isinstance(response.json(), list), "Should return a list"


# ==================== CLIENT PORTAL TESTS ====================

class TestClientPortal(TestAuth):
    """Tests for Client Self-Service Portal"""
    
    @pytest.fixture(scope="class")
    def test_client_id(self):
        """Use existing client ID"""
        return "client-001"
    
    def test_get_portal_config(self, headers, test_client_id):
        """GET /client-portal/config/{client_id} returns portal config"""
        response = requests.get(f"{BASE_URL}/api/client-portal/config/{test_client_id}", headers=headers)
        assert response.status_code == 200, f"Get config failed: {response.text}"
        
        data = response.json()
        assert "client_id" in data, "Missing client_id"
        assert "branding" in data, "Missing branding"
        assert "features" in data, "Missing features"
        
        # Verify features structure
        features = data["features"]
        assert "can_create_tickets" in features, "Missing can_create_tickets feature"
        assert "can_view_devices" in features, "Missing can_view_devices feature"
        print(f"Portal config for {test_client_id}: enabled={data.get('enabled')}")
    
    def test_update_portal_config(self, headers, test_client_id):
        """PUT /client-portal/config/{client_id} updates portal settings"""
        config_update = {
            "enabled": True,
            "branding": {
                "primary_color": "#3b82f6",
                "company_name": "Test Company Portal"
            },
            "features": {
                "can_create_tickets": True,
                "can_view_devices": True,
                "can_view_invoices": False,
                "can_view_contracts": True,
                "can_view_kb": True
            }
        }
        response = requests.put(f"{BASE_URL}/api/client-portal/config/{test_client_id}", json=config_update, headers=headers)
        assert response.status_code == 200, f"Update config failed: {response.text}"
        
        # Verify update
        verify = requests.get(f"{BASE_URL}/api/client-portal/config/{test_client_id}", headers=headers)
        assert verify.status_code == 200
        print("Portal config updated successfully")
    
    def test_generate_portal_token(self, headers, test_client_id):
        """POST /client-portal/generate-token/{client_id} creates access token"""
        token_data = {
            "contact_name": "TEST_John Smith",
            "contact_email": "test_john@test.com",
            "expiry_days": 30
        }
        response = requests.post(f"{BASE_URL}/api/client-portal/generate-token/{test_client_id}", json=token_data, headers=headers)
        assert response.status_code == 200, f"Generate token failed: {response.text}"
        
        data = response.json()
        assert "token" in data, "Missing token"
        assert "portal_url" in data, "Missing portal_url"
        assert "entry" in data, "Missing entry"
        assert len(data["token"]) > 20, "Token too short"
        
        # Store token for public endpoint tests
        TestClientPortal.test_portal_token = data["token"]
        TestClientPortal.test_token_id = data["entry"]["id"]
        print(f"Generated portal token: {data['portal_url']}")
    
    def test_public_portal_tickets(self):
        """GET /portal-api/{token}/tickets returns tickets (no auth required)"""
        if not hasattr(TestClientPortal, 'test_portal_token'):
            pytest.skip("No portal token available")
        
        # NO auth header - public endpoint
        response = requests.get(f"{BASE_URL}/api/portal-api/{TestClientPortal.test_portal_token}/tickets")
        assert response.status_code == 200, f"Public portal tickets failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Should return a list of tickets"
        if data:
            ticket = data[0]
            assert "id" in ticket, "Ticket missing id"
            assert "title" in ticket, "Ticket missing title"
            assert "status" in ticket, "Ticket missing status"
        print(f"Public portal returned {len(data)} tickets")
    
    def test_public_portal_info(self):
        """GET /portal-api/{token}/info returns portal info (no auth required)"""
        if not hasattr(TestClientPortal, 'test_portal_token'):
            pytest.skip("No portal token available")
        
        response = requests.get(f"{BASE_URL}/api/portal-api/{TestClientPortal.test_portal_token}/info")
        assert response.status_code == 200, f"Public portal info failed: {response.text}"
        
        data = response.json()
        assert "client" in data, "Missing client info"
        assert "branding" in data, "Missing branding"
        assert "features" in data, "Missing features"
        print(f"Portal info retrieved for contact: {data.get('contact_name')}")
    
    def test_public_portal_invalid_token(self):
        """GET /portal-api/{invalid_token}/tickets returns 404"""
        response = requests.get(f"{BASE_URL}/api/portal-api/invalid-token-999/tickets")
        assert response.status_code == 404, "Should return 404 for invalid token"
    
    def test_revoke_portal_token(self, headers, test_client_id):
        """DELETE /client-portal/tokens/{client_id}/{token_id} revokes token"""
        if not hasattr(TestClientPortal, 'test_token_id'):
            pytest.skip("No test token to revoke")
        
        response = requests.delete(f"{BASE_URL}/api/client-portal/tokens/{test_client_id}/{TestClientPortal.test_token_id}", headers=headers)
        assert response.status_code == 200, f"Revoke token failed: {response.text}"
        print(f"Token {TestClientPortal.test_token_id} revoked")
    
    def test_get_all_portal_configs(self, headers):
        """GET /client-portal/all returns all portal configs"""
        response = requests.get(f"{BASE_URL}/api/client-portal/all", headers=headers)
        assert response.status_code == 200, f"Get all configs failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Should return a list"
        print(f"Found {len(data)} portal configs")


# ==================== CLEANUP ====================

class TestCleanup(TestAuth):
    """Cleanup test data"""
    
    def test_cleanup_voice_ticket(self, headers):
        """Delete test voice ticket if created"""
        if hasattr(TestVoiceTicket, 'test_ticket_id'):
            response = requests.delete(f"{BASE_URL}/api/tickets/{TestVoiceTicket.test_ticket_id}", headers=headers)
            print(f"Cleanup: Deleted voice ticket {TestVoiceTicket.test_ticket_id} - Status: {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
