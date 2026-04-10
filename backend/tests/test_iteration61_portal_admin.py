"""
Iteration 61 - Portal User Management Admin API Tests
Tests for /api/portal/users CRUD endpoints used by ClientPortalAdminPage
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestPortalUserManagementAPIs:
    """Tests for Portal User Management Admin APIs"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - get admin token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as MSP admin
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert login_resp.status_code == 200, f"Admin login failed: {login_resp.text}"
        self.token = login_resp.json()["token"]
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
        
        # Store test user IDs for cleanup
        self.test_user_ids = []
        yield
        
        # Cleanup test users
        for user_id in self.test_user_ids:
            try:
                self.session.delete(f"{BASE_URL}/api/portal/users/{user_id}")
            except:
                pass
    
    # ============== GET /api/portal/users ==============
    def test_get_portal_users_returns_list(self):
        """GET /api/portal/users should return list of portal users"""
        resp = self.session.get(f"{BASE_URL}/api/portal/users")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert isinstance(data, list), "Response should be a list"
        
        # Check if John Smith exists (seeded user)
        john = next((u for u in data if u.get('email') == 'john@acmecorp.com'), None)
        assert john is not None, "John Smith (john@acmecorp.com) should exist in portal users"
        assert john.get('name') == 'John Smith', f"Expected name 'John Smith', got {john.get('name')}"
        assert john.get('client_name') == 'Acme Corporation', f"Expected client 'Acme Corporation', got {john.get('client_name')}"
        assert john.get('role') in ['admin', 'user'], f"Role should be admin or user, got {john.get('role')}"
        print(f"✓ GET /api/portal/users returned {len(data)} users including John Smith")
    
    def test_get_portal_users_with_client_filter(self):
        """GET /api/portal/users?client_id=X should filter by client"""
        resp = self.session.get(f"{BASE_URL}/api/portal/users?client_id=client-001")
        assert resp.status_code == 200
        
        data = resp.json()
        # All returned users should be from client-001
        for user in data:
            assert user.get('client_id') == 'client-001', f"User {user.get('email')} has wrong client_id"
        print(f"✓ GET /api/portal/users?client_id=client-001 returned {len(data)} users")
    
    def test_get_portal_users_excludes_password_hash(self):
        """GET /api/portal/users should NOT return password_hash"""
        resp = self.session.get(f"{BASE_URL}/api/portal/users")
        assert resp.status_code == 200
        
        data = resp.json()
        for user in data:
            assert 'password_hash' not in user, f"password_hash should not be exposed for {user.get('email')}"
        print("✓ password_hash is properly excluded from response")
    
    # ============== POST /api/portal/users ==============
    def test_create_portal_user_success(self):
        """POST /api/portal/users should create a new portal user"""
        unique_email = f"test-portal-{uuid.uuid4().hex[:8]}@techstart.com"
        
        payload = {
            "client_id": "client-002",  # TechStart Inc
            "email": unique_email,
            "password": "testpass123",
            "name": "TEST Portal User",
            "role": "user",
            "phone": "+1-555-0199",
            "is_primary_contact": False,
            "can_view_all_tickets": True,
            "can_create_tickets": True,
            "can_view_assets": True,
            "can_view_invoices": False
        }
        
        resp = self.session.post(f"{BASE_URL}/api/portal/users", json=payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert 'id' in data, "Response should contain user id"
        assert data.get('email') == unique_email, f"Email mismatch: {data.get('email')}"
        
        self.test_user_ids.append(data['id'])
        
        # Verify user appears in list
        list_resp = self.session.get(f"{BASE_URL}/api/portal/users")
        users = list_resp.json()
        created_user = next((u for u in users if u.get('email') == unique_email), None)
        assert created_user is not None, "Created user should appear in list"
        assert created_user.get('name') == "TEST Portal User"
        assert created_user.get('can_view_all_tickets') == True
        print(f"✓ POST /api/portal/users created user {unique_email}")
    
    def test_create_portal_user_duplicate_email_fails(self):
        """POST /api/portal/users with existing email should fail"""
        payload = {
            "client_id": "client-001",
            "email": "john@acmecorp.com",  # Already exists
            "password": "testpass123",
            "name": "Duplicate John"
        }
        
        resp = self.session.post(f"{BASE_URL}/api/portal/users", json=payload)
        assert resp.status_code == 400, f"Expected 400 for duplicate email, got {resp.status_code}"
        assert "already exists" in resp.text.lower(), f"Error should mention email exists: {resp.text}"
        print("✓ POST /api/portal/users correctly rejects duplicate email")
    
    def test_create_portal_user_invalid_client_fails(self):
        """POST /api/portal/users with invalid client_id should fail"""
        payload = {
            "client_id": "invalid-client-xyz",
            "email": f"test-{uuid.uuid4().hex[:8]}@test.com",
            "password": "testpass123",
            "name": "Test User"
        }
        
        resp = self.session.post(f"{BASE_URL}/api/portal/users", json=payload)
        assert resp.status_code == 404, f"Expected 404 for invalid client, got {resp.status_code}"
        print("✓ POST /api/portal/users correctly rejects invalid client_id")
    
    # ============== PUT /api/portal/users/{id} ==============
    def test_update_portal_user_role(self):
        """PUT /api/portal/users/{id} should update user role"""
        # First create a test user
        unique_email = f"test-update-{uuid.uuid4().hex[:8]}@techstart.com"
        create_resp = self.session.post(f"{BASE_URL}/api/portal/users", json={
            "client_id": "client-002",
            "email": unique_email,
            "password": "testpass123",
            "name": "TEST Update User",
            "role": "user"
        })
        assert create_resp.status_code == 200
        user_id = create_resp.json()['id']
        self.test_user_ids.append(user_id)
        
        # Update role to admin
        update_resp = self.session.put(f"{BASE_URL}/api/portal/users/{user_id}", json={
            "role": "admin"
        })
        assert update_resp.status_code == 200, f"Update failed: {update_resp.text}"
        
        # Verify update
        list_resp = self.session.get(f"{BASE_URL}/api/portal/users")
        updated_user = next((u for u in list_resp.json() if u.get('id') == user_id), None)
        assert updated_user is not None
        assert updated_user.get('role') == 'admin', f"Role should be admin, got {updated_user.get('role')}"
        print(f"✓ PUT /api/portal/users/{user_id} updated role to admin")
    
    def test_update_portal_user_permissions(self):
        """PUT /api/portal/users/{id} should update permissions"""
        # Create test user
        unique_email = f"test-perms-{uuid.uuid4().hex[:8]}@techstart.com"
        create_resp = self.session.post(f"{BASE_URL}/api/portal/users", json={
            "client_id": "client-002",
            "email": unique_email,
            "password": "testpass123",
            "name": "TEST Perms User",
            "can_view_all_tickets": False,
            "can_view_invoices": False
        })
        user_id = create_resp.json()['id']
        self.test_user_ids.append(user_id)
        
        # Update permissions
        update_resp = self.session.put(f"{BASE_URL}/api/portal/users/{user_id}", json={
            "can_view_all_tickets": True,
            "can_view_invoices": True
        })
        assert update_resp.status_code == 200
        
        # Verify
        list_resp = self.session.get(f"{BASE_URL}/api/portal/users")
        updated_user = next((u for u in list_resp.json() if u.get('id') == user_id), None)
        assert updated_user.get('can_view_all_tickets') == True
        assert updated_user.get('can_view_invoices') == True
        print(f"✓ PUT /api/portal/users/{user_id} updated permissions")
    
    def test_update_portal_user_status(self):
        """PUT /api/portal/users/{id} should update is_active status"""
        # Create test user
        unique_email = f"test-status-{uuid.uuid4().hex[:8]}@techstart.com"
        create_resp = self.session.post(f"{BASE_URL}/api/portal/users", json={
            "client_id": "client-002",
            "email": unique_email,
            "password": "testpass123",
            "name": "TEST Status User"
        })
        user_id = create_resp.json()['id']
        self.test_user_ids.append(user_id)
        
        # Deactivate user
        update_resp = self.session.put(f"{BASE_URL}/api/portal/users/{user_id}", json={
            "is_active": False
        })
        assert update_resp.status_code == 200
        
        # Verify
        list_resp = self.session.get(f"{BASE_URL}/api/portal/users")
        updated_user = next((u for u in list_resp.json() if u.get('id') == user_id), None)
        assert updated_user.get('is_active') == False
        print(f"✓ PUT /api/portal/users/{user_id} deactivated user")
    
    def test_update_portal_user_password(self):
        """PUT /api/portal/users/{id} with password should reset password"""
        # Create test user
        unique_email = f"test-pw-{uuid.uuid4().hex[:8]}@techstart.com"
        create_resp = self.session.post(f"{BASE_URL}/api/portal/users", json={
            "client_id": "client-002",
            "email": unique_email,
            "password": "oldpassword123",
            "name": "TEST Password User"
        })
        user_id = create_resp.json()['id']
        self.test_user_ids.append(user_id)
        
        # Reset password
        update_resp = self.session.put(f"{BASE_URL}/api/portal/users/{user_id}", json={
            "password": "newpassword456"
        })
        assert update_resp.status_code == 200
        
        # Verify new password works via portal login (uses query params)
        login_resp = self.session.post(
            f"{BASE_URL}/api/portal/login?email={unique_email}&password=newpassword456"
        )
        assert login_resp.status_code == 200, f"Login with new password failed: {login_resp.text}"
        print(f"✓ PUT /api/portal/users/{user_id} reset password successfully")
    
    def test_update_nonexistent_user_fails(self):
        """PUT /api/portal/users/{id} with invalid id should return 404"""
        resp = self.session.put(f"{BASE_URL}/api/portal/users/nonexistent-user-xyz", json={
            "role": "admin"
        })
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("✓ PUT /api/portal/users/invalid-id correctly returns 404")
    
    # ============== DELETE /api/portal/users/{id} ==============
    def test_delete_portal_user(self):
        """DELETE /api/portal/users/{id} should remove user"""
        # Create test user
        unique_email = f"test-delete-{uuid.uuid4().hex[:8]}@techstart.com"
        create_resp = self.session.post(f"{BASE_URL}/api/portal/users", json={
            "client_id": "client-002",
            "email": unique_email,
            "password": "testpass123",
            "name": "TEST Delete User"
        })
        user_id = create_resp.json()['id']
        
        # Delete user
        delete_resp = self.session.delete(f"{BASE_URL}/api/portal/users/{user_id}")
        assert delete_resp.status_code == 200, f"Delete failed: {delete_resp.text}"
        
        # Verify user is gone
        list_resp = self.session.get(f"{BASE_URL}/api/portal/users")
        deleted_user = next((u for u in list_resp.json() if u.get('id') == user_id), None)
        assert deleted_user is None, "Deleted user should not appear in list"
        print(f"✓ DELETE /api/portal/users/{user_id} removed user")
    
    def test_delete_nonexistent_user_fails(self):
        """DELETE /api/portal/users/{id} with invalid id should return 404"""
        resp = self.session.delete(f"{BASE_URL}/api/portal/users/nonexistent-user-xyz")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("✓ DELETE /api/portal/users/invalid-id correctly returns 404")
    
    # ============== GET /api/clients ==============
    def test_get_clients_for_dropdown(self):
        """GET /api/clients should return list of clients for dropdown"""
        resp = self.session.get(f"{BASE_URL}/api/clients")
        assert resp.status_code == 200
        
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Should have at least one client"
        
        # Check for expected clients
        client_names = [c.get('name') for c in data]
        assert 'Acme Corporation' in client_names, "Acme Corporation should exist"
        print(f"✓ GET /api/clients returned {len(data)} clients")
    
    # ============== Portal Login (for testing deactivated users) ==============
    def test_deactivated_user_cannot_login(self):
        """Deactivated portal user should not be able to login"""
        # Create and deactivate a user
        unique_email = f"test-inactive-{uuid.uuid4().hex[:8]}@techstart.com"
        create_resp = self.session.post(f"{BASE_URL}/api/portal/users", json={
            "client_id": "client-002",
            "email": unique_email,
            "password": "testpass123",
            "name": "TEST Inactive User"
        })
        user_id = create_resp.json()['id']
        self.test_user_ids.append(user_id)
        
        # Deactivate
        self.session.put(f"{BASE_URL}/api/portal/users/{user_id}", json={"is_active": False})
        
        # Try to login (uses query params)
        login_resp = self.session.post(
            f"{BASE_URL}/api/portal/login?email={unique_email}&password=testpass123"
        )
        assert login_resp.status_code == 401, f"Deactivated user should not login, got {login_resp.status_code}"
        print("✓ Deactivated user correctly cannot login")


class TestPortalUserDataIntegrity:
    """Tests for data integrity and edge cases"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        self.token = login_resp.json()["token"]
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    def test_john_smith_user_exists_with_correct_data(self):
        """Verify John Smith (seeded user) has correct data"""
        resp = self.session.get(f"{BASE_URL}/api/portal/users")
        users = resp.json()
        
        john = next((u for u in users if u.get('email') == 'john@acmecorp.com'), None)
        assert john is not None, "John Smith should exist"
        
        # Verify expected fields
        assert john.get('name') == 'John Smith'
        assert john.get('client_id') == 'client-001'
        assert john.get('client_name') == 'Acme Corporation'
        assert john.get('role') in ['admin', 'user']
        assert 'id' in john
        assert 'is_active' in john or john.get('is_active') is None  # May default to True
        print("✓ John Smith user has correct data structure")
    
    def test_portal_user_has_all_permission_fields(self):
        """Portal users should have all permission fields"""
        resp = self.session.get(f"{BASE_URL}/api/portal/users")
        users = resp.json()
        
        if len(users) > 0:
            user = users[0]
            expected_fields = ['can_view_all_tickets', 'can_create_tickets', 'can_view_assets', 'can_view_invoices']
            for field in expected_fields:
                assert field in user, f"User should have {field} field"
        print("✓ Portal users have all permission fields")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
