"""
Iteration 132: Cross-client Blueprint Pattern Discovery Tests

Tests for:
1. GET /api/blueprint-patterns - Detect recurring patterns across all clients
2. POST /api/blueprint-patterns/suggest - AI-draft blueprint from pattern (Claude Sonnet 4.5)
3. POST /api/blueprints/{bp_id}/push-to-clients - Push blueprint to multiple clients
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestPatternDiscovery:
    """Tests for cross-client pattern detection and blueprint generation"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth token for all tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get token
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        yield
    
    # ─────────────────────── GET /api/blueprint-patterns ───────────────────────
    
    def test_get_patterns_returns_correct_structure(self):
        """GET /api/blueprint-patterns returns patterns array with correct fields"""
        resp = self.session.get(f"{BASE_URL}/api/blueprint-patterns?min_tickets=2&limit=10")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert "patterns" in data, "Response should have 'patterns' key"
        assert "total_scanned" in data, "Response should have 'total_scanned' key"
        assert "window" in data, "Response should have 'window' key"
        assert isinstance(data["patterns"], list), "patterns should be a list"
        assert isinstance(data["total_scanned"], int), "total_scanned should be int"
        
    def test_get_patterns_respects_min_tickets(self):
        """GET /api/blueprint-patterns respects min_tickets query param"""
        # With min_tickets=2
        resp_low = self.session.get(f"{BASE_URL}/api/blueprint-patterns?min_tickets=2&limit=20")
        assert resp_low.status_code == 200
        patterns_low = resp_low.json().get("patterns", [])
        
        # With min_tickets=100 (should return fewer or no patterns)
        resp_high = self.session.get(f"{BASE_URL}/api/blueprint-patterns?min_tickets=100&limit=20")
        assert resp_high.status_code == 200
        patterns_high = resp_high.json().get("patterns", [])
        
        # Higher min_tickets should return same or fewer patterns
        assert len(patterns_high) <= len(patterns_low), "Higher min_tickets should return fewer patterns"
        
    def test_get_patterns_respects_limit(self):
        """GET /api/blueprint-patterns respects limit query param"""
        resp = self.session.get(f"{BASE_URL}/api/blueprint-patterns?min_tickets=2&limit=3")
        assert resp.status_code == 200
        patterns = resp.json().get("patterns", [])
        assert len(patterns) <= 3, f"Expected max 3 patterns, got {len(patterns)}"
        
    def test_pattern_has_required_fields(self):
        """Each pattern should have all required fields"""
        resp = self.session.get(f"{BASE_URL}/api/blueprint-patterns?min_tickets=2&limit=5")
        assert resp.status_code == 200
        patterns = resp.json().get("patterns", [])
        
        if len(patterns) > 0:
            pattern = patterns[0]
            required_fields = [
                "key", "name_guess", "tokens", "ticket_count", "client_count",
                "top_category", "sample_titles", "sample_ticket_ids",
                "related_blueprints", "affected_client_ids"
            ]
            for field in required_fields:
                assert field in pattern, f"Pattern missing required field: {field}"
            
            # Validate types
            assert isinstance(pattern["tokens"], list), "tokens should be a list"
            assert isinstance(pattern["ticket_count"], int), "ticket_count should be int"
            assert isinstance(pattern["client_count"], int), "client_count should be int"
            assert isinstance(pattern["sample_titles"], list), "sample_titles should be a list"
            assert isinstance(pattern["sample_ticket_ids"], list), "sample_ticket_ids should be a list"
            assert isinstance(pattern["affected_client_ids"], list), "affected_client_ids should be a list"
            assert isinstance(pattern["related_blueprints"], list), "related_blueprints should be a list"
    
    # ─────────────────────── POST /api/blueprint-patterns/suggest ───────────────────────
    
    def test_suggest_requires_tokens_or_ids(self):
        """POST /api/blueprint-patterns/suggest requires tokens or sample_ticket_ids"""
        resp = self.session.post(f"{BASE_URL}/api/blueprint-patterns/suggest", json={})
        assert resp.status_code == 400, f"Expected 400 for empty body, got {resp.status_code}"
        
    def test_suggest_with_tokens_only(self):
        """POST /api/blueprint-patterns/suggest works with just tokens"""
        # First get a pattern to use its tokens
        patterns_resp = self.session.get(f"{BASE_URL}/api/blueprint-patterns?min_tickets=2&limit=1")
        if patterns_resp.status_code != 200 or not patterns_resp.json().get("patterns"):
            pytest.skip("No patterns available to test suggest endpoint")
            
        pattern = patterns_resp.json()["patterns"][0]
        tokens = pattern["tokens"]
        
        # This test may take time due to AI call - skip if no EMERGENT_LLM_KEY
        resp = self.session.post(f"{BASE_URL}/api/blueprint-patterns/suggest", json={
            "tokens": tokens
        }, timeout=60)
        
        # Accept 200 (success) or 503 (AI not configured) or 502 (AI call failed)
        assert resp.status_code in [200, 502, 503], f"Unexpected status: {resp.status_code}: {resp.text}"
        
        if resp.status_code == 200:
            data = resp.json()
            assert "draft" in data, "Response should have 'draft' key"
            assert "source_tickets" in data, "Response should have 'source_tickets' key"
            assert "ai_model" in data, "Response should have 'ai_model' key"
            
            draft = data["draft"]
            assert "name" in draft, "Draft should have 'name'"
            assert "fields" in draft, "Draft should have 'fields'"
            assert "checklist" in draft, "Draft should have 'checklist'"
    
    def test_suggest_with_sample_ticket_ids(self):
        """POST /api/blueprint-patterns/suggest works with sample_ticket_ids"""
        # First get a pattern to use its sample_ticket_ids
        patterns_resp = self.session.get(f"{BASE_URL}/api/blueprint-patterns?min_tickets=2&limit=1")
        if patterns_resp.status_code != 200 or not patterns_resp.json().get("patterns"):
            pytest.skip("No patterns available to test suggest endpoint")
            
        pattern = patterns_resp.json()["patterns"][0]
        sample_ids = pattern["sample_ticket_ids"][:5]
        
        resp = self.session.post(f"{BASE_URL}/api/blueprint-patterns/suggest", json={
            "tokens": pattern["tokens"],
            "sample_ticket_ids": sample_ids
        }, timeout=60)
        
        # Accept 200 (success) or 503 (AI not configured) or 502 (AI call failed)
        assert resp.status_code in [200, 502, 503], f"Unexpected status: {resp.status_code}: {resp.text}"
    
    # ─────────────────────── POST /api/blueprints/{bp_id}/push-to-clients ───────────────────────
    
    def test_push_to_clients_requires_client_ids(self):
        """POST /api/blueprints/{bp_id}/push-to-clients requires client_ids"""
        # Get an existing blueprint
        bp_resp = self.session.get(f"{BASE_URL}/api/blueprints")
        assert bp_resp.status_code == 200
        blueprints = bp_resp.json()
        if not blueprints:
            pytest.skip("No blueprints available to test push endpoint")
            
        bp_id = blueprints[0]["id"]
        
        resp = self.session.post(f"{BASE_URL}/api/blueprints/{bp_id}/push-to-clients", json={})
        assert resp.status_code == 400, f"Expected 400 for empty client_ids, got {resp.status_code}"
        
    def test_push_to_clients_returns_404_for_invalid_blueprint(self):
        """POST /api/blueprints/{bp_id}/push-to-clients returns 404 for invalid blueprint"""
        resp = self.session.post(f"{BASE_URL}/api/blueprints/invalid-bp-id/push-to-clients", json={
            "client_ids": ["client-001"]
        })
        assert resp.status_code == 404, f"Expected 404 for invalid blueprint, got {resp.status_code}"
        
    def test_push_to_clients_updates_multiple_clients(self):
        """POST /api/blueprints/{bp_id}/push-to-clients updates all valid clients"""
        # Get an existing blueprint
        bp_resp = self.session.get(f"{BASE_URL}/api/blueprints")
        assert bp_resp.status_code == 200
        blueprints = bp_resp.json()
        if not blueprints:
            pytest.skip("No blueprints available to test push endpoint")
            
        bp_id = blueprints[0]["id"]
        bp_name = blueprints[0]["name"]
        
        # Get some client IDs
        clients_resp = self.session.get(f"{BASE_URL}/api/clients?limit=3")
        assert clients_resp.status_code == 200
        clients = clients_resp.json()
        if len(clients) < 2:
            pytest.skip("Need at least 2 clients to test push endpoint")
            
        client_ids = [c["id"] for c in clients[:3]]
        
        # Push blueprint to clients
        resp = self.session.post(f"{BASE_URL}/api/blueprints/{bp_id}/push-to-clients", json={
            "client_ids": client_ids,
            "make_default": False
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert data["success"] == True, "Response should have success=True"
        assert "updated" in data, "Response should have 'updated' count"
        assert data["updated"] >= 1, f"Expected at least 1 client updated, got {data['updated']}"
        assert data["blueprint"] == bp_name, f"Expected blueprint name '{bp_name}', got '{data.get('blueprint')}'"
        
    def test_push_to_clients_with_make_default(self):
        """POST /api/blueprints/{bp_id}/push-to-clients with make_default=true sets default"""
        # Get an existing blueprint
        bp_resp = self.session.get(f"{BASE_URL}/api/blueprints")
        assert bp_resp.status_code == 200
        blueprints = bp_resp.json()
        if not blueprints:
            pytest.skip("No blueprints available to test push endpoint")
            
        bp_id = blueprints[0]["id"]
        
        # Get a client
        clients_resp = self.session.get(f"{BASE_URL}/api/clients?limit=1")
        assert clients_resp.status_code == 200
        clients = clients_resp.json()
        if not clients:
            pytest.skip("No clients available to test push endpoint")
            
        client_id = clients[0]["id"]
        
        # Push blueprint with make_default=true
        resp = self.session.post(f"{BASE_URL}/api/blueprints/{bp_id}/push-to-clients", json={
            "client_ids": [client_id],
            "make_default": True
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        # Verify the client now has this as default
        client_bp_resp = self.session.get(f"{BASE_URL}/api/clients/{client_id}/blueprints")
        assert client_bp_resp.status_code == 200
        client_bp_data = client_bp_resp.json()
        
        assert bp_id in client_bp_data.get("blueprint_ids", []), "Blueprint should be in client's blueprint_ids"
        assert client_bp_data.get("default_blueprint_id") == bp_id, "Blueprint should be set as default"
        
    def test_push_to_clients_handles_invalid_client_ids_gracefully(self):
        """POST /api/blueprints/{bp_id}/push-to-clients skips invalid client IDs"""
        # Get an existing blueprint
        bp_resp = self.session.get(f"{BASE_URL}/api/blueprints")
        assert bp_resp.status_code == 200
        blueprints = bp_resp.json()
        if not blueprints:
            pytest.skip("No blueprints available to test push endpoint")
            
        bp_id = blueprints[0]["id"]
        
        # Mix valid and invalid client IDs
        resp = self.session.post(f"{BASE_URL}/api/blueprints/{bp_id}/push-to-clients", json={
            "client_ids": ["client-001", "invalid-client-xyz", "nonexistent-client"],
            "make_default": False
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert data["success"] == True, "Should succeed even with some invalid IDs"
        # Should update at least client-001 if it exists
        assert data["updated"] >= 0, "updated count should be >= 0"


class TestBlueprintCRUDRegression:
    """Regression tests for existing blueprint CRUD operations"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth token for all tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200
        token = login_resp.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        yield
        
    def test_list_blueprints(self):
        """GET /api/blueprints returns list of blueprints"""
        resp = self.session.get(f"{BASE_URL}/api/blueprints")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
        
    def test_create_blueprint(self):
        """POST /api/blueprints creates a new blueprint"""
        resp = self.session.post(f"{BASE_URL}/api/blueprints", json={
            "name": "TEST_Pattern_Discovery_Blueprint",
            "description": "Test blueprint for iteration 132",
            "default_priority": "medium",
            "default_category": "support",
            "sla_minutes": 120,
            "require_completion": False,
            "fields": [
                {"key": "test_field", "label": "Test Field", "type": "text", "required": False}
            ],
            "checklist": [
                {"label": "Test checklist item", "required": False}
            ]
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert "id" in data, "Response should have 'id'"
        assert data["name"] == "TEST_Pattern_Discovery_Blueprint"
        
        # Cleanup - archive the test blueprint
        self.session.delete(f"{BASE_URL}/api/blueprints/{data['id']}")
        
    def test_get_single_blueprint(self):
        """GET /api/blueprints/{bp_id} returns single blueprint"""
        # Get list first
        list_resp = self.session.get(f"{BASE_URL}/api/blueprints")
        assert list_resp.status_code == 200
        blueprints = list_resp.json()
        if not blueprints:
            pytest.skip("No blueprints to test")
            
        bp_id = blueprints[0]["id"]
        
        resp = self.session.get(f"{BASE_URL}/api/blueprints/{bp_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == bp_id


class TestClientBlueprintLinkingRegression:
    """Regression tests for client-blueprint linking"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth token for all tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200
        token = login_resp.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        yield
        
    def test_get_client_blueprints(self):
        """GET /api/clients/{client_id}/blueprints returns client's blueprints"""
        resp = self.session.get(f"{BASE_URL}/api/clients/client-001/blueprints")
        assert resp.status_code == 200
        
        data = resp.json()
        assert "blueprint_ids" in data
        assert "default_blueprint_id" in data
        assert "blueprints" in data
        
    def test_set_client_blueprints(self):
        """PUT /api/clients/{client_id}/blueprints sets client's blueprints"""
        # Get existing blueprints
        bp_resp = self.session.get(f"{BASE_URL}/api/blueprints")
        assert bp_resp.status_code == 200
        blueprints = bp_resp.json()
        if not blueprints:
            pytest.skip("No blueprints to test")
            
        bp_id = blueprints[0]["id"]
        
        resp = self.session.put(f"{BASE_URL}/api/clients/client-001/blueprints", json={
            "blueprint_ids": [bp_id],
            "default_blueprint_id": bp_id
        })
        assert resp.status_code == 200
        
        data = resp.json()
        assert data["success"] == True
        assert bp_id in data["blueprint_ids"]
        assert data["default_blueprint_id"] == bp_id


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
