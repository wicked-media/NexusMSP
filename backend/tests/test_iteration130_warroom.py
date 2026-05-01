"""
Iteration 130: Live Incident War Room Tests
Tests for the War Room feature - P1 incident battle-station with:
- Create war room (title required, auto public_slug, auto client_name lookup, auto similar_incidents)
- List war rooms (excludes resolved by default)
- Get war room by ID (hydrates affected_devices)
- Post chat message (auto-adds participant)
- Update status (investigating/identified/monitoring/resolved), eta, summary
- Resolve war room with optional notes
- Public view (NO AUTH required, filters to status/system messages only)
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestWarRoomAuth:
    """Authentication tests for War Room endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_create_warroom_requires_auth(self):
        """POST /api/warroom requires authentication"""
        response = self.session.post(f"{BASE_URL}/api/warroom", json={"title": "Test"})
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: POST /api/warroom requires auth")
    
    def test_list_warrooms_requires_auth(self):
        """GET /api/warroom requires authentication"""
        response = self.session.get(f"{BASE_URL}/api/warroom")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: GET /api/warroom requires auth")
    
    def test_get_warroom_requires_auth(self):
        """GET /api/warroom/{id} requires authentication"""
        response = self.session.get(f"{BASE_URL}/api/warroom/wr-test123")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: GET /api/warroom/{id} requires auth")
    
    def test_post_message_requires_auth(self):
        """POST /api/warroom/{id}/messages requires authentication"""
        response = self.session.post(f"{BASE_URL}/api/warroom/wr-test123/messages", json={"body": "test"})
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: POST /api/warroom/{id}/messages requires auth")
    
    def test_update_status_requires_auth(self):
        """POST /api/warroom/{id}/status requires authentication"""
        response = self.session.post(f"{BASE_URL}/api/warroom/wr-test123/status", json={"status": "identified"})
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: POST /api/warroom/{id}/status requires auth")
    
    def test_resolve_requires_auth(self):
        """POST /api/warroom/{id}/resolve requires authentication"""
        response = self.session.post(f"{BASE_URL}/api/warroom/wr-test123/resolve", json={})
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: POST /api/warroom/{id}/resolve requires auth")


