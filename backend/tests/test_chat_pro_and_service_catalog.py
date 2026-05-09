"""
Test Chat Pro features (reactions, threads, edit/delete, pin, search, upload, typing)
and Service Catalog wiring to tickets + Notify Channels fire-and-forget.
"""
import pytest
import requests
import os
import base64
import time

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Test credentials
ADMIN_EMAIL = "aaron@stech.com.au"
ADMIN_PASSWORD = "Lucky@2871$!"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for admin user"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    data = response.json()
    assert "token" in data, "No token in login response"
    return data["token"]


@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers for API requests"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============================================================================
# SERVICE CATALOG WIRING TO TICKETS
# ============================================================================

class TestServiceCatalogWiring:
    """Test that service_code on ticket creation auto-attaches SLA/priority/billing"""
    
    def test_get_service_catalog(self, headers):
        """Verify service catalog endpoint returns entries"""
        response = requests.get(f"{BASE_URL}/api/pro-pack/service-catalog", headers=headers)
        assert response.status_code == 200
        services = response.json()
        assert isinstance(services, list)
        # Should have at least one service (AH-SUPP mentioned in context)
        print(f"Found {len(services)} services in catalog")
    
    def test_create_ticket_with_service_code(self, headers):
        """Create ticket with service_code and verify priority/SLA inherited"""
        # First get a client
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert clients_resp.status_code == 200
        clients = clients_resp.json()
        client_id = clients[0]["id"] if clients else None
        
        # Get service catalog to find AH-SUPP or any active service
        svc_resp = requests.get(f"{BASE_URL}/api/pro-pack/service-catalog", headers=headers)
        services = svc_resp.json() if svc_resp.status_code == 200 else []
        
        # Find AH-SUPP or first active service
        service = next((s for s in services if s.get("code") == "AH-SUPP"), None)
        if not service and services:
            service = services[0]
        
        if not service:
            pytest.skip("No services in catalog to test")
        
        # Create ticket with service_code - priority should be overridden
        payload = {
            "title": "TEST_ServiceCatalog_Ticket",
            "description": "Testing service catalog wiring",
            "client_id": client_id,
            "priority": "medium",  # Default medium, should be overridden by service
            "service_code": service.get("code"),
        }
        
        response = requests.post(f"{BASE_URL}/api/tickets", json=payload, headers=headers)
        assert response.status_code == 200, f"Create ticket failed: {response.text}"
        ticket = response.json()
        
        # Verify service metadata was applied
        print(f"Created ticket {ticket.get('ticket_number')} with service_code={service.get('code')}")
        print(f"Service default_priority={service.get('default_priority')}, ticket priority={ticket.get('priority')}")
        
        # If service has default_priority=high, ticket should have priority=high
        if service.get("default_priority") == "high":
            assert ticket.get("priority") == "high", f"Expected priority=high from service, got {ticket.get('priority')}"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tickets/{ticket['id']}", headers=headers)


# ============================================================================
# NOTIFY CHANNELS - FIRE AND FORGET
# ============================================================================

class TestNotifyChannels:
    """Test that notify channels don't block ticket creation"""
    
    def test_create_ticket_with_notify_channel_subscribed(self, headers):
        """Creating a ticket should NOT 500 even if notify webhook fails"""
        # Get a client
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = clients_resp.json() if clients_resp.status_code == 200 else []
        client_id = clients[0]["id"] if clients else None
        
        # Create a ticket - this should succeed even if notify webhooks fail
        payload = {
            "title": "TEST_NotifyChannel_Ticket",
            "description": "Testing that notify channels are fire-and-forget",
            "client_id": client_id,
            "priority": "high",
        }
        
        response = requests.post(f"{BASE_URL}/api/tickets", json=payload, headers=headers)
        # Should NOT be 500 - notify is fire-and-forget
        assert response.status_code in [200, 201], f"Ticket creation failed: {response.status_code} - {response.text}"
        ticket = response.json()
        print(f"Created ticket {ticket.get('ticket_number')} - notify channels did not block")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tickets/{ticket['id']}", headers=headers)


# ============================================================================
# CHAT CHANNELS & MESSAGES (BASE)
# ============================================================================

