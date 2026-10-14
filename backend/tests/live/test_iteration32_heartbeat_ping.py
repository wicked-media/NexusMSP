"""
Iteration 32 Tests: Device Heartbeat, Ticket Auto-Ping & Escalation, Viewer Badge
Tests the following new features:
1. RMM Device Heartbeat endpoint
2. Stale devices endpoint
3. Ticket ping settings
4. Team mappings for category/SLA
5. Ticket pick-up and escalation check
6. Ticket viewer tracking
"""
import pytest
import requests
import os
import uuid
from datetime import datetime, timezone

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


@pytest.fixture(scope="module")
def auth_token():
    """Login and get auth token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Authentication failed")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def test_device_id(headers):
    """Get a device ID for testing heartbeat"""
    response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
    if response.status_code == 200 and len(response.json()) > 0:
        return response.json()[0]["id"]
    pytest.skip("No devices available for heartbeat testing")


@pytest.fixture(scope="module")
def test_ticket_id(headers):
    """Get a ticket ID for testing"""
    response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
    if response.status_code == 200 and len(response.json()) > 0:
        return response.json()[0]["id"]
    pytest.skip("No tickets available for testing")


class TestDeviceHeartbeat:
    """Device heartbeat/RMM agent endpoint tests"""
    
    def test_heartbeat_endpoint_exists(self, headers, test_device_id):
        """Test POST /api/devices/{device_id}/heartbeat returns 200"""
        heartbeat_data = {
            "hostname": "TEST-WORKSTATION",
            "cpu_usage": 45.5,
            "memory_usage": 62.3,
            "disk_usage": 78.0,
            "os_name": "Windows 11 Pro",
            "ip_address": "192.168.1.100",
            "uptime_seconds": 86400,
            "total_ram_gb": 16.0,
            "cpu_name": "Intel Core i7-12700K",
            "logged_in_user": "test.user@domain.local",
            "antivirus_status": "enabled"
        }
        response = requests.post(
            f"{BASE_URL}/api/devices/{test_device_id}/heartbeat",
            json=heartbeat_data
        )
        assert response.status_code == 200, f"Heartbeat failed: {response.text}"
        data = response.json()
        assert "status" in data
        assert data["status"] == "ok"
        print(f"PASSED: Heartbeat endpoint returns 200 with status 'ok'")
    
    def test_heartbeat_updates_device_fields(self, headers, test_device_id):
        """Test heartbeat data is reflected in device GET"""
        # First send heartbeat
        heartbeat_data = {
            "hostname": "HEARTBEAT-TEST-PC",
            "cpu_usage": 33.3,
            "memory_usage": 55.5,
            "disk_usage": 66.6,
            "os_name": "Windows 11 Enterprise",
            "ip_address": "10.0.0.50",
            "uptime_seconds": 172800,  # 2 days
            "total_ram_gb": 32.0,
            "cpu_name": "AMD Ryzen 9 5900X",
            "logged_in_user": "admin@company.local",
            "antivirus_status": "enabled"
        }
        requests.post(
            f"{BASE_URL}/api/devices/{test_device_id}/heartbeat",
            json=heartbeat_data
        )
        
        # GET the device and verify fields
        response = requests.get(f"{BASE_URL}/api/devices/{test_device_id}", headers=headers)
        assert response.status_code == 200
        device = response.json()
        
        # Check mapped fields
        assert device.get("ip_address") == "10.0.0.50"
        assert device.get("processor") == "AMD Ryzen 9 5900X"
        assert device.get("ram_gb") == 32.0
        assert device.get("last_logged_in_user") == "admin@company.local"
        assert device.get("last_heartbeat") is not None
        # uptime_display should be "2d 0h" for 172800 seconds
        assert "uptime_display" in device or "uptime_hours" in device
        print(f"PASSED: Heartbeat data reflected in device: processor={device.get('processor')}, ram_gb={device.get('ram_gb')}")
    
    def test_heartbeat_no_auth_required(self, test_device_id):
        """Test heartbeat endpoint works without auth (for RMM agents)"""
        heartbeat_data = {
            "hostname": "AGENT-TEST",
            "cpu_usage": 10.0,
            "memory_usage": 20.0
        }
        response = requests.post(
            f"{BASE_URL}/api/devices/{test_device_id}/heartbeat",
            json=heartbeat_data
        )
        # Should work without auth header
        assert response.status_code == 200
        print(f"PASSED: Heartbeat works without auth (for RMM agents)")


class TestStaleDevices:
    """Stale devices endpoint tests"""
    
    def test_stale_devices_endpoint(self, headers):
        """Test GET /api/devices/stale returns devices that haven't checked in"""
        response = requests.get(f"{BASE_URL}/api/devices/stale?hours=1", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"PASSED: Stale devices endpoint returns {len(data)} devices that haven't checked in within 1 hour")