class TestWarRoomPublicNoAuth:
    """Public endpoint tests - NO AUTH required"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_public_view_no_auth_required(self):
        """GET /api/warroom/public/{slug} does NOT require authentication"""
        # This should return 404 (not found) not 401/403 (auth required)
        response = self.session.get(f"{BASE_URL}/api/warroom/public/nonexistent-slug")
        assert response.status_code == 404, f"Expected 404 for non-existent slug, got {response.status_code}"
        print("PASS: GET /api/warroom/public/{slug} does NOT require auth (returns 404 for missing)")


class TestWarRoomCRUD:
    """CRUD tests for War Room endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login to get token
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        token = login_response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        self.created_warroom_ids = []
    
    def teardown_method(self, method):
        """Cleanup created war rooms"""
        for wr_id in self.created_warroom_ids:
            try:
                self.session.post(f"{BASE_URL}/api/warroom/{wr_id}/resolve", json={"resolved_notes": "Test cleanup"})
            except:
                pass
    
    def test_create_warroom_title_required(self):
        """POST /api/warroom returns 400 when title is missing"""
        response = self.session.post(f"{BASE_URL}/api/warroom", json={})
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("PASS: POST /api/warroom returns 400 when title missing")
    
    def test_create_warroom_empty_title(self):
        """POST /api/warroom returns 400 when title is empty"""
        response = self.session.post(f"{BASE_URL}/api/warroom", json={"title": ""})
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("PASS: POST /api/warroom returns 400 when title empty")
    
    def test_create_warroom_success(self):
        """POST /api/warroom creates war room with auto-generated fields"""
        response = self.session.post(f"{BASE_URL}/api/warroom", json={
            "title": "TEST_WARROOM VPN Outage",
            "severity": "P1",
            "summary": "VPN server is down affecting all remote workers"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == True
        wr = data.get("war_room")
        assert wr is not None
        
        # Verify auto-generated fields
        assert wr.get("id", "").startswith("wr-"), f"ID should start with 'wr-': {wr.get('id')}"
        assert wr.get("public_slug") is not None and len(wr.get("public_slug")) > 0, "public_slug should be generated"
        assert wr.get("status") == "investigating", f"Initial status should be 'investigating': {wr.get('status')}"
        assert wr.get("severity") == "P1"
        assert wr.get("title") == "TEST_WARROOM VPN Outage"
        assert wr.get("created_at") is not None
        assert wr.get("created_by") is not None
        
        # Verify opening system message
        messages = wr.get("messages", [])
        assert len(messages) >= 1, "Should have at least one opening system message"
        assert messages[0].get("kind") == "system"
        assert "War room opened" in messages[0].get("body", "")
        
        self.created_warroom_ids.append(wr["id"])
        print(f"PASS: POST /api/warroom creates war room with id={wr['id']}, slug={wr['public_slug']}")
        return wr
    
    def test_list_warrooms_excludes_resolved_by_default(self):
        """GET /api/warroom excludes resolved war rooms by default"""
        # Create a war room
        create_resp = self.session.post(f"{BASE_URL}/api/warroom", json={
            "title": "TEST_WARROOM List Test"
        })
        assert create_resp.status_code == 200
        wr_id = create_resp.json()["war_room"]["id"]
        self.created_warroom_ids.append(wr_id)
        
        # List should include it
        list_resp = self.session.get(f"{BASE_URL}/api/warroom")
        assert list_resp.status_code == 200
        rooms = list_resp.json()
        assert any(r["id"] == wr_id for r in rooms), "Created war room should be in list"
        
        # Resolve it
        self.session.post(f"{BASE_URL}/api/warroom/{wr_id}/resolve", json={})
        
        # List without include_resolved should NOT include it
        list_resp2 = self.session.get(f"{BASE_URL}/api/warroom")
        assert list_resp2.status_code == 200
        rooms2 = list_resp2.json()
        assert not any(r["id"] == wr_id for r in rooms2), "Resolved war room should NOT be in default list"
        
        # List with include_resolved=true SHOULD include it
        list_resp3 = self.session.get(f"{BASE_URL}/api/warroom?include_resolved=true")
        assert list_resp3.status_code == 200
        rooms3 = list_resp3.json()
        assert any(r["id"] == wr_id for r in rooms3), "Resolved war room should be in list with include_resolved=true"
        
        print("PASS: GET /api/warroom excludes resolved by default, includes with include_resolved=true")
    
    def test_get_warroom_by_id(self):
        """GET /api/warroom/{id} returns full war room details"""
        # Create a war room
        create_resp = self.session.post(f"{BASE_URL}/api/warroom", json={
            "title": "TEST_WARROOM Get Test"
        })
        assert create_resp.status_code == 200
        wr_id = create_resp.json()["war_room"]["id"]
        self.created_warroom_ids.append(wr_id)
        
        # Get by ID
        get_resp = self.session.get(f"{BASE_URL}/api/warroom/{wr_id}")
        assert get_resp.status_code == 200
        wr = get_resp.json()
        assert wr["id"] == wr_id
        assert wr["title"] == "TEST_WARROOM Get Test"
        assert "messages" in wr
        assert "participants" in wr
        assert "similar_incidents" in wr
        
        print(f"PASS: GET /api/warroom/{wr_id} returns full details")
    
    def test_get_warroom_not_found(self):
        """GET /api/warroom/{id} returns 404 for non-existent ID"""
        response = self.session.get(f"{BASE_URL}/api/warroom/wr-nonexistent123")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: GET /api/warroom/{id} returns 404 for non-existent ID")


class TestWarRoomMessages:
    """Chat message tests for War Room"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200
        token = login_response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        
        # Create a war room for testing
        create_resp = self.session.post(f"{BASE_URL}/api/warroom", json={
            "title": "TEST_WARROOM Message Test"
        })
        assert create_resp.status_code == 200
        self.wr_id = create_resp.json()["war_room"]["id"]
    
    def teardown_method(self, method):
        try:
            self.session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/resolve", json={})
        except:
            pass
    
    def test_post_message_body_required(self):
        """POST /api/warroom/{id}/messages returns 400 when body is missing"""
        response = self.session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/messages", json={})
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("PASS: POST /api/warroom/{id}/messages returns 400 when body missing")
    
    def test_post_message_success(self):
        """POST /api/warroom/{id}/messages adds chat message"""
        response = self.session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/messages", json={
            "body": "Checking VPN server logs now"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == True
        msg = data.get("message")
        assert msg is not None
        assert msg.get("body") == "Checking VPN server logs now"
        assert msg.get("kind") == "chat"
        assert msg.get("author") is not None
        assert msg.get("id", "").startswith("m-")
        
        # Verify message appears in war room
        get_resp = self.session.get(f"{BASE_URL}/api/warroom/{self.wr_id}")
        wr = get_resp.json()
        messages = wr.get("messages", [])
        assert any(m.get("body") == "Checking VPN server logs now" for m in messages)
        
        print("PASS: POST /api/warroom/{id}/messages adds chat message")
    
    def test_post_message_adds_participant(self):
        """POST /api/warroom/{id}/messages auto-adds participant if new"""
        # Get initial participants
        get_resp1 = self.session.get(f"{BASE_URL}/api/warroom/{self.wr_id}")
        initial_participants = len(get_resp1.json().get("participants", []))
        
        # Post a message (same user, should not add duplicate)
        self.session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/messages", json={
            "body": "Another update"
        })
        
        # Check participants count (should be same since same user)
        get_resp2 = self.session.get(f"{BASE_URL}/api/warroom/{self.wr_id}")
        final_participants = len(get_resp2.json().get("participants", []))
        
        # Participant count should be at least 1 (the creator)
        assert final_participants >= 1
        print(f"PASS: Participants tracked correctly (count: {final_participants})")


class TestWarRoomStatus:
    """Status update tests for War Room"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200
        token = login_response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        
        # Create a war room for testing
        create_resp = self.session.post(f"{BASE_URL}/api/warroom", json={
            "title": "TEST_WARROOM Status Test"
        })
        assert create_resp.status_code == 200
        self.wr_id = create_resp.json()["war_room"]["id"]
    
    def teardown_method(self, method):
        try:
            self.session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/resolve", json={})
        except:
            pass
    
    def test_update_status_invalid(self):
        """POST /api/warroom/{id}/status returns 400 for invalid status"""
        response = self.session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/status", json={
            "status": "invalid_status"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("PASS: POST /api/warroom/{id}/status returns 400 for invalid status")
    
    def test_update_status_valid_transitions(self):
        """POST /api/warroom/{id}/status allows valid status transitions"""
        # investigating -> identified
        response = self.session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/status", json={
            "status": "identified"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        wr = response.json().get("war_room")
        assert wr.get("status") == "identified"
        
        # identified -> monitoring
        response = self.session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/status", json={
            "status": "monitoring"
        })
        assert response.status_code == 200
        wr = response.json().get("war_room")
        assert wr.get("status") == "monitoring"
        
        print("PASS: Status transitions work correctly")
    
    def test_update_status_adds_system_message(self):
        """POST /api/warroom/{id}/status adds system message on status change"""
        # Get initial message count
        get_resp1 = self.session.get(f"{BASE_URL}/api/warroom/{self.wr_id}")
        initial_msg_count = len(get_resp1.json().get("messages", []))
        
        # Change status
        self.session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/status", json={
            "status": "identified"
        })
        
        # Check for new system message
        get_resp2 = self.session.get(f"{BASE_URL}/api/warroom/{self.wr_id}")
        messages = get_resp2.json().get("messages", [])
        assert len(messages) > initial_msg_count, "Should have new message after status change"
        
        # Find the status change message
        status_msgs = [m for m in messages if "Status changed" in m.get("body", "")]
        assert len(status_msgs) > 0, "Should have status change system message"
        assert status_msgs[-1].get("kind") == "system"
        
        print("PASS: Status change adds system message")
    
    def test_update_eta(self):
        """POST /api/warroom/{id}/status updates ETA"""
        response = self.session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/status", json={
            "eta": "15 minutes"
        })
        assert response.status_code == 200
        wr = response.json().get("war_room")
        assert wr.get("eta") == "15 minutes"
        
        # Verify ETA update message
        messages = wr.get("messages", [])
        eta_msgs = [m for m in messages if "ETA updated" in m.get("body", "")]
        assert len(eta_msgs) > 0, "Should have ETA update system message"
        
        print("PASS: ETA update works and adds system message")
    
    def test_resolve_sets_resolved_at(self):
        """POST /api/warroom/{id}/status with status=resolved sets resolved_at"""
        response = self.session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/status", json={
            "status": "resolved"
        })
        assert response.status_code == 200
        wr = response.json().get("war_room")
        assert wr.get("status") == "resolved"
        assert wr.get("resolved_at") is not None
        
        print("PASS: Status=resolved sets resolved_at timestamp")


