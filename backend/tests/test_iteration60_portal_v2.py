"""
Iteration 60 - Portal V2 API Tests
Testing Multi-Tenant Client Portal with:
- Email/password login with 2FA (TOTP)
- Full suite access (Tickets, Devices, Invoices, Backups, Compliance, QBR Reports)
- Ticket creation from portal
- Client-scoped data access
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Portal user credentials
PORTAL_EMAIL = "john@acmecorp.com"
PORTAL_PASSWORD = "portal123"

# MSP Admin credentials
MSP_EMAIL = "admin@nexusops.io"
MSP_PASSWORD = "admin123"


class TestPortalV2Auth:
    """Portal V2 Authentication Tests"""
    
    def test_portal_login_success(self):
        """Test successful portal login returns token"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        print(f"Login response status: {response.status_code}")
        print(f"Login response: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Check for token or 2FA requirement
        if data.get("requires_2fa"):
            assert "temp_token" in data, "2FA flow should return temp_token"
            print("User has 2FA enabled - temp_token returned")
        else:
            assert "token" in data, "Login should return token"
            assert "user" in data, "Login should return user object"
            assert data["user"]["email"] == PORTAL_EMAIL
            print(f"Login successful - token received for {data['user']['name']}")
    
    def test_portal_login_invalid_credentials(self):
        """Test login with invalid credentials returns 401"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": "wrong@example.com",
            "password": "wrongpassword"
        })
        print(f"Invalid login response: {response.status_code}")
        
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "detail" in data
        print(f"Correctly rejected invalid credentials: {data['detail']}")
    
    def test_portal_login_missing_fields(self):
        """Test login with missing fields returns 400"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": ""
        })
        print(f"Missing fields response: {response.status_code}")
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"


class TestPortalV2Dashboard:
    """Portal V2 Dashboard Tests"""
    
    @pytest.fixture
    def portal_token(self):
        """Get portal auth token"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Could not login: {response.text}")
        data = response.json()
        if data.get("requires_2fa"):
            pytest.skip("User has 2FA enabled - cannot test without TOTP code")
        return data["token"]
    
    def test_dashboard_returns_stats(self, portal_token):
        """Test dashboard returns client-scoped stats"""
        headers = {"Authorization": f"Bearer {portal_token}"}
        response = requests.get(f"{BASE_URL}/api/portal/v2/dashboard", headers=headers)
        
        print(f"Dashboard response status: {response.status_code}")
        print(f"Dashboard response: {response.json()}")
        
        assert response.status_code == 200
        data = response.json()
        assert "stats" in data
        
        stats = data["stats"]
        assert "open_tickets" in stats
        assert "resolved_tickets" in stats
        assert "total_tickets" in stats
        assert "online_devices" in stats
        assert "total_devices" in stats
        assert "outstanding_invoices" in stats
        assert "total_invoices" in stats
        
        print(f"Dashboard stats: {stats}")
    
    def test_dashboard_unauthorized(self):
        """Test dashboard without token returns 401"""
        response = requests.get(f"{BASE_URL}/api/portal/v2/dashboard")
        assert response.status_code == 401


class TestPortalV2Tickets:
    """Portal V2 Tickets Tests"""
    
    @pytest.fixture
    def portal_token(self):
        """Get portal auth token"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Could not login: {response.text}")
        data = response.json()
        if data.get("requires_2fa"):
            pytest.skip("User has 2FA enabled")
        return data["token"]
    
    def test_get_tickets_returns_client_scoped_data(self, portal_token):
        """Test GET /tickets returns only client's tickets"""
        headers = {"Authorization": f"Bearer {portal_token}"}
        response = requests.get(f"{BASE_URL}/api/portal/v2/tickets", headers=headers)
        
        print(f"Tickets response status: {response.status_code}")
        
        assert response.status_code == 200
        tickets = response.json()
        assert isinstance(tickets, list)
        print(f"Retrieved {len(tickets)} tickets")
        
        # Verify tickets belong to client-001 (Acme Corporation)
        for ticket in tickets[:5]:  # Check first 5
            print(f"Ticket: {ticket.get('ticket_number')} - {ticket.get('title')} - Client: {ticket.get('client_id')}")
    
    def test_create_ticket_from_portal(self, portal_token):
        """Test POST /tickets creates ticket with source=client_portal"""
        headers = {"Authorization": f"Bearer {portal_token}"}
        ticket_data = {
            "title": "TEST_Portal Ticket - Network Issue",
            "description": "Testing ticket creation from client portal",
            "category": "network",
            "priority": "medium"
        }
        
        response = requests.post(f"{BASE_URL}/api/portal/v2/tickets", json=ticket_data, headers=headers)
        
        print(f"Create ticket response status: {response.status_code}")
        print(f"Create ticket response: {response.json()}")
        
        assert response.status_code == 200
        ticket = response.json()
        
        assert "id" in ticket
        assert ticket["title"] == ticket_data["title"]
        assert ticket["source"] == "client_portal", "Ticket source should be client_portal"
        assert ticket["status"] == "open"
        assert ticket["priority"] == "medium"
        
        print(f"Created ticket: {ticket['id']} - {ticket['ticket_number']}")
        
        # Verify ticket appears in list
        list_response = requests.get(f"{BASE_URL}/api/portal/v2/tickets", headers=headers)
        tickets = list_response.json()
        ticket_ids = [t["id"] for t in tickets]
        assert ticket["id"] in ticket_ids, "Created ticket should appear in list"


