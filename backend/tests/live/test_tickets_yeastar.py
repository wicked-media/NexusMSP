"""
Test Suite for Ticket System & Yeastar PBX Features
- Ticket list API
- Ticket comments/notes API
- Ticket emails API
- User update (email signature)
- Yeastar PBX dashboard, extensions, active calls, call logs, system info, settings
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')

# Test credentials
TEST_EMAIL = "admin@nexusops.io"
TEST_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for all tests"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.fail(f"Authentication failed: {response.text}")


@pytest.fixture(scope="module")
def api_client(auth_token):
    """Shared requests session with auth header"""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_token}"
    })
    return session


@pytest.fixture(scope="module")
def user_info(auth_token):
    """Get current user info"""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_token}"
    })
    response = session.get(f"{BASE_URL}/api/auth/me")
    if response.status_code == 200:
        return response.json()
    pytest.fail(f"Failed to get user info: {response.text}")


# ============== TICKETS API TESTS ==============

class TestTicketsAPI:
    """Ticket list and CRUD tests"""
    
    def test_get_tickets_list(self, api_client):
        """GET /api/tickets returns ticket list"""
        response = api_client.get(f"{BASE_URL}/api/tickets")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        
        # Should have seeded tickets
        if len(data) > 0:
            ticket = data[0]
            # Check ticket structure
            assert "id" in ticket
            assert "title" in ticket
            assert "status" in ticket
            assert "priority" in ticket
            print(f"Found {len(data)} tickets")
    
    def test_get_single_ticket(self, api_client):
        """GET /api/tickets/<id> returns ticket details"""
        # First get list to get a ticket id
        list_response = api_client.get(f"{BASE_URL}/api/tickets")
        assert list_response.status_code == 200
        
        tickets = list_response.json()
        if len(tickets) == 0:
            pytest.skip("No tickets to test with")
        
        ticket_id = tickets[0]["id"]
        response = api_client.get(f"{BASE_URL}/api/tickets/{ticket_id}")
        assert response.status_code == 200
        
        ticket = response.json()
        assert ticket["id"] == ticket_id
        print(f"Got ticket: {ticket.get('title')} ({ticket.get('ticket_number')})")


# ============== TICKET COMMENTS/NOTES TESTS ==============

class TestTicketComments:
    """Ticket comments/notes API tests"""
    
    def test_get_ticket_comments(self, api_client):
        """GET /api/tickets/<id>/comments returns comments"""
        # Get a ticket id
        list_response = api_client.get(f"{BASE_URL}/api/tickets")
        tickets = list_response.json()
        if len(tickets) == 0:
            pytest.skip("No tickets to test with")
        
        ticket_id = tickets[0]["id"]
        response = api_client.get(f"{BASE_URL}/api/tickets/{ticket_id}/comments")
        assert response.status_code == 200
        
        comments = response.json()
        assert isinstance(comments, list)
        print(f"Ticket {ticket_id} has {len(comments)} comments")
    
    def test_create_ticket_comment(self, api_client):
        """POST /api/tickets/<id>/comments creates a comment"""
        # Get a ticket id
        list_response = api_client.get(f"{BASE_URL}/api/tickets")
        tickets = list_response.json()
        if len(tickets) == 0:
            pytest.skip("No tickets to test with")
        
        ticket_id = tickets[0]["id"]
        
        # Create comment
        comment_data = {
            "content": "TEST_Comment from automated testing",
            "is_internal": False
        }
        response = api_client.post(f"{BASE_URL}/api/tickets/{ticket_id}/comments", json=comment_data)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        created = response.json()
        assert "id" in created
        assert created["content"] == comment_data["content"]
        assert created["is_internal"] == comment_data["is_internal"]
        assert "user_name" in created
        assert "created_at" in created
        print(f"Created comment: {created['id']}")
    
    def test_create_internal_note(self, api_client):
        """POST /api/tickets/<id>/comments with is_internal=True"""
        list_response = api_client.get(f"{BASE_URL}/api/tickets")
        tickets = list_response.json()
        if len(tickets) == 0:
            pytest.skip("No tickets to test with")
        
        ticket_id = tickets[0]["id"]
        
        comment_data = {
            "content": "TEST_Internal note - not visible to client",
            "is_internal": True
        }
        response = api_client.post(f"{BASE_URL}/api/tickets/{ticket_id}/comments", json=comment_data)
        assert response.status_code == 200
        
        created = response.json()
        assert created["is_internal"] == True
        print(f"Created internal note: {created['id']}")
    
    def test_comments_for_nonexistent_ticket(self, api_client):
        """GET /api/tickets/<invalid_id>/comments returns 404"""
        response = api_client.get(f"{BASE_URL}/api/tickets/nonexistent-ticket-id/comments")
        assert response.status_code == 404


# ============== TICKET EMAILS TESTS ==============

class TestTicketEmails:
    """Ticket email API tests"""
    
    def test_get_ticket_emails(self, api_client):
        """GET /api/tickets/<id>/emails returns emails"""
        list_response = api_client.get(f"{BASE_URL}/api/tickets")
        tickets = list_response.json()
        if len(tickets) == 0:
            pytest.skip("No tickets to test with")
        
        ticket_id = tickets[0]["id"]
        response = api_client.get(f"{BASE_URL}/api/tickets/{ticket_id}/emails")
        assert response.status_code == 200
        
        emails = response.json()
        assert isinstance(emails, list)
        print(f"Ticket {ticket_id} has {len(emails)} emails")
    
    def test_send_ticket_email(self, api_client):
        """POST /api/tickets/<id>/emails sends an email (mocked)"""
        list_response = api_client.get(f"{BASE_URL}/api/tickets")
        tickets = list_response.json()
        if len(tickets) == 0:
            pytest.skip("No tickets to test with")
        
        ticket_id = tickets[0]["id"]
        ticket = tickets[0]
        
        email_data = {
            "to_addresses": ["test@example.com"],
            "subject": f"TEST_Re: [{ticket.get('ticket_number', '')}] {ticket.get('title', '')}",
            "body": "This is a test email from automated testing."
        }
        response = api_client.post(f"{BASE_URL}/api/tickets/{ticket_id}/emails", json=email_data)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        sent = response.json()
        assert "id" in sent
        assert sent["to_addresses"] == email_data["to_addresses"]
        assert "body" in sent
        assert sent["direction"] == "outbound"
        print(f"Email 'sent': {sent['id']}")
    
    def test_emails_for_nonexistent_ticket(self, api_client):
        """GET /api/tickets/<invalid_id>/emails returns 404"""
        response = api_client.get(f"{BASE_URL}/api/tickets/nonexistent-ticket/emails")
        assert response.status_code == 404


# ============== USER UPDATE (EMAIL SIGNATURE) TESTS ==============

class TestUserUpdate:
    """User update API tests (email signature)"""
    
    def test_update_email_signature(self, api_client, user_info):
        """PUT /api/users/<id> updates email signature"""
        user_id = user_info["id"]
        
        update_data = {
            "email_signature": "TEST_Best regards,\nAdmin User\nNexusOps"
        }
        response = api_client.put(f"{BASE_URL}/api/users/{user_id}", json=update_data)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        result = response.json()
        assert result.get("message") == "User updated"
        print(f"Updated email signature for user {user_id}")
    
    def test_update_user_nonexistent(self, api_client):
        """PUT /api/users/<invalid_id> returns 404"""
        response = api_client.put(f"{BASE_URL}/api/users/nonexistent-user", json={"name": "Test"})
        assert response.status_code == 404
    
    def test_update_user_invalid_fields(self, api_client, user_info):
        """PUT /api/users/<id> with invalid fields returns 400"""
        user_id = user_info["id"]
        response = api_client.put(f"{BASE_URL}/api/users/{user_id}", json={"invalid_field": "value"})
        assert response.status_code == 400


# ============== YEASTAR PBX TESTS ==============

class TestYeastarPBX:
    """Yeastar PBX integration tests (mocked data)"""
    
    def test_yeastar_status(self, api_client):
        """GET /api/yeastar/status returns configuration status"""
        response = api_client.get(f"{BASE_URL}/api/yeastar/status")
        assert response.status_code == 200
        
        data = response.json()
        assert "configured" in data
        print(f"Yeastar configured: {data['configured']}")
    
    def test_yeastar_dashboard(self, api_client):
        """GET /api/yeastar/dashboard returns dashboard stats"""
        response = api_client.get(f"{BASE_URL}/api/yeastar/dashboard")
        assert response.status_code == 200
        
        data = response.json()
        assert "total_extensions" in data
        assert "online_extensions" in data
        assert "active_calls" in data
        assert "calls_today" in data
        assert "missed_calls_today" in data
        print(f"Dashboard: {data['online_extensions']}/{data['total_extensions']} extensions online, {data['active_calls']} active calls")
    
    def test_yeastar_extensions(self, api_client):
        """GET /api/yeastar/extensions returns extensions list"""
        response = api_client.get(f"{BASE_URL}/api/yeastar/extensions")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        
        ext = data[0]
        assert "number" in ext
        assert "name" in ext
        assert "status" in ext
        assert "device" in ext
        assert "registered" in ext
        print(f"Found {len(data)} extensions")
    
    def test_yeastar_active_calls(self, api_client):
        """GET /api/yeastar/active-calls returns active calls"""
        response = api_client.get(f"{BASE_URL}/api/yeastar/active-calls")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        if len(data) > 0:
            call = data[0]
            assert "call_id" in call
            assert "caller" in call
            assert "callee" in call
            assert "direction" in call
            assert "status" in call
            assert "duration" in call
        print(f"Found {len(data)} active calls")
    
    def test_yeastar_call_logs(self, api_client):
        """GET /api/yeastar/call-logs returns call history"""
        response = api_client.get(f"{BASE_URL}/api/yeastar/call-logs")
        assert response.status_code == 200
        
        data = response.json()
        assert "data" in data
        assert "total" in data
        
        logs = data["data"]
        assert isinstance(logs, list)
        
        if len(logs) > 0:
            log = logs[0]
            assert "caller" in log
            assert "callee" in log
            assert "direction" in log
            assert "duration" in log
            assert "status" in log
        print(f"Found {len(logs)} call log entries")
    
    def test_yeastar_system_info(self, api_client):
        """GET /api/yeastar/system-info returns PBX info"""
        response = api_client.get(f"{BASE_URL}/api/yeastar/system-info")
        assert response.status_code == 200
        
        data = response.json()
        assert "hostname" in data
        assert "firmware_version" in data
        assert "total_extensions" in data
        assert "total_trunks" in data
        assert "max_concurrent_calls" in data
        assert "uptime" in data
        print(f"PBX: {data['hostname']} v{data['firmware_version']}")
    
    def test_yeastar_settings_get(self, api_client):
        """GET /api/yeastar/settings returns settings (without secret)"""
        response = api_client.get(f"{BASE_URL}/api/yeastar/settings")
        assert response.status_code == 200
        
        data = response.json()
        assert "type" in data
        # Client secret should not be returned
        assert "client_secret" not in data or data.get("client_secret") is None
    
    def test_yeastar_settings_save(self, api_client):
        """POST /api/yeastar/settings saves settings"""
        settings_data = {
            "pbx_url": "https://test-pbx.example.com",
            "client_id": "test-client-id",
            "client_secret": "test-client-secret"
        }
        response = api_client.post(f"{BASE_URL}/api/yeastar/settings", json=settings_data)
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("message") == "Yeastar settings saved"
        print("Yeastar settings saved successfully")
    
    def test_yeastar_test_connection(self, api_client):
        """GET /api/yeastar/test-connection tests PBX connection"""
        response = api_client.get(f"{BASE_URL}/api/yeastar/test-connection")
        assert response.status_code == 200
        
        data = response.json()
        assert "success" in data
        assert "message" in data
        print(f"Connection test: {data['message']}")


# ============== NEW TICKET CREATION TEST ==============

class TestTicketCreation:
    """Test creating new tickets"""
    
    def test_create_new_ticket(self, api_client):
        """POST /api/tickets creates a new ticket"""
        # First get clients to get a valid client_id
        clients_response = api_client.get(f"{BASE_URL}/api/clients")
        if clients_response.status_code != 200:
            pytest.skip("Could not get clients list")
        
        clients = clients_response.json()
        if len(clients) == 0:
            pytest.skip("No clients available")
        
        client_id = clients[0]["id"]
        
        ticket_data = {
            "title": "TEST_New ticket from automated testing",
            "description": "This is a test ticket created by the automated test suite",
            "client_id": client_id,
            "priority": "medium",
            "category": "support"
        }
        
        response = api_client.post(f"{BASE_URL}/api/tickets", json=ticket_data)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        ticket = response.json()
        assert "id" in ticket
        assert ticket["title"] == ticket_data["title"]
        assert ticket["priority"] == ticket_data["priority"]
        assert "ticket_number" in ticket
        print(f"Created ticket: {ticket['ticket_number']}")
        
        # Verify by GET
        get_response = api_client.get(f"{BASE_URL}/api/tickets/{ticket['id']}")
        assert get_response.status_code == 200
        fetched = get_response.json()
        assert fetched["title"] == ticket_data["title"]
    
    def test_update_ticket_status(self, api_client):
        """PUT /api/tickets/<id> updates ticket status"""
        # Get a ticket
        list_response = api_client.get(f"{BASE_URL}/api/tickets")
        tickets = list_response.json()
        if len(tickets) == 0:
            pytest.skip("No tickets to test with")
        
        # Find a test ticket or use first
        ticket_id = tickets[0]["id"]
        
        update_data = {"status": "in_progress"}
        response = api_client.put(f"{BASE_URL}/api/tickets/{ticket_id}", json=update_data)
        assert response.status_code == 200
        
        # Verify update
        get_response = api_client.get(f"{BASE_URL}/api/tickets/{ticket_id}")
        fetched = get_response.json()
        assert fetched["status"] == "in_progress"
        print(f"Updated ticket {ticket_id} status to in_progress")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
