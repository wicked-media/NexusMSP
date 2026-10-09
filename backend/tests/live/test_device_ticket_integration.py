"""
Device-Ticket Integration Tests for Iteration 13
Tests bidirectional device-ticket linking:
- Device detail API returns linked tickets
- Ticket creation with device_id resolves device_name
- Ticket update with device_id change resolves device_name
- Device column in tickets list
- Device selector in ticket creation/detail
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Module-level token storage
auth_token = None


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session with auth token"""
    global auth_token
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    
    # Login to get token
    response = session.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    auth_token = response.json().get("token")
    session.headers.update({"Authorization": f"Bearer {auth_token}"})
    return session


class TestDeviceDetailWithTickets:
    """Test that device detail API returns linked tickets"""
    
    def test_device_detail_includes_tickets(self, api_client):
        """dev-001 (ACME-DC-01) should have 3 linked tickets"""
        response = api_client.get(f"{BASE_URL}/api/devices/dev-001/detail")
        assert response.status_code == 200
        data = response.json()
        
        # Check that tickets array exists in response
        assert "tickets" in data, "Device detail should include 'tickets' array"
        tickets = data["tickets"]
        
        # According to review request, dev-001 should have 3 linked tickets
        assert isinstance(tickets, list), "tickets should be a list"
        assert len(tickets) == 3, f"Expected 3 tickets for dev-001, got {len(tickets)}"
        
        # Verify ticket structure
        for t in tickets:
            assert "id" in t, "Ticket should have id"
            assert "title" in t, "Ticket should have title"
            assert "status" in t, "Ticket should have status"
            assert "priority" in t, "Ticket should have priority"
    
    def test_device_003_has_tickets(self, api_client):
        """dev-003 (TECH-SRV-01) should have 2 linked tickets"""
        response = api_client.get(f"{BASE_URL}/api/devices/dev-003/detail")
        assert response.status_code == 200
        data = response.json()
        
        assert "tickets" in data
        assert len(data["tickets"]) == 2, f"Expected 2 tickets for dev-003, got {len(data['tickets'])}"
    
    def test_device_005_has_tickets(self, api_client):
        """dev-005 (HC-WS-REC01) should have 2 linked tickets"""
        response = api_client.get(f"{BASE_URL}/api/devices/dev-005/detail")
        assert response.status_code == 200
        data = response.json()
        
        assert "tickets" in data
        assert len(data["tickets"]) == 2, f"Expected 2 tickets for dev-005, got {len(data['tickets'])}"


class TestTicketsWithDeviceInfo:
    """Test that tickets list includes device information"""
    
    def test_tickets_list_has_device_columns(self, api_client):
        """GET /api/tickets should return device_id and device_name for linked tickets"""
        response = api_client.get(f"{BASE_URL}/api/tickets")
        assert response.status_code == 200
        tickets = response.json()
        
        assert len(tickets) > 0, "Should have tickets"
        
        # Count tickets with device_id
        tickets_with_device = [t for t in tickets if t.get("device_id")]
        assert len(tickets_with_device) >= 15, f"Expected at least 15 tickets with device_id, got {len(tickets_with_device)}"
        
        # Check device_name is resolved for tickets with device_id
        for t in tickets_with_device:
            assert t.get("device_name"), f"Ticket {t.get('ticket_number')} has device_id but no device_name"
    
    def test_specific_ticket_has_correct_device(self, api_client):
        """Find a ticket linked to dev-001 and verify device_name is ACME-DC-01"""
        response = api_client.get(f"{BASE_URL}/api/tickets")
        assert response.status_code == 200
        tickets = response.json()
        
        # Find tickets linked to dev-001
        dev001_tickets = [t for t in tickets if t.get("device_id") == "dev-001"]
        assert len(dev001_tickets) >= 1, "Should have at least 1 ticket linked to dev-001"
        
        for t in dev001_tickets:
            assert t.get("device_name") == "ACME-DC-01", f"Expected device_name 'ACME-DC-01' for dev-001, got {t.get('device_name')}"


class TestTicketCreationWithDevice:
    """Test ticket creation with device_id"""
    
    def test_create_ticket_with_device_resolves_name(self, api_client):
        """Creating a ticket with device_id should resolve device_name"""
        # Get a client ID first
        clients_resp = api_client.get(f"{BASE_URL}/api/clients")
        assert clients_resp.status_code == 200
        clients = clients_resp.json()
        assert len(clients) > 0
        client_id = clients[0]["id"]
        
        # Create ticket with device_id
        ticket_data = {
            "title": "TEST_Device_Integration_Ticket",
            "description": "Test ticket for device-ticket integration",
            "client_id": client_id,
            "priority": "medium",
            "device_id": "dev-001"  # Link to ACME-DC-01
        }
        
        response = api_client.post(f"{BASE_URL}/api/tickets", json=ticket_data)
        assert response.status_code == 200, f"Failed to create ticket: {response.text}"
        
        ticket = response.json()
        assert ticket.get("device_id") == "dev-001", "device_id should be set"
        assert ticket.get("device_name") == "ACME-DC-01", f"device_name should be resolved to 'ACME-DC-01', got {ticket.get('device_name')}"
        
        # Cleanup - delete test ticket
        ticket_id = ticket.get("id")
        if ticket_id:
            api_client.delete(f"{BASE_URL}/api/tickets/{ticket_id}")


