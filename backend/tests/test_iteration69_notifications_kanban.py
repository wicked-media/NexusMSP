"""
Iteration 69 - Notifications Page & Kanban Board Testing
Tests for:
- GET /api/notifications - returns notifications array
- POST /api/notifications/generate - creates notifications from system state
- POST /api/notifications/mark-read - marks notifications as read (with/without ids)
- POST /api/notifications/delete - removes specified notifications
- GET /api/kanban-tickets/board - returns board with columns array
- PUT /api/kanban-tickets/move - changes ticket status
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token for admin user"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in response"
        return data["token"]
    
    def test_login_success(self, auth_token):
        """Test standard login works"""
        assert auth_token is not None
        assert len(auth_token) > 0
        print(f"✓ Login successful, token obtained")


class TestNotificationsAPI:
    """Notifications endpoint tests"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get auth headers"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        token = response.json().get("token")
        return {"Authorization": f"Bearer {token}"}
    
    def test_get_notifications(self, auth_headers):
        """GET /api/notifications returns notifications array"""
        response = requests.get(f"{BASE_URL}/api/notifications", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✓ GET /api/notifications returned {len(data)} notifications")
        
        # If there are notifications, verify structure
        if len(data) > 0:
            notif = data[0]
            assert "id" in notif, "Notification should have id"
            assert "type" in notif, "Notification should have type"
            print(f"✓ Notification structure verified: type={notif.get('type')}, message={notif.get('message', '')[:50]}")
    
    def test_generate_notifications(self, auth_headers):
        """POST /api/notifications/generate creates notifications from system state"""
        response = requests.post(f"{BASE_URL}/api/notifications/generate", json={}, headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data, "Response should have message"
        assert "count" in data, "Response should have count"
        print(f"✓ POST /api/notifications/generate: {data['message']}")
    
    def test_get_unread_count(self, auth_headers):
        """GET /api/notifications/unread-count returns count"""
        response = requests.get(f"{BASE_URL}/api/notifications/unread-count", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "count" in data, "Response should have count"
        print(f"✓ GET /api/notifications/unread-count: {data['count']} unread")
    
    def test_mark_all_read(self, auth_headers):
        """POST /api/notifications/mark-read without ids marks ALL as read"""
        # First generate some notifications
        requests.post(f"{BASE_URL}/api/notifications/generate", json={}, headers=auth_headers)
        
        # Mark all as read (no ids)
        response = requests.post(f"{BASE_URL}/api/notifications/mark-read", json={}, headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data, "Response should have message"
        print(f"✓ POST /api/notifications/mark-read (all): {data['message']}")
        
        # Verify unread count is 0
        count_response = requests.get(f"{BASE_URL}/api/notifications/unread-count", headers=auth_headers)
        count_data = count_response.json()
        assert count_data.get("count", 0) == 0, "Unread count should be 0 after marking all read"
        print(f"✓ Verified unread count is now 0")
    
    def test_mark_specific_read(self, auth_headers):
        """POST /api/notifications/mark-read with ids marks specific notifications as read"""
        # Generate notifications first
        requests.post(f"{BASE_URL}/api/notifications/generate", json={}, headers=auth_headers)
        
        # Get notifications
        get_response = requests.get(f"{BASE_URL}/api/notifications", headers=auth_headers)
        notifications = get_response.json()
        
        if len(notifications) > 0:
            # Mark first notification as read
            notif_id = notifications[0]["id"]
            response = requests.post(f"{BASE_URL}/api/notifications/mark-read", 
                                    json={"ids": [notif_id]}, headers=auth_headers)
            assert response.status_code == 200, f"Failed: {response.text}"
            print(f"✓ POST /api/notifications/mark-read (specific id): success")
        else:
            print("⚠ No notifications to mark as read")
    
    def test_delete_notifications(self, auth_headers):
        """POST /api/notifications/delete removes specified notifications"""
        # Get notifications
        get_response = requests.get(f"{BASE_URL}/api/notifications", headers=auth_headers)
        notifications = get_response.json()
        
        if len(notifications) > 0:
            # Delete first notification
            notif_id = notifications[0]["id"]
            response = requests.post(f"{BASE_URL}/api/notifications/delete", 
                                    json={"ids": [notif_id]}, headers=auth_headers)
            assert response.status_code == 200, f"Failed: {response.text}"
            data = response.json()
            assert "message" in data, "Response should have message"
            print(f"✓ POST /api/notifications/delete: {data['message']}")
            
            # Verify notification is deleted
            get_response2 = requests.get(f"{BASE_URL}/api/notifications", headers=auth_headers)
            notifications2 = get_response2.json()
            deleted_ids = [n["id"] for n in notifications2]
            assert notif_id not in deleted_ids, "Deleted notification should not be in list"
            print(f"✓ Verified notification {notif_id[:8]}... was deleted")
        else:
            print("⚠ No notifications to delete")


class TestKanbanBoardAPI:
    """Kanban Board endpoint tests"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get auth headers"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        token = response.json().get("token")
        return {"Authorization": f"Bearer {token}"}
    
    def test_get_kanban_board(self, auth_headers):
        """GET /api/kanban-tickets/board returns board with columns array"""
        response = requests.get(f"{BASE_URL}/api/kanban-tickets/board", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify structure
        assert "columns" in data, "Response should have columns"
        assert isinstance(data["columns"], list), "Columns should be a list"
        assert "total_tickets" in data, "Response should have total_tickets"
        
        # Verify 5 columns exist
        column_ids = [col["id"] for col in data["columns"]]
        expected_columns = ["open", "in_progress", "waiting", "resolved", "closed"]
        for expected in expected_columns:
            assert expected in column_ids, f"Column '{expected}' should exist"
        
        print(f"✓ GET /api/kanban-tickets/board: {len(data['columns'])} columns, {data['total_tickets']} total tickets")
        
        # Print column ticket counts
        for col in data["columns"]:
            print(f"  - {col['title']}: {len(col['tickets'])} tickets")
    
    def test_kanban_board_column_structure(self, auth_headers):
        """Verify each column has proper structure"""
        response = requests.get(f"{BASE_URL}/api/kanban-tickets/board", headers=auth_headers)
        data = response.json()
        
        for col in data["columns"]:
            assert "id" in col, "Column should have id"
            assert "title" in col, "Column should have title"
            assert "tickets" in col, "Column should have tickets array"
            assert isinstance(col["tickets"], list), "Tickets should be a list"
            
            # Verify ticket structure if any exist
            if len(col["tickets"]) > 0:
                ticket = col["tickets"][0]
                assert "id" in ticket, "Ticket should have id"
                assert "title" in ticket, "Ticket should have title"
                assert "priority" in ticket, "Ticket should have priority"
                print(f"✓ Column '{col['title']}' ticket structure verified")
    
    def test_move_ticket(self, auth_headers):
        """PUT /api/kanban-tickets/move changes ticket status"""
        # Get board to find a ticket
        board_response = requests.get(f"{BASE_URL}/api/kanban-tickets/board", headers=auth_headers)
        board = board_response.json()
        
        # Find a ticket to move
        ticket_to_move = None
        original_status = None
        for col in board["columns"]:
            if len(col["tickets"]) > 0:
                ticket_to_move = col["tickets"][0]
                original_status = col["id"]
                break
        
        if ticket_to_move:
            # Determine new status
            new_status = "in_progress" if original_status != "in_progress" else "open"
            
            # Move ticket
            response = requests.put(f"{BASE_URL}/api/kanban-tickets/move", 
                                   json={"ticket_id": ticket_to_move["id"], "new_status": new_status},
                                   headers=auth_headers)
            assert response.status_code == 200, f"Failed: {response.text}"
            data = response.json()
            assert data.get("status") == "moved", "Response should indicate moved"
            assert data.get("new_status") == new_status, "New status should match"
            print(f"✓ PUT /api/kanban-tickets/move: Moved ticket from '{original_status}' to '{new_status}'")
            
            # Verify ticket moved by fetching board again
            board_response2 = requests.get(f"{BASE_URL}/api/kanban-tickets/board", headers=auth_headers)
            board2 = board_response2.json()
            
            # Find ticket in new column
            found_in_new = False
            for col in board2["columns"]:
                if col["id"] == new_status:
                    ticket_ids = [t["id"] for t in col["tickets"]]
                    if ticket_to_move["id"] in ticket_ids:
                        found_in_new = True
                        break
            
            assert found_in_new, f"Ticket should be in '{new_status}' column after move"
            print(f"✓ Verified ticket is now in '{new_status}' column")
            
            # Move ticket back to original status
            requests.put(f"{BASE_URL}/api/kanban-tickets/move", 
                        json={"ticket_id": ticket_to_move["id"], "new_status": original_status},
                        headers=auth_headers)
            print(f"✓ Moved ticket back to '{original_status}'")
        else:
            print("⚠ No tickets found to test move functionality")


class TestNotificationTypes:
    """Test different notification types are generated"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get auth headers"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        token = response.json().get("token")
        return {"Authorization": f"Bearer {token}"}
    
    def test_notification_types_exist(self, auth_headers):
        """Verify various notification types can be generated"""
        # Generate notifications
        requests.post(f"{BASE_URL}/api/notifications/generate", json={}, headers=auth_headers)
        
        # Get notifications
        response = requests.get(f"{BASE_URL}/api/notifications", headers=auth_headers)
        notifications = response.json()
        
        # Collect types
        types_found = set()
        for n in notifications:
            types_found.add(n.get("type"))
        
        print(f"✓ Notification types found: {types_found}")
        
        # Expected types (may not all be present depending on system state)
        expected_types = ["sla_breach", "sla_warning", "contract_renewal", "device_offline", 
                        "ticket_assigned", "new_lead"]
        
        for t in types_found:
            if t in expected_types:
                print(f"  ✓ Type '{t}' is a valid notification type")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
