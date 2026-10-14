"""
Iteration 28: Testing 6 Core Module Enhancements
- Dashboard: SLA countdown, device fleet, quick search, auto-refresh, stats cards, operational alerts
- Reports: 7 tabs, SLA Compliance, Profitability, CSV exports
- Time Tracking: Live timer, weekly chart, by-technician/client tabs, CSV export
- Knowledge Base: Article pinning, public/internal toggle, Hudu sync, related articles
- Devices: Bulk select/actions (reboot, scan, delete)
- Scripting: CodeBlock component, script library with copy button
- CoPilot: Code blocks rendered properly
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json()["token"]

@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ==================== DASHBOARD TESTS ====================

class TestDashboardEnhancements:
    """Dashboard: SLA countdown, device fleet, quick search, stats, operational alerts"""

    def test_dashboard_stats(self, headers):
        """Dashboard stats returns real data for clients, devices, tickets, revenue"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=headers)
        assert response.status_code == 200
        data = response.json()
        # Verify expected fields
        assert "total_clients" in data
        assert "total_devices" in data
        assert "open_tickets" in data
        assert "total_mrr" in data
        assert "active_alerts" in data
        # Verify we have real data (not zeros)
        assert data["total_clients"] >= 1

    def test_dashboard_enhanced_stats(self, headers):
        """Enhanced stats for operational alerts row"""
        response = requests.get(f"{BASE_URL}/api/dashboard/enhanced-stats", headers=headers)
        assert response.status_code == 200
        data = response.json()
        # Check for operational alert fields
        assert "total_collected" in data
        assert "outstanding" in data
        assert "sla_breaches" in data
        assert "pending_purchase_orders" in data
        assert "total_mrr" in data

    def test_tickets_have_sla_due(self, headers):
        """Tickets have sla_due field for SLA countdown widget"""
        response = requests.get(f"{BASE_URL}/api/tickets?status=open", headers=headers)
        assert response.status_code == 200
        tickets = response.json()
        assert len(tickets) > 0, "Should have open tickets"
        # Check at least some tickets have sla_due
        tickets_with_sla = [t for t in tickets if t.get("sla_due")]
        assert len(tickets_with_sla) > 0, "Some tickets should have SLA due dates"

    def test_devices_for_fleet_overview(self, headers):
        """Devices have CPU/RAM/Disk/Status for Device Fleet Overview table"""
        response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        assert response.status_code == 200
        devices = response.json()
        assert len(devices) > 0
        device = devices[0]
        assert "cpu_usage" in device
        assert "memory_usage" in device
        assert "disk_usage" in device
        assert "status" in device
        assert "client_name" in device

    def test_device_stats_summary(self, headers):
        """Device stats summary for fleet breakdown"""
        response = requests.get(f"{BASE_URL}/api/devices/stats/summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "online" in data
        assert "offline" in data
        assert "avg_cpu" in data
        assert "avg_ram" in data

    def test_ticket_trends(self, headers):
        """Ticket trends for area chart"""
        response = requests.get(f"{BASE_URL}/api/dashboard/ticket-trends", headers=headers)
        assert response.status_code == 200
        # Should return array (even if empty)
        assert isinstance(response.json(), list)

    def test_activity_feed(self, headers):
        """Activity feed endpoint works"""
        response = requests.get(f"{BASE_URL}/api/dashboard/activity-feed?limit=20", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)


# ==================== REPORTS TESTS ====================

class TestReportsEnhancements:
    """Reports: 7 tabs, SLA Compliance, Profitability, CSV exports"""

    def test_technician_utilization(self, headers):
        """Technician utilization for Technicians tab"""
        response = requests.get(f"{BASE_URL}/api/reports/technician-utilization", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            tech = data[0]
            assert "name" in tech
            assert "utilization" in tech
            assert "tickets_assigned" in tech

    def test_ticket_analytics_for_sla(self, headers):
        """Ticket analytics provides SLA compliance data"""
        response = requests.get(f"{BASE_URL}/api/reports/ticket-analytics", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "by_status" in data
        assert "by_priority" in data
        assert "sla_compliance" in data

    def test_client_analytics_for_profitability(self, headers):
        """Client analytics provides data for Profitability tab"""
        response = requests.get(f"{BASE_URL}/api/reports/client-analytics", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Should have client data for profitability analysis

    def test_revenue_report(self, headers):
        """Revenue report for Revenue tab"""
        response = requests.get(f"{BASE_URL}/api/reports/revenue", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total_mrr" in data
        assert "total_invoiced" in data
        assert "outstanding" in data

    def test_device_analytics(self, headers):
        """Device analytics for Devices tab"""
        response = requests.get(f"{BASE_URL}/api/reports/device-analytics", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "by_type" in data
        assert "by_os" in data
        assert "by_status" in data


# ==================== TIME TRACKING TESTS ====================

class TestTimeTrackingEnhancements:
    """Time Tracking: Live timer, weekly chart, by-technician/client tabs"""

    def test_time_entries_list(self, headers):
        """List time entries"""
        response = requests.get(f"{BASE_URL}/api/time-entries", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            entry = data[0]
            assert "minutes" in entry
            assert "billable" in entry
            assert "user_name" in entry

    def test_weekly_summary(self, headers):
        """Weekly summary for weekly chart"""
        response = requests.get(f"{BASE_URL}/api/time-entries/weekly-summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "week_start" in data
        assert "total_hours" in data
        assert "billable_hours" in data
        assert "by_user" in data
        assert "by_day" in data

    def test_create_time_entry(self, headers):
        """Create time entry (live timer simulation)"""
        response = requests.post(f"{BASE_URL}/api/time-entries", headers=headers, json={
            "ticket_id": "",
            "user_id": "user-001",
            "description": "TEST_ITER28_Timer session",
            "minutes": 15,
            "billable": True,
            "date": "2026-03-17"
        })
        assert response.status_code in [200, 201]
        data = response.json()
        assert "id" in data


# ==================== KNOWLEDGE BASE TESTS ====================

class TestKnowledgeBaseEnhancements:
    """Knowledge Base: Pinning, public/internal toggle, Hudu sync, related articles"""

    def test_kb_articles_list(self, headers):
        """List KB articles with pin and visibility fields"""
        response = requests.get(f"{BASE_URL}/api/kb-articles", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            article = data[0]
            assert "title" in article
            assert "is_public" in article
            assert "views" in article

    def test_hudu_sync_endpoint(self, headers):
        """Hudu sync endpoint exists and returns response"""
        response = requests.post(f"{BASE_URL}/api/hudu/sync", headers=headers, json={})
        # May fail if Hudu not configured, but endpoint should exist
        assert response.status_code in [200, 400]
        if response.status_code == 200:
            data = response.json()
            assert "imported" in data or "message" in data

    def test_create_kb_article_with_pinning(self, headers):
        """Create KB article with pinning support"""
        response = requests.post(f"{BASE_URL}/api/kb-articles", headers=headers, json={
            "title": "TEST_ITER28_Pinned Article",
            "content": "This is a test article for iteration 28",
            "category": "general",
            "tags": ["test", "pinned"],
            "is_public": True,
            "is_pinned": True
        })
        assert response.status_code in [200, 201]
        data = response.json()
        assert "id" in data


# ==================== DEVICES TESTS ====================

class TestDevicesBulkActions:
    """Devices: Bulk select/actions"""

    def test_devices_list_for_bulk(self, headers):
        """Devices list supports bulk selection"""
        response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        assert response.status_code == 200
        devices = response.json()
        assert len(devices) > 0
        # Each device should have id for bulk selection
        for d in devices:
            assert "id" in d

    def test_single_device_delete_endpoint(self, headers):
        """Device delete endpoint exists (used by bulk delete)"""
        # First create a test device
        response = requests.post(f"{BASE_URL}/api/devices", headers=headers, json={
            "name": "TEST_ITER28_BulkDevice",
            "client_id": "client-001",
            "device_type": "workstation",
            "os": "Windows 11"
        })
        if response.status_code in [200, 201]:
            device_id = response.json()["id"]
            # Delete it
            del_resp = requests.delete(f"{BASE_URL}/api/devices/{device_id}", headers=headers)
            assert del_resp.status_code in [200, 204]


# ==================== SCRIPTING TESTS ====================

class TestScriptingEnhancements:
    """Scripting: CodeBlock component, script library"""

    def test_scripts_list(self, headers):
        """Scripts list endpoint"""
        response = requests.get(f"{BASE_URL}/api/scripts", headers=headers)
        assert response.status_code == 200
        # May return empty list if no scripts created
        assert isinstance(response.json(), list)

    def test_create_script_with_content(self, headers):
        """Create script with code content"""
        response = requests.post(f"{BASE_URL}/api/scripts", headers=headers, json={
            "name": "TEST_ITER28_Script",
            "description": "Test script for iteration 28",
            "script_type": "powershell",
            "content": "Get-Process | Where-Object { $_.CPU -gt 100 }",
            "category": "monitoring",
            "os_target": "windows"
        })
        assert response.status_code in [200, 201]
        data = response.json()
        assert "id" in data
        assert "content" in data


# ==================== COPILOT TESTS ====================

class TestCoPilotCodeBlocks:
    """CoPilot: Code blocks rendered properly"""

    def test_copilot_response_with_code(self, headers):
        """CoPilot returns response (may include code blocks)"""
        response = requests.post(f"{BASE_URL}/api/ai/copilot", headers=headers, json={
            "message": "Give me a PowerShell script to check disk space",
            "session_id": "test-iter28",
            "ticket_context": {
                "title": "Disk space check",
                "description": "Need to monitor disk usage"
            }
        })
        assert response.status_code == 200
        data = response.json()
        assert "response" in data
        assert "session_id" in data
        # Response should contain some content
        assert len(data["response"]) > 0


# ==================== CLEANUP ====================

def test_cleanup_test_data(headers):
    """Cleanup test data created during testing"""
    # Clean up time entries
    entries_resp = requests.get(f"{BASE_URL}/api/time-entries", headers=headers)
    if entries_resp.status_code == 200:
        for entry in entries_resp.json():
            if "TEST_ITER28" in entry.get("description", ""):
                requests.delete(f"{BASE_URL}/api/time-entries/{entry['id']}", headers=headers)
    
    # Clean up KB articles
    kb_resp = requests.get(f"{BASE_URL}/api/kb-articles", headers=headers)
    if kb_resp.status_code == 200:
        for article in kb_resp.json():
            if "TEST_ITER28" in article.get("title", ""):
                requests.delete(f"{BASE_URL}/api/kb-articles/{article['id']}", headers=headers)
    
    # Clean up scripts
    scripts_resp = requests.get(f"{BASE_URL}/api/scripts", headers=headers)
    if scripts_resp.status_code == 200:
        for script in scripts_resp.json():
            if "TEST_ITER28" in script.get("name", ""):
                requests.delete(f"{BASE_URL}/api/scripts/{script['id']}", headers=headers)
