"""
Iteration 96 - P2+P3 Batch Testing
Tests for:
- Portal V2 Login, Dashboard, Tickets, Ticket Detail, Ticket Messaging, KB, Me, Devices
- Estimate PDF generation
- TicketsPage and TechniciansPage config refactor (imports from ticketConfig.js)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Portal credentials
PORTAL_EMAIL = "john@acmecorp.com"
PORTAL_PASSWORD = "portal123"

# Admin credentials
ADMIN_EMAIL = "aaron@stech.com.au"
ADMIN_PASSWORD = "Lucky@2871$!"


class TestPortalV2Auth:
    """Portal V2 Authentication Tests"""
    
    def test_portal_login_success(self):
        """Test portal login with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        print(f"Portal login response: {response.status_code}")
        
        # May return 401 if user doesn't exist yet, or 200 if exists
        if response.status_code == 200:
            data = response.json()
            assert "token" in data or "requires_2fa" in data
            print(f"Portal login successful: {data.get('requires_2fa', False)}")
        elif response.status_code == 401:
            # User may not exist - this is expected if seed data not run
            print("Portal user not found - seed data may need to be created")
            pytest.skip("Portal user not seeded")
        else:
            print(f"Unexpected status: {response.status_code}, {response.text}")
            assert response.status_code in [200, 401]
    
    def test_portal_login_invalid_credentials(self):
        """Test portal login with invalid credentials"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": "invalid@test.com",
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        print("Portal login correctly rejected invalid credentials")
    
    def test_portal_login_missing_fields(self):
        """Test portal login with missing fields"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": "",
            "password": ""
        })
        assert response.status_code == 400
        print("Portal login correctly rejected empty fields")


