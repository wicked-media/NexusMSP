"""
Iteration 98 - Testing 5 Revenue/Billing Features:
1. Late Payment Manager - predictions, overdue invoices, send reminder, send confirmation, reminder history
2. Usage-Based Billing - overview with MRR breakdown
3. Client IT Budget Tracker - budget overview with category breakdown
4. Revenue Forecaster - MRR/ARR forecast with churn risks
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "aaron@stech.com.au"
ADMIN_PASSWORD = "Lucky@2871$!"


class TestAuthentication:
    """Get auth token for subsequent tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in response"
        return data["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        """Auth headers for API calls"""
        return {"Authorization": f"Bearer {auth_token}"}


class TestLatePaymentPredictions(TestAuthentication):
    """Test Late Payment Predictions endpoint"""
    
    def test_get_predictions(self, headers):
        """GET /api/late-payment/predictions - returns predictions with risk scoring"""
        response = requests.get(f"{BASE_URL}/api/late-payment/predictions", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "predictions" in data, "Missing predictions array"
        assert "summary" in data, "Missing summary object"
        
        # Verify summary fields
        summary = data["summary"]
        assert "total_clients" in summary, "Missing total_clients in summary"
        assert "high_risk" in summary or "total_at_risk" in summary, "Missing risk metrics in summary"
        
        # If predictions exist, verify structure
        if data["predictions"]:
            pred = data["predictions"][0]
            assert "client_name" in pred, "Missing client_name in prediction"
            assert "risk" in pred, "Missing risk level in prediction"
            assert "outstanding_amount" in pred, "Missing outstanding_amount"
            print(f"Found {len(data['predictions'])} predictions, {summary.get('high_risk', 0)} high risk")


class TestLatePaymentOverdue(TestAuthentication):
    """Test Overdue Invoices endpoint"""
    
    def test_get_overdue_invoices(self, headers):
        """GET /api/late-payment/overdue-invoices - returns overdue invoices with days_overdue"""
        response = requests.get(f"{BASE_URL}/api/late-payment/overdue-invoices", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "overdue" in data, "Missing overdue array"
        assert "summary" in data, "Missing summary object"
        
        # Verify summary fields
        summary = data["summary"]
        assert "count" in summary, "Missing count in summary"
        assert "total_overdue" in summary, "Missing total_overdue in summary"
        
        # If overdue invoices exist, verify structure
        if data["overdue"]:
            inv = data["overdue"][0]
            assert "days_overdue" in inv, "Missing days_overdue in invoice"
            assert "balance_due" in inv, "Missing balance_due in invoice"
            print(f"Found {summary['count']} overdue invoices, total ${summary['total_overdue']}")


class TestLatePaymentReminder(TestAuthentication):
    """Test Send Reminder endpoint"""
    
    def test_send_reminder_requires_email(self, headers):
        """POST /api/late-payment/send-reminder - requires to_email"""
        response = requests.post(f"{BASE_URL}/api/late-payment/send-reminder", 
            headers=headers,
            json={
                "client_name": "Test Client",
                "invoice_number": "INV-TEST-001",
                "amount": 1000,
                "due_date": "2025-01-01",
                "days_late": 10
                # Missing to_email
            }
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        # Should fail gracefully when no email found
        assert "status" in data or "message" in data, "Missing status/message in response"
        print(f"Response without email: {data}")
    
    def test_send_reminder_with_email(self, headers):
        """POST /api/late-payment/send-reminder - sends email with to_email"""
        response = requests.post(f"{BASE_URL}/api/late-payment/send-reminder", 
            headers=headers,
            json={
                "client_name": "Test Client",
                "invoice_number": "INV-TEST-002",
                "amount": 1500.50,
                "due_date": "2025-01-01",
                "days_late": 15,
                "to_email": "test@example.com"  # Test email
            }
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        # Should return status (sent or failed based on Resend config)
        assert "status" in data or "message" in data, "Missing status in response"
        print(f"Send reminder response: {data}")


class TestPaymentConfirmation(TestAuthentication):
    """Test Payment Confirmation endpoint"""
    
    def test_send_confirmation(self, headers):
        """POST /api/late-payment/send-confirmation - sends confirmation email"""
        response = requests.post(f"{BASE_URL}/api/late-payment/send-confirmation", 
            headers=headers,
            json={
                "client_name": "Test Client",
                "invoice_number": "INV-TEST-003",
                "amount": 2500.00,
                "payment_method": "Credit Card",
                "to_email": "test@example.com",
                "cc_team": False  # Don't CC team for test
            }
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "results" in data or "message" in data, "Missing results/message in response"
        print(f"Send confirmation response: {data}")


class TestReminderHistory(TestAuthentication):
    """Test Reminder History endpoint"""
    
    def test_get_reminder_history(self, headers):
        """GET /api/late-payment/reminder-history - returns sent reminders"""
        response = requests.get(f"{BASE_URL}/api/late-payment/reminder-history", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Should return array of reminders
        assert isinstance(data, list), "Response should be an array"
        
        # If history exists, verify structure
        if data:
            reminder = data[0]
            assert "client_name" in reminder, "Missing client_name in reminder"
            assert "sent_at" in reminder, "Missing sent_at in reminder"
            print(f"Found {len(data)} reminders in history")
        else:
            print("No reminder history yet")


class TestUsageBilling(TestAuthentication):
    """Test Usage-Based Billing endpoint"""
    
    def test_get_billing_overview(self, headers):
        """GET /api/usage-billing/overview - returns plans with MRR breakdown"""
        response = requests.get(f"{BASE_URL}/api/usage-billing/overview", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "plans" in data, "Missing plans array"
        assert "summary" in data, "Missing summary object"
        
        # Verify summary fields
        summary = data["summary"]
        assert "total_mrr" in summary, "Missing total_mrr in summary"
        assert "total_clients" in summary, "Missing total_clients in summary"
        assert "avg_per_device" in summary, "Missing avg_per_device in summary"
        assert "overages_this_month" in summary, "Missing overages_this_month in summary"
        
        # Verify plans structure
        if data["plans"]:
            plan = data["plans"][0]
            assert "client_name" in plan, "Missing client_name in plan"
            assert "device_count" in plan, "Missing device_count in plan"
            assert "current_mrr" in plan, "Missing current_mrr in plan"
            assert "plan_type" in plan, "Missing plan_type in plan"
            print(f"Found {len(data['plans'])} usage plans, total MRR: ${summary['total_mrr']}")


class TestClientBudget(TestAuthentication):
    """Test Client IT Budget Tracker endpoint"""
    
    def test_get_budget_overview(self, headers):
        """GET /api/client-budget/overview - returns budgets with category breakdown"""
        response = requests.get(f"{BASE_URL}/api/client-budget/overview", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "budgets" in data, "Missing budgets array"
        assert "summary" in data, "Missing summary object"
        
        # Verify summary fields
        summary = data["summary"]
        assert "total_annual_budget" in summary, "Missing total_annual_budget in summary"
        assert "total_ytd_spent" in summary, "Missing total_ytd_spent in summary"
        assert "avg_utilization_pct" in summary, "Missing avg_utilization_pct in summary"
        
        # Verify budgets structure
        if data["budgets"]:
            budget = data["budgets"][0]
            assert "client_name" in budget, "Missing client_name in budget"
            assert "annual_budget" in budget, "Missing annual_budget in budget"
            assert "ytd_spent" in budget, "Missing ytd_spent in budget"
            assert "categories" in budget, "Missing categories in budget"
            
            # Verify category breakdown
            if budget["categories"]:
                cat = budget["categories"][0]
                assert "name" in cat, "Missing name in category"
                assert "budget" in cat, "Missing budget in category"
                assert "spent" in cat, "Missing spent in category"
            
            print(f"Found {len(data['budgets'])} client budgets, total annual: ${summary['total_annual_budget']}")


class TestRevenueForecast(TestAuthentication):
    """Test Revenue Forecaster endpoint"""
    
    def test_get_revenue_forecast(self, headers):
        """GET /api/revenue-forecast/dashboard - returns MRR/ARR forecast + churn risks"""
        response = requests.get(f"{BASE_URL}/api/revenue-forecast/dashboard", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "summary" in data, "Missing summary object"
        assert "forecast" in data, "Missing forecast array"
        assert "churn_risks" in data, "Missing churn_risks array"
        
        # Verify summary fields
        summary = data["summary"]
        assert "current_mrr" in summary, "Missing current_mrr in summary"
        assert "current_arr" in summary, "Missing current_arr in summary"
        assert "projected_arr_12m" in summary, "Missing projected_arr_12m in summary"
        assert "total_clients" in summary, "Missing total_clients in summary"
        assert "churn_risks" in summary, "Missing churn_risks count in summary"
        
        # Verify forecast structure (12 months)
        assert len(data["forecast"]) == 12, f"Expected 12 months forecast, got {len(data['forecast'])}"
        if data["forecast"]:
            month = data["forecast"][0]
            assert "month" in month, "Missing month in forecast"
            assert "mrr" in month, "Missing mrr in forecast"
            assert "arr" in month, "Missing arr in forecast"
            assert "growth_pct" in month, "Missing growth_pct in forecast"
        
        # Verify churn risks structure (if any)
        if data["churn_risks"]:
            risk = data["churn_risks"][0]
            assert "client_name" in risk, "Missing client_name in churn risk"
            assert "mrr" in risk, "Missing mrr in churn risk"
            assert "risk" in risk, "Missing risk level in churn risk"
        
        print(f"Revenue Forecast: MRR ${summary['current_mrr']}, ARR ${summary['current_arr']}, {summary['churn_risks']} churn risks")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
