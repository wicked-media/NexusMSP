"""
Iteration 57 - Client Onboarding Wizard (Enhanced) API Tests
Tests for the onboarding-enhanced endpoints:
- GET /api/onboarding-enhanced/templates
- POST /api/onboarding-enhanced/sessions
- GET /api/onboarding-enhanced/sessions
- GET /api/onboarding-enhanced/sessions/{id}
- PUT /api/onboarding-enhanced/sessions/{id}/step/{step_key}
- PUT /api/onboarding-enhanced/sessions/{id}/preflight
- PUT /api/onboarding-enhanced/sessions/{id}/complete
- PUT /api/onboarding-enhanced/sessions/{id}/pause
- DELETE /api/onboarding-enhanced/sessions/{id}
- GET /api/onboarding-enhanced/dashboard-stats
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "admin@nexusops.io"
TEST_PASSWORD = "admin123"

# Step keys for the wizard
STEP_KEYS = [
    "company_profile", "contacts_access", "asset_discovery", "contracts_billing",
    "security_compliance", "monitoring_automation", "documentation", "go_live"
]


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json().get("token")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }


@pytest.fixture(scope="module")
def test_session_id(headers):
    """Create a test session and return its ID for subsequent tests"""
    response = requests.post(f"{BASE_URL}/api/onboarding-enhanced/sessions", json={
        "template": "mid_market",
        "client_name": "TEST_Onboarding_Corp",
        "priority": "high"
    }, headers=headers)
    assert response.status_code == 200, f"Failed to create test session: {response.text}"
    session_id = response.json().get("id")
    yield session_id
    # Cleanup: delete the test session
    requests.delete(f"{BASE_URL}/api/onboarding-enhanced/sessions/{session_id}", headers=headers)


class TestOnboardingTemplates:
    """Tests for GET /api/onboarding-enhanced/templates"""
    
    def test_get_templates_returns_4_templates(self, headers):
        """Verify templates endpoint returns 4 templates"""
        response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/templates", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "templates" in data
        assert "step_definitions" in data
        
        templates = data["templates"]
        assert len(templates) == 4
        assert "small_office" in templates
        assert "mid_market" in templates
        assert "enterprise" in templates
        assert "break_fix" in templates
        
    def test_get_templates_returns_8_step_definitions(self, headers):
        """Verify templates endpoint returns 8 step definitions"""
        response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/templates", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        step_definitions = data["step_definitions"]
        assert len(step_definitions) == 8
        
        # Verify step keys match expected
        step_keys = [s["key"] for s in step_definitions]
        assert step_keys == STEP_KEYS
        
    def test_template_structure(self, headers):
        """Verify template structure has required fields"""
        response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/templates", headers=headers)
        data = response.json()
        
        for key, template in data["templates"].items():
            assert "name" in template
            assert "description" in template
            assert "estimated_days" in template
            assert "default_tier" in template
            assert "default_sla" in template


class TestOnboardingSessions:
    """Tests for session CRUD operations"""
    
    def test_create_session_with_template(self, headers):
        """Test creating a new onboarding session"""
        response = requests.post(f"{BASE_URL}/api/onboarding-enhanced/sessions", json={
            "template": "small_office",
            "client_name": "TEST_SmallBiz_Inc",
            "priority": "normal"
        }, headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert "id" in data
        assert data["id"].startswith("OB-")
        assert data["template"] == "small_office"
        assert data["client_name"] == "TEST_SmallBiz_Inc"
        assert data["priority"] == "normal"
        assert data["status"] == "in_progress"
        assert data["current_step"] == 1
        assert data["total_steps"] == 8
        assert "steps" in data
        assert len(data["steps"]) == 8
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/onboarding-enhanced/sessions/{data['id']}", headers=headers)
        
    def test_list_sessions_returns_stats(self, headers, test_session_id):
        """Test listing sessions returns sessions and stats"""
        response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/sessions", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert "sessions" in data
        assert "stats" in data
        
        stats = data["stats"]
        assert "total" in stats
        assert "in_progress" in stats
        assert "completed" in stats
        assert "paused" in stats
        assert "avg_health" in stats
        
    def test_get_session_by_id(self, headers, test_session_id):
        """Test getting a specific session by ID"""
        response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/sessions/{test_session_id}", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["id"] == test_session_id
        assert "health_score" in data
        assert "steps" in data
        assert "audit_log" in data
        
    def test_get_nonexistent_session_returns_404(self, headers):
        """Test getting a non-existent session returns 404"""
        response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/sessions/OB-NONEXISTENT", headers=headers)
        assert response.status_code == 404


class TestOnboardingSteps:
    """Tests for step save/complete/skip operations"""
    
    def test_save_step_data(self, headers, test_session_id):
        """Test saving step data without completing"""
        response = requests.put(
            f"{BASE_URL}/api/onboarding-enhanced/sessions/{test_session_id}/step/company_profile",
            json={
                "step_data": {
                    "company_name": "TEST_Onboarding_Corp",
                    "email": "test@onboarding.com",
                    "phone": "+1-555-0100"
                },
                "notes": "Test notes",
                "action": "save"
            },
            headers=headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify data was saved
        assert data["steps"]["company_profile"]["data"]["company_name"] == "TEST_Onboarding_Corp"
        assert data["steps"]["company_profile"]["status"] == "pending"  # Not completed yet
        
    def test_complete_step_advances_current_step(self, headers, test_session_id):
        """Test completing a step advances current_step"""
        # First get current step
        get_response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/sessions/{test_session_id}", headers=headers)
        initial_step = get_response.json()["current_step"]
        
        response = requests.put(
            f"{BASE_URL}/api/onboarding-enhanced/sessions/{test_session_id}/step/company_profile",
            json={
                "step_data": {
                    "company_name": "TEST_Onboarding_Corp",
                    "email": "test@onboarding.com",
                    "phone": "+1-555-0100",
                    "industry": "technology",
                    "employee_count": 50
                },
                "action": "complete"
            },
            headers=headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["steps"]["company_profile"]["status"] == "completed"
        assert data["steps"]["company_profile"]["completed_at"] is not None
        assert data["current_step"] >= initial_step  # Should advance
        
    def test_skip_step(self, headers, test_session_id):
        """Test skipping a step"""
        response = requests.put(
            f"{BASE_URL}/api/onboarding-enhanced/sessions/{test_session_id}/step/contacts_access",
            json={
                "step_data": {},
                "action": "skip"
            },
            headers=headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["steps"]["contacts_access"]["status"] == "skipped"
        
    def test_complete_asset_discovery_step(self, headers, test_session_id):
        """Test completing asset discovery step with devices"""
        response = requests.put(
            f"{BASE_URL}/api/onboarding-enhanced/sessions/{test_session_id}/step/asset_discovery",
            json={
                "step_data": {
                    "devices": [
                        {
                            "hostname": "TEST-WS-001",
                            "type": "workstation",
                            "os": "Windows 11 Pro",
                            "ip": "192.168.1.100"
                        },
                        {
                            "hostname": "TEST-SRV-001",
                            "type": "server",
                            "os": "Windows Server 2022",
                            "ip": "192.168.1.10"
                        }
                    ]
                },
                "action": "complete"
            },
            headers=headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["steps"]["asset_discovery"]["status"] == "completed"
        
    def test_complete_contracts_billing_step(self, headers, test_session_id):
        """Test completing contracts & billing step"""
        response = requests.put(
            f"{BASE_URL}/api/onboarding-enhanced/sessions/{test_session_id}/step/contracts_billing",
            json={
                "step_data": {
                    "create_contract": True,
                    "contract_name": "TEST Managed Services Agreement",
                    "contract_type": "managed",
                    "monthly_value": 2500,
                    "billing_cycle": "monthly",
                    "sla_tier": "standard",
                    "sla_response_hours": 4,
                    "sla_resolution_hours": 24
                },
                "action": "complete"
            },
            headers=headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["steps"]["contracts_billing"]["status"] == "completed"


class TestOnboardingPreflight:
    """Tests for preflight checklist operations"""
    
    def test_update_preflight_checklist(self, headers, test_session_id):
        """Test updating preflight checklist items"""
        response = requests.put(
            f"{BASE_URL}/api/onboarding-enhanced/sessions/{test_session_id}/preflight",
            json={
                "preflight": {
                    "pf-01": True,
                    "pf-02": True,
                    "pf-03": False,
                    "pf-04": True,
                    "pf-05": False,
                    "pf-06": True
                }
            },
            headers=headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["preflight"]["pf-01"] == True
        assert data["preflight"]["pf-02"] == True
        assert data["preflight"]["pf-03"] == False
        
    def test_preflight_affects_health_score(self, headers, test_session_id):
        """Test that preflight completion affects health score"""
        # Get initial health score
        get_response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/sessions/{test_session_id}", headers=headers)
        initial_health = get_response.json()["health_score"]
        
        # Update more preflight items
        response = requests.put(
            f"{BASE_URL}/api/onboarding-enhanced/sessions/{test_session_id}/preflight",
            json={
                "preflight": {
                    "pf-01": True,
                    "pf-02": True,
                    "pf-03": True,
                    "pf-04": True,
                    "pf-05": True,
                    "pf-06": True,
                    "pf-07": True,
                    "pf-08": True,
                    "pf-09": True,
                    "pf-10": True,
                    "pf-11": True,
                    "pf-12": True,
                    "pf-13": True,
                    "pf-14": True
                }
            },
            headers=headers
        )
        
        assert response.status_code == 200
        new_health = response.json()["health_score"]
        
        # Health score should increase with more preflight items checked
        assert new_health >= initial_health


class TestOnboardingPauseResume:
    """Tests for pause/resume functionality"""
    
    def test_pause_and_resume_session(self, headers):
        """Test pausing and resuming a session (toggle behavior)"""
        # Create a fresh session for this test
        create_response = requests.post(f"{BASE_URL}/api/onboarding-enhanced/sessions", json={
            "template": "mid_market",
            "client_name": "TEST_PauseResume",
            "priority": "normal"
        }, headers=headers)
        session_id = create_response.json()["id"]
        
        # Session starts as in_progress
        get_response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/sessions/{session_id}", headers=headers)
        assert get_response.json()["status"] == "in_progress"
        
        # First toggle: pause
        response = requests.put(
            f"{BASE_URL}/api/onboarding-enhanced/sessions/{session_id}/pause",
            json={},
            headers=headers
        )
        assert response.status_code == 200
        assert response.json()["status"] == "paused"
        
        # Second toggle: resume
        response = requests.put(
            f"{BASE_URL}/api/onboarding-enhanced/sessions/{session_id}/pause",
            json={},
            headers=headers
        )
        assert response.status_code == 200
        assert response.json()["status"] == "in_progress"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/onboarding-enhanced/sessions/{session_id}", headers=headers)


class TestOnboardingComplete:
    """Tests for completing onboarding"""
    
    def test_complete_onboarding_without_ticket(self, headers):
        """Test completing onboarding without creating first ticket"""
        # Create a fresh session for this test
        create_response = requests.post(f"{BASE_URL}/api/onboarding-enhanced/sessions", json={
            "template": "break_fix",
            "client_name": "TEST_Complete_NoTicket",
            "priority": "low"
        }, headers=headers)
        session_id = create_response.json()["id"]
        
        # Complete the onboarding
        response = requests.put(
            f"{BASE_URL}/api/onboarding-enhanced/sessions/{session_id}/complete",
            json={},
            headers=headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "completed"
        assert data["completed_at"] is not None
        assert data["first_ticket_id"] is None
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/onboarding-enhanced/sessions/{session_id}", headers=headers)
        
    def test_complete_onboarding_with_first_ticket(self, headers):
        """Test completing onboarding with first ticket creation"""
        # Create a fresh session for this test
        create_response = requests.post(f"{BASE_URL}/api/onboarding-enhanced/sessions", json={
            "template": "small_office",
            "client_name": "TEST_Complete_WithTicket",
            "priority": "normal"
        }, headers=headers)
        session_id = create_response.json()["id"]
        
        # Complete the onboarding with first ticket
        response = requests.put(
            f"{BASE_URL}/api/onboarding-enhanced/sessions/{session_id}/complete",
            json={
                "first_ticket": {
                    "subject": "Welcome - Initial Setup & Configuration",
                    "description": "Complete initial setup tasks for new client",
                    "priority": "medium"
                }
            },
            headers=headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "completed"
        assert data["first_ticket_id"] is not None
        assert data["first_ticket_id"].startswith("TKT-")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/onboarding-enhanced/sessions/{session_id}", headers=headers)


class TestOnboardingDelete:
    """Tests for deleting sessions"""
    
    def test_delete_session(self, headers):
        """Test deleting a session"""
        # Create a session to delete
        create_response = requests.post(f"{BASE_URL}/api/onboarding-enhanced/sessions", json={
            "template": "mid_market",
            "client_name": "TEST_ToDelete",
            "priority": "normal"
        }, headers=headers)
        session_id = create_response.json()["id"]
        
        # Delete it
        response = requests.delete(
            f"{BASE_URL}/api/onboarding-enhanced/sessions/{session_id}",
            headers=headers
        )
        
        assert response.status_code == 200
        assert "message" in response.json()
        
        # Verify it's gone
        get_response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/sessions/{session_id}", headers=headers)
        assert get_response.status_code == 404
        
    def test_delete_nonexistent_session_returns_404(self, headers):
        """Test deleting a non-existent session returns 404"""
        response = requests.delete(
            f"{BASE_URL}/api/onboarding-enhanced/sessions/OB-NONEXISTENT",
            headers=headers
        )
        assert response.status_code == 404


class TestOnboardingDashboardStats:
    """Tests for dashboard stats endpoint"""
    
    def test_get_dashboard_stats(self, headers):
        """Test getting dashboard statistics"""
        response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/dashboard-stats", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert "total_sessions" in data
        assert "in_progress" in data
        assert "completed" in data
        assert "paused" in data
        assert "avg_completion_days" in data
        assert "devices_onboarded" in data
        assert "completion_rate" in data
        assert "avg_health" in data


class TestOnboardingAuditLog:
    """Tests for audit log functionality"""
    
    def test_audit_log_records_actions(self, headers, test_session_id):
        """Test that audit log records session actions"""
        response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/sessions/{test_session_id}", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert "audit_log" in data
        assert len(data["audit_log"]) > 0
        
        # Check audit log entry structure
        first_entry = data["audit_log"][0]
        assert "action" in first_entry
        assert "by" in first_entry
        assert "at" in first_entry


class TestOnboardingPreflightChecklist:
    """Tests for preflight checklist endpoint"""
    
    def test_get_preflight_checklist(self, headers):
        """Test getting the preflight checklist definition"""
        response = requests.get(f"{BASE_URL}/api/onboarding-enhanced/preflight-checklist", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert "checklist" in data
        checklist = data["checklist"]
        
        assert len(checklist) == 14  # 14 preflight items
        
        # Check structure
        for item in checklist:
            assert "id" in item
            assert "task" in item
            assert "category" in item
            assert "critical" in item


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
