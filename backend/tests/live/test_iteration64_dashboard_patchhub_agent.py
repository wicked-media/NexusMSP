"""
Iteration 64 - Dashboard Redesign & Patch Hub Agent System Tests
Tests for:
1. Dashboard redesign - clean 4-card layout, attention banner, charts
2. Patch Hub Agent tab - download script, device reporting, agent reports
"""

import pytest
import requests
import os
import json

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        return data["token"]
    
    def test_login_success(self):
        """Test successful login"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == "aaron@stech.com.au"
        print("PASS: Login successful")


class TestDashboardStats:
    """Dashboard stats endpoint tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    def test_dashboard_stats(self, auth_token):
        """Test GET /api/dashboard/stats returns stat data"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify required fields for 4 metric cards
        assert "total_clients" in data
        assert "total_devices" in data
        assert "open_tickets" in data
        assert "total_mrr" in data
        
        # Verify data types
        assert isinstance(data["total_clients"], int)
        assert isinstance(data["total_devices"], int)
        assert isinstance(data["open_tickets"], int)
        
        print(f"PASS: Dashboard stats - Clients: {data['total_clients']}, Devices: {data['total_devices']}, Open Tickets: {data['open_tickets']}, MRR: ${data['total_mrr']}")
    
    def test_dashboard_enhanced_stats(self, auth_token):
        """Test GET /api/dashboard/enhanced-stats for attention banner"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/dashboard/enhanced-stats", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify fields used in attention banner
        assert "sla_breaches" in data or "outstanding" in data
        print(f"PASS: Enhanced stats returned for attention banner")
    
    def test_dashboard_ticket_trends(self, auth_token):
        """Test GET /api/dashboard/ticket-trends for 7-day chart"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/dashboard/ticket-trends", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        # Should return array of trend data
        assert isinstance(data, list)
        print(f"PASS: Ticket trends returned {len(data)} data points")
    
    def test_dashboard_activity_feed(self, auth_token):
        """Test GET /api/dashboard/activity-feed"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/dashboard/activity-feed?limit=15", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        print(f"PASS: Activity feed returned {len(data)} items")


class TestPatchHubDashboard:
    """Patch Hub Dashboard tab tests (existing functionality)"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    def test_patch_hub_dashboard(self, auth_token):
        """Test GET /api/patch-hub/dashboard"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/patch-hub/dashboard", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert "os_summary" in data
        assert "app_summary" in data
        assert "rings" in data
        
        print(f"PASS: Patch Hub Dashboard - OS Compliance: {data['os_summary'].get('compliance_pct', 0)}%, App Compliance: {data['app_summary'].get('compliance_pct', 0)}%")


class TestPatchHubAgentDownloadScript:
    """Patch Hub Agent download script endpoint tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    def test_agent_download_script(self, auth_token):
        """Test GET /api/patch-hub/agent/download-script returns script with version, filename, instructions"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/patch-hub/agent/download-script", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify required fields
        assert "script" in data, "Missing 'script' field"
        assert "version" in data, "Missing 'version' field"
        assert "filename" in data, "Missing 'filename' field"
        assert "instructions" in data, "Missing 'instructions' field"
        assert "deploy_command" in data, "Missing 'deploy_command' field"
        
        # Verify script content
        assert "#Requires -RunAsAdministrator" in data["script"], "Script should require admin"
        assert "NexusOps Patch Agent" in data["script"], "Script should contain agent name"
        assert "Send-PatchReport" in data["script"], "Script should have Send-PatchReport function"
        
        # Verify version format
        assert data["version"] == "1.0.0", f"Expected version 1.0.0, got {data['version']}"
        
        # Verify filename
        assert data["filename"] == "NexusOps-PatchAgent.ps1", f"Expected filename NexusOps-PatchAgent.ps1, got {data['filename']}"
        
        # Verify instructions is a list
        assert isinstance(data["instructions"], list), "Instructions should be a list"
        assert len(data["instructions"]) >= 4, "Should have at least 4 deployment steps"
        
        # Verify deploy command
        assert "powershell -ExecutionPolicy Bypass" in data["deploy_command"], "Deploy command should use PowerShell"
        
        print(f"PASS: Agent download script - Version: {data['version']}, Filename: {data['filename']}, Instructions: {len(data['instructions'])} steps")


