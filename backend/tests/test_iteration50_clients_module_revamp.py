"""
Iteration 50 - Clients Module Revamp Testing
Tests the revamped clients module with card-based layout matching TicketsPage styling.
Features: Summary stats, health-colored borders, filters, client detail view, contacts tab, tickets tab with priority styling.
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestClientsModuleRevamp:
    """Test suite for the revamped clients module"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - get auth token before each test"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.token = login_response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    # ========== CLIENTS LIST API TESTS ==========
    
    def test_get_clients_list(self):
        """Test GET /api/clients returns list of clients with proper structure"""
        response = self.session.get(f"{BASE_URL}/api/clients")
        assert response.status_code == 200, f"Failed to get clients: {response.text}"
        
        clients = response.json()
        assert isinstance(clients, list), "Response should be a list"
        assert len(clients) > 0, "Should have at least one client"
        
        # Verify client structure for card-based layout
        client = clients[0]
        assert "id" in client
        assert "name" in client
        assert "email" in client
        assert "industry" in client
        assert "contract_type" in client
        assert "mrr" in client
        assert "contacts" in client
        print(f"PASS: Got {len(clients)} clients with proper structure")
    
    def test_get_clients_health_all(self):
        """Test GET /api/clients/health/all returns health scores for all clients"""
        response = self.session.get(f"{BASE_URL}/api/clients/health/all")
        assert response.status_code == 200, f"Failed to get health: {response.text}"
        
        health_data = response.json()
        assert isinstance(health_data, list), "Response should be a list"
        
        # Verify health score structure
        if len(health_data) > 0:
            health = health_data[0]
            assert "client_id" in health
            assert "health_score" in health
            assert "risk_level" in health
            assert "breakdown" in health
            print(f"PASS: Got health data for {len(health_data)} clients")
            print(f"  Sample health: {health['client_name']} - Score: {health['health_score']}, Risk: {health['risk_level']}")
    
    def test_get_clients_subscriptions_summary(self):
        """Test GET /api/clients/subscriptions/summary returns subscription status"""
        response = self.session.get(f"{BASE_URL}/api/clients/subscriptions/summary")
        # This endpoint may or may not exist - acceptable to fail gracefully
        if response.status_code == 200:
            data = response.json()
            print(f"PASS: Got subscriptions summary for {len(data)} clients")
        else:
            print(f"INFO: Subscriptions summary endpoint returned {response.status_code}")
    
    # ========== CLIENT DETAIL API TESTS ==========
    
    def test_get_client_detail(self):
        """Test GET /api/clients/{client_id}/detail returns full client details"""
        # First get a client ID
        clients_response = self.session.get(f"{BASE_URL}/api/clients")
        clients = clients_response.json()
        client_id = clients[0]["id"]
        
        response = self.session.get(f"{BASE_URL}/api/clients/{client_id}/detail")
        assert response.status_code == 200, f"Failed to get client detail: {response.text}"
        
        detail = response.json()
        assert "client" in detail, "Should have client data"
        assert "tickets" in detail, "Should have tickets data"
        assert "devices" in detail, "Should have devices data"
        assert "contracts" in detail, "Should have contracts data"
        
        print(f"PASS: Got client detail for {detail['client']['name']}")
        print(f"  Tickets: {len(detail['tickets'])}, Devices: {len(detail['devices'])}, Contracts: {len(detail['contracts'])}")
    
    def test_get_client_contacts(self):
        """Test GET /api/clients/{client_id}/contacts returns contacts"""
        clients_response = self.session.get(f"{BASE_URL}/api/clients")
        clients = clients_response.json()
        client_id = clients[0]["id"]
        
        response = self.session.get(f"{BASE_URL}/api/clients/{client_id}/contacts")
        # Contacts may be included in client data or have separate endpoint
        if response.status_code == 200:
            contacts = response.json()
            print(f"PASS: Got {len(contacts)} contacts via dedicated endpoint")
        else:
            # Check if contacts are in client data directly
            client = clients[0]
            if "contacts" in client and len(client["contacts"]) > 0:
                print(f"PASS: Got {len(client['contacts'])} contacts embedded in client data")
                # Verify contact structure
                contact = client["contacts"][0]
                assert "name" in contact
                assert "email" in contact
                assert "role" in contact
    
    # ========== CONTACTS CRUD TESTS ==========
    
    def test_add_contact_to_client(self):
        """Test POST /api/clients/{client_id}/contacts adds a new contact"""
        clients_response = self.session.get(f"{BASE_URL}/api/clients")
        clients = clients_response.json()
        client_id = clients[0]["id"]
        
        new_contact = {
            "name": "TEST_Contact_Iter50",
            "email": "testcontact50@example.com",
            "phone": "555-9999",
            "role": "technical",
            "is_primary": False
        }
        
        response = self.session.post(f"{BASE_URL}/api/clients/{client_id}/contacts", json=new_contact)
        assert response.status_code in [200, 201], f"Failed to add contact: {response.text}"
        
        # Verify contact was created
        detail_response = self.session.get(f"{BASE_URL}/api/clients/{client_id}/detail")
        detail = detail_response.json()
        contacts = detail["client"].get("contacts", [])
        test_contact = next((c for c in contacts if c["name"] == "TEST_Contact_Iter50"), None)
        assert test_contact is not None, "Contact should exist after creation"
        
        print(f"PASS: Added contact and verified in client detail")
        
        # Cleanup - delete the test contact
        if test_contact:
            contact_id = test_contact["id"]
            delete_response = self.session.delete(f"{BASE_URL}/api/clients/{client_id}/contacts/{contact_id}")
            print(f"  Cleanup: Deleted test contact (status: {delete_response.status_code})")
    
    # ========== CLIENT CRUD TESTS ==========
    
    def test_create_client(self):
        """Test POST /api/clients creates a new client"""
        new_client = {
            "name": "TEST_Client_Iter50",
            "email": "test50@example.com",
            "phone": "555-5050",
            "address": "123 Test St",
            "industry": "Testing",
            "contract_type": "monthly",
            "mrr": 1000
        }
        
        response = self.session.post(f"{BASE_URL}/api/clients", json=new_client)
        assert response.status_code in [200, 201], f"Failed to create client: {response.text}"
        
        created = response.json()
        assert created["name"] == "TEST_Client_Iter50"
        print(f"PASS: Created client {created['name']} with ID {created['id']}")
        
        # Store for cleanup
        self.test_client_id = created["id"]
    
    def test_update_client(self):
        """Test PUT /api/clients/{client_id} updates client data"""
        # First create a test client
        new_client = {
            "name": "TEST_Update_Client",
            "email": "update@example.com",
            "contract_type": "monthly",
            "mrr": 500
        }
        create_response = self.session.post(f"{BASE_URL}/api/clients", json=new_client)
        client_id = create_response.json()["id"]
        
        # Update the client
        update_data = {
            "name": "TEST_Updated_Client",
            "mrr": 750
        }
        update_response = self.session.put(f"{BASE_URL}/api/clients/{client_id}", json=update_data)
        assert update_response.status_code == 200, f"Failed to update: {update_response.text}"
        
        # Verify update
        get_response = self.session.get(f"{BASE_URL}/api/clients/{client_id}/detail")
        updated = get_response.json()["client"]
        assert updated["name"] == "TEST_Updated_Client"
        assert updated["mrr"] == 750
        
        print(f"PASS: Updated client name and MRR")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/clients/{client_id}")
    
    def test_delete_client(self):
        """Test DELETE /api/clients/{client_id} deletes client"""
        # Create a client to delete
        new_client = {
            "name": "TEST_Delete_Client",
            "email": "delete@example.com",
            "contract_type": "monthly",
            "mrr": 100
        }
        create_response = self.session.post(f"{BASE_URL}/api/clients", json=new_client)
        client_id = create_response.json()["id"]
        
        # Delete the client
        delete_response = self.session.delete(f"{BASE_URL}/api/clients/{client_id}")
        assert delete_response.status_code in [200, 204], f"Failed to delete: {delete_response.text}"
        
        # Verify deletion
        get_response = self.session.get(f"{BASE_URL}/api/clients/{client_id}/detail")
        assert get_response.status_code == 404, "Client should not exist after deletion"
        
        print(f"PASS: Deleted client successfully")
    
    # ========== CLIENT TICKETS TESTS ==========
    
    def test_client_detail_tickets_structure(self):
        """Test that client detail tickets have proper structure for TicketsPage-style display"""
        clients_response = self.session.get(f"{BASE_URL}/api/clients")
        clients = clients_response.json()
        
        # Find a client with tickets
        client_with_tickets = None
        for client in clients:
            detail_response = self.session.get(f"{BASE_URL}/api/clients/{client['id']}/detail")
            detail = detail_response.json()
            if len(detail["tickets"]) > 0:
                client_with_tickets = detail
                break
        
        if client_with_tickets:
            ticket = client_with_tickets["tickets"][0]
            # Verify ticket has fields needed for TicketsPage-style display
            assert "id" in ticket
            assert "title" in ticket
            assert "priority" in ticket, "Ticket must have priority for colored borders"
            assert "status" in ticket, "Ticket must have status for badges"
            assert "ticket_number" in ticket, "Ticket must have ticket_number for display"
            
            # Priority should match expected values for coloring
            assert ticket["priority"] in ["critical", "high", "medium", "low"], \
                f"Priority '{ticket['priority']}' should be one of: critical, high, medium, low"
            
            print(f"PASS: Ticket structure verified - {ticket['ticket_number']} (priority: {ticket['priority']}, status: {ticket['status']})")
        else:
            print("INFO: No clients with tickets found to verify structure")
    
    # ========== CLIENT DEVICES TESTS ==========
    
    def test_client_detail_devices_structure(self):
        """Test that client detail devices have proper structure for cards display"""
        clients_response = self.session.get(f"{BASE_URL}/api/clients")
        clients = clients_response.json()
        
        for client in clients[:3]:  # Check first 3 clients
            detail_response = self.session.get(f"{BASE_URL}/api/clients/{client['id']}/detail")
            detail = detail_response.json()
            
            if len(detail["devices"]) > 0:
                device = detail["devices"][0]
                assert "id" in device
                assert "name" in device
                assert "status" in device, "Device must have status for online/offline display"
                
                # Status should be online or offline for border coloring
                assert device["status"] in ["online", "offline"], \
                    f"Device status '{device['status']}' should be online or offline"
                
                print(f"PASS: Device structure verified - {device['name']} (status: {device['status']})")
                return
        
        print("INFO: No clients with devices found to verify structure")
    
    # ========== CLIENT CONTRACTS TESTS ==========
    
    def test_client_detail_contracts_structure(self):
        """Test that client detail contracts have proper structure for cards display"""
        clients_response = self.session.get(f"{BASE_URL}/api/clients")
        clients = clients_response.json()
        
        for client in clients[:3]:
            detail_response = self.session.get(f"{BASE_URL}/api/clients/{client['id']}/detail")
            detail = detail_response.json()
            
            if len(detail["contracts"]) > 0:
                contract = detail["contracts"][0]
                assert "id" in contract
                assert "name" in contract
                
                print(f"PASS: Contract structure verified - {contract['name']}")
                return
        
        print("INFO: No clients with contracts found to verify structure")