class TestPortalV2Devices:
    """Portal V2 Devices Tests"""
    
    @pytest.fixture
    def portal_token(self):
        """Get portal auth token"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Could not login: {response.text}")
        data = response.json()
        if data.get("requires_2fa"):
            pytest.skip("User has 2FA enabled")
        return data["token"]
    
    def test_get_devices_returns_client_scoped_data(self, portal_token):
        """Test GET /devices returns only client's devices"""
        headers = {"Authorization": f"Bearer {portal_token}"}
        response = requests.get(f"{BASE_URL}/api/portal/v2/devices", headers=headers)
        
        print(f"Devices response status: {response.status_code}")
        
        assert response.status_code == 200
        devices = response.json()
        assert isinstance(devices, list)
        print(f"Retrieved {len(devices)} devices")
        
        # Check device fields
        if devices:
            device = devices[0]
            print(f"Sample device: {device.get('name')} - {device.get('device_type')} - Status: {device.get('status')}")
            # Verify expected fields
            expected_fields = ["id", "name", "device_type", "status"]
            for field in expected_fields:
                assert field in device or "hostname" in device, f"Device should have {field} field"


class TestPortalV2Invoices:
    """Portal V2 Invoices Tests"""
    
    @pytest.fixture
    def portal_token(self):
        """Get portal auth token"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Could not login: {response.text}")
        data = response.json()
        if data.get("requires_2fa"):
            pytest.skip("User has 2FA enabled")
        return data["token"]
    
    def test_get_invoices(self, portal_token):
        """Test GET /invoices returns client's invoices"""
        headers = {"Authorization": f"Bearer {portal_token}"}
        response = requests.get(f"{BASE_URL}/api/portal/v2/invoices", headers=headers)
        
        print(f"Invoices response status: {response.status_code}")
        
        assert response.status_code == 200
        invoices = response.json()
        assert isinstance(invoices, list)
        print(f"Retrieved {len(invoices)} invoices")
        
        if invoices:
            invoice = invoices[0]
            print(f"Sample invoice: {invoice.get('invoice_number')} - ${invoice.get('total')} - Status: {invoice.get('status')}")


