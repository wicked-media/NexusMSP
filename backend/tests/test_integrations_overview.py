"""
Test suite for Integrations Overview API endpoint
Tests the unified integrations overview page backend functionality
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"


class TestIntegrationsOverviewAuth:
    """Authentication tests for /api/integrations-overview"""
    
    def test_integrations_overview_requires_auth(self):
        """Test that endpoint returns 401 without authentication"""
        response = requests.get(f"{BASE_URL}/api/integrations-overview")
        assert response.status_code in [401, 403], f"Expected 401 or 403, got {response.status_code}"
        print(f"PASS: /api/integrations-overview returns {response.status_code} without auth token")


class TestIntegrationsOverviewEndpoint:
    """Tests for GET /api/integrations-overview endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        if login_response.status_code != 200:
            pytest.skip(f"Login failed: {login_response.status_code}")
        
        self.token = login_response.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_integrations_overview_returns_200(self):
        """Test that endpoint returns 200 with valid auth"""
        response = requests.get(
            f"{BASE_URL}/api/integrations-overview",
            headers=self.headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("PASS: /api/integrations-overview returns 200 with auth")
    
    def test_integrations_overview_structure(self):
        """Test response has correct top-level structure"""
        response = requests.get(
            f"{BASE_URL}/api/integrations-overview",
            headers=self.headers
        )
        assert response.status_code == 200
        data = response.json()
        
        # Check top-level keys
        assert "total" in data, "Missing 'total' key"
        assert "configured_count" in data, "Missing 'configured_count' key"
        assert "verified_count" in data, "Missing 'verified_count' key"
        assert "attention_count" in data, "Missing 'attention_count' key"
        assert "coverage_pct" in data, "Missing 'coverage_pct' key"
        assert "tiles" in data, "Missing 'tiles' key"
        
        assert data["total"] == 16, f"Expected total=16, got {data['total']}"
        assert data["total"] == len(data["tiles"]), "Total must match the returned tile count"
        
        # Check coverage_pct is calculated correctly
        expected_coverage = round((data["configured_count"] / data["total"]) * 100) if data["total"] else 0
        assert data["coverage_pct"] == expected_coverage, f"Coverage calculation mismatch"
        
        print(f"PASS: Response structure correct - total={data['total']}, configured={data['configured_count']}, coverage={data['coverage_pct']}%")
    
    def test_integrations_overview_tiles_count(self):
        """Test that the complete integration catalogue is returned"""
        response = requests.get(
            f"{BASE_URL}/api/integrations-overview",
            headers=self.headers
        )
        assert response.status_code == 200
        data = response.json()
        
        tiles = data.get("tiles", [])
        assert len(tiles) == 16, f"Expected 16 tiles, got {len(tiles)}"
        print("PASS: Tiles array has 16 integrations")
    
    def test_integrations_overview_tile_keys(self):
        """Test that each tile has all required keys"""
        response = requests.get(
            f"{BASE_URL}/api/integrations-overview",
            headers=self.headers
        )
        assert response.status_code == 200
        data = response.json()
        
        required_keys = [
            "key", "name", "category", "description", "configured",
            "connection_state", "last_synced_at", "last_test_status",
            "command_center", "settings_anchor", "settings_path"
        ]
        
        for tile in data.get("tiles", []):
            for key in required_keys:
                assert key in tile, f"Tile '{tile.get('key', 'unknown')}' missing key '{key}'"
        
        print(f"PASS: All tiles have required keys: {required_keys}")
    
    def test_integrations_overview_expected_integrations(self):
        """Test that every supported integration is present"""
        response = requests.get(
            f"{BASE_URL}/api/integrations-overview",
            headers=self.headers
        )
        assert response.status_code == 200
        data = response.json()
        
        expected_keys = [
            "rustdesk", "cipp", "huntress", "hudu", "acronis", "pax8",
            "domotz", "stripe", "xero", "yeastar", "microsoft365", "sms",
            "splynx", "syncro", "suped", "unifi"
        ]
        
        tile_keys = [t["key"] for t in data.get("tiles", [])]
        
        for expected in expected_keys:
            assert expected in tile_keys, f"Missing integration: {expected}"
        
        assert len(tile_keys) == len(set(tile_keys)), "Integration keys must be unique"
        print(f"PASS: All expected integrations present: {expected_keys}")
    
    def test_integrations_overview_command_centers(self):
        """Test that command_center values are correct for integrations that have them"""
        response = requests.get(
            f"{BASE_URL}/api/integrations-overview",
            headers=self.headers
        )
        assert response.status_code == 200
        data = response.json()
        
        # Expected command centers
        expected_command_centers = {
            "rustdesk": "/remote-access",
            "cipp": "/control-plane?module=microsoft365&view=connections",
            "huntress": "/security-dashboard",
            "hudu": "/hudu",
            "acronis": "/backup-center",
            "pax8": "/pax8",
            "domotz": "/domotz",
            "xero": "/invoices",
            "yeastar": "/voice",
            "microsoft365": "/email",
            "suped": "/suped",
            "unifi": "/unifi",
        }
        
        tiles_by_key = {t["key"]: t for t in data.get("tiles", [])}
        
        for key, expected_cc in expected_command_centers.items():
            tile = tiles_by_key.get(key)
            assert tile is not None, f"Missing tile: {key}"
            assert tile["command_center"] == expected_cc, f"{key} command_center should be {expected_cc}, got {tile['command_center']}"
        
        # Integrations without command centers should have None
        no_command_center = ["stripe", "sms", "splynx", "syncro"]
        for key in no_command_center:
            tile = tiles_by_key.get(key)
            assert tile is not None, f"Missing tile: {key}"
            assert tile["command_center"] is None, f"{key} should have command_center=None, got {tile['command_center']}"
        
        print("PASS: Command center values are correct for all integrations")
    
    def test_integrations_overview_management_targets(self):
        """Every tile must resolve to a settings card or operational workspace"""
        response = requests.get(
            f"{BASE_URL}/api/integrations-overview",
            headers=self.headers
        )
        assert response.status_code == 200
        data = response.json()
        
        for tile in data.get("tiles", []):
            assert tile["settings_anchor"] or tile["settings_path"] or tile["command_center"], (
                f"Tile '{tile['key']}' has no management target"
            )
            if tile["settings_anchor"]:
                assert tile["settings_anchor"].endswith("-settings-card"), (
                    f"Tile '{tile['key']}' settings_anchor format incorrect"
                )

        print("PASS: All tiles have a valid management target")

    def test_integrations_overview_configured_flag_types(self):
        """Test that configured flag is boolean"""
        response = requests.get(
            f"{BASE_URL}/api/integrations-overview",
            headers=self.headers
        )
        assert response.status_code == 200
        data = response.json()
        
        for tile in data.get("tiles", []):
            assert isinstance(tile["configured"], bool), f"Tile '{tile['key']}' configured should be bool, got {type(tile['configured'])}"
        
        print("PASS: All tiles have boolean 'configured' flag")
    
    def test_integrations_overview_categories(self):
        """Test that all tiles have valid category values"""
        response = requests.get(
            f"{BASE_URL}/api/integrations-overview",
            headers=self.headers
        )
        assert response.status_code == 200
        data = response.json()
        
        valid_categories = [
            "remote-access", "security", "documentation", "backup", "billing",
            "network", "payments", "accounting", "voice", "email", "messaging",
            "isp", "psa-sync"
        ]
        
        for tile in data.get("tiles", []):
            assert tile["category"] in valid_categories, f"Tile '{tile['key']}' has invalid category: {tile['category']}"
        
        print(f"PASS: All tiles have valid categories")

    def test_integrations_overview_connection_states_and_counts(self):
        """Connection states and summary counts must describe the same tiles"""
        response = requests.get(
            f"{BASE_URL}/api/integrations-overview",
            headers=self.headers
        )
        assert response.status_code == 200
        data = response.json()
        valid_states = {
            "not_configured", "configured_unverified", "verified", "stale", "failed"
        }
        tiles = data.get("tiles", [])

        assert all(tile["connection_state"] in valid_states for tile in tiles)
        assert data["configured_count"] == sum(tile["configured"] for tile in tiles)
        assert data["verified_count"] == sum(
            tile["connection_state"] == "verified" for tile in tiles
        )
        assert data["attention_count"] == sum(
            tile["connection_state"] in {"configured_unverified", "stale", "failed"}
            for tile in tiles
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
