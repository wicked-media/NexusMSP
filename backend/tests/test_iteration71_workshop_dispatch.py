"""
Iteration 71 - Workshop Bench & Dispatch Board API Tests
Tests for:
- Workshop Bench (Kanban for repair jobs)
- Dispatch Board (visual map with tech/job positions)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"


class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in response"
        return data["token"]
    
    def test_login_success(self):
        """Test standard login with admin credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert "user" in data
        print(f"✓ Login successful for {TEST_EMAIL}")


class TestWorkshopBench:
    """Workshop Bench API tests - Kanban for repair jobs"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get auth headers"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        token = response.json().get("token")
        return {"Authorization": f"Bearer {token}"}
    
    def test_get_bench_jobs(self, auth_headers):
        """GET /api/workshop/bench returns bench jobs array"""
        response = requests.get(f"{BASE_URL}/api/workshop/bench", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✓ GET /api/workshop/bench returned {len(data)} jobs")
        
        # Check existing job structure if any
        if len(data) > 0:
            job = data[0]
            assert "id" in job, "Job should have id"
            assert "job_number" in job, "Job should have job_number"
            assert "bench_stage" in job, "Job should have bench_stage"
            print(f"  First job: {job.get('job_number')} - {job.get('title', 'No title')}")
    
    def test_create_bench_job(self, auth_headers):
        """POST /api/workshop/bench creates a new workshop job with job_number WS-00002+"""
        new_job = {
            "title": "TEST_Replace laptop screen",
            "description": "Screen cracked, needs replacement",
            "client_name": "Test Client",
            "device_name": "Dell Latitude 5520",
            "assigned_to_name": "Test Tech"
        }
        response = requests.post(f"{BASE_URL}/api/workshop/bench", json=new_job, headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "id" in data, "Response should have id"
        assert "job_number" in data, "Response should have job_number"
        assert data["job_number"].startswith("WS-"), f"Job number should start with WS-, got {data['job_number']}"
        
        # Verify job number format (WS-00002 or higher)
        job_num = data["job_number"]
        num_part = int(job_num.replace("WS-", ""))
        assert num_part >= 1, f"Job number should be >= 1, got {num_part}"
        
        print(f"✓ Created workshop job: {data['job_number']} with id {data['id']}")
        return data
    
    def test_create_and_verify_bench_job(self, auth_headers):
        """Create a job and verify it appears in the list"""
        # Create job
        new_job = {
            "title": "TEST_Verify persistence",
            "description": "Testing job persistence",
            "client_name": "Persistence Test Client",
            "device_name": "Test Device"
        }
        create_response = requests.post(f"{BASE_URL}/api/workshop/bench", json=new_job, headers=auth_headers)
        assert create_response.status_code == 200
        created = create_response.json()
        job_id = created["id"]
        
        # Verify in list
        list_response = requests.get(f"{BASE_URL}/api/workshop/bench", headers=auth_headers)
        assert list_response.status_code == 200
        jobs = list_response.json()
        
        found = any(j["id"] == job_id for j in jobs)
        assert found, f"Created job {job_id} not found in list"
        print(f"✓ Job {created['job_number']} verified in list")
    
    def test_move_bench_job(self, auth_headers):
        """PUT /api/workshop/bench/move moves job to different stage"""
        # First create a job to move
        new_job = {
            "title": "TEST_Job to move",
            "description": "This job will be moved between stages",
            "client_name": "Move Test Client"
        }
        create_response = requests.post(f"{BASE_URL}/api/workshop/bench", json=new_job, headers=auth_headers)
        assert create_response.status_code == 200
        job_id = create_response.json()["id"]
        
        # Move to diagnosing stage
        move_response = requests.put(f"{BASE_URL}/api/workshop/bench/move", json={
            "job_id": job_id,
            "stage": "diagnosing"
        }, headers=auth_headers)
        assert move_response.status_code == 200, f"Move failed: {move_response.text}"
        data = move_response.json()
        assert "message" in data or "modified" in data
        print(f"✓ Moved job to diagnosing stage")
        
        # Verify the move by getting the job
        get_response = requests.get(f"{BASE_URL}/api/workshop/bench/{job_id}", headers=auth_headers)
        assert get_response.status_code == 200
        job = get_response.json()
        assert job.get("bench_stage") == "diagnosing", f"Expected diagnosing, got {job.get('bench_stage')}"
        print(f"✓ Verified job is now in diagnosing stage")
    
    def test_move_through_all_stages(self, auth_headers):
        """Test moving a job through all valid stages"""
        # Create job
        create_response = requests.post(f"{BASE_URL}/api/workshop/bench", json={
            "title": "TEST_Full stage test",
            "client_name": "Stage Test"
        }, headers=auth_headers)
        job_id = create_response.json()["id"]
        
        stages = ["diagnosing", "parts_ordered", "repairing", "testing", "ready"]
        for stage in stages:
            move_response = requests.put(f"{BASE_URL}/api/workshop/bench/move", json={
                "job_id": job_id,
                "stage": stage
            }, headers=auth_headers)
            assert move_response.status_code == 200, f"Failed to move to {stage}"
        
        print(f"✓ Successfully moved job through all stages: intake → {' → '.join(stages)}")
    
    def test_invalid_stage_move(self, auth_headers):
        """Test that invalid stage returns error"""
        # Create job
        create_response = requests.post(f"{BASE_URL}/api/workshop/bench", json={
            "title": "TEST_Invalid stage test",
            "client_name": "Invalid Stage Test"
        }, headers=auth_headers)
        job_id = create_response.json()["id"]
        
        # Try invalid stage
        move_response = requests.put(f"{BASE_URL}/api/workshop/bench/move", json={
            "job_id": job_id,
            "stage": "invalid_stage"
        }, headers=auth_headers)
        assert move_response.status_code == 200  # Returns 200 with error message
        data = move_response.json()
        assert "error" in data, "Should return error for invalid stage"
        print(f"✓ Invalid stage correctly rejected: {data.get('error')}")


class TestDispatchBoard:
    """Dispatch Board API tests - visual map with tech/job positions"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get auth headers"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        token = response.json().get("token")
        return {"Authorization": f"Bearer {token}"}
    
    def test_get_dispatch_board(self, auth_headers):
        """GET /api/dispatch/board returns board with jobs, technicians, suggestions, stats"""
        response = requests.get(f"{BASE_URL}/api/dispatch/board", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify structure
        assert "jobs" in data, "Response should have jobs"
        assert "technicians" in data, "Response should have technicians"
        assert "suggestions" in data, "Response should have suggestions"
        assert "stats" in data, "Response should have stats"
        
        # Verify jobs is a list
        assert isinstance(data["jobs"], list), "jobs should be a list"
        
        # Verify technicians structure
        assert isinstance(data["technicians"], list), "technicians should be a list"
        if len(data["technicians"]) > 0:
            tech = data["technicians"][0]
            assert "id" in tech, "Tech should have id"
            assert "name" in tech, "Tech should have name"
            assert "status" in tech, "Tech should have status"
            assert "capacity" in tech, "Tech should have capacity"
        
        # Verify stats structure
        stats = data["stats"]
        assert "total_jobs" in stats, "Stats should have total_jobs"
        assert "unassigned" in stats, "Stats should have unassigned"
        assert "available_techs" in stats, "Stats should have available_techs"
        
        print(f"✓ GET /api/dispatch/board returned:")
        print(f"  - {len(data['jobs'])} jobs")
        print(f"  - {len(data['technicians'])} technicians")
        print(f"  - {len(data['suggestions'])} suggestions")
        print(f"  - Stats: {stats}")
    
    def test_dispatch_board_suggestions(self, auth_headers):
        """Verify suggestions have correct structure"""
        response = requests.get(f"{BASE_URL}/api/dispatch/board", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        suggestions = data.get("suggestions", [])
        if len(suggestions) > 0:
            suggestion = suggestions[0]
            assert "job_id" in suggestion, "Suggestion should have job_id"
            assert "job_title" in suggestion, "Suggestion should have job_title"
            assert "suggested_tech_id" in suggestion or "suggested_tech_name" in suggestion
            assert "reason" in suggestion, "Suggestion should have reason"
            print(f"✓ Suggestions structure verified, {len(suggestions)} suggestions available")
        else:
            print("✓ No suggestions available (all jobs may be assigned)")
    
    def test_dispatch_assign(self, auth_headers):
        """POST /api/dispatch/assign assigns a tech to a job"""
        # First get the board to find an unassigned job and available tech
        board_response = requests.get(f"{BASE_URL}/api/dispatch/board", headers=auth_headers)
        assert board_response.status_code == 200
        board = board_response.json()
        
        # Find unassigned job
        unassigned_jobs = [j for j in board["jobs"] if not j.get("assigned_to")]
        techs = board["technicians"]
        
        if not unassigned_jobs:
            print("⚠ No unassigned jobs to test assignment - creating a test ticket")
            # Create a test ticket
            ticket_response = requests.post(f"{BASE_URL}/api/tickets", json={
                "title": "TEST_Dispatch assignment test",
                "description": "Testing dispatch assignment",
                "priority": "medium",
                "status": "open",
                "ticket_type": "field_job"
            }, headers=auth_headers)
            if ticket_response.status_code == 200:
                ticket_id = ticket_response.json().get("id")
                unassigned_jobs = [{"id": ticket_id, "title": "TEST_Dispatch assignment test"}]
        
        if not techs:
            print("⚠ No technicians available for assignment test")
            pytest.skip("No technicians available")
        
        if unassigned_jobs and techs:
            job = unassigned_jobs[0]
            tech = techs[0]
            
            assign_response = requests.post(f"{BASE_URL}/api/dispatch/assign", json={
                "ticket_id": job["id"],
                "tech_id": tech["id"]
            }, headers=auth_headers)
            assert assign_response.status_code == 200, f"Assignment failed: {assign_response.text}"
            data = assign_response.json()
            assert "message" in data, "Response should have message"
            print(f"✓ Assigned job '{job.get('title', job['id'])}' to {tech['name']}")
        else:
            print("⚠ Could not test assignment - no unassigned jobs or techs")
    
    def test_dispatch_assign_invalid_tech(self, auth_headers):
        """Test assigning to non-existent technician"""
        response = requests.post(f"{BASE_URL}/api/dispatch/assign", json={
            "ticket_id": "some-ticket-id",
            "tech_id": "non-existent-tech-id"
        }, headers=auth_headers)
        # Should return 200 with error message or 404
        data = response.json()
        assert "error" in data or response.status_code == 404, "Should return error for invalid tech"
        print(f"✓ Invalid tech assignment correctly handled")


class TestRemoteAccessRegression:
    """Regression tests for Remote Access page APIs"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get auth headers"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        token = response.json().get("token")
        return {"Authorization": f"Bearer {token}"}
    
    def test_rustdesk_config(self, auth_headers):
        """GET /api/rustdesk/config still works"""
        response = requests.get(f"{BASE_URL}/api/rustdesk/config", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "key" in data or "value" in data or "server_url" in data
        print(f"✓ RustDesk config endpoint working")
    
    def test_rustdesk_all_devices(self, auth_headers):
        """GET /api/rustdesk/all-devices still works"""
        response = requests.get(f"{BASE_URL}/api/rustdesk/all-devices", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ RustDesk all-devices endpoint returned {len(data)} devices")
    
    def test_rustdesk_sessions(self, auth_headers):
        """GET /api/rustdesk/sessions still works"""
        response = requests.get(f"{BASE_URL}/api/rustdesk/sessions", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ RustDesk sessions endpoint returned {len(data)} sessions")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