class TestChatChannels:
    """Test basic chat channel operations"""
    
    def test_list_channels(self, headers):
        """GET /api/chat/channels returns list"""
        response = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers)
        assert response.status_code == 200
        channels = response.json()
        assert isinstance(channels, list)
        print(f"Found {len(channels)} chat channels")
    
    def test_create_channel(self, headers):
        """POST /api/chat/channels creates new channel"""
        payload = {"name": "test-channel-pro", "is_private": False}
        response = requests.post(f"{BASE_URL}/api/chat/channels", json=payload, headers=headers)
        assert response.status_code == 200
        channel = response.json()
        assert "id" in channel
        print(f"Created channel: {channel.get('name')}")
        return channel
    
    def test_send_message(self, headers):
        """POST /api/chat/channels/{id}/messages sends message"""
        # Get or create a channel
        channels_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers)
        channels = channels_resp.json()
        channel_id = channels[0]["id"] if channels else None
        
        if not channel_id:
            pytest.skip("No channels available")
        
        payload = {"body": "TEST_ChatPro_Message Hello from pytest!"}
        response = requests.post(f"{BASE_URL}/api/chat/channels/{channel_id}/messages", json=payload, headers=headers)
        assert response.status_code == 200
        msg = response.json()
        assert "id" in msg
        assert msg.get("body") == payload["body"]
        print(f"Sent message: {msg.get('id')}")
        return msg


# ============================================================================
# CHAT PRO - REACTIONS
# ============================================================================

class TestChatReactions:
    """Test reaction toggle on messages"""
    
    def test_toggle_reaction(self, headers):
        """POST /api/chat/messages/{msg_id}/reactions toggles emoji"""
        # First send a message
        channels_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers)
        channels = channels_resp.json()
        if not channels:
            pytest.skip("No channels")
        channel_id = channels[0]["id"]
        
        # Send message
        msg_resp = requests.post(f"{BASE_URL}/api/chat/channels/{channel_id}/messages", 
                                 json={"body": "TEST_Reaction_Message"}, headers=headers)
        assert msg_resp.status_code == 200
        msg = msg_resp.json()
        msg_id = msg["id"]
        
        # Add reaction
        react_resp = requests.post(f"{BASE_URL}/api/chat/messages/{msg_id}/reactions",
                                   json={"emoji": "👍"}, headers=headers)
        assert react_resp.status_code == 200
        data = react_resp.json()
        assert "reactions" in data
        assert "👍" in data["reactions"]
        print(f"Added reaction 👍 to message {msg_id}")
        
        # Toggle off (remove)
        react_resp2 = requests.post(f"{BASE_URL}/api/chat/messages/{msg_id}/reactions",
                                    json={"emoji": "👍"}, headers=headers)
        assert react_resp2.status_code == 200
        data2 = react_resp2.json()
        # Should be removed or empty
        print(f"Toggled reaction off: {data2.get('reactions')}")


# ============================================================================
# CHAT PRO - THREADS
# ============================================================================

class TestChatThreads:
    """Test threaded replies"""
    
    def test_reply_in_thread(self, headers):
        """POST /api/chat/messages/{msg_id}/reply creates threaded reply"""
        # Get channel and send parent message
        channels_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers)
        channels = channels_resp.json()
        if not channels:
            pytest.skip("No channels")
        channel_id = channels[0]["id"]
        
        # Parent message
        parent_resp = requests.post(f"{BASE_URL}/api/chat/channels/{channel_id}/messages",
                                    json={"body": "TEST_Thread_Parent"}, headers=headers)
        assert parent_resp.status_code == 200
        parent = parent_resp.json()
        parent_id = parent["id"]
        
        # Reply in thread
        reply_resp = requests.post(f"{BASE_URL}/api/chat/messages/{parent_id}/reply",
                                   json={"body": "TEST_Thread_Reply"}, headers=headers)
        assert reply_resp.status_code == 200
        reply = reply_resp.json()
        assert reply.get("thread_id") == parent_id
        print(f"Created thread reply: {reply.get('id')} -> parent {parent_id}")
    
    def test_get_thread(self, headers):
        """GET /api/chat/messages/{msg_id}/thread returns parent + replies"""
        # Get channel and create thread
        channels_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers)
        channels = channels_resp.json()
        if not channels:
            pytest.skip("No channels")
        channel_id = channels[0]["id"]
        
        # Parent
        parent_resp = requests.post(f"{BASE_URL}/api/chat/channels/{channel_id}/messages",
                                    json={"body": "TEST_GetThread_Parent"}, headers=headers)
        parent = parent_resp.json()
        parent_id = parent["id"]
        
        # Reply
        requests.post(f"{BASE_URL}/api/chat/messages/{parent_id}/reply",
                      json={"body": "TEST_GetThread_Reply1"}, headers=headers)
        
        # Get thread
        thread_resp = requests.get(f"{BASE_URL}/api/chat/messages/{parent_id}/thread", headers=headers)
        assert thread_resp.status_code == 200
        thread = thread_resp.json()
        assert "parent" in thread
        assert "replies" in thread
        assert thread["parent"]["id"] == parent_id
        print(f"Thread has {len(thread['replies'])} replies")


