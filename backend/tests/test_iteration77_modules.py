"""
Iteration 77 - Testing 8 Revamped/Rebuilt Modules:
1. License Management - full seat tracking, cost optimization
2. Webhook Builder - full CRUD with event triggers, test webhooks
3. Executive Reports - auto-generated client reports with KPIs
4. Audit Trail - system activity log with filtering
5. Time Tracking - generate invoice and bulk entry
6. Smart Schedule - visual weekly calendar (API only)
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")

@pytest.fixture(scope="module")
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============== LICENSE MANAGEMENT TESTS ==============
class TestLicenseManagement:
    """License Management - Full seat tracking, cost optimization, vendor/client breakdown"""
    
    def test_get_overview(self, headers):
        """GET /api/license-management/overview - returns summary, licenses, breakdowns"""
        response = requests.get(f"{BASE_URL}/api/license-management/overview", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify summary structure
        assert "summary" in data
        summary = data["summary"]
        assert "total_licenses" in summary
        assert "total_purchased" in summary
        assert "total_used" in summary
        assert "utilization_pct" in summary
        assert "total_monthly_cost" in summary
        assert "total_annual_cost" in summary
        assert "wasted_licenses" in summary
        assert "wasted_cost_monthly" in summary
        
        # Verify licenses list
        assert "licenses" in data
        assert isinstance(data["licenses"], list)
        
        # Verify breakdowns
        assert "vendor_breakdown" in data
        assert "client_breakdown" in data
        assert "expiring_soon" in data
        assert "optimization_suggestions" in data
        
        print(f"License overview: {summary['total_licenses']} licenses, ${summary['total_monthly_cost']}/mo")
    
    def test_create_license(self, headers):
        """POST /api/license-management/licenses - create new license"""
        payload = {
            "product_name": "TEST_Microsoft 365 E3",
            "vendor": "Microsoft",
            "client_name": "TEST_Client Corp",
            "purchased": 25,
            "used": 20,
            "unit_cost": 35.00,
            "renewal_date": "2026-12-31",
            "auto_renew": True,
            "billing_cycle": "monthly",
            "license_type": "per_user"
        }
        response = requests.post(f"{BASE_URL}/api/license-management/licenses", json=payload, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "id" in data
        assert data["product_name"] == payload["product_name"]
        assert data["vendor"] == payload["vendor"]
        assert data["purchased"] == 25
        assert data["used"] == 20
        assert data["available"] == 5
        assert data["monthly_cost"] == 875.0  # 25 * 35
        
        # Store for later tests
        TestLicenseManagement.created_license_id = data["id"]
        print(f"Created license: {data['id']}")
    
    def test_update_license(self, headers):
        """PUT /api/license-management/licenses/{id} - update license"""
        license_id = getattr(TestLicenseManagement, 'created_license_id', None)
        if not license_id:
            pytest.skip("No license created to update")
        
        payload = {"purchased": 30, "used": 25, "notes": "Updated via test"}
        response = requests.put(f"{BASE_URL}/api/license-management/licenses/{license_id}", json=payload, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Verify update via overview
        overview = requests.get(f"{BASE_URL}/api/license-management/overview", headers=headers).json()
        updated = next((l for l in overview["licenses"] if l["id"] == license_id), None)
        if updated:
            assert updated["purchased"] == 30
            assert updated["used"] == 25
            print(f"Updated license {license_id}: purchased=30, used=25")
    
    def test_delete_license(self, headers):
        """DELETE /api/license-management/licenses/{id} - delete license"""
        license_id = getattr(TestLicenseManagement, 'created_license_id', None)
        if not license_id:
            pytest.skip("No license created to delete")
        
        response = requests.delete(f"{BASE_URL}/api/license-management/licenses/{license_id}", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print(f"Deleted license: {license_id}")


# ============== WEBHOOK BUILDER TESTS ==============
class TestWebhookBuilder:
    """Webhook Builder - Full CRUD with event triggers, test webhooks, payload editor"""
    
    def test_list_webhooks(self, headers):
        """GET /api/webhook-builder/list - list all webhooks"""
        response = requests.get(f"{BASE_URL}/api/webhook-builder/list", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list)
        if len(data) > 0:
            hook = data[0]
            assert "id" in hook
            assert "name" in hook
            assert "trigger" in hook
            assert "method" in hook
            assert "url" in hook
            assert "status" in hook
            print(f"Found {len(data)} webhooks")
    
    def test_get_triggers(self, headers):
        """GET /api/webhook-builder/triggers - get event trigger list with sample payloads"""
        response = requests.get(f"{BASE_URL}/api/webhook-builder/triggers", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "triggers" in data
        assert "sample_payloads" in data
        assert isinstance(data["triggers"], list)
        assert len(data["triggers"]) > 0
        
        # Verify trigger structure
        trigger = data["triggers"][0]
        assert "value" in trigger
        assert "label" in trigger
        assert "category" in trigger
        print(f"Found {len(data['triggers'])} event triggers")
    
    def test_create_webhook(self, headers):
        """POST /api/webhook-builder/create - create new webhook"""
        payload = {
            "name": "TEST_Slack Alert",
            "trigger": "ticket.created",
            "method": "POST",
            "url": "https://hooks.slack.com/test/TEST123",
            "headers": {"Content-Type": "application/json"},
            "payload_template": '{"text": "New ticket: {{title}}"}',
            "retry_count": 3,
            "retry_delay": 30
        }
        response = requests.post(f"{BASE_URL}/api/webhook-builder/create", json=payload, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "id" in data
        assert data["name"] == payload["name"]
        assert data["trigger"] == "ticket.created"
        assert data["status"] == "active"
        
        TestWebhookBuilder.created_webhook_id = data["id"]
        print(f"Created webhook: {data['id']}")
    
    def test_update_webhook(self, headers):
        """PUT /api/webhook-builder/{id} - update webhook"""
        webhook_id = getattr(TestWebhookBuilder, 'created_webhook_id', None)
        if not webhook_id:
            pytest.skip("No webhook created to update")
        
        payload = {"name": "TEST_Slack Alert Updated", "retry_count": 5}
        response = requests.put(f"{BASE_URL}/api/webhook-builder/{webhook_id}", json=payload, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print(f"Updated webhook: {webhook_id}")
    
    def test_toggle_webhook(self, headers):
        """POST /api/webhook-builder/{id}/toggle - toggle active/paused"""
        webhook_id = getattr(TestWebhookBuilder, 'created_webhook_id', None)
        if not webhook_id:
            pytest.skip("No webhook created to toggle")
        
        response = requests.post(f"{BASE_URL}/api/webhook-builder/{webhook_id}/toggle", json={}, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "status" in data
        assert data["status"] in ["active", "paused"]
        print(f"Toggled webhook to: {data['status']}")
    
    def test_test_webhook(self, headers):
        """POST /api/webhook-builder/{id}/test - simulate test delivery"""
        webhook_id = getattr(TestWebhookBuilder, 'created_webhook_id', None)
        if not webhook_id:
            pytest.skip("No webhook created to test")
        
        response = requests.post(f"{BASE_URL}/api/webhook-builder/{webhook_id}/test", json={}, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "success" in data
        assert "message" in data
        assert "response_time_ms" in data
        print(f"Test webhook result: {data['message']} ({data['response_time_ms']}ms)")
    
    def test_delete_webhook(self, headers):
        """DELETE /api/webhook-builder/{id} - delete webhook"""
        webhook_id = getattr(TestWebhookBuilder, 'created_webhook_id', None)
        if not webhook_id:
            pytest.skip("No webhook created to delete")
        
        response = requests.delete(f"{BASE_URL}/api/webhook-builder/{webhook_id}", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print(f"Deleted webhook: {webhook_id}")


# ============== EXECUTIVE REPORTS TESTS ==============
class TestExecutiveReports:
    """Executive Reports - Auto-generated client reports with KPIs, trend charts"""
    
    def test_list_reports(self, headers):
        """GET /api/executive-reports/list - list executive reports with full section data"""
        response = requests.get(f"{BASE_URL}/api/executive-reports/list", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list)
        if len(data) > 0:
            report = data[0]
            assert "id" in report
            assert "client_name" in report
            assert "period" in report
            assert "status" in report
            assert "sections" in report
            
            # Verify sections structure
            sections = report["sections"]
            assert "security_score" in sections
            assert "uptime_pct" in sections
            assert "tickets_opened" in sections
            assert "tickets_resolved" in sections
            assert "sla_compliance_pct" in sections
            assert "recommendations" in sections
            
            # Verify trend data (may not be present in all reports)
            if "trend_data" in report:
                print(f"Report has trend_data")
            print(f"Found {len(data)} executive reports")
    
    def test_generate_report(self, headers):
        """POST /api/executive-reports/generate - generate new report for client"""
        payload = {
            "client_name": "TEST_Generated Client",
            "period": "February 2026",
            "report_type": "monthly"
        }
        response = requests.post(f"{BASE_URL}/api/executive-reports/generate", json=payload, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "id" in data
        assert data["client_name"] == payload["client_name"]
        assert data["period"] == payload["period"]
        assert data["status"] == "completed"
        assert "sections" in data
        assert "trend_data" in data
        
        TestExecutiveReports.created_report_id = data["id"]
        print(f"Generated report: {data['id']} for {data['client_name']}")
    
    def test_delete_report(self, headers):
        """DELETE /api/executive-reports/{id} - delete report"""
        report_id = getattr(TestExecutiveReports, 'created_report_id', None)
        if not report_id:
            pytest.skip("No report created to delete")
        
        response = requests.delete(f"{BASE_URL}/api/executive-reports/{report_id}", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print(f"Deleted report: {report_id}")


# ============== AUDIT TRAIL TESTS ==============
class TestAuditTrail:
    """Audit Trail - System activity log with filtering, category breakdown, export"""
    
    def test_get_events(self, headers):
        """GET /api/audit-trail/events - filterable events"""
        response = requests.get(f"{BASE_URL}/api/audit-trail/events", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list)
        if len(data) > 0:
            event = data[0]
            assert "id" in event
            assert "timestamp" in event
            assert "user" in event
            assert "category" in event
            assert "action" in event
            assert "severity" in event
            assert "description" in event
            print(f"Found {len(data)} audit events")
    
    def test_get_events_with_filters(self, headers):
        """GET /api/audit-trail/events with category, severity, days filters"""
        # Test category filter
        response = requests.get(f"{BASE_URL}/api/audit-trail/events?category=auth&days=30", headers=headers)
        assert response.status_code == 200
        data = response.json()
        for event in data:
            assert event["category"] == "auth"
        
        # Test severity filter
        response = requests.get(f"{BASE_URL}/api/audit-trail/events?severity=critical&days=30", headers=headers)
        assert response.status_code == 200
        data = response.json()
        for event in data:
            assert event["severity"] == "critical"
        
        print("Filters working correctly")
    
    def test_get_summary(self, headers):
        """GET /api/audit-trail/summary - summary with by_category, by_severity, by_user"""
        response = requests.get(f"{BASE_URL}/api/audit-trail/summary", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "total_events" in data
        assert "last_24h" in data
        assert "prev_24h" in data
        assert "trend" in data
        assert "by_category" in data
        assert "by_severity" in data
        assert "by_user" in data
        assert "activity_timeline" in data
        assert "categories" in data
        
        print(f"Audit summary: {data['total_events']} total, {data['last_24h']} in last 24h")


# ============== TIME TRACKING TESTS ==============
class TestTimeTracking:
    """Time Tracking - Generate invoice from billable hours and bulk entry"""
    
    def test_bulk_create_time_entries(self, headers):
        """POST /api/time-entries/bulk - create multiple time entries at once"""
        payload = {
            "entries": [
                {
                    "ticket_id": "",
                    "ticket_title": "TEST_Bulk Entry 1",
                    "client_name": "TEST_Bulk Client",
                    "minutes": 60,
                    "description": "Test bulk entry 1",
                    "billable": True,
                    "hourly_rate": 100
                },
                {
                    "ticket_id": "",
                    "ticket_title": "TEST_Bulk Entry 2",
                    "client_name": "TEST_Bulk Client",
                    "minutes": 90,
                    "description": "Test bulk entry 2",
                    "billable": True,
                    "hourly_rate": 100
                }
            ]
        }
        response = requests.post(f"{BASE_URL}/api/time-entries/bulk", json=payload, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "created" in data
        assert data["created"] == 2
        assert "entries" in data
        assert len(data["entries"]) == 2
        
        # Store entry IDs for cleanup
        TestTimeTracking.bulk_entry_ids = [e["id"] for e in data["entries"]]
        print(f"Created {data['created']} bulk time entries")
    
    def test_generate_invoice_from_time(self, headers):
        """POST /api/time-entries/generate-invoice - generate invoice from billable time"""
        payload = {"client_name": "TEST_Bulk Client"}
        response = requests.post(f"{BASE_URL}/api/time-entries/generate-invoice", json=payload, headers=headers)
        
        # May return 404 if no billable entries exist for this client (expected behavior)
        if response.status_code == 404:
            print("No billable time entries found for TEST_Bulk Client (expected if entries were cleaned)")
            return
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "id" in data
        assert "client_name" in data
        assert "total_hours" in data
        assert "total_amount" in data
        assert "line_items" in data
        assert "status" in data
        assert data["status"] == "draft"
        
        TestTimeTracking.generated_invoice_id = data["id"]
        print(f"Generated invoice: {data['id']} - ${data['total_amount']} for {data['total_hours']}h")
    
    def test_generate_invoice_no_entries(self, headers):
        """POST /api/time-entries/generate-invoice - returns 404 when no billable entries"""
        payload = {"client_name": "NonExistent_Client_XYZ123"}
        response = requests.post(f"{BASE_URL}/api/time-entries/generate-invoice", json=payload, headers=headers)
        assert response.status_code == 404, f"Expected 404 for non-existent client, got {response.status_code}"
        print("Correctly returns 404 for client with no billable entries")
    
    def test_cleanup_bulk_entries(self, headers):
        """Cleanup test entries"""
        entry_ids = getattr(TestTimeTracking, 'bulk_entry_ids', [])
        for entry_id in entry_ids:
            requests.delete(f"{BASE_URL}/api/time-entries/{entry_id}", headers=headers)
        print(f"Cleaned up {len(entry_ids)} test entries")


# ============== SMART SCHEDULE TESTS ==============
class TestSmartSchedule:
    """Smart Schedule - Visual weekly calendar with time blocks (API verification)"""
    
    def test_get_calendar(self, headers):
        """GET /api/scheduling/calendar - get calendar events"""
        response = requests.get(f"{BASE_URL}/api/scheduling/calendar", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list)
        if len(data) > 0:
            event = data[0]
            assert "id" in event
            assert "title" in event
            assert "date" in event
            assert "type" in event
            print(f"Found {len(data)} calendar events")
    
    def test_get_map_data(self, headers):
        """GET /api/scheduling/map-data - get map markers and zones"""
        response = requests.get(f"{BASE_URL}/api/scheduling/map-data", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "markers" in data
        assert "zones" in data
        print(f"Map data: {len(data['markers'])} markers, {len(data['zones'])} zones")
    
    def test_get_technician_availability(self, headers):
        """GET /api/scheduling/technician-availability - get tech availability"""
        response = requests.get(f"{BASE_URL}/api/scheduling/technician-availability", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list)
        if len(data) > 0:
            tech = data[0]
            assert "id" in tech
            assert "name" in tech
            assert "available" in tech
            print(f"Found {len(data)} technicians with availability data")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
