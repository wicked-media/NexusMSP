"""
Test Command Palette API endpoints - iteration 165
Tests:
- GET /api/command-palette/search - global search for tickets, clients, devices, users
- POST /api/command-palette/run - execute slash commands from palette
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestCommandPaletteAPI:
    """Command Palette endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth token for all tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        token = login_response.json().get("token")
        assert token, "No token returned from login"
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        self.token = token
    
    # ========== Search Endpoint Tests ==========
    
    def test_search_empty_query(self):
        """Search with empty query returns empty results"""
        response = self.session.get(f"{BASE_URL}/api/command-palette/search", params={"q": ""})
        assert response.status_code == 200
        data = response.json()
        assert "tickets" in data
        assert "clients" in data
        assert "devices" in data
        assert "users" in data
        assert data["tickets"] == []
        assert data["clients"] == []
    
    def test_search_tickets_by_number(self):
        """Search for tickets by ticket number (INC-*)"""
        response = self.session.get(f"{BASE_URL}/api/command-palette/search", params={"q": "INC"})
        assert response.status_code == 200
        data = response.json()
        assert "tickets" in data
        # Should return tickets matching INC-*
        if data["tickets"]:
            for ticket in data["tickets"]:
                assert "ticket_number" in ticket
                assert "title" in ticket
                assert "id" in ticket
    
    def test_search_tickets_by_title(self):
        """Search for tickets by title keyword"""
        response = self.session.get(f"{BASE_URL}/api/command-palette/search", params={"q": "tick"})
        assert response.status_code == 200
        data = response.json()
        assert "tickets" in data
        # Verify structure of returned tickets
        if data["tickets"]:
            ticket = data["tickets"][0]
            assert "id" in ticket
            assert "ticket_number" in ticket
            assert "title" in ticket
    
    def test_search_clients_by_name(self):
        """Search for clients by name (Acme)"""
        response = self.session.get(f"{BASE_URL}/api/command-palette/search", params={"q": "acme"})
        assert response.status_code == 200
        data = response.json()
        assert "clients" in data
        # Should find Acme Corporation
        if data["clients"]:
            client = data["clients"][0]
            assert "id" in client
            assert "name" in client
            assert "acme" in client["name"].lower()
    
    def test_search_devices(self):
        """Search for devices"""
        response = self.session.get(f"{BASE_URL}/api/command-palette/search", params={"q": "device"})
        assert response.status_code == 200
        data = response.json()
        assert "devices" in data
        # Verify structure
        if data["devices"]:
            device = data["devices"][0]
            assert "id" in device
    
    def test_search_users(self):
        """Search for users by name"""
        response = self.session.get(f"{BASE_URL}/api/command-palette/search", params={"q": "aaron"})
        assert response.status_code == 200
        data = response.json()
        assert "users" in data
        if data["users"]:
            user = data["users"][0]
            assert "id" in user
            assert "name" in user
            assert "email" in user
    
    def test_search_limit_results(self):
        """Search results are limited (max 8 tickets, 8 clients, 8 devices, 6 users)"""
        # Search with a broad term
        response = self.session.get(f"{BASE_URL}/api/command-palette/search", params={"q": "a"})
        assert response.status_code == 200
        data = response.json()
        assert len(data.get("tickets", [])) <= 8
        assert len(data.get("clients", [])) <= 8
        assert len(data.get("devices", [])) <= 8
        assert len(data.get("users", [])) <= 6
    
    # ========== Run Endpoint Tests ==========
    
    def test_run_help_command(self):
        """Run /help command - should return help text"""
        response = self.session.post(f"{BASE_URL}/api/command-palette/run", json={
            "raw": "/help"
        })
        assert response.status_code == 200
        data = response.json()
        assert "channel_id" in data
        assert "message" in data
        assert "body" in data["message"]
        # Help should contain slash command info
        assert "slash" in data["message"]["body"].lower() or "command" in data["message"]["body"].lower()
    
    def test_run_sla_command_with_ticket(self):
        """Run /sla command with a ticket number"""
        # First find a ticket
        search_response = self.session.get(f"{BASE_URL}/api/command-palette/search", params={"q": "INC"})
        tickets = search_response.json().get("tickets", [])
        
        if tickets:
            ticket_number = tickets[0].get("ticket_number")
            response = self.session.post(f"{BASE_URL}/api/command-palette/run", json={
                "raw": f"/sla {ticket_number}"
            })
            assert response.status_code == 200
            data = response.json()
            assert "channel_id" in data
            assert "message" in data
            # SLA response should contain SLA info
            body = data["message"].get("body", "")
            assert "SLA" in body or "sla" in body.lower() or "Response" in body or "Resolution" in body
    
    def test_run_invalid_command(self):
        """Run invalid command returns error message"""
        response = self.session.post(f"{BASE_URL}/api/command-palette/run", json={
            "raw": "/invalidcmd"
        })
        assert response.status_code == 200  # Returns 200 with error message in body
        data = response.json()
        assert "message" in data
        # Should indicate unknown command
        body = data["message"].get("body", "")
        assert "unknown" in body.lower() or "help" in body.lower()
    
    def test_run_without_slash_fails(self):
        """Run command without / prefix should fail"""
        response = self.session.post(f"{BASE_URL}/api/command-palette/run", json={
            "raw": "help"
        })
        assert response.status_code == 400
    
    def test_run_close_command(self):
        """Run /close command with a ticket"""
        # First find a ticket
        search_response = self.session.get(f"{BASE_URL}/api/command-palette/search", params={"q": "INC"})
        tickets = search_response.json().get("tickets", [])
        
        if tickets:
            ticket_number = tickets[0].get("ticket_number")
            response = self.session.post(f"{BASE_URL}/api/command-palette/run", json={
                "raw": f"/close {ticket_number}"
            })
            assert response.status_code == 200
            data = response.json()
            assert "channel_id" in data
            assert "message" in data
    
    def test_run_note_command(self):
        """Run /note command to add internal note"""
        # First find a ticket
        search_response = self.session.get(f"{BASE_URL}/api/command-palette/search", params={"q": "INC"})
        tickets = search_response.json().get("tickets", [])
        
        if tickets:
            ticket_number = tickets[0].get("ticket_number")
            response = self.session.post(f"{BASE_URL}/api/command-palette/run", json={
                "raw": f"/note {ticket_number} Test note from command palette"
            })
            assert response.status_code == 200
            data = response.json()
            assert "channel_id" in data
            assert "message" in data
            body = data["message"].get("body", "")
            assert "note" in body.lower() or "Note" in body
    
    # ========== Auth Tests ==========
    
    def test_search_requires_auth(self):
        """Search endpoint requires authentication"""
        unauth_session = requests.Session()
        response = unauth_session.get(f"{BASE_URL}/api/command-palette/search", params={"q": "test"})
        assert response.status_code in [401, 403]
    
    def test_run_requires_auth(self):
        """Run endpoint requires authentication"""
        unauth_session = requests.Session()
        response = unauth_session.post(f"{BASE_URL}/api/command-palette/run", json={"raw": "/help"})
        assert response.status_code in [401, 403]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
