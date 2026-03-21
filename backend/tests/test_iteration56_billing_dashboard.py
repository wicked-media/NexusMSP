"""
Iteration 56 - Billing Command Center Dashboard Tests
Tests for the new Billing Dashboard feature including:
- GET /api/billing-dashboard/metrics - Returns all billing metrics
- POST /api/billing-dashboard/chase/{invoice_id} - Chase overdue invoice
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestBillingDashboard:
    """Billing Dashboard API tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures - authenticate and get token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get auth token
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        
        if login_response.status_code == 200:
            token = login_response.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
            self.authenticated = True
        else:
            self.authenticated = False
            pytest.skip("Authentication failed - skipping authenticated tests")
    
    def test_auth_login(self):
        """Test authentication works"""
        assert self.authenticated, "Should be authenticated"
    
    # ==================== BILLING DASHBOARD METRICS ====================
    
    def test_billing_dashboard_metrics_endpoint_exists(self):
        """Test GET /api/billing-dashboard/metrics returns 200"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    
    def test_billing_dashboard_metrics_has_mrr(self):
        """Test metrics response contains MRR field"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "mrr" in data, "Response should contain 'mrr' field"
        assert isinstance(data["mrr"], (int, float)), "MRR should be a number"
    
    def test_billing_dashboard_metrics_has_arr(self):
        """Test metrics response contains ARR field"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "arr" in data, "Response should contain 'arr' field"
        assert isinstance(data["arr"], (int, float)), "ARR should be a number"
    
    def test_billing_dashboard_metrics_has_payment_health_score(self):
        """Test metrics response contains payment_health_score field"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "payment_health_score" in data, "Response should contain 'payment_health_score' field"
        assert isinstance(data["payment_health_score"], (int, float)), "payment_health_score should be a number"
        assert 0 <= data["payment_health_score"] <= 100, "payment_health_score should be between 0 and 100"
    
    def test_billing_dashboard_metrics_has_streak(self):
        """Test metrics response contains streak object with current, best, level"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "streak" in data, "Response should contain 'streak' field"
        streak = data["streak"]
        assert "current" in streak, "Streak should have 'current' field"
        assert "best" in streak, "Streak should have 'best' field"
        assert "level" in streak, "Streak should have 'level' field"
        assert streak["level"] in ["starter", "warming", "hot", "fire", "legendary"], f"Invalid streak level: {streak['level']}"
    
    def test_billing_dashboard_metrics_has_overdue_alerts(self):
        """Test metrics response contains overdue_alerts array"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "overdue_alerts" in data, "Response should contain 'overdue_alerts' field"
        assert isinstance(data["overdue_alerts"], list), "overdue_alerts should be a list"
    
    def test_billing_dashboard_metrics_has_monthly_trend(self):
        """Test metrics response contains monthly_trend array"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "monthly_trend" in data, "Response should contain 'monthly_trend' field"
        assert isinstance(data["monthly_trend"], list), "monthly_trend should be a list"
        # Should have 6 months of data
        assert len(data["monthly_trend"]) == 6, f"Expected 6 months of trend data, got {len(data['monthly_trend'])}"
    
    def test_billing_dashboard_metrics_has_top_debtors(self):
        """Test metrics response contains top_debtors array"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "top_debtors" in data, "Response should contain 'top_debtors' field"
        assert isinstance(data["top_debtors"], list), "top_debtors should be a list"
    
    def test_billing_dashboard_metrics_has_recent_payments(self):
        """Test metrics response contains recent_payments array"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "recent_payments" in data, "Response should contain 'recent_payments' field"
        assert isinstance(data["recent_payments"], list), "recent_payments should be a list"
    
    def test_billing_dashboard_metrics_has_cash_flow_forecast(self):
        """Test metrics response contains cash_flow_forecast object"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "cash_flow_forecast" in data, "Response should contain 'cash_flow_forecast' field"
        forecast = data["cash_flow_forecast"]
        assert "incoming_30d" in forecast, "cash_flow_forecast should have 'incoming_30d'"
        assert "outgoing_30d" in forecast, "cash_flow_forecast should have 'outgoing_30d'"
        assert "net_30d" in forecast, "cash_flow_forecast should have 'net_30d'"
    
    def test_billing_dashboard_metrics_has_counts(self):
        """Test metrics response contains counts object with invoice pipeline data"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "counts" in data, "Response should contain 'counts' field"
        counts = data["counts"]
        assert "total_invoices" in counts, "counts should have 'total_invoices'"
        assert "draft" in counts, "counts should have 'draft'"
        assert "sent" in counts, "counts should have 'sent'"
        assert "paid" in counts, "counts should have 'paid'"
        assert "overdue" in counts, "counts should have 'overdue'"
    
    def test_billing_dashboard_metrics_has_revenue_stats(self):
        """Test metrics response contains revenue statistics"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "total_invoiced" in data, "Response should contain 'total_invoiced'"
        assert "total_collected" in data, "Response should contain 'total_collected'"
        assert "total_outstanding" in data, "Response should contain 'total_outstanding'"
        assert "collection_rate" in data, "Response should contain 'collection_rate'"
    
    def test_billing_dashboard_metrics_overdue_alert_structure(self):
        """Test overdue_alerts items have correct structure"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200
        data = response.json()
        
        if len(data["overdue_alerts"]) > 0:
            alert = data["overdue_alerts"][0]
            assert "id" in alert, "Alert should have 'id'"
            assert "invoice_number" in alert, "Alert should have 'invoice_number'"
            assert "client_name" in alert, "Alert should have 'client_name'"
            assert "days_overdue" in alert, "Alert should have 'days_overdue'"
            assert "balance" in alert, "Alert should have 'balance'"
            assert "severity" in alert, "Alert should have 'severity'"
            assert alert["severity"] in ["critical", "high", "medium", "low"], f"Invalid severity: {alert['severity']}"
    
    def test_billing_dashboard_metrics_monthly_trend_structure(self):
        """Test monthly_trend items have correct structure"""
        response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code == 200
        data = response.json()
        
        if len(data["monthly_trend"]) > 0:
            month = data["monthly_trend"][0]
            assert "month" in month, "Month should have 'month' label"
            assert "invoiced" in month, "Month should have 'invoiced'"
            assert "collected" in month, "Month should have 'collected'"
    
    # ==================== CHASE ENDPOINT ====================
    
    def test_chase_endpoint_requires_valid_invoice(self):
        """Test POST /api/billing-dashboard/chase/{id} returns 404 for invalid invoice"""
        response = self.session.post(f"{BASE_URL}/api/billing-dashboard/chase/invalid-invoice-id")
        assert response.status_code == 404, f"Expected 404 for invalid invoice, got {response.status_code}"
    
    def test_chase_endpoint_with_valid_invoice(self):
        """Test POST /api/billing-dashboard/chase/{id} works with valid overdue invoice"""
        # First get metrics to find an overdue invoice
        metrics_response = self.session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert metrics_response.status_code == 200
        data = metrics_response.json()
        
        if len(data["overdue_alerts"]) > 0:
            invoice_id = data["overdue_alerts"][0]["id"]
            chase_response = self.session.post(f"{BASE_URL}/api/billing-dashboard/chase/{invoice_id}")
            assert chase_response.status_code == 200, f"Expected 200, got {chase_response.status_code}: {chase_response.text}"
            
            chase_data = chase_response.json()
            assert "message" in chase_data, "Chase response should have 'message'"
            assert "chased_at" in chase_data, "Chase response should have 'chased_at'"
        else:
            # If no overdue invoices, try with any invoice
            invoices_response = self.session.get(f"{BASE_URL}/api/invoices")
            if invoices_response.status_code == 200:
                invoices = invoices_response.json()
                if len(invoices) > 0:
                    invoice_id = invoices[0].get("id")
                    if invoice_id:
                        chase_response = self.session.post(f"{BASE_URL}/api/billing-dashboard/chase/{invoice_id}")
                        assert chase_response.status_code == 200, f"Expected 200, got {chase_response.status_code}: {chase_response.text}"
                        
                        chase_data = chase_response.json()
                        assert "message" in chase_data, "Chase response should have 'message'"
                        assert "chased_at" in chase_data, "Chase response should have 'chased_at'"
                else:
                    pytest.skip("No invoices available to test chase endpoint")
            else:
                pytest.skip("Could not fetch invoices to test chase endpoint")
    
    # ==================== UNAUTHENTICATED ACCESS ====================
    
    def test_billing_dashboard_metrics_requires_auth(self):
        """Test GET /api/billing-dashboard/metrics requires authentication"""
        unauth_session = requests.Session()
        response = unauth_session.get(f"{BASE_URL}/api/billing-dashboard/metrics")
        assert response.status_code in [401, 403], f"Expected 401/403 for unauthenticated request, got {response.status_code}"
    
    def test_chase_endpoint_requires_auth(self):
        """Test POST /api/billing-dashboard/chase/{id} requires authentication"""
        unauth_session = requests.Session()
        response = unauth_session.post(f"{BASE_URL}/api/billing-dashboard/chase/some-id")
        assert response.status_code in [401, 403], f"Expected 401/403 for unauthenticated request, got {response.status_code}"
