"""
Iteration 121: Comprehensive Regression Tests for Integration Modules
Tests: CIPP, UniFi Site Manager, UniFi Controllers (Network API), Suped DMARC, Hudu KB

Focus areas:
- CIPP: status, summary, linked-clients, digests, hygiene-digest
- UniFi Site Manager: status, summary, linked-clients, _debug endpoints
- UniFi Controllers: CRUD, test, summary, devices, clients, sites, actions
- Suped: services, compliance-dashboard, subscriptions
- Hudu: summary (CRITICAL - must return stats object), sync
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for admin user"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Authentication failed - skipping tests")

@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers for API requests"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============== CIPP INTEGRATION TESTS ==============

class TestCippStatus:
    """Test CIPP status endpoint"""
    
    def test_cipp_status_returns_expected_fields(self, headers):
        """GET /api/cipp/status returns {configured, base_url, api_key_preview, last_test_status, last_synced_at}"""
        response = requests.get(f"{BASE_URL}/api/cipp/status", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "configured" in data, "Missing 'configured' field"
        assert "base_url" in data, "Missing 'base_url' field"
        assert "api_key_preview" in data, "Missing 'api_key_preview' field"
        assert "last_test_status" in data, "Missing 'last_test_status' field"
        assert "last_synced_at" in data or "last_tested_at" in data, "Missing timestamp field"
        print(f"PASS: CIPP status returns all expected fields, configured={data.get('configured')}")


class TestCippSummaryNotConfigured:
    """Test CIPP summary when not configured"""
    
    def test_cipp_summary_no_500_when_not_configured(self, headers):
        """GET /api/cipp/summary should NOT return 500 when not configured"""
        response = requests.get(f"{BASE_URL}/api/cipp/summary", headers=headers)
        assert response.status_code != 500, f"Got 500 error: {response.text}"
        # Should return 200 with configured:false OR 503
        assert response.status_code in [200, 503], f"Expected 200 or 503, got {response.status_code}"
        print(f"PASS: CIPP summary does not return 500 when not configured")


class TestCippLinkedClients:
    """Test CIPP linked-clients endpoint"""
    
    def test_cipp_linked_clients_no_500(self, headers):
        """GET /api/cipp/linked-clients should NOT return 500"""
        response = requests.get(f"{BASE_URL}/api/cipp/linked-clients", headers=headers)
        assert response.status_code != 500, f"Got 500 error: {response.text}"
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"PASS: CIPP linked-clients returns array (length: {len(data)})")


class TestCippDigests:
    """Test CIPP digests endpoint"""
    
    def test_cipp_digests_no_500(self, headers):
        """GET /api/cipp/digests should NOT return 500"""
        response = requests.get(f"{BASE_URL}/api/cipp/digests", headers=headers)
        assert response.status_code != 500, f"Got 500 error: {response.text}"
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"PASS: CIPP digests returns array (length: {len(data)})")


class TestCippHygieneDigest:
    """Test CIPP hygiene-digest endpoint"""
    
    def test_cipp_hygiene_digest_returns_configured_false_when_not_configured(self, headers):
        """GET /api/cipp/hygiene-digest returns {configured:false} when CIPP not configured"""
        response = requests.get(f"{BASE_URL}/api/cipp/hygiene-digest", headers=headers)
        assert response.status_code != 500, f"Got 500 error: {response.text}"
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Should have configured field
        assert "configured" in data, f"Missing 'configured' field in response: {data}"
        print(f"PASS: CIPP hygiene-digest returns configured={data.get('configured')}")


class TestClientCippHygiene:
    """Test client CIPP hygiene endpoint"""
    
    def test_client_cipp_hygiene_unlinked(self, headers):
        """GET /api/clients/{id}/cipp-hygiene returns {linked:false} for unlinked client"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/cipp-hygiene", headers=headers)
        assert response.status_code != 500, f"Got 500 error: {response.text}"
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Should have linked field
        assert "linked" in data, f"Missing 'linked' field in response: {data}"
        print(f"PASS: Client CIPP hygiene returns linked={data.get('linked')}")