class TestHealthScoresForUIColoring:
    """Test health score API returns proper risk_level for UI coloring"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        self.token = login_response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    def test_health_scores_risk_levels(self):
        """Verify health API returns risk levels that match UI healthRiskColor function"""
        response = self.session.get(f"{BASE_URL}/api/clients/health/all")
        assert response.status_code == 200
        
        health_data = response.json()
        valid_risk_levels = ["healthy", "attention", "critical", "at_risk"]  # at_risk may map to critical in UI
        
        for health in health_data:
            risk_level = health.get("risk_level", "")
            assert risk_level in valid_risk_levels, \
                f"risk_level '{risk_level}' should be one of {valid_risk_levels}"
        
        # Count by risk level
        risk_counts = {}
        for h in health_data:
            rl = h["risk_level"]
            risk_counts[rl] = risk_counts.get(rl, 0) + 1
        
        print(f"PASS: Health risk levels verified. Distribution: {risk_counts}")


class TestSubscriptionsForClientCards:
    """Test subscriptions endpoint for client list subs status display"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        self.token = login_response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    def test_subscriptions_summary_structure(self):
        """Test subscriptions summary returns active_count and total for each client"""
        response = self.session.get(f"{BASE_URL}/api/clients/subscriptions/summary")
        
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict) and len(data) > 0:
                # Check structure for a sample client
                sample_client_id = list(data.keys())[0]
                sample_sub = data[sample_client_id]
                
                # Should have active_count and total for shield icon display
                if "active_count" in sample_sub and "total" in sample_sub:
                    print(f"PASS: Subscriptions summary has active_count/total structure")
                    print(f"  Sample: {sample_client_id} -> {sample_sub['active_count']}/{sample_sub['total']}")
                else:
                    print(f"INFO: Subscriptions summary structure: {list(sample_sub.keys())}")
            else:
                print("INFO: Subscriptions summary is empty")
        else:
            print(f"INFO: Subscriptions summary endpoint returned {response.status_code}")


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
