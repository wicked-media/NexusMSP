"""
Test Phase C Features - P0 Refactoring Session
Tests for 9 new backend routers:
1. DNS Monitor - Domain monitoring and alerts
2. Patch Compliance - Patch management and deployment rings  
3. Client Portal - Portal config and access logs
4. Backup Dashboard - Backup jobs overview and per-client data
5. MFA Management - User MFA enrollment tracking
6. Alert Suppression - Alert suppression rules and stats
7. License Management - Software license tracking
8. Maintenance Scheduler - Scheduled maintenance windows
9. Bandwidth Monitor - Network bandwidth monitoring
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
TEST_EMAIL = "admin@nexusops.io"
TEST_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for API calls"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    data = response.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestApiRoot:
    """Test API root to confirm auto-discovery of routers"""
    
    def test_api_root_operational(self, headers):
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "operational"
        assert "NexusOps API" in data["message"]
        print(f"API Root: {data}")


class TestDevicesEndpoint:
    """Verify devices endpoint returns 130+ devices"""
    
    def test_get_devices_count(self, headers):
        response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        assert response.status_code == 200
        devices = response.json()
        assert isinstance(devices, list)
        assert len(devices) >= 130, f"Expected 130+ devices, got {len(devices)}"
        print(f"Total devices: {len(devices)}")


class TestDnsMonitor:
    """DNS Monitor endpoints"""
    
    def test_get_domains(self, headers):
        """GET /api/dns-monitor/domains - returns 7+ domains with records"""
        response = requests.get(f"{BASE_URL}/api/dns-monitor/domains", headers=headers)
        assert response.status_code == 200
        domains = response.json()
        assert isinstance(domains, list)
        assert len(domains) >= 7, f"Expected 7+ domains, got {len(domains)}"
        # Verify domain structure
        first = domains[0]
        assert "domain" in first
        assert "records" in first
        assert "status" in first or "last_checked" in first
        print(f"DNS Domains: {len(domains)} domains, first: {first['domain']}")
    
    def test_get_dns_alerts(self, headers):
        """GET /api/dns-monitor/alerts - returns alerts with severity"""
        response = requests.get(f"{BASE_URL}/api/dns-monitor/alerts", headers=headers)
        assert response.status_code == 200
        alerts = response.json()
        assert isinstance(alerts, list)
        assert len(alerts) >= 1, "Expected at least 1 DNS alert"
        # Verify alert structure
        for alert in alerts[:3]:
            assert "severity" in alert
            assert "domain" in alert
            assert "message" in alert
        print(f"DNS Alerts: {len(alerts)} alerts")
    
    def test_acknowledge_alert(self, headers):
        """POST /api/dns-monitor/alerts/{id}/acknowledge"""
        # Get alerts first
        alerts_response = requests.get(f"{BASE_URL}/api/dns-monitor/alerts", headers=headers)
        alerts = alerts_response.json()
        if alerts:
            alert_id = alerts[0]["id"]
            response = requests.post(f"{BASE_URL}/api/dns-monitor/alerts/{alert_id}/acknowledge", headers=headers)
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "acknowledged"
            print(f"Acknowledged alert: {alert_id}")


class TestPatchCompliance:
    """Patch Compliance endpoints"""
    
    def test_get_overview(self, headers):
        """GET /api/patch-compliance/overview - returns summary with compliance_pct"""
        response = requests.get(f"{BASE_URL}/api/patch-compliance/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "summary" in data
        assert "compliance_pct" in data["summary"]
        assert "devices" in data
        assert isinstance(data["devices"], list)
        print(f"Patch Compliance: {data['summary']['compliance_pct']}% compliant, {len(data['devices'])} devices")
    
    def test_get_rings(self, headers):
        """GET /api/patch-compliance/rings - returns 4 deployment rings"""
        response = requests.get(f"{BASE_URL}/api/patch-compliance/rings", headers=headers)
        assert response.status_code == 200
        rings = response.json()
        assert isinstance(rings, list)
        assert len(rings) == 4, f"Expected 4 rings, got {len(rings)}"
        # Verify ring structure
        for ring in rings:
            assert "name" in ring
            assert "delay_days" in ring
            assert "device_count" in ring
        print(f"Patch Rings: {[r['name'] for r in rings]}")


class TestClientPortal:
    """Client Portal endpoints"""
    
    def test_get_config(self, headers):
        """GET /api/client-portal/config - returns portal configuration"""
        response = requests.get(f"{BASE_URL}/api/client-portal/config", headers=headers)
        assert response.status_code == 200
        config = response.json()
        assert "enabled" in config
        assert "allow_ticket_creation" in config
        assert "branding" in config
        print(f"Portal Config: enabled={config['enabled']}, features={config.get('features', {})}")
    
    def test_get_access_logs(self, headers):
        """GET /api/client-portal/access-logs - returns access logs"""
        response = requests.get(f"{BASE_URL}/api/client-portal/access-logs", headers=headers)
        assert response.status_code == 200
        logs = response.json()
        assert isinstance(logs, list)
        assert len(logs) >= 1, "Expected at least 1 access log"
        # Verify log structure
        for log in logs[:3]:
            assert "client_name" in log
            assert "action" in log
            assert "timestamp" in log
        print(f"Portal Access Logs: {len(logs)} entries")


class TestBackupDashboard:
    """Backup Dashboard endpoints"""
    
    def test_get_overview(self, headers):
        """GET /api/backup-dashboard/overview - returns summary with success_rate and jobs"""
        response = requests.get(f"{BASE_URL}/api/backup-dashboard/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "summary" in data
        assert "success_rate" in data["summary"]
        assert "jobs" in data
        assert isinstance(data["jobs"], list)
        print(f"Backup Overview: {data['summary']['success_rate']}% success rate, {len(data['jobs'])} jobs")
    
    def test_get_by_client(self, headers):
        """GET /api/backup-dashboard/clients - returns per-client backup data"""
        response = requests.get(f"{BASE_URL}/api/backup-dashboard/clients", headers=headers)
        assert response.status_code == 200
        clients = response.json()
        assert isinstance(clients, list)
        assert len(clients) >= 1, "Expected at least 1 client with backup data"
        # Verify client structure
        for client in clients[:3]:
            assert "client_name" in client
            assert "success_rate" in client
            assert "total" in client
        print(f"Backup by Client: {len(clients)} clients")


class TestMfaManagement:
    """MFA Management endpoints"""
    
    def test_get_overview(self, headers):
        """GET /api/mfa-management/overview - returns user MFA enrollment data"""
        response = requests.get(f"{BASE_URL}/api/mfa-management/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "summary" in data
        assert "enrollment_pct" in data["summary"]
        assert "users" in data
        assert isinstance(data["users"], list)
        print(f"MFA Overview: {data['summary']['enrollment_pct']}% enrolled, {len(data['users'])} users")
    
    def test_get_by_client(self, headers):
        """GET /api/mfa-management/by-client - returns per-client enrollment stats"""
        response = requests.get(f"{BASE_URL}/api/mfa-management/by-client", headers=headers)
        assert response.status_code == 200
        clients = response.json()
        assert isinstance(clients, list)
        assert len(clients) >= 1, "Expected at least 1 client with MFA data"
        # Verify client structure
        for client in clients[:3]:
            assert "client_name" in client
            assert "enrollment_pct" in client
            assert "total_users" in client
        print(f"MFA by Client: {len(clients)} clients")


class TestAlertSuppression:
    """Alert Suppression endpoints"""
    
    def test_get_rules(self, headers):
        """GET /api/alert-suppression/rules - returns 6+ rules"""
        response = requests.get(f"{BASE_URL}/api/alert-suppression/rules", headers=headers)
        assert response.status_code == 200
        rules = response.json()
        assert isinstance(rules, list)
        assert len(rules) >= 6, f"Expected 6+ rules, got {len(rules)}"
        # Verify rule structure
        for rule in rules[:3]:
            assert "name" in rule
            assert "enabled" in rule
            assert "suppressed_count" in rule
        print(f"Alert Suppression Rules: {len(rules)} rules")
    
    def test_get_stats(self, headers):
        """GET /api/alert-suppression/stats - returns total_suppressed count"""
        response = requests.get(f"{BASE_URL}/api/alert-suppression/stats", headers=headers)
        assert response.status_code == 200
        stats = response.json()
        assert "total_suppressed" in stats
        assert "total_rules" in stats
        assert "active_rules" in stats
        print(f"Alert Suppression Stats: {stats['total_suppressed']} suppressed, {stats['active_rules']} active rules")


class TestLicenseManagement:
    """License Management endpoints"""
    
    def test_get_overview(self, headers):
        """GET /api/license-management/overview - returns licenses with utilization data"""
        response = requests.get(f"{BASE_URL}/api/license-management/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "summary" in data
        assert "utilization_pct" in data["summary"]
        assert "licenses" in data
        assert isinstance(data["licenses"], list)
        print(f"License Overview: {data['summary']['utilization_pct']}% utilized, {len(data['licenses'])} licenses")


class TestMaintenanceScheduler:
    """Maintenance Scheduler endpoints"""
    
    def test_get_schedules(self, headers):
        """GET /api/maintenance-scheduler/schedules - returns 5+ schedules"""
        response = requests.get(f"{BASE_URL}/api/maintenance-scheduler/schedules", headers=headers)
        assert response.status_code == 200
        schedules = response.json()
        assert isinstance(schedules, list)
        assert len(schedules) >= 5, f"Expected 5+ schedules, got {len(schedules)}"
        # Verify schedule structure
        for sched in schedules[:3]:
            assert "name" in sched
            assert "recurrence" in sched
            assert "client_name" in sched
        print(f"Maintenance Schedules: {len(schedules)} schedules")
    
    def test_get_history(self, headers):
        """GET /api/maintenance-scheduler/history - returns execution history"""
        response = requests.get(f"{BASE_URL}/api/maintenance-scheduler/history", headers=headers)
        assert response.status_code == 200
        history = response.json()
        assert isinstance(history, list)
        assert len(history) >= 1, "Expected at least 1 history entry"
        # Verify history structure
        for h in history[:3]:
            assert "name" in h
            assert "status" in h
            assert "executed_at" in h
        print(f"Maintenance History: {len(history)} entries")


class TestBandwidthMonitor:
    """Bandwidth Monitor endpoints"""
    
    def test_get_overview(self, headers):
        """GET /api/bandwidth-monitor/overview - returns sites and bandwidth_data"""
        response = requests.get(f"{BASE_URL}/api/bandwidth-monitor/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "sites" in data or "bandwidth_data" in data
        if "bandwidth_data" in data:
            assert isinstance(data["bandwidth_data"], list)
            print(f"Bandwidth Overview: {len(data['bandwidth_data'])} data points")
    
    def test_get_alerts(self, headers):
        """GET /api/bandwidth-monitor/alerts - returns bandwidth alerts"""
        response = requests.get(f"{BASE_URL}/api/bandwidth-monitor/alerts", headers=headers)
        assert response.status_code == 200
        alerts = response.json()
        assert isinstance(alerts, list)
        assert len(alerts) >= 1, "Expected at least 1 bandwidth alert"
        # Verify alert structure
        for alert in alerts[:3]:
            assert "severity" in alert
            assert "message" in alert
            assert "site_name" in alert
        print(f"Bandwidth Alerts: {len(alerts)} alerts")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
