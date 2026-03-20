"""
Iteration 29 Backend Tests - Client Health Score, Notifications, Contracts Enhancements, Project Milestones
Tests for 5 major new features:
1. Client Health Score Engine (0-100 based on tickets, SLA, devices, payments, contracts)
2. Contract renewal alerts and SLA tiers
3. Project milestones and time budget tracking
4. Activity timeline for clients
5. Global notification bell system
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://rmm-features-11.preview.emergentagent.com"

class TestAuth:
    """Authentication tests"""
    token = None
    
    def test_login_admin(self):
        """Login with admin credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert "user" in data
        TestAuth.token = data["token"]
        print(f"Login successful - user: {data['user']['name']}")
        return data["token"]

@pytest.fixture
def auth_headers():
    """Get auth headers"""
    if not TestAuth.token:
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": "admin123"
        })
        TestAuth.token = response.json()["token"]
    return {"Authorization": f"Bearer {TestAuth.token}"}


class TestClientHealthScore:
    """Client Health Score Engine tests - Feature 1"""
    
    def test_get_all_client_health_scores(self, auth_headers):
        """GET /api/clients/health/all - returns health scores for all clients"""
        response = requests.get(f"{BASE_URL}/api/clients/health/all", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Should return a list"
        print(f"Got health scores for {len(data)} clients")
        
        # Verify structure of health score response
        if len(data) > 0:
            client_health = data[0]
            assert "client_id" in client_health
            assert "client_name" in client_health
            assert "health_score" in client_health
            assert "risk_level" in client_health
            assert "breakdown" in client_health
            
            # Verify breakdown has all 5 components
            breakdown = client_health["breakdown"]
            assert "tickets" in breakdown, "Missing tickets score in breakdown"
            assert "sla" in breakdown, "Missing sla score in breakdown"
            assert "devices" in breakdown, "Missing devices score in breakdown"
            assert "payments" in breakdown, "Missing payments score in breakdown"
            assert "contracts" in breakdown, "Missing contracts score in breakdown"
            
            # Verify health score is 0-100
            assert 0 <= client_health["health_score"] <= 100
            
            # Verify risk_level is valid
            assert client_health["risk_level"] in ["healthy", "attention", "at_risk", "critical"]
            print(f"Sample client: {client_health['client_name']} - Score: {client_health['health_score']} ({client_health['risk_level']})")
    
    def test_get_single_client_health(self, auth_headers):
        """GET /api/clients/{id}/health - returns single client health score"""
        # First get a client
        clients_response = requests.get(f"{BASE_URL}/api/clients", headers=auth_headers)
        assert clients_response.status_code == 200
        clients = clients_response.json()
        
        if len(clients) > 0:
            client_id = clients[0]["id"]
            response = requests.get(f"{BASE_URL}/api/clients/{client_id}/health", headers=auth_headers)
            assert response.status_code == 200, f"Failed: {response.text}"
            health = response.json()
            
            assert health["client_id"] == client_id
            assert "health_score" in health
            assert "breakdown" in health
            print(f"Client {health['client_name']} health: {health['health_score']}/100")
            
            # Verify breakdown totals to health_score
            breakdown = health["breakdown"]
            calc_total = sum(breakdown.values())
            assert calc_total == health["health_score"], f"Breakdown sum {calc_total} != health_score {health['health_score']}"


class TestClientActivityTimeline:
    """Client Activity Timeline tests - Feature 4"""
    
    def test_get_client_activity_timeline(self, auth_headers):
        """GET /api/clients/{id}/activity-timeline - returns combined activity"""
        # Get a client
        clients_response = requests.get(f"{BASE_URL}/api/clients", headers=auth_headers)
        clients = clients_response.json()
        
        if len(clients) > 0:
            client_id = clients[0]["id"]
            response = requests.get(f"{BASE_URL}/api/clients/{client_id}/activity-timeline", headers=auth_headers)
            assert response.status_code == 200, f"Failed: {response.text}"
            timeline = response.json()
            
            assert isinstance(timeline, list)
            print(f"Got {len(timeline)} timeline items for client")
            
            # Verify timeline item structure if any exist
            if len(timeline) > 0:
                item = timeline[0]
                assert "type" in item
                assert item["type"] in ["ticket", "invoice", "time_entry"]
                assert "title" in item
                assert "timestamp" in item
                print(f"Sample timeline item: {item['type']} - {item['title']}")


class TestContractRenewalAlerts:
    """Contract renewal alerts and SLA tiers - Feature 2"""
    
    def test_get_renewal_alerts(self, auth_headers):
        """GET /api/contracts/renewal-alerts - returns contracts expiring within 90 days"""
        response = requests.get(f"{BASE_URL}/api/contracts/renewal-alerts", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        alerts = response.json()
        
        assert isinstance(alerts, list)
        print(f"Got {len(alerts)} renewal alerts")
        
        # Verify alert structure if any exist
        if len(alerts) > 0:
            alert = alerts[0]
            assert "contract_id" in alert
            assert "contract_name" in alert
            assert "client_name" in alert
            assert "end_date" in alert
            assert "days_remaining" in alert
            assert "urgency" in alert
            assert "sla_tier" in alert
            
            # Verify urgency is valid
            assert alert["urgency"] in ["critical", "warning", "info"]
            print(f"Alert: {alert['contract_name']} - {alert['days_remaining']} days ({alert['urgency']})")
    
    def test_get_contracts_summary(self, auth_headers):
        """GET /api/contracts/summary - returns contract summary with SLA tier breakdown"""
        response = requests.get(f"{BASE_URL}/api/contracts/summary", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        summary = response.json()
        
        assert "total_active" in summary
        assert "total_value" in summary
        assert "expiring_30" in summary
        assert "expiring_60" in summary
        assert "by_tier" in summary
        
        print(f"Contract summary: {summary['total_active']} active, ${summary['total_value']} total value")
        print(f"Expiring in 30d: {summary['expiring_30']}, 60d: {summary['expiring_60']}")
        print(f"By tier: {summary['by_tier']}")


class TestNotifications:
    """Global notification system tests - Feature 5"""
    
    def test_get_notifications(self, auth_headers):
        """GET /api/notifications - returns list of notifications"""
        response = requests.get(f"{BASE_URL}/api/notifications", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        notifications = response.json()
        
        assert isinstance(notifications, list)
        print(f"Got {len(notifications)} notifications")
        
        # Verify notification structure if any exist
        if len(notifications) > 0:
            notif = notifications[0]
            assert "id" in notif
            assert "type" in notif
            assert "title" in notif
            assert "message" in notif
            assert "read" in notif
            assert notif["type"] in ["sla_breach", "contract_renewal", "device_offline", "ticket_assigned"]
            print(f"Sample notification: {notif['type']} - {notif['title']}")
    
    def test_get_unread_count(self, auth_headers):
        """GET /api/notifications/unread-count - returns unread notification count"""
        response = requests.get(f"{BASE_URL}/api/notifications/unread-count", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "count" in data
        assert isinstance(data["count"], int)
        assert data["count"] >= 0
        print(f"Unread notification count: {data['count']}")
    
    def test_generate_notifications(self, auth_headers):
        """POST /api/notifications/generate - generates new notifications"""
        response = requests.post(f"{BASE_URL}/api/notifications/generate", json={}, headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "message" in data
        assert "count" in data
        print(f"Generated {data['count']} new notifications")
    
    def test_mark_notifications_read(self, auth_headers):
        """POST /api/notifications/mark-read - marks notifications as read"""
        response = requests.post(f"{BASE_URL}/api/notifications/mark-read", json={}, headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "message" in data
        print(f"Mark read result: {data['message']}")
        
        # Verify count is now 0
        count_response = requests.get(f"{BASE_URL}/api/notifications/unread-count", headers=auth_headers)
        count_data = count_response.json()
        assert count_data["count"] == 0, "Unread count should be 0 after marking all read"


class TestProjectMilestones:
    """Project milestones and time budget - Feature 3"""
    test_project_id = None
    test_milestone_id = None
    
    def test_get_projects(self, auth_headers):
        """GET /api/projects - get list of projects"""
        response = requests.get(f"{BASE_URL}/api/projects", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        projects = response.json()
        assert isinstance(projects, list)
        print(f"Got {len(projects)} projects")
        
        if len(projects) > 0:
            TestProjectMilestones.test_project_id = projects[0]["id"]
    
    def test_create_milestone(self, auth_headers):
        """POST /api/projects/{id}/milestones - create a milestone"""
        if not TestProjectMilestones.test_project_id:
            # Create a test project first
            clients_response = requests.get(f"{BASE_URL}/api/clients", headers=auth_headers)
            clients = clients_response.json()
            if len(clients) == 0:
                pytest.skip("No clients to create project")
            
            project_data = {
                "name": "TEST_Milestone_Test_Project",
                "client_id": clients[0]["id"],
                "description": "Test project for milestone testing"
            }
            project_response = requests.post(f"{BASE_URL}/api/projects", json=project_data, headers=auth_headers)
            if project_response.status_code == 200:
                TestProjectMilestones.test_project_id = project_response.json()["id"]
        
        if not TestProjectMilestones.test_project_id:
            pytest.skip("No project available for milestone test")
        
        milestone_data = {
            "title": "TEST_Phase 1 Complete",
            "description": "Initial phase milestone",
            "due_date": "2026-03-01",
            "status": "pending"
        }
        response = requests.post(
            f"{BASE_URL}/api/projects/{TestProjectMilestones.test_project_id}/milestones",
            json=milestone_data,
            headers=auth_headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        milestone = response.json()
        
        assert "id" in milestone
        assert milestone["title"] == milestone_data["title"]
        assert milestone["project_id"] == TestProjectMilestones.test_project_id
        TestProjectMilestones.test_milestone_id = milestone["id"]
        print(f"Created milestone: {milestone['title']}")
    
    def test_get_milestones(self, auth_headers):
        """GET /api/projects/{id}/milestones - list milestones"""
        if not TestProjectMilestones.test_project_id:
            pytest.skip("No project available")
        
        response = requests.get(
            f"{BASE_URL}/api/projects/{TestProjectMilestones.test_project_id}/milestones",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        milestones = response.json()
        
        assert isinstance(milestones, list)
        print(f"Got {len(milestones)} milestones")
    
    def test_get_project_time_summary(self, auth_headers):
        """GET /api/projects/{id}/time-summary - get time budget vs actual"""
        if not TestProjectMilestones.test_project_id:
            pytest.skip("No project available")
        
        response = requests.get(
            f"{BASE_URL}/api/projects/{TestProjectMilestones.test_project_id}/time-summary",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        summary = response.json()
        
        assert "budget_hours" in summary
        assert "estimated_hours" in summary
        assert "actual_hours" in summary
        assert "total_tasks" in summary
        assert "completed_tasks" in summary
        assert "completion_pct" in summary
        
        print(f"Time summary: Budget {summary['budget_hours']}h, Actual {summary['actual_hours']}h, {summary['completion_pct']}% complete")
    
    def test_cleanup_milestone(self, auth_headers):
        """Cleanup test milestone"""
        if TestProjectMilestones.test_milestone_id and TestProjectMilestones.test_project_id:
            response = requests.delete(
                f"{BASE_URL}/api/projects/{TestProjectMilestones.test_project_id}/milestones/{TestProjectMilestones.test_milestone_id}",
                headers=auth_headers
            )
            print(f"Cleanup milestone: {response.status_code}")


class TestContractsEnhancements:
    """Contract SLA tier and enhancements"""
    
    def test_contracts_have_sla_tier(self, auth_headers):
        """Verify contracts support SLA tier field"""
        response = requests.get(f"{BASE_URL}/api/contracts", headers=auth_headers)
        assert response.status_code == 200
        contracts = response.json()
        
        print(f"Checking {len(contracts)} contracts for SLA tier support")
        
        # Check if any contracts have sla_tier set
        for contract in contracts:
            if "sla_tier" in contract:
                print(f"Contract {contract['name']} has SLA tier: {contract.get('sla_tier', 'standard')}")
    
    def test_create_contract_with_sla_tier(self, auth_headers):
        """Create a contract with SLA tier"""
        # Get a client first
        clients_response = requests.get(f"{BASE_URL}/api/clients", headers=auth_headers)
        clients = clients_response.json()
        if len(clients) == 0:
            pytest.skip("No clients available")
        
        contract_data = {
            "name": "TEST_SLA_Tier_Contract",
            "client_id": clients[0]["id"],
            "contract_type": "managed_services",
            "billing_frequency": "monthly",
            "start_date": "2026-01-01",
            "end_date": "2026-06-01",
            "value": 1500,
            "sla_tier": "gold",
            "auto_renew": True
        }
        
        response = requests.post(f"{BASE_URL}/api/contracts", json=contract_data, headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        contract = response.json()
        
        assert contract["sla_tier"] == "gold"
        print(f"Created contract with SLA tier: {contract['sla_tier']}")
        
        # Cleanup
        delete_response = requests.delete(f"{BASE_URL}/api/contracts/{contract['id']}", headers=auth_headers)
        print(f"Cleanup contract: {delete_response.status_code}")


class TestExistingEndpointsRegression:
    """Regression tests for existing endpoints"""
    
    def test_clients_endpoint(self, auth_headers):
        """GET /api/clients - basic regression"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=auth_headers)
        assert response.status_code == 200
        print(f"Clients: {len(response.json())} total")
    
    def test_tickets_endpoint(self, auth_headers):
        """GET /api/tickets - basic regression"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=auth_headers)
        assert response.status_code == 200
        print(f"Tickets: {len(response.json())} total")
    
    def test_devices_endpoint(self, auth_headers):
        """GET /api/devices - basic regression"""
        response = requests.get(f"{BASE_URL}/api/devices", headers=auth_headers)
        assert response.status_code == 200
        print(f"Devices: {len(response.json())} total")
    
    def test_dashboard_stats(self, auth_headers):
        """GET /api/dashboard/stats - basic regression"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=auth_headers)
        assert response.status_code == 200
        stats = response.json()
        print(f"Dashboard: {stats.get('total_clients', 0)} clients, {stats.get('open_tickets', 0)} open tickets")