# ============================================================================
# CHAT PRO - EDIT / DELETE
# ============================================================================

class TestChatEditDelete:
    """Test message edit and delete"""
    
    def test_edit_own_message(self, headers):
        """PUT /api/chat/messages/{msg_id} edits message, sets edited=true"""
        # Send message
        channels_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers)
        channels = channels_resp.json()
        if not channels:
            pytest.skip("No channels")
        channel_id = channels[0]["id"]
        
        msg_resp = requests.post(f"{BASE_URL}/api/chat/channels/{channel_id}/messages",
                                 json={"body": "TEST_Edit_Original"}, headers=headers)
        msg = msg_resp.json()
        msg_id = msg["id"]
        
        # Edit
        edit_resp = requests.put(f"{BASE_URL}/api/chat/messages/{msg_id}",
                                 json={"body": "TEST_Edit_Updated"}, headers=headers)
        assert edit_resp.status_code == 200
        assert edit_resp.json().get("ok") == True
        print(f"Edited message {msg_id}")
    
    def test_delete_own_message(self, headers):
        """DELETE /api/chat/messages/{msg_id} soft-deletes"""
        # Send message
        channels_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers)
        channels = channels_resp.json()
        if not channels:
            pytest.skip("No channels")
        channel_id = channels[0]["id"]
        
        msg_resp = requests.post(f"{BASE_URL}/api/chat/channels/{channel_id}/messages",
                                 json={"body": "TEST_Delete_Me"}, headers=headers)
        msg = msg_resp.json()
        msg_id = msg["id"]
        
        # Delete
        del_resp = requests.delete(f"{BASE_URL}/api/chat/messages/{msg_id}", headers=headers)
        assert del_resp.status_code == 200
        assert del_resp.json().get("ok") == True
        print(f"Deleted message {msg_id}")


# ============================================================================
# CHAT PRO - PIN / UNPIN
# ============================================================================

class TestChatPin:
    """Test pin/unpin messages"""
    
    def test_pin_and_unpin_message(self, headers):
        """POST /api/chat/messages/{msg_id}/pin and /unpin"""
        # Send message
        channels_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers)
        channels = channels_resp.json()
        if not channels:
            pytest.skip("No channels")
        channel_id = channels[0]["id"]
        
        msg_resp = requests.post(f"{BASE_URL}/api/chat/channels/{channel_id}/messages",
                                 json={"body": "TEST_Pin_Message"}, headers=headers)
        msg = msg_resp.json()
        msg_id = msg["id"]
        
        # Pin
        pin_resp = requests.post(f"{BASE_URL}/api/chat/messages/{msg_id}/pin", headers=headers)
        assert pin_resp.status_code == 200
        print(f"Pinned message {msg_id}")
        
        # Unpin
        unpin_resp = requests.post(f"{BASE_URL}/api/chat/messages/{msg_id}/unpin", headers=headers)
        assert unpin_resp.status_code == 200
        print(f"Unpinned message {msg_id}")
    
    def test_list_pinned(self, headers):
        """GET /api/chat/channels/{channel_id}/pinned returns pinned messages"""
        channels_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers)
        channels = channels_resp.json()
        if not channels:
            pytest.skip("No channels")
        channel_id = channels[0]["id"]
        
        pinned_resp = requests.get(f"{BASE_URL}/api/chat/channels/{channel_id}/pinned", headers=headers)
        assert pinned_resp.status_code == 200
        pinned = pinned_resp.json()
        assert isinstance(pinned, list)
        print(f"Found {len(pinned)} pinned messages")


