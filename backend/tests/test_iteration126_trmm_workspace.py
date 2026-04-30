"""
Iteration 126: TRMM Workspace Endpoints - Scripts, Services, Processes, Software, Updates, Run History

Tests the 10+ new endpoints for the TrmmAgentWorkspace drawer:
- Scripts library: GET /api/trmm/scripts, GET /api/trmm/scripts/{id}, favorites CRUD
- Agent data: services, processes, software, winupdates (graceful 200 when not configured)
- Service actions: start/stop/restart (400 for invalid action)
- Process kill: POST /api/trmm/agents/{id}/processes/{pid}/kill
- Run script: POST /api/trmm/agents/{id}/run-script (persists run record even on failure)
- Run history: GET /api/trmm/agents/{id}/runs, GET /api/trmm/runs/{run_id}
- Regression: existing endpoints still work
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestTrmmWorkspaceEndpoints:
    """Test new TRMM workspace endpoints for iteration 126"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: login and get auth token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("token")
        assert token, "No token in login response"
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        
        # Store test data for cleanup
        self.created_favorites = []
        self.created_runs = []
        
        yield
        
        # Cleanup: remove test favorites
        for script_id in self.created_favorites:
            try:
                self.session.post(f"{BASE_URL}/api/trmm/scripts/{script_id}/favorite", json={"favorite": False})
            except:
                pass
        
        # Cleanup: delete TRMM settings if we created them
        try:
            self.session.delete(f"{BASE_URL}/api/trmm/settings")
        except:
            pass

    # ─────────────────────────── Auth Tests ───────────────────────────
    
    def test_scripts_requires_auth(self):
        """GET /api/trmm/scripts returns 401 without token"""
        resp = requests.get(f"{BASE_URL}/api/trmm/scripts")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
    
    def test_favorites_requires_auth(self):
        """GET /api/trmm/scripts/favorites/mine returns 401 without token"""
        resp = requests.get(f"{BASE_URL}/api/trmm/scripts/favorites/mine")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
    
    def test_services_requires_auth(self):
        """GET /api/trmm/agents/{id}/services returns 401 without token"""
        resp = requests.get(f"{BASE_URL}/api/trmm/agents/test-agent/services")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
    
    def test_processes_requires_auth(self):
        """GET /api/trmm/agents/{id}/processes returns 401 without token"""
        resp = requests.get(f"{BASE_URL}/api/trmm/agents/test-agent/processes")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
    
    def test_software_requires_auth(self):
        """GET /api/trmm/agents/{id}/software returns 401 without token"""
        resp = requests.get(f"{BASE_URL}/api/trmm/agents/test-agent/software")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
    
    def test_winupdates_requires_auth(self):
        """GET /api/trmm/agents/{id}/winupdates returns 401 without token"""
        resp = requests.get(f"{BASE_URL}/api/trmm/agents/test-agent/winupdates")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
    
    def test_runs_requires_auth(self):
        """GET /api/trmm/agents/{id}/runs returns 401 without token"""
        resp = requests.get(f"{BASE_URL}/api/trmm/agents/test-agent/runs")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
    
    def test_run_detail_requires_auth(self):
        """GET /api/trmm/runs/{run_id} returns 401 without token"""
        resp = requests.get(f"{BASE_URL}/api/trmm/runs/trmm-run-test123")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"

    # ─────────────────────────── Scripts (unconfigured) ───────────────────────────
    
    def test_scripts_returns_503_when_not_configured(self):
        """GET /api/trmm/scripts returns 503 when TRMM not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/scripts")
        assert resp.status_code == 503, f"Expected 503, got {resp.status_code}: {resp.text}"
    
    def test_script_detail_returns_503_when_not_configured(self):
        """GET /api/trmm/scripts/{id} returns 503 when TRMM not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/scripts/1")
        assert resp.status_code == 503, f"Expected 503, got {resp.status_code}: {resp.text}"

    # ─────────────────────────── Favorites (standalone, works without TRMM) ───────────────────────────
    
    def test_favorites_mine_returns_empty_list_for_new_user(self):
        """GET /api/trmm/scripts/favorites/mine returns [] for user with no favorites"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/scripts/favorites/mine")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
    
    def test_toggle_favorite_on(self):
        """POST /api/trmm/scripts/{id}/favorite with favorite=true adds favorite"""
        script_id = 999  # Test script ID
        resp = self.session.post(f"{BASE_URL}/api/trmm/scripts/{script_id}/favorite", json={"favorite": True})
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == True, f"Expected success=true, got {data}"
        assert data.get("favorite") == True, f"Expected favorite=true, got {data}"
        self.created_favorites.append(script_id)
        
        # Verify it appears in favorites list
        resp2 = self.session.get(f"{BASE_URL}/api/trmm/scripts/favorites/mine")
        assert resp2.status_code == 200
        favorites = resp2.json()
        assert script_id in favorites, f"Script {script_id} not in favorites: {favorites}"
    
    def test_toggle_favorite_off(self):
        """POST /api/trmm/scripts/{id}/favorite with favorite=false removes favorite"""
        script_id = 998  # Different test script ID
        
        # First add it
        resp1 = self.session.post(f"{BASE_URL}/api/trmm/scripts/{script_id}/favorite", json={"favorite": True})
        assert resp1.status_code == 200
        self.created_favorites.append(script_id)
        
        # Then remove it
        resp2 = self.session.post(f"{BASE_URL}/api/trmm/scripts/{script_id}/favorite", json={"favorite": False})
        assert resp2.status_code == 200, f"Expected 200, got {resp2.status_code}: {resp2.text}"
        data = resp2.json()
        assert data.get("success") == True, f"Expected success=true, got {data}"
        assert data.get("favorite") == False, f"Expected favorite=false, got {data}"
        
        # Verify it's removed from favorites list
        resp3 = self.session.get(f"{BASE_URL}/api/trmm/scripts/favorites/mine")
        assert resp3.status_code == 200
        favorites = resp3.json()
        assert script_id not in favorites, f"Script {script_id} should not be in favorites: {favorites}"

    # ─────────────────────────── Services (graceful 200 when not configured) ───────────────────────────
    
    def test_services_returns_200_graceful_when_not_configured(self):
        """GET /api/trmm/agents/{id}/services returns 200 with {success:false, services:[]} when not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/agents/test-agent-123/services")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == False, f"Expected success=false, got {data}"
        assert "services" in data, f"Expected 'services' key in response: {data}"
        assert isinstance(data["services"], list), f"Expected services to be list: {data}"
        assert "message" in data or "Tactical RMM not configured" in str(data), f"Expected message about not configured: {data}"

    # ─────────────────────────── Processes (graceful 200 when not configured) ───────────────────────────
    
    def test_processes_returns_200_graceful_when_not_configured(self):
        """GET /api/trmm/agents/{id}/processes returns 200 with {success:false, processes:[]} when not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/agents/test-agent-123/processes")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == False, f"Expected success=false, got {data}"
        assert "processes" in data, f"Expected 'processes' key in response: {data}"
        assert isinstance(data["processes"], list), f"Expected processes to be list: {data}"

    # ─────────────────────────── Software (graceful 200 when not configured) ───────────────────────────
    
    def test_software_returns_200_graceful_when_not_configured(self):
        """GET /api/trmm/agents/{id}/software returns 200 with {success:false, software:[]} when not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/agents/test-agent-123/software")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == False, f"Expected success=false, got {data}"
        assert "software" in data, f"Expected 'software' key in response: {data}"
        assert isinstance(data["software"], list), f"Expected software to be list: {data}"

    # ─────────────────────────── Windows Updates (graceful 200 when not configured) ───────────────────────────
    
    def test_winupdates_returns_200_graceful_when_not_configured(self):
        """GET /api/trmm/agents/{id}/winupdates returns 200 with {success:false, updates:[]} when not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/agents/test-agent-123/winupdates")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == False, f"Expected success=false, got {data}"
        assert "updates" in data, f"Expected 'updates' key in response: {data}"
        assert isinstance(data["updates"], list), f"Expected updates to be list: {data}"

    # ─────────────────────────── Service Actions ───────────────────────────
    
    def test_service_action_rejects_invalid_action(self):
        """POST /api/trmm/agents/{id}/services/{name}/{action} returns 400 for invalid action"""
        resp = self.session.post(f"{BASE_URL}/api/trmm/agents/test-agent/services/TestService/invalid_action")
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
    
    def test_service_action_accepts_start(self):
        """POST /api/trmm/agents/{id}/services/{name}/start returns success:false when not configured (not 500)"""
        resp = self.session.post(f"{BASE_URL}/api/trmm/agents/test-agent/services/TestService/start")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == False, f"Expected success=false when not configured: {data}"
    
    def test_service_action_accepts_stop(self):
        """POST /api/trmm/agents/{id}/services/{name}/stop returns success:false when not configured (not 500)"""
        resp = self.session.post(f"{BASE_URL}/api/trmm/agents/test-agent/services/TestService/stop")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == False, f"Expected success=false when not configured: {data}"
    
    def test_service_action_accepts_restart(self):
        """POST /api/trmm/agents/{id}/services/{name}/restart returns success:false when not configured (not 500)"""
        resp = self.session.post(f"{BASE_URL}/api/trmm/agents/test-agent/services/TestService/restart")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == False, f"Expected success=false when not configured: {data}"

    # ─────────────────────────── Process Kill ───────────────────────────
    
    def test_kill_process_returns_success_false_when_not_configured(self):
        """POST /api/trmm/agents/{id}/processes/{pid}/kill returns success:false when not configured (not 500)"""
        resp = self.session.post(f"{BASE_URL}/api/trmm/agents/test-agent/processes/1234/kill")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == False, f"Expected success=false when not configured: {data}"

    # ─────────────────────────── Run Script (persists run record) ───────────────────────────
    
    def test_run_script_creates_run_record_even_when_trmm_unreachable(self):
        """POST /api/trmm/agents/{id}/run-script creates a run record in db even when TRMM unreachable"""
        agent_id = "test-agent-run-script"
        resp = self.session.post(f"{BASE_URL}/api/trmm/agents/{agent_id}/run-script", json={
            "command": "echo hello",
            "shell": "powershell",
            "label": "TEST_run_script_test"
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        
        # Should return success:false but with a run_id
        assert data.get("success") == False, f"Expected success=false when TRMM not configured: {data}"
        assert "run_id" in data, f"Expected run_id in response: {data}"
        run_id = data["run_id"]
        assert run_id.startswith("trmm-run-"), f"run_id should start with 'trmm-run-': {run_id}"
        self.created_runs.append(run_id)
        
        # Verify the run was persisted
        resp2 = self.session.get(f"{BASE_URL}/api/trmm/runs/{run_id}")
        assert resp2.status_code == 200, f"Expected 200 for run detail, got {resp2.status_code}: {resp2.text}"
        run_doc = resp2.json()
        assert run_doc.get("id") == run_id, f"Run doc id mismatch: {run_doc}"
        assert run_doc.get("agent_id") == agent_id, f"Run doc agent_id mismatch: {run_doc}"

    # ─────────────────────────── Run History ───────────────────────────
    
    def test_agent_runs_returns_persisted_run(self):
        """GET /api/trmm/agents/{id}/runs returns the persisted run record after run-script"""
        agent_id = "test-agent-runs-history"
        
        # Create a run
        resp1 = self.session.post(f"{BASE_URL}/api/trmm/agents/{agent_id}/run-script", json={
            "command": "dir",
            "shell": "cmd",
            "label": "TEST_runs_history_test"
        })
        assert resp1.status_code == 200
        run_id = resp1.json().get("run_id")
        self.created_runs.append(run_id)
        
        # Get runs for this agent
        resp2 = self.session.get(f"{BASE_URL}/api/trmm/agents/{agent_id}/runs")
        assert resp2.status_code == 200, f"Expected 200, got {resp2.status_code}: {resp2.text}"
        runs = resp2.json()
        assert isinstance(runs, list), f"Expected list, got {type(runs)}"
        assert len(runs) >= 1, f"Expected at least 1 run, got {len(runs)}"
        
        # Find our run
        our_run = next((r for r in runs if r.get("id") == run_id), None)
        assert our_run is not None, f"Our run {run_id} not found in runs: {runs}"
    
    def test_run_detail_returns_single_run(self):
        """GET /api/trmm/runs/{run_id} returns the single run doc"""
        agent_id = "test-agent-run-detail"
        
        # Create a run
        resp1 = self.session.post(f"{BASE_URL}/api/trmm/agents/{agent_id}/run-script", json={
            "command": "whoami",
            "shell": "powershell"
        })
        assert resp1.status_code == 200
        run_id = resp1.json().get("run_id")
        self.created_runs.append(run_id)
        
        # Get run detail
        resp2 = self.session.get(f"{BASE_URL}/api/trmm/runs/{run_id}")
        assert resp2.status_code == 200, f"Expected 200, got {resp2.status_code}: {resp2.text}"
        run_doc = resp2.json()
        assert run_doc.get("id") == run_id
        assert run_doc.get("agent_id") == agent_id
        assert "started_at" in run_doc
        assert "status" in run_doc
    
    def test_run_detail_returns_404_for_bogus_id(self):
        """GET /api/trmm/runs/bogus returns 404"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/runs/bogus-nonexistent-id")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"

    # ─────────────────────────── Regression: Existing Endpoints ───────────────────────────
    
    def test_regression_trmm_status(self):
        """GET /api/trmm/status still works"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/status")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "configured" in data, f"Expected 'configured' in response: {data}"
    
    def test_regression_trmm_summary(self):
        """GET /api/trmm/summary still works"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/summary")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "configured" in data or "stats" in data, f"Expected summary shape: {data}"
    
    def test_regression_trmm_test(self):
        """GET /api/trmm/test still works"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/test")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "success" in data, f"Expected 'success' in response: {data}"
    
    def test_regression_trmm_linked_devices(self):
        """GET /api/trmm/linked-devices still works"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/linked-devices")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
    
    def test_regression_trmm_actions_log(self):
        """GET /api/trmm/actions/log still works"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/actions/log")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"

    # ─────────────────────────── Configured TRMM (dummy settings) ───────────────────────────
    
    def test_scripts_with_dummy_trmm_returns_graceful_error(self):
        """After configuring dummy TRMM, /api/trmm/scripts returns 200 or 502 graceful error, NOT 500"""
        # Configure dummy TRMM
        resp1 = self.session.post(f"{BASE_URL}/api/trmm/settings", json={
            "base_url": "https://dummy-trmm.example.com",
            "api_key": "dummy-api-key-12345",
            "verify_tls": False
        })
        assert resp1.status_code == 200, f"Failed to save dummy settings: {resp1.text}"
        
        # Now try to get scripts - should get graceful error (502 or similar), not 500
        resp2 = self.session.get(f"{BASE_URL}/api/trmm/scripts")
        # Accept 502 (TRMM request failed) or 200 with error shape, but NOT 500
        assert resp2.status_code != 500, f"Got 500 error, expected graceful handling: {resp2.text}"
        assert resp2.status_code in [200, 502, 503], f"Unexpected status {resp2.status_code}: {resp2.text}"
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/trmm/settings")


class TestTrmmAutoLink:
    """Test auto-link endpoint regression"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200
        token = login_resp.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        yield
    
    def test_auto_link_returns_503_when_not_configured(self):
        """POST /api/trmm/auto-link returns 503 when TRMM not configured"""
        resp = self.session.post(f"{BASE_URL}/api/trmm/auto-link", json={"dry_run": True})
        assert resp.status_code == 503, f"Expected 503, got {resp.status_code}: {resp.text}"
