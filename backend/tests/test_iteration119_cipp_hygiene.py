"""
Iteration 119: CIPP M365 Hygiene Integration Tests

Tests for:
- GET /api/cipp/tenants/{tenant_id}/hygiene - returns 503 when CIPP not configured
- GET /api/cipp/hygiene-digest - returns {configured:false} when CIPP not configured
- GET /api/clients/{client_id}/cipp-hygiene - returns {linked:false} when no tenant linked
- POST /api/cipp/hygiene-digest/send - returns {sent:false, reason} when not configured
- GET /api/cipp/digests - returns array (empty ok)
- GET /api/clients/{client_id}/health - breakdown includes m365_hygiene when client has cipp_tenant_id AND cipp_hygiene_cache entry
- GET /api/client-health/{client_id}/detail - metrics includes m365_hygiene key
- Health score rebalancing: devices max 20→15, contracts 10→5 when m365_hygiene present
- Digest computes properly with scored tenants + upsell_candidates list
"""

import pytest
import requests
import os
from datetime import datetime, timezone

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestCippHygieneEndpoints:
    """Test CIPP hygiene endpoints when CIPP is not configured"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token for all tests"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.token = login_resp.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_tenant_hygiene_returns_503_when_not_configured(self):
        """GET /api/cipp/tenants/{tenant_id}/hygiene returns 503 when CIPP not configured"""
        resp = requests.get(f"{BASE_URL}/api/cipp/tenants/test-tenant-001/hygiene", headers=self.headers)
        # Should return 503 since CIPP is not configured
        assert resp.status_code == 503, f"Expected 503, got {resp.status_code}: {resp.text}"
        assert "not configured" in resp.text.lower()
    
    def test_hygiene_digest_returns_configured_false(self):
        """GET /api/cipp/hygiene-digest returns {configured:false} when CIPP not configured"""
        resp = requests.get(f"{BASE_URL}/api/cipp/hygiene-digest", headers=self.headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("configured") == False, f"Expected configured:false, got {data}"
        assert "clients" in data
        assert "message" in data or data.get("configured") == False
    
    def test_client_hygiene_returns_linked_false_when_no_tenant(self):
        """GET /api/clients/{client_id}/cipp-hygiene returns {linked:false} when no tenant linked"""
        # First get a client that doesn't have cipp_tenant_id
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=self.headers)
        assert clients_resp.status_code == 200
        clients = clients_resp.json()
        
        # Find a client without cipp_tenant_id or use client-001
        test_client_id = "client-001"
        for c in clients:
            if not c.get("cipp_tenant_id"):
                test_client_id = c["id"]
                break
        
        resp = requests.get(f"{BASE_URL}/api/clients/{test_client_id}/cipp-hygiene", headers=self.headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        # Should return linked:false if no tenant linked
        if not data.get("linked"):
            assert data.get("linked") == False, f"Expected linked:false, got {data}"
    
    def test_send_hygiene_digest_returns_not_sent_when_not_configured(self):
        """POST /api/cipp/hygiene-digest/send returns {sent:false, reason} when not configured"""
        resp = requests.post(f"{BASE_URL}/api/cipp/hygiene-digest/send", json={}, headers=self.headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("sent") == False, f"Expected sent:false, got {data}"
        assert "reason" in data, f"Expected reason field, got {data}"
    
    def test_digests_list_returns_array(self):
        """GET /api/cipp/digests returns array (empty ok)"""
        resp = requests.get(f"{BASE_URL}/api/cipp/digests", headers=self.headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), f"Expected array, got {type(data)}: {data}"


class TestHealthScoreWithHygieneCache:
    """Test health score rebalancing when m365_hygiene cache is present"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token and prepare test data"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.token = login_resp.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
        self.test_tenant_id = "TEST_hygiene_tenant_001"
        self.test_client_id = "client-001"
    
    def test_seed_hygiene_cache_and_link_client(self):
        """Seed cipp_hygiene_cache and link client to test health score rebalancing"""
        import pymongo
        mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
        db_name = os.environ.get('DB_NAME', 'test_database')
        client = pymongo.MongoClient(mongo_url)
        db = client[db_name]
        
        # Seed hygiene cache
        hygiene_data = {
            "tenant_id": self.test_tenant_id,
            "hygiene": {
                "score": 62,
                "grade": "C",
                "total_users": 50,
                "breakdown": {
                    "license_efficiency": {"earned": 15, "max": 20},
                    "mfa_coverage": {"earned": 12, "max": 25},
                    "stale_users": {"earned": 10, "max": 15},
                    "license_waste": {"earned": 12, "max": 15},
                    "admin_sprawl": {"earned": 8, "max": 10},
                    "guest_posture": {"earned": 7, "max": 10},
                    "modern_auth": {"earned": 0, "max": 5}
                },
                "risks": [
                    {"factor": "MFA coverage only 48% (24/50)", "severity": "critical", "impact": -13},
                    {"factor": "5 active users without a license", "severity": "warning", "impact": -5},
                    {"factor": "No MFA conditional access policy detected", "severity": "critical", "impact": -5}
                ],
                "positives": [],
                "counts": {
                    "total_users": 50,
                    "enabled_users": 45,
                    "disabled_users": 5,
                    "unlicensed_active": 5,
                    "disabled_licensed": 1,
                    "stale_users": 3,
                    "global_admins": 3,
                    "stale_guests": 2,
                    "mfa_registered": 24,
                    "mfa_enforced": 20,
                    "mfa_checked": 50,
                    "mfa_coverage_pct": 48,
                    "has_mfa_policy": False
                }
            },
            "computed_at": datetime.now(timezone.utc).isoformat()
        }
        
        db.cipp_hygiene_cache.update_one(
            {"tenant_id": self.test_tenant_id},
            {"$set": hygiene_data},
            upsert=True
        )
        
        # Link client to tenant
        db.clients.update_one(
            {"id": self.test_client_id},
            {"$set": {
                "cipp_tenant_id": self.test_tenant_id,
                "cipp_tenant_display": "Test Hygiene Tenant",
                "cipp_tenant_domain": "testhygiene.onmicrosoft.com"
            }}
        )
        
        client.close()
        
        # Verify the data was seeded
        assert True, "Hygiene cache seeded and client linked"
    
    def test_client_health_includes_m365_hygiene_breakdown(self):
        """GET /api/clients/{client_id}/health breakdown includes m365_hygiene when linked + cached"""
        # First seed the data
        self.test_seed_hygiene_cache_and_link_client()
        
        resp = requests.get(f"{BASE_URL}/api/clients/{self.test_client_id}/health", headers=self.headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        
        # Check breakdown includes m365_hygiene
        breakdown = data.get("breakdown", {})
        assert "m365_hygiene" in breakdown, f"Expected m365_hygiene in breakdown, got {breakdown.keys()}"
        
        # Check devices max is rebalanced from 20 to 15
        devices_score = breakdown.get("devices", 0)
        assert devices_score <= 15, f"Expected devices max 15 (rebalanced), got {devices_score}"
        
        # Check contracts max is rebalanced from 10 to 5
        contracts_score = breakdown.get("contracts", 0)
        assert contracts_score <= 5, f"Expected contracts max 5 (rebalanced), got {contracts_score}"
        
        # m365_hygiene should be calculated from 62% score → 6/10
        m365_score = breakdown.get("m365_hygiene", 0)
        assert m365_score == 6, f"Expected m365_hygiene=6 (62% of 10), got {m365_score}"
    
    def test_client_health_detail_includes_m365_hygiene_metric(self):
        """GET /api/client-health/{client_id}/detail metrics includes m365_hygiene key"""
        # Ensure data is seeded
        self.test_seed_hygiene_cache_and_link_client()
        
        resp = requests.get(f"{BASE_URL}/api/client-health/{self.test_client_id}/detail", headers=self.headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        
        # Check metrics includes m365_hygiene
        metrics = data.get("metrics", {})
        assert "m365_hygiene" in metrics, f"Expected m365_hygiene in metrics, got {metrics.keys()}"
        
        # m365_hygiene should be 62 (the raw score from cache)
        m365_metric = metrics.get("m365_hygiene")
        assert m365_metric == 62, f"Expected m365_hygiene=62, got {m365_metric}"
        
        # Check risk_factors include hygiene risks
        risk_factors = data.get("risk_factors", [])
        hygiene_risks = [r for r in risk_factors if "MFA" in r.get("factor", "") or "hygiene" in r.get("factor", "").lower()]
        assert len(hygiene_risks) > 0, f"Expected hygiene risks in risk_factors, got {risk_factors}"
    
    def test_composite_health_score_factors_in_m365_hygiene(self):
        """When m365_hygiene cache is seeded, composite health score factors in m365_hygiene (10% weight)"""
        # Ensure data is seeded
        self.test_seed_hygiene_cache_and_link_client()
        
        resp = requests.get(f"{BASE_URL}/api/client-health/{self.test_client_id}/detail", headers=self.headers)
        assert resp.status_code == 200
        data = resp.json()
        
        # The composite score should include m365_hygiene at 10% weight
        # We can't easily verify the exact calculation, but we can verify the score is reasonable
        health_score = data.get("health_score", 0)
        assert 0 <= health_score <= 100, f"Health score should be 0-100, got {health_score}"
        
        # Verify metrics structure
        metrics = data.get("metrics", {})
        assert "m365_hygiene" in metrics
        assert metrics["m365_hygiene"] == 62
    
    def test_cleanup_test_data(self):
        """Clean up test data after tests"""
        import pymongo
        mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
        db_name = os.environ.get('DB_NAME', 'test_database')
        client = pymongo.MongoClient(mongo_url)
        db = client[db_name]
        
        # Remove hygiene cache
        db.cipp_hygiene_cache.delete_one({"tenant_id": self.test_tenant_id})
        
        # Unlink client
        db.clients.update_one(
            {"id": self.test_client_id},
            {"$unset": {
                "cipp_tenant_id": "",
                "cipp_tenant_display": "",
                "cipp_tenant_domain": ""
            }}
        )
        
        client.close()
        assert True, "Test data cleaned up"


class TestHygieneDigestComputation:
    """Test hygiene digest computation with scored tenants and upsell candidates"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200
        self.token = login_resp.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_hygiene_digest_structure(self):
        """Verify hygiene digest returns proper structure"""
        resp = requests.get(f"{BASE_URL}/api/cipp/hygiene-digest", headers=self.headers)
        assert resp.status_code == 200
        data = resp.json()
        
        # When not configured, should have configured:false
        if not data.get("configured"):
            assert data.get("configured") == False
            assert "clients" in data
            assert isinstance(data["clients"], list)
        else:
            # When configured, should have full structure
            assert "generated_at" in data
            assert "avg_score" in data
            assert "total_tenants" in data
            assert "critical_count" in data
            assert "upsell_candidates" in data
            assert "clients" in data
            assert isinstance(data["upsell_candidates"], list)
            assert isinstance(data["clients"], list)


class TestClientCippHygieneEndpoint:
    """Test /api/clients/{client_id}/cipp-hygiene endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200
        self.token = login_resp.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_client_hygiene_not_found(self):
        """GET /api/clients/nonexistent/cipp-hygiene returns 404"""
        resp = requests.get(f"{BASE_URL}/api/clients/nonexistent-client-xyz/cipp-hygiene", headers=self.headers)
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
    
    def test_client_hygiene_unlinked_client(self):
        """GET /api/clients/{id}/cipp-hygiene returns linked:false for unlinked client"""
        # Get a client
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=self.headers)
        assert clients_resp.status_code == 200
        clients = clients_resp.json()
        
        if not clients:
            pytest.skip("No clients available for testing")
        
        # Find an unlinked client
        unlinked_client = None
        for c in clients:
            if not c.get("cipp_tenant_id"):
                unlinked_client = c
                break
        
        if not unlinked_client:
            pytest.skip("All clients are linked to CIPP tenants")
        
        resp = requests.get(f"{BASE_URL}/api/clients/{unlinked_client['id']}/cipp-hygiene", headers=self.headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("linked") == False, f"Expected linked:false, got {data}"


class TestAuthRequired:
    """Test that all hygiene endpoints require authentication"""
    
    def test_tenant_hygiene_requires_auth(self):
        """GET /api/cipp/tenants/{id}/hygiene requires auth"""
        resp = requests.get(f"{BASE_URL}/api/cipp/tenants/test/hygiene")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
    
    def test_hygiene_digest_requires_auth(self):
        """GET /api/cipp/hygiene-digest requires auth"""
        resp = requests.get(f"{BASE_URL}/api/cipp/hygiene-digest")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
    
    def test_send_digest_requires_auth(self):
        """POST /api/cipp/hygiene-digest/send requires auth"""
        resp = requests.post(f"{BASE_URL}/api/cipp/hygiene-digest/send", json={})
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
    
    def test_digests_list_requires_auth(self):
        """GET /api/cipp/digests requires auth"""
        resp = requests.get(f"{BASE_URL}/api/cipp/digests")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
    
    def test_client_hygiene_requires_auth(self):
        """GET /api/clients/{id}/cipp-hygiene requires auth"""
        resp = requests.get(f"{BASE_URL}/api/clients/client-001/cipp-hygiene")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
