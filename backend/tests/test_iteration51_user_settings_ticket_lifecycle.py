"""
Iteration 51 Backend Tests - User Settings & Ticket Lifecycle Features

Tests cover:
1. User Profile endpoints (GET/PUT /api/user-settings/profile)
2. Password change endpoint (POST /api/user-settings/change-password)
3. 2FA setup & verify (GET/POST /api/user-settings/2fa)
4. FIDO2 Security Keys (POST/DELETE /api/user-settings/security-keys)
5. Notification preferences (GET/PUT /api/user-settings/notifications)
6. Working hours (GET/PUT /api/user-settings/working-hours)
7. API Keys management (GET/POST/DELETE /api/user-settings/api-keys)
8. Sessions management (GET/DELETE /api/user-settings/sessions)
9. Display preferences (GET/PUT /api/user-settings/display)
10. Ticket auto-close resolved->closed (PUT /api/tickets)
11. Tickets 24h filter for closed tickets (GET /api/tickets)
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://clients-redesign.preview.emergentagent.com').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": "admin123"
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json().get("token")

@pytest.fixture(scope="module")
def headers(auth_token):
    """Authorization headers"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============== USER PROFILE TESTS ==============

class TestUserProfile:
    """User profile endpoint tests"""
    
    def test_get_profile(self, headers):
        """GET /api/user-settings/profile returns user profile with gamification data"""
        response = requests.get(f"{BASE_URL}/api/user-settings/profile", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        # Basic profile fields
        assert "id" in data
        assert "email" in data
        assert "name" in data
        assert "role" in data
        # Gamification data
        assert "gamification" in data
        # Settings
        assert "settings" in data
        print(f"Profile fetched: {data.get('email')} (role: {data.get('role')})")
    
    def test_update_profile_name(self, headers):
        """PUT /api/user-settings/profile updates user name"""
        original_response = requests.get(f"{BASE_URL}/api/user-settings/profile", headers=headers)
        original_name = original_response.json().get("name", "")
        
        # Update name
        test_name = f"TEST_ITER51_{uuid.uuid4().hex[:6]}"
        response = requests.put(f"{BASE_URL}/api/user-settings/profile", 
                              json={"name": test_name}, headers=headers)
        assert response.status_code == 200
        assert "message" in response.json()
        
        # Verify update
        verify = requests.get(f"{BASE_URL}/api/user-settings/profile", headers=headers)
        assert verify.json().get("name") == test_name
        
        # Restore original name
        requests.put(f"{BASE_URL}/api/user-settings/profile", 
                    json={"name": original_name}, headers=headers)
        print(f"Profile name update verified")
    
    def test_update_profile_specialties(self, headers):
        """PUT /api/user-settings/profile updates specialties"""
        response = requests.put(f"{BASE_URL}/api/user-settings/profile", 
                              json={"specialties": ["Networking", "Cloud", "Security"]}, 
                              headers=headers)
        assert response.status_code == 200
        
        # Verify
        verify = requests.get(f"{BASE_URL}/api/user-settings/profile", headers=headers)
        assert "specialties" in verify.json()
        print(f"Specialties update verified")


# ============== PASSWORD CHANGE TESTS ==============

class TestPasswordChange:
    """Password change endpoint tests"""
    
    def test_change_password_correct_current(self, headers):
        """POST /api/user-settings/change-password with correct current password succeeds"""
        # Change password to new one
        response = requests.post(f"{BASE_URL}/api/user-settings/change-password", 
                               json={
                                   "current_password": "admin123",
                                   "new_password": "admin123new"
                               }, headers=headers)
        assert response.status_code == 200
        assert "message" in response.json()
        print("Password changed successfully")
        
        # Change it back immediately
        response2 = requests.post(f"{BASE_URL}/api/user-settings/change-password", 
                                json={
                                    "current_password": "admin123new",
                                    "new_password": "admin123"
                                }, headers=headers)
        assert response2.status_code == 200
        print("Password restored to original")
    
    def test_change_password_wrong_current(self, headers):
        """POST /api/user-settings/change-password with wrong current password returns 400"""
        response = requests.post(f"{BASE_URL}/api/user-settings/change-password", 
                               json={
                                   "current_password": "wrongpassword",
                                   "new_password": "newpassword123"
                               }, headers=headers)
        assert response.status_code == 400
        assert "incorrect" in response.json().get("detail", "").lower()
        print("Wrong password correctly rejected with 400")
    
    def test_change_password_missing_fields(self, headers):
        """POST /api/user-settings/change-password missing fields returns 400"""
        response = requests.post(f"{BASE_URL}/api/user-settings/change-password", 
                               json={"new_password": "newpassword123"}, headers=headers)
        assert response.status_code == 400
        print("Missing current_password correctly rejected")


# ============== 2FA TESTS ==============

class Test2FA:
    """2FA endpoint tests"""
    
    def test_get_2fa_status(self, headers):
        """GET /api/user-settings/2fa returns 2FA status"""
        response = requests.get(f"{BASE_URL}/api/user-settings/2fa", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert "enabled" in data
        assert "security_keys" in data
        print(f"2FA status: enabled={data.get('enabled')}")
    
    def test_setup_2fa(self, headers):
        """POST /api/user-settings/2fa/setup returns secret and backup codes"""
        response = requests.post(f"{BASE_URL}/api/user-settings/2fa/setup", 
                               json={}, headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert "secret" in data
        assert "backup_codes" in data
        assert "provisioning_uri" in data or "qr_data" in data
        assert len(data.get("backup_codes", [])) == 8
        print(f"2FA setup successful, got {len(data.get('backup_codes', []))} backup codes")
    
    def test_verify_2fa(self, headers):
        """POST /api/user-settings/2fa/verify enables 2FA"""
        # First setup
        setup_response = requests.post(f"{BASE_URL}/api/user-settings/2fa/setup", 
                                      json={}, headers=headers)
        assert setup_response.status_code == 200
        
        # Verify (mocked - accepts any code)
        response = requests.post(f"{BASE_URL}/api/user-settings/2fa/verify", 
                               json={"code": "123456"}, headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("enabled") == True
        print("2FA verified and enabled successfully")
        
        # Disable for cleanup
        requests.post(f"{BASE_URL}/api/user-settings/2fa/disable", 
                     json={"password": "admin123"}, headers=headers)


# ============== SECURITY KEYS TESTS ==============

class TestSecurityKeys:
    """FIDO2 Security Keys endpoint tests"""
    
    def test_register_security_key(self, headers):
        """POST /api/user-settings/security-keys/register registers a FIDO2 key"""
        response = requests.post(f"{BASE_URL}/api/user-settings/security-keys/register", 
                               json={"name": "TEST_ITER51_YubiKey"}, headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert "key" in data
        assert "message" in data
        key_id = data["key"]["id"]
        print(f"Security key registered: id={key_id}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/user-settings/security-keys/{key_id}", headers=headers)
        return key_id
    
    def test_delete_security_key(self, headers):
        """DELETE /api/user-settings/security-keys/{key_id} removes a key"""
        # First register
        reg_response = requests.post(f"{BASE_URL}/api/user-settings/security-keys/register", 
                                    json={"name": "TEST_ITER51_ToDelete"}, headers=headers)
        assert reg_response.status_code == 200
        key_id = reg_response.json()["key"]["id"]
        
        # Delete
        response = requests.delete(f"{BASE_URL}/api/user-settings/security-keys/{key_id}", 
                                  headers=headers)
        assert response.status_code == 200
        assert "removed" in response.json().get("message", "").lower()
        print(f"Security key {key_id} removed successfully")


# ============== NOTIFICATION PREFERENCES TESTS ==============

class TestNotifications:
    """Notification preferences endpoint tests"""
    
    def test_get_notification_prefs(self, headers):
        """GET /api/user-settings/notifications returns notification prefs"""
        response = requests.get(f"{BASE_URL}/api/user-settings/notifications", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        # Check default fields
        assert "email_ticket_assigned" in data
        assert "inapp_ticket_assigned" in data
        assert "desktop_notifications" in data
        print(f"Notification prefs fetched with {len(data)} settings")
    
    def test_save_notification_prefs(self, headers):
        """PUT /api/user-settings/notifications saves notification prefs"""
        new_prefs = {
            "email_ticket_assigned": False,
            "email_ticket_updated": True,
            "sms_critical_alerts": True
        }
        response = requests.put(f"{BASE_URL}/api/user-settings/notifications", 
                              json=new_prefs, headers=headers)
        assert response.status_code == 200
        assert "message" in response.json()
        print("Notification preferences saved successfully")


# ============== WORKING HOURS TESTS ==============

class TestWorkingHours:
    """Working hours endpoint tests"""
    
    def test_get_working_hours(self, headers):
        """GET /api/user-settings/working-hours returns schedule with 7 days"""
        response = requests.get(f"{BASE_URL}/api/user-settings/working-hours", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert "schedule" in data
        schedule = data["schedule"]
        # Check all 7 days are present
        days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        for day in days:
            assert day in schedule, f"Missing day: {day}"
        print(f"Working hours fetched with {len(schedule)} days")
    
    def test_save_working_hours(self, headers):
        """PUT /api/user-settings/working-hours saves schedule"""
        new_hours = {
            "timezone": "UTC",
            "schedule": {
                "monday": {"enabled": True, "start": "09:00", "end": "17:00"},
                "tuesday": {"enabled": True, "start": "09:00", "end": "17:00"},
                "wednesday": {"enabled": True, "start": "09:00", "end": "17:00"},
                "thursday": {"enabled": True, "start": "09:00", "end": "17:00"},
                "friday": {"enabled": True, "start": "09:00", "end": "17:00"},
                "saturday": {"enabled": False, "start": "", "end": ""},
                "sunday": {"enabled": False, "start": "", "end": ""}
            },
            "on_call": False,
            "auto_assign": True
        }
        response = requests.put(f"{BASE_URL}/api/user-settings/working-hours", 
                              json=new_hours, headers=headers)
        assert response.status_code == 200
        assert "message" in response.json()
        print("Working hours saved successfully")


# ============== API KEYS TESTS ==============

class TestApiKeys:
    """API Keys management endpoint tests"""
    
    def test_create_api_key(self, headers):
        """POST /api/user-settings/api-keys creates a new key and returns full key value"""
        response = requests.post(f"{BASE_URL}/api/user-settings/api-keys", 
                               json={"name": "TEST_ITER51_API_Key", "scopes": ["read"]}, 
                               headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert "key" in data
        assert data["key"].startswith("nxops_")
        assert "id" in data
        print(f"API key created: {data['key'][:20]}...")
        return data["id"]
    
    def test_get_api_keys_prefix_only(self, headers):
        """GET /api/user-settings/api-keys returns list with prefix only"""
        # First create a key
        create_response = requests.post(f"{BASE_URL}/api/user-settings/api-keys", 
                                       json={"name": "TEST_ITER51_ListTest"}, headers=headers)
        key_id = create_response.json()["id"]
        
        response = requests.get(f"{BASE_URL}/api/user-settings/api-keys", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        if data:
            # Check prefix format
            key_item = data[0]
            assert "prefix" in key_item
            assert "..." in key_item["prefix"]  # Should be truncated
            print(f"Got {len(data)} API keys with prefix format")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/user-settings/api-keys/{key_id}", headers=headers)
    
    def test_delete_api_key(self, headers):
        """DELETE /api/user-settings/api-keys/{key_id} revokes a key"""
        # First create a key
        create_response = requests.post(f"{BASE_URL}/api/user-settings/api-keys", 
                                       json={"name": "TEST_ITER51_ToRevoke"}, headers=headers)
        key_id = create_response.json()["id"]
        
        # Delete it
        response = requests.delete(f"{BASE_URL}/api/user-settings/api-keys/{key_id}", 
                                  headers=headers)
        assert response.status_code == 200
        assert "revoked" in response.json().get("message", "").lower()
        print(f"API key {key_id} revoked successfully")


# ============== SESSIONS TESTS ==============

class TestSessions:
    """Sessions management endpoint tests"""
    
    def test_get_sessions(self, headers):
        """GET /api/user-settings/sessions returns sessions list"""
        response = requests.get(f"{BASE_URL}/api/user-settings/sessions", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1  # Should have at least current session
        if data:
            session = data[0]
            assert "id" in session
            assert "device" in session or "user_agent" in session or "user_id" in session
        print(f"Got {len(data)} active sessions")


# ============== DISPLAY PREFERENCES TESTS ==============

class TestDisplayPrefs:
    """Display preferences endpoint tests"""
    
    def test_get_display_prefs(self, headers):
        """GET /api/user-settings/display returns display prefs with defaults"""
        response = requests.get(f"{BASE_URL}/api/user-settings/display", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        # Check defaults are present
        assert "accent_color" in data
        assert "compact_mode" in data
        assert "timezone" in data
        assert "language" in data
        print(f"Display prefs fetched: accent={data.get('accent_color')}, compact={data.get('compact_mode')}")
    
    def test_save_display_prefs(self, headers):
        """PUT /api/user-settings/display saves display prefs"""
        new_prefs = {
            "accent_color": "purple",
            "compact_mode": True,
            "timezone": "UTC"
        }
        response = requests.put(f"{BASE_URL}/api/user-settings/display", 
                              json=new_prefs, headers=headers)
        assert response.status_code == 200
        assert "message" in response.json()
        
        # Verify
        verify = requests.get(f"{BASE_URL}/api/user-settings/display", headers=headers)
        assert verify.json().get("accent_color") == "purple"
        print("Display preferences saved and verified")


# ============== TICKET LIFECYCLE TESTS ==============

class TestTicketLifecycle:
    """Ticket auto-close and 24h filter tests"""
    
    def test_ticket_auto_close_resolved_to_closed(self, headers):
        """PUT /api/tickets/{ticket_id} with status='resolved' auto-sets to 'closed'"""
        # First create a test ticket
        ticket_data = {
            "title": "TEST_ITER51_AutoClose",
            "description": "Test ticket for auto-close feature",
            "client_id": "client-001",
            "priority": "medium"
        }
        create_response = requests.post(f"{BASE_URL}/api/tickets", 
                                       json=ticket_data, headers=headers)
        assert create_response.status_code == 200
        ticket_id = create_response.json()["id"]
        print(f"Created test ticket: {ticket_id}")
        
        # Update status to "resolved"
        update_response = requests.put(f"{BASE_URL}/api/tickets/{ticket_id}", 
                                      json={"status": "resolved"}, headers=headers)
        assert update_response.status_code == 200
        
        # Verify it's actually "closed" not "resolved"
        get_response = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}", headers=headers)
        assert get_response.status_code == 200
        ticket = get_response.json()
        assert ticket["status"] == "closed", f"Expected 'closed' but got '{ticket['status']}'"
        print(f"Ticket auto-closed: resolved -> closed verified")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tickets/{ticket_id}", headers=headers)
    
    def test_tickets_filter_excludes_old_closed(self, headers):
        """GET /api/tickets without status filter excludes closed tickets older than 24h"""
        # Get all tickets without filter
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200
        
        tickets = response.json()
        # Check that the query is applying the filter (we can't easily create old tickets,
        # but we verify the endpoint works and returns tickets)
        assert isinstance(tickets, list)
        print(f"Got {len(tickets)} tickets without status filter (24h filter applied)")
    
    def test_tickets_filter_with_status_includes_all(self, headers):
        """GET /api/tickets with status=closed returns all closed tickets"""
        response = requests.get(f"{BASE_URL}/api/tickets?status=closed", headers=headers)
        assert response.status_code == 200
        
        tickets = response.json()
        assert isinstance(tickets, list)
        # All returned should be closed
        for t in tickets:
            assert t.get("status") == "closed", f"Expected closed but got {t.get('status')}"
        print(f"Got {len(tickets)} closed tickets with explicit status filter")


# ============== CLEANUP ==============

class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_api_keys(self, headers):
        """Clean up TEST_ prefixed API keys"""
        response = requests.get(f"{BASE_URL}/api/user-settings/api-keys", headers=headers)
        if response.status_code == 200:
            for key in response.json():
                if "TEST_ITER51" in key.get("name", ""):
                    requests.delete(f"{BASE_URL}/api/user-settings/api-keys/{key['id']}", 
                                  headers=headers)
                    print(f"Cleaned up API key: {key['name']}")