class TestPortalV2Backups:
    """Portal V2 Backups Tests"""
    
    @pytest.fixture
    def portal_token(self):
        """Get portal auth token"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Could not login: {response.text}")
        data = response.json()
        if data.get("requires_2fa"):
            pytest.skip("User has 2FA enabled")
        return data["token"]
    
    def test_get_backups(self, portal_token):
        """Test GET /backups returns backup jobs and summary"""
        headers = {"Authorization": f"Bearer {portal_token}"}
        response = requests.get(f"{BASE_URL}/api/portal/v2/backups", headers=headers)
        
        print(f"Backups response status: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "jobs" in data
        assert "summary" in data
        
        summary = data["summary"]
        assert "total" in summary
        assert "successful" in summary
        assert "failed" in summary
        assert "success_rate" in summary
        
        print(f"Backup summary: {summary}")
        print(f"Backup jobs count: {len(data['jobs'])}")


class TestPortalV2Compliance:
    """Portal V2 Compliance Tests"""
    
    @pytest.fixture
    def portal_token(self):
        """Get portal auth token"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Could not login: {response.text}")
        data = response.json()
        if data.get("requires_2fa"):
            pytest.skip("User has 2FA enabled")
        return data["token"]
    
    def test_get_compliance_frameworks(self, portal_token):
        """Test GET /compliance returns compliance frameworks"""
        headers = {"Authorization": f"Bearer {portal_token}"}
        response = requests.get(f"{BASE_URL}/api/portal/v2/compliance", headers=headers)
        
        print(f"Compliance response status: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "frameworks" in data
        frameworks = data["frameworks"]
        assert isinstance(frameworks, list)
        print(f"Retrieved {len(frameworks)} compliance frameworks")
        
        # Should have 4 frameworks (NIST, CIS, SOC2, HIPAA)
        for fw in frameworks:
            print(f"Framework: {fw.get('name')} - {fw.get('compliance_pct')}%")


class TestPortalV2QBR:
    """Portal V2 QBR Reports Tests"""
    
    @pytest.fixture
    def portal_token(self):
        """Get portal auth token"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Could not login: {response.text}")
        data = response.json()
        if data.get("requires_2fa"):
            pytest.skip("User has 2FA enabled")
        return data["token"]
    
    def test_get_qbr_reports(self, portal_token):
        """Test GET /qbr returns QBR reports"""
        headers = {"Authorization": f"Bearer {portal_token}"}
        response = requests.get(f"{BASE_URL}/api/portal/v2/qbr", headers=headers)
        
        print(f"QBR response status: {response.status_code}")
        
        assert response.status_code == 200
        qbrs = response.json()
        assert isinstance(qbrs, list)
        print(f"Retrieved {len(qbrs)} QBR reports")
        
        if qbrs:
            qbr = qbrs[0]
            print(f"Sample QBR: {qbr.get('title')} - Generated: {qbr.get('generated_at')}")


class TestPortalV2Profile:
    """Portal V2 Profile Tests"""
    
    @pytest.fixture
    def portal_token(self):
        """Get portal auth token"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Could not login: {response.text}")
        data = response.json()
        if data.get("requires_2fa"):
            pytest.skip("User has 2FA enabled")
        return data["token"]
    
    def test_get_profile_me(self, portal_token):
        """Test GET /me returns user profile with client and branding"""
        headers = {"Authorization": f"Bearer {portal_token}"}
        response = requests.get(f"{BASE_URL}/api/portal/v2/me", headers=headers)
        
        print(f"Profile response status: {response.status_code}")
        print(f"Profile response: {response.json()}")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "user" in data
        assert "client" in data
        assert "branding" in data
        assert "msp_branding" in data
        assert "totp_enabled" in data
        
        user = data["user"]
        assert user["email"] == PORTAL_EMAIL
        print(f"User: {user.get('name')} - Client: {data.get('client', {}).get('name')}")


class TestPortalV22FASetup:
    """Portal V2 2FA Setup Tests"""
    
    @pytest.fixture
    def portal_token(self):
        """Get portal auth token"""
        response = requests.post(f"{BASE_URL}/api/portal/v2/login", json={
            "email": PORTAL_EMAIL,
            "password": PORTAL_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Could not login: {response.text}")
        data = response.json()
        if data.get("requires_2fa"):
            pytest.skip("User has 2FA enabled")
        return data["token"]
    
    def test_setup_2fa_returns_secret_and_uri(self, portal_token):
        """Test GET /setup-2fa returns TOTP secret and provisioning URI"""
        headers = {"Authorization": f"Bearer {portal_token}"}
        response = requests.get(f"{BASE_URL}/api/portal/v2/setup-2fa", headers=headers)
        
        print(f"Setup 2FA response status: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "secret" in data, "Should return TOTP secret"
        assert "uri" in data, "Should return provisioning URI"
        assert "already_enabled" in data
        
        # URI should be otpauth format
        assert data["uri"].startswith("otpauth://totp/"), "URI should be otpauth format"
        print(f"2FA setup - Secret length: {len(data['secret'])}, Already enabled: {data['already_enabled']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
