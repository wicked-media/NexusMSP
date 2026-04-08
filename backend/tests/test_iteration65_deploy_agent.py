"""
Iteration 65 - Patch Agent Deployment via RustDesk Tests
Tests for the new deploy-agent endpoints in the Remote Devices module:
- POST /api/rustdesk/devices/{device_id}/deploy-agent - Queue deployment
- POST /api/rustdesk/deploy-agent/bulk - Bulk deploy
- POST /api/rustdesk/devices/{device_id}/deploy-agent/complete - Mark deployed
- GET /api/rustdesk/agent-deployments - Get deployment stats
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestDeployAgentEndpoints:
    """Tests for Patch Agent deployment via RustDesk"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - get auth token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        self.token = response.json()["token"]
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    def test_01_get_all_devices(self):
        """Test GET /api/rustdesk/all-devices returns devices list"""
        response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list of devices"
        assert len(data) > 0, "Expected at least one device"
        # Store a device ID for later tests
        self.device_id = data[0]["id"]
        print(f"Found {len(data)} devices, using device: {self.device_id}")
    
    def test_02_deploy_agent_to_device(self):
        """Test POST /api/rustdesk/devices/{device_id}/deploy-agent queues deployment"""
        # First get a device
        devices_response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        devices = devices_response.json()
        device_id = devices[0]["id"]
        
        response = self.session.post(f"{BASE_URL}/api/rustdesk/devices/{device_id}/deploy-agent")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "message" in data, "Expected 'message' in response"
        assert "deployment" in data, "Expected 'deployment' in response"
        assert data["message"] == "Agent deployment queued", f"Unexpected message: {data['message']}"
        
        deployment = data["deployment"]
        assert deployment["device_id"] == device_id, "Device ID mismatch"
        assert deployment["status"] == "pending", f"Expected status 'pending', got: {deployment['status']}"
        assert "deploy_command" in deployment, "Expected deploy_command in deployment"
        assert "powershell" in deployment["deploy_command"].lower(), "Deploy command should contain powershell"
        assert deployment["queued_by"] != "", "Expected queued_by to be set"
        assert deployment["queued_at"] is not None, "Expected queued_at timestamp"
        
        print(f"Deployment queued: {deployment['id']} for device {device_id}")
        print(f"Deploy command: {deployment['deploy_command'][:100]}...")
    
    def test_03_get_agent_deployments(self):
        """Test GET /api/rustdesk/agent-deployments returns deployment stats"""
        response = self.session.get(f"{BASE_URL}/api/rustdesk/agent-deployments")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "total" in data, "Expected 'total' in response"
        assert "pending" in data, "Expected 'pending' in response"
        assert "deployed" in data, "Expected 'deployed' in response"
        assert "failed" in data, "Expected 'failed' in response"
        assert "deployments" in data, "Expected 'deployments' array in response"
        
        assert isinstance(data["total"], int), "total should be int"
        assert isinstance(data["pending"], int), "pending should be int"
        assert isinstance(data["deployed"], int), "deployed should be int"
        assert isinstance(data["failed"], int), "failed should be int"
        assert isinstance(data["deployments"], list), "deployments should be list"
        
        # Verify counts add up
        assert data["total"] == len(data["deployments"]), "Total should match deployments count"
        
        print(f"Deployments: total={data['total']}, pending={data['pending']}, deployed={data['deployed']}, failed={data['failed']}")
    
    def test_04_bulk_deploy_agent(self):
        """Test POST /api/rustdesk/deploy-agent/bulk accepts device_ids array"""
        # Get multiple devices
        devices_response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        devices = devices_response.json()
        
        # Select 2-3 devices for bulk deploy
        device_ids = [d["id"] for d in devices[:3]]
        
        response = self.session.post(f"{BASE_URL}/api/rustdesk/deploy-agent/bulk", json={
            "device_ids": device_ids
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "message" in data, "Expected 'message' in response"
        assert "queued_count" in data, "Expected 'queued_count' in response"
        assert data["queued_count"] == len(device_ids), f"Expected {len(device_ids)} queued, got {data['queued_count']}"
        
        print(f"Bulk deploy: {data['message']}")
    
    def test_05_bulk_deploy_empty_array(self):
        """Test POST /api/rustdesk/deploy-agent/bulk with empty array returns 400"""
        response = self.session.post(f"{BASE_URL}/api/rustdesk/deploy-agent/bulk", json={
            "device_ids": []
        })
        assert response.status_code == 400, f"Expected 400 for empty array, got: {response.status_code}"
        data = response.json()
        assert "detail" in data, "Expected error detail"
        print(f"Empty array error: {data['detail']}")
    
    def test_06_mark_deployment_complete(self):
        """Test POST /api/rustdesk/devices/{device_id}/deploy-agent/complete marks deployed"""
        # First get a device with pending deployment
        deployments_response = self.session.get(f"{BASE_URL}/api/rustdesk/agent-deployments")
        deployments = deployments_response.json()
        
        # Find a pending deployment
        pending = [d for d in deployments["deployments"] if d["status"] == "pending"]
        if not pending:
            # Create one first
            devices_response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
            devices = devices_response.json()
            device_id = devices[0]["id"]
            self.session.post(f"{BASE_URL}/api/rustdesk/devices/{device_id}/deploy-agent")
            pending_device_id = device_id
        else:
            pending_device_id = pending[0]["device_id"]
        
        # Mark as complete
        response = self.session.post(f"{BASE_URL}/api/rustdesk/devices/{pending_device_id}/deploy-agent/complete")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "message" in data, "Expected 'message' in response"
        assert data["message"] == "Agent deployment marked complete", f"Unexpected message: {data['message']}"
        
        # Verify the deployment is now marked as deployed
        deployments_response = self.session.get(f"{BASE_URL}/api/rustdesk/agent-deployments")
        deployments = deployments_response.json()
        device_deployment = next((d for d in deployments["deployments"] if d["device_id"] == pending_device_id), None)
        
        assert device_deployment is not None, "Deployment not found after marking complete"
        assert device_deployment["status"] == "deployed", f"Expected status 'deployed', got: {device_deployment['status']}"
        assert device_deployment["deployed_at"] is not None, "Expected deployed_at timestamp"
        
        print(f"Deployment marked complete for device {pending_device_id}")
    
    def test_07_deploy_agent_invalid_device(self):
        """Test POST /api/rustdesk/devices/{device_id}/deploy-agent with invalid device returns 404"""
        response = self.session.post(f"{BASE_URL}/api/rustdesk/devices/invalid-device-id-xyz/deploy-agent")
        assert response.status_code == 404, f"Expected 404 for invalid device, got: {response.status_code}"
        data = response.json()
        assert "detail" in data, "Expected error detail"
        print(f"Invalid device error: {data['detail']}")
    
    def test_08_deployment_has_correct_fields(self):
        """Test that deployment records have all required fields"""
        response = self.session.get(f"{BASE_URL}/api/rustdesk/agent-deployments")
        assert response.status_code == 200
        data = response.json()
        
        if data["deployments"]:
            deployment = data["deployments"][0]
            required_fields = ["id", "device_id", "device_name", "status", "deploy_command", "queued_by", "queued_at"]
            for field in required_fields:
                assert field in deployment, f"Missing required field: {field}"
            
            print(f"Deployment fields verified: {list(deployment.keys())}")
    
    def test_09_existing_rustdesk_functionality(self):
        """Test that existing RustDesk functionality still works"""
        # Test config endpoint
        config_response = self.session.get(f"{BASE_URL}/api/rustdesk/config")
        assert config_response.status_code == 200, "Config endpoint failed"
        
        # Test sessions endpoint
        sessions_response = self.session.get(f"{BASE_URL}/api/rustdesk/sessions")
        assert sessions_response.status_code == 200, "Sessions endpoint failed"
        
        # Test all-devices endpoint
        devices_response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        assert devices_response.status_code == 200, "All-devices endpoint failed"
        
        print("Existing RustDesk functionality verified")
    
    def test_10_quick_connect_still_works(self):
        """Test that quick connect endpoint still works"""
        response = self.session.post(f"{BASE_URL}/api/rustdesk/quick-connect", json={
            "rustdesk_id": "123456789"
        })
        assert response.status_code == 200, f"Quick connect failed: {response.text}"
        data = response.json()
        assert "connection_url" in data, "Expected connection_url in response"
        assert data["rustdesk_id"] == "123456789", "RustDesk ID mismatch"
        print("Quick connect verified")


class TestDeploymentDataIntegrity:
    """Tests for deployment data integrity and edge cases"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - get auth token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "admin123"
        })
        assert response.status_code == 200
        self.token = response.json()["token"]
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
    
    def test_11_redeploy_same_device(self):
        """Test that redeploying to same device updates existing deployment"""
        # Get a device
        devices_response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        devices = devices_response.json()
        device_id = devices[0]["id"]
        
        # Deploy first time
        response1 = self.session.post(f"{BASE_URL}/api/rustdesk/devices/{device_id}/deploy-agent")
        assert response1.status_code == 200
        
        # Deploy second time (should update, not create duplicate)
        response2 = self.session.post(f"{BASE_URL}/api/rustdesk/devices/{device_id}/deploy-agent")
        assert response2.status_code == 200
        
        # Check there's only one deployment for this device
        deployments_response = self.session.get(f"{BASE_URL}/api/rustdesk/agent-deployments")
        deployments = deployments_response.json()
        device_deployments = [d for d in deployments["deployments"] if d["device_id"] == device_id]
        
        assert len(device_deployments) == 1, f"Expected 1 deployment for device, got {len(device_deployments)}"
        print(f"Redeploy test passed - only 1 deployment exists for device {device_id}")
    
    def test_12_deployment_command_format(self):
        """Test that deployment command has correct PowerShell format"""
        devices_response = self.session.get(f"{BASE_URL}/api/rustdesk/all-devices")
        devices = devices_response.json()
        device_id = devices[0]["id"]
        
        response = self.session.post(f"{BASE_URL}/api/rustdesk/devices/{device_id}/deploy-agent")
        assert response.status_code == 200
        
        deployment = response.json()["deployment"]
        cmd = deployment["deploy_command"]
        
        # Verify PowerShell command structure
        assert "powershell" in cmd.lower(), "Command should use PowerShell"
        assert "-ExecutionPolicy Bypass" in cmd, "Command should bypass execution policy"
        assert "Invoke-WebRequest" in cmd, "Command should use Invoke-WebRequest"
        assert ".ps1" in cmd, "Command should reference .ps1 script"
        
        print(f"Deploy command format verified: {cmd[:80]}...")
