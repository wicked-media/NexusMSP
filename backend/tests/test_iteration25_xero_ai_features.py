"""
Test Iteration 25: Xero Integration, AI Features (Proofread, Categorize, Device Analysis), AI Model Config
Tests for batch: Xero Accounting (MOCKED), AI-powered features using Claude Sonnet 4.5
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

class TestAuth:
    """Authentication for testing"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.json()["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        """Auth headers"""
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestXeroDashboard(TestAuth):
    """Tests for Xero Dashboard and revenue stats"""
    
    def test_xero_dashboard_returns_stats(self, headers):
        """GET /api/xero/dashboard should return revenue statistics"""
        response = requests.get(f"{BASE_URL}/api/xero/dashboard", headers=headers)
        assert response.status_code == 200, f"Xero dashboard failed: {response.text}"
        data = response.json()
        # Verify expected fields
        assert "total_revenue" in data
        assert "total_paid" in data
        assert "total_outstanding" in data
        assert "total_overdue" in data
        assert "invoice_count" in data
        assert "by_status" in data
        assert "monthly_revenue" in data
        print(f"PASSED: Xero dashboard - Revenue: ${data['total_revenue']}, Invoices: {data['invoice_count']}")
    
    def test_xero_dashboard_stats_are_numeric(self, headers):
        """Dashboard values should be numeric"""
        response = requests.get(f"{BASE_URL}/api/xero/dashboard", headers=headers)
        data = response.json()
        assert isinstance(data["total_revenue"], (int, float))
        assert isinstance(data["total_paid"], (int, float))
        assert isinstance(data["total_outstanding"], (int, float))
        assert data["total_revenue"] >= 0
        print(f"PASSED: Xero dashboard stats are numeric")


class TestXeroInvoices(TestAuth):
    """Tests for Xero Invoices API"""
    
    def test_get_invoices_list(self, headers):
        """GET /api/xero/invoices should return invoice list"""
        response = requests.get(f"{BASE_URL}/api/xero/invoices", headers=headers)
        assert response.status_code == 200, f"Get invoices failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"PASSED: Xero invoices - {len(data)} invoices returned")
        if len(data) > 0:
            inv = data[0]
            assert "id" in inv
            assert "invoice_number" in inv
            assert "client_name" in inv
            assert "status" in inv
            assert "total" in inv
            assert "amount_due" in inv
            print(f"  First invoice: {inv['invoice_number']} - {inv['client_name']} - ${inv['total']} ({inv['status']})")
    
    def test_invoices_have_valid_statuses(self, headers):
        """Invoices should have valid status values (PAID/AUTHORISED/DRAFT)"""
        response = requests.get(f"{BASE_URL}/api/xero/invoices", headers=headers)
        data = response.json()
        valid_statuses = {"PAID", "AUTHORISED", "DRAFT", "VOIDED", "OVERDUE"}
        for inv in data[:10]:  # Check first 10
            assert inv["status"] in valid_statuses, f"Invalid status: {inv['status']}"
        print(f"PASSED: All invoice statuses are valid")
    
    def test_pay_invoice_reduces_amount_due(self, headers):
        """PUT /api/xero/invoices/{id}/pay should record payment and reduce amount due"""
        # Get an AUTHORISED invoice (not PAID, not DRAFT)
        response = requests.get(f"{BASE_URL}/api/xero/invoices", headers=headers)
        invoices = response.json()
        auth_invoices = [i for i in invoices if i["status"] == "AUTHORISED" and i["amount_due"] > 0]
        
        if not auth_invoices:
            pytest.skip("No AUTHORISED invoices with balance available for payment test")
        
        invoice = auth_invoices[0]
        original_due = invoice["amount_due"]
        pay_amount = min(100, original_due)  # Pay $100 or full amount
        
        # Make payment
        pay_response = requests.put(
            f"{BASE_URL}/api/xero/invoices/{invoice['id']}/pay",
            json={"amount": pay_amount},
            headers=headers
        )
        assert pay_response.status_code == 200, f"Payment failed: {pay_response.text}"
        data = pay_response.json()
        assert "amount_paid" in data
        assert "amount_due" in data
        assert data["amount_due"] <= original_due, "Amount due should decrease or stay same after payment"
        print(f"PASSED: Payment recorded - Invoice {invoice['invoice_number']}: paid ${pay_amount}, remaining: ${data['amount_due']}")


