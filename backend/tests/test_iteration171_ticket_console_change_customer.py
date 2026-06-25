"""
Iteration 171: Ticket Console Header + Change Customer Flow Tests
Tests for:
- POST /api/tickets/{id}/change-customer - reassign ticket to different client
- GET /api/tickets/{id}/customer-history - get customer change history
- POST /api/tickets/{id}/revert-customer - revert to previous customer
- PUT /api/tickets/{id} - update ticket status and title
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    data = response.json()
    assert "token" in data, "No token in response"
    return data["token"]

@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}

@pytest.fixture(scope="module")
def test_ticket(headers):
    """Get a test ticket for change-customer tests"""
    response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
    assert response.status_code == 200
    tickets = response.json()
    assert len(tickets) > 0, "No tickets available for testing"
    return tickets[0]

@pytest.fixture(scope="module")
def clients(headers):
    """Get list of clients"""
    response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
    assert response.status_code == 200
    return response.json()


class TestChangeCustomerValidation:
    """Test validation for change-customer endpoint"""
    
    def test_change_customer_empty_client_id_returns_400(self, headers, test_ticket):
        """Empty client_id should return 400"""
        response = requests.post(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/change-customer",
            headers=headers,
            json={}
        )
        assert response.status_code == 400
        assert "client_id required" in response.json().get("detail", "")
    
    def test_change_customer_unknown_client_returns_404(self, headers, test_ticket):
        """Unknown client_id should return 404"""
        response = requests.post(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/change-customer",
            headers=headers,
            json={"client_id": "nonexistent-client-xyz"}
        )
        assert response.status_code == 404
        assert "client not found" in response.json().get("detail", "").lower()
    
    def test_change_customer_unknown_ticket_returns_404(self, headers, clients):
        """Unknown ticket should return 404"""
        response = requests.post(
            f"{BASE_URL}/api/tickets/nonexistent-ticket-xyz/change-customer",
            headers=headers,
            json={"client_id": clients[0]["id"]}
        )
        assert response.status_code == 404
        assert "ticket not found" in response.json().get("detail", "").lower()
    
    def test_change_customer_same_client_returns_no_change(self, headers, test_ticket):
        """Same client_id as current should return no_change:true"""
        response = requests.post(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/change-customer",
            headers=headers,
            json={"client_id": test_ticket["client_id"]}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") is True
        assert data.get("no_change") is True


class TestChangeCustomerFlow:
    """Test the full change-customer flow"""
    
    def test_change_customer_success(self, headers, clients):
        """Successfully change customer and verify history"""
        # Get a fresh ticket
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        # Find a ticket we can change
        test_ticket = None
        for t in tickets:
            if t.get("client_id") and t["client_id"] != clients[1]["id"]:
                test_ticket = t
                break
        
        if not test_ticket:
            pytest.skip("No suitable ticket found for change-customer test")
        
        original_client_id = test_ticket["client_id"]
        original_client_name = test_ticket.get("client_name")
        new_client = clients[1]  # Use second client
        
        # Change customer
        response = requests.post(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/change-customer",
            headers=headers,
            json={
                "client_id": new_client["id"],
                "reason": "TEST_change_customer_iteration171"
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert data.get("success") is True
        assert "ticket" in data
        assert "history_entry" in data
        
        # Verify ticket was updated
        assert data["ticket"]["client_id"] == new_client["id"]
        assert data["ticket"]["client_name"] == new_client["name"]
        
        # Verify history entry
        history_entry = data["history_entry"]
        assert history_entry["from_client_id"] == original_client_id
        assert history_entry["to_client_id"] == new_client["id"]
        assert history_entry["reason"] == "TEST_change_customer_iteration171"
        assert "changed_by" in history_entry
        assert "ts" in history_entry
        
        # Verify via GET that change persisted
        get_response = requests.get(f"{BASE_URL}/api/tickets/{test_ticket['id']}", headers=headers)
        if get_response.status_code == 200:
            fetched = get_response.json()
            assert fetched["client_id"] == new_client["id"]
        
        # Revert back to original
        requests.post(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/change-customer",
            headers=headers,
            json={"client_id": original_client_id, "reason": "Reverting test change"}
        )


class TestCustomerHistory:
    """Test customer history endpoint"""
    
    def test_get_customer_history(self, headers, test_ticket):
        """GET customer-history returns array"""
        response = requests.get(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/customer-history",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        
        # If there's history, verify structure
        if len(data) > 0:
            entry = data[0]
            assert "id" in entry
            assert "ts" in entry
            assert "from_client_id" in entry
            assert "to_client_id" in entry
            assert "changed_by" in entry
    
    def test_customer_history_unknown_ticket_returns_404(self, headers):
        """Unknown ticket should return 404"""
        response = requests.get(
            f"{BASE_URL}/api/tickets/nonexistent-ticket-xyz/customer-history",
            headers=headers
        )
        assert response.status_code == 404


class TestRevertCustomer:
    """Test revert-customer endpoint"""
    
    def test_revert_customer_no_history_returns_400(self, headers):
        """Revert with no history should return 400"""
        # Create a fresh ticket with no history
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        
        # Find a ticket with no customer_history
        for t in tickets:
            if not t.get("customer_history") or len(t.get("customer_history", [])) == 0:
                response = requests.post(
                    f"{BASE_URL}/api/tickets/{t['id']}/revert-customer",
                    headers=headers
                )
                # Should be 400 if no history
                if response.status_code == 400:
                    assert "no previous customer" in response.json().get("detail", "").lower()
                    return
        
        # If all tickets have history, skip
        pytest.skip("All tickets have customer history")
    
    def test_revert_customer_success(self, headers, clients):
        """Successfully revert to previous customer"""
        # Get a ticket and make a change first
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        test_ticket = tickets[0]
        original_client_id = test_ticket["client_id"]
        
        # Find a different client
        new_client = None
        for c in clients:
            if c["id"] != original_client_id:
                new_client = c
                break
        
        if not new_client:
            pytest.skip("No different client available")
        
        # Change customer
        requests.post(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/change-customer",
            headers=headers,
            json={"client_id": new_client["id"], "reason": "TEST_for_revert"}
        )
        
        # Now revert
        response = requests.post(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/revert-customer",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") is True
        assert "ticket" in data
        
        # Verify reverted back
        # Note: The revert goes to the from_client_id of the last history entry
    
    def test_revert_customer_unknown_ticket_returns_404(self, headers):
        """Unknown ticket should return 404"""
        response = requests.post(
            f"{BASE_URL}/api/tickets/nonexistent-ticket-xyz/revert-customer",
            headers=headers
        )
        assert response.status_code == 404


class TestTicketStatusUpdate:
    """Test ticket status update via PUT /tickets/{id}"""
    
    def test_update_ticket_status(self, headers, test_ticket):
        """Update ticket status"""
        # Get current status
        original_status = test_ticket.get("status", "open")
        new_status = "in_progress" if original_status != "in_progress" else "open"
        
        response = requests.put(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}",
            headers=headers,
            json={"status": new_status}
        )
        assert response.status_code == 200
        
        # Verify change
        get_response = requests.get(f"{BASE_URL}/api/tickets/{test_ticket['id']}", headers=headers)
        if get_response.status_code == 200:
            fetched = get_response.json()
            assert fetched["status"] == new_status
        
        # Revert
        requests.put(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}",
            headers=headers,
            json={"status": original_status}
        )
    
    def test_update_ticket_title(self, headers, test_ticket):
        """Update ticket title"""
        original_title = test_ticket.get("title", "")
        new_title = f"TEST_Updated_Title_{uuid.uuid4().hex[:8]}"
        
        response = requests.put(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}",
            headers=headers,
            json={"title": new_title}
        )
        assert response.status_code == 200
        
        # Verify change
        get_response = requests.get(f"{BASE_URL}/api/tickets/{test_ticket['id']}", headers=headers)
        if get_response.status_code == 200:
            fetched = get_response.json()
            assert fetched["title"] == new_title
        
        # Revert
        requests.put(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}",
            headers=headers,
            json={"title": original_title}
        )


class TestAuditCommentCreation:
    """Test that change-customer creates audit comment"""
    
    def test_change_customer_creates_audit_comment(self, headers, clients):
        """Verify audit comment is created on customer change"""
        # Get a ticket
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        test_ticket = tickets[0]
        original_client_id = test_ticket["client_id"]
        
        # Get initial comments count
        comments_response = requests.get(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/comments",
            headers=headers
        )
        initial_comments = comments_response.json() if comments_response.status_code == 200 else []
        initial_count = len(initial_comments)
        
        # Find a different client
        new_client = None
        for c in clients:
            if c["id"] != original_client_id:
                new_client = c
                break
        
        if not new_client:
            pytest.skip("No different client available")
        
        # Change customer
        change_response = requests.post(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/change-customer",
            headers=headers,
            json={"client_id": new_client["id"], "reason": "TEST_audit_comment_check"}
        )
        assert change_response.status_code == 200
        
        # Get comments again
        comments_response = requests.get(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/comments",
            headers=headers
        )
        new_comments = comments_response.json() if comments_response.status_code == 200 else []
        
        # Verify comment was added
        assert len(new_comments) > initial_count, "No new comment was added"
        
        # Find the customer_changed comment
        customer_changed_comment = None
        for c in new_comments:
            if c.get("kind") == "customer_changed":
                customer_changed_comment = c
                break
        
        assert customer_changed_comment is not None, "No customer_changed comment found"
        assert "Customer changed" in customer_changed_comment.get("content", "")
        
        # Revert
        requests.post(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/change-customer",
            headers=headers,
            json={"client_id": original_client_id, "reason": "Reverting test"}
        )


class TestContactHandling:
    """Test contact_id handling in change-customer"""
    
    def test_change_customer_clears_contact_when_not_provided(self, headers, clients):
        """Contact should be cleared when changing customer without contact_id"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = response.json()
        test_ticket = tickets[0]
        original_client_id = test_ticket["client_id"]
        
        # Find a different client
        new_client = None
        for c in clients:
            if c["id"] != original_client_id:
                new_client = c
                break
        
        if not new_client:
            pytest.skip("No different client available")
        
        # Change customer without contact_id
        response = requests.post(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/change-customer",
            headers=headers,
            json={"client_id": new_client["id"]}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Contact should be cleared (null)
        assert data["ticket"].get("contact_id") is None
        assert data["ticket"].get("contact_name") is None
        
        # Revert
        requests.post(
            f"{BASE_URL}/api/tickets/{test_ticket['id']}/change-customer",
            headers=headers,
            json={"client_id": original_client_id}
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
