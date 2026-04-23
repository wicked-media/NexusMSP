"""
Test CIPP and Suped integration endpoints for iteration 118.
Tests:
- CIPP settings (status, save, test, delete)
- CIPP tenant/user/license endpoints (expect 503 when not configured)
- CIPP client linking (link/unlink cipp tenant, link suped tenant)
- Suped services and compliance dashboard
- Client subscriptions
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Authentication failed - skipping tests")

@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}

@pytest.fixture(scope="module")
def test_client_id(headers):
    """Get or create a test client for linking tests"""
    # First try to get existing clients
    response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
    if response.status_code == 200 and response.json():
        return response.json()[0].get("id")
    # Create a test client if none exist
    response = requests.post(f"{BASE_URL}/api/clients", headers=headers, json={
        "name": f"TEST_CIPP_Client_{uuid.uuid4().hex[:8]}",
        "industry": "Technology",
        "lifecycle": "active"
    })
    if response.status_code in [200, 201]:
        return response.json().get("id")
    pytest.skip("Could not get or create test client")


class TestCippStatus:
    """Test CIPP status endpoint"""
    
    def test_cipp_status_requires_auth(self):
        """GET /api/cipp/status requires authentication"""
        response = requests.get(f"{BASE_URL}/api/cipp/status")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("PASS: CIPP status requires auth")
    
    def test_cipp_status_returns_structure(self, headers):
        """GET /api/cipp/status returns proper structure"""
        response = requests.get(f"{BASE_URL}/api/cipp/status", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "configured" in data, "Missing 'configured' key"
        assert isinstance(data["configured"], bool), "'configured' should be boolean"
        assert "base_url" in data, "Missing 'base_url' key"
        print(f"PASS: CIPP status returns structure - configured={data['configured']}")


class TestCippSettings:
    """Test CIPP settings save/delete"""
    
    def test_cipp_save_settings(self, headers):
        """POST /api/cipp/settings saves base_url + api_key"""
        response = requests.post(f"{BASE_URL}/api/cipp/settings", headers=headers, json={
            "base_url": "https://fake-cipp.azurewebsites.net/api",
            "api_key": "test-api-key-12345"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "message" in data, "Missing 'message' in response"
        print("PASS: CIPP settings saved")
    
    def test_cipp_status_after_save(self, headers):
        """GET /api/cipp/status after save returns configured:true with api_key_preview"""
        response = requests.get(f"{BASE_URL}/api/cipp/status", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["configured"] == True, f"Expected configured=True, got {data['configured']}"
        assert data.get("api_key_preview") is not None, "Missing api_key_preview"
        assert "…" in data["api_key_preview"], "api_key_preview should be masked with …"
        print(f"PASS: CIPP status shows configured=True, preview={data['api_key_preview']}")
    
    def test_cipp_test_connection(self, headers):
        """GET /api/cipp/test returns connection status (expected failure on fake URL)"""
        response = requests.get(f"{BASE_URL}/api/cipp/test", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "success" in data, "Missing 'success' key"
        assert "message" in data, "Missing 'message' key"
        # Expected to fail since we're using a fake URL
        assert data["success"] == False, "Expected success=False for fake URL"
        print(f"PASS: CIPP test returns expected failure - {data['message'][:50]}")
    
    def test_cipp_delete_settings(self, headers):
        """DELETE /api/cipp/settings removes credentials"""
        response = requests.delete(f"{BASE_URL}/api/cipp/settings", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "message" in data
        print("PASS: CIPP settings deleted")
    
    def test_cipp_status_after_delete(self, headers):
        """GET /api/cipp/status after delete returns configured:false"""
        response = requests.get(f"{BASE_URL}/api/cipp/status", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["configured"] == False, f"Expected configured=False, got {data['configured']}"
        print("PASS: CIPP status shows configured=False after delete")


class TestCippSummaryWhenNotConfigured:
    """Test CIPP summary when not configured"""
    
    def test_cipp_summary_not_configured(self, headers):
        """GET /api/cipp/summary returns {configured:false} when not configured"""
        # First ensure CIPP is not configured
        requests.delete(f"{BASE_URL}/api/cipp/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/cipp/summary", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("configured") == False, f"Expected configured=False, got {data}"
        print("PASS: CIPP summary returns configured=False when not configured")


class TestCippLinkedClients:
    """Test CIPP linked clients endpoint"""
    
    def test_cipp_linked_clients(self, headers):
        """GET /api/cipp/linked-clients returns array (empty ok)"""
        response = requests.get(f"{BASE_URL}/api/cipp/linked-clients", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"PASS: CIPP linked-clients returns array with {len(data)} items")


class TestCippTenantsNotConfigured:
    """Test CIPP tenant endpoints return 503 when not configured"""
    
    def test_cipp_tenants_not_configured(self, headers):
        """GET /api/cipp/tenants returns 503 when not configured"""
        # Ensure not configured
        requests.delete(f"{BASE_URL}/api/cipp/settings", headers=headers)
        
        response = requests.get(f"{BASE_URL}/api/cipp/tenants", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        data = response.json()
        assert "CIPP not configured" in data.get("detail", ""), f"Expected 'CIPP not configured' in detail"
        print("PASS: CIPP tenants returns 503 when not configured")
    
    def test_cipp_tenant_users_not_configured(self, headers):
        """GET /api/cipp/tenants/{tenant_id}/users returns 503 when not configured"""
        response = requests.get(f"{BASE_URL}/api/cipp/tenants/fake-tenant/users", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print("PASS: CIPP tenant users returns 503 when not configured")
    
    def test_cipp_tenant_licenses_not_configured(self, headers):
        """GET /api/cipp/tenants/{tenant_id}/licenses returns 503 when not configured"""
        response = requests.get(f"{BASE_URL}/api/cipp/tenants/fake-tenant/licenses", headers=headers)
        assert response.status_code == 503, f"Expected 503, got {response.status_code}"
        print("PASS: CIPP tenant licenses returns 503 when not configured")


class TestClientCippLinking:
    """Test client CIPP tenant linking"""
    
    def test_link_cipp_tenant(self, headers, test_client_id):
        """POST /api/clients/{client_id}/link-cipp-tenant links a tenant to a client"""
        response = requests.post(f"{BASE_URL}/api/clients/{test_client_id}/link-cipp-tenant", headers=headers, json={
            "tenant_id": "test-tenant-id-12345",
            "tenant_display": "Test Tenant Display",
            "tenant_domain": "testtenant.onmicrosoft.com"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "message" in data
        assert data.get("tenant_id") == "test-tenant-id-12345"
        print(f"PASS: CIPP tenant linked to client {test_client_id}")
    
    def test_verify_cipp_tenant_linked(self, headers, test_client_id):
        """Verify client has cipp_tenant_id set"""
        response = requests.get(f"{BASE_URL}/api/clients/{test_client_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("cipp_tenant_id") == "test-tenant-id-12345", f"Expected cipp_tenant_id, got {data.get('cipp_tenant_id')}"
        print("PASS: Client has cipp_tenant_id set")
    
    def test_unlink_cipp_tenant(self, headers, test_client_id):
        """DELETE /api/clients/{client_id}/link-cipp-tenant unlinks tenant"""
        response = requests.delete(f"{BASE_URL}/api/clients/{test_client_id}/link-cipp-tenant", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "message" in data
        print("PASS: CIPP tenant unlinked")
    
    def test_verify_cipp_tenant_unlinked(self, headers, test_client_id):
        """Verify client no longer has cipp_tenant_id"""
        response = requests.get(f"{BASE_URL}/api/clients/{test_client_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert not data.get("cipp_tenant_id"), f"Expected no cipp_tenant_id, got {data.get('cipp_tenant_id')}"
        print("PASS: Client cipp_tenant_id removed")


class TestClientSupedLinking:
    """Test client Suped tenant linking"""
    
    def test_link_suped_tenant(self, headers, test_client_id):
        """POST /api/clients/{client_id}/link-suped-tenant links a Suped tenant"""
        response = requests.post(f"{BASE_URL}/api/clients/{test_client_id}/link-suped-tenant", headers=headers, json={
            "tenant_id": "suped-org-12345",
            "tenant_display": "Suped Test Org"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "message" in data
        assert data.get("tenant_id") == "suped-org-12345"
        print(f"PASS: Suped tenant linked to client {test_client_id}")
    
    def test_verify_suped_tenant_linked(self, headers, test_client_id):
        """Verify client has suped_tenant_id set"""
        response = requests.get(f"{BASE_URL}/api/clients/{test_client_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("suped_tenant_id") == "suped-org-12345", f"Expected suped_tenant_id, got {data.get('suped_tenant_id')}"
        print("PASS: Client has suped_tenant_id set")
    
    def test_unlink_suped_tenant(self, headers, test_client_id):
        """DELETE /api/clients/{client_id}/link-suped-tenant unlinks tenant"""
        response = requests.delete(f"{BASE_URL}/api/clients/{test_client_id}/link-suped-tenant", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("PASS: Suped tenant unlinked")


class TestSupedServices:
    """Test Suped services endpoint"""
    
    def test_suped_services(self, headers):
        """GET /api/suped/services returns 6 services"""
        response = requests.get(f"{BASE_URL}/api/suped/services", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) == 6, f"Expected 6 services, got {len(data)}"
        
        # Verify expected service keys
        expected_keys = ["dmarc_monitoring", "hosted_dmarc", "hosted_spf", "hosted_mta_sts", "spf_flattening", "blocklist_monitoring"]
        actual_keys = [s["key"] for s in data]
        for key in expected_keys:
            assert key in actual_keys, f"Missing service key: {key}"
        
        print(f"PASS: Suped services returns 6 services: {actual_keys}")


class TestSupedComplianceDashboard:
    """Test Suped compliance dashboard"""
    
    def test_suped_compliance_dashboard(self, headers):
        """GET /api/suped/compliance-dashboard returns overall_score + client_details array"""
        response = requests.get(f"{BASE_URL}/api/suped/compliance-dashboard", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert "overall_score" in data, "Missing 'overall_score'"
        assert isinstance(data["overall_score"], (int, float)), "'overall_score' should be numeric"
        
        assert "client_details" in data, "Missing 'client_details'"
        assert isinstance(data["client_details"], list), "'client_details' should be list"
        
        assert "total_clients" in data, "Missing 'total_clients'"
        assert "fully_protected" in data, "Missing 'fully_protected'"
        assert "partially_protected" in data, "Missing 'partially_protected'"
        assert "unprotected" in data, "Missing 'unprotected'"
        assert "service_coverage" in data, "Missing 'service_coverage'"
        
        print(f"PASS: Suped compliance dashboard - overall_score={data['overall_score']}, clients={data['total_clients']}")


class TestClientSubscriptions:
    """Test client subscriptions endpoints"""
    
    def test_get_client_subscriptions_default(self, headers, test_client_id):
        """GET /api/clients/{client_id}/subscriptions returns default when not set"""
        response = requests.get(f"{BASE_URL}/api/clients/{test_client_id}/subscriptions", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert "client_id" in data, "Missing 'client_id'"
        assert "suped_org_id" in data, "Missing 'suped_org_id'"
        assert "services" in data, "Missing 'services'"
        assert isinstance(data["services"], dict), "'services' should be dict"
        
        print(f"PASS: Client subscriptions returns default structure")
    
    def test_put_client_subscriptions(self, headers, test_client_id):
        """PUT /api/clients/{client_id}/subscriptions saves suped_org_id + services map"""
        response = requests.put(f"{BASE_URL}/api/clients/{test_client_id}/subscriptions", headers=headers, json={
            "suped_org_id": "org_test_12345",
            "services": {
                "dmarc_monitoring": True,
                "hosted_dmarc": True,
                "hosted_spf": False,
                "hosted_mta_sts": False,
                "spf_flattening": True,
                "blocklist_monitoring": False
            }
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "message" in data
        print("PASS: Client subscriptions saved")
    
    def test_verify_client_subscriptions(self, headers, test_client_id):
        """Verify subscriptions were saved correctly"""
        response = requests.get(f"{BASE_URL}/api/clients/{test_client_id}/subscriptions", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("suped_org_id") == "org_test_12345", f"Expected suped_org_id='org_test_12345', got {data.get('suped_org_id')}"
        assert data["services"].get("dmarc_monitoring") == True
        assert data["services"].get("hosted_spf") == False
        
        print("PASS: Client subscriptions verified")


class TestCippSettingsValidation:
    """Test CIPP settings validation"""
    
    def test_cipp_save_settings_missing_base_url(self, headers):
        """POST /api/cipp/settings with missing base_url returns 400"""
        response = requests.post(f"{BASE_URL}/api/cipp/settings", headers=headers, json={
            "api_key": "test-key"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("PASS: CIPP settings rejects missing base_url")
    
    def test_cipp_save_settings_missing_api_key(self, headers):
        """POST /api/cipp/settings with missing api_key returns 400"""
        response = requests.post(f"{BASE_URL}/api/cipp/settings", headers=headers, json={
            "base_url": "https://test.com"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("PASS: CIPP settings rejects missing api_key")


class TestCippLinkValidation:
    """Test CIPP link validation"""
    
    def test_link_cipp_tenant_missing_tenant_id(self, headers, test_client_id):
        """POST /api/clients/{client_id}/link-cipp-tenant with missing tenant_id returns 400"""
        response = requests.post(f"{BASE_URL}/api/clients/{test_client_id}/link-cipp-tenant", headers=headers, json={
            "tenant_display": "Test"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("PASS: CIPP link rejects missing tenant_id")
    
    def test_link_suped_tenant_missing_tenant_id(self, headers, test_client_id):
        """POST /api/clients/{client_id}/link-suped-tenant with missing tenant_id returns 400"""
        response = requests.post(f"{BASE_URL}/api/clients/{test_client_id}/link-suped-tenant", headers=headers, json={
            "tenant_display": "Test"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("PASS: Suped link rejects missing tenant_id")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
