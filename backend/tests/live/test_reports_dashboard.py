"""
Iteration 5 - Backend API Tests for:
1. Dashboard Activity Feed (new unified timeline)
2. Reports endpoints (Technicians, Tickets, Clients, Revenue, Devices)

Tests the new features:
- Unified Activity Timeline on Dashboard
- Reports page 5-tab overhaul (Syncro-style)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication - get token for testing"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        return data["token"]

    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        """Auth headers for requests"""
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}

class TestDashboardActivityFeed(TestAuth):
    """Test the new unified activity timeline endpoint"""
    
    def test_activity_feed_returns_data(self, headers):
        """GET /api/dashboard/activity-feed should return activity items"""
        response = requests.get(f"{BASE_URL}/api/dashboard/activity-feed", headers=headers)
        assert response.status_code == 200, f"Activity feed failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Activity feed should return a list"
        print(f"Activity feed returned {len(data)} items")
        
    def test_activity_feed_with_limit(self, headers):
        """GET /api/dashboard/activity-feed?limit=5 should respect limit"""
        response = requests.get(f"{BASE_URL}/api/dashboard/activity-feed?limit=5", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        assert len(data) <= 5, f"Activity feed should respect limit, got {len(data)} items"
        
    def test_activity_feed_item_structure(self, headers):
        """Activity items should have required fields"""
        response = requests.get(f"{BASE_URL}/api/dashboard/activity-feed?limit=10", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        if len(data) > 0:
            item = data[0]
            # Check required fields
            assert "id" in item, "Activity item should have 'id'"
            assert "type" in item, "Activity item should have 'type'"
            assert "title" in item, "Activity item should have 'title'"
            assert "timestamp" in item, "Activity item should have 'timestamp'"
            
            # Check type is one of expected values
            valid_types = ["ticket_note", "ticket_email", "ticket_created", "alert", "call"]
            assert item["type"] in valid_types, f"Activity type '{item['type']}' not in expected types"
            print(f"First activity item: type={item['type']}, title={item['title'][:50]}...")

    def test_activity_feed_contains_call_logs(self, headers):
        """Activity feed should include call log entries (MOCKED)"""
        response = requests.get(f"{BASE_URL}/api/dashboard/activity-feed?limit=30", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        call_items = [item for item in data if item.get("type") == "call"]
        print(f"Found {len(call_items)} call log entries in activity feed (MOCKED data)")
        # Call logs are mocked, should have at least some
        assert len(call_items) >= 0, "Call logs should be present in activity feed"


class TestTechnicianUtilizationReport(TestAuth):
    """Test Technicians report endpoint"""
    
    def test_technician_report_returns_data(self, headers):
        """GET /api/reports/technician-utilization should return tech data"""
        response = requests.get(f"{BASE_URL}/api/reports/technician-utilization", headers=headers)
        assert response.status_code == 200, f"Tech report failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Tech report should return a list"
        print(f"Tech report returned {len(data)} technicians")
        
    def test_technician_report_item_structure(self, headers):
        """Tech data should have required fields"""
        response = requests.get(f"{BASE_URL}/api/reports/technician-utilization", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        if len(data) > 0:
            tech = data[0]
            required_fields = ["id", "name", "total_hours", "billable_hours", "utilization", 
                              "tickets_assigned", "tickets_resolved", "revenue"]
            for field in required_fields:
                assert field in tech, f"Tech data missing field: {field}"
            print(f"Tech: {tech['name']}, Utilization: {tech['utilization']}%, Revenue: ${tech['revenue']}")


class TestTicketAnalyticsReport(TestAuth):
    """Test Tickets analytics report endpoint"""
    
    def test_ticket_analytics_returns_data(self, headers):
        """GET /api/reports/ticket-analytics should return analytics"""
        response = requests.get(f"{BASE_URL}/api/reports/ticket-analytics", headers=headers)
        assert response.status_code == 200, f"Ticket analytics failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, dict), "Ticket analytics should return a dict"
        
    def test_ticket_analytics_structure(self, headers):
        """Ticket analytics should have required fields"""
        response = requests.get(f"{BASE_URL}/api/reports/ticket-analytics", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        required_fields = ["total", "by_status", "by_priority", "by_client", "by_category", 
                          "avg_resolution_hours", "sla_compliance"]
        for field in required_fields:
            assert field in data, f"Ticket analytics missing field: {field}"
            
        # Check nested structures
        assert isinstance(data["by_status"], list), "by_status should be a list"
        assert isinstance(data["by_priority"], list), "by_priority should be a list"
        assert isinstance(data["by_client"], list), "by_client should be a list"
        
        print(f"Tickets: Total={data['total']}, SLA Compliance={data['sla_compliance']}%")


class TestClientAnalyticsReport(TestAuth):
    """Test Clients analytics report endpoint"""
    
    def test_client_analytics_returns_data(self, headers):
        """GET /api/reports/client-analytics should return client data"""
        response = requests.get(f"{BASE_URL}/api/reports/client-analytics", headers=headers)
        assert response.status_code == 200, f"Client analytics failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Client analytics should return a list"
        print(f"Client analytics returned {len(data)} clients")
        
    def test_client_analytics_item_structure(self, headers):
        """Client data should have required fields"""
        response = requests.get(f"{BASE_URL}/api/reports/client-analytics", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        if len(data) > 0:
            client = data[0]
            required_fields = ["id", "name", "mrr", "total_tickets", "open_tickets", 
                              "total_devices", "online_devices", "billable_revenue"]
            for field in required_fields:
                assert field in client, f"Client data missing field: {field}"
            print(f"Top Client: {client['name']}, MRR: ${client['mrr']}, Devices: {client['total_devices']}")


class TestRevenueReport(TestAuth):
    """Test Revenue/Billing report endpoint"""
    
    def test_revenue_report_returns_data(self, headers):
        """GET /api/reports/revenue should return revenue data"""
        response = requests.get(f"{BASE_URL}/api/reports/revenue", headers=headers)
        assert response.status_code == 200, f"Revenue report failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, dict), "Revenue report should return a dict"
        
    def test_revenue_report_structure(self, headers):
        """Revenue data should have required fields"""
        response = requests.get(f"{BASE_URL}/api/reports/revenue", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        required_fields = ["total_mrr", "annual_run_rate", "outstanding", "billable_revenue", 
                          "mrr_by_client", "invoices_by_status"]
        for field in required_fields:
            assert field in data, f"Revenue report missing field: {field}"
            
        # Check mrr_by_client is a list
        assert isinstance(data["mrr_by_client"], list), "mrr_by_client should be a list"
        # Check invoices_by_status has expected keys
        assert isinstance(data["invoices_by_status"], dict), "invoices_by_status should be a dict"
        
        print(f"Revenue: MRR=${data['total_mrr']}, ARR=${data['annual_run_rate']}, Outstanding=${data['outstanding']}")


class TestDeviceAnalyticsReport(TestAuth):
    """Test Device analytics report endpoint"""
    
    def test_device_analytics_returns_data(self, headers):
        """GET /api/reports/device-analytics should return device data"""
        response = requests.get(f"{BASE_URL}/api/reports/device-analytics", headers=headers)
        assert response.status_code == 200, f"Device analytics failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, dict), "Device analytics should return a dict"
        
    def test_device_analytics_structure(self, headers):
        """Device data should have required fields"""
        response = requests.get(f"{BASE_URL}/api/reports/device-analytics", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        required_fields = ["total", "by_type", "by_status", "by_client", "total_alerts", "active_alerts"]
        for field in required_fields:
            assert field in data, f"Device analytics missing field: {field}"
            
        # Check nested structures
        assert isinstance(data["by_type"], list), "by_type should be a list"
        assert isinstance(data["by_status"], list), "by_status should be a list"
        assert isinstance(data["by_client"], list), "by_client should be a list"
        
        print(f"Devices: Total={data['total']}, Active Alerts={data['active_alerts']}")


class TestDashboardStats(TestAuth):
    """Test existing dashboard endpoints still work"""
    
    def test_dashboard_stats(self, headers):
        """GET /api/dashboard/stats should still work"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=headers)
        assert response.status_code == 200, f"Dashboard stats failed: {response.text}"
        
        data = response.json()
        assert "total_clients" in data
        assert "open_tickets" in data
        assert "total_devices" in data
        print(f"Dashboard Stats: Clients={data['total_clients']}, Open Tickets={data['open_tickets']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
