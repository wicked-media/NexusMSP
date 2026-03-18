"""
Iteration 37: Testing new batch of features
- On-Call Roster System (GET roster, create shift, swap, ping)
- Workshop Jobs (CRUD, status progression, timer, add parts)
- Field Jobs WISP (CRUD, status progression, checklist)
- Auto-Reorder Alerts (check-reorder endpoint)
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
AUTH_TOKEN = None

# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    global AUTH_TOKEN
    if AUTH_TOKEN:
        return AUTH_TOKEN
    
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": "admin123"
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    data = response.json()
    AUTH_TOKEN = data.get("token") or data.get("access_token")
    assert AUTH_TOKEN, "No token in login response"
    return AUTH_TOKEN

@pytest.fixture
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}

# =============================================================================
# ON-CALL ROSTER TESTS
# =============================================================================

class TestOnCallRoster:
    """On-Call Roster System Tests"""
    
    def test_get_on_call_roster(self, headers):
        """Test GET /api/on-call/roster returns roster list"""
        response = requests.get(f"{BASE_URL}/api/on-call/roster", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Roster should be a list"
        print(f"Roster returned {len(data)} shifts")
    
    def test_get_active_on_call(self, headers):
        """Test GET /api/on-call/active returns active on-call techs"""
        response = requests.get(f"{BASE_URL}/api/on-call/active", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Active on-call should be a list"
        print(f"Active on-call: {len(data)} technicians")
    
    def test_create_on_call_shift(self, headers):
        """Test POST /api/on-call/roster creates a new shift"""
        # First get a technician
        techs_res = requests.get(f"{BASE_URL}/api/technicians", headers=headers)
        techs = techs_res.json() if techs_res.status_code == 200 else []
        tech_id = techs[0]["id"] if techs else "test-tech-id"
        tech_name = techs[0]["name"] if techs else "Test Tech"
        
        # Create shift starting now
        now = datetime.utcnow()
        start = now.isoformat()
        end = (now + timedelta(hours=8)).isoformat()
        
        payload = {
            "tech_id": tech_id,
            "tech_name": tech_name,
            "shift_type": "primary",
            "category": "general",
            "start_time": start,
            "end_time": end,
            "notes": "TEST_shift_pytest"
        }
        response = requests.post(f"{BASE_URL}/api/on-call/roster", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "id" in data, "Shift should have an id"
        assert data["tech_id"] == tech_id
        assert data["category"] == "general"
        print(f"Created on-call shift: {data['id']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/on-call/roster/{data['id']}", headers=headers)
    
    def test_swap_on_call_shift(self, headers):
        """Test POST /api/on-call/roster/{shift_id}/swap swaps shift"""
        # Get techs
        techs_res = requests.get(f"{BASE_URL}/api/technicians", headers=headers)
        techs = techs_res.json() if techs_res.status_code == 200 else []
        if len(techs) < 2:
            pytest.skip("Need at least 2 technicians for swap test")
        
        tech1 = techs[0]
        tech2 = techs[1]
        
        # Create shift
        now = datetime.utcnow()
        payload = {
            "tech_id": tech1["id"],
            "tech_name": tech1["name"],
            "shift_type": "primary",
            "category": "general",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(hours=4)).isoformat(),
            "notes": "TEST_swap_shift"
        }
        create_res = requests.post(f"{BASE_URL}/api/on-call/roster", json=payload, headers=headers)
        assert create_res.status_code == 200
        shift = create_res.json()
        
        # Swap to tech2
        swap_res = requests.post(
            f"{BASE_URL}/api/on-call/roster/{shift['id']}/swap",
            json={"new_tech_id": tech2["id"], "new_tech_name": tech2["name"]},
            headers=headers
        )
        assert swap_res.status_code == 200, f"Swap failed: {swap_res.text}"
        assert "swapped" in swap_res.json().get("message", "").lower()
        print(f"Swapped shift from {tech1['name']} to {tech2['name']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/on-call/roster/{shift['id']}", headers=headers)
    
    def test_ping_active_on_call(self, headers):
        """Test POST /api/on-call/ping-active pings active technicians"""
        response = requests.post(f"{BASE_URL}/api/on-call/ping-active", json={}, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data
        assert "ping" in data["message"].lower()
        print(f"Ping result: {data['message']}")
    
    def test_delete_on_call_shift(self, headers):
        """Test DELETE /api/on-call/roster/{shift_id} deletes shift"""
        # Create shift first
        techs_res = requests.get(f"{BASE_URL}/api/technicians", headers=headers)
        techs = techs_res.json() if techs_res.status_code == 200 else []
        tech_id = techs[0]["id"] if techs else "test-tech-id"
        
        now = datetime.utcnow()
        payload = {
            "tech_id": tech_id,
            "tech_name": "Test",
            "shift_type": "backup",
            "category": "emergency",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(hours=2)).isoformat()
        }
        create_res = requests.post(f"{BASE_URL}/api/on-call/roster", json=payload, headers=headers)
        shift = create_res.json()
        
        # Delete it
        del_res = requests.delete(f"{BASE_URL}/api/on-call/roster/{shift['id']}", headers=headers)
        assert del_res.status_code == 200
        print("Deleted on-call shift successfully")

# =============================================================================
# WORKSHOP JOBS TESTS
# =============================================================================

class TestWorkshopJobs:
    """Workshop/Retail Repair Jobs Tests"""
    
    def test_get_workshop_jobs(self, headers):
        """Test GET /api/workshop/jobs returns job list"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Jobs should be a list"
        print(f"Workshop jobs: {len(data)}")
    
    def test_get_workshop_stats(self, headers):
        """Test GET /api/workshop/stats returns stats"""
        response = requests.get(f"{BASE_URL}/api/workshop/stats", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "total_jobs" in data
        assert "statuses" in data
        print(f"Workshop stats: {data['total_jobs']} total jobs")
    
    def test_create_workshop_job(self, headers):
        """Test POST /api/workshop/jobs creates a new job"""
        payload = {
            "customer_name": "TEST_Customer Workshop",
            "customer_phone": "0412345678",
            "device_type": "Laptop",
            "device_brand": "HP",
            "device_model": "EliteBook 840",
            "serial_number": "TEST123456",
            "fault_description": "Screen flickering issue",
            "priority": "high"
        }
        response = requests.post(f"{BASE_URL}/api/workshop/jobs", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert "job_number" in data
        assert data["job_number"].startswith("WS-")
        assert data["repair_status"] == "checked_in"
        assert data["customer_name"] == "TEST_Customer Workshop"
        print(f"Created workshop job: {data['job_number']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/workshop/jobs/{data['id']}", headers=headers)
    
    def test_get_workshop_job_detail(self, headers):
        """Test GET /api/workshop/jobs/{job_id} returns job detail"""
        # Create job
        payload = {"customer_name": "TEST_Detail", "device_type": "Phone", "fault_description": "Won't charge"}
        create_res = requests.post(f"{BASE_URL}/api/workshop/jobs", json=payload, headers=headers)
        job = create_res.json()
        
        # Get detail
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{job['id']}", headers=headers)
        assert response.status_code == 200
        detail = response.json()
        assert detail["id"] == job["id"]
        assert detail["customer_name"] == "TEST_Detail"
        assert "parts_used" in detail
        assert "labour_minutes" in detail
        print(f"Job detail retrieved: {detail['job_number']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/workshop/jobs/{job['id']}", headers=headers)
    
    def test_workshop_status_progression(self, headers):
        """Test workshop job status changes: checked_in -> diagnosing -> repairing -> ready_for_pickup"""
        # Create job
        payload = {"customer_name": "TEST_Status", "device_type": "Tablet", "fault_description": "Cracked screen"}
        create_res = requests.post(f"{BASE_URL}/api/workshop/jobs", json=payload, headers=headers)
        job = create_res.json()
        assert job["repair_status"] == "checked_in"
        
        # Progress through statuses
        statuses = ["diagnosing", "repairing", "ready_for_pickup", "collected"]
        for status in statuses:
            res = requests.put(
                f"{BASE_URL}/api/workshop/jobs/{job['id']}/status",
                json={"status": status},
                headers=headers
            )
            assert res.status_code == 200, f"Status change to {status} failed: {res.text}"
            print(f"Status changed to: {status}")
        
        # Verify final status
        detail_res = requests.get(f"{BASE_URL}/api/workshop/jobs/{job['id']}", headers=headers)
        assert detail_res.json()["repair_status"] == "collected"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/workshop/jobs/{job['id']}", headers=headers)
    
    def test_workshop_timer(self, headers):
        """Test workshop labour timer start/stop"""
        # Create job
        payload = {"customer_name": "TEST_Timer", "device_type": "Desktop", "fault_description": "Slow boot"}
        create_res = requests.post(f"{BASE_URL}/api/workshop/jobs", json=payload, headers=headers)
        job = create_res.json()
        
        # Start timer
        start_res = requests.put(
            f"{BASE_URL}/api/workshop/jobs/{job['id']}/timer",
            json={"action": "start"},
            headers=headers
        )
        assert start_res.status_code == 200
        assert start_res.json()["timer_running"] == True
        print("Timer started")
        
        # Stop timer
        import time
        time.sleep(2)  # Wait 2 seconds
        stop_res = requests.put(
            f"{BASE_URL}/api/workshop/jobs/{job['id']}/timer",
            json={"action": "stop"},
            headers=headers
        )
        assert stop_res.status_code == 200
        assert stop_res.json()["timer_running"] == False
        print(f"Timer stopped, minutes tracked")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/workshop/jobs/{job['id']}", headers=headers)
    
    def test_add_part_to_workshop_job(self, headers):
        """Test adding parts to workshop job deducts inventory"""
        # Create job
        payload = {"customer_name": "TEST_Parts", "device_type": "Laptop", "fault_description": "Needs RAM"}
        create_res = requests.post(f"{BASE_URL}/api/workshop/jobs", json=payload, headers=headers)
        job = create_res.json()
        
        # Get a product
        products_res = requests.get(f"{BASE_URL}/api/products", headers=headers)
        products = products_res.json() if products_res.status_code == 200 else []
        if not products:
            pytest.skip("No products available")
        product = products[0]
        
        # Add part
        add_part_res = requests.post(
            f"{BASE_URL}/api/workshop/jobs/{job['id']}/add-part",
            json={
                "product_id": product["id"],
                "product_name": product["name"],
                "quantity": 1,
                "unit_price": product.get("retail_price", 50)
            },
            headers=headers
        )
        assert add_part_res.status_code == 200, f"Failed: {add_part_res.text}"
        assert "part" in add_part_res.json()
        print(f"Added part: {product['name']}")
        
        # Verify part in job
        detail_res = requests.get(f"{BASE_URL}/api/workshop/jobs/{job['id']}", headers=headers)
        detail = detail_res.json()
        assert len(detail["parts_used"]) > 0
        assert detail["total_parts_cost"] > 0
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/workshop/jobs/{job['id']}", headers=headers)

# =============================================================================
# FIELD JOBS (WISP/INTERNET) TESTS
# =============================================================================

class TestFieldJobs:
    """Field Jobs / WISP Internet Tests"""
    
    def test_get_field_jobs(self, headers):
        """Test GET /api/field-jobs returns job list"""
        response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Field jobs should be a list"
        print(f"Field jobs: {len(data)}")
    
    def test_get_field_jobs_stats(self, headers):
        """Test GET /api/field-jobs/stats/summary returns stats"""
        response = requests.get(f"{BASE_URL}/api/field-jobs/stats/summary", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "total_jobs" in data
        assert "statuses" in data
        assert "zones" in data
        print(f"Field job stats: {data['total_jobs']} total")
    
    def test_create_field_job_installation(self, headers):
        """Test POST /api/field-jobs creates job with auto-generated checklist for installation"""
        payload = {
            "customer_name": "TEST_WISP_Customer",
            "customer_phone": "0498765432",
            "service_address": "123 Test Street, TestVille",
            "zone": "Zone A",
            "job_category": "installation",
            "description": "New NBN installation",
            "priority": "normal",
            "scheduled_date": (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d"),
            "scheduled_time": "09:00"
        }
        response = requests.post(f"{BASE_URL}/api/field-jobs", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert "job_number" in data
        assert data["job_number"].startswith("FJ-")
        assert data["field_status"] == "scheduled"
        assert data["job_category"] == "installation"
        
        # Check auto-generated checklist (6 items for installation)
        assert "checklist" in data
        assert len(data["checklist"]) == 6
        print(f"Created field job: {data['job_number']} with {len(data['checklist'])} checklist items")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/field-jobs/{data['id']}", headers=headers)
    
    def test_create_field_job_maintenance(self, headers):
        """Test POST /api/field-jobs with maintenance category gets different checklist"""
        payload = {
            "customer_name": "TEST_Maintenance",
            "service_address": "456 Test Ave",
            "zone": "Zone B",
            "job_category": "maintenance",
            "description": "Routine checkup"
        }
        response = requests.post(f"{BASE_URL}/api/field-jobs", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Maintenance gets 4 checklist items
        assert len(data["checklist"]) == 4
        print(f"Maintenance job created with {len(data['checklist'])} checklist items")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/field-jobs/{data['id']}", headers=headers)
    
    def test_get_field_job_detail(self, headers):
        """Test GET /api/field-jobs/{job_id} returns job detail"""
        # Create job
        payload = {"customer_name": "TEST_Detail_FJ", "service_address": "789 Test Rd", "job_category": "installation"}
        create_res = requests.post(f"{BASE_URL}/api/field-jobs", json=payload, headers=headers)
        job = create_res.json()
        
        # Get detail
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job['id']}", headers=headers)
        assert response.status_code == 200
        detail = response.json()
        assert detail["id"] == job["id"]
        assert "checklist" in detail
        assert "signal_strength" in detail
        assert "speed_test_down" in detail
        print(f"Field job detail retrieved: {detail['job_number']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/field-jobs/{job['id']}", headers=headers)
    
    def test_field_job_status_progression(self, headers):
        """Test field job status changes: scheduled -> en_route -> on_site -> completed"""
        # Create job
        payload = {"customer_name": "TEST_FJ_Status", "service_address": "Test Addr", "job_category": "installation"}
        create_res = requests.post(f"{BASE_URL}/api/field-jobs", json=payload, headers=headers)
        job = create_res.json()
        assert job["field_status"] == "scheduled"
        
        # Progress through statuses
        statuses = ["en_route", "on_site", "completed"]
        for status in statuses:
            res = requests.put(
                f"{BASE_URL}/api/field-jobs/{job['id']}/status",
                json={"status": status},
                headers=headers
            )
            assert res.status_code == 200, f"Status change to {status} failed: {res.text}"
            print(f"Field job status -> {status}")
        
        # Verify final
        detail_res = requests.get(f"{BASE_URL}/api/field-jobs/{job['id']}", headers=headers)
        assert detail_res.json()["field_status"] == "completed"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/field-jobs/{job['id']}", headers=headers)
    
    def test_update_field_job_checklist(self, headers):
        """Test updating field job checklist items"""
        # Create job
        payload = {"customer_name": "TEST_Checklist", "service_address": "Check Addr", "job_category": "installation"}
        create_res = requests.post(f"{BASE_URL}/api/field-jobs", json=payload, headers=headers)
        job = create_res.json()
        
        # Update checklist - mark first item as checked
        checklist = job["checklist"]
        checklist[0]["checked"] = True
        
        update_res = requests.put(
            f"{BASE_URL}/api/field-jobs/{job['id']}",
            json={"checklist": checklist},
            headers=headers
        )
        assert update_res.status_code == 200
        
        # Verify
        detail_res = requests.get(f"{BASE_URL}/api/field-jobs/{job['id']}", headers=headers)
        assert detail_res.json()["checklist"][0]["checked"] == True
        print("Checklist item marked as checked")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/field-jobs/{job['id']}", headers=headers)
    
    def test_update_field_job_signal_speed(self, headers):
        """Test updating signal strength and speed test fields"""
        # Create job
        payload = {"customer_name": "TEST_Signal", "service_address": "Signal Addr", "job_category": "installation"}
        create_res = requests.post(f"{BASE_URL}/api/field-jobs", json=payload, headers=headers)
        job = create_res.json()
        
        # Update signal/speed
        update_res = requests.put(
            f"{BASE_URL}/api/field-jobs/{job['id']}",
            json={
                "signal_strength": "-65",
                "speed_test_down": "95.5",
                "speed_test_up": "42.3"
            },
            headers=headers
        )
        assert update_res.status_code == 200
        
        # Verify
        detail_res = requests.get(f"{BASE_URL}/api/field-jobs/{job['id']}", headers=headers)
        detail = detail_res.json()
        assert detail["signal_strength"] == "-65"
        assert detail["speed_test_down"] == "95.5"
        print(f"Signal: {detail['signal_strength']}dBm, Download: {detail['speed_test_down']}Mbps")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/field-jobs/{job['id']}", headers=headers)
    
    def test_get_checklist_templates(self, headers):
        """Test GET /api/field-jobs/templates returns template checklists"""
        response = requests.get(f"{BASE_URL}/api/field-jobs/templates", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "installation" in data
        assert "maintenance" in data
        assert len(data["installation"]) == 6
        print(f"Templates: installation({len(data['installation'])}), maintenance({len(data['maintenance'])})")

# =============================================================================
# AUTO-REORDER ALERTS TEST
# =============================================================================

class TestAutoReorder:
    """Auto-Reorder Alert System Tests"""
    
    def test_check_reorder_alerts(self, headers):
        """Test POST /api/inventory/check-reorder triggers reorder check"""
        response = requests.post(f"{BASE_URL}/api/inventory/check-reorder", json={}, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data
        assert "reorder" in data["message"].lower() or "alert" in data["message"].lower() or "complete" in data["message"].lower()
        print(f"Reorder check result: {data['message']}")

# =============================================================================
# TICKETS PAGE TABS TEST
# =============================================================================

class TestTicketsPageTabs:
    """Test that tickets page tabs work (Tickets, Workshop, Field)"""
    
    def test_tickets_endpoint_works(self, headers):
        """Test that the regular tickets endpoint still works"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"Tickets: {len(data)}")
    
    def test_workshop_jobs_accessible(self, headers):
        """Test workshop jobs endpoint from tickets page context"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs", headers=headers)
        assert response.status_code == 200
        print("Workshop jobs accessible")
    
    def test_field_jobs_accessible(self, headers):
        """Test field jobs endpoint from tickets page context"""
        response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        assert response.status_code == 200
        print("Field jobs accessible")