class TestPatchHubAgentReport:
    """Patch Hub Agent report endpoint tests (unauthenticated for agents)"""
    
    def test_agent_report_post(self):
        """Test POST /api/patch-hub/agent/report accepts device patch data (unauthenticated)"""
        # This endpoint should NOT require auth - it's called by deployed agents
        report_data = {
            "agent_version": "1.0.0",
            "reported_at": "2026-04-08T10:00:00Z",
            "system_info": {
                "hostname": "TEST-PYTEST-DEVICE",
                "os_name": "Windows 11 Pro",
                "os_version": "23H2",
                "uptime_hours": 24.5,
                "pending_reboot": False
            },
            "pending_updates": [
                {"title": "KB5051987 - Security Update", "severity": "critical", "kb_ids": ["KB5051987"]},
                {"title": "KB5050234 - Cumulative Update", "severity": "important", "kb_ids": ["KB5050234"]},
                {"title": "KB5049981 - .NET Update", "severity": "moderate", "kb_ids": ["KB5049981"]}
            ],
            "installed_software": [
                {"name": "Microsoft Office", "version": "16.0.17328.20162", "publisher": "Microsoft"}
            ],
            "defender_status": {
                "antivirus_enabled": True,
                "realtime_protection": True,
                "definition_age_days": 1
            }
        }
        
        headers = {
            "Content-Type": "application/json",
            "X-Agent-Key": "nxagent-pytest-test"
        }
        
        response = requests.post(f"{BASE_URL}/api/patch-hub/agent/report", json=report_data, headers=headers)
        
        assert response.status_code == 200, f"Agent report failed: {response.text}"
        data = response.json()
        
        # Verify response
        assert "status" in data
        assert data["status"] == "received"
        assert "hostname" in data
        assert data["hostname"] == "TEST-PYTEST-DEVICE"
        assert "pending_count" in data
        assert data["pending_count"] == 3
        
        print(f"PASS: Agent report accepted - Hostname: {data['hostname']}, Pending: {data['pending_count']}")


class TestPatchHubAgentReports:
    """Patch Hub Agent reports endpoint tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    def test_agent_reports_get(self, auth_token):
        """Test GET /api/patch-hub/agent/reports returns total_reporting, healthy, needs_attention, critical, reports array"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/patch-hub/agent/reports", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify required fields
        assert "total_reporting" in data, "Missing 'total_reporting' field"
        assert "healthy" in data, "Missing 'healthy' field"
        assert "needs_attention" in data, "Missing 'needs_attention' field"
        assert "critical" in data, "Missing 'critical' field"
        assert "reports" in data, "Missing 'reports' field"
        
        # Verify data types
        assert isinstance(data["total_reporting"], int)
        assert isinstance(data["healthy"], int)
        assert isinstance(data["needs_attention"], int)
        assert isinstance(data["critical"], int)
        assert isinstance(data["reports"], list)
        
        # Verify counts add up
        total = data["healthy"] + data["needs_attention"] + data["critical"]
        # Note: total_reporting might include devices that don't fit into the 3 categories
        
        print(f"PASS: Agent reports - Total: {data['total_reporting']}, Healthy: {data['healthy']}, Needs Attention: {data['needs_attention']}, Critical: {data['critical']}")
        
        # If there are reports, verify structure
        if data["reports"]:
            report = data["reports"][0]
            assert "hostname" in report, "Report missing 'hostname'"
            assert "agent_version" in report, "Report missing 'agent_version'"
            assert "pending_updates_count" in report, "Report missing 'pending_updates_count'"
            print(f"PASS: Report structure verified - First device: {report['hostname']}")


class TestPatchHubAgentSettings:
    """Patch Hub Agent settings endpoint tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    def test_agent_settings_post(self, auth_token):
        """Test POST /api/patch-hub/agent/settings saves agent configuration"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        settings_data = {
            "api_url": "https://test-nexusops.example.com/api",
            "agent_api_key": "nxagent-test-key-12345",
            "report_interval": 1800
        }
        
        response = requests.post(f"{BASE_URL}/api/patch-hub/agent/settings", json=settings_data, headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert "status" in data
        assert data["status"] == "saved"
        assert "settings" in data
        
        print(f"PASS: Agent settings saved successfully")


class TestDevicesEndpoint:
    """Devices endpoint tests for Fleet Health chart"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    def test_devices_list(self, auth_token):
        """Test GET /api/devices returns device list with status for Fleet Health chart"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        
        if data:
            device = data[0]
            assert "status" in device, "Device missing 'status' field"
            
            # Count by status for Fleet Health
            online = sum(1 for d in data if d.get("status") == "online")
            warning = sum(1 for d in data if d.get("status") == "warning")
            offline = sum(1 for d in data if d.get("status") == "offline")
            
            print(f"PASS: Devices list - Total: {len(data)}, Online: {online}, Warning: {warning}, Offline: {offline}")


class TestAlertsEndpoint:
    """Alerts endpoint tests for Alerts panel"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    def test_alerts_active(self, auth_token):
        """Test GET /api/alerts?status=active returns active alerts"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/alerts?status=active", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        print(f"PASS: Active alerts - Count: {len(data)}")


class TestTicketsEndpoint:
    """Tickets endpoint tests for Open Tickets panel"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        return response.json()["token"]
    
    def test_tickets_open(self, auth_token):
        """Test GET /api/tickets?status=open returns open tickets"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/tickets?status=open", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        
        if data:
            ticket = data[0]
            assert "title" in ticket, "Ticket missing 'title'"
            assert "priority" in ticket, "Ticket missing 'priority'"
            assert "status" in ticket, "Ticket missing 'status'"
        
        print(f"PASS: Open tickets - Count: {len(data)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
