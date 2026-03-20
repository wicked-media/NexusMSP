#!/usr/bin/env python3

import requests
import sys
import json
from datetime import datetime

class NexusOpsAPITester:
    def __init__(self, base_url="https://po-workflow-hub.preview.emergentagent.com"):
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

    def test_contracts_crud(self):
        """Test contracts CRUD operations"""
        print("\n📋 Testing Contracts CRUD...")
        
        # Get contracts
        self.run_test("Get All Contracts", "GET", "contracts", 200)
        
        # Get clients for contract creation
        success, clients = self.run_test("Get Clients for Contract", "GET", "clients", 200)
        
        if success and clients:
            client_id = clients[0]['id']
            
            # Create new contract
            new_contract_data = {
                "client_id": client_id,
                "name": "Test Managed Services Contract",
                "contract_type": "managed_services",
                "billing_frequency": "monthly",
                "start_date": "2024-01-01",
                "value": 2500.0,
                "auto_renew": True
            }
            
            success, contract = self.run_test(
                "Create New Contract",
                "POST",
                "contracts",
                200,
                data=new_contract_data
            )
            
            if success and 'id' in contract:
                contract_id = contract['id']
                
                # Get specific contract
                self.run_test(
                    "Get Specific Contract",
                    "GET",
                    f"contracts/{contract_id}",
                    200
                )
                
                # Update contract
                self.run_test(
                    "Update Contract",
                    "PUT",
                    f"contracts/{contract_id}",
                    200,
                    data={"value": 3000.0}
                )
                
                # Delete contract
                self.run_test(
                    "Delete Contract",
                    "DELETE",
                    f"contracts/{contract_id}",
                    200
                )
                
                return contract_id
        return None

    def test_line_items_crud(self):
        """Test line items CRUD operations"""
        print("\n📝 Testing Line Items CRUD...")
        
        # Get line items
        self.run_test("Get All Line Items", "GET", "line-items", 200)
        
        # Get clients and contracts for line item creation
        success, clients = self.run_test("Get Clients for Line Item", "GET", "clients", 200)
        
        if success and clients:
            client_id = clients[0]['id']
            
            # Create new line item
            new_line_item_data = {
                "contract_id": "",  # Can be empty for standalone items
                "client_id": client_id,
                "name": "Test Microsoft 365 License",
                "description": "Test license for API testing",
                "quantity": 10,
                "unit_price": 22.0,
                "billing_frequency": "monthly"
            }
            
            success, line_item = self.run_test(
                "Create New Line Item",
                "POST",
                "line-items",
                200,
                data=new_line_item_data
            )
            
            if success and 'id' in line_item:
                item_id = line_item['id']
                
                # Update line item
                self.run_test(
                    "Update Line Item",
                    "PUT",
                    f"line-items/{item_id}",
                    200,
                    data={"quantity": 15, "unit_price": 25.0}
                )
                
                # Delete line item
                self.run_test(
                    "Delete Line Item",
                    "DELETE",
                    f"line-items/{item_id}",
                    200
                )
                
                return item_id
        return None

    def test_invoices_crud(self):
        """Test invoices CRUD operations"""
        print("\n🧾 Testing Invoices CRUD...")
        
        # Get invoices
        self.run_test("Get All Invoices", "GET", "invoices", 200)
        self.run_test("Get Draft Invoices", "GET", "invoices?status=draft", 200)
        
        # Get clients for invoice creation
        success, clients = self.run_test("Get Clients for Invoice", "GET", "clients", 200)
        
        if success and clients:
            client_id = clients[0]['id']
            
            # Create new invoice
            new_invoice_data = {
                "client_id": client_id,
                "due_date": "2024-12-31",
                "notes": "Test invoice for API testing",
                "line_items": [
                    {
                        "name": "Test Service",
                        "quantity": 1,
                        "unit_price": 100.0,
                        "total": 100.0
                    }
                ]
            }
            
            success, invoice = self.run_test(
                "Create New Invoice",
                "POST",
                "invoices",
                200,
                data=new_invoice_data
            )
            
            if success and 'id' in invoice:
                invoice_id = invoice['id']
                
                # Get specific invoice
                self.run_test(
                    "Get Specific Invoice",
                    "GET",
                    f"invoices/{invoice_id}",
                    200
                )
                
                # Update invoice status
                self.run_test(
                    "Update Invoice Status",
                    "PUT",
                    f"invoices/{invoice_id}",
                    200,
                    data={"status": "sent"}
                )
                
                # Delete invoice
                self.run_test(
                    "Delete Invoice",
                    "DELETE",
                    f"invoices/{invoice_id}",
                    200
                )
                
                return invoice_id
        return None

    def test_time_entries_crud(self):
        """Test time entries CRUD operations"""
        print("\n⏰ Testing Time Entries CRUD...")
        
        # Get time entries
        self.run_test("Get All Time Entries", "GET", "time-entries", 200)
        self.run_test("Get Billable Time Entries", "GET", "time-entries?billable=true", 200)
        
        # Get tickets and users for time entry creation
        success, tickets = self.run_test("Get Tickets for Time Entry", "GET", "tickets", 200)
        success2, users = self.run_test("Get Users for Time Entry", "GET", "users", 200)
        
        if success and tickets and success2 and users:
            ticket_id = tickets[0]['id']
            user_id = users[0]['id']
            
            # Create new time entry
            new_time_entry_data = {
                "ticket_id": ticket_id,
                "user_id": user_id,
                "description": "Test time entry for API testing",
                "minutes": 60,
                "billable": True,
                "date": "2024-08-15"
            }
            
            success, time_entry = self.run_test(
                "Create New Time Entry",
                "POST",
                "time-entries",
                200,
                data=new_time_entry_data
            )
            
            if success and 'id' in time_entry:
                entry_id = time_entry['id']
                
                # Update time entry
                self.run_test(
                    "Update Time Entry",
                    "PUT",
                    f"time-entries/{entry_id}",
                    200,
                    data={"minutes": 90}
                )
                
                # Delete time entry
                self.run_test(
                    "Delete Time Entry",
                    "DELETE",
                    f"time-entries/{entry_id}",
                    200
                )
                
                return entry_id
        return None

    def test_knowledge_base_crud(self):
        """Test knowledge base articles CRUD operations"""
        print("\n📚 Testing Knowledge Base CRUD...")
        
        # Get KB articles
        self.run_test("Get All KB Articles", "GET", "kb-articles", 200)
        self.run_test("Get Public KB Articles", "GET", "kb-articles?is_public=true", 200)
        self.run_test("Get Windows KB Articles", "GET", "kb-articles?category=windows", 200)
        
        # Create new KB article
        new_article_data = {
            "title": "Test Troubleshooting Guide",
            "content": "# Test Guide\n\nThis is a test article for API testing.\n\n## Steps\n1. Test step 1\n2. Test step 2",
            "category": "general",
            "tags": ["test", "api", "troubleshooting"],
            "is_public": False
        }
        
        success, article = self.run_test(
            "Create New KB Article",
            "POST",
            "kb-articles",
            200,
            data=new_article_data
        )
        
        if success and 'id' in article:
            article_id = article['id']
            
            # Get specific article
            self.run_test(
                "Get Specific KB Article",
                "GET",
                f"kb-articles/{article_id}",
                200
            )
            
            # Mark article as helpful
            self.run_test(
                "Mark Article as Helpful",
                "POST",
                f"kb-articles/{article_id}/helpful",
                200
            )
            
            # Update article
            self.run_test(
                "Update KB Article",
                "PUT",
                f"kb-articles/{article_id}",
                200,
                data={"is_public": True}
            )
            
            # Delete article
            self.run_test(
                "Delete KB Article",
                "DELETE",
                f"kb-articles/{article_id}",
                200
            )
            
            return article_id
        return None

    def test_pax8_endpoints(self):
        """Test Pax8 integration endpoints"""
        print("\n☁️ Testing Pax8 Integration...")
        
        # Test Pax8 status (should work without credentials)
        self.run_test("Get Pax8 Status", "GET", "pax8/status", 200)
        
        # Test connection (will fail without credentials, but should return proper error)
        success, response = self.run_test("Test Pax8 Connection", "GET", "pax8/test-connection", 200)
        
        # These endpoints will fail without proper Pax8 credentials, but we test the endpoint structure
        # Note: We expect these to fail gracefully with proper error messages
        print("   Note: Pax8 endpoints require valid credentials - testing endpoint structure only")

    def run_all_tests(self):
        """Run all API tests"""
        print("🚀 Starting NexusOps v2.0 API Tests")
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
        
        # Test new v2.0 features
        self.test_contracts_crud()
        self.test_line_items_crud()
        self.test_invoices_crud()
        self.test_time_entries_crud()
        self.test_knowledge_base_crud()
        self.test_pax8_endpoints()
        
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