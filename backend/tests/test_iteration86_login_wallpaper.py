"""
Iteration 86 - Login Wallpaper Feature Tests
Tests for:
- GET /api/settings/login-wallpaper (public, no auth)
- GET /api/settings/login-wallpaper/templates (auth required)
- PUT /api/settings/login-wallpaper (auth required)
- POST /api/settings/login-wallpaper/upload (auth required)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"


class TestLoginWallpaperPublic:
    """Public endpoints - no auth required"""

    def test_get_login_wallpaper_no_auth(self):
        """GET /api/settings/login-wallpaper should work without auth (for login page)"""
        response = requests.get(f"{BASE_URL}/api/settings/login-wallpaper")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Should have type, url, and overlay_opacity fields
        assert "type" in data, "Response should have 'type' field"
        assert "url" in data, "Response should have 'url' field"
        assert "overlay_opacity" in data, "Response should have 'overlay_opacity' field"
        
        # Type should be one of: default, template, custom
        assert data["type"] in ["default", "template", "custom"], f"Invalid type: {data['type']}"
        
        # Overlay opacity should be a number between 0 and 1
        assert isinstance(data["overlay_opacity"], (int, float)), "overlay_opacity should be a number"
        assert 0 <= data["overlay_opacity"] <= 1, f"overlay_opacity should be 0-1, got {data['overlay_opacity']}"
        
        print(f"Current wallpaper: type={data['type']}, url={data.get('url', 'None')[:50] if data.get('url') else 'None'}...")


class TestLoginWallpaperAuth:
    """Authenticated endpoints"""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token before each test"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.token = login_response.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_get_wallpaper_templates(self):
        """GET /api/settings/login-wallpaper/templates returns 6 templates"""
        response = requests.get(
            f"{BASE_URL}/api/settings/login-wallpaper/templates",
            headers=self.headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        templates = response.json()
        assert isinstance(templates, list), "Templates should be a list"
        assert len(templates) == 6, f"Expected 6 templates, got {len(templates)}"
        
        # Verify template structure
        for tpl in templates:
            assert "id" in tpl, "Template should have 'id'"
            assert "name" in tpl, "Template should have 'name'"
            assert "url" in tpl, "Template should have 'url'"
            assert "category" in tpl, "Template should have 'category'"
            assert tpl["url"].startswith("https://"), f"Template URL should be HTTPS: {tpl['url']}"
        
        # Check expected templates
        template_names = [t["name"] for t in templates]
        assert "Cyber City" in template_names, "Should have 'Cyber City' template"
        assert "Neon Glow" in template_names, "Should have 'Neon Glow' template"
        assert "Dark Workspace" in template_names, "Should have 'Dark Workspace' template"
        
        print(f"Templates: {template_names}")

    def test_get_templates_requires_auth(self):
        """GET /api/settings/login-wallpaper/templates should require auth"""
        response = requests.get(f"{BASE_URL}/api/settings/login-wallpaper/templates")
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"

    def test_set_template_wallpaper(self):
        """PUT /api/settings/login-wallpaper with template"""
        # First get templates
        templates_response = requests.get(
            f"{BASE_URL}/api/settings/login-wallpaper/templates",
            headers=self.headers
        )
        templates = templates_response.json()
        test_template = templates[0]  # Use first template
        
        # Set wallpaper to template
        response = requests.put(
            f"{BASE_URL}/api/settings/login-wallpaper",
            json={
                "type": "template",
                "url": test_template["url"],
                "overlay_opacity": 0.6
            },
            headers=self.headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("type") == "template", f"Expected type 'template', got {data.get('type')}"
        assert data.get("url") == test_template["url"], "URL should match template URL"
        
        # Verify by fetching (no auth needed)
        verify_response = requests.get(f"{BASE_URL}/api/settings/login-wallpaper")
        verify_data = verify_response.json()
        assert verify_data["type"] == "template", "Persisted type should be 'template'"
        assert verify_data["url"] == test_template["url"], "Persisted URL should match"
        
        print(f"Set wallpaper to template: {test_template['name']}")

    def test_set_default_wallpaper(self):
        """PUT /api/settings/login-wallpaper to reset to default"""
        response = requests.put(
            f"{BASE_URL}/api/settings/login-wallpaper",
            json={
                "type": "default",
                "url": None,
                "overlay_opacity": 0.7
            },
            headers=self.headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("type") == "default", f"Expected type 'default', got {data.get('type')}"
        
        # Verify
        verify_response = requests.get(f"{BASE_URL}/api/settings/login-wallpaper")
        verify_data = verify_response.json()
        assert verify_data["type"] == "default", "Persisted type should be 'default'"
        
        print("Reset wallpaper to default")

    def test_put_wallpaper_requires_auth(self):
        """PUT /api/settings/login-wallpaper should require auth"""
        response = requests.put(
            f"{BASE_URL}/api/settings/login-wallpaper",
            json={"type": "default", "url": None}
        )
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"

    def test_set_wallpaper_with_overlay_opacity(self):
        """PUT /api/settings/login-wallpaper with custom overlay opacity"""
        # Get a template
        templates_response = requests.get(
            f"{BASE_URL}/api/settings/login-wallpaper/templates",
            headers=self.headers
        )
        templates = templates_response.json()
        test_template = templates[1]  # Use second template
        
        # Set with custom opacity
        response = requests.put(
            f"{BASE_URL}/api/settings/login-wallpaper",
            json={
                "type": "template",
                "url": test_template["url"],
                "overlay_opacity": 0.85
            },
            headers=self.headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Verify opacity persisted
        verify_response = requests.get(f"{BASE_URL}/api/settings/login-wallpaper")
        verify_data = verify_response.json()
        assert verify_data["overlay_opacity"] == 0.85, f"Expected opacity 0.85, got {verify_data['overlay_opacity']}"
        
        print(f"Set wallpaper with overlay opacity 0.85")


class TestLoginWallpaperUpload:
    """Upload endpoint tests"""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token before each test"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.token = login_response.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_upload_wallpaper_requires_auth(self):
        """POST /api/settings/login-wallpaper/upload should require auth"""
        # Create a small test image (1x1 pixel PNG)
        import base64
        # Minimal valid PNG (1x1 transparent pixel)
        png_data = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        )
        
        files = {"file": ("test.png", png_data, "image/png")}
        response = requests.post(
            f"{BASE_URL}/api/settings/login-wallpaper/upload",
            files=files
        )
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"

    def test_upload_wallpaper_success(self):
        """POST /api/settings/login-wallpaper/upload with valid image"""
        import base64
        # Minimal valid PNG (1x1 transparent pixel)
        png_data = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        )
        
        files = {"file": ("test_wallpaper.png", png_data, "image/png")}
        response = requests.post(
            f"{BASE_URL}/api/settings/login-wallpaper/upload",
            files=files,
            headers=self.headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "url" in data, "Response should have 'url'"
        assert "filename" in data, "Response should have 'filename'"
        assert data["url"].startswith("data:image/png;base64,"), "URL should be base64 data URL"
        
        # Verify wallpaper was set
        verify_response = requests.get(f"{BASE_URL}/api/settings/login-wallpaper")
        verify_data = verify_response.json()
        assert verify_data["type"] == "custom", "Type should be 'custom' after upload"
        assert verify_data["url"].startswith("data:image/"), "URL should be data URL"
        
        print(f"Uploaded wallpaper: {data['filename']}")

    def test_upload_rejects_non_image(self):
        """POST /api/settings/login-wallpaper/upload should reject non-image files"""
        files = {"file": ("test.txt", b"This is not an image", "text/plain")}
        response = requests.post(
            f"{BASE_URL}/api/settings/login-wallpaper/upload",
            files=files,
            headers=self.headers
        )
        assert response.status_code == 400, f"Expected 400 for non-image, got {response.status_code}"
        
        data = response.json()
        assert "image" in data.get("detail", "").lower(), f"Error should mention 'image': {data}"


class TestLoginWallpaperCleanup:
    """Cleanup - restore to a known state"""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Get auth token"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.token = login_response.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_z_restore_cyber_city_wallpaper(self):
        """Restore wallpaper to Cyber City template (cleanup)"""
        # Get templates
        templates_response = requests.get(
            f"{BASE_URL}/api/settings/login-wallpaper/templates",
            headers=self.headers
        )
        templates = templates_response.json()
        cyber_city = next((t for t in templates if t["name"] == "Cyber City"), templates[0])
        
        # Set to Cyber City
        response = requests.put(
            f"{BASE_URL}/api/settings/login-wallpaper",
            json={
                "type": "template",
                "url": cyber_city["url"],
                "overlay_opacity": 0.7
            },
            headers=self.headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        print(f"Restored wallpaper to: {cyber_city['name']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