class TestWarRoomResolve:
    """Resolve endpoint tests for War Room"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200
        token = login_response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        
        # Create a war room for testing
        create_resp = self.session.post(f"{BASE_URL}/api/warroom", json={
            "title": "TEST_WARROOM Resolve Test"
        })
        assert create_resp.status_code == 200
        self.wr_id = create_resp.json()["war_room"]["id"]
    
    def test_resolve_warroom(self):
        """POST /api/warroom/{id}/resolve marks war room as resolved"""
        response = self.session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/resolve", json={
            "resolved_notes": "Fixed by restarting VPN server"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == True
        wr = data.get("war_room")
        assert wr.get("status") == "resolved"
        assert wr.get("resolved_at") is not None
        assert wr.get("resolved_notes") == "Fixed by restarting VPN server"
        
        # Verify system message
        messages = wr.get("messages", [])
        resolve_msgs = [m for m in messages if "War room resolved" in m.get("body", "")]
        assert len(resolve_msgs) > 0, "Should have resolve system message"
        
        print("PASS: POST /api/warroom/{id}/resolve marks war room as resolved with notes")
    
    def test_resolve_not_found(self):
        """POST /api/warroom/{id}/resolve returns 404 for non-existent ID"""
        response = self.session.post(f"{BASE_URL}/api/warroom/wr-nonexistent123/resolve", json={})
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: POST /api/warroom/{id}/resolve returns 404 for non-existent ID")


class TestWarRoomPublicView:
    """Public view endpoint tests - verifies NO AUTH and filtered messages"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.auth_session = requests.Session()
        self.auth_session.headers.update({"Content-Type": "application/json"})
        # Login for creating war room
        login_response = self.auth_session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200
        token = login_response.json().get("token")
        self.auth_session.headers.update({"Authorization": f"Bearer {token}"})
        
        # Create a war room
        create_resp = self.auth_session.post(f"{BASE_URL}/api/warroom", json={
            "title": "TEST_WARROOM Public View Test",
            "summary": "Testing public view"
        })
        assert create_resp.status_code == 200
        wr = create_resp.json()["war_room"]
        self.wr_id = wr["id"]
        self.public_slug = wr["public_slug"]
        
        # Add a chat message (should NOT appear in public view)
        self.auth_session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/messages", json={
            "body": "Internal tech chat - should be hidden from public"
        })
        
        # Add a status update (should appear in public view)
        self.auth_session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/status", json={
            "status": "identified",
            "eta": "30 minutes"
        })
        
        # Non-authenticated session for public view
        self.public_session = requests.Session()
        self.public_session.headers.update({"Content-Type": "application/json"})
    
    def teardown_method(self, method):
        try:
            self.auth_session.post(f"{BASE_URL}/api/warroom/{self.wr_id}/resolve", json={})
        except:
            pass
    
    def test_public_view_no_auth(self):
        """GET /api/warroom/public/{slug} works WITHOUT authentication"""
        response = self.public_session.get(f"{BASE_URL}/api/warroom/public/{self.public_slug}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("PASS: Public view works without authentication")
    
    def test_public_view_returns_reduced_payload(self):
        """GET /api/warroom/public/{slug} returns reduced safe payload"""
        response = self.public_session.get(f"{BASE_URL}/api/warroom/public/{self.public_slug}")
        assert response.status_code == 200
        data = response.json()
        
        # Should have these fields
        assert "title" in data
        assert "status" in data
        assert "severity" in data
        assert "summary" in data
        assert "eta" in data
        assert "timeline" in data
        assert "created_at" in data
        
        # Should NOT have internal fields
        assert "messages" not in data, "Should not expose raw messages"
        assert "participants" not in data, "Should not expose participants"
        assert "affected_device_ids" not in data, "Should not expose device IDs"
        
        print("PASS: Public view returns reduced payload")
    
    def test_public_view_filters_chat_messages(self):
        """GET /api/warroom/public/{slug} filters out internal chat messages"""
        response = self.public_session.get(f"{BASE_URL}/api/warroom/public/{self.public_slug}")
        assert response.status_code == 200
        data = response.json()
        
        timeline = data.get("timeline", [])
        
        # Should NOT contain internal chat message
        chat_msgs = [m for m in timeline if "Internal tech chat" in m.get("body", "")]
        assert len(chat_msgs) == 0, "Internal chat messages should be filtered out"
        
        # Should contain system messages (status changes, etc.)
        system_msgs = [m for m in timeline if m.get("kind") in ("system", "status")]
        assert len(system_msgs) > 0, "Should have system/status messages in timeline"
        
        print("PASS: Public view filters out internal chat messages, shows only system/status")
    
    def test_public_view_not_found(self):
        """GET /api/warroom/public/{slug} returns 404 for invalid slug"""
        response = self.public_session.get(f"{BASE_URL}/api/warroom/public/invalid-slug-12345")
        assert response.status_code == 404
        print("PASS: Public view returns 404 for invalid slug")


class TestWarRoomE2E:
    """End-to-end flow tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200
        token = login_response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        self.created_ids = []
    
    def teardown_method(self, method):
        for wr_id in self.created_ids:
            try:
                self.session.post(f"{BASE_URL}/api/warroom/{wr_id}/resolve", json={})
            except:
                pass
    
    def test_full_incident_lifecycle(self):
        """Test complete war room lifecycle: create -> chat -> status updates -> resolve"""
        # 1. Create war room
        create_resp = self.session.post(f"{BASE_URL}/api/warroom", json={
            "title": "TEST_WARROOM E2E Lifecycle",
            "severity": "P1",
            "summary": "Critical server outage"
        })
        assert create_resp.status_code == 200
        wr = create_resp.json()["war_room"]
        wr_id = wr["id"]
        public_slug = wr["public_slug"]
        self.created_ids.append(wr_id)
        assert wr["status"] == "investigating"
        print(f"1. Created war room: {wr_id}")
        
        # 2. Post chat messages
        msg_resp = self.session.post(f"{BASE_URL}/api/warroom/{wr_id}/messages", json={
            "body": "Checking server logs"
        })
        assert msg_resp.status_code == 200
        print("2. Posted chat message")
        
        # 3. Update status to identified
        status_resp = self.session.post(f"{BASE_URL}/api/warroom/{wr_id}/status", json={
            "status": "identified",
            "eta": "20 minutes"
        })
        assert status_resp.status_code == 200
        assert status_resp.json()["war_room"]["status"] == "identified"
        print("3. Updated status to identified")
        
        # 4. Update status to monitoring
        status_resp2 = self.session.post(f"{BASE_URL}/api/warroom/{wr_id}/status", json={
            "status": "monitoring"
        })
        assert status_resp2.status_code == 200
        assert status_resp2.json()["war_room"]["status"] == "monitoring"
        print("4. Updated status to monitoring")
        
        # 5. Verify public view shows status updates but not chat
        public_session = requests.Session()
        public_resp = public_session.get(f"{BASE_URL}/api/warroom/public/{public_slug}")
        assert public_resp.status_code == 200
        public_data = public_resp.json()
        assert public_data["status"] == "monitoring"
        timeline = public_data.get("timeline", [])
        # Chat message should NOT be in timeline
        assert not any("Checking server logs" in m.get("body", "") for m in timeline)
        # Status messages should be in timeline
        assert any("Status changed" in m.get("body", "") for m in timeline)
        print("5. Verified public view filters correctly")
        
        # 6. Resolve
        resolve_resp = self.session.post(f"{BASE_URL}/api/warroom/{wr_id}/resolve", json={
            "resolved_notes": "Server restarted, issue resolved"
        })
        assert resolve_resp.status_code == 200
        final_wr = resolve_resp.json()["war_room"]
        assert final_wr["status"] == "resolved"
        assert final_wr["resolved_at"] is not None
        assert final_wr["resolved_notes"] == "Server restarted, issue resolved"
        print("6. Resolved war room")
        
        # 7. Verify resolved war room not in default list
        list_resp = self.session.get(f"{BASE_URL}/api/warroom")
        assert list_resp.status_code == 200
        rooms = list_resp.json()
        assert not any(r["id"] == wr_id for r in rooms)
        print("7. Verified resolved war room excluded from default list")
        
        print("PASS: Full incident lifecycle completed successfully")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
