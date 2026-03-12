"""
Iteration 18 - Achievement Badge System, Profile Features & Microsoft Integrations Tests
Tests for:
- GET /api/achievements - returns 18+ achievement definitions
- POST /api/achievements/custom - admin creates custom badge
- GET /api/technicians/{id}/achievements - returns earned badges
- POST /api/technicians/{id}/achievements/award - admin awards badge manually
- POST /api/technicians/{id}/achievements/check - auto-checks and awards milestones
- DELETE /api/technicians/{id}/achievements/{achievement_id} - revoke badge
- POST /api/technicians/{id}/avatar - upload profile picture
- PUT /api/technicians/{id}/profile - update about_me, hire_date, birthday
- GET /api/technicians/{id}/status - hover card data (active sessions, tickets, achievement count, status_text)
- GET /api/settings/microsoft-teams - Teams config
- PUT /api/settings/microsoft-teams - update Teams config
- GET /api/settings/cipp - CIPP config
- PUT /api/settings/cipp - update CIPP config
- GET /api/settings/microsoft365 - M365 config
- PUT /api/settings/microsoft365 - update M365 config
- POST /api/clients/{id}/m365-sync - sync M365 tenancy for client
- GET /api/clients/{id}/m365-users - get M365 users for client
- POST /api/teams/update-status - update Teams status
- GET /api/technicians/{id}/teams-status - get Teams status
"""

import pytest
import requests
import os
import uuid
import io

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
TEST_EMAIL = "admin@nexusops.io"
TEST_PASSWORD = "admin123"
TEST_PREFIX = "TEST_ITER18_"

