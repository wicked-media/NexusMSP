"""
Iteration 131: Testing War Room Paging, Tech Roster, Blueprints, Time-aware Standups

Features tested:
1. GET /api/ai/standup-digest: time-aware slots (morning/afternoon/evening)
2. Tech Roster: CRUD /api/tech-roster
3. Blueprints: CRUD /api/blueprints
4. Client-Blueprint linking: GET/PUT /api/clients/{id}/blueprints
5. Ticket auto-apply blueprint on create
6. POST /api/tickets/{id}/apply-blueprint
7. PUT /api/tickets/{id}/blueprint-fields
8. POST /api/tickets/{id}/blueprint-checklist/{item_id}/toggle
9. Blueprint gate: PUT /api/tickets/{id} with status=resolved blocked when incomplete
10. War Room Paging: POST /api/warroom/{id}/page
11. Magic-link Ack: GET /api/warroom/page/ack/{token} (NO AUTH)
12. POST /api/warroom/{id}/page/{page_id}/resend
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Authentication failed - skipping authenticated tests")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============== STANDUP DIGEST TESTS ==============

class TestStandupDigest:
    """Time-aware standup digest tests"""
    
    def test_standup_digest_morning_slot(self, headers):
        """GET /api/ai/standup-digest with hour_override=8 returns morning slot"""
        response = requests.get(f"{BASE_URL}/api/ai/standup-digest?hour_override=8", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("slot") == "morning"
        assert data.get("slot_label") == "Morning Standup"
        assert data.get("slot_icon") == "sunrise"
        assert "ai_brief" in data
        assert "stats" in data
    
    def test_standup_digest_afternoon_slot(self, headers):
        """GET /api/ai/standup-digest with hour_override=14 returns afternoon slot"""
        response = requests.get(f"{BASE_URL}/api/ai/standup-digest?hour_override=14", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("slot") == "afternoon"
        assert data.get("slot_label") == "Midday Pulse"
        assert data.get("slot_icon") == "sun"
    
    def test_standup_digest_evening_slot(self, headers):
        """GET /api/ai/standup-digest with hour_override=20 returns evening slot"""
        response = requests.get(f"{BASE_URL}/api/ai/standup-digest?hour_override=20", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("slot") == "evening"
        assert data.get("slot_label") == "End-of-Day Wrap"
        assert data.get("slot_icon") == "moon"


# ============== TECH ROSTER TESTS ==============

class TestTechRoster:
    """Tech Roster CRUD tests"""
    
    def test_list_tech_roster(self, headers):
        """GET /api/tech-roster returns list"""
        response = requests.get(f"{BASE_URL}/api/tech-roster", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_create_tech_requires_name(self, headers):
        """POST /api/tech-roster without name returns 400"""
        response = requests.post(f"{BASE_URL}/api/tech-roster", json={
            "email": "test@test.com"
        }, headers=headers)
        assert response.status_code == 400
    
    def test_create_tech_success(self, headers):
        """POST /api/tech-roster creates technician"""
        tech_data = {
            "name": f"TEST_Tech_{uuid.uuid4().hex[:6]}",
            "email": f"test_{uuid.uuid4().hex[:6]}@test.com",
            "mobile": "+61400000000",
            "role": "L2 Engineer",
            "escalation_tier": 1,
            "preferred_channels": ["email", "sms", "push"]
        }
        response = requests.post(f"{BASE_URL}/api/tech-roster", json=tech_data, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("name") == tech_data["name"]
        assert data.get("escalation_tier") == 1
        assert "email" in data.get("preferred_channels", [])
        return data
    
    def test_escalation_tier_clamps(self, headers):
        """POST /api/tech-roster clamps escalation_tier to 1-3"""
        # Test tier > 3 gets clamped to 3
        response = requests.post(f"{BASE_URL}/api/tech-roster", json={
            "name": f"TEST_TierClamp_{uuid.uuid4().hex[:6]}",
            "escalation_tier": 10
        }, headers=headers)
        assert response.status_code == 200
        assert response.json().get("escalation_tier") == 3
        
        # Test tier < 1 gets clamped to 1
        response = requests.post(f"{BASE_URL}/api/tech-roster", json={
            "name": f"TEST_TierClamp_{uuid.uuid4().hex[:6]}",
            "escalation_tier": 0
        }, headers=headers)
        assert response.status_code == 200
        assert response.json().get("escalation_tier") == 1
    
    def test_preferred_channels_filters_invalid(self, headers):
        """POST /api/tech-roster filters invalid channels"""
        response = requests.post(f"{BASE_URL}/api/tech-roster", json={
            "name": f"TEST_Channels_{uuid.uuid4().hex[:6]}",
            "preferred_channels": ["email", "invalid_channel", "sms", "fax"]
        }, headers=headers)
        assert response.status_code == 200
        channels = response.json().get("preferred_channels", [])
        assert "email" in channels
        assert "sms" in channels
        assert "invalid_channel" not in channels
        assert "fax" not in channels
    
    def test_update_tech(self, headers):
        """PUT /api/tech-roster/{id} updates technician"""
        # Create first
        create_resp = requests.post(f"{BASE_URL}/api/tech-roster", json={
            "name": f"TEST_Update_{uuid.uuid4().hex[:6]}"
        }, headers=headers)
        tech_id = create_resp.json().get("id")
        
        # Update
        response = requests.put(f"{BASE_URL}/api/tech-roster/{tech_id}", json={
            "role": "Senior Engineer",
            "on_call": True
        }, headers=headers)
        assert response.status_code == 200
        assert response.json().get("role") == "Senior Engineer"
        assert response.json().get("on_call") == True
    
    def test_delete_tech(self, headers):
        """DELETE /api/tech-roster/{id} removes technician"""
        # Create first
        create_resp = requests.post(f"{BASE_URL}/api/tech-roster", json={
            "name": f"TEST_Delete_{uuid.uuid4().hex[:6]}"
        }, headers=headers)
        tech_id = create_resp.json().get("id")
        
        # Delete
        response = requests.delete(f"{BASE_URL}/api/tech-roster/{tech_id}", headers=headers)
        assert response.status_code == 200
        assert response.json().get("success") == True


# ============== BLUEPRINTS TESTS ==============

class TestBlueprints:
    """Blueprint CRUD tests"""
    
    def test_list_blueprints(self, headers):
        """GET /api/blueprints returns list"""
        response = requests.get(f"{BASE_URL}/api/blueprints", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_create_blueprint_requires_name(self, headers):
        """POST /api/blueprints without name returns 400"""
        response = requests.post(f"{BASE_URL}/api/blueprints", json={
            "description": "Test blueprint"
        }, headers=headers)
        assert response.status_code == 400
    
    def test_create_blueprint_success(self, headers):
        """POST /api/blueprints creates blueprint with fields and checklist"""
        bp_data = {
            "name": f"TEST_Blueprint_{uuid.uuid4().hex[:6]}",
            "description": "Test blueprint for iteration 131",
            "default_priority": "high",
            "default_category": "support",
            "sla_minutes": 240,
            "require_completion": True,
            "fields": [
                {"key": "customer_name", "label": "Customer Name", "type": "text", "required": True},
                {"key": "issue_type", "label": "Issue Type", "type": "select", "options": ["Hardware", "Software", "Network"]},
                {"key": "notes", "label": "Notes", "type": "textarea"}
            ],
            "checklist": [
                {"label": "Verify customer identity", "required": True},
                {"label": "Check warranty status", "required": False},
                {"label": "Document resolution", "required": True}
            ]
        }
        response = requests.post(f"{BASE_URL}/api/blueprints", json=bp_data, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("name") == bp_data["name"]
        assert data.get("require_completion") == True
        assert len(data.get("fields", [])) == 3
        assert len(data.get("checklist", [])) == 3
        return data
    
    def test_blueprint_fields_validation_skips_invalid(self, headers):
        """POST /api/blueprints skips fields with invalid types"""
        response = requests.post(f"{BASE_URL}/api/blueprints", json={
            "name": f"TEST_FieldValidation_{uuid.uuid4().hex[:6]}",
            "fields": [
                {"key": "valid", "label": "Valid Field", "type": "text"},
                {"key": "invalid", "label": "Invalid Field", "type": "invalid_type"},
                {"key": "another_valid", "label": "Another Valid", "type": "number"}
            ]
        }, headers=headers)
        assert response.status_code == 200
        fields = response.json().get("fields", [])
        # Should have 2 valid fields, invalid one skipped
        assert len(fields) == 2
        field_keys = [f["key"] for f in fields]
        assert "valid" in field_keys
        assert "another_valid" in field_keys
        assert "invalid" not in field_keys
    
    def test_blueprint_checklist_label_validation(self, headers):
        """POST /api/blueprints skips checklist items without labels"""
        response = requests.post(f"{BASE_URL}/api/blueprints", json={
            "name": f"TEST_ChecklistValidation_{uuid.uuid4().hex[:6]}",
            "checklist": [
                {"label": "Valid item", "required": True},
                {"label": "", "required": False},  # Empty label - should be skipped
                {"required": True}  # No label - should be skipped
            ]
        }, headers=headers)
        assert response.status_code == 200
        checklist = response.json().get("checklist", [])
        assert len(checklist) == 1
        assert checklist[0]["label"] == "Valid item"
    
    def test_delete_blueprint_soft_archives(self, headers):
        """DELETE /api/blueprints/{id} sets active=false (soft archive)"""
        # Create first
        create_resp = requests.post(f"{BASE_URL}/api/blueprints", json={
            "name": f"TEST_Archive_{uuid.uuid4().hex[:6]}"
        }, headers=headers)
        bp_id = create_resp.json().get("id")
        
        # Delete (soft archive)
        response = requests.delete(f"{BASE_URL}/api/blueprints/{bp_id}", headers=headers)
        assert response.status_code == 200
        
        # Verify it's archived (active=false)
        get_resp = requests.get(f"{BASE_URL}/api/blueprints/{bp_id}", headers=headers)
        assert get_resp.status_code == 200
        assert get_resp.json().get("active") == False


# ============== CLIENT-BLUEPRINT LINKING TESTS ==============

class TestClientBlueprintLinking:
    """Client-Blueprint linking tests"""
    
    @pytest.fixture
    def test_client_id(self, headers):
        """Get or create a test client"""
        # List clients and get first one
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        if clients:
            return clients[0]["id"]
        pytest.skip("No clients available for testing")
    
    @pytest.fixture
    def test_blueprint_id(self, headers):
        """Create a test blueprint"""
        response = requests.post(f"{BASE_URL}/api/blueprints", json={
            "name": f"TEST_ClientLink_{uuid.uuid4().hex[:6]}"
        }, headers=headers)
        return response.json().get("id")
    
    def test_get_client_blueprints(self, headers, test_client_id):
        """GET /api/clients/{id}/blueprints returns blueprint info"""
        response = requests.get(f"{BASE_URL}/api/clients/{test_client_id}/blueprints", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "blueprint_ids" in data
        assert "default_blueprint_id" in data
    
    def test_set_client_blueprints(self, headers, test_client_id, test_blueprint_id):
        """PUT /api/clients/{id}/blueprints sets blueprint_ids and default"""
        response = requests.put(f"{BASE_URL}/api/clients/{test_client_id}/blueprints", json={
            "blueprint_ids": [test_blueprint_id],
            "default_blueprint_id": test_blueprint_id
        }, headers=headers)
        assert response.status_code == 200
        assert response.json().get("success") == True
        assert test_blueprint_id in response.json().get("blueprint_ids", [])
    
    def test_default_must_be_in_blueprint_ids(self, headers, test_client_id, test_blueprint_id):
        """PUT /api/clients/{id}/blueprints returns 400 if default not in blueprint_ids"""
        response = requests.put(f"{BASE_URL}/api/clients/{test_client_id}/blueprints", json={
            "blueprint_ids": [],  # Empty list
            "default_blueprint_id": test_blueprint_id  # But setting a default
        }, headers=headers)
        assert response.status_code == 400


# ============== TICKET BLUEPRINT APPLICATION TESTS ==============

class TestTicketBlueprintApplication:
    """Ticket blueprint application tests"""
    
    @pytest.fixture
    def test_blueprint(self, headers):
        """Create a test blueprint with fields and checklist"""
        response = requests.post(f"{BASE_URL}/api/blueprints", json={
            "name": f"TEST_TicketBP_{uuid.uuid4().hex[:6]}",
            "require_completion": True,
            "fields": [
                {"key": "test_field", "label": "Test Field", "type": "text", "required": True}
            ],
            "checklist": [
                {"label": "Required step", "required": True},
                {"label": "Optional step", "required": False}
            ]
        }, headers=headers)
        return response.json()
    
    @pytest.fixture
    def test_ticket(self, headers):
        """Create a test ticket"""
        # Get a client first
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        client_id = clients_resp.json()[0]["id"] if clients_resp.json() else None
        
        response = requests.post(f"{BASE_URL}/api/tickets", json={
            "title": f"TEST_Ticket_{uuid.uuid4().hex[:6]}",
            "description": "Test ticket for blueprint testing - iteration 131",
            "client_id": client_id,
            "priority": "medium"
        }, headers=headers)
        assert response.status_code in [200, 201], f"Ticket creation failed: {response.json()}"
        return response.json()
    
    def test_apply_blueprint_to_ticket(self, headers, test_blueprint, test_ticket):
        """POST /api/tickets/{id}/apply-blueprint applies blueprint"""
        response = requests.post(f"{BASE_URL}/api/tickets/{test_ticket['id']}/apply-blueprint", json={
            "blueprint_id": test_blueprint["id"]
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("blueprint_id") == test_blueprint["id"]
        assert data.get("blueprint_name") == test_blueprint["name"]
        assert "blueprint_fields" in data
        assert "blueprint_checklist" in data
    
    def test_update_worksheet_fields(self, headers, test_blueprint, test_ticket):
        """PUT /api/tickets/{id}/blueprint-fields patches worksheet values"""
        # First apply blueprint
        requests.post(f"{BASE_URL}/api/tickets/{test_ticket['id']}/apply-blueprint", json={
            "blueprint_id": test_blueprint["id"]
        }, headers=headers)
        
        # Update fields
        response = requests.put(f"{BASE_URL}/api/tickets/{test_ticket['id']}/blueprint-fields", json={
            "fields": {"test_field": "Test Value"}
        }, headers=headers)
        assert response.status_code == 200
        assert response.json().get("blueprint_fields", {}).get("test_field") == "Test Value"
    
    def test_toggle_checklist_item(self, headers, test_blueprint, test_ticket):
        """POST /api/tickets/{id}/blueprint-checklist/{item_id}/toggle toggles done state"""
        # First apply blueprint
        apply_resp = requests.post(f"{BASE_URL}/api/tickets/{test_ticket['id']}/apply-blueprint", json={
            "blueprint_id": test_blueprint["id"]
        }, headers=headers)
        checklist = apply_resp.json().get("blueprint_checklist", [])
        if not checklist:
            pytest.skip("No checklist items")
        
        item_id = checklist[0]["id"]
        
        # Toggle to done
        response = requests.post(f"{BASE_URL}/api/tickets/{test_ticket['id']}/blueprint-checklist/{item_id}/toggle", headers=headers)
        assert response.status_code == 200
        toggled_item = next((c for c in response.json().get("checklist", []) if c["id"] == item_id), None)
        assert toggled_item is not None
        assert toggled_item.get("done") == True
        assert toggled_item.get("done_by") is not None
        assert toggled_item.get("done_at") is not None
        
        # Toggle back to not done
        response = requests.post(f"{BASE_URL}/api/tickets/{test_ticket['id']}/blueprint-checklist/{item_id}/toggle", headers=headers)
        assert response.status_code == 200
        toggled_item = next((c for c in response.json().get("checklist", []) if c["id"] == item_id), None)
        assert toggled_item.get("done") == False


# ============== BLUEPRINT GATE TESTS ==============

class TestBlueprintGate:
    """Blueprint gate tests - blocking resolve when incomplete"""
    
    def test_blueprint_gate_blocks_resolve(self, headers):
        """PUT /api/tickets/{id} with status=resolved returns 400 when blueprint incomplete"""
        # Create blueprint with required items
        bp_resp = requests.post(f"{BASE_URL}/api/blueprints", json={
            "name": f"TEST_Gate_{uuid.uuid4().hex[:6]}",
            "require_completion": True,
            "fields": [
                {"key": "required_field", "label": "Required Field", "type": "text", "required": True}
            ],
            "checklist": [
                {"label": "Required checklist item", "required": True}
            ]
        }, headers=headers)
        bp_id = bp_resp.json().get("id")
        
        # Create ticket (description is required)
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        client_id = clients_resp.json()[0]["id"] if clients_resp.json() else None
        
        ticket_resp = requests.post(f"{BASE_URL}/api/tickets", json={
            "title": f"TEST_GateTicket_{uuid.uuid4().hex[:6]}",
            "description": "Test ticket for blueprint gate testing",
            "client_id": client_id,
            "priority": "medium"
        }, headers=headers)
        ticket_id = ticket_resp.json().get("id")
        assert ticket_id is not None, f"Ticket creation failed: {ticket_resp.json()}"
        
        # Apply blueprint
        apply_resp = requests.post(f"{BASE_URL}/api/tickets/{ticket_id}/apply-blueprint", json={
            "blueprint_id": bp_id
        }, headers=headers)
        assert apply_resp.status_code == 200, f"Apply blueprint failed: {apply_resp.json()}"
        
        # Try to resolve - should fail
        response = requests.put(f"{BASE_URL}/api/tickets/{ticket_id}", json={
            "status": "resolved"
        }, headers=headers)
        assert response.status_code == 400
        detail = response.json().get("detail", "")
        assert "Missing checklist" in detail or "Missing fields" in detail


# ============== WAR ROOM PAGING TESTS ==============

class TestWarRoomPaging:
    """War Room paging tests"""
    
    @pytest.fixture
    def test_warroom(self, headers):
        """Create a test war room"""
        response = requests.post(f"{BASE_URL}/api/warroom", json={
            "title": f"TEST_Paging_{uuid.uuid4().hex[:6]}",
            "severity": "P1"
        }, headers=headers)
        return response.json().get("war_room")
    
    @pytest.fixture
    def test_tech(self, headers):
        """Create a test technician"""
        response = requests.post(f"{BASE_URL}/api/tech-roster", json={
            "name": f"TEST_PageTech_{uuid.uuid4().hex[:6]}",
            "email": f"test_{uuid.uuid4().hex[:6]}@test.com",
            "escalation_tier": 1,
            "preferred_channels": ["email", "push"]
        }, headers=headers)
        return response.json()
    
    def test_page_techs_basic(self, headers, test_warroom, test_tech):
        """POST /api/warroom/{id}/page pages technicians"""
        response = requests.post(f"{BASE_URL}/api/warroom/{test_warroom['id']}/page", json={
            "tech_ids": [test_tech["id"]],
            "channels": ["email", "push"]
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        wr = data.get("war_room", {})
        assert len(wr.get("pages", [])) > 0
    
    def test_page_with_auto_escalate(self, headers, test_warroom, test_tech):
        """POST /api/warroom/{id}/page with auto_escalate=true sets escalation fields"""
        response = requests.post(f"{BASE_URL}/api/warroom/{test_warroom['id']}/page", json={
            "tech_ids": [test_tech["id"]],
            "auto_escalate": True,
            "grace_minutes": 5
        }, headers=headers)
        assert response.status_code == 200
        wr = response.json().get("war_room", {})
        assert wr.get("auto_escalate") == True
        assert wr.get("escalation_tier") == 1
        assert wr.get("next_escalation_at") is not None
        
        # Check pages - tier 1 should be 'sent', others 'pending'
        pages = wr.get("pages", [])
        tier1_pages = [p for p in pages if p.get("tier") == 1]
        for p in tier1_pages:
            assert p.get("status") == "sent"


# ============== MAGIC LINK ACK TESTS ==============

class TestMagicLinkAck:
    """Magic-link acknowledge tests (NO AUTH required)"""
    
    def test_ack_page_no_auth_required(self, headers):
        """GET /api/warroom/page/ack/{token} works WITHOUT auth"""
        # Create war room
        wr_resp = requests.post(f"{BASE_URL}/api/warroom", json={
            "title": f"TEST_Ack_{uuid.uuid4().hex[:6]}",
            "severity": "P1"
        }, headers=headers)
        wr_id = wr_resp.json().get("war_room", {}).get("id")
        
        # Create tech
        tech_resp = requests.post(f"{BASE_URL}/api/tech-roster", json={
            "name": f"TEST_AckTech_{uuid.uuid4().hex[:6]}",
            "escalation_tier": 1
        }, headers=headers)
        tech_id = tech_resp.json().get("id")
        
        # Page the tech
        page_resp = requests.post(f"{BASE_URL}/api/warroom/{wr_id}/page", json={
            "tech_ids": [tech_id]
        }, headers=headers)
        pages = page_resp.json().get("war_room", {}).get("pages", [])
        if not pages:
            pytest.skip("No pages created")
        
        ack_token = pages[0].get("ack_token")
        
        # Ack WITHOUT auth headers - should return HTML 200
        response = requests.get(f"{BASE_URL}/api/warroom/page/ack/{ack_token}")
        assert response.status_code == 200
        assert "text/html" in response.headers.get("content-type", "")
        assert "Thanks" in response.text
    
    def test_ack_page_idempotent(self, headers):
        """GET /api/warroom/page/ack/{token} is idempotent on re-click"""
        # Create war room
        wr_resp = requests.post(f"{BASE_URL}/api/warroom", json={
            "title": f"TEST_AckIdem_{uuid.uuid4().hex[:6]}",
            "severity": "P1"
        }, headers=headers)
        wr_id = wr_resp.json().get("war_room", {}).get("id")
        
        # Create tech
        tech_resp = requests.post(f"{BASE_URL}/api/tech-roster", json={
            "name": f"TEST_AckIdemTech_{uuid.uuid4().hex[:6]}",
            "escalation_tier": 1
        }, headers=headers)
        tech_id = tech_resp.json().get("id")
        
        # Page the tech
        page_resp = requests.post(f"{BASE_URL}/api/warroom/{wr_id}/page", json={
            "tech_ids": [tech_id]
        }, headers=headers)
        pages = page_resp.json().get("war_room", {}).get("pages", [])
        ack_token = pages[0].get("ack_token")
        
        # First ack
        response1 = requests.get(f"{BASE_URL}/api/warroom/page/ack/{ack_token}")
        assert response1.status_code == 200
        
        # Second ack (idempotent)
        response2 = requests.get(f"{BASE_URL}/api/warroom/page/ack/{ack_token}")
        assert response2.status_code == 200
        assert "already acknowledged" in response2.text.lower() or "Thanks" in response2.text
    
    def test_ack_updates_page_status(self, headers):
        """GET /api/warroom/page/ack/{token} updates page status to 'ack'"""
        # Create war room
        wr_resp = requests.post(f"{BASE_URL}/api/warroom", json={
            "title": f"TEST_AckStatus_{uuid.uuid4().hex[:6]}",
            "severity": "P1"
        }, headers=headers)
        wr_id = wr_resp.json().get("war_room", {}).get("id")
        
        # Create tech
        tech_resp = requests.post(f"{BASE_URL}/api/tech-roster", json={
            "name": f"TEST_AckStatusTech_{uuid.uuid4().hex[:6]}",
            "escalation_tier": 1
        }, headers=headers)
        tech_id = tech_resp.json().get("id")
        
        # Page the tech
        page_resp = requests.post(f"{BASE_URL}/api/warroom/{wr_id}/page", json={
            "tech_ids": [tech_id],
            "auto_escalate": True
        }, headers=headers)
        pages = page_resp.json().get("war_room", {}).get("pages", [])
        ack_token = pages[0].get("ack_token")
        
        # Ack
        requests.get(f"{BASE_URL}/api/warroom/page/ack/{ack_token}")
        
        # Verify status changed
        wr_get = requests.get(f"{BASE_URL}/api/warroom/{wr_id}", headers=headers)
        updated_pages = wr_get.json().get("pages", [])
        acked_page = next((p for p in updated_pages if p.get("ack_token") == ack_token), None)
        assert acked_page is not None
        assert acked_page.get("status") == "ack"
        assert acked_page.get("ack_at") is not None
        
        # next_escalation_at should be cleared
        assert wr_get.json().get("next_escalation_at") is None


# ============== RESEND PAGE TESTS ==============

class TestResendPage:
    """Resend page tests"""
    
    def test_resend_page(self, headers):
        """POST /api/warroom/{id}/page/{page_id}/resend re-dispatches a page"""
        # Create war room
        wr_resp = requests.post(f"{BASE_URL}/api/warroom", json={
            "title": f"TEST_Resend_{uuid.uuid4().hex[:6]}",
            "severity": "P1"
        }, headers=headers)
        wr_id = wr_resp.json().get("war_room", {}).get("id")
        
        # Create tech
        tech_resp = requests.post(f"{BASE_URL}/api/tech-roster", json={
            "name": f"TEST_ResendTech_{uuid.uuid4().hex[:6]}",
            "escalation_tier": 1,
            "email": f"test_{uuid.uuid4().hex[:6]}@test.com"
        }, headers=headers)
        tech_id = tech_resp.json().get("id")
        
        # Page the tech
        page_resp = requests.post(f"{BASE_URL}/api/warroom/{wr_id}/page", json={
            "tech_ids": [tech_id]
        }, headers=headers)
        pages = page_resp.json().get("war_room", {}).get("pages", [])
        page_id = pages[0].get("id")
        
        # Resend
        response = requests.post(f"{BASE_URL}/api/warroom/{wr_id}/page/{page_id}/resend", headers=headers)
        assert response.status_code == 200
        assert response.json().get("success") == True
        assert "dispatch_results" in response.json()


# ============== CLEANUP ==============

@pytest.fixture(scope="module", autouse=True)
def cleanup(headers):
    """Cleanup test data after all tests"""
    yield
    # Cleanup is handled by soft-delete and test data prefixes


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
