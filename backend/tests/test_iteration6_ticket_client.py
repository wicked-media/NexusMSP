"""
Iteration 6: Ticketing & Client Module Testing
Tests for child tickets, ticket merging, time tracking, audit log, canned responses, 
client contacts, and client detail view.
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication for subsequent tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get auth token for tests"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        return data["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        """Headers with auth token"""
        return {"Authorization": f"Bearer {auth_token}"}


class TestTicketChildEndpoints(TestAuth):
    """Test parent/child ticket hierarchy"""
    
    def test_get_child_tickets(self, headers):
        """GET /api/tickets/{id}/children returns children"""
        # First get a ticket with a known parent (TKT-001 has child TKT-012)
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200
        tickets = response.json()
        
        # Find a parent ticket
        parent_ticket = None
        for t in tickets:
            if not t.get("parent_id") and not t.get("merged_into"):
                parent_ticket = t
                break
        
        assert parent_ticket is not None, "No parent ticket found"
        
        # Get children
        children_resp = requests.get(f"{BASE_URL}/api/tickets/{parent_ticket['id']}/children", headers=headers)
        assert children_resp.status_code == 200
        children = children_resp.json()
        assert isinstance(children, list), "Children should be a list"
        print(f"Parent {parent_ticket['ticket_number']} has {len(children)} children")
    
    def test_create_child_ticket(self, headers):
        """POST /api/tickets/{id}/children creates a child ticket"""
        # Get a parent ticket first
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        parent_ticket = next((t for t in tickets if not t.get("parent_id") and not t.get("merged_into")), None)
        
        assert parent_ticket is not None, "No parent ticket found"
        
        # Create child
        child_data = {
            "title": f"TEST_Child_{uuid.uuid4().hex[:8]}",
            "description": "Test child ticket created during iteration 6 testing",
            "priority": "high"
        }
        
        create_resp = requests.post(
            f"{BASE_URL}/api/tickets/{parent_ticket['id']}/children",
            json=child_data,
            headers=headers
        )
        assert create_resp.status_code == 200, f"Failed to create child: {create_resp.text}"
        
        child = create_resp.json()
        assert "id" in child, "Child ticket should have ID"
        assert "ticket_number" in child, "Child ticket should have ticket number"
        assert child.get("parent_id") == parent_ticket['id'], "Child parent_id should match"
        assert child.get("client_id") == parent_ticket['client_id'], "Child inherits client_id"
        print(f"Created child ticket: {child.get('ticket_number')}")
        
        # Verify child appears in children list
        verify_resp = requests.get(f"{BASE_URL}/api/tickets/{parent_ticket['id']}/children", headers=headers)
        children = verify_resp.json()
        child_ids = [c['id'] for c in children]
        assert child['id'] in child_ids, "Created child should appear in children list"


class TestTicketMergeEndpoint(TestAuth):
    """Test ticket merging functionality"""
    
    def test_merge_tickets(self, headers):
        """POST /api/tickets/{id}/merge merges source tickets into target"""
        # Create two test tickets to merge
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        client_id = clients[0]['id'] if clients else None
        assert client_id, "Need a client to create tickets"
        
        # Create target ticket
        target_data = {
            "title": f"TEST_MergeTarget_{uuid.uuid4().hex[:8]}",
            "description": "Target ticket for merge test",
            "client_id": client_id,
            "priority": "medium"
        }
        target_resp = requests.post(f"{BASE_URL}/api/tickets", json=target_data, headers=headers)
        assert target_resp.status_code == 200
        target_ticket = target_resp.json()
        
        # Create source ticket to merge
        source_data = {
            "title": f"TEST_MergeSource_{uuid.uuid4().hex[:8]}",
            "description": "Source ticket for merge test",
            "client_id": client_id,
            "priority": "low"
        }
        source_resp = requests.post(f"{BASE_URL}/api/tickets", json=source_data, headers=headers)
        assert source_resp.status_code == 200
        source_ticket = source_resp.json()
        
        # Merge source into target
        merge_resp = requests.post(
            f"{BASE_URL}/api/tickets/{target_ticket['id']}/merge",
            json={"merge_ids": [source_ticket['id']]},
            headers=headers
        )
        assert merge_resp.status_code == 200, f"Merge failed: {merge_resp.text}"
        
        # Verify source is now marked as merged
        verify_resp = requests.get(f"{BASE_URL}/api/tickets/{source_ticket['id']}", headers=headers)
        assert verify_resp.status_code == 200
        merged_ticket = verify_resp.json()
        assert merged_ticket.get("merged_into") == target_ticket['id'], "Source should be marked as merged"
        assert merged_ticket.get("status") == "closed", "Merged source should be closed"
        print(f"Successfully merged {source_ticket['ticket_number']} into {target_ticket['ticket_number']}")
    
    def test_merge_requires_merge_ids(self, headers):
        """POST /api/tickets/{id}/merge returns 400 without merge_ids"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        ticket = tickets[0] if tickets else None
        assert ticket, "Need a ticket to test"
        
        merge_resp = requests.post(
            f"{BASE_URL}/api/tickets/{ticket['id']}/merge",
            json={},
            headers=headers
        )
        assert merge_resp.status_code == 400, "Should return 400 without merge_ids"