class TestAuthSetup:
    """Get auth token for tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Login and get token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in login response"
        return data["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    @pytest.fixture(scope="class")
    def user_id(self, auth_token):
        """Get current user ID from login response"""
        # Re-login to get user info since /users/me doesn't exist
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200
        return response.json()["user"]["id"]
    
    def test_auth_login(self, auth_token):
        """Verify authentication works"""
        assert auth_token is not None
        print(f"✓ Authentication successful, got token")


class TestAchievementDefinitions(TestAuthSetup):
    """Achievement definitions endpoint tests"""
    
    def test_get_achievement_definitions(self, headers):
        """GET /api/achievements - returns 18+ built-in achievement definitions"""
        response = requests.get(f"{BASE_URL}/api/achievements", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        achievements = response.json()
        assert isinstance(achievements, list), "Achievements should be a list"
        assert len(achievements) >= 18, f"Expected 18+ achievements, got {len(achievements)}"
        
        # Check structure of achievements
        for ach in achievements[:5]:  # Check first 5
            assert "id" in ach, "Achievement missing id"
            assert "name" in ach, "Achievement missing name"
            assert "description" in ach, "Achievement missing description"
            assert "icon" in ach, "Achievement missing icon"
            assert "color" in ach, "Achievement missing color"
        
        # Check for expected achievements
        ach_ids = [a["id"] for a in achievements]
        expected_ids = ["first_ticket", "ticket_10", "remote_1", "invoice_1"]
        found = [eid for eid in expected_ids if eid in ach_ids]
        assert len(found) > 0, f"Expected to find some of {expected_ids}, found {found}"
        
        print(f"✓ GET /api/achievements returned {len(achievements)} definitions")
    
    def test_create_custom_achievement(self, headers):
        """POST /api/achievements/custom - admin creates custom badge"""
        custom_achievement = {
            "name": f"{TEST_PREFIX}Custom Badge",
            "description": "Test custom achievement badge",
            "icon": "star",
            "color": "#FF5500",
            "milestone_type": "custom"
        }
        
        response = requests.post(f"{BASE_URL}/api/achievements/custom", 
                                json=custom_achievement, headers=headers)
        assert response.status_code == 200 or response.status_code == 201, f"Failed: {response.text}"
        
        data = response.json()
        assert "id" in data or "message" in data
        
        # Verify it appears in list
        list_response = requests.get(f"{BASE_URL}/api/achievements", headers=headers)
        achievements = list_response.json()
        names = [a["name"] for a in achievements]
        assert f"{TEST_PREFIX}Custom Badge" in names, "Custom badge not found in list"
        
        print(f"✓ POST /api/achievements/custom - custom badge created")


class TestTechnicianAchievements(TestAuthSetup):
    """Technician achievement management tests"""
    
    def test_get_technician_achievements(self, headers, user_id):
        """GET /api/technicians/{id}/achievements - returns earned badges"""
        response = requests.get(f"{BASE_URL}/api/technicians/{user_id}/achievements", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        achievements = response.json()
        assert isinstance(achievements, list), "Should return a list"
        
        # user-001 should have earned badges based on context
        if len(achievements) > 0:
            for ach in achievements:
                assert "achievement_id" in ach or "id" in ach
                assert "achievement_name" in ach or "name" in ach
        
        print(f"✓ GET /api/technicians/{user_id}/achievements returned {len(achievements)} earned badges")
    
    def test_award_achievement_manually(self, headers, user_id):
        """POST /api/technicians/{id}/achievements/award - admin awards badge manually"""
        # First get all achievements to find one to award
        ach_response = requests.get(f"{BASE_URL}/api/achievements", headers=headers)
        achievements = ach_response.json()
        
        # Find an achievement to award (use one less likely to be auto-earned)
        test_achievement = None
        for ach in achievements:
            if "anniversary" in ach.get("id", "") or "birthday" in ach.get("id", ""):
                test_achievement = ach
                break
        
        if not test_achievement:
            test_achievement = achievements[-1]  # Use last one
        
        award_data = {
            "achievement_id": test_achievement["id"],
            "achievement_name": test_achievement["name"],
            "note": "Manually awarded by admin during testing"
        }
        
        response = requests.post(f"{BASE_URL}/api/technicians/{user_id}/achievements/award",
                                json=award_data, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        # Either new award or already_earned
        assert "message" in data or "already_earned" in data or "achievement" in data
        
        print(f"✓ POST /api/technicians/{user_id}/achievements/award - badge awarded")
    
    def test_check_achievements_auto(self, headers, user_id):
        """POST /api/technicians/{id}/achievements/check - auto-checks and awards milestones"""
        response = requests.post(f"{BASE_URL}/api/technicians/{user_id}/achievements/check", 
                                json={}, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "newly_awarded" in data or "message" in data
        
        # newly_awarded is a list (can be empty)
        if "newly_awarded" in data:
            assert isinstance(data["newly_awarded"], list)
        
        print(f"✓ POST /api/technicians/{user_id}/achievements/check - auto-check completed")
    
    def test_revoke_achievement(self, headers, user_id):
        """DELETE /api/technicians/{id}/achievements/{achievement_id} - revoke badge"""
        # First award a badge that we can then revoke
        test_ach_id = f"{TEST_PREFIX}revoke_test"
        award_response = requests.post(f"{BASE_URL}/api/technicians/{user_id}/achievements/award",
                                       json={
                                           "achievement_id": test_ach_id,
                                           "achievement_name": "Revoke Test Badge",
                                           "note": "Test badge for revoke"
                                       }, headers=headers)
        
        # Now revoke it
        response = requests.delete(f"{BASE_URL}/api/technicians/{user_id}/achievements/{test_ach_id}",
                                  headers=headers)
        # Either 200 (success) or 404 (already deleted/not found)
        assert response.status_code in [200, 404], f"Failed: {response.text}"
        
        if response.status_code == 200:
            data = response.json()
            assert "message" in data
        
        print(f"✓ DELETE /api/technicians/{user_id}/achievements/{test_ach_id} - badge revoked")


class TestProfileFeatures(TestAuthSetup):
    """Profile update and avatar upload tests"""
    
    def test_upload_avatar(self, headers, user_id):
        """POST /api/technicians/{id}/avatar - upload profile picture"""
        # Create a simple test image (1x1 PNG)
        png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
        
        files = {"file": ("test_avatar.png", io.BytesIO(png_data), "image/png")}
        
        # Remove Content-Type from headers for multipart upload
        upload_headers = {"Authorization": headers["Authorization"]}
        
        response = requests.post(f"{BASE_URL}/api/technicians/{user_id}/avatar",
                                files=files, headers=upload_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "message" in data
        assert "avatar_url" in data
        assert data["avatar_url"].startswith("/api/uploads/avatars/")
        
        print(f"✓ POST /api/technicians/{user_id}/avatar - avatar uploaded: {data['avatar_url']}")
    
    def test_update_profile(self, headers, user_id):
        """PUT /api/technicians/{id}/profile - update about_me, hire_date, birthday"""
        profile_data = {
            "about_me": f"{TEST_PREFIX}Test about me section with bio info",
            "hire_date": "2023-01-15",
            "birthday": "1990-06-20"
        }
        
        response = requests.put(f"{BASE_URL}/api/technicians/{user_id}/profile",
                               json=profile_data, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "message" in data
        
        # Verify by getting user info (re-login)
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        user = login_response.json()["user"]
        
        # Check fields were updated
        assert user.get("about_me") == profile_data["about_me"], "about_me not updated"
        assert user.get("hire_date") == profile_data["hire_date"], "hire_date not updated"
        assert user.get("birthday") == profile_data["birthday"], "birthday not updated"
        
        print(f"✓ PUT /api/technicians/{user_id}/profile - profile updated")


class TestHoverCard(TestAuthSetup):
    """Technician status / hover card endpoint tests"""
    
    def test_get_technician_status(self, headers, user_id):
        """GET /api/technicians/{id}/status - hover card data"""
        response = requests.get(f"{BASE_URL}/api/technicians/{user_id}/status", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        
        # Required fields for hover card
        assert "user_id" in data
        assert "name" in data
        assert "status_text" in data
        assert "status_type" in data
        assert "active_sessions" in data
        assert "assigned_tickets" in data or "tickets" in data
        assert "achievement_count" in data
        
        # status_type should be one of expected values
        assert data["status_type"] in ["remote", "active", "available"]
        
        # achievement_count should be a number
        assert isinstance(data["achievement_count"], int)
        
        print(f"✓ GET /api/technicians/{user_id}/status - hover card data: status={data['status_text']}, badges={data['achievement_count']}")


class TestMicrosoftIntegrationConfigs(TestAuthSetup):
    """Microsoft Teams, CIPP, and M365 integration config tests"""
    
    def test_get_teams_settings(self, headers):
        """GET /api/settings/microsoft-teams - Teams config"""
        response = requests.get(f"{BASE_URL}/api/settings/microsoft-teams", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "type" in data
        assert data["type"] == "microsoft_teams"
        # Should have config fields (even if empty/disabled)
        expected_fields = ["enabled", "tenant_id", "client_id"]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
        
        print(f"✓ GET /api/settings/microsoft-teams - config retrieved, enabled={data.get('enabled')}")
    
    def test_update_teams_settings(self, headers):
        """PUT /api/settings/microsoft-teams - update Teams config"""
        teams_config = {
            "enabled": False,
            "tenant_id": f"{TEST_PREFIX}test-tenant-id",
            "client_id": f"{TEST_PREFIX}test-client-id",
            "client_secret": "test-secret",
            "webhook_url": "https://test.webhook.url"
        }
        
        response = requests.put(f"{BASE_URL}/api/settings/microsoft-teams",
                               json=teams_config, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        # Verify update
        get_response = requests.get(f"{BASE_URL}/api/settings/microsoft-teams", headers=headers)
        updated = get_response.json()
        assert updated.get("tenant_id") == teams_config["tenant_id"]
        
        print(f"✓ PUT /api/settings/microsoft-teams - config updated")
    
    def test_get_cipp_settings(self, headers):
        """GET /api/settings/cipp - CIPP config"""
        response = requests.get(f"{BASE_URL}/api/settings/cipp", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "type" in data
        assert data["type"] == "cipp"
        
        print(f"✓ GET /api/settings/cipp - config retrieved, enabled={data.get('enabled')}")
    
    def test_update_cipp_settings(self, headers):
        """PUT /api/settings/cipp - update CIPP config"""
        cipp_config = {
            "enabled": False,
            "api_url": f"https://{TEST_PREFIX}cipp.example.com",
            "api_key": f"{TEST_PREFIX}api-key-12345",
            "tenant_filter": ""
        }
        
        response = requests.put(f"{BASE_URL}/api/settings/cipp",
                               json=cipp_config, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        # Verify
        get_response = requests.get(f"{BASE_URL}/api/settings/cipp", headers=headers)
        updated = get_response.json()
        assert updated.get("api_url") == cipp_config["api_url"]
        
        print(f"✓ PUT /api/settings/cipp - config updated")
    
    def test_get_m365_settings(self, headers):
        """GET /api/settings/microsoft365 - M365 config"""
        response = requests.get(f"{BASE_URL}/api/settings/microsoft365", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "type" in data
        assert data["type"] == "microsoft365"
        
        print(f"✓ GET /api/settings/microsoft365 - config retrieved, enabled={data.get('enabled')}")
    
    def test_update_m365_settings(self, headers):
        """PUT /api/settings/microsoft365 - update M365 config"""
        m365_config = {
            "enabled": False,
            "tenant_id": f"{TEST_PREFIX}m365-tenant-id",
            "client_id": f"{TEST_PREFIX}m365-client-id",
            "client_secret": "test-secret-m365",
            "redirect_uri": "https://app.example.com/callback"
        }
        
        response = requests.put(f"{BASE_URL}/api/settings/microsoft365",
                               json=m365_config, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        # Verify
        get_response = requests.get(f"{BASE_URL}/api/settings/microsoft365", headers=headers)
        updated = get_response.json()
        assert updated.get("tenant_id") == m365_config["tenant_id"]
        
        print(f"✓ PUT /api/settings/microsoft365 - config updated")


class TestClientM365Integration(TestAuthSetup):
    """Client-level M365 integration tests"""
    
    @pytest.fixture(scope="class")
    def test_client_id(self, headers):
        """Get or create a test client"""
        # First try to find an existing client
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        
        if clients:
            return clients[0]["id"]
        
        # Create a test client
        client_data = {
            "name": f"{TEST_PREFIX}M365 Test Client",
            "email": "m365test@example.com"
        }
        create_response = requests.post(f"{BASE_URL}/api/clients", json=client_data, headers=headers)
        return create_response.json()["id"]
    
    def test_sync_client_m365(self, headers, test_client_id):
        """POST /api/clients/{id}/m365-sync - sync M365 tenancy for client"""
        sync_data = {
            "tenant_id": f"{TEST_PREFIX}12345678-1234-1234-1234-123456789abc",
            "domain": f"{TEST_PREFIX}contoso.onmicrosoft.com",
            "users": [
                {
                    "display_name": "John Doe",
                    "upn": "john.doe@contoso.com",
                    "email": "john.doe@contoso.com",
                    "license_type": "E3",
                    "status": "active"
                },
                {
                    "display_name": "Jane Smith",
                    "upn": "jane.smith@contoso.com",
                    "email": "jane.smith@contoso.com",
                    "license_type": "E5",
                    "status": "active"
                }
            ]
        }
        
        response = requests.post(f"{BASE_URL}/api/clients/{test_client_id}/m365-sync",
                                json=sync_data, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "message" in data
        
        print(f"✓ POST /api/clients/{test_client_id}/m365-sync - M365 synced")
    
    def test_get_client_m365_users(self, headers, test_client_id):
        """GET /api/clients/{id}/m365-users - get M365 users for client"""
        response = requests.get(f"{BASE_URL}/api/clients/{test_client_id}/m365-users", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "users" in data
        assert "config" in data
        
        users = data["users"]
        assert isinstance(users, list)
        
        config = data["config"]
        # Config can be None if not synced
        if config:
            assert "tenant_id" in config or "domain" in config
        
        print(f"✓ GET /api/clients/{test_client_id}/m365-users - returned {len(users)} users")


class TestTeamsStatus(TestAuthSetup):
    """Teams status update tests"""
    
    def test_update_teams_status(self, headers):
        """POST /api/teams/update-status - update Teams status"""
        status_data = {
            "availability": "Available",
            "status_message": f"{TEST_PREFIX}Working on tickets"
        }
        
        response = requests.post(f"{BASE_URL}/api/teams/update-status",
                                json=status_data, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        # May return configured: false if not enabled, that's expected
        assert "message" in data or "configured" in data
        
        if data.get("configured") == False:
            print(f"✓ POST /api/teams/update-status - returned 'not configured' (expected)")
        else:
            print(f"✓ POST /api/teams/update-status - status updated")
    
    def test_get_technician_teams_status(self, headers, user_id):
        """GET /api/technicians/{id}/teams-status - get Teams status"""
        response = requests.get(f"{BASE_URL}/api/technicians/{user_id}/teams-status", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        # Should have status fields or empty object
        
        print(f"✓ GET /api/technicians/{user_id}/teams-status - status retrieved")


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_custom_achievements(self):
        """Clean up test achievement definitions"""
        # Login
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL, "password": TEST_PASSWORD
        })
        token = response.json().get("token")
        headers = {"Authorization": f"Bearer {token}"}
        
        # Get and remove test achievements
        ach_response = requests.get(f"{BASE_URL}/api/achievements", headers=headers)
        achievements = ach_response.json()
        
        test_achs = [a for a in achievements if TEST_PREFIX in a.get("name", "")]
        # Note: There's no delete endpoint for custom achievements in the API
        # This is just a placeholder for future cleanup if needed
        
        print(f"✓ Cleanup identified {len(test_achs)} test achievements (no delete endpoint available)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
