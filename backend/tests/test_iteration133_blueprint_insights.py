"""
Iteration 133: Blueprint Insights Dashboard Tile Tests
Tests for GET /api/blueprint-patterns/trends endpoint and regression tests for existing endpoints.

Features tested:
1. GET /api/blueprint-patterns/trends - returns rising patterns (NEW vs SURGING)
2. Response structure validation (rising, window_days, this_total, prev_total)
3. Pattern fields validation (key, tokens, name_guess, ticket_count_this/prev, delta, is_new, score, etc.)
4. Days parameter clamping (1-60)
5. Regression: existing /api/blueprint-patterns and /api/blueprints endpoints
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestBlueprintInsightsTrends:
    """Tests for GET /api/blueprint-patterns/trends endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token for all tests"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_trends_endpoint_returns_200(self):
        """Test that trends endpoint returns 200 OK"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns/trends", headers=self.headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    
    def test_trends_response_structure(self):
        """Test that trends response has correct top-level structure"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns/trends", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        
        # Verify top-level keys
        assert "rising" in data, "Response missing 'rising' key"
        assert "window_days" in data, "Response missing 'window_days' key"
        assert "this_total" in data, "Response missing 'this_total' key"
        assert "prev_total" in data, "Response missing 'prev_total' key"
        
        # Verify types
        assert isinstance(data["rising"], list), "rising should be a list"
        assert isinstance(data["window_days"], int), "window_days should be int"
        assert isinstance(data["this_total"], int), "this_total should be int"
        assert isinstance(data["prev_total"], int), "prev_total should be int"
    
    def test_trends_default_days_is_7(self):
        """Test that default window_days is 7"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns/trends", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert data["window_days"] == 7, f"Expected window_days=7, got {data['window_days']}"
    
    def test_trends_days_param_respected(self):
        """Test that days parameter is respected"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns/trends?days=14", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert data["window_days"] == 14, f"Expected window_days=14, got {data['window_days']}"
    
    def test_trends_days_clamped_min(self):
        """Test that days is clamped to minimum of 1"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns/trends?days=0", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert data["window_days"] >= 1, f"Expected window_days >= 1, got {data['window_days']}"
    
    def test_trends_days_clamped_max(self):
        """Test that days is clamped to maximum of 60"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns/trends?days=100", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert data["window_days"] <= 60, f"Expected window_days <= 60, got {data['window_days']}"
    
    def test_trends_rising_pattern_structure(self):
        """Test that each rising pattern has correct structure"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns/trends", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        
        if len(data["rising"]) > 0:
            pattern = data["rising"][0]
            
            # Required fields
            required_fields = [
                "key", "tokens", "name_guess", "ticket_count_this", "ticket_count_prev",
                "client_count_this", "delta", "is_new", "score", "sample_titles",
                "sample_ticket_ids", "affected_client_ids"
            ]
            for field in required_fields:
                assert field in pattern, f"Pattern missing required field: {field}"
            
            # Type validations
            assert isinstance(pattern["key"], str), "key should be string"
            assert isinstance(pattern["tokens"], list), "tokens should be list"
            assert len(pattern["tokens"]) == 2, "tokens should have 2 elements (bigram)"
            assert isinstance(pattern["name_guess"], str), "name_guess should be string"
            assert isinstance(pattern["ticket_count_this"], int), "ticket_count_this should be int"
            assert isinstance(pattern["ticket_count_prev"], int), "ticket_count_prev should be int"
            assert isinstance(pattern["client_count_this"], int), "client_count_this should be int"
            assert isinstance(pattern["delta"], int), "delta should be int"
            assert isinstance(pattern["is_new"], bool), "is_new should be bool"
            assert isinstance(pattern["score"], (int, float)), "score should be numeric"
            assert isinstance(pattern["sample_titles"], list), "sample_titles should be list"
            assert isinstance(pattern["sample_ticket_ids"], list), "sample_ticket_ids should be list"
            assert isinstance(pattern["affected_client_ids"], list), "affected_client_ids should be list"
    
    def test_trends_is_new_logic(self):
        """Test that is_new is true when ticket_count_prev is 0"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns/trends", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        
        for pattern in data["rising"]:
            if pattern["ticket_count_prev"] == 0:
                assert pattern["is_new"] == True, f"Pattern {pattern['key']} should be is_new=True when prev=0"
            else:
                assert pattern["is_new"] == False, f"Pattern {pattern['key']} should be is_new=False when prev>0"
    
    def test_trends_delta_calculation(self):
        """Test that delta = ticket_count_this - ticket_count_prev"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns/trends", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        
        for pattern in data["rising"]:
            expected_delta = pattern["ticket_count_this"] - pattern["ticket_count_prev"]
            assert pattern["delta"] == expected_delta, f"Pattern {pattern['key']} delta mismatch: expected {expected_delta}, got {pattern['delta']}"
    
    def test_trends_returns_max_3_patterns(self):
        """Test that trends returns at most 3 rising patterns"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns/trends", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["rising"]) <= 3, f"Expected max 3 patterns, got {len(data['rising'])}"
    
    def test_trends_requires_auth(self):
        """Test that trends endpoint requires authentication"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns/trends")
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"


class TestBlueprintPatternsRegression:
    """Regression tests for existing /api/blueprint-patterns endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token for all tests"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_patterns_endpoint_still_works(self):
        """Regression: GET /api/blueprint-patterns still returns 200"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns", headers=self.headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    
    def test_patterns_response_structure(self):
        """Regression: /api/blueprint-patterns has correct structure"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "patterns" in data, "Response missing 'patterns' key"
        assert "total_scanned" in data, "Response missing 'total_scanned' key"
        assert "window" in data, "Response missing 'window' key"
    
    def test_patterns_limit_param(self):
        """Regression: limit parameter works"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns?limit=5", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["patterns"]) <= 5
    
    def test_patterns_min_tickets_param(self):
        """Regression: min_tickets parameter works"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns?min_tickets=2", headers=self.headers)
        assert response.status_code == 200


