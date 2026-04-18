"""
Iteration 97 - Portal User Management CRUD Tests
Tests for:
- List portal users: GET /api/client-portal/users/{client_id}
- Create portal user: POST /api/client-portal/users/{client_id}
- Update portal user: PUT /api/client-portal/users/{client_id}/{user_id}
- Reset password: POST /api/client-portal/users/{client_id}/{user_id}/reset-password
- Delete portal user: DELETE /api/client-portal/users/{client_id}/{user_id}
- Duplicate email check: POST create with existing email returns 409
- Created user can login: POST /api/portal/v2/login with temp password
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
CLIENT_ID = "client-001"  # Acme Corporation

# Test credentials
ADMIN_EMAIL = "aaron@stech.com.au"
ADMIN_PASSWORD = "Lucky@2871$!"


class TestPortalUserManagement:
    """Portal User Management CRUD tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin auth token before each test"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        self.token = response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
        
        # Track created users for cleanup
        self.created_user_ids = []
        yield
        
        # Cleanup created test users
        for user_id in self.created_user_ids:
            try:
                self.session.delete(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}/{user_id}")
            except:
                pass
    
    def test_01_list_portal_users(self):
        """Test GET /api/client-portal/users/{client_id} returns portal users array"""
        response = self.session.get(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}")
        
        assert response.status_code == 200, f"List users failed: {response.text}"
        data = response.json()
        
        # Should return a list
        assert isinstance(data, list), "Response should be a list"
        print(f"Found {len(data)} portal users for client-001")
        
        # Check existing users (john@acmecorp.com and jane@acmecorp.com should exist)
        emails = [u.get("email") for u in data]
        print(f"Portal user emails: {emails}")
        
        # Verify user structure if any users exist
        if len(data) > 0:
            user = data[0]
            assert "id" in user, "User should have id"
            assert "email" in user, "User should have email"
            assert "client_id" in user, "User should have client_id"
            assert "password_hash" not in user, "Password hash should not be exposed"
            print(f"User structure verified: {list(user.keys())}")
    
    def test_02_create_portal_user_success(self):
        """Test POST /api/client-portal/users/{client_id} creates user and returns temp_password"""
        unique_email = f"TEST_user_{uuid.uuid4().hex[:8]}@acmecorp.com"
        
        payload = {
            "name": "Test Portal User",
            "email": unique_email,
            "role": "user",
            "can_view_all_tickets": True,
            "can_create_tickets": True,
            "can_view_assets": True,
            "can_view_invoices": False
        }
        
        response = self.session.post(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}", json=payload)
        
        assert response.status_code == 200, f"Create user failed: {response.text}"
        data = response.json()
        
        # Track for cleanup
        if "id" in data:
            self.created_user_ids.append(data["id"])
        
        # Verify response structure
        assert "id" in data, "Response should have id"
        assert "email" in data, "Response should have email"
        assert data["email"] == unique_email.lower(), "Email should match"
        assert "temp_password" in data, "Response should have temp_password"
        assert len(data["temp_password"]) > 0, "temp_password should not be empty"
        assert "password_hash" not in data, "Password hash should not be exposed"
        
        # Verify permissions
        assert data.get("can_view_all_tickets") == True
        assert data.get("can_create_tickets") == True
        assert data.get("can_view_assets") == True
        assert data.get("can_view_invoices") == False
        assert data.get("role") == "user"
        
        print(f"Created user: {data['email']} with temp_password: {data['temp_password']}")
        
        # Store for later tests
        self.created_user_id = data["id"]
        self.created_user_email = data["email"]
        self.created_user_temp_password = data["temp_password"]
    
    def test_03_create_portal_user_duplicate_email_returns_409(self):
        """Test POST create with existing email returns 409"""
        # First create a user
        unique_email = f"TEST_dup_{uuid.uuid4().hex[:8]}@acmecorp.com"
        
        payload = {
            "name": "First User",
            "email": unique_email,
            "role": "user"
        }
        
        response1 = self.session.post(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}", json=payload)
        assert response1.status_code == 200, f"First create failed: {response1.text}"
        
        # Track for cleanup
        data1 = response1.json()
        if "id" in data1:
            self.created_user_ids.append(data1["id"])
        
        # Try to create another user with same email
        payload2 = {
            "name": "Duplicate User",
            "email": unique_email,  # Same email
            "role": "admin"
        }
        
        response2 = self.session.post(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}", json=payload2)
        
        assert response2.status_code == 409, f"Expected 409 for duplicate email, got {response2.status_code}: {response2.text}"
        
        error_data = response2.json()
        assert "detail" in error_data, "Error response should have detail"
        print(f"Duplicate email correctly rejected: {error_data['detail']}")
    
    def test_04_update_portal_user_permissions(self):
        """Test PUT /api/client-portal/users/{client_id}/{user_id} updates permissions"""
        # First create a user
        unique_email = f"TEST_update_{uuid.uuid4().hex[:8]}@acmecorp.com"
        
        create_payload = {
            "name": "Update Test User",
            "email": unique_email,
            "role": "user",
            "can_view_invoices": False
        }
        
        create_response = self.session.post(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}", json=create_payload)
        assert create_response.status_code == 200, f"Create failed: {create_response.text}"
        
        created_user = create_response.json()
        user_id = created_user["id"]
        self.created_user_ids.append(user_id)
        
        # Update the user
        update_payload = {
            "name": "Updated Name",
            "role": "admin",
            "can_view_invoices": True,
            "is_active": True
        }
        
        update_response = self.session.put(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}/{user_id}", json=update_payload)
        
        assert update_response.status_code == 200, f"Update failed: {update_response.text}"
        update_data = update_response.json()
        assert "message" in update_data, "Update response should have message"
        print(f"Update response: {update_data}")
        
        # Verify update by fetching user list
        list_response = self.session.get(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}")
        assert list_response.status_code == 200
        
        users = list_response.json()
        updated_user = next((u for u in users if u["id"] == user_id), None)
        
        assert updated_user is not None, "Updated user should be in list"
        assert updated_user["name"] == "Updated Name", "Name should be updated"
        assert updated_user["role"] == "admin", "Role should be updated"
        assert updated_user["can_view_invoices"] == True, "can_view_invoices should be updated"
        print(f"Verified update: name={updated_user['name']}, role={updated_user['role']}, can_view_invoices={updated_user['can_view_invoices']}")
    
    def test_05_reset_portal_user_password(self):
        """Test POST /api/client-portal/users/{client_id}/{user_id}/reset-password returns new temp_password"""
        # First create a user
        unique_email = f"TEST_reset_{uuid.uuid4().hex[:8]}@acmecorp.com"
        
        create_payload = {
            "name": "Reset Password Test",
            "email": unique_email,
            "role": "user"
        }
        
        create_response = self.session.post(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}", json=create_payload)
        assert create_response.status_code == 200, f"Create failed: {create_response.text}"
        
        created_user = create_response.json()
        user_id = created_user["id"]
        original_temp_password = created_user["temp_password"]
        self.created_user_ids.append(user_id)
        
        # Reset password
        reset_response = self.session.post(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}/{user_id}/reset-password", json={})
        
        assert reset_response.status_code == 200, f"Reset password failed: {reset_response.text}"
        reset_data = reset_response.json()
        
        assert "temp_password" in reset_data, "Reset response should have temp_password"
        assert "email" in reset_data, "Reset response should have email"
        assert reset_data["email"] == unique_email.lower(), "Email should match"
        assert len(reset_data["temp_password"]) > 0, "New temp_password should not be empty"
        assert reset_data["temp_password"] != original_temp_password, "New password should be different from original"
        
        print(f"Password reset for {reset_data['email']}: new temp_password={reset_data['temp_password']}")
    
    def test_06_delete_portal_user(self):
        """Test DELETE /api/client-portal/users/{client_id}/{user_id} removes user"""
        # First create a user
        unique_email = f"TEST_delete_{uuid.uuid4().hex[:8]}@acmecorp.com"
        
        create_payload = {
            "name": "Delete Test User",
            "email": unique_email,
            "role": "user"
        }
        
        create_response = self.session.post(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}", json=create_payload)
        assert create_response.status_code == 200, f"Create failed: {create_response.text}"
        
        created_user = create_response.json()
        user_id = created_user["id"]
        # Don't add to cleanup list since we're deleting it
        
        # Delete the user
        delete_response = self.session.delete(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}/{user_id}")
        
        assert delete_response.status_code == 200, f"Delete failed: {delete_response.text}"
        delete_data = delete_response.json()
        assert "message" in delete_data, "Delete response should have message"
        print(f"Delete response: {delete_data}")
        
        # Verify user is deleted by checking list
        list_response = self.session.get(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}")
        assert list_response.status_code == 200
        
        users = list_response.json()
        deleted_user = next((u for u in users if u["id"] == user_id), None)
        
        assert deleted_user is None, "Deleted user should not be in list"
        print(f"Verified user {user_id} is deleted")
    
    def test_07_delete_nonexistent_user_returns_404(self):
        """Test DELETE with non-existent user_id returns 404"""
        fake_user_id = str(uuid.uuid4())
        
        response = self.session.delete(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}/{fake_user_id}")
        
        assert response.status_code == 404, f"Expected 404 for non-existent user, got {response.status_code}: {response.text}"
        print(f"Non-existent user delete correctly returned 404")
    
    def test_08_created_user_can_login_to_portal(self):
        """Test POST /api/portal/v2/login with temp password succeeds"""
        # Create a new user
        unique_email = f"TEST_login_{uuid.uuid4().hex[:8]}@acmecorp.com"
        
        create_payload = {
            "name": "Login Test User",
            "email": unique_email,
            "role": "user"
        }
        
        create_response = self.session.post(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}", json=create_payload)
        assert create_response.status_code == 200, f"Create failed: {create_response.text}"
        
        created_user = create_response.json()
        user_id = created_user["id"]
        temp_password = created_user["temp_password"]
        self.created_user_ids.append(user_id)
        
        print(f"Created user {unique_email} with temp_password: {temp_password}")
        
        # Try to login with temp password (use a new session without admin auth)
        login_session = requests.Session()
        login_session.headers.update({"Content-Type": "application/json"})
        
        login_response = login_session.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": unique_email,
            "password": temp_password
        })
        
        assert login_response.status_code == 200, f"Portal login failed: {login_response.text}"
        login_data = login_response.json()
        
        assert "token" in login_data, "Login response should have token"
        assert "user" in login_data, "Login response should have user"
        assert login_data["user"]["email"] == unique_email.lower(), "User email should match"
        
        print(f"Portal login successful for {unique_email}")
        
        # Verify the token works by calling /api/portal/v2/me
        portal_session = requests.Session()
        portal_session.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {login_data['token']}"
        })
        
        me_response = portal_session.get(f"{BASE_URL}/api/portal/v2/me")
        assert me_response.status_code == 200, f"Portal /me failed: {me_response.text}"
        me_data = me_response.json()
        
        # /me returns {"user": {...}, "client": {...}} structure
        assert "user" in me_data, "Me response should have user object"
        assert me_data["user"]["email"] == unique_email.lower(), "Me endpoint should return correct user"
        print(f"Portal /me verified: {me_data['user']['email']}")
    
    def test_09_create_user_with_custom_password(self):
        """Test creating user with custom password instead of auto-generated"""
        unique_email = f"TEST_custom_{uuid.uuid4().hex[:8]}@acmecorp.com"
        custom_password = "MyCustomPassword123!"
        
        payload = {
            "name": "Custom Password User",
            "email": unique_email,
            "role": "user",
            "password": custom_password
        }
        
        response = self.session.post(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}", json=payload)
        
        assert response.status_code == 200, f"Create user failed: {response.text}"
        data = response.json()
        
        if "id" in data:
            self.created_user_ids.append(data["id"])
        
        # The temp_password should be the custom password we provided
        assert "temp_password" in data, "Response should have temp_password"
        assert data["temp_password"] == custom_password, "temp_password should be the custom password"
        
        print(f"Created user with custom password: {data['email']}")
        
        # Verify login with custom password
        login_session = requests.Session()
        login_session.headers.update({"Content-Type": "application/json"})
        
        login_response = login_session.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": unique_email,
            "password": custom_password
        })
        
        assert login_response.status_code == 200, f"Login with custom password failed: {login_response.text}"
        print(f"Login with custom password successful")
    
    def test_10_disable_user_blocks_login(self):
        """Test that disabling a user blocks their login"""
        # Create a user
        unique_email = f"TEST_disable_{uuid.uuid4().hex[:8]}@acmecorp.com"
        
        create_payload = {
            "name": "Disable Test User",
            "email": unique_email,
            "role": "user"
        }
        
        create_response = self.session.post(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}", json=create_payload)
        assert create_response.status_code == 200, f"Create failed: {create_response.text}"
        
        created_user = create_response.json()
        user_id = created_user["id"]
        temp_password = created_user["temp_password"]
        self.created_user_ids.append(user_id)
        
        # Verify login works initially
        login_session = requests.Session()
        login_session.headers.update({"Content-Type": "application/json"})
        
        login_response = login_session.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": unique_email,
            "password": temp_password
        })
        assert login_response.status_code == 200, "Initial login should work"
        print(f"Initial login successful for {unique_email}")
        
        # Disable the user
        update_response = self.session.put(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}/{user_id}", json={
            "is_active": False
        })
        assert update_response.status_code == 200, f"Disable failed: {update_response.text}"
        print(f"User disabled")
        
        # Try to login again - should fail
        login_response2 = login_session.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": unique_email,
            "password": temp_password
        })
        
        # Should be 401 or 403 for disabled user
        assert login_response2.status_code in [401, 403], f"Disabled user login should fail, got {login_response2.status_code}: {login_response2.text}"
        print(f"Disabled user login correctly blocked with status {login_response2.status_code}")


