#!/usr/bin/env python3

import requests
import sys
import json
from datetime import datetime

class NexusOpsAPITester:
    def __init__(self, base_url="https://streamops-suite.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
        
        self.test_results.append({
            "test": name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat()
        })

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        
        if self.token:
            test_headers['Authorization'] = f'Bearer {self.token}'
        
        if headers:
            test_headers.update(headers)

        try:
            if method == 'GET':
                response = requests.get(url, headers=test_headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=test_headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=test_headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=test_headers, timeout=10)

            success = response.status_code == expected_status
            details = f"Status: {response.status_code}, Expected: {expected_status}"
            
            if not success:
                try:
                    error_detail = response.json().get('detail', 'No error detail')
                    details += f", Error: {error_detail}"
                except:
                    details += f", Response: {response.text[:100]}"

            self.log_test(name, success, details if not success else "")
            
            return success, response.json() if success and response.content else {}

        except Exception as e:
            self.log_test(name, False, f"Exception: {str(e)}")
            return False, {}

    def test_seed_data(self):
        """Test seeding demo data"""
        print("\n🌱 Testing Data Seeding...")
        success, response = self.run_test(
            "Seed Demo Data",
            "POST",
            "seed",
            200
        )
        return success

    def test_authentication(self):
        """Test authentication endpoints"""
        print("\n🔐 Testing Authentication...")
        
        # Test login with demo credentials
        success, response = self.run_test(
            "Login with Demo Credentials",
            "POST",
            "auth/login",
            200,
            data={"email": "admin@nexusops.io", "password": "admin123"}
        )
        
        if success and 'token' in response:
            self.token = response['token']
            print(f"   Token obtained: {self.token[:20]}...")
            
            # Test getting current user
            self.run_test(
                "Get Current User",
                "GET",
                "auth/me",
                200
            )
            return True
        return False

    def test_dashboard_endpoints(self):
        """Test dashboard data endpoints"""
        print("\n📊 Testing Dashboard Endpoints...")
        
        self.run_test("Get Dashboard Stats", "GET", "dashboard/stats", 200)
        self.run_test("Get Ticket Trends", "GET", "dashboard/ticket-trends", 200)
        self.run_test("Get Device Health", "GET", "dashboard/device-health", 200)

    def test_clients_crud(self):
        """Test clients CRUD operations"""
        print("\n👥 Testing Clients CRUD...")
        
        # Get clients
        success, clients = self.run_test("Get All Clients", "GET", "clients", 200)
        
        # Create new client
        new_client_data = {
            "name": "Test Client Corp",
            "email": "test@testclient.com",
            "industry": "Technology",
            "mrr": 1500.0
        }
        
        success, client = self.run_test(
            "Create New Client",
            "POST",
            "clients",
            200,
            data=new_client_data
        )
        
        if success and 'id' in client:
            client_id = client['id']
            
            # Get specific client
            self.run_test(
                "Get Specific Client",
                "GET",
                f"clients/{client_id}",
                200
            )
            
            # Update client
            update_data = {"name": "Updated Test Client", "mrr": 2000.0}
            self.run_test(
                "Update Client",
                "PUT",
                f"clients/{client_id}",
                200,
                data=update_data
            )
            
            # Delete client
            self.run_test(
                "Delete Client",
                "DELETE",
                f"clients/{client_id}",
                200
            )
            
            return client_id
        return None

    def test_tickets_crud(self):
        """Test tickets CRUD operations"""
        print("\n🎫 Testing Tickets CRUD...")
        
        # Get tickets
        self.run_test("Get All Tickets", "GET", "tickets", 200)
        self.run_test("Get Open Tickets", "GET", "tickets?status=open", 200)
        self.run_test("Get Critical Tickets", "GET", "tickets?priority=critical", 200)
        
        # Get clients for ticket creation
        success, clients = self.run_test("Get Clients for Ticket", "GET", "clients", 200)
        
        if success and clients:
            client_id = clients[0]['id']
            
            # Create new ticket
            new_ticket_data = {
                "title": "Test Support Ticket",
                "description": "This is a test ticket for API testing",
                "client_id": client_id,
                "priority": "medium",
                "category": "support"
            }
            
            success, ticket = self.run_test(
                "Create New Ticket",
                "POST",
                "tickets",
                200,
                data=new_ticket_data
            )
            
            if success and 'id' in ticket:
                ticket_id = ticket['id']
                
                # Get specific ticket
                self.run_test(
                    "Get Specific Ticket",
                    "GET",
                    f"tickets/{ticket_id}",
                    200
                )
                
                # Update ticket status
                self.run_test(
                    "Update Ticket Status",
                    "PUT",
                    f"tickets/{ticket_id}",
                    200,
                    data={"status": "in_progress"}
                )
                
                # Delete ticket
                self.run_test(
                    "Delete Ticket",
                    "DELETE",
                    f"tickets/{ticket_id}",
                    200
                )
                
                return ticket_id
        return None

    def test_devices_crud(self):
        """Test devices CRUD operations"""
        print("\n💻 Testing Devices CRUD...")
        
        # Get devices
        self.run_test("Get All Devices", "GET", "devices", 200)
        self.run_test("Get Online Devices", "GET", "devices?status=online", 200)
        
        # Get clients for device creation
        success, clients = self.run_test("Get Clients for Device", "GET", "clients", 200)
        
        if success and clients:
            client_id = clients[0]['id']
            
            # Create new device
            new_device_data = {
                "name": "TEST-WS-001",
                "client_id": client_id,
                "device_type": "workstation",
                "os": "Windows 11",
                "ip_address": "192.168.1.200"
            }
            
            success, device = self.run_test(
                "Create New Device",
                "POST",
                "devices",
                200,
                data=new_device_data
            )
            
            if success and 'id' in device:
                device_id = device['id']
                
                # Get specific device
                self.run_test(
                    "Get Specific Device",
                    "GET",
                    f"devices/{device_id}",
                    200
                )
                
                # Update device
                self.run_test(
                    "Update Device",
                    "PUT",
                    f"devices/{device_id}",
                    200,
                    data={"status": "warning"}
                )
                
                # Delete device
                self.run_test(
                    "Delete Device",
                    "DELETE",
                    f"devices/{device_id}",
                    200
                )
                
                return device_id
        return None

    def test_assets_crud(self):
        """Test assets CRUD operations"""
        print("\n📦 Testing Assets CRUD...")
        
        # Get assets
        self.run_test("Get All Assets", "GET", "assets", 200)
        self.run_test("Get Hardware Assets", "GET", "assets?asset_type=hardware", 200)
        
        # Get clients for asset creation
        success, clients = self.run_test("Get Clients for Asset", "GET", "clients", 200)
        
        if success and clients:
            client_id = clients[0]['id']
            
            # Create new asset
            new_asset_data = {
                "name": "Test Server Asset",
                "client_id": client_id,
                "asset_type": "hardware",
                "manufacturer": "Dell",
                "model": "PowerEdge Test",
                "cost": 5000.0
            }
            
            success, asset = self.run_test(
                "Create New Asset",
                "POST",
                "assets",
                200,
                data=new_asset_data
            )
            
            if success and 'id' in asset:
                asset_id = asset['id']
                
                # Get specific asset
                self.run_test(
                    "Get Specific Asset",
                    "GET",
                    f"assets/{asset_id}",
                    200
                )
                
                # Update asset
                self.run_test(
                    "Update Asset",
                    "PUT",
                    f"assets/{asset_id}",
                    200,
                    data={"cost": 6000.0}
                )
                
                # Delete asset
                self.run_test(
                    "Delete Asset",
                    "DELETE",
                    f"assets/{asset_id}",
                    200
                )
                
                return asset_id
        return None

    def test_alerts(self):
        """Test alerts endpoints"""
        print("\n🚨 Testing Alerts...")
        
        self.run_test("Get All Alerts", "GET", "alerts", 200)
        self.run_test("Get Active Alerts", "GET", "alerts?status=active", 200)
        self.run_test("Get Critical Alerts", "GET", "alerts?severity=critical", 200)

    def test_users(self):
        """Test users endpoint"""
        print("\n👤 Testing Users...")
        
        self.run_test("Get All Users", "GET", "users", 200)

    def run_all_tests(self):
        """Run all API tests"""
        print("🚀 Starting NexusOps API Tests")
        print(f"Testing against: {self.base_url}")
        print("=" * 50)
        
        # Seed data first
        self.test_seed_data()
        
        # Test authentication
        if not self.test_authentication():
            print("❌ Authentication failed - stopping tests")
            return False
        
        # Test all endpoints
        self.test_dashboard_endpoints()
        self.test_clients_crud()
        self.test_tickets_crud()
        self.test_devices_crud()
        self.test_assets_crud()
        self.test_alerts()
        self.test_users()
        
        # Print summary
        print("\n" + "=" * 50)
        print(f"📊 Test Summary: {self.tests_passed}/{self.tests_run} tests passed")
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        print(f"✨ Success Rate: {success_rate:.1f}%")
        
        return self.tests_passed == self.tests_run

def main():
    tester = NexusOpsAPITester()
    success = tester.run_all_tests()
    
    # Save detailed results
    with open('/app/backend_test_results.json', 'w') as f:
        json.dump({
            'summary': {
                'total_tests': tester.tests_run,
                'passed_tests': tester.tests_passed,
                'success_rate': (tester.tests_passed / tester.tests_run * 100) if tester.tests_run > 0 else 0,
                'timestamp': datetime.now().isoformat()
            },
            'results': tester.test_results
        }, f, indent=2)
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())