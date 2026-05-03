"""
Iteration 150: Help Center Audit Articles + LateRiskBadge Tests
Tests:
- 3 new help articles (devices-page-audit, invoice-detail-audit, backup-page-audit)
- Help articles count = 59
- Late-risk endpoint for invoices
- Regression: existing endpoints
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication for all tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.json()["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}


class TestHelpArticles(TestAuth):
    """Help Center article tests - 3 new audit articles"""
    
    def test_help_articles_count_is_59(self, headers):
        """Verify total help articles count is 59 (was 56, added 3 new)"""
        # First seed to ensure articles exist
        seed_resp = requests.post(f"{BASE_URL}/api/help/seed", headers=headers)
        assert seed_resp.status_code == 200
        
        response = requests.get(f"{BASE_URL}/api/help/articles", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 59, f"Expected 59 articles, got {data['count']}"
    
    def test_devices_page_audit_article(self, headers):
        """Verify devices-page-audit article exists with correct content"""
        response = requests.get(f"{BASE_URL}/api/help/articles/devices-page-audit", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["slug"] == "devices-page-audit"
        assert data["title"] == "Devices Page — Every Button & Filter Explained"
        assert data["category"] == "Infrastructure"
        assert "TRMM Freshness Strip" in data["body_md"]
        assert "Tinker" in data["body_md"]
    
    def test_invoice_detail_audit_article(self, headers):
        """Verify invoice-detail-audit article exists with correct content"""
        response = requests.get(f"{BASE_URL}/api/help/articles/invoice-detail-audit", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["slug"] == "invoice-detail-audit"
        assert data["title"] == "Invoice Detail — Every Button Explained"
        assert data["category"] == "Business"
        assert "Late-payment risk" in data["body_md"]
        assert "Dispute Shield" in data["body_md"]
    
    def test_backup_page_audit_article(self, headers):
        """Verify backup-page-audit article exists with correct content"""
        response = requests.get(f"{BASE_URL}/api/help/articles/backup-page-audit", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["slug"] == "backup-page-audit"
        assert data["title"] == "Backup Center — Every Tab Explained"
        assert data["category"] == "Infrastructure"
        assert "Acronis" in data["body_md"]
        assert "Restore Drills" in data["body_md"]


class TestLateRiskEndpoint(TestAuth):
    """Late-payment risk endpoint tests"""
    
    def test_late_risk_endpoint_returns_valid_response(self, headers):
        """Verify /api/invoices/{id}/late-risk returns score, band, reasons"""
        # Get an unpaid invoice
        inv_resp = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        assert inv_resp.status_code == 200
        invoices = inv_resp.json()
        unpaid = [i for i in invoices if i.get('payment_status') != 'paid']
        
        if not unpaid:
            pytest.skip("No unpaid invoices to test late-risk")
        
        inv_id = unpaid[0]["id"]
        response = requests.get(f"{BASE_URL}/api/invoices/{inv_id}/late-risk", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "score" in data, "Missing 'score' in response"
        assert "band" in data, "Missing 'band' in response"
        assert "reasons" in data, "Missing 'reasons' in response"
        
        # Verify data types
        assert isinstance(data["score"], (int, float)), "Score should be numeric"
        assert data["band"] in ["low", "medium", "high"], f"Invalid band: {data['band']}"
        assert isinstance(data["reasons"], list), "Reasons should be a list"
    
    def test_late_risk_score_range(self, headers):
        """Verify late-risk score is between 0-100"""
        inv_resp = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        invoices = inv_resp.json()
        unpaid = [i for i in invoices if i.get('payment_status') != 'paid']
        
        if not unpaid:
            pytest.skip("No unpaid invoices to test")
        
        inv_id = unpaid[0]["id"]
        response = requests.get(f"{BASE_URL}/api/invoices/{inv_id}/late-risk", headers=headers)
        data = response.json()
        
        assert 0 <= data["score"] <= 100, f"Score {data['score']} out of range 0-100"


class TestRegressionEndpoints(TestAuth):
    """Regression tests for existing endpoints"""
    
    def test_invoices_list(self, headers):
        """Verify invoices list endpoint works"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_clients_list(self, headers):
        """Verify clients list endpoint works"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_tickets_list(self, headers):
        """Verify tickets list endpoint works"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_devices_list(self, headers):
        """Verify devices list endpoint works"""
        response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_help_copilot(self, headers):
        """Verify help copilot endpoint works"""
        response = requests.post(f"{BASE_URL}/api/help/copilot", 
                                 json={"question": "How do I create a ticket?"},
                                 headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "answer" in data
        assert "citations" in data


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
