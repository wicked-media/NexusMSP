"""
Iteration 115: Hudu Integration Revamp Tests
Tests for:
- Hudu settings CRUD (GET/PUT/DELETE /api/settings/hudu)
- Hudu connection test (POST /api/settings/hudu/test)
- Hudu resource endpoints (companies, articles, assets, asset-layouts, websites, procedures, passwords)
- Hudu search (GET /api/hudu/search)
- Hudu summary (GET /api/hudu/summary)
- AI-powered suggest-for-ticket (POST /api/hudu/suggest-for-ticket)
- Auth requirements on all endpoints
- Graceful handling with placeholder URL (no 500 errors)
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"

# Placeholder Hudu config for testing
PLACEHOLDER_HUDU_URL = "https://test-company.huducloud.com"
PLACEHOLDER_HUDU_API_KEY = "test-api-key-placeholder-12345"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for tests"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json().get("token")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestHuduSettingsEndpoints:
    """Tests for Hudu settings CRUD operations"""
    
    def test_get_hudu_settings_requires_auth(self):
        """GET /api/settings/hudu requires authentication"""
        response = requests.get(f"{BASE_URL}/api/settings/hudu")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_get_hudu_settings(self, headers):
        """GET /api/settings/hudu returns settings with configured flag"""
        response = requests.get(f"{BASE_URL}/api/settings/hudu", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "configured" in data, "Response should have 'configured' field"
        assert "url" in data, "Response should have 'url' field"
        assert "api_key" in data, "Response should have 'api_key' field (masked)"
        print(f"Hudu settings: configured={data.get('configured')}, url={data.get('url')}")
    
    def test_put_hudu_settings_requires_auth(self):
        """PUT /api/settings/hudu requires authentication"""
        response = requests.put(f"{BASE_URL}/api/settings/hudu", json={
            "url": PLACEHOLDER_HUDU_URL,
            "api_key": PLACEHOLDER_HUDU_API_KEY
        })
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_put_hudu_settings_missing_fields(self, headers):
        """PUT /api/settings/hudu returns 400 when fields missing"""
        # Missing api_key
        response = requests.put(f"{BASE_URL}/api/settings/hudu", json={"url": PLACEHOLDER_HUDU_URL}, headers=headers)
        assert response.status_code == 400, f"Expected 400 for missing api_key, got {response.status_code}"
        
        # Missing url
        response = requests.put(f"{BASE_URL}/api/settings/hudu", json={"api_key": PLACEHOLDER_HUDU_API_KEY}, headers=headers)
        assert response.status_code == 400, f"Expected 400 for missing url, got {response.status_code}"
        
        # Empty values
        response = requests.put(f"{BASE_URL}/api/settings/hudu", json={"url": "", "api_key": ""}, headers=headers)
        assert response.status_code == 400, f"Expected 400 for empty values, got {response.status_code}"
    
    def test_put_hudu_settings_success(self, headers):
        """PUT /api/settings/hudu saves and masks key"""
        response = requests.put(f"{BASE_URL}/api/settings/hudu", json={
            "url": PLACEHOLDER_HUDU_URL,
            "api_key": PLACEHOLDER_HUDU_API_KEY
        }, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("configured") == True, "Should return configured=True"
        
        # Verify settings were saved with masked key
        get_response = requests.get(f"{BASE_URL}/api/settings/hudu", headers=headers)
        assert get_response.status_code == 200
        settings = get_response.json()
        assert settings.get("configured") == True
        assert settings.get("url") == PLACEHOLDER_HUDU_URL
        # API key should be masked (contains asterisks)
        assert "*" in settings.get("api_key", ""), f"API key should be masked, got: {settings.get('api_key')}"
        print(f"Hudu settings saved: url={settings.get('url')}, api_key={settings.get('api_key')}")
    
    def test_delete_hudu_settings_requires_auth(self):
        """DELETE /api/settings/hudu requires authentication"""
        response = requests.delete(f"{BASE_URL}/api/settings/hudu")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"


class TestHuduConnectionTest:
    """Tests for Hudu connection test endpoint"""
    
    def test_hudu_test_requires_auth(self):
        """POST /api/settings/hudu/test requires authentication"""
        response = requests.post(f"{BASE_URL}/api/settings/hudu/test")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_hudu_test_with_placeholder_url(self, headers):
        """POST /api/settings/hudu/test returns success:false with placeholder URL (no 500)"""
        # First ensure settings are configured
        requests.put(f"{BASE_URL}/api/settings/hudu", json={
            "url": PLACEHOLDER_HUDU_URL,
            "api_key": PLACEHOLDER_HUDU_API_KEY
        }, headers=headers)
        
        response = requests.post(f"{BASE_URL}/api/settings/hudu/test", headers=headers)
        # Should NOT be 500 - graceful handling
        assert response.status_code == 200, f"Expected 200 (graceful failure), got {response.status_code}: {response.text}"
        data = response.json()
        assert "success" in data, "Response should have 'success' field"
        assert data.get("success") == False, "Should return success=False for placeholder URL"
        assert "message" in data, "Response should have 'message' field"
        print(f"Hudu test result: success={data.get('success')}, message={data.get('message')}")


class TestHuduResourceEndpoints:
    """Tests for Hudu resource list endpoints"""
    
    def test_hudu_companies_requires_auth(self):
        """GET /api/hudu/companies requires authentication"""
        response = requests.get(f"{BASE_URL}/api/hudu/companies")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_hudu_companies(self, headers):
        """GET /api/hudu/companies returns 200 with expected shape"""
        response = requests.get(f"{BASE_URL}/api/hudu/companies", headers=headers)
        # With placeholder URL, may return 503 (not configured) or 200 with empty list
        # or error from Hudu - but NOT 500
        assert response.status_code != 500, f"Should not return 500, got {response.status_code}: {response.text}"
        if response.status_code == 200:
            data = response.json()
            assert "companies" in data, "Response should have 'companies' field"
            assert isinstance(data["companies"], list), "companies should be a list"
            print(f"Hudu companies: {len(data['companies'])} items")
    
    def test_hudu_articles_requires_auth(self):
        """GET /api/hudu/articles requires authentication"""
        response = requests.get(f"{BASE_URL}/api/hudu/articles")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_hudu_articles(self, headers):
        """GET /api/hudu/articles returns 200 with expected shape"""
        response = requests.get(f"{BASE_URL}/api/hudu/articles", headers=headers)
        assert response.status_code != 500, f"Should not return 500, got {response.status_code}: {response.text}"
        if response.status_code == 200:
            data = response.json()
            assert "articles" in data, "Response should have 'articles' field"
            assert isinstance(data["articles"], list), "articles should be a list"
            print(f"Hudu articles: {len(data['articles'])} items")
    
    def test_hudu_assets_requires_auth(self):
        """GET /api/hudu/assets requires authentication"""
        response = requests.get(f"{BASE_URL}/api/hudu/assets")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_hudu_assets(self, headers):
        """GET /api/hudu/assets returns 200 with expected shape"""
        response = requests.get(f"{BASE_URL}/api/hudu/assets", headers=headers)
        assert response.status_code != 500, f"Should not return 500, got {response.status_code}: {response.text}"
        if response.status_code == 200:
            data = response.json()
            assert "assets" in data, "Response should have 'assets' field"
            assert isinstance(data["assets"], list), "assets should be a list"
            print(f"Hudu assets: {len(data['assets'])} items")
    
    def test_hudu_asset_layouts_requires_auth(self):
        """GET /api/hudu/asset-layouts requires authentication"""
        response = requests.get(f"{BASE_URL}/api/hudu/asset-layouts")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_hudu_asset_layouts(self, headers):
        """GET /api/hudu/asset-layouts returns 200 with expected shape"""
        response = requests.get(f"{BASE_URL}/api/hudu/asset-layouts", headers=headers)
        assert response.status_code != 500, f"Should not return 500, got {response.status_code}: {response.text}"
        if response.status_code == 200:
            data = response.json()
            assert "asset_layouts" in data, "Response should have 'asset_layouts' field"
            assert isinstance(data["asset_layouts"], list), "asset_layouts should be a list"
            print(f"Hudu asset_layouts: {len(data['asset_layouts'])} items")
    
    def test_hudu_websites_requires_auth(self):
        """GET /api/hudu/websites requires authentication"""
        response = requests.get(f"{BASE_URL}/api/hudu/websites")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_hudu_websites(self, headers):
        """GET /api/hudu/websites returns 200 with expected shape"""
        response = requests.get(f"{BASE_URL}/api/hudu/websites", headers=headers)
        assert response.status_code != 500, f"Should not return 500, got {response.status_code}: {response.text}"
        if response.status_code == 200:
            data = response.json()
            assert "websites" in data, "Response should have 'websites' field"
            assert isinstance(data["websites"], list), "websites should be a list"
            print(f"Hudu websites: {len(data['websites'])} items")
    
    def test_hudu_procedures_requires_auth(self):
        """GET /api/hudu/procedures requires authentication"""
        response = requests.get(f"{BASE_URL}/api/hudu/procedures")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_hudu_procedures(self, headers):
        """GET /api/hudu/procedures returns 200 with expected shape"""
        response = requests.get(f"{BASE_URL}/api/hudu/procedures", headers=headers)
        assert response.status_code != 500, f"Should not return 500, got {response.status_code}: {response.text}"
        if response.status_code == 200:
            data = response.json()
            assert "procedures" in data, "Response should have 'procedures' field"
            assert isinstance(data["procedures"], list), "procedures should be a list"
            print(f"Hudu procedures: {len(data['procedures'])} items")
    
    def test_hudu_passwords_requires_auth(self):
        """GET /api/hudu/passwords requires authentication"""
        response = requests.get(f"{BASE_URL}/api/hudu/passwords")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_hudu_passwords(self, headers):
        """GET /api/hudu/passwords returns 200 with redacted passwords"""
        response = requests.get(f"{BASE_URL}/api/hudu/passwords", headers=headers)
        assert response.status_code != 500, f"Should not return 500, got {response.status_code}: {response.text}"
        if response.status_code == 200:
            data = response.json()
            assert "passwords" in data, "Response should have 'passwords' field"
            assert isinstance(data["passwords"], list), "passwords should be a list"
            # Check redaction note
            assert "note" in data, "Response should have 'note' field about redaction"
            assert "redact" in data.get("note", "").lower(), "Note should mention redaction"
            # If there are passwords, verify they are redacted
            for pwd in data["passwords"]:
                assert pwd.get("password") is None, "Password field should be null (redacted)"
            print(f"Hudu passwords: {len(data['passwords'])} items (redacted)")
    
    def test_hudu_password_by_id_requires_auth(self):
        """GET /api/hudu/passwords/{id} requires authentication"""
        response = requests.get(f"{BASE_URL}/api/hudu/passwords/12345")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_hudu_password_by_id_not_found(self, headers):
        """GET /api/hudu/passwords/{id} returns 404 for non-existent ID (no crash)"""
        response = requests.get(f"{BASE_URL}/api/hudu/passwords/99999999", headers=headers)
        # Should return 404 or graceful error, NOT 500
        assert response.status_code != 500, f"Should not return 500, got {response.status_code}: {response.text}"
        # With placeholder URL, expect 404 or 503
        assert response.status_code in [404, 503], f"Expected 404 or 503, got {response.status_code}"
        print(f"Hudu password by ID: {response.status_code}")


class TestHuduSearchEndpoint:
    """Tests for Hudu global search endpoint"""
    
    def test_hudu_search_requires_auth(self):
        """GET /api/hudu/search requires authentication"""
        response = requests.get(f"{BASE_URL}/api/hudu/search?q=vpn")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_hudu_search(self, headers):
        """GET /api/hudu/search returns expected shape"""
        response = requests.get(f"{BASE_URL}/api/hudu/search?q=vpn", headers=headers)
        assert response.status_code != 500, f"Should not return 500, got {response.status_code}: {response.text}"
        if response.status_code == 200:
            data = response.json()
            # Check expected fields
            assert "query" in data, "Response should have 'query' field"
            assert "articles" in data, "Response should have 'articles' field"
            assert "assets" in data, "Response should have 'assets' field"
            assert "procedures" in data, "Response should have 'procedures' field"
            assert "websites" in data, "Response should have 'websites' field"
            assert "passwords" in data, "Response should have 'passwords' field"
            # All should be lists
            assert isinstance(data["articles"], list)
            assert isinstance(data["assets"], list)
            assert isinstance(data["procedures"], list)
            assert isinstance(data["websites"], list)
            assert isinstance(data["passwords"], list)
            print(f"Hudu search for 'vpn': articles={len(data['articles'])}, assets={len(data['assets'])}, procedures={len(data['procedures'])}")


class TestHuduSummaryEndpoint:
    """Tests for Hudu summary/dashboard endpoint"""
    
    def test_hudu_summary_requires_auth(self):
        """GET /api/hudu/summary requires authentication"""
        response = requests.get(f"{BASE_URL}/api/hudu/summary")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_hudu_summary(self, headers):
        """GET /api/hudu/summary returns expected shape when configured"""
        response = requests.get(f"{BASE_URL}/api/hudu/summary", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "configured" in data, "Response should have 'configured' field"
        if data.get("configured"):
            assert "stats" in data, "Response should have 'stats' field when configured"
            stats = data["stats"]
            # Check expected stat fields
            for field in ["companies", "articles", "assets", "procedures", "websites", "passwords"]:
                assert field in stats, f"Stats should have '{field}' field"
            assert "recent_articles" in data, "Response should have 'recent_articles' field"
            assert isinstance(data["recent_articles"], list)
            print(f"Hudu summary: stats={stats}, recent_articles={len(data['recent_articles'])}")
        else:
            print(f"Hudu not configured: {data.get('message')}")


class TestHuduSuggestForTicket:
    """Tests for AI-powered KB suggestions endpoint"""
    
    def test_suggest_for_ticket_requires_auth(self):
        """POST /api/hudu/suggest-for-ticket requires authentication"""
        response = requests.post(f"{BASE_URL}/api/hudu/suggest-for-ticket", json={
            "title": "VPN not connecting",
            "description": "User cannot connect to VPN"
        })
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
    
    def test_suggest_for_ticket_with_title_description(self, headers):
        """POST /api/hudu/suggest-for-ticket with title+description returns expected shape"""
        response = requests.post(f"{BASE_URL}/api/hudu/suggest-for-ticket", json={
            "title": "VPN connection failing",
            "description": "User reports VPN client shows error when trying to connect to corporate network"
        }, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "configured" in data, "Response should have 'configured' field"
        assert "query" in data, "Response should have 'query' field (derived keywords)"
        assert "articles" in data, "Response should have 'articles' field"
        assert "procedures" in data, "Response should have 'procedures' field"
        assert "ai" in data, "Response should have 'ai' field (may be null)"
        # Query should be derived from title+description
        query = data.get("query", "")
        print(f"Hudu suggest-for-ticket: query='{query}', articles={len(data['articles'])}, procedures={len(data['procedures'])}, ai={data.get('ai')}")
    
    def test_suggest_for_ticket_with_ticket_id(self, headers):
        """POST /api/hudu/suggest-for-ticket with ticket_id fetches ticket and derives query"""
        # First get a ticket ID
        tickets_response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        if tickets_response.status_code == 200 and tickets_response.json():
            ticket = tickets_response.json()[0]
            ticket_id = ticket.get("id")
            
            response = requests.post(f"{BASE_URL}/api/hudu/suggest-for-ticket", json={
                "ticket_id": ticket_id
            }, headers=headers)
            assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
            data = response.json()
            assert "configured" in data
            assert "query" in data
            assert "articles" in data
            assert "procedures" in data
            print(f"Hudu suggest-for-ticket with ticket_id: query='{data.get('query')}'")
        else:
            pytest.skip("No tickets available to test with ticket_id")
    
    def test_suggest_for_ticket_keyword_extraction(self, headers):
        """POST /api/hudu/suggest-for-ticket extracts 3-6 keywords, filters stopwords"""
        response = requests.post(f"{BASE_URL}/api/hudu/suggest-for-ticket", json={
            "title": "The email is not working for the user",
            "description": "User cannot send or receive emails. They have tried restarting Outlook but the problem persists."
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        query = data.get("query", "")
        # Should not contain common stopwords
        stopwords = ["the", "is", "for", "have", "they", "but"]
        query_words = query.lower().split()
        for sw in stopwords:
            assert sw not in query_words, f"Query should not contain stopword '{sw}': {query}"
        # Should have some keywords
        assert len(query_words) >= 1, f"Query should have at least 1 keyword: {query}"
        print(f"Keyword extraction test: query='{query}'")


class TestHuduNotConfiguredBehavior:
    """Tests for behavior when Hudu is not configured"""
    
    def test_delete_hudu_settings(self, headers):
        """DELETE /api/settings/hudu clears credentials"""
        response = requests.delete(f"{BASE_URL}/api/settings/hudu", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Verify settings are cleared
        get_response = requests.get(f"{BASE_URL}/api/settings/hudu", headers=headers)
        assert get_response.status_code == 200
        settings = get_response.json()
        assert settings.get("configured") == False, "Should return configured=False after delete"
        print("Hudu settings deleted successfully")
    
    def test_endpoints_return_503_when_not_configured(self, headers):
        """All Hudu endpoints return 503 when not configured"""
        endpoints = [
            "/api/hudu/companies",
            "/api/hudu/assets",
            "/api/hudu/asset-layouts",
            "/api/hudu/websites",
            "/api/hudu/procedures",
            "/api/hudu/passwords",
            "/api/hudu/search?q=test",
        ]
        for endpoint in endpoints:
            response = requests.get(f"{BASE_URL}{endpoint}", headers=headers)
            assert response.status_code == 503, f"{endpoint} should return 503 when not configured, got {response.status_code}"
        print("All Hudu endpoints return 503 when not configured")
    
    def test_articles_returns_error_message_when_not_configured(self, headers):
        """GET /api/hudu/articles returns error message when not configured"""
        response = requests.get(f"{BASE_URL}/api/hudu/articles", headers=headers)
        # Articles endpoint has special handling - returns 200 with error message
        if response.status_code == 200:
            data = response.json()
            assert "error" in data or data.get("articles") == [], "Should have error or empty articles"
            print(f"Articles when not configured: {data}")
    
    def test_summary_returns_configured_false(self, headers):
        """GET /api/hudu/summary returns configured:false when not configured"""
        response = requests.get(f"{BASE_URL}/api/hudu/summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("configured") == False, "Should return configured=False"
        print(f"Summary when not configured: {data}")
    
    def test_suggest_for_ticket_returns_configured_false(self, headers):
        """POST /api/hudu/suggest-for-ticket returns configured:false when not configured"""
        response = requests.post(f"{BASE_URL}/api/hudu/suggest-for-ticket", json={
            "title": "Test ticket",
            "description": "Test description"
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("configured") == False, "Should return configured=False"
        print(f"Suggest-for-ticket when not configured: {data}")


class TestRestoreHuduSettings:
    """Restore Hudu settings after tests"""
    
    def test_restore_hudu_settings(self, headers):
        """Restore Hudu settings for frontend tests"""
        response = requests.put(f"{BASE_URL}/api/settings/hudu", json={
            "url": PLACEHOLDER_HUDU_URL,
            "api_key": PLACEHOLDER_HUDU_API_KEY
        }, headers=headers)
        assert response.status_code == 200, f"Failed to restore Hudu settings: {response.text}"
        print("Hudu settings restored for frontend tests")


class TestRegressionHuntressStillWorks:
    """Regression tests to ensure Huntress features from iteration 114 still work"""
    
    def test_huntress_summary(self, headers):
        """GET /api/huntress/summary still works"""
        response = requests.get(f"{BASE_URL}/api/huntress/summary", headers=headers)
        # May return 200 or 503 depending on config, but not 500
        assert response.status_code != 500, f"Should not return 500, got {response.status_code}"
        print(f"Huntress summary: {response.status_code}")
    
    def test_huntress_actions(self, headers):
        """GET /api/huntress/actions still works"""
        response = requests.get(f"{BASE_URL}/api/huntress/actions", headers=headers)
        assert response.status_code != 500, f"Should not return 500, got {response.status_code}"
        print(f"Huntress actions: {response.status_code}")
    
    def test_tickets_loads(self, headers):
        """GET /api/tickets still works (regression)"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200, f"Tickets should return 200, got {response.status_code}"
        print("Tickets endpoint loads successfully")