class TestPortalUserManagementEdgeCases:
    """Edge case tests for portal user management"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin auth token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        self.token = response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
        
        self.created_user_ids = []
        yield
        
        for user_id in self.created_user_ids:
            try:
                self.session.delete(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}/{user_id}")
            except:
                pass
    
    def test_create_user_without_email_returns_400(self):
        """Test creating user without email returns 400"""
        payload = {
            "name": "No Email User",
            "role": "user"
        }
        
        response = self.session.post(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}", json=payload)
        
        assert response.status_code == 400, f"Expected 400 for missing email, got {response.status_code}: {response.text}"
        print(f"Missing email correctly rejected with 400")
    
    def test_update_nonexistent_user_returns_404(self):
        """Test updating non-existent user returns 404"""
        fake_user_id = str(uuid.uuid4())
        
        response = self.session.put(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}/{fake_user_id}", json={
            "name": "Updated Name"
        })
        
        assert response.status_code == 404, f"Expected 404 for non-existent user, got {response.status_code}: {response.text}"
        print(f"Non-existent user update correctly returned 404")
    
    def test_reset_password_nonexistent_user_returns_404(self):
        """Test resetting password for non-existent user returns 404"""
        fake_user_id = str(uuid.uuid4())
        
        response = self.session.post(f"{BASE_URL}/api/client-portal/users/{CLIENT_ID}/{fake_user_id}/reset-password", json={})
        
        assert response.status_code == 404, f"Expected 404 for non-existent user, got {response.status_code}: {response.text}"
        print(f"Non-existent user password reset correctly returned 404")
    
    def test_list_users_for_nonexistent_client(self):
        """Test listing users for non-existent client returns empty list"""
        response = self.session.get(f"{BASE_URL}/api/client-portal/users/nonexistent-client-xyz")
        
        # Should return 200 with empty list (not 404)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        assert len(data) == 0, "List should be empty for non-existent client"
        print(f"Non-existent client correctly returned empty list")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