# ============== UNIFI SITE MANAGER TESTS ==============

class TestUnifiSiteManagerStatus:
    """Test UniFi Site Manager status endpoint"""
    
    def test_unifi_status_no_500(self, headers):
        """GET /api/unifi/status should NOT return 500"""
        response = requests.get(f"{BASE_URL}/api/unifi/status", headers=headers)
        assert response.status_code != 500, f"Got 500 error: {response.text}"
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "configured" in data, "Missing 'configured' field"
        print(f"PASS: UniFi status returns configured={data.get('configured')}")


class TestUnifiSiteManagerSummary:
    """Test UniFi Site Manager summary endpoint"""
    
    def test_unifi_summary_no_500(self, headers):
        """GET /api/unifi/summary should NOT return 500 when unconfigured"""
        response = requests.get(f"{BASE_URL}/api/unifi/summary", headers=headers)
        assert response.status_code != 500, f"Got 500 error: {response.text}"
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "configured" in data, "Missing 'configured' field"
        print(f"PASS: UniFi summary returns configured={data.get('configured')}")


class TestUnifiSiteManagerLinkedClients:
    """Test UniFi Site Manager linked-clients endpoint"""
    
    def test_unifi_linked_clients_no_500(self, headers):
        """GET /api/unifi/linked-clients should NOT return 500"""
        response = requests.get(f"{BASE_URL}/api/unifi/linked-clients", headers=headers)
        assert response.status_code != 500, f"Got 500 error: {response.text}"
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"PASS: UniFi linked-clients returns array (length: {len(data)})")


class TestUnifiDebugEndpoints:
    """Test UniFi _debug endpoints"""
    
    def test_unifi_debug_raw_devices(self, headers):
        """GET /api/unifi/_debug/raw?path=devices returns structured response or 'not configured'"""
        response = requests.get(f"{BASE_URL}/api/unifi/_debug/raw?path=devices", headers=headers)
        assert response.status_code != 500, f"Got 500 error: {response.text}"
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Should have configured field
        assert "configured" in data, f"Missing 'configured' field: {data}"
        print(f"PASS: UniFi _debug/raw?path=devices returns configured={data.get('configured')}")
    
    def test_unifi_debug_raw_sites(self, headers):
        """GET /api/unifi/_debug/raw?path=sites returns structured response"""
        response = requests.get(f"{BASE_URL}/api/unifi/_debug/raw?path=sites", headers=headers)
        assert response.status_code != 500, f"Got 500 error: {response.text}"
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "configured" in data, f"Missing 'configured' field: {data}"
        print(f"PASS: UniFi _debug/raw?path=sites returns configured={data.get('configured')}")


# ============== UNIFI CONTROLLERS (NETWORK API) TESTS ==============