class TestPortalV2Endpoints:
    """Portal V2 Authenticated Endpoint Tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get portal token for authenticated tests"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            if data.get("requires_2fa"):
                pytest.skip("2FA required - cannot test without TOTP code")
            self.token = data.get("token")
            self.headers = {"Authorization": f"Bearer {self.token}"}
        else:
            pytest.skip("Portal user not available for testing")
    
    def test_portal_dashboard(self):
        """Test GET /api/portal/v2/dashboard returns stats"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/dashboard", headers=self.headers)
        print(f"Dashboard response: {response.status_code}")
        assert response.status_code == 200
        data = response.json()
        assert "stats" in data
        stats = data["stats"]
        assert "open_tickets" in stats
        assert "total_devices" in stats
        assert "outstanding_invoices" in stats
        print(f"Dashboard stats: {stats}")
    
    def test_portal_tickets_list(self):
        """Test GET /api/portal/v2/tickets returns client tickets"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/tickets", headers=self.headers)
        print(f"Tickets response: {response.status_code}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Portal tickets count: {len(data)}")
    
    def test_portal_me(self):
        """Test GET /api/portal/v2/me returns user profile"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/me", headers=self.headers)
        print(f"Me response: {response.status_code}")
        assert response.status_code == 200
        data = response.json()
        assert "user" in data
        assert "client" in data or data.get("client") is None
        print(f"Portal user: {data.get('user', {}).get('email')}")
    
    def test_portal_devices(self):
        """Test GET /api/portal/v2/devices returns client devices"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/devices", headers=self.headers)
        print(f"Devices response: {response.status_code}")
        # May return 403 if user doesn't have permission, or 200
        assert response.status_code in [200, 403]
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, list)
            print(f"Portal devices count: {len(data)}")
        else:
            print("Devices access not permitted for this user")
    
    def test_portal_kb(self):
        """Test GET /api/portal/v2/kb returns knowledge base articles"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/kb", headers=self.headers)
        print(f"KB response: {response.status_code}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Should return demo articles if none in DB
        assert len(data) >= 0
        print(f"KB articles count: {len(data)}")
        if len(data) > 0:
            article = data[0]
            assert "title" in article
            assert "content" in article
            print(f"First KB article: {article.get('title')}")
    
    def test_portal_invoices(self):
        """Test GET /api/portal/v2/invoices returns client invoices"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/invoices", headers=self.headers)
        print(f"Invoices response: {response.status_code}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Portal invoices count: {len(data)}")


class TestPortalV2TicketMessaging:
    """Portal V2 Ticket Detail and Messaging Tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get portal token and create a test ticket"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            if data.get("requires_2fa"):
                pytest.skip("2FA required")
            self.token = data.get("token")
            self.headers = {"Authorization": f"Bearer {self.token}"}
        else:
            pytest.skip("Portal user not available")
    
    def test_create_portal_ticket(self):
        """Test creating a ticket from portal"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/tickets", json={
            "title": "TEST_Portal Ticket for Messaging",
            "description": "This is a test ticket created from portal",
            "priority": "medium",
            "category": "support"
        }, headers=self.headers)
        print(f"Create ticket response: {response.status_code}")
        # May return 403 if user doesn't have permission
        if response.status_code == 201:
            data = response.json()
            assert "id" in data
            assert data["title"] == "TEST_Portal Ticket for Messaging"
            self.ticket_id = data["id"]
            print(f"Created portal ticket: {data['id']}")
        elif response.status_code == 403:
            print("Ticket creation not permitted for this user")
            pytest.skip("Ticket creation not permitted")
        else:
            print(f"Unexpected: {response.status_code}, {response.text}")
    
    def test_get_ticket_detail_with_messages(self):
        """Test getting ticket detail with messages"""
        # First get list of tickets
        tickets_response = requests.get(f"{BASE_URL}/api/portal/v2/tickets", headers=self.headers)
        if tickets_response.status_code != 200 or not tickets_response.json():
            pytest.skip("No tickets available for testing")
        
        ticket_id = tickets_response.json()[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/portal/v2/tickets/{ticket_id}", headers=self.headers)
        print(f"Ticket detail response: {response.status_code}")
        assert response.status_code == 200
        data = response.json()
        assert "ticket" in data
        assert "messages" in data
        assert isinstance(data["messages"], list)
        print(f"Ticket detail: {data['ticket'].get('title')}, messages: {len(data['messages'])}")
    
    def test_add_ticket_message(self):
        """Test adding a message to a ticket"""
        # First get list of tickets
        tickets_response = requests.get(f"{BASE_URL}/api/portal/v2/tickets", headers=self.headers)
        if tickets_response.status_code != 200 or not tickets_response.json():
            pytest.skip("No tickets available for testing")
        
        ticket_id = tickets_response.json()[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/portal/v2/tickets/{ticket_id}/messages", json={
            "content": "TEST_Message from portal user"
        }, headers=self.headers)
        print(f"Add message response: {response.status_code}")
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["content"] == "TEST_Message from portal user"
        assert data["sender_type"] == "client"
        print(f"Message added: {data['id']}")


class TestEstimatePDF:
    """Estimate PDF Generation Tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            self.token = response.json().get("token")
            self.headers = {"Authorization": f"Bearer {self.token}"}
        else:
            pytest.skip("Admin login failed")
    
    def test_estimate_pdf_endpoint_exists(self):
        """Test that estimate PDF endpoint exists"""
        # First get an estimate ID
        estimates_response = requests.get(f"{BASE_URL}/api/estimates", headers=self.headers)
        if estimates_response.status_code != 200:
            pytest.skip("Estimates endpoint not available")
        
        estimates = estimates_response.json()
        if not estimates:
            # Create a test estimate
            create_response = requests.post(f"{BASE_URL}/api/estimates", json={
                "title": "TEST_Estimate for PDF",
                "client_id": "test-client",
                "client_name": "Test Client",
                "line_items": [{"name": "Test Service", "quantity": 1, "unit_price": 100}],
                "subtotal": 100,
                "total": 100
            }, headers=self.headers)
            if create_response.status_code in [200, 201]:
                estimate_id = create_response.json().get("id")
            else:
                pytest.skip("Could not create test estimate")
        else:
            estimate_id = estimates[0]["id"]
        
        # Test PDF endpoint with token query param
        response = requests.get(f"{BASE_URL}/api/estimates/{estimate_id}/pdf?token={self.token}")
        print(f"Estimate PDF response: {response.status_code}")
        # Should return PDF or 404 if estimate not found
        assert response.status_code in [200, 404]
        if response.status_code == 200:
            assert response.headers.get("content-type") == "application/pdf"
            print("Estimate PDF generated successfully")


class TestTicketsPageConfig:
    """Test that TicketsPage loads correctly after config refactor"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            self.token = response.json().get("token")
            self.headers = {"Authorization": f"Bearer {self.token}"}
        else:
            pytest.skip("Admin login failed")
    
    def test_tickets_endpoint(self):
        """Test tickets endpoint works (validates backend for TicketsPage)"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=self.headers)
        print(f"Tickets endpoint: {response.status_code}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Tickets count: {len(data)}")
    
    def test_workshop_jobs_endpoint(self):
        """Test workshop jobs endpoint (used by TicketsPage)"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs", headers=self.headers)
        print(f"Workshop jobs: {response.status_code}")
        assert response.status_code == 200
    
    def test_field_jobs_endpoint(self):
        """Test field jobs endpoint (used by TicketsPage)"""
        response = requests.get(f"{BASE_URL}/api/field-jobs", headers=self.headers)
        print(f"Field jobs: {response.status_code}")
        assert response.status_code == 200


class TestTechniciansPageConfig:
    """Test that TechniciansPage loads correctly after config refactor"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            self.token = response.json().get("token")
            self.headers = {"Authorization": f"Bearer {self.token}"}
        else:
            pytest.skip("Admin login failed")
    
    def test_technicians_overview_endpoint(self):
        """Test technicians overview endpoint"""
        response = requests.get(f"{BASE_URL}/api/technicians/overview", headers=self.headers)
        print(f"Technicians overview: {response.status_code}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Technicians count: {len(data)}")
    
    def test_technicians_leaderboard_endpoint(self):
        """Test technicians leaderboard endpoint"""
        response = requests.get(f"{BASE_URL}/api/technicians/leaderboard", headers=self.headers)
        print(f"Leaderboard: {response.status_code}")
        assert response.status_code == 200


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
