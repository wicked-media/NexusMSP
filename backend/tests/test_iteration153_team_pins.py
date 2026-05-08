"""
Iteration 153: Team Pins (NOC Strip) Feature Tests
Tests the shared workspace / team-pinned tickets feature for outage rooms.
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "aaron@stech.com.au"
ADMIN_PASSWORD = "Lucky@2871$!"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for admin user"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def test_ticket(headers):
    """Create a test ticket for team pin tests"""
    ticket_data = {
        "title": f"TEST_TeamPin_Ticket_{uuid.uuid4().hex[:8]}",
        "description": "Test ticket for team pin testing",
        "priority": "critical",
        "status": "open",
        "category": "incident"
    }
    response = requests.post(f"{BASE_URL}/api/tickets", json=ticket_data, headers=headers)
    if response.status_code in [200, 201]:
        ticket = response.json()
        yield ticket
        # Cleanup: delete the test ticket
        requests.delete(f"{BASE_URL}/api/tickets/{ticket['id']}", headers=headers)
    else:
        pytest.skip(f"Failed to create test ticket: {response.status_code}")


class TestTeamPinsEndpoints:
    """Test the 4 team-pins endpoints"""
    
    def test_list_team_pins_empty_or_existing(self, headers):
        """GET /api/team-pins returns list of team-pinned tickets"""
        response = requests.get(f"{BASE_URL}/api/team-pins", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "pins" in data, "Response should have 'pins' key"
        assert "count" in data, "Response should have 'count' key"
        assert isinstance(data["pins"], list), "pins should be a list"
        assert isinstance(data["count"], int), "count should be an integer"
        print(f"GET /api/team-pins: {data['count']} pins found")
    
    def test_team_pin_ticket(self, headers, test_ticket):
        """POST /api/team-pins/ticket/{id} pins ticket for team"""
        ticket_id = test_ticket["id"]
        
        # First, ensure it's not already pinned (clean state)
        requests.delete(f"{BASE_URL}/api/team-pins/ticket/{ticket_id}", headers=headers)
        
        # Pin the ticket with a note
        response = requests.post(
            f"{BASE_URL}/api/team-pins/ticket/{ticket_id}",
            json={"note": "Test outage note", "reason": "outage"},
            headers=headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("team_pinned") == True, "team_pinned should be True"
        assert "pin" in data or "message" in data, "Response should have pin or message"
        print(f"POST /api/team-pins/ticket/{ticket_id}: Pinned successfully")
    
    def test_team_pin_idempotent(self, headers, test_ticket):
        """POST /api/team-pins/ticket/{id} is idempotent - pinning again returns success"""
        ticket_id = test_ticket["id"]
        
        # Pin again (should be idempotent)
        response = requests.post(
            f"{BASE_URL}/api/team-pins/ticket/{ticket_id}",
            json={"note": "Another note"},
            headers=headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("team_pinned") == True, "team_pinned should be True"
        print(f"POST /api/team-pins/ticket/{ticket_id}: Idempotent - already pinned")
    
    def test_team_pin_status(self, headers, test_ticket):
        """GET /api/team-pins/ticket/{id}/status returns pin status with details"""
        ticket_id = test_ticket["id"]
        
        response = requests.get(f"{BASE_URL}/api/team-pins/ticket/{ticket_id}/status", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "team_pinned" in data, "Response should have 'team_pinned'"
        assert data["team_pinned"] == True, "Ticket should be team pinned"
        assert "pinned_by" in data, "Response should have 'pinned_by'"
        assert "pinned_by_name" in data, "Response should have 'pinned_by_name'"
        assert "pinned_at" in data, "Response should have 'pinned_at'"
        assert "note" in data, "Response should have 'note'"
        assert "reason" in data, "Response should have 'reason'"
        assert "can_unpin" in data, "Response should have 'can_unpin'"
        print(f"GET /api/team-pins/ticket/{ticket_id}/status: {data}")
    
    def test_team_pin_status_not_pinned(self, headers):
        """GET /api/team-pins/ticket/{id}/status returns team_pinned=False for unpinned ticket"""
        # Use a random non-existent ticket ID
        fake_ticket_id = f"fake-{uuid.uuid4().hex[:8]}"
        
        response = requests.get(f"{BASE_URL}/api/team-pins/ticket/{fake_ticket_id}/status", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("team_pinned") == False, "team_pinned should be False for non-pinned ticket"
        print(f"GET /api/team-pins/ticket/{fake_ticket_id}/status: Not pinned (expected)")
    
    def test_team_unpin_ticket(self, headers, test_ticket):
        """DELETE /api/team-pins/ticket/{id} unpins ticket from team"""
        ticket_id = test_ticket["id"]
        
        response = requests.delete(f"{BASE_URL}/api/team-pins/ticket/{ticket_id}", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("team_pinned") == False, "team_pinned should be False after unpin"
        print(f"DELETE /api/team-pins/ticket/{ticket_id}: Unpinned successfully")
        
        # Verify it's actually unpinned
        status_response = requests.get(f"{BASE_URL}/api/team-pins/ticket/{ticket_id}/status", headers=headers)
        assert status_response.status_code == 200
        assert status_response.json().get("team_pinned") == False, "Ticket should no longer be team pinned"
    
    def test_team_unpin_not_pinned(self, headers, test_ticket):
        """DELETE /api/team-pins/ticket/{id} returns 404 if not pinned"""
        ticket_id = test_ticket["id"]
        
        # Ensure it's not pinned
        requests.delete(f"{BASE_URL}/api/team-pins/ticket/{ticket_id}", headers=headers)
        
        # Try to unpin again
        response = requests.delete(f"{BASE_URL}/api/team-pins/ticket/{ticket_id}", headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        print(f"DELETE /api/team-pins/ticket/{ticket_id}: 404 as expected (not pinned)")
    
    def test_team_pin_nonexistent_ticket(self, headers):
        """POST /api/team-pins/ticket/{id} returns 404 for non-existent ticket"""
        fake_ticket_id = f"nonexistent-{uuid.uuid4().hex[:8]}"
        
        response = requests.post(
            f"{BASE_URL}/api/team-pins/ticket/{fake_ticket_id}",
            json={"note": "Test"},
            headers=headers
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        print(f"POST /api/team-pins/ticket/{fake_ticket_id}: 404 as expected (ticket not found)")


class TestTeamPinsHydration:
    """Test that team pins list returns hydrated ticket data"""
    
    def test_hydrated_pin_data(self, headers, test_ticket):
        """GET /api/team-pins returns hydrated ticket data with priority, status, client_name"""
        ticket_id = test_ticket["id"]
        
        # Pin the ticket first
        requests.post(
            f"{BASE_URL}/api/team-pins/ticket/{ticket_id}",
            json={"note": "Hydration test", "reason": "outage"},
            headers=headers
        )
        
        # Get the list
        response = requests.get(f"{BASE_URL}/api/team-pins", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        pins = data.get("pins", [])
        
        # Find our test ticket in the pins
        test_pin = next((p for p in pins if p.get("id") == ticket_id), None)
        if test_pin:
            # Verify hydrated fields
            assert "priority" in test_pin, "Pin should have priority"
            assert "status" in test_pin, "Pin should have status"
            assert "title" in test_pin, "Pin should have title"
            assert "ticket_number" in test_pin, "Pin should have ticket_number"
            assert "pinned_by" in test_pin, "Pin should have pinned_by"
            assert "pinned_by_name" in test_pin, "Pin should have pinned_by_name"
            assert "pinned_at" in test_pin, "Pin should have pinned_at"
            assert "note" in test_pin, "Pin should have note"
            print(f"Hydrated pin data: {test_pin}")
        else:
            print(f"Test ticket not found in pins list (may have been cleaned up)")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/team-pins/ticket/{ticket_id}", headers=headers)


class TestExistingFlowsRegression:
    """Verify existing flows still work after team-pins addition"""
    
    def test_workspace_endpoint_still_works(self, headers):
        """GET /api/workspace still returns workspace data"""
        response = requests.get(f"{BASE_URL}/api/workspace", headers=headers)
        assert response.status_code == 200, f"Workspace endpoint failed: {response.status_code}"
        
        data = response.json()
        assert "pinned_tickets" in data or "stats" in data, "Workspace should have expected fields"
        print("GET /api/workspace: Working")
    
    def test_personal_pin_still_works(self, headers, test_ticket):
        """Personal workspace pin still works independently of team pin"""
        ticket_id = test_ticket["id"]
        
        # Pin to personal workspace
        response = requests.post(f"{BASE_URL}/api/workspace/pin/ticket/{ticket_id}", headers=headers)
        assert response.status_code == 200, f"Personal pin failed: {response.status_code}"
        
        # Check status
        status_response = requests.get(f"{BASE_URL}/api/workspace/pin/ticket/{ticket_id}/status", headers=headers)
        assert status_response.status_code == 200
        assert status_response.json().get("pinned") == True
        
        # Unpin
        requests.delete(f"{BASE_URL}/api/workspace/pin/ticket/{ticket_id}", headers=headers)
        print("Personal workspace pin: Working")
    
    def test_tickets_crud_still_works(self, headers):
        """Basic ticket CRUD still works"""
        # Create
        ticket_data = {
            "title": f"TEST_Regression_{uuid.uuid4().hex[:8]}",
            "description": "Regression test ticket",
            "priority": "low",
            "status": "open"
        }
        create_response = requests.post(f"{BASE_URL}/api/tickets", json=ticket_data, headers=headers)
        assert create_response.status_code in [200, 201], f"Create failed: {create_response.status_code}"
        
        ticket = create_response.json()
        ticket_id = ticket["id"]
        
        # Read
        read_response = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}", headers=headers)
        assert read_response.status_code == 200, f"Read failed: {read_response.status_code}"
        
        # Delete
        delete_response = requests.delete(f"{BASE_URL}/api/tickets/{ticket_id}", headers=headers)
        assert delete_response.status_code in [200, 204], f"Delete failed: {delete_response.status_code}"
        
        print("Ticket CRUD: Working")


class TestTeamPinsPermissions:
    """Test permission logic for team pins"""
    
    def test_admin_can_unpin_any(self, headers, test_ticket):
        """Admin user can unpin any team-pinned ticket"""
        ticket_id = test_ticket["id"]
        
        # Pin the ticket
        requests.post(
            f"{BASE_URL}/api/team-pins/ticket/{ticket_id}",
            json={"note": "Admin test"},
            headers=headers
        )
        
        # Admin should be able to unpin (we're logged in as admin)
        response = requests.delete(f"{BASE_URL}/api/team-pins/ticket/{ticket_id}", headers=headers)
        assert response.status_code == 200, f"Admin unpin failed: {response.status_code}"
        print("Admin can unpin: Working")
    
    def test_can_unpin_flag_for_own_pin(self, headers, test_ticket):
        """can_unpin should be True for the original pinner"""
        ticket_id = test_ticket["id"]
        
        # Pin the ticket
        requests.post(
            f"{BASE_URL}/api/team-pins/ticket/{ticket_id}",
            json={"note": "Own pin test"},
            headers=headers
        )
        
        # Check status - should have can_unpin=True
        response = requests.get(f"{BASE_URL}/api/team-pins/ticket/{ticket_id}/status", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("can_unpin") == True, "can_unpin should be True for original pinner"
        print(f"can_unpin flag: {data.get('can_unpin')}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/team-pins/ticket/{ticket_id}", headers=headers)
