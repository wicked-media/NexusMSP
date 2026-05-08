"""
Test iteration 152: Workspace module and Multi-device linking on tickets
- Workspace endpoints: GET /workspace, pin/unpin tickets, watch/unwatch devices, scratch notes
- Multi-device linking: POST/DELETE /tickets/{id}/devices
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

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
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def test_ticket(headers):
    """Create a test ticket for workspace/device tests"""
    # First get a client
    clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
    client_id = None
    if clients_resp.status_code == 200 and clients_resp.json():
        client_id = clients_resp.json()[0].get("id")
    
    ticket_data = {
        "title": f"TEST_Workspace_Ticket_{uuid.uuid4().hex[:8]}",
        "description": "Test ticket for workspace testing",
        "client_id": client_id,
        "priority": "medium",
        "category": "support"
    }
    response = requests.post(f"{BASE_URL}/api/tickets", json=ticket_data, headers=headers)
    assert response.status_code == 200, f"Failed to create test ticket: {response.text}"
    ticket = response.json()
    yield ticket
    # Cleanup
    requests.delete(f"{BASE_URL}/api/tickets/{ticket['id']}", headers=headers)


@pytest.fixture(scope="module")
def test_devices(headers):
    """Get existing devices for testing"""
    response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
    assert response.status_code == 200, f"Failed to get devices: {response.text}"
    devices = response.json()
    if len(devices) < 2:
        pytest.skip("Need at least 2 devices for multi-device tests")
    return devices[:3]  # Return up to 3 devices


class TestWorkspaceEndpoints:
    """Test workspace module endpoints"""
    
    def test_get_workspace(self, headers):
        """GET /api/workspace returns hydrated workspace data"""
        response = requests.get(f"{BASE_URL}/api/workspace", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify structure
        assert "workspace_id" in data, "Missing workspace_id"
        assert "user_id" in data, "Missing user_id"
        assert "pinned_tickets" in data, "Missing pinned_tickets"
        assert "watched_devices" in data, "Missing watched_devices"
        assert "scratch_notes" in data, "Missing scratch_notes"
        assert "recent_activity" in data, "Missing recent_activity"
        assert "my_open_tickets" in data, "Missing my_open_tickets"
        assert "stats" in data, "Missing stats"
        
        # Verify stats structure
        stats = data["stats"]
        assert "pinned_count" in stats, "Missing pinned_count in stats"
        assert "watched_count" in stats, "Missing watched_count in stats"
        assert "open_assigned" in stats, "Missing open_assigned in stats"
        assert "critical_assigned" in stats, "Missing critical_assigned in stats"
        
        print(f"Workspace loaded: {data['workspace_id']}, stats: {stats}")
    
    def test_pin_ticket(self, headers, test_ticket):
        """POST /api/workspace/pin/ticket/{ticket_id} pins a ticket"""
        ticket_id = test_ticket["id"]
        response = requests.post(f"{BASE_URL}/api/workspace/pin/ticket/{ticket_id}", json={}, headers=headers)
        assert response.status_code == 200, f"Failed to pin: {response.text}"
        data = response.json()
        assert data.get("pinned") == True, "Expected pinned=True"
        print(f"Pinned ticket {ticket_id}: {data}")
    
    def test_pin_ticket_idempotent(self, headers, test_ticket):
        """POST /api/workspace/pin/ticket/{ticket_id} is idempotent"""
        ticket_id = test_ticket["id"]
        # Pin again
        response = requests.post(f"{BASE_URL}/api/workspace/pin/ticket/{ticket_id}", json={}, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data.get("pinned") == True, "Expected pinned=True on re-pin"
        assert "Already pinned" in data.get("message", ""), "Expected 'Already pinned' message"
        print(f"Idempotent pin: {data}")
    
    def test_get_pin_status(self, headers, test_ticket):
        """GET /api/workspace/pin/ticket/{ticket_id}/status returns pinned status"""
        ticket_id = test_ticket["id"]
        response = requests.get(f"{BASE_URL}/api/workspace/pin/ticket/{ticket_id}/status", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "pinned" in data, "Missing 'pinned' field"
        assert data["pinned"] == True, "Expected pinned=True"
        print(f"Pin status for {ticket_id}: {data}")
    
    def test_unpin_ticket(self, headers, test_ticket):
        """DELETE /api/workspace/pin/ticket/{ticket_id} unpins a ticket"""
        ticket_id = test_ticket["id"]
        response = requests.delete(f"{BASE_URL}/api/workspace/pin/ticket/{ticket_id}", headers=headers)
        assert response.status_code == 200, f"Failed to unpin: {response.text}"
        data = response.json()
        assert data.get("pinned") == False, "Expected pinned=False"
        print(f"Unpinned ticket {ticket_id}: {data}")
        
        # Verify status
        status_resp = requests.get(f"{BASE_URL}/api/workspace/pin/ticket/{ticket_id}/status", headers=headers)
        assert status_resp.status_code == 200
        assert status_resp.json().get("pinned") == False, "Pin status should be False after unpin"
    
    def test_watch_device(self, headers, test_devices):
        """POST /api/workspace/watch/device/{device_id} watches a device"""
        device_id = test_devices[0]["id"]
        response = requests.post(f"{BASE_URL}/api/workspace/watch/device/{device_id}", json={}, headers=headers)
        assert response.status_code == 200, f"Failed to watch: {response.text}"
        data = response.json()
        assert data.get("watched") == True, "Expected watched=True"
        print(f"Watching device {device_id}: {data}")
    
    def test_watch_device_idempotent(self, headers, test_devices):
        """POST /api/workspace/watch/device/{device_id} is idempotent"""
        device_id = test_devices[0]["id"]
        response = requests.post(f"{BASE_URL}/api/workspace/watch/device/{device_id}", json={}, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data.get("watched") == True
        assert "Already watched" in data.get("message", ""), "Expected 'Already watched' message"
        print(f"Idempotent watch: {data}")
    
    def test_unwatch_device(self, headers, test_devices):
        """DELETE /api/workspace/watch/device/{device_id} unwatches a device"""
        device_id = test_devices[0]["id"]
        response = requests.delete(f"{BASE_URL}/api/workspace/watch/device/{device_id}", headers=headers)
        assert response.status_code == 200, f"Failed to unwatch: {response.text}"
        data = response.json()
        assert data.get("watched") == False, "Expected watched=False"
        print(f"Unwatched device {device_id}: {data}")
    
    def test_update_scratch_notes(self, headers):
        """PUT /api/workspace/scratch-notes updates scratchpad notes"""
        test_notes = f"Test notes from iteration 152 - {uuid.uuid4().hex[:8]}"
        response = requests.put(f"{BASE_URL}/api/workspace/scratch-notes", json={"notes": test_notes}, headers=headers)
        assert response.status_code == 200, f"Failed to save notes: {response.text}"
        data = response.json()
        assert data.get("message") == "Saved", "Expected 'Saved' message"
        
        # Verify notes persisted
        ws_resp = requests.get(f"{BASE_URL}/api/workspace", headers=headers)
        assert ws_resp.status_code == 200
        assert ws_resp.json().get("scratch_notes") == test_notes, "Notes not persisted"
        print(f"Scratch notes saved and verified: {test_notes[:30]}...")
    
    def test_workspace_hydrates_pinned_tickets(self, headers, test_ticket):
        """Verify workspace hydrates pinned ticket data"""
        ticket_id = test_ticket["id"]
        # Pin the ticket
        requests.post(f"{BASE_URL}/api/workspace/pin/ticket/{ticket_id}", json={}, headers=headers)
        
        # Get workspace
        response = requests.get(f"{BASE_URL}/api/workspace", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        pinned = data.get("pinned_tickets", [])
        found = next((t for t in pinned if t.get("id") == ticket_id), None)
        assert found is not None, f"Pinned ticket {ticket_id} not found in workspace"
        assert "ticket_number" in found, "Missing ticket_number in hydrated data"
        assert "title" in found, "Missing title in hydrated data"
        assert "pinned_at" in found, "Missing pinned_at timestamp"
        print(f"Hydrated pinned ticket: {found.get('ticket_number')} - {found.get('title')}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/workspace/pin/ticket/{ticket_id}", headers=headers)


class TestMultiDeviceLinking:
    """Test multi-device linking on tickets (Syncro-style)"""
    
    def test_link_device_to_ticket(self, headers, test_ticket, test_devices):
        """POST /api/tickets/{ticket_id}/devices links a device"""
        ticket_id = test_ticket["id"]
        device_id = test_devices[0]["id"]
        
        response = requests.post(
            f"{BASE_URL}/api/tickets/{ticket_id}/devices",
            json={"device_id": device_id},
            headers=headers
        )
        assert response.status_code == 200, f"Failed to link device: {response.text}"
        data = response.json()
        assert device_id in data.get("device_ids", []), "Device not in device_ids"
        assert len(data.get("device_names", [])) > 0, "device_names should be populated"
        print(f"Linked device {device_id}: {data}")
    
    def test_link_device_idempotent(self, headers, test_ticket, test_devices):
        """POST /api/tickets/{ticket_id}/devices is idempotent"""
        ticket_id = test_ticket["id"]
        device_id = test_devices[0]["id"]
        
        response = requests.post(
            f"{BASE_URL}/api/tickets/{ticket_id}/devices",
            json={"device_id": device_id},
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "already linked" in data.get("message", "").lower(), "Expected 'already linked' message"
        print(f"Idempotent link: {data}")
    
    def test_link_multiple_devices(self, headers, test_ticket, test_devices):
        """Can link multiple devices to a ticket"""
        ticket_id = test_ticket["id"]
        
        # Link second device
        device_id_2 = test_devices[1]["id"]
        response = requests.post(
            f"{BASE_URL}/api/tickets/{ticket_id}/devices",
            json={"device_id": device_id_2},
            headers=headers
        )
        assert response.status_code == 200, f"Failed to link second device: {response.text}"
        data = response.json()
        assert len(data.get("device_ids", [])) >= 2, "Should have at least 2 devices linked"
        print(f"Multiple devices linked: {data.get('device_ids')}")
    
    def test_primary_device_auto_set(self, headers):
        """Primary device_id is auto-set if previously empty"""
        # Create a new ticket without device
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        client_id = clients_resp.json()[0]["id"] if clients_resp.json() else None
        
        ticket_data = {
            "title": f"TEST_NoDevice_Ticket_{uuid.uuid4().hex[:8]}",
            "description": "Test ticket without device",
            "client_id": client_id,
            "priority": "low"
        }
        create_resp = requests.post(f"{BASE_URL}/api/tickets", json=ticket_data, headers=headers)
        assert create_resp.status_code == 200
        ticket = create_resp.json()
        ticket_id = ticket["id"]
        
        # Verify no primary device
        assert ticket.get("device_id") is None, "New ticket should have no device_id"
        
        # Get a device
        devices_resp = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        device_id = devices_resp.json()[0]["id"]
        
        # Link device
        link_resp = requests.post(
            f"{BASE_URL}/api/tickets/{ticket_id}/devices",
            json={"device_id": device_id},
            headers=headers
        )
        assert link_resp.status_code == 200
        
        # Verify primary was set
        get_resp = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}", headers=headers)
        assert get_resp.status_code == 200
        updated_ticket = get_resp.json()
        assert updated_ticket.get("device_id") == device_id, "Primary device_id should be auto-set"
        print(f"Primary device auto-set: {device_id}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tickets/{ticket_id}", headers=headers)
    
    def test_unlink_device(self, headers, test_ticket, test_devices):
        """DELETE /api/tickets/{ticket_id}/devices/{device_id} unlinks a device"""
        ticket_id = test_ticket["id"]
        device_id = test_devices[1]["id"]  # Unlink the second device
        
        response = requests.delete(
            f"{BASE_URL}/api/tickets/{ticket_id}/devices/{device_id}",
            headers=headers
        )
        assert response.status_code == 200, f"Failed to unlink: {response.text}"
        data = response.json()
        assert device_id not in data.get("device_ids", []), "Device should be removed from device_ids"
        print(f"Unlinked device {device_id}: {data}")
    
    def test_unlink_primary_promotes_next(self, headers, test_devices):
        """Unlinking primary device promotes next device to primary"""
        # Create ticket with multiple devices
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        client_id = clients_resp.json()[0]["id"] if clients_resp.json() else None
        
        ticket_data = {
            "title": f"TEST_MultiDevice_Ticket_{uuid.uuid4().hex[:8]}",
            "description": "Test ticket for primary promotion",
            "client_id": client_id,
            "device_id": test_devices[0]["id"],
            "priority": "medium"
        }
        create_resp = requests.post(f"{BASE_URL}/api/tickets", json=ticket_data, headers=headers)
        assert create_resp.status_code == 200
        ticket = create_resp.json()
        ticket_id = ticket["id"]
        
        # Link second device
        requests.post(
            f"{BASE_URL}/api/tickets/{ticket_id}/devices",
            json={"device_id": test_devices[1]["id"]},
            headers=headers
        )
        
        # Verify primary is first device
        get_resp = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}", headers=headers)
        assert get_resp.json().get("device_id") == test_devices[0]["id"]
        
        # Unlink primary
        unlink_resp = requests.delete(
            f"{BASE_URL}/api/tickets/{ticket_id}/devices/{test_devices[0]['id']}",
            headers=headers
        )
        assert unlink_resp.status_code == 200
        
        # Verify second device is now primary
        get_resp2 = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}", headers=headers)
        assert get_resp2.status_code == 200
        updated = get_resp2.json()
        assert updated.get("device_id") == test_devices[1]["id"], "Second device should be promoted to primary"
        print(f"Primary promoted from {test_devices[0]['id']} to {test_devices[1]['id']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tickets/{ticket_id}", headers=headers)
    
    def test_unlink_nonexistent_device_404(self, headers, test_ticket):
        """Unlinking a device not linked returns 404"""
        ticket_id = test_ticket["id"]
        fake_device_id = str(uuid.uuid4())
        
        response = requests.delete(
            f"{BASE_URL}/api/tickets/{ticket_id}/devices/{fake_device_id}",
            headers=headers
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"Correctly returned 404 for non-linked device")
    
    def test_link_nonexistent_device_404(self, headers, test_ticket):
        """Linking a nonexistent device returns 404"""
        ticket_id = test_ticket["id"]
        fake_device_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/tickets/{ticket_id}/devices",
            json={"device_id": fake_device_id},
            headers=headers
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"Correctly returned 404 for nonexistent device")


class TestExistingTicketFlows:
    """Verify existing ticket flows still work"""
    
    def test_get_tickets_list(self, headers):
        """GET /api/tickets returns list"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        tickets = response.json()
        assert isinstance(tickets, list), "Expected list of tickets"
        print(f"Got {len(tickets)} tickets")
    
    def test_get_ticket_detail(self, headers, test_ticket):
        """GET /api/tickets/{id} returns ticket detail"""
        response = requests.get(f"{BASE_URL}/api/tickets/{test_ticket['id']}", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        ticket = response.json()
        assert ticket.get("id") == test_ticket["id"]
        assert "device_ids" in ticket, "Ticket should have device_ids field"
        assert "device_names" in ticket, "Ticket should have device_names field"
        print(f"Ticket detail: {ticket.get('ticket_number')} - device_ids: {ticket.get('device_ids')}")
    
    def test_update_ticket(self, headers, test_ticket):
        """PUT /api/tickets/{id} updates ticket"""
        response = requests.put(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}",
            json={"priority": "high"},
            headers=headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        
        # Verify update
        get_resp = requests.get(f"{BASE_URL}/api/tickets/{test_ticket['id']}", headers=headers)
        assert get_resp.json().get("priority") == "high"
        print("Ticket update works")
    
    def test_ticket_comments(self, headers, test_ticket):
        """Ticket comments still work"""
        ticket_id = test_ticket["id"]
        
        # Add comment
        comment_resp = requests.post(
            f"{BASE_URL}/api/tickets/{ticket_id}/comments",
            json={"content": "Test comment from iteration 152"},
            headers=headers
        )
        assert comment_resp.status_code == 200, f"Failed to add comment: {comment_resp.text}"
        
        # Get comments
        get_resp = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}/comments", headers=headers)
        assert get_resp.status_code == 200
        comments = get_resp.json()
        assert len(comments) > 0, "Should have at least one comment"
        print(f"Comments work: {len(comments)} comments")
    
    def test_ticket_time_entries(self, headers, test_ticket):
        """Ticket time entries still work"""
        ticket_id = test_ticket["id"]
        
        # Add time entry
        time_resp = requests.post(
            f"{BASE_URL}/api/tickets/{ticket_id}/time-entries",
            json={"minutes": 15, "description": "Test time entry"},
            headers=headers
        )
        assert time_resp.status_code == 200, f"Failed to add time: {time_resp.text}"
        
        # Get time entries
        get_resp = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}/time-entries", headers=headers)
        assert get_resp.status_code == 200
        entries = get_resp.json()
        assert len(entries) > 0, "Should have at least one time entry"
        print(f"Time entries work: {len(entries)} entries")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