class TestBlueprintsLibraryRegression:
    """Regression tests for existing /api/blueprints CRUD endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token for all tests"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_list_blueprints(self):
        """Regression: GET /api/blueprints returns list"""
        response = requests.get(f"{BASE_URL}/api/blueprints", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of blueprints"
    
    def test_list_blueprints_includes_inactive(self):
        """Regression: GET /api/blueprints?active_only=false includes inactive"""
        response = requests.get(f"{BASE_URL}/api/blueprints?active_only=false", headers=self.headers)
        assert response.status_code == 200
    
    def test_create_and_delete_blueprint(self):
        """Regression: Create and delete blueprint works"""
        # Create
        create_response = requests.post(f"{BASE_URL}/api/blueprints", json={
            "name": "TEST_Iteration133_Blueprint",
            "description": "Test blueprint for iteration 133",
            "default_priority": "medium",
            "fields": [],
            "checklist": []
        }, headers=self.headers)
        assert create_response.status_code == 200, f"Create failed: {create_response.text}"
        bp = create_response.json()
        assert "id" in bp
        
        # Delete (archive)
        delete_response = requests.delete(f"{BASE_URL}/api/blueprints/{bp['id']}", headers=self.headers)
        assert delete_response.status_code == 200


class TestPatternSuggestRegression:
    """Regression tests for POST /api/blueprint-patterns/suggest"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token for all tests"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_suggest_requires_tokens_or_ids(self):
        """Regression: suggest endpoint requires tokens or sample_ticket_ids"""
        response = requests.post(f"{BASE_URL}/api/blueprint-patterns/suggest", json={}, headers=self.headers)
        assert response.status_code == 400, f"Expected 400 for empty body, got {response.status_code}"


class TestPushToClientsRegression:
    """Regression tests for POST /api/blueprints/{bp_id}/push-to-clients"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token for all tests"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_push_requires_client_ids(self):
        """Regression: push-to-clients requires client_ids"""
        # First get a blueprint
        bps_response = requests.get(f"{BASE_URL}/api/blueprints", headers=self.headers)
        if bps_response.status_code == 200 and len(bps_response.json()) > 0:
            bp_id = bps_response.json()[0]["id"]
            response = requests.post(f"{BASE_URL}/api/blueprints/{bp_id}/push-to-clients", json={}, headers=self.headers)
            assert response.status_code == 400, f"Expected 400 for empty client_ids, got {response.status_code}"
    
    def test_push_to_nonexistent_blueprint(self):
        """Regression: push-to-clients returns 404 for nonexistent blueprint"""
        response = requests.post(f"{BASE_URL}/api/blueprints/nonexistent-bp/push-to-clients", json={
            "client_ids": ["client-001"]
        }, headers=self.headers)
        assert response.status_code == 404
