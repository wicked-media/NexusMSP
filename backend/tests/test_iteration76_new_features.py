"""
Iteration 76 - Testing New Features:
1. Morning Check Email Report - POST /api/morning-checks/send-email-report
2. Technician Invites - POST /api/technicians/invite, GET /api/technicians/invites, DELETE /api/technicians/invites/{id}, POST /api/technicians/invites/{id}/resend
3. Document Branding Templates - GET /api/doc-branding/templates, GET /api/doc-branding/settings, PUT /api/doc-branding/settings/{doc_type}, GET /api/doc-branding/preview/{template_id}
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json().get("token")

@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestMorningCheckEmailReport:
    """Test Morning Check Email Report endpoint"""
    
    def test_send_email_report_success(self, headers):
        """Test sending morning check email report"""
        response = requests.post(f"{BASE_URL}/api/morning-checks/send-email-report", 
            json={"to_email": "test@example.com"},
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        # Email is mocked since Resend not configured
        assert data.get("status") in ["mocked", "sent"], f"Unexpected status: {data}"
        assert "message" in data
        assert "resend_configured" in data
        print(f"Morning check email sent: status={data['status']}, resend_configured={data['resend_configured']}")
    
    def test_send_email_report_missing_email(self, headers):
        """Test sending email without recipient"""
        response = requests.post(f"{BASE_URL}/api/morning-checks/send-email-report", 
            json={},
            headers=headers
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        assert "email" in response.json().get("detail", "").lower()


class TestTechnicianInvites:
    """Test Technician Invite CRUD endpoints"""
    
    created_invite_id = None
    
    def test_create_invite(self, headers):
        """Test creating a technician invite"""
        unique_email = f"test_invite_{uuid.uuid4().hex[:6]}@example.com"
        response = requests.post(f"{BASE_URL}/api/technicians/invite", 
            json={
                "name": "TEST_Invite User",
                "email": unique_email,
                "role": "technician",
                "job_title": "L1 Technician",
                "categories": ["helpdesk", "sla"]
            },
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "invite" in data
        assert data["invite"]["email"] == unique_email
        assert data["invite"]["name"] == "TEST_Invite User"
        assert data["invite"]["status"] == "pending"
        assert "email" in data  # Email result
        assert data["email"]["status"] in ["mocked", "sent"]
        TestTechnicianInvites.created_invite_id = data["invite"]["id"]
        print(f"Created invite: {data['invite']['id']}, email status: {data['email']['status']}")
    
    def test_list_invites(self, headers):
        """Test listing all invites"""
        response = requests.get(f"{BASE_URL}/api/technicians/invites", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        # Should have at least the invite we just created
        if TestTechnicianInvites.created_invite_id:
            invite_ids = [inv["id"] for inv in data]
            assert TestTechnicianInvites.created_invite_id in invite_ids
        print(f"Listed {len(data)} invites")
    
    def test_resend_invite(self, headers):
        """Test resending an invite email"""
        if not TestTechnicianInvites.created_invite_id:
            pytest.skip("No invite created")
        
        response = requests.post(
            f"{BASE_URL}/api/technicians/invites/{TestTechnicianInvites.created_invite_id}/resend",
            json={},
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "email" in data
        assert data["email"]["status"] in ["mocked", "sent"]
        print(f"Resent invite, email status: {data['email']['status']}")
    
    def test_revoke_invite(self, headers):
        """Test revoking an invite"""
        if not TestTechnicianInvites.created_invite_id:
            pytest.skip("No invite created")
        
        response = requests.delete(
            f"{BASE_URL}/api/technicians/invites/{TestTechnicianInvites.created_invite_id}",
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "revoked" in data.get("message", "").lower()
        print(f"Revoked invite: {TestTechnicianInvites.created_invite_id}")
    
    def test_create_invite_duplicate_pending(self, headers):
        """Test creating invite with same email as pending invite fails"""
        # First create an invite
        unique_email = f"test_dup_{uuid.uuid4().hex[:6]}@example.com"
        response1 = requests.post(f"{BASE_URL}/api/technicians/invite", 
            json={"name": "First Invite", "email": unique_email, "role": "technician"},
            headers=headers
        )
        assert response1.status_code == 200
        
        # Try to create another invite with same email
        response2 = requests.post(f"{BASE_URL}/api/technicians/invite", 
            json={"name": "Duplicate Invite", "email": unique_email, "role": "technician"},
            headers=headers
        )
        # Should fail with 409 (conflict) for pending invite
        assert response2.status_code == 409, f"Expected 409 conflict, got {response2.status_code}: {response2.text}"
    
    def test_create_invite_missing_fields(self, headers):
        """Test creating invite without required fields"""
        response = requests.post(f"{BASE_URL}/api/technicians/invite", 
            json={"name": "Only Name"},
            headers=headers
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"


class TestDocBrandingTemplates:
    """Test Document Branding Templates endpoints"""
    
    def test_get_templates(self, headers):
        """Test getting branding templates"""
        response = requests.get(f"{BASE_URL}/api/doc-branding/templates", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "builtin" in data
        assert "custom" in data
        assert isinstance(data["builtin"], list)
        assert len(data["builtin"]) >= 4  # professional, modern, corporate, tech
        
        # Verify builtin templates have required fields
        for tpl in data["builtin"]:
            assert "id" in tpl
            assert "name" in tpl
            assert "color_scheme" in tpl
        print(f"Got {len(data['builtin'])} builtin templates, {len(data['custom'])} custom templates")
    
    def test_get_branding_settings(self, headers):
        """Test getting branding settings for all doc types"""
        response = requests.get(f"{BASE_URL}/api/doc-branding/settings", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Should have settings for all 4 doc types
        expected_types = ["invoice", "purchase_order", "estimate", "letterhead"]
        for doc_type in expected_types:
            assert doc_type in data, f"Missing doc type: {doc_type}"
            assert "doc_type" in data[doc_type]
            assert "active_template_id" in data[doc_type]
        print(f"Got branding settings for: {list(data.keys())}")
    
    def test_update_branding_settings_invoice(self, headers):
        """Test updating branding settings for invoice"""
        response = requests.put(f"{BASE_URL}/api/doc-branding/settings/invoice", 
            json={
                "active_template_id": "tpl-modern",
                "company_name": "TEST_Company Pty Ltd",
                "company_address": "123 Test St, Sydney NSW 2000",
                "company_phone": "+61 2 9000 0000",
                "company_email": "accounts@testcompany.com",
                "footer_text": "Thank you for your business"
            },
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data["doc_type"] == "invoice"
        assert data["company_name"] == "TEST_Company Pty Ltd"
        assert data["active_template_id"] == "tpl-modern"
        print(f"Updated invoice branding settings")
    
    def test_update_branding_settings_purchase_order(self, headers):
        """Test updating branding settings for purchase order"""
        response = requests.put(f"{BASE_URL}/api/doc-branding/settings/purchase_order", 
            json={
                "active_template_id": "tpl-corporate",
                "company_name": "TEST_PO Company",
                "payment_instructions": "Bank: ANZ | BSB: 012-345"
            },
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data["doc_type"] == "purchase_order"
        print(f"Updated purchase_order branding settings")
    
    def test_update_branding_settings_invalid_doc_type(self, headers):
        """Test updating branding with invalid doc type"""
        response = requests.put(f"{BASE_URL}/api/doc-branding/settings/invalid_type", 
            json={"company_name": "Test"},
            headers=headers
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
    
    def test_preview_template_builtin(self, headers):
        """Test previewing a builtin template"""
        response = requests.get(
            f"{BASE_URL}/api/doc-branding/preview/tpl-professional?doc_type=invoice",
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "template" in data
        assert "preview_html" in data
        assert data["template"]["id"] == "tpl-professional"
        assert len(data["preview_html"]) > 100  # Should have substantial HTML
        print(f"Got preview for tpl-professional, HTML length: {len(data['preview_html'])}")
    
    def test_preview_template_modern(self, headers):
        """Test previewing modern template"""
        response = requests.get(
            f"{BASE_URL}/api/doc-branding/preview/tpl-modern?doc_type=estimate",
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data["template"]["id"] == "tpl-modern"
        print(f"Got preview for tpl-modern")
    
    def test_preview_template_not_found(self, headers):
        """Test previewing non-existent template"""
        response = requests.get(
            f"{BASE_URL}/api/doc-branding/preview/tpl-nonexistent?doc_type=invoice",
            headers=headers
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"


class TestOnboardingKanbanView:
    """Test Onboarding endpoints for Kanban board view"""
    
    def test_get_onboarding_sessions(self, headers):
        """Test getting onboarding sessions (for Kanban board)"""
        response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/sessions", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "sessions" in data
        assert "stats" in data
        # Stats should have counts for Kanban columns
        stats = data["stats"]
        # Check for either total_sessions or total
        assert "total" in stats or "total_sessions" in stats, f"Missing total count in stats: {stats}"
        assert "in_progress" in stats
        assert "completed" in stats
        print(f"Got {len(data['sessions'])} sessions, stats: {stats}")
    
    def test_create_onboarding_session(self, headers):
        """Test creating an onboarding session"""
        response = requests.post(f"{BASE_URL}/api/onboarding-enhanced/sessions", 
            json={
                "template": "mid_market",
                "client_name": "TEST_Kanban Client",
                "priority": "normal"
            },
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["client_name"] == "TEST_Kanban Client"
        assert data["status"] == "in_progress"
        assert "steps" in data
        print(f"Created onboarding session: {data['id']}")
        return data["id"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