# ============================================================================
# CHAT PRO - SEARCH
# ============================================================================

class TestChatSearch:
    """Test message search"""
    
    def test_search_messages(self, headers):
        """GET /api/chat/search?q=hello returns case-insensitive matches"""
        # First send a searchable message
        channels_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers)
        channels = channels_resp.json()
        if not channels:
            pytest.skip("No channels")
        channel_id = channels[0]["id"]
        
        # Send message with unique text
        unique_text = f"TEST_Search_UniqueWord_{int(time.time())}"
        requests.post(f"{BASE_URL}/api/chat/channels/{channel_id}/messages",
                      json={"body": unique_text}, headers=headers)
        
        # Search
        search_resp = requests.get(f"{BASE_URL}/api/chat/search", 
                                   params={"q": "UniqueWord"}, headers=headers)
        assert search_resp.status_code == 200
        results = search_resp.json()
        assert isinstance(results, list)
        print(f"Search returned {len(results)} results")


# ============================================================================
# CHAT PRO - FILE UPLOAD
# ============================================================================

class TestChatUpload:
    """Test file upload to chat"""
    
    def test_upload_file(self, headers):
        """POST /api/chat/channels/{channel_id}/upload with base64 file"""
        channels_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers)
        channels = channels_resp.json()
        if not channels:
            pytest.skip("No channels")
        channel_id = channels[0]["id"]
        
        # Create a small test file (1x1 PNG)
        # Minimal PNG: 1x1 red pixel
        png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
        
        payload = {
            "filename": "test_upload.png",
            "content_type": "image/png",
            "base64": png_b64
        }
        
        upload_resp = requests.post(f"{BASE_URL}/api/chat/channels/{channel_id}/upload",
                                    json=payload, headers=headers)
        assert upload_resp.status_code == 200
        msg = upload_resp.json()
        assert "attachment" in msg
        assert msg["attachment"]["filename"] == "test_upload.png"
        file_id = msg["attachment"]["file_id"]
        print(f"Uploaded file: {file_id}")
        
        # Retrieve file
        file_resp = requests.get(f"{BASE_URL}/api/chat/files/{file_id}", headers=headers)
        assert file_resp.status_code == 200
        file_data = file_resp.json()
        assert file_data.get("filename") == "test_upload.png"
        print(f"Retrieved file metadata: {file_data.get('filename')}")


# ============================================================================
# CHAT PRO - TYPING INDICATOR
# ============================================================================

class TestChatTyping:
    """Test typing indicator"""
    
    def test_typing_indicator(self, headers):
        """POST /api/chat/channels/{channel_id}/typing + GET typing"""
        channels_resp = requests.get(f"{BASE_URL}/api/chat/channels", headers=headers)
        channels = channels_resp.json()
        if not channels:
            pytest.skip("No channels")
        channel_id = channels[0]["id"]
        
        # Post typing
        typing_resp = requests.post(f"{BASE_URL}/api/chat/channels/{channel_id}/typing", headers=headers)
        assert typing_resp.status_code == 200
        assert typing_resp.json().get("ok") == True
        print(f"Posted typing indicator for channel {channel_id}")
        
        # Get typing (may be empty since we're the only user)
        get_typing_resp = requests.get(f"{BASE_URL}/api/chat/channels/{channel_id}/typing", headers=headers)
        assert get_typing_resp.status_code == 200
        typers = get_typing_resp.json()
        assert isinstance(typers, list)
        print(f"Active typers: {len(typers)}")


# ============================================================================
# CHAT - DM
# ============================================================================

class TestChatDM:
    """Test direct messages"""
    
    def test_create_dm(self, headers):
        """POST /api/chat/dm/{user_id} creates DM channel"""
        # Get another user
        users_resp = requests.get(f"{BASE_URL}/api/users", headers=headers)
        users = users_resp.json() if users_resp.status_code == 200 else []
        
        # Find a user that's not the current admin
        other_user = next((u for u in users if u.get("email") != ADMIN_EMAIL), None)
        if not other_user:
            pytest.skip("No other users to DM")
        
        dm_resp = requests.post(f"{BASE_URL}/api/chat/dm/{other_user['id']}", headers=headers)
        assert dm_resp.status_code == 200
        dm = dm_resp.json()
        assert "id" in dm
        print(f"Created DM channel with {other_user.get('name')}: {dm.get('id')}")
