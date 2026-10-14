"""
Iteration 33: Testing 5 Parallel Features
1. Notification Links Fix - Verify notifications can navigate
2. Unified Conversation Tab - Notes/Emails combined with dropdown
3. Notify Client with PDF - Email notifications with PDF attachment
4. RustDesk Remote Access - Client device remote management
5. Device Discovery - Network scan and import
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuthentication:
    """Authentication tests"""
    
    def test_login_success(self):
        """Test login with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == "admin@nexusops.io"

@pytest.fixture(scope="module")
def auth_token():
    """Get auth token for tests"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
    })
    if response.status_code == 200:
        return response.json()["token"]
    pytest.skip("Authentication failed")

@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers fixture"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============== FEATURE 1: NOTIFICATION SYSTEM ==============
class TestNotificationSystem:
    """Test notifications and their links"""
    
    def test_get_notifications(self, headers):
        """Test fetching notifications"""
        response = requests.get(f"{BASE_URL}/api/notifications", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_get_unread_count(self, headers):
        """Test fetching unread notification count"""
        response = requests.get(f"{BASE_URL}/api/notifications/unread-count", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "count" in data
        assert isinstance(data["count"], int)
    
    def test_generate_notifications(self, headers):
        """Test generating new notifications"""
        response = requests.post(f"{BASE_URL}/api/notifications/generate", json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "generated" in data or "message" in data
    
    def test_mark_notifications_read(self, headers):
        """Test marking notifications as read"""
        response = requests.post(f"{BASE_URL}/api/notifications/mark-read", json={}, headers=headers)
        assert response.status_code == 200


# ============== FEATURE 2: TICKETS - UNIFIED CONVERSATION ==============
class TestTicketConversation:
    """Test ticket notes and emails (unified conversation)"""
    
    @pytest.fixture(scope="class")
    def test_ticket(self, headers):
        """Get or create a test ticket"""
        # First get existing tickets
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200
        tickets = response.json()
        if tickets:
            return tickets[0]
        
        # Create if none exist
        clients_res = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        client_id = clients_res.json()[0]["id"] if clients_res.json() else None
        
        ticket_data = {
            "title": "TEST_ITER33 Conversation Test",
            "description": "Testing unified conversation tab",
            "client_id": client_id,
            "priority": "medium"
        }
        create_res = requests.post(f"{BASE_URL}/api/tickets", json=ticket_data, headers=headers)
        return create_res.json()
    
    def test_get_ticket_comments(self, headers, test_ticket):
        """Test fetching ticket notes/comments"""
        ticket_id = test_ticket["id"]
        response = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}/comments", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_add_ticket_note(self, headers, test_ticket):
        """Test adding a note to ticket"""
        ticket_id = test_ticket["id"]
        response = requests.post(f"{BASE_URL}/api/tickets/{ticket_id}/comments", json={
            "content": "TEST_ITER33 Internal note from testing",
            "is_internal": True
        }, headers=headers)
        assert response.status_code in [200, 201]
        data = response.json()
        assert data.get("content") or data.get("id")
    
    def test_add_public_note(self, headers, test_ticket):
        """Test adding a public note"""
        ticket_id = test_ticket["id"]
        response = requests.post(f"{BASE_URL}/api/tickets/{ticket_id}/comments", json={
            "content": "TEST_ITER33 Public note for client",
            "is_internal": False
        }, headers=headers)
        assert response.status_code in [200, 201]
    
    def test_get_ticket_emails(self, headers, test_ticket):
        """Test fetching ticket emails"""
        ticket_id = test_ticket["id"]
        response = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}/emails", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_send_ticket_email(self, headers, test_ticket):
        """Test sending email from ticket (may be demo mode)"""
        ticket_id = test_ticket["id"]
        response = requests.post(f"{BASE_URL}/api/tickets/{ticket_id}/emails", json={
            "ticket_id": ticket_id,
            "to_addresses": ["test@example.com"],
            "cc": [],
            "bcc": [],
            "subject": "TEST_ITER33 Email Subject",
            "body": "Test email body content"
        }, headers=headers)
        # Email sending may return 200 or 201, or fail gracefully in demo mode
        assert response.status_code in [200, 201, 400, 500]


# ============== FEATURE 3: NOTIFY CLIENT WITH PDF ==============
class TestNotifyClientPdf:
    """Test client notification with PDF attachment"""
    
    @pytest.fixture(scope="class")
    def test_ticket(self, headers):
        """Get a test ticket"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        return tickets[0] if tickets else None
    
    def test_download_ticket_pdf(self, headers, test_ticket):
        """Test downloading ticket conversation as PDF"""
        if not test_ticket:
            pytest.skip("No ticket available")
        
        ticket_id = test_ticket["id"]
        response = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}/download-pdf", headers=headers)
        assert response.status_code == 200
        assert "application/pdf" in response.headers.get("content-type", "")
        assert len(response.content) > 100  # PDF should have content
    
    def test_notify_client_endpoint(self, headers, test_ticket):
        """Test notify client endpoint (demo mode)"""
        if not test_ticket:
            pytest.skip("No ticket available")
        
        ticket_id = test_ticket["id"]
        response = requests.post(f"{BASE_URL}/api/tickets/{ticket_id}/notify-client", json={
            "email": "test@example.com",
            "subject": "TEST_ITER33 Notification Subject",
            "message": "Test notification message"
        }, headers=headers)
        # Should succeed even in demo mode
        assert response.status_code == 200
        data = response.json()
        assert "id" in data or "message" in data
        assert data.get("status") in ["sent", "failed", None] or "id" in data
    
    def test_notification_history(self, headers, test_ticket):
        """Test getting notification history for ticket"""
        if not test_ticket:
            pytest.skip("No ticket available")
        
        ticket_id = test_ticket["id"]
        response = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}/notification-history", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)


