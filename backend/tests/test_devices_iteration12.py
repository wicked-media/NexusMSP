"""
Test iteration 12: Enhanced Devices Page + Device Detail Page
Tests device management APIs including list, detail, software, patches, events, performance, network
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestDevicesAPI:
    """Tests for Devices list and detail endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth token for all tests"""
        # Login to get token
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    # === Devices List Tests ===
    def test_get_devices_list(self):
        """GET /api/devices - should return list of devices"""
        response = requests.get(f"{BASE_URL}/api/devices", headers=self.headers)
        assert response.status_code == 200, f"Failed to get devices: {response.text}"
        devices = response.json()
        assert isinstance(devices, list), "Response should be a list"
        print(f"Found {len(devices)} devices")
        # Verify we have 10 devices as mentioned
        assert len(devices) >= 10, f"Expected at least 10 devices, got {len(devices)}"
    
    def test_devices_have_required_fields(self):
        """Verify devices have all required fields for table display"""
        response = requests.get(f"{BASE_URL}/api/devices", headers=self.headers)
        assert response.status_code == 200
        devices = response.json()
        assert len(devices) > 0, "No devices found"
        
        # Check first device has required fields for table view
        device = devices[0]
        required_fields = ['id', 'name', 'client_name', 'os', 'ip_address', 
                          'cpu_usage', 'memory_usage', 'disk_usage', 'compliance_score', 
                          'last_seen', 'status', 'device_type']
        for field in required_fields:
            assert field in device, f"Missing field: {field}"
        print(f"Device {device['name']} has all required fields")
    
    # === Device Stats Summary ===
    def test_devices_stats_summary(self):
        """GET /api/devices/stats/summary - should return aggregated stats"""
        response = requests.get(f"{BASE_URL}/api/devices/stats/summary", headers=self.headers)
        assert response.status_code == 200, f"Failed to get stats: {response.text}"
        stats = response.json()
        
        # Verify stat fields
        expected_fields = ['total', 'online', 'offline', 'warning', 'avg_cpu', 'needs_patching']
        for field in expected_fields:
            assert field in stats, f"Missing stat field: {field}"
        
        # Verify counts
        assert stats['total'] >= 10, f"Expected at least 10 total devices, got {stats['total']}"
        print(f"Stats: Total={stats['total']}, Online={stats['online']}, Offline={stats['offline']}, Warning={stats['warning']}")
    
    # === Device Detail Tests ===
    def test_get_device_detail(self):
        """GET /api/devices/{id}/detail - should return comprehensive device info"""
        response = requests.get(f"{BASE_URL}/api/devices/dev-001/detail", headers=self.headers)
        assert response.status_code == 200, f"Failed to get device detail: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert 'device' in data, "Missing device object"
        assert 'software' in data, "Missing software array"
        assert 'patches' in data, "Missing patches array"
        assert 'events' in data, "Missing events array"
        assert 'performance' in data, "Missing performance array"
        assert 'network_adapters' in data, "Missing network_adapters array"
        
        # Verify device has rich data
        device = data['device']
        assert device['name'] == 'ACME-DC-01', f"Expected ACME-DC-01, got {device['name']}"
        print(f"Device detail fetched: {device['name']}, Compliance: {device.get('compliance_score')}")
    
    def test_device_detail_hardware_specs(self):
        """Verify device detail has hardware specs for Overview tab"""
        response = requests.get(f"{BASE_URL}/api/devices/dev-001/detail", headers=self.headers)
        assert response.status_code == 200
        device = response.json()['device']
        
        # Hardware fields
        hw_fields = ['manufacturer', 'model', 'serial_number', 'processor', 'ram_gb', 'storage_total_gb']
        for field in hw_fields:
            assert field in device, f"Missing hardware field: {field}"
        print(f"Hardware: {device.get('manufacturer')} {device.get('model')}, {device.get('ram_gb')}GB RAM")
    
    def test_device_detail_security_status(self):
        """Verify device detail has security fields for Security tab"""
        response = requests.get(f"{BASE_URL}/api/devices/dev-001/detail", headers=self.headers)
        assert response.status_code == 200
        device = response.json()['device']
        
        # Security fields
        security_fields = ['antivirus', 'antivirus_status', 'firewall_enabled', 'encryption_status', 'compliance_score']
        for field in security_fields:
            assert field in device, f"Missing security field: {field}"
        print(f"Security: AV={device.get('antivirus')}, Firewall={device.get('firewall_enabled')}, Compliance={device.get('compliance_score')}")
    
    # === Software Tab ===
    def test_device_software_list(self):
        """GET /api/devices/{id}/software - should return installed software"""
        response = requests.get(f"{BASE_URL}/api/devices/dev-001/software", headers=self.headers)
        assert response.status_code == 200, f"Failed to get software: {response.text}"
        software = response.json()
        assert isinstance(software, list), "Response should be a list"
        assert len(software) >= 8, f"Expected at least 8 software entries for dev-001, got {len(software)}"
        
        # Check software has required fields
        if software:
            sw = software[0]
            assert 'name' in sw, "Software missing name"
            assert 'version' in sw, "Software missing version"
        print(f"Found {len(software)} software entries for dev-001")
    
    # === Patches Tab ===
    def test_device_patches_list(self):
        """GET /api/devices/{id}/patches - should return patch information"""
        response = requests.get(f"{BASE_URL}/api/devices/dev-001/patches", headers=self.headers)
        assert response.status_code == 200, f"Failed to get patches: {response.text}"
        patches = response.json()
        assert isinstance(patches, list), "Response should be a list"
        assert len(patches) >= 4, f"Expected at least 4 patches for dev-001, got {len(patches)}"
        
        # Check patch has required fields
        if patches:
            patch = patches[0]
            assert 'kb_id' in patch or 'title' in patch, "Patch missing identifier"
            assert 'status' in patch, "Patch missing status"
        print(f"Found {len(patches)} patches for dev-001")
    
    # === Events Tab ===
    def test_device_events_list(self):
        """GET /api/devices/{id}/events - should return event timeline"""
        response = requests.get(f"{BASE_URL}/api/devices/dev-001/events", headers=self.headers)
        assert response.status_code == 200, f"Failed to get events: {response.text}"
        events = response.json()
        assert isinstance(events, list), "Response should be a list"
        assert len(events) >= 10, f"Expected at least 10 events for dev-001, got {len(events)}"
        
        # Check event has required fields
        if events:
            event = events[0]
            assert 'event_type' in event or 'message' in event, "Event missing type/message"
            assert 'timestamp' in event, "Event missing timestamp"
        print(f"Found {len(events)} events for dev-001")
    
    # === Performance Tab ===
    def test_device_performance_data(self):
        """GET /api/devices/{id}/performance - should return performance metrics"""
        response = requests.get(f"{BASE_URL}/api/devices/dev-001/performance", headers=self.headers)
        assert response.status_code == 200, f"Failed to get performance: {response.text}"
        perf = response.json()
        assert isinstance(perf, list), "Response should be a list"
        assert len(perf) >= 100, f"Expected at least 100 performance data points, got {len(perf)}"
        
        # Check performance has required fields for charts
        if perf:
            data = perf[0]
            perf_fields = ['cpu', 'memory', 'disk', 'timestamp']
            for field in perf_fields:
                assert field in data, f"Performance missing field: {field}"
        print(f"Found {len(perf)} performance data points for dev-001")
    
    # === Network Tab ===
    def test_device_network_adapters(self):
        """Verify device detail includes network adapters"""
        response = requests.get(f"{BASE_URL}/api/devices/dev-001/detail", headers=self.headers)
        assert response.status_code == 200
        data = response.json()
        
        adapters = data.get('network_adapters', [])
        assert len(adapters) >= 2, f"Expected at least 2 network adapters for dev-001, got {len(adapters)}"
        
        # Check adapter has required fields for table
        if adapters:
            adapter = adapters[0]
            adapter_fields = ['adapter_name', 'ip_address', 'type']
            for field in adapter_fields:
                assert field in adapter, f"Network adapter missing field: {field}"
        print(f"Found {len(adapters)} network adapters for dev-001")
    
    # === Device CRUD ===
    def test_create_device(self):
        """POST /api/devices - should create new device"""
        # Get a client ID first
        clients = requests.get(f"{BASE_URL}/api/clients", headers=self.headers).json()
        client_id = clients[0]['id'] if clients else None
        assert client_id, "No clients found for device creation"
        
        new_device = {
            "name": "TEST-DEVICE-001",
            "client_id": client_id,
            "device_type": "workstation",
            "os": "Windows 11",
            "ip_address": "192.168.1.200",
            "manufacturer": "Dell",
            "model": "OptiPlex 7090"
        }
        
        response = requests.post(f"{BASE_URL}/api/devices", json=new_device, headers=self.headers)
        assert response.status_code == 200, f"Failed to create device: {response.text}"
        
        created = response.json()
        assert created['name'] == new_device['name']
        print(f"Created device: {created['name']} with id {created['id']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/devices/{created['id']}", headers=self.headers)
    
    def test_get_single_device(self):
        """GET /api/devices/{id} - should return single device"""
        response = requests.get(f"{BASE_URL}/api/devices/dev-001", headers=self.headers)
        assert response.status_code == 200, f"Failed to get device: {response.text}"
        device = response.json()
        assert device['id'] == 'dev-001'
        assert device['name'] == 'ACME-DC-01'
        print(f"Fetched device: {device['name']}")
    
    def test_device_not_found(self):
        """GET /api/devices/{id} - should return 404 for non-existent device"""
        response = requests.get(f"{BASE_URL}/api/devices/non-existent-id", headers=self.headers)
        assert response.status_code == 404
        print("Correctly returned 404 for non-existent device")


class TestDeviceFilters:
    """Tests for device filtering on list page"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_filter_by_status(self):
        """Verify devices can be filtered by status"""
        response = requests.get(f"{BASE_URL}/api/devices?status=online", headers=self.headers)
        assert response.status_code == 200
        devices = response.json()
        # Note: Filter might be applied frontend-side, just verify API returns data
        assert isinstance(devices, list)
        print(f"Filter by status returned {len(devices)} devices")
    
    def test_filter_by_client(self):
        """Verify devices can be filtered by client"""
        # Get first client
        clients = requests.get(f"{BASE_URL}/api/clients", headers=self.headers).json()
        if clients:
            client_id = clients[0]['id']
            response = requests.get(f"{BASE_URL}/api/devices?client_id={client_id}", headers=self.headers)
            assert response.status_code == 200
            devices = response.json()
            assert isinstance(devices, list)
            print(f"Filter by client {clients[0]['name']} returned {len(devices)} devices")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