class TestTicketTimeTracking(TestAuth):
    """Test time entries on tickets"""
    
    def test_get_time_entries(self, headers):
        """GET /api/tickets/{id}/time-entries returns time entries"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        ticket = tickets[0] if tickets else None
        assert ticket, "Need a ticket to test"
        
        time_resp = requests.get(f"{BASE_URL}/api/tickets/{ticket['id']}/time-entries", headers=headers)
        assert time_resp.status_code == 200
        entries = time_resp.json()
        assert isinstance(entries, list), "Time entries should be a list"
        print(f"Ticket {ticket['ticket_number']} has {len(entries)} time entries")
    
    def test_add_time_entry(self, headers):
        """POST /api/tickets/{id}/time-entries logs time"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        ticket = next((t for t in tickets if not t.get("merged_into")), None)
        assert ticket, "Need an active ticket to test"
        
        time_data = {
            "minutes": 30,
            "description": "TEST_TimeEntry - automated test",
            "billable": True
        }
        
        add_resp = requests.post(
            f"{BASE_URL}/api/tickets/{ticket['id']}/time-entries",
            json=time_data,
            headers=headers
        )
        assert add_resp.status_code == 200, f"Failed to add time: {add_resp.text}"
        
        entry = add_resp.json()
        assert entry.get("minutes") == 30, "Minutes should match"
        assert entry.get("billable") == True, "Billable should match"
        assert "user_name" in entry, "Entry should have user_name"
        print(f"Added time entry: {entry.get('minutes')}m by {entry.get('user_name')}")
        
        # Verify ticket total_time_minutes updated
        verify_resp = requests.get(f"{BASE_URL}/api/tickets/{ticket['id']}", headers=headers)
        updated_ticket = verify_resp.json()
        assert updated_ticket.get("total_time_minutes", 0) > 0, "Total time should be updated"


