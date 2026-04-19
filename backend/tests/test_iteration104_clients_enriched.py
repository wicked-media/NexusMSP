"""
Iteration 104: Clients Page Revamp + /clients-enriched Endpoint Tests
Tests the new one-shot enriched endpoint and verifies data structure.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for admin user"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json().get("token")

@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers for API requests"""
    return {"Authorization": f"Bearer {auth_token}"}


class TestClientsEnrichedEndpoint:
    """Tests for GET /api/clients-enriched endpoint"""
    
    def test_clients_enriched_returns_200(self, headers):
        """Verify endpoint returns 200 OK"""
        response = requests.get(f"{BASE_URL}/api/clients-enriched", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("PASS: /api/clients-enriched returns 200")
    
    def test_clients_enriched_has_summary_and_clients(self, headers):
        """Verify response structure has summary and clients array"""
        response = requests.get(f"{BASE_URL}/api/clients-enriched", headers=headers)
        data = response.json()
        
        assert "summary" in data, "Response missing 'summary' field"
        assert "clients" in data, "Response missing 'clients' field"
        assert isinstance(data["clients"], list), "'clients' should be a list"
        print(f"PASS: Response has summary and {len(data['clients'])} clients")
    
    def test_summary_has_required_fields(self, headers):
        """Verify summary contains all required portfolio metrics"""
        response = requests.get(f"{BASE_URL}/api/clients-enriched", headers=headers)
        summary = response.json().get("summary", {})
        
        required_fields = ["client_count", "total_mrr", "avg_health", "at_risk", "churned", "prospects", "with_acronis", "with_pax8"]
        for field in required_fields:
            assert field in summary, f"Summary missing '{field}' field"
        
        print(f"PASS: Summary has all required fields: {required_fields}")
        print(f"  - client_count: {summary['client_count']}")
        print(f"  - total_mrr: ${summary['total_mrr']}")
        print(f"  - avg_health: {summary['avg_health']}")
        print(f"  - at_risk: {summary['at_risk']}")
        print(f"  - with_acronis: {summary['with_acronis']}")
        print(f"  - with_pax8: {summary['with_pax8']}")
    
    def test_client_has_required_fields(self, headers):
        """Verify each client has all required enriched fields"""
        response = requests.get(f"{BASE_URL}/api/clients-enriched", headers=headers)
        clients = response.json().get("clients", [])
        
        assert len(clients) > 0, "No clients returned"
        
        required_fields = [
            "id", "name", "industry", "tier", "lifecycle", "health_score", "risk_level",
            "mrr", "mrr_trend", "open_tickets", "asset_count", "assets_online",
            "contact_count", "overdue_count", "overdue_amount", "active_contracts",
            "integrations", "last_activity", "primary_contact", "email", "phone", "address"
        ]
        
        client = clients[0]
        for field in required_fields:
            assert field in client, f"Client missing '{field}' field"
        
        print(f"PASS: Client has all {len(required_fields)} required fields")
    
    def test_client_integrations_structure(self, headers):
        """Verify integrations object has acronis, pax8, m365, rmm flags"""
        response = requests.get(f"{BASE_URL}/api/clients-enriched", headers=headers)
        clients = response.json().get("clients", [])
        
        assert len(clients) > 0, "No clients returned"
        
        integrations = clients[0].get("integrations", {})
        required_integration_flags = ["acronis", "pax8", "m365", "rmm"]
        
        for flag in required_integration_flags:
            assert flag in integrations, f"Integrations missing '{flag}' flag"
            assert isinstance(integrations[flag], bool), f"'{flag}' should be boolean"
        
        print(f"PASS: Integrations has all flags: {required_integration_flags}")
    
    def test_mrr_trend_is_12_months(self, headers):
        """Verify mrr_trend contains 12 months of data"""
        response = requests.get(f"{BASE_URL}/api/clients-enriched", headers=headers)
        clients = response.json().get("clients", [])
        
        assert len(clients) > 0, "No clients returned"
        
        mrr_trend = clients[0].get("mrr_trend", [])
        assert isinstance(mrr_trend, list), "mrr_trend should be a list"
        assert len(mrr_trend) == 12, f"mrr_trend should have 12 months, got {len(mrr_trend)}"
        
        # Verify each entry has month and value
        for entry in mrr_trend:
            assert "month" in entry, "mrr_trend entry missing 'month'"
            assert "value" in entry, "mrr_trend entry missing 'value'"
        
        print(f"PASS: mrr_trend has 12 months of data")
    
    def test_acme_corporation_has_acronis_and_pax8(self, headers):
        """Verify Acme Corporation (client-001) is linked to Acronis and Pax8"""
        response = requests.get(f"{BASE_URL}/api/clients-enriched", headers=headers)
        clients = response.json().get("clients", [])
        
        acme = next((c for c in clients if c["id"] == "client-001"), None)
        assert acme is not None, "Acme Corporation (client-001) not found"
        
        integrations = acme.get("integrations", {})
        assert integrations.get("acronis") == True, "Acme should have Acronis linked"
        assert integrations.get("pax8") == True, "Acme should have Pax8 linked"
        
        print(f"PASS: Acme Corporation has Acronis={integrations['acronis']}, Pax8={integrations['pax8']}")
    
    def test_summary_counts_match_data(self, headers):
        """Verify summary counts match actual client data"""
        response = requests.get(f"{BASE_URL}/api/clients-enriched", headers=headers)
        data = response.json()
        summary = data.get("summary", {})
        clients = data.get("clients", [])
        
        # Verify client_count
        assert summary["client_count"] == len(clients), f"client_count mismatch: {summary['client_count']} vs {len(clients)}"
        
        # Verify at_risk count
        at_risk_count = sum(1 for c in clients if c.get("risk_level") in ("at_risk", "critical"))
        assert summary["at_risk"] == at_risk_count, f"at_risk mismatch: {summary['at_risk']} vs {at_risk_count}"
        
        # Verify with_acronis count
        acronis_count = sum(1 for c in clients if c.get("integrations", {}).get("acronis"))
        assert summary["with_acronis"] == acronis_count, f"with_acronis mismatch: {summary['with_acronis']} vs {acronis_count}"
        
        # Verify with_pax8 count
        pax8_count = sum(1 for c in clients if c.get("integrations", {}).get("pax8"))
        assert summary["with_pax8"] == pax8_count, f"with_pax8 mismatch: {summary['with_pax8']} vs {pax8_count}"
        
        print(f"PASS: Summary counts match actual data")
        print(f"  - client_count: {summary['client_count']}")
        print(f"  - at_risk: {summary['at_risk']}")
        print(f"  - with_acronis: {summary['with_acronis']}")
        print(f"  - with_pax8: {summary['with_pax8']}")


class TestClientsBasicEndpoints:
    """Tests for basic /api/clients CRUD endpoints (regression)"""
    
    def test_get_clients_list(self, headers):
        """Verify GET /api/clients returns list"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert isinstance(response.json(), list), "Response should be a list"
        print(f"PASS: GET /api/clients returns {len(response.json())} clients")
    
    def test_get_single_client(self, headers):
        """Verify GET /api/clients/{id} returns client details"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("id") == "client-001", "Client ID mismatch"
        print(f"PASS: GET /api/clients/client-001 returns {data.get('name')}")
    
    def test_get_client_health(self, headers):
        """Verify GET /api/clients/{id}/health returns health score"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/health", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "health_score" in data, "Response missing health_score"
        assert "risk_level" in data, "Response missing risk_level"
        assert "breakdown" in data, "Response missing breakdown"
        print(f"PASS: Client health score: {data['health_score']}, risk: {data['risk_level']}")
    
    def test_get_client_activity_timeline(self, headers):
        """Verify GET /api/clients/{id}/activity-timeline returns timeline"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/activity-timeline", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: Activity timeline has {len(data)} entries")


class TestCreateClient:
    """Tests for POST /api/clients endpoint"""
    
    def test_create_client_success(self, headers):
        """Verify POST /api/clients creates a new client"""
        payload = {
            "name": "TEST_NewClient_Iter104",
            "industry": "Technology",
            "email": "test@iter104.com",
            "phone": "555-0104"
        }
        response = requests.post(f"{BASE_URL}/api/clients", json=payload, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("name") == payload["name"], "Name mismatch"
        assert data.get("industry") == payload["industry"], "Industry mismatch"
        assert data.get("email") == payload["email"], "Email mismatch"
        assert data.get("phone") == payload["phone"], "Phone mismatch"
        
        # Verify client appears in enriched list
        enriched = requests.get(f"{BASE_URL}/api/clients-enriched", headers=headers)
        clients = enriched.json().get("clients", [])
        created = next((c for c in clients if c["name"] == payload["name"]), None)
        assert created is not None, "Created client not found in enriched list"
        
        print(f"PASS: Created client {data.get('id')} - {data.get('name')}")
        
        # Cleanup
        if data.get("id"):
            requests.delete(f"{BASE_URL}/api/clients/{data['id']}", headers=headers)
            print(f"  - Cleaned up test client")
    
    def test_create_client_minimal(self, headers):
        """Verify POST /api/clients works with minimal data"""
        payload = {"name": "TEST_MinimalClient_Iter104"}
        response = requests.post(f"{BASE_URL}/api/clients", json=payload, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("name") == payload["name"], "Name mismatch"
        
        print(f"PASS: Created minimal client {data.get('id')}")
        
        # Cleanup
        if data.get("id"):
            requests.delete(f"{BASE_URL}/api/clients/{data['id']}", headers=headers)


class TestAuthRequired:
    """Verify endpoints require authentication"""
    
    def test_clients_enriched_requires_auth(self):
        """Verify /api/clients-enriched requires auth"""
        response = requests.get(f"{BASE_URL}/api/clients-enriched")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: /api/clients-enriched requires authentication")
    
    def test_clients_requires_auth(self):
        """Verify /api/clients requires auth"""
        response = requests.get(f"{BASE_URL}/api/clients")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: /api/clients requires authentication")