class TestTicketUpdateWithDevice:
    """Test ticket update with device_id change"""
    
    def test_update_ticket_device_resolves_name(self, api_client):
        """Updating ticket device_id should resolve the new device_name"""
        # Get a client ID first
        clients_resp = api_client.get(f"{BASE_URL}/api/clients")
        assert clients_resp.status_code == 200
        clients = clients_resp.json()
        client_id = clients[0]["id"]
        
        # Create a ticket without device
        ticket_data = {
            "title": "TEST_Update_Device_Ticket",
            "description": "Test ticket for device update",
            "client_id": client_id,
            "priority": "low"
        }
        
        response = api_client.post(f"{BASE_URL}/api/tickets", json=ticket_data)
        assert response.status_code == 200
        ticket = response.json()
        ticket_id = ticket.get("id")
        
        try:
            # Update ticket to add device_id
            update_resp = api_client.put(f"{BASE_URL}/api/tickets/{ticket_id}", json={
                "device_id": "dev-003"  # Link to TECH-SRV-01
            })
            assert update_resp.status_code == 200
            
            # Fetch ticket to verify device_name was resolved
            get_resp = api_client.get(f"{BASE_URL}/api/tickets/{ticket_id}")
            assert get_resp.status_code == 200
            updated_ticket = get_resp.json()
            
            assert updated_ticket.get("device_id") == "dev-003"
            assert updated_ticket.get("device_name") == "TECH-SRV-01", f"Expected device_name 'TECH-SRV-01', got {updated_ticket.get('device_name')}"
        finally:
            # Cleanup
            api_client.delete(f"{BASE_URL}/api/tickets/{ticket_id}")
    
    def test_clear_device_from_ticket(self, api_client):
        """Clearing device_id from ticket should also clear device_name"""
        # Get a client ID
        clients_resp = api_client.get(f"{BASE_URL}/api/clients")
        client_id = clients_resp.json()[0]["id"]
        
        # Create ticket with device
        ticket_data = {
            "title": "TEST_Clear_Device_Ticket",
            "description": "Test clearing device",
            "client_id": client_id,
            "device_id": "dev-005"
        }
        
        response = api_client.post(f"{BASE_URL}/api/tickets", json=ticket_data)
        assert response.status_code == 200
        ticket = response.json()
        ticket_id = ticket.get("id")
        
        try:
            # Verify device_name was set
            assert ticket.get("device_name") is not None
            
            # Clear device
            update_resp = api_client.put(f"{BASE_URL}/api/tickets/{ticket_id}", json={
                "device_id": ""
            })
            assert update_resp.status_code == 200
            
            # Verify device_name is cleared
            get_resp = api_client.get(f"{BASE_URL}/api/tickets/{ticket_id}")
            updated_ticket = get_resp.json()
            
            assert updated_ticket.get("device_id") in [None, ""], "device_id should be cleared"
            assert updated_ticket.get("device_name") in [None, ""], "device_name should also be cleared"
        finally:
            api_client.delete(f"{BASE_URL}/api/tickets/{ticket_id}")


class TestDevicesPage:
    """Test devices page loads correctly"""
    
    def test_devices_list_returns_10_devices(self, api_client):
        """Devices endpoint should return 10 devices"""
        response = api_client.get(f"{BASE_URL}/api/devices")
        assert response.status_code == 200
        devices = response.json()
        assert len(devices) == 10, f"Expected 10 devices, got {len(devices)}"
    
    def test_devices_stats_summary(self, api_client):
        """Devices stats summary should return correct counts"""
        response = api_client.get(f"{BASE_URL}/api/devices/stats/summary")
        assert response.status_code == 200
        stats = response.json()
        assert stats.get("total") == 10, f"Expected total=10, got {stats.get('total')}"


class TestTicketsSeedData:
    """Verify seed data for tickets"""
    
    def test_total_tickets_count(self, api_client):
        """Should have 16 seeded tickets"""
        response = api_client.get(f"{BASE_URL}/api/tickets")
        assert response.status_code == 200
        tickets = response.json()
        assert len(tickets) >= 16, f"Expected at least 16 tickets, got {len(tickets)}"
    
    def test_tickets_with_devices_count(self, api_client):
        """15 of 16 tickets should have device_id"""
        response = api_client.get(f"{BASE_URL}/api/tickets")
        assert response.status_code == 200
        tickets = response.json()
        
        tickets_with_device = [t for t in tickets if t.get("device_id")]
        assert len(tickets_with_device) >= 15, f"Expected at least 15 tickets with device_id, got {len(tickets_with_device)}"