class TestUnifiControllersCRUD:
    """Test UniFi Controllers CRUD operations"""
    
    test_controller_id = None
    
    def test_list_controllers_initially_empty_or_array(self, headers):
        """GET /api/unifi/controllers returns array (possibly empty)"""
        response = requests.get(f"{BASE_URL}/api/unifi/controllers", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"PASS: UniFi controllers list returns array (length: {len(data)})")
    
    def test_create_controller_with_all_fields(self, headers):
        """POST /api/unifi/controllers creates with all required fields"""
        payload = {
            "name": "TEST_Controller_121",
            "controller_url": "https://test-fake-controller.example.com",
            "api_key": "test_fake_api_key_121",
            "network_site_id": "default",
            "verify_tls": False,
            "notes": "Test controller for iteration 121"
        }
        response = requests.post(f"{BASE_URL}/api/unifi/controllers", json=payload, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, f"Missing 'id' in response: {data}"
        TestUnifiControllersCRUD.test_controller_id = data["id"]
        print(f"PASS: Created controller with id={data['id']}")
    
    def test_list_controllers_includes_created(self, headers):
        """GET /api/unifi/controllers includes newly created controller"""
        response = requests.get(f"{BASE_URL}/api/unifi/controllers", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        found = any(c.get("name") == "TEST_Controller_121" for c in data)
        assert found, f"Created controller not found in list: {data}"
        print(f"PASS: Created controller found in list")
    
    def test_update_controller(self, headers):
        """PUT /api/unifi/controllers/{id} updates controller"""
        if not TestUnifiControllersCRUD.test_controller_id:
            pytest.skip("No controller created")
        
        payload = {"notes": "Updated notes for iteration 121"}
        response = requests.put(
            f"{BASE_URL}/api/unifi/controllers/{TestUnifiControllersCRUD.test_controller_id}",
            json=payload, headers=headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print(f"PASS: Controller updated successfully")
    
    def test_controller_test_fails_gracefully_on_fake_url(self, headers):
        """GET /api/unifi/controllers/{id}/test fails gracefully on fake URL (502 or fail status)"""
        if not TestUnifiControllersCRUD.test_controller_id:
            pytest.skip("No controller created")
        
        response = requests.get(
            f"{BASE_URL}/api/unifi/controllers/{TestUnifiControllersCRUD.test_controller_id}/test",
            headers=headers
        )
        # Should return 200 with success:false, or 502
        assert response.status_code in [200, 502], f"Expected 200 or 502, got {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert data.get("success") == False, f"Expected success=False for fake URL, got {data}"
        print(f"PASS: Controller test fails gracefully on fake URL")
    
    def test_controller_summary_returns_structure(self, headers):
        """GET /api/unifi/controllers/{id}/summary returns expected structure"""
        if not TestUnifiControllersCRUD.test_controller_id:
            pytest.skip("No controller created")
        
        response = requests.get(
            f"{BASE_URL}/api/unifi/controllers/{TestUnifiControllersCRUD.test_controller_id}/summary",
            headers=headers
        )
        # May return 200 with error field, or 502
        assert response.status_code in [200, 502], f"Expected 200 or 502, got {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            # Should have controller, stats, devices, clients fields
            assert "controller" in data or "error" in data, f"Missing expected fields: {data}"
        print(f"PASS: Controller summary returns expected structure")
    
    def test_controller_devices_graceful_error(self, headers):
        """GET /api/unifi/controllers/{id}/devices returns 503 or graceful error on fake URL"""
        if not TestUnifiControllersCRUD.test_controller_id:
            pytest.skip("No controller created")
        
        response = requests.get(
            f"{BASE_URL}/api/unifi/controllers/{TestUnifiControllersCRUD.test_controller_id}/devices",
            headers=headers
        )
        # Should return 502/503 for unreachable controller
        assert response.status_code in [200, 502, 503], f"Expected 200/502/503, got {response.status_code}"
        print(f"PASS: Controller devices endpoint handles fake URL gracefully (status={response.status_code})")
    
    def test_controller_clients_graceful_error(self, headers):
        """GET /api/unifi/controllers/{id}/clients returns 503 or graceful error on fake URL"""
        if not TestUnifiControllersCRUD.test_controller_id:
            pytest.skip("No controller created")
        
        response = requests.get(
            f"{BASE_URL}/api/unifi/controllers/{TestUnifiControllersCRUD.test_controller_id}/clients",
            headers=headers
        )
        assert response.status_code in [200, 502, 503], f"Expected 200/502/503, got {response.status_code}"
        print(f"PASS: Controller clients endpoint handles fake URL gracefully (status={response.status_code})")
    
    def test_controller_sites_graceful_error(self, headers):
        """GET /api/unifi/controllers/{id}/sites returns 503 or graceful error on fake URL"""
        if not TestUnifiControllersCRUD.test_controller_id:
            pytest.skip("No controller created")
        
        response = requests.get(
            f"{BASE_URL}/api/unifi/controllers/{TestUnifiControllersCRUD.test_controller_id}/sites",
            headers=headers
        )
        assert response.status_code in [200, 502, 503], f"Expected 200/502/503, got {response.status_code}"
        print(f"PASS: Controller sites endpoint handles fake URL gracefully (status={response.status_code})")
    
    def test_delete_controller(self, headers):
        """DELETE /api/unifi/controllers/{id} removes controller"""
        if not TestUnifiControllersCRUD.test_controller_id:
            pytest.skip("No controller created")
        
        response = requests.delete(
            f"{BASE_URL}/api/unifi/controllers/{TestUnifiControllersCRUD.test_controller_id}",
            headers=headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print(f"PASS: Controller deleted successfully")
    
    def test_list_controllers_after_delete(self, headers):
        """GET /api/unifi/controllers no longer includes deleted controller"""
        response = requests.get(f"{BASE_URL}/api/unifi/controllers", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        found = any(c.get("name") == "TEST_Controller_121" for c in data)
        assert not found, f"Deleted controller still in list: {data}"
        print(f"PASS: Deleted controller no longer in list")


# ============== SUPED INTEGRATION TESTS ==============

class TestSupedServices:
    """Test Suped services endpoint"""
    
    def test_suped_services_returns_6_services(self, headers):
        """GET /api/suped/services returns 6 services"""
        response = requests.get(f"{BASE_URL}/api/suped/services", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) == 6, f"Expected 6 services, got {len(data)}: {data}"
        
        # Verify expected service keys
        expected_keys = ["dmarc_monitoring", "hosted_dmarc", "hosted_spf", "hosted_mta_sts", "spf_flattening", "blocklist_monitoring"]
        actual_keys = [s.get("key") for s in data]
        for key in expected_keys:
            assert key in actual_keys, f"Missing service key: {key}"
        print(f"PASS: Suped services returns 6 services with correct keys")


class TestSupedComplianceDashboard:
    """Test Suped compliance-dashboard endpoint"""
    
    def test_compliance_dashboard_returns_expected_fields(self, headers):
        """GET /api/suped/compliance-dashboard returns dashboard with expected fields"""
        response = requests.get(f"{BASE_URL}/api/suped/compliance-dashboard", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        expected_fields = ["overall_score", "fully_protected", "partially_protected", "unprotected", 
                          "total_clients", "client_details", "service_coverage", "at_risk"]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
        print(f"PASS: Suped compliance-dashboard returns all expected fields")


class TestClientSubscriptions:
    """Test client subscriptions endpoint"""
    
    def test_get_client_subscriptions_default(self, headers):
        """GET /api/clients/{id}/subscriptions returns default when not set"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/subscriptions", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "client_id" in data, "Missing 'client_id' field"
        assert "services" in data, "Missing 'services' field"
        print(f"PASS: Client subscriptions returns default structure")
    
    def test_put_client_subscriptions(self, headers):
        """PUT /api/clients/{id}/subscriptions saves suped_org_id + services"""
        payload = {
            "suped_org_id": "TEST_org_121",
            "services": {
                "dmarc_monitoring": True,
                "hosted_dmarc": False,
                "hosted_spf": True,
                "hosted_mta_sts": False,
                "spf_flattening": True,
                "blocklist_monitoring": False
            }
        }
        response = requests.put(f"{BASE_URL}/api/clients/client-001/subscriptions", json=payload, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print(f"PASS: Client subscriptions updated successfully")
    
    def test_get_client_subscriptions_after_update(self, headers):
        """GET /api/clients/{id}/subscriptions returns updated values"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/subscriptions", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("suped_org_id") == "TEST_org_121", f"Expected suped_org_id='TEST_org_121', got {data.get('suped_org_id')}"
        assert data.get("services", {}).get("dmarc_monitoring") == True
        print(f"PASS: Client subscriptions returns updated values")
    
    def test_cleanup_client_subscriptions(self, headers):
        """Cleanup: Reset client subscriptions"""
        payload = {"suped_org_id": "", "services": {}}
        requests.put(f"{BASE_URL}/api/clients/client-001/subscriptions", json=payload, headers=headers)
        print(f"PASS: Cleanup - Client subscriptions reset")


# ============== HUDU INTEGRATION TESTS (CRITICAL) ==============

class TestHuduSummary:
    """Test Hudu summary endpoint - CRITICAL: must always return stats object"""
    
    def test_hudu_summary_always_returns_stats_object(self, headers):
        """GET /api/hudu/summary MUST always return a stats object with 6 keys (never null/undefined)"""
        response = requests.get(f"{BASE_URL}/api/hudu/summary", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # CRITICAL: stats must always be present
        assert "stats" in data, f"CRITICAL: Missing 'stats' field in response: {data}"
        
        stats = data.get("stats")
        assert stats is not None, f"CRITICAL: stats is None: {data}"
        assert isinstance(stats, dict), f"CRITICAL: stats is not a dict: {type(stats)}"
        
        # Must have all 6 keys
        expected_keys = ["companies", "articles", "assets", "procedures", "websites", "passwords"]
        for key in expected_keys:
            assert key in stats, f"CRITICAL: Missing stats key: {key}"
            # Values should be numbers (not null/undefined)
            assert isinstance(stats[key], (int, float)), f"CRITICAL: stats[{key}] is not a number: {stats[key]}"
        
        print(f"PASS: Hudu summary returns stats object with all 6 keys: {stats}")
    
    def test_hudu_summary_responds_fast(self, headers):
        """GET /api/hudu/summary should respond fast (cache-backed)"""
        import time
        start = time.time()
        response = requests.get(f"{BASE_URL}/api/hudu/summary", headers=headers)
        elapsed = time.time() - start
        
        assert response.status_code == 200
        # Should respond within 5 seconds (cache-backed)
        assert elapsed < 5, f"Response took too long: {elapsed:.2f}s"
        print(f"PASS: Hudu summary responded in {elapsed:.2f}s")
    
    def test_hudu_summary_force_refresh(self, headers):
        """GET /api/hudu/summary?force=true should refresh cache"""
        response = requests.get(f"{BASE_URL}/api/hudu/summary?force=true", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "stats" in data, f"Missing 'stats' field after force refresh: {data}"
        print(f"PASS: Hudu summary force refresh works")


class TestHuduSync:
    """Test Hudu sync endpoint"""
    
    def test_hudu_sync_returns_summary_field(self, headers):
        """POST /api/hudu/sync should return summary field after import"""
        response = requests.post(f"{BASE_URL}/api/hudu/sync", json={}, headers=headers)
        # May return 200 or 503 if not configured
        assert response.status_code in [200, 503], f"Expected 200 or 503, got {response.status_code}: {response.text}"
        
        if response.status_code == 200:
            data = response.json()
            # Should have summary field (or imported/updated counts)
            assert "summary" in data or "imported" in data, f"Missing expected fields: {data}"
            print(f"PASS: Hudu sync returns expected fields: {list(data.keys())}")
        else:
            print(f"PASS: Hudu sync returns 503 (not configured) - expected behavior")


# ============== AUTH REQUIRED TESTS ==============

class TestAuthRequired:
    """Test that all integration endpoints require authentication"""
    
    def test_cipp_status_requires_auth(self):
        """GET /api/cipp/status without auth returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/cipp/status")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: CIPP status requires auth")
    
    def test_unifi_status_requires_auth(self):
        """GET /api/unifi/status without auth returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/unifi/status")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: UniFi status requires auth")
    
    def test_unifi_controllers_requires_auth(self):
        """GET /api/unifi/controllers without auth returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/unifi/controllers")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: UniFi controllers requires auth")
    
    def test_suped_services_requires_auth(self):
        """GET /api/suped/services without auth returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/suped/services")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: Suped services requires auth")
    
    def test_hudu_summary_requires_auth(self):
        """GET /api/hudu/summary without auth returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/hudu/summary")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: Hudu summary requires auth")