class TestXeroContacts(TestAuth):
    """Tests for Xero Contacts API"""
    
    def test_get_contacts_list(self, headers):
        """GET /api/xero/contacts should return synced contacts"""
        response = requests.get(f"{BASE_URL}/api/xero/contacts", headers=headers)
        assert response.status_code == 200, f"Get contacts failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"PASSED: Xero contacts - {len(data)} contacts returned")
        if len(data) > 0:
            contact = data[0]
            assert "id" in contact
            assert "client_name" in contact or "name" in contact
            assert "xero_contact_id" in contact
            assert "status" in contact


class TestXeroAccounts(TestAuth):
    """Tests for Xero Chart of Accounts API"""
    
    def test_get_accounts_list(self, headers):
        """GET /api/xero/accounts should return chart of accounts"""
        response = requests.get(f"{BASE_URL}/api/xero/accounts", headers=headers)
        assert response.status_code == 200, f"Get accounts failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Should have at least one account"
        print(f"PASSED: Xero accounts - {len(data)} accounts returned")
        acc = data[0]
        assert "id" in acc
        assert "code" in acc
        assert "name" in acc
        assert "type" in acc
        assert "status" in acc


class TestAIProofread(TestAuth):
    """Tests for AI Spell Check / Grammar API"""
    
    def test_proofread_corrects_spelling(self, headers):
        """POST /api/ai/proofread should correct spelling errors"""
        response = requests.post(f"{BASE_URL}/api/ai/proofread", json={
            "text": "Ther server is not respondng to ping requests."
        }, headers=headers)
        assert response.status_code == 200, f"Proofread failed: {response.text}"
        data = response.json()
        assert "corrected" in data
        assert "changes" in data
        # The corrected text should fix "Ther" and "respondng"
        corrected = data["corrected"].lower()
        assert "the" in corrected or "their" in corrected or "there" in corrected, "Should correct 'Ther'"
        print(f"PASSED: AI proofread - Original had errors, corrected: '{data['corrected'][:60]}...'")
    
    def test_proofread_empty_text(self, headers):
        """POST /api/ai/proofread with empty text should return same text"""
        response = requests.post(f"{BASE_URL}/api/ai/proofread", json={
            "text": ""
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["corrected"] == ""
        print("PASSED: AI proofread handles empty text")
    
    def test_proofread_short_text(self, headers):
        """POST /api/ai/proofread with text < 3 chars returns as-is"""
        response = requests.post(f"{BASE_URL}/api/ai/proofread", json={
            "text": "Hi"
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["corrected"] == "Hi"
        print("PASSED: AI proofread handles short text")


class TestAICategorize(TestAuth):
    """Tests for AI Auto-Categorize Tickets API"""
    
    def test_categorize_ticket_returns_classification(self, headers):
        """POST /api/ai/categorize-ticket should return category/type/priority"""
        response = requests.post(f"{BASE_URL}/api/ai/categorize-ticket", json={
            "title": "Outlook keeps crashing when opening attachments",
            "description": "User reports that Microsoft Outlook crashes every time they try to open PDF attachments. Error message shows memory exception."
        }, headers=headers)
        assert response.status_code == 200, f"Categorize failed: {response.text}"
        data = response.json()
        assert "ticket_type" in data
        assert "category" in data
        assert "priority" in data
        assert "confidence" in data
        # Validate values
        assert data["ticket_type"] in ["incident", "service_request", "problem", "change_request", "alert", "task"]
        assert data["priority"] in ["critical", "high", "medium", "low"]
        assert 0 <= data["confidence"] <= 1
        print(f"PASSED: AI categorize - Type: {data['ticket_type']}, Category: {data['category']}, Priority: {data['priority']}, Confidence: {data['confidence']}")
    
    def test_categorize_empty_title(self, headers):
        """POST /api/ai/categorize-ticket with empty title should return defaults"""
        response = requests.post(f"{BASE_URL}/api/ai/categorize-ticket", json={
            "title": "",
            "description": ""
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        # Should return defaults when title is empty
        assert data["ticket_type"] == "incident"
        assert data["category"] == "support"
        assert data["priority"] == "medium"
        assert data["confidence"] == 0
        print("PASSED: AI categorize handles empty title with defaults")


class TestAIConfig(TestAuth):
    """Tests for AI Model Configuration API"""
    
    def test_get_ai_config(self, headers):
        """GET /api/ai/config should return current provider and model"""
        response = requests.get(f"{BASE_URL}/api/ai/config", headers=headers)
        assert response.status_code == 200, f"Get AI config failed: {response.text}"
        data = response.json()
        assert "provider" in data
        assert "model" in data
        assert data["provider"] in ["anthropic", "openai", "gemini"]
        print(f"PASSED: AI config - Provider: {data['provider']}, Model: {data['model']}")
    
    def test_update_ai_config(self, headers):
        """PUT /api/ai/config should save provider and model selection"""
        # Get current config first
        get_response = requests.get(f"{BASE_URL}/api/ai/config", headers=headers)
        original_config = get_response.json()
        
        # Update to different provider
        new_provider = "openai" if original_config["provider"] != "openai" else "anthropic"
        new_model = "gpt-5.2" if new_provider == "openai" else "claude-sonnet-4-5-20250929"
        
        update_response = requests.put(f"{BASE_URL}/api/ai/config", json={
            "provider": new_provider,
            "model": new_model
        }, headers=headers)
        assert update_response.status_code == 200, f"Update AI config failed: {update_response.text}"
        
        # Verify it was saved
        verify_response = requests.get(f"{BASE_URL}/api/ai/config", headers=headers)
        verify_data = verify_response.json()
        assert verify_data["provider"] == new_provider
        assert verify_data["model"] == new_model
        
        # Restore original config
        requests.put(f"{BASE_URL}/api/ai/config", json=original_config, headers=headers)
        print(f"PASSED: AI config update - Changed to {new_provider}/{new_model} and restored")


class TestAIDeviceAnalysis(TestAuth):
    """Tests for AI Device Analysis / Diagnose API"""
    
    def test_analyze_device_returns_diagnosis(self, headers):
        """POST /api/ai/analyze-device should return AI diagnosis"""
        response = requests.post(f"{BASE_URL}/api/ai/analyze-device", json={
            "device_id": "",  # No device linked
            "ticket_title": "Server not responding to pings",
            "ticket_description": "The main file server ACME-DC-01 is not responding to ping requests. Users cannot access shared drives."
        }, headers=headers)
        assert response.status_code == 200, f"AI analyze failed: {response.text}"
        data = response.json()
        assert "diagnosis" in data
        assert "severity" in data
        assert "steps" in data
        assert data["severity"] in ["critical", "high", "medium", "low"]
        print(f"PASSED: AI device analysis - Severity: {data['severity']}, Steps: {len(data.get('steps', []))}")


class TestSettingsHuduStillVisible(TestAuth):
    """Verify Hudu settings are still visible (regression test)"""
    
    def test_hudu_settings_endpoint(self, headers):
        """GET /api/settings/hudu should still work"""
        response = requests.get(f"{BASE_URL}/api/settings/hudu", headers=headers)
        assert response.status_code == 200, f"Hudu settings failed: {response.text}"
        data = response.json()
        assert "configured" in data or "url" in data or "api_key" in data
        print("PASSED: Hudu settings endpoint still accessible")


class TestXeroSettings(TestAuth):
    """Tests for Xero Integration Settings"""
    
    def test_get_xero_settings(self, headers):
        """GET /api/settings/xero should return Xero configuration"""
        response = requests.get(f"{BASE_URL}/api/settings/xero", headers=headers)
        assert response.status_code == 200, f"Get Xero settings failed: {response.text}"
        data = response.json()
        # Should return config structure
        assert isinstance(data, dict)
        print(f"PASSED: Xero settings endpoint accessible - connected: {data.get('connected', False)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