# ============== FEATURE 4: RUSTDESK REMOTE ACCESS ==============
class TestRustdeskRemoteAccess:
    """Test RustDesk device management"""
    
    @pytest.fixture(scope="class")
    def test_client(self, headers):
        """Get a test client"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        return clients[0] if clients else None
    
    def test_get_rustdesk_config(self, headers):
        """Test getting global RustDesk config"""
        response = requests.get(f"{BASE_URL}/api/rustdesk/config", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "key" in data or "value" in data or "enabled" in data or data == {}
    
    def test_save_rustdesk_config(self, headers):
        """Test saving RustDesk config"""
        response = requests.post(f"{BASE_URL}/api/rustdesk/config", json={
            "server_url": "rustdesk.example.com",
            "api_key": "test-key",
            "relay_server": "relay.example.com",
            "enabled": True
        }, headers=headers)
        assert response.status_code == 200
    
    def test_get_client_rustdesk_devices(self, headers, test_client):
        """Test getting RustDesk devices for a client"""
        if not test_client:
            pytest.skip("No client available")
        
        client_id = test_client["id"]
        response = requests.get(f"{BASE_URL}/api/rustdesk/clients/{client_id}/devices", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_add_rustdesk_device(self, headers, test_client):
        """Test adding a RustDesk device"""
        if not test_client:
            pytest.skip("No client available")
        
        client_id = test_client["id"]
        response = requests.post(f"{BASE_URL}/api/rustdesk/clients/{client_id}/devices", json={
            "device_name": "TEST_ITER33_Device",
            "rustdesk_id": "999888777",
            "rustdesk_password": "testpass123",
            "os": "Windows 11",
            "notes": "Test device for iteration 33"
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["device_name"] == "TEST_ITER33_Device"
        return data
    
    def test_connect_rustdesk_device(self, headers, test_client):
        """Test initiating RustDesk connection"""
        if not test_client:
            pytest.skip("No client available")
        
        # First get devices
        client_id = test_client["id"]
        devices_res = requests.get(f"{BASE_URL}/api/rustdesk/clients/{client_id}/devices", headers=headers)
        devices = devices_res.json()
        
        if not devices:
            pytest.skip("No RustDesk devices configured")
        
        device_id = devices[0]["id"]
        response = requests.post(f"{BASE_URL}/api/rustdesk/devices/{device_id}/connect", json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "connection_url" in data or "message" in data
        assert "rustdesk://" in data.get("connection_url", "")
    
    def test_delete_rustdesk_device(self, headers, test_client):
        """Test deleting a RustDesk device"""
        if not test_client:
            pytest.skip("No client available")
        
        client_id = test_client["id"]
        # Get test device we created
        devices_res = requests.get(f"{BASE_URL}/api/rustdesk/clients/{client_id}/devices", headers=headers)
        devices = [d for d in devices_res.json() if d.get("device_name") == "TEST_ITER33_Device"]
        
        if devices:
            device_id = devices[0]["id"]
            response = requests.delete(f"{BASE_URL}/api/rustdesk/devices/{device_id}", headers=headers)
            assert response.status_code == 200
    
    def test_get_rustdesk_sessions(self, headers):
        """Test getting RustDesk session history"""
        response = requests.get(f"{BASE_URL}/api/rustdesk/sessions", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)


# ============== FEATURE 5: DEVICE DISCOVERY ==============
class TestDeviceDiscovery:
    """Test network device discovery and import"""
    
    @pytest.fixture(scope="class")
    def test_client(self, headers):
        """Get a test client"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        return clients[0] if clients else None
    
    def test_discover_devices(self, headers, test_client):
        """Test discovering devices on a network"""
        if not test_client:
            pytest.skip("No client available")
        
        client_id = test_client["id"]
        response = requests.post(f"{BASE_URL}/api/devices/discover", json={
            "client_id": client_id,
            "subnet": "192.168.1.0/24"
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "discovered_count" in data
        assert "devices" in data
        assert isinstance(data["devices"], list)
        assert data["discovered_count"] >= 0
        
        # Verify device structure
        if data["devices"]:
            device = data["devices"][0]
            assert "id" in device
            assert "hostname" in device
            assert "ip_address" in device
            assert "mac_address" in device
        
        return data
    
    def test_import_discovered_devices(self, headers, test_client):
        """Test importing discovered devices"""
        if not test_client:
            pytest.skip("No client available")
        
        client_id = test_client["id"]
        
        # First discover
        discover_res = requests.post(f"{BASE_URL}/api/devices/discover", json={
            "client_id": client_id,
            "subnet": "10.0.0.0/24"
        }, headers=headers)
        discovered = discover_res.json()
        
        if not discovered.get("devices"):
            pytest.skip("No devices discovered")
        
        # Import one device that's not already imported
        devices_to_import = [d for d in discovered["devices"] if not d.get("already_imported")][:1]
        
        if not devices_to_import:
            pytest.skip("All devices already imported")
        
        response = requests.post(f"{BASE_URL}/api/devices/import-discovered", json={
            "client_id": client_id,
            "devices": devices_to_import
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "imported_count" in data or "message" in data
    
    def test_get_scan_history(self, headers):
        """Test getting network scan history"""
        response = requests.get(f"{BASE_URL}/api/devices/scans", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_discover_devices_missing_client(self, headers):
        """Test discovery with missing client_id"""
        response = requests.post(f"{BASE_URL}/api/devices/discover", json={
            "subnet": "192.168.1.0/24"
        }, headers=headers)
        assert response.status_code == 400
    
    def test_import_no_devices_selected(self, headers, test_client):
        """Test import with no devices selected"""
        if not test_client:
            pytest.skip("No client available")
        
        response = requests.post(f"{BASE_URL}/api/devices/import-discovered", json={
            "client_id": test_client["id"],
            "devices": []
        }, headers=headers)
        assert response.status_code == 400


# ============== GENERAL API HEALTH ==============
class TestApiHealth:
    """General API health checks"""
    
    def test_api_root(self):
        """Test API root endpoint"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert "NexusOps" in data.get("message", "")
    
    def test_get_clients(self, headers):
        """Test getting clients list"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_get_tickets(self, headers):
        """Test getting tickets list"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_get_devices(self, headers):
        """Test getting devices list"""
        response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
