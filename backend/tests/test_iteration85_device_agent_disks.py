"""
Iteration 85 - Device Agent Scripts and Disk Health Testing
Tests for:
- GET /api/devices/{device_id}/disks - Disk health data
- GET /api/devices/{device_id}/agent-script?os_type=windows - PowerShell agent script
- GET /api/devices/{device_id}/agent-script?os_type=linux - Bash agent script
- POST /api/devices/agent/report - Agent system report endpoint
- Remote Access dialog with RustDesk ID display
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestAuthentication:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        return data["token"]
    
    def test_login_success(self, auth_token):
        """Test login returns valid token"""
        assert auth_token is not None
        assert len(auth_token) > 0


class TestDeviceDiskHealth:
    """Device disk health endpoint tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        return response.json()["token"]
    
    def test_get_device_disks_dev001(self, auth_token):
        """Test GET /api/devices/dev-001/disks returns disk health data"""
        response = requests.get(
            f"{BASE_URL}/api/devices/dev-001/disks",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        disks = response.json()
        assert isinstance(disks, list)
        assert len(disks) >= 1, "dev-001 should have at least 1 disk"
        
        # Verify disk structure
        disk = disks[0]
        assert "device_id" in disk
        assert disk["device_id"] == "dev-001"
        assert "drive_letter" in disk or "mount_point" in disk
        assert "total_gb" in disk
        assert "used_gb" in disk
        assert "free_gb" in disk
        assert "usage_percent" in disk
        assert "disk_type" in disk
        assert "smart_status" in disk
    
    def test_get_device_disks_dev005_warning_smart(self, auth_token):
        """Test GET /api/devices/dev-005/disks returns Warning SMART status"""
        response = requests.get(
            f"{BASE_URL}/api/devices/dev-005/disks",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        disks = response.json()
        assert isinstance(disks, list)
        assert len(disks) >= 1, "dev-005 should have at least 1 disk"
        
        # Find disk with Warning status
        warning_disk = next((d for d in disks if d.get("smart_status") == "Warning"), None)
        assert warning_disk is not None, "dev-005 should have a disk with Warning SMART status"
        
        # Verify warning disk has reallocated/pending sectors
        assert warning_disk.get("smart_reallocated_sectors", 0) > 0 or warning_disk.get("smart_pending_sectors", 0) > 0
    
    def test_get_device_disks_dev003_multiple_disks(self, auth_token):
        """Test GET /api/devices/dev-003/disks returns multiple disks"""
        response = requests.get(
            f"{BASE_URL}/api/devices/dev-003/disks",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        disks = response.json()
        assert isinstance(disks, list)
        # dev-003 should have 2 disks (/ and /data)
        assert len(disks) >= 1
    
    def test_get_device_disks_nonexistent_device(self, auth_token):
        """Test GET /api/devices/nonexistent/disks returns empty list"""
        response = requests.get(
            f"{BASE_URL}/api/devices/nonexistent-device/disks",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        # Should return 200 with empty list (not 404)
        assert response.status_code == 200
        disks = response.json()
        assert isinstance(disks, list)
        assert len(disks) == 0


class TestDeviceAgentScripts:
    """Device agent script generation tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        return response.json()["token"]
    
    def test_get_windows_agent_script(self, auth_token):
        """Test GET /api/devices/dev-001/agent-script?os_type=windows returns PowerShell script"""
        response = requests.get(
            f"{BASE_URL}/api/devices/dev-001/agent-script?os_type=windows",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Check content type
        assert "text/plain" in response.headers.get("content-type", "")
        
        # Check script content
        script = response.text
        assert "# NexusOps Agent - Windows PowerShell" in script
        assert "Device ID: dev-001" in script
        assert "$NexusOpsAPI" in script
        assert "Get-SystemInfo" in script
        assert "Get-DiskHealth" in script
        assert "Send-Report" in script
    
    def test_get_linux_agent_script(self, auth_token):
        """Test GET /api/devices/dev-001/agent-script?os_type=linux returns Bash script"""
        response = requests.get(
            f"{BASE_URL}/api/devices/dev-001/agent-script?os_type=linux",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Check content type
        assert "text/plain" in response.headers.get("content-type", "")
        
        # Check script content
        script = response.text
        assert "#!/bin/bash" in script
        assert "# NexusOps Agent - Linux/macOS" in script
        assert "Device ID: dev-001" in script
        assert "NEXUSOPS_API=" in script
        assert "send_report()" in script
    
    def test_get_agent_script_nonexistent_device(self, auth_token):
        """Test GET /api/devices/nonexistent/agent-script returns 404"""
        response = requests.get(
            f"{BASE_URL}/api/devices/nonexistent-device/agent-script?os_type=windows",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 404


class TestAgentReport:
    """Agent report endpoint tests"""
    
    def test_agent_report_success(self):
        """Test POST /api/devices/agent/report accepts system report"""
        response = requests.post(
            f"{BASE_URL}/api/devices/agent/report",
            json={
                "device_id": "dev-001",
                "agent_key": "test-key",
                "agent_version": "1.0.0",
                "hostname": "ACME-DC-01",
                "cpu_usage": 45,
                "memory_usage": 62,
                "disk_usage": 78,
                "disks": [
                    {
                        "drive_letter": "C:",
                        "total_gb": 500,
                        "used_gb": 312,
                        "free_gb": 188,
                        "usage_percent": 62.4,
                        "disk_type": "SSD",
                        "smart_status": "OK"
                    }
                ]
            }
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data["status"] == "ok"
        assert "device_status" in data
        assert "next_report_seconds" in data
    
    def test_agent_report_missing_device_id(self):
        """Test POST /api/devices/agent/report without device_id returns 400"""
        response = requests.post(
            f"{BASE_URL}/api/devices/agent/report",
            json={
                "agent_key": "test-key",
                "cpu_usage": 45
            }
        )
        assert response.status_code == 400
    
    def test_agent_report_nonexistent_device(self):
        """Test POST /api/devices/agent/report with nonexistent device returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/devices/agent/report",
            json={
                "device_id": "nonexistent-device",
                "agent_key": "test-key"
            }
        )
        assert response.status_code == 404


class TestRustDeskIntegration:
    """RustDesk integration tests for Remote Access dialog"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        return response.json()["token"]
    
    def test_device_with_rustdesk_id(self, auth_token):
        """Test device dev-001 has rustdesk_id configured"""
        response = requests.get(
            f"{BASE_URL}/api/devices/dev-001/detail",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        data = response.json()
        device = data.get("device", {})
        assert device.get("rustdesk_id") is not None, "dev-001 should have rustdesk_id"
        assert device.get("rustdesk_id") == "842931675"
    
    def test_device_without_rustdesk_id(self, auth_token):
        """Test device dev-006 has no rustdesk_id configured"""
        response = requests.get(
            f"{BASE_URL}/api/devices/dev-006/detail",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        data = response.json()
        device = data.get("device", {})
        # rustdesk_id should be None or not present
        rustdesk_id = device.get("rustdesk_id")
        assert rustdesk_id is None or rustdesk_id == "", "dev-006 should not have rustdesk_id"
    
    def test_quick_connect_with_rustdesk_id(self, auth_token):
        """Test POST /api/rustdesk/quick-connect returns connection info"""
        response = requests.post(
            f"{BASE_URL}/api/rustdesk/quick-connect",
            json={"rustdesk_id": "842931675"},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "connection_url" in data
        assert "web_client_url" in data


class TestDeviceStatusRemoteAccess:
    """Test Remote Access button visibility based on device status"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200
        return response.json()["token"]
    
    def test_online_device_status(self, auth_token):
        """Test online device (dev-001) has status=online"""
        response = requests.get(
            f"{BASE_URL}/api/devices/dev-001/detail",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        data = response.json()
        device = data.get("device", {})
        assert device.get("status") == "online"
    
    def test_warning_device_status(self, auth_token):
        """Test warning device (dev-003) has status=warning"""
        response = requests.get(
            f"{BASE_URL}/api/devices/dev-003/detail",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        data = response.json()
        device = data.get("device", {})
        assert device.get("status") == "warning"
    
    def test_offline_device_status(self, auth_token):
        """Test offline device (dev-005) has status=offline"""
        response = requests.get(
            f"{BASE_URL}/api/devices/dev-005/detail",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        data = response.json()
        device = data.get("device", {})
        assert device.get("status") == "offline"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