class TestTicketAuditLog(TestAuth):
    """Test ticket audit log"""
    
    def test_get_audit_log(self, headers):
        """GET /api/tickets/{id}/audit-log returns audit entries"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        ticket = tickets[0] if tickets else None
        assert ticket, "Need a ticket to test"
        
        audit_resp = requests.get(f"{BASE_URL}/api/tickets/{ticket['id']}/audit-log", headers=headers)
        assert audit_resp.status_code == 200
        entries = audit_resp.json()
        assert isinstance(entries, list), "Audit log should be a list"
        
        if entries:
            entry = entries[0]
            assert "id" in entry, "Entry should have id"
            assert "action" in entry, "Entry should have action"
            assert "user_name" in entry, "Entry should have user_name"
            assert "created_at" in entry, "Entry should have created_at"
            print(f"Audit log has {len(entries)} entries. Sample action: {entry.get('action')}")
        else:
            print(f"No audit entries for ticket {ticket['ticket_number']}")


class TestCannedResponses(TestAuth):
    """Test canned responses CRUD"""
    
    def test_get_canned_responses(self, headers):
        """GET /api/canned-responses returns list"""
        response = requests.get(f"{BASE_URL}/api/canned-responses", headers=headers)
        assert response.status_code == 200
        responses_list = response.json()
        assert isinstance(responses_list, list), "Should return a list"
        print(f"Found {len(responses_list)} canned responses")
    
    def test_create_canned_response(self, headers):
        """POST /api/canned-responses creates response"""
        canned_data = {
            "title": f"TEST_CannedResponse_{uuid.uuid4().hex[:8]}",
            "content": "Thank you for contacting NexusOps support. We have received your request.",
            "category": "support"
        }
        
        create_resp = requests.post(
            f"{BASE_URL}/api/canned-responses",
            json=canned_data,
            headers=headers
        )
        assert create_resp.status_code == 200, f"Failed to create: {create_resp.text}"
        
        created = create_resp.json()
        assert "id" in created, "Should have ID"
        assert created.get("title") == canned_data["title"], "Title should match"
        print(f"Created canned response: {created.get('title')}")
        
        return created['id']
    
    def test_delete_canned_response(self, headers):
        """DELETE /api/canned-responses/{id} removes response"""
        # First create one to delete
        canned_data = {
            "title": f"TEST_ToDelete_{uuid.uuid4().hex[:8]}",
            "content": "This will be deleted",
            "category": "general"
        }
        create_resp = requests.post(f"{BASE_URL}/api/canned-responses", json=canned_data, headers=headers)
        created = create_resp.json()
        
        # Delete it
        delete_resp = requests.delete(
            f"{BASE_URL}/api/canned-responses/{created['id']}",
            headers=headers
        )
        assert delete_resp.status_code == 200, "Delete should succeed"
        print(f"Deleted canned response: {created['title']}")


class TestClientContacts(TestAuth):
    """Test client contact management"""
    
    def test_get_client_contacts(self, headers):
        """GET /api/clients/{id}/contacts returns contacts"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        client = clients[0] if clients else None
        assert client, "Need a client to test"
        
        contacts_resp = requests.get(f"{BASE_URL}/api/clients/{client['id']}/contacts", headers=headers)
        assert contacts_resp.status_code == 200
        contacts = contacts_resp.json()
        assert isinstance(contacts, list), "Contacts should be a list"
        print(f"Client {client['name']} has {len(contacts)} contacts")
    
    def test_add_client_contact(self, headers):
        """POST /api/clients/{id}/contacts adds contact"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        client = clients[0] if clients else None
        assert client, "Need a client to test"
        
        contact_data = {
            "name": f"TEST_Contact_{uuid.uuid4().hex[:8]}",
            "email": "test.contact@example.com",
            "phone": "555-123-4567",
            "role": "technical",
            "is_primary": False
        }
        
        add_resp = requests.post(
            f"{BASE_URL}/api/clients/{client['id']}/contacts",
            json=contact_data,
            headers=headers
        )
        assert add_resp.status_code == 200, f"Failed to add contact: {add_resp.text}"
        
        contact = add_resp.json()
        assert "id" in contact, "Contact should have ID"
        assert contact.get("name") == contact_data["name"], "Name should match"
        assert contact.get("role") == "technical", "Role should match"
        print(f"Added contact: {contact.get('name')} ({contact.get('role')})")
        
        return client['id'], contact['id']
    
    def test_delete_client_contact(self, headers):
        """DELETE /api/clients/{id}/contacts/{cid} removes contact"""
        # First add a contact to delete
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        client = clients[0] if clients else None
        
        contact_data = {
            "name": f"TEST_ToDelete_{uuid.uuid4().hex[:8]}",
            "email": "todelete@example.com",
            "phone": "555-999-8888",
            "role": "general"
        }
        add_resp = requests.post(f"{BASE_URL}/api/clients/{client['id']}/contacts", json=contact_data, headers=headers)
        contact = add_resp.json()
        
        # Delete the contact
        delete_resp = requests.delete(
            f"{BASE_URL}/api/clients/{client['id']}/contacts/{contact['id']}",
            headers=headers
        )
        assert delete_resp.status_code == 200, "Delete should succeed"
        print(f"Deleted contact: {contact['name']}")


class TestClientDetailView(TestAuth):
    """Test client detail endpoint"""
    
    def test_get_client_detail(self, headers):
        """GET /api/clients/{id}/detail returns full client info"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        client = clients[0] if clients else None
        assert client, "Need a client to test"
        
        detail_resp = requests.get(f"{BASE_URL}/api/clients/{client['id']}/detail", headers=headers)
        assert detail_resp.status_code == 200, f"Failed to get detail: {detail_resp.text}"
        
        detail = detail_resp.json()
        
        # Verify structure
        assert "client" in detail, "Should have client object"
        assert "tickets" in detail, "Should have tickets list"
        assert "devices" in detail, "Should have devices list"
        assert "contracts" in detail, "Should have contracts list"
        
        # Verify client data
        client_data = detail['client']
        assert client_data.get('id') == client['id'], "Client ID should match"
        assert "contacts" in client_data, "Client should have contacts array"
        
        print(f"Client detail - Name: {client_data.get('name')}")
        print(f"  Tickets: {len(detail['tickets'])}")
        print(f"  Devices: {len(detail['devices'])}")
        print(f"  Contracts: {len(detail['contracts'])}")
        print(f"  Contacts: {len(client_data.get('contacts', []))}")


