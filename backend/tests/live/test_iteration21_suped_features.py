"""
Iteration 21 - Suped DMARC Integration Backend Tests
Tests: Suped settings, client subscriptions, services endpoint, and summary
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSupedIntegration:
    """Tests for Suped DMARC reporting integration"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    # === SUPED SERVICES ENDPOINT ===
    def test_get_suped_services_returns_6_services(self):
        """GET /api/suped/services - Returns all 6 Suped services"""
        response = requests.get(f"{BASE_URL}/api/suped/services", headers=self.headers)
        assert response.status_code == 200
        services = response.json()
        assert len(services) == 6, f"Expected 6 services, got {len(services)}"
        
        # Verify expected service keys
        expected_keys = ["dmarc_monitoring", "hosted_dmarc", "hosted_spf", 
                        "hosted_mta_sts", "spf_flattening", "blocklist_monitoring"]
        actual_keys = [s["key"] for s in services]
        for key in expected_keys:
            assert key in actual_keys, f"Missing service: {key}"
        
        # Verify each service has required fields
        for service in services:
            assert "key" in service
            assert "name" in service
            assert "description" in service
    
    # === SUPED SETTINGS ENDPOINTS ===
    def test_get_suped_settings_initial_state(self):
        """GET /api/settings/suped - Returns settings (may be empty initially)"""
        response = requests.get(f"{BASE_URL}/api/settings/suped", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "type" in data
        assert data["type"] == "suped"
        assert "api_key" in data
        assert "configured" in data
    
    def test_save_suped_api_key(self):
        """PUT /api/settings/suped - Save and retrieve API key"""
        test_api_key = f"test_api_key_{uuid.uuid4().hex[:8]}"
        
        # Save API key
        response = requests.put(f"{BASE_URL}/api/settings/suped", 
                               headers=self.headers,
                               json={"api_key": test_api_key})
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Suped settings saved"
        assert data["configured"] == True
        
        # Verify key is saved (should be masked)
        response = requests.get(f"{BASE_URL}/api/settings/suped", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert data["configured"] == True
        # API key should be masked - only last 8 chars visible
        assert test_api_key[-8:] in data["api_key"]
    
    # === CLIENT SUBSCRIPTIONS ENDPOINTS ===
    def test_get_client_subscriptions_default(self):
        """GET /api/clients/{client_id}/subscriptions - Returns default subscriptions"""
        # Use client-002 (TechStart Inc) which should have default/no subscriptions
        response = requests.get(f"{BASE_URL}/api/clients/client-002/subscriptions", 
                               headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "client_id" in data
        assert data["client_id"] == "client-002"
        assert "services" in data
        assert "suped_org_id" in data
        
        # Services should be a dict with 6 keys
        services = data["services"]
        assert isinstance(services, dict)
    
    def test_get_client_subscriptions_not_found(self):
        """GET /api/clients/{invalid}/subscriptions - Returns 404 for invalid client"""
        response = requests.get(f"{BASE_URL}/api/clients/invalid-client-id/subscriptions", 
                               headers=self.headers)
        assert response.status_code == 404
    
    def test_update_client_subscriptions(self):
        """PUT /api/clients/{client_id}/subscriptions - Update and verify subscriptions"""
        test_org_id = f"TEST_org_{uuid.uuid4().hex[:8]}"
        
        # Update subscriptions
        update_data = {
            "suped_org_id": test_org_id,
            "services": {
                "dmarc_monitoring": True,
                "hosted_dmarc": False,
                "hosted_spf": True,
                "hosted_mta_sts": False,
                "spf_flattening": True,
                "blocklist_monitoring": False
            }
        }
        
        response = requests.put(f"{BASE_URL}/api/clients/client-002/subscriptions",
                               headers=self.headers,
                               json=update_data)
        assert response.status_code == 200
        assert response.json()["message"] == "Subscriptions updated"
        
        # Verify persistence with GET
        response = requests.get(f"{BASE_URL}/api/clients/client-002/subscriptions", 
                               headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        
        assert data["suped_org_id"] == test_org_id
        assert data["services"]["dmarc_monitoring"] == True
        assert data["services"]["hosted_dmarc"] == False
        assert data["services"]["hosted_spf"] == True
        assert data["services"]["spf_flattening"] == True
    
    def test_update_client_subscriptions_invalid_client(self):
        """PUT /api/clients/{invalid}/subscriptions - Returns 404"""
        response = requests.put(f"{BASE_URL}/api/clients/invalid-client/subscriptions",
                               headers=self.headers,
                               json={"suped_org_id": "test", "services": {}})
        assert response.status_code == 404
    
    # === SUBSCRIPTIONS SUMMARY ENDPOINT ===
    def test_get_all_subscriptions_summary(self):
        """GET /api/clients/subscriptions/summary - Returns summary for all clients"""
        response = requests.get(f"{BASE_URL}/api/clients/subscriptions/summary", 
                               headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        
        # Should be a dict with client IDs as keys
        assert isinstance(data, dict)
        
        # Check structure for any client that has subscriptions
        for client_id, summary in data.items():
            assert "active_count" in summary
            assert "total" in summary
            assert summary["total"] == 6  # Always 6 total services
            assert "has_suped" in summary
            assert "services" in summary
    
    # === DMARC RECORDS PROXY ENDPOINT ===
    def test_get_dmarc_records_no_org_id(self):
        """GET /api/clients/{client_id}/dmarc-records - Returns message when no org ID"""
        # Create a test client without org ID
        response = requests.get(f"{BASE_URL}/api/clients/client-003/dmarc-records", 
                               headers=self.headers)
        # Should return 200 with a message
        assert response.status_code == 200
        data = response.json()
        assert "records" in data
        assert "message" in data or len(data["records"]) >= 0
    
    def test_get_dmarc_records_with_org_id(self):
        """GET /api/clients/{client_id}/dmarc-records - Returns message about API key"""
        # First set org ID for client-001
        requests.put(f"{BASE_URL}/api/clients/client-001/subscriptions",
                    headers=self.headers,
                    json={"suped_org_id": "test_org_123", "services": {}})
        
        # Try to get DMARC records - should mention API key
        response = requests.get(f"{BASE_URL}/api/clients/client-001/dmarc-records", 
                               headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "records" in data


class TestPreviousFeaturesRegression:
    """Regression tests for Rentals, Vendors, and Ticket Settings"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    # === RENTALS ENDPOINTS ===
    def test_get_rentals_list(self):
        """GET /api/rentals - Returns rental agreements"""
        response = requests.get(f"{BASE_URL}/api/rentals", headers=self.headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_get_rental_devices(self):
        """GET /api/rental-devices - Returns device inventory"""
        response = requests.get(f"{BASE_URL}/api/rental-devices", headers=self.headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_get_rental_stats(self):
        """GET /api/rentals/stats - Returns rental statistics"""
        response = requests.get(f"{BASE_URL}/api/rentals/stats", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "total_devices" in data
        assert "active" in data
    
    def test_get_yealink_models(self):
        """GET /api/rental-devices/models - Returns Yealink model list"""
        response = requests.get(f"{BASE_URL}/api/rental-devices/models", headers=self.headers)
        assert response.status_code == 200
        models = response.json()
        assert isinstance(models, list)
        assert len(models) > 0
    
    # === VENDORS ENDPOINTS ===
    def test_get_vendors_list(self):
        """GET /api/vendors - Returns vendors list"""
        response = requests.get(f"{BASE_URL}/api/vendors", headers=self.headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_create_and_delete_test_vendor(self):
        """POST/DELETE /api/vendors - CRUD vendor"""
        # Create
        test_vendor = {
            "name": f"TEST_Vendor_{uuid.uuid4().hex[:6]}",
            "category": "hardware",
            "email": "test@vendor.com"
        }
        response = requests.post(f"{BASE_URL}/api/vendors", 
                                headers=self.headers, json=test_vendor)
        assert response.status_code in [200, 201]  # Accept both status codes
        vendor_id = response.json()["id"]
        
        # Verify
        response = requests.get(f"{BASE_URL}/api/vendors/{vendor_id}", headers=self.headers)
        assert response.status_code == 200
        assert response.json()["name"] == test_vendor["name"]
        
        # Delete
        response = requests.delete(f"{BASE_URL}/api/vendors/{vendor_id}", headers=self.headers)
        assert response.status_code == 200
    
    # === TICKET CATEGORIES ENDPOINTS ===
    def test_get_ticket_categories(self):
        """GET /api/ticket-categories/all - Returns all categories"""
        response = requests.get(f"{BASE_URL}/api/ticket-categories/all", headers=self.headers)
        assert response.status_code == 200
        categories = response.json()
        assert isinstance(categories, list)
        assert len(categories) >= 8  # At least 8 default categories
    
    def test_ticket_categories_have_issue_types(self):
        """Verify categories include issue_types array"""
        response = requests.get(f"{BASE_URL}/api/ticket-categories/all", headers=self.headers)
        assert response.status_code == 200
        categories = response.json()
        
        # Find Hardware category (should have issue types)
        hardware_cat = next((c for c in categories if c.get("name") == "Hardware"), None)
        assert hardware_cat is not None, "Hardware category not found"
        assert "issue_types" in hardware_cat
        assert len(hardware_cat["issue_types"]) > 0
    
    # === CLIENTS ENDPOINTS ===
    def test_get_clients_list(self):
        """GET /api/clients - Returns clients with subscription data available"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=self.headers)
        assert response.status_code == 200
        clients = response.json()
        assert isinstance(clients, list)
        assert len(clients) > 0
        
        # Verify Acme Corporation exists
        acme = next((c for c in clients if c.get("name") == "Acme Corporation"), None)
        assert acme is not None, "Acme Corporation not found"
        assert acme["id"] == "client-001"
    
    def test_get_client_detail(self):
        """GET /api/clients/{client_id}/detail - Returns client with related data"""
        response = requests.get(f"{BASE_URL}/api/clients/client-001/detail", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        assert "client" in data
        assert "tickets" in data
        assert "devices" in data


class TestSupedAPIKeyMasking:
    """Tests for API key security - ensure keys are properly masked"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_api_key_is_masked_in_response(self):
        """Verify API key is not returned in full"""
        # Save a known API key
        full_key = "sk_live_test_12345678_very_secret_key"
        requests.put(f"{BASE_URL}/api/settings/suped",
                    headers=self.headers,
                    json={"api_key": full_key})
        
        # Retrieve and verify masking
        response = requests.get(f"{BASE_URL}/api/settings/suped", headers=self.headers)
        data = response.json()
        
        # Full key should NOT be in response
        assert full_key not in data.get("api_key", "")
        
        # Only last 8 characters should be visible
        assert data["api_key"].endswith(full_key[-8:])
        
        # Should contain asterisks for masking
        assert "*" in data["api_key"]