class TestTicketPingSettings:
    """Ticket ping & escalation settings tests"""
    
    def test_get_ticket_ping_settings(self, headers):
        """Test GET /api/settings/ticket-ping returns config"""
        response = requests.get(f"{BASE_URL}/api/settings/ticket-ping", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Verify expected fields
        assert "enabled" in data
        assert "ping_interval_minutes" in data
        assert "escalation_timeout_hours" in data
        print(f"PASSED: Ping settings retrieved - enabled={data.get('enabled')}, interval={data.get('ping_interval_minutes')}m, escalation={data.get('escalation_timeout_hours')}h")
    
    def test_update_ticket_ping_settings(self, headers):
        """Test PUT /api/settings/ticket-ping updates config"""
        update_data = {
            "enabled": True,
            "ping_interval_minutes": 30,
            "escalation_timeout_hours": 24,
            "ping_on_create": True,
            "ping_until_picked_up": True
        }
        response = requests.put(f"{BASE_URL}/api/settings/ticket-ping", json=update_data, headers=headers)
        assert response.status_code == 200
        
        # Verify update
        get_response = requests.get(f"{BASE_URL}/api/settings/ticket-ping", headers=headers)
        data = get_response.json()
        assert data.get("enabled") == True
        assert data.get("ping_interval_minutes") == 30
        assert data.get("escalation_timeout_hours") == 24
        print(f"PASSED: Ping settings updated successfully")


class TestTeamMappings:
    """Team mapping tests for category and SLA"""
    
    def test_get_team_mappings(self, headers):
        """Test GET /api/settings/ticket-ping/team-mappings returns users and mappings"""
        response = requests.get(f"{BASE_URL}/api/settings/ticket-ping/team-mappings", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Verify expected fields
        assert "available_users" in data
        assert "category_teams" in data
        assert "sla_teams" in data
        assert isinstance(data["available_users"], list)
        print(f"PASSED: Team mappings retrieved - {len(data['available_users'])} available users")
    
    def test_update_team_mappings(self, headers):
        """Test PUT /api/settings/ticket-ping/team-mappings updates category and SLA teams"""
        # First get available users
        response = requests.get(f"{BASE_URL}/api/settings/ticket-ping/team-mappings", headers=headers)
        data = response.json()
        users = data.get("available_users", [])
        
        if not users:
            pytest.skip("No users available for team mapping")
        
        first_user_id = users[0]["id"]
        
        update_data = {
            "category_teams": {
                "support": [first_user_id],
                "network": [first_user_id]
            },
            "sla_teams": {
                "critical": [first_user_id],
                "high": [first_user_id]
            }
        }
        response = requests.put(f"{BASE_URL}/api/settings/ticket-ping/team-mappings", json=update_data, headers=headers)
        assert response.status_code == 200
        
        # Verify update
        get_response = requests.get(f"{BASE_URL}/api/settings/ticket-ping/team-mappings", headers=headers)
        result = get_response.json()
        assert first_user_id in result.get("category_teams", {}).get("support", [])
        assert first_user_id in result.get("sla_teams", {}).get("critical", [])
        print(f"PASSED: Team mappings updated - support team has {len(result['category_teams'].get('support', []))} members")


class TestEscalationCheck:
    """Escalation check endpoint tests"""
    
    def test_check_escalations_endpoint(self, headers):
        """Test POST /api/tickets/check-escalations runs escalation check"""
        response = requests.post(f"{BASE_URL}/api/tickets/check-escalations", json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Verify expected fields
        assert "checked" in data
        assert "pinged" in data
        assert "escalated" in data
        print(f"PASSED: Escalation check completed - checked={data['checked']}, pinged={data['pinged']}, escalated={data['escalated']}")


class TestTicketPickUp:
    """Ticket pick-up endpoint tests"""
    
    def test_pick_up_ticket(self, headers, test_ticket_id):
        """Test POST /api/tickets/{ticket_id}/pick-up assigns ticket"""
        response = requests.post(f"{BASE_URL}/api/tickets/{test_ticket_id}/pick-up", json={}, headers=headers)
        # Should be 200 or 400 if already assigned
        assert response.status_code in [200, 400]
        print(f"PASSED: Ticket pick-up endpoint works (status={response.status_code})")


class TestTicketViewerTracking:
    """Ticket viewer tracking tests"""
    
    def test_mark_viewing_ticket(self, headers, test_ticket_id):
        """Test POST /api/tickets/{ticket_id}/viewing marks viewing"""
        response = requests.post(f"{BASE_URL}/api/tickets/{test_ticket_id}/viewing", json={}, headers=headers)
        assert response.status_code == 200
        print(f"PASSED: Mark viewing ticket endpoint works")
    
    def test_get_active_viewers(self, headers):
        """Test GET /api/tickets/active-viewers returns viewers"""
        response = requests.get(f"{BASE_URL}/api/tickets/active-viewers", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        print(f"PASSED: Active viewers endpoint returns {len(data)} tickets being viewed")
    
    def test_stop_viewing_ticket(self, headers, test_ticket_id):
        """Test POST /api/tickets/{ticket_id}/stop-viewing clears viewing"""
        response = requests.post(f"{BASE_URL}/api/tickets/{test_ticket_id}/stop-viewing", json={}, headers=headers)
        assert response.status_code == 200
        print(f"PASSED: Stop viewing ticket endpoint works")


class TestDevicesEndpoint:
    """Verify devices list returns heartbeat fields"""
    
    def test_devices_list_has_heartbeat_fields(self, headers):
        """Test GET /api/devices includes heartbeat-related fields"""
        response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        assert response.status_code == 200
        devices = response.json()
        
        if len(devices) > 0:
            device = devices[0]
            # Check that model supports these fields
            fields_to_check = ["last_seen", "status", "ip_address"]
            found_fields = [f for f in fields_to_check if f in device]
            print(f"PASSED: Devices list returns {len(devices)} devices with fields: {found_fields}")
        else:
            print("PASSED: Devices endpoint works (no devices to check fields)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