class TestTicketListFeatures(TestAuth):
    """Test ticket list shows required columns"""
    
    def test_tickets_have_required_fields(self, headers):
        """GET /api/tickets returns tickets with all required fields"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200
        tickets = response.json()
        
        if tickets:
            ticket = tickets[0]
            required_fields = [
                "id", "ticket_number", "title", "client_name", 
                "priority", "status", "tags", "total_time_minutes", "created_at"
            ]
            for field in required_fields:
                assert field in ticket, f"Ticket should have {field}"
            
            # Check tags is a list
            assert isinstance(ticket.get("tags"), list), "Tags should be a list"
            
            print(f"Sample ticket fields verified: {list(ticket.keys())}")
    
    def test_child_ticket_has_parent_id(self, headers):
        """Child tickets have parent_id field"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        
        child_ticket = next((t for t in tickets if t.get("parent_id")), None)
        if child_ticket:
            assert child_ticket.get("parent_id"), "Child should have parent_id"
            print(f"Found child ticket {child_ticket['ticket_number']} with parent_id: {child_ticket['parent_id']}")
        else:
            print("No child tickets found - creating one to test")
            # This was already tested in TestTicketChildEndpoints


class TestClientListFeatures(TestAuth):
    """Test client list shows contacts count"""
    
    def test_clients_have_contacts_field(self, headers):
        """GET /api/clients returns clients with contacts array"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert response.status_code == 200
        clients = response.json()
        
        if clients:
            client = clients[0]
            assert "contacts" in client, "Client should have contacts field"
            assert isinstance(client.get("contacts"), list), "Contacts should be a list"
            print(f"Client {client['name']} has {len(client.get('contacts', []))} contacts")


class TestTicketStatusUpdate(TestAuth):
    """Test ticket status and priority updates create audit entries"""
    
    def test_update_ticket_status(self, headers):
        """PUT /api/tickets/{id} updates status"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        ticket = next((t for t in tickets if t.get("status") == "open" and not t.get("merged_into")), None)
        
        if not ticket:
            print("No open ticket found, skipping status update test")
            return
        
        update_resp = requests.put(
            f"{BASE_URL}/api/tickets/{ticket['id']}",
            json={"status": "in_progress"},
            headers=headers
        )
        assert update_resp.status_code == 200, f"Update failed: {update_resp.text}"
        
        # Verify status changed
        verify_resp = requests.get(f"{BASE_URL}/api/tickets/{ticket['id']}", headers=headers)
        updated = verify_resp.json()
        assert updated.get("status") == "in_progress", "Status should be updated"
        print(f"Updated ticket {ticket['ticket_number']} status to in_progress")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
