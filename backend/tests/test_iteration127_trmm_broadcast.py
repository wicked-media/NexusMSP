"""
Iteration 127: TRMM Multi-Agent Broadcast Endpoints

Tests the new broadcast feature for running commands/scripts across multiple TRMM agents:
- POST /api/trmm/broadcast - kick off concurrent run across many agents
- GET /api/trmm/broadcasts/{id} - poll for live progress
- GET /api/trmm/broadcasts - list recent broadcasts

Test scenarios:
- 503 when TRMM not configured
- 400 when agent_ids missing
- 400 when both command AND script_id missing
- 400 when agent_ids.length > 200
- Valid payload returns {success:true, broadcast_id:'bcast-...', total:N}
- Broadcast doc persisted with status='running', creates trmm_runs per agent
- GET broadcasts/{id} returns full doc with agents array
- GET broadcasts/{id} returns 404 for bogus id
- GET broadcasts returns list with default limit=20
- After ~5s with fake TRMM, status becomes 'complete', agent sub-statuses are 'error'
- Concurrency clamping: concurrency=100 is silently clamped to 20
- Auth required (401 without token)
- Regression: existing TRMM endpoints still work
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestTrmmBroadcastAuth:
    """Test auth requirements for broadcast endpoints"""
    
    def test_broadcast_requires_auth(self):
        """POST /api/trmm/broadcast returns 401 without token"""
        resp = requests.post(f"{BASE_URL}/api/trmm/broadcast", json={
            "agent_ids": ["a1", "a2"],
            "command": "echo test"
        })
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
    
    def test_broadcast_status_requires_auth(self):
        """GET /api/trmm/broadcasts/{id} returns 401 without token"""
        resp = requests.get(f"{BASE_URL}/api/trmm/broadcasts/bcast-test123")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
    
    def test_broadcasts_list_requires_auth(self):
        """GET /api/trmm/broadcasts returns 401 without token"""
        resp = requests.get(f"{BASE_URL}/api/trmm/broadcasts")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"


class TestTrmmBroadcastValidation:
    """Test validation for POST /api/trmm/broadcast"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: login and get auth token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("token")
        assert token, "No token in login response"
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        
        # Ensure TRMM is not configured for validation tests
        self.session.delete(f"{BASE_URL}/api/trmm/settings")
        yield
    
    def test_broadcast_returns_503_when_trmm_not_configured(self):
        """POST /api/trmm/broadcast returns 503 when TRMM not configured"""
        resp = self.session.post(f"{BASE_URL}/api/trmm/broadcast", json={
            "agent_ids": ["test-a1", "test-a2"],
            "command": "echo hello"
        })
        assert resp.status_code == 503, f"Expected 503, got {resp.status_code}: {resp.text}"
        assert "not configured" in resp.text.lower(), f"Expected 'not configured' in error: {resp.text}"
    
    def test_broadcast_returns_400_when_agent_ids_missing(self):
        """POST /api/trmm/broadcast returns 400 when agent_ids missing"""
        # First configure TRMM so we get past the 503 check
        self.session.post(f"{BASE_URL}/api/trmm/settings", json={
            "base_url": "https://dummy-trmm.example.com",
            "api_key": "dummy-api-key-12345",
            "verify_tls": False
        })
        
        # Test with no agent_ids
        resp = self.session.post(f"{BASE_URL}/api/trmm/broadcast", json={
            "command": "echo hello"
        })
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
        assert "agent_ids" in resp.text.lower(), f"Expected 'agent_ids' in error: {resp.text}"
        
        # Test with empty agent_ids
        resp2 = self.session.post(f"{BASE_URL}/api/trmm/broadcast", json={
            "agent_ids": [],
            "command": "echo hello"
        })
        assert resp2.status_code == 400, f"Expected 400 for empty agent_ids, got {resp2.status_code}: {resp2.text}"
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/trmm/settings")
    
    def test_broadcast_returns_400_when_command_and_script_id_missing(self):
        """POST /api/trmm/broadcast returns 400 when both command AND script_id missing"""
        # Configure TRMM
        self.session.post(f"{BASE_URL}/api/trmm/settings", json={
            "base_url": "https://dummy-trmm.example.com",
            "api_key": "dummy-api-key-12345",
            "verify_tls": False
        })
        
        resp = self.session.post(f"{BASE_URL}/api/trmm/broadcast", json={
            "agent_ids": ["test-a1", "test-a2"]
            # No command, no script_id
        })
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
        assert "command" in resp.text.lower() or "script" in resp.text.lower(), f"Expected error about command/script: {resp.text}"
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/trmm/settings")
    
    def test_broadcast_returns_400_when_too_many_agents(self):
        """POST /api/trmm/broadcast returns 400 when agent_ids.length > 200"""
        # Configure TRMM
        self.session.post(f"{BASE_URL}/api/trmm/settings", json={
            "base_url": "https://dummy-trmm.example.com",
            "api_key": "dummy-api-key-12345",
            "verify_tls": False
        })
        
        # Create 201 agent IDs
        agent_ids = [f"test-agent-{i}" for i in range(201)]
        
        resp = self.session.post(f"{BASE_URL}/api/trmm/broadcast", json={
            "agent_ids": agent_ids,
            "command": "echo hello"
        })
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
        assert "200" in resp.text or "too many" in resp.text.lower() or "max" in resp.text.lower(), f"Expected error about max agents: {resp.text}"
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/trmm/settings")


class TestTrmmBroadcastExecution:
    """Test broadcast execution and polling"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: login, configure dummy TRMM"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("token")
        assert token, "No token in login response"
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        
        # Configure dummy TRMM for execution tests
        self.session.post(f"{BASE_URL}/api/trmm/settings", json={
            "base_url": "https://dummy-trmm.example.com",
            "api_key": "dummy-api-key-12345",
            "verify_tls": False
        })
        
        self.created_broadcast_ids = []
        yield
        
        # Cleanup: delete TRMM settings
        self.session.delete(f"{BASE_URL}/api/trmm/settings")
    
    def test_broadcast_with_valid_payload_returns_success(self):
        """POST /api/trmm/broadcast with valid payload returns {success:true, broadcast_id:'bcast-...', total:N}"""
        agent_ids = ["test-a1", "test-a2", "test-a3"]
        resp = self.session.post(f"{BASE_URL}/api/trmm/broadcast", json={
            "agent_ids": agent_ids,
            "command": "echo hello",
            "shell": "powershell",
            "label": "TEST_broadcast_valid"
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert data.get("success") == True, f"Expected success=true: {data}"
        assert "broadcast_id" in data, f"Expected broadcast_id in response: {data}"
        assert data["broadcast_id"].startswith("bcast-"), f"broadcast_id should start with 'bcast-': {data}"
        assert data.get("total") == len(agent_ids), f"Expected total={len(agent_ids)}: {data}"
        
        self.created_broadcast_ids.append(data["broadcast_id"])
    
    def test_broadcast_with_script_id_returns_success(self):
        """POST /api/trmm/broadcast with script_id (instead of command) returns success"""
        agent_ids = ["test-b1", "test-b2"]
        resp = self.session.post(f"{BASE_URL}/api/trmm/broadcast", json={
            "agent_ids": agent_ids,
            "script_id": 123,
            "args": ["arg1", "arg2"],
            "label": "TEST_broadcast_script"
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert data.get("success") == True, f"Expected success=true: {data}"
        assert "broadcast_id" in data, f"Expected broadcast_id: {data}"
        
        self.created_broadcast_ids.append(data["broadcast_id"])
    
    def test_broadcast_status_returns_full_doc_with_agents_array(self):
        """GET /api/trmm/broadcasts/{id} returns full doc with agents flattened array"""
        agent_ids = ["test-c1", "test-c2", "test-c3"]
        
        # Create broadcast
        resp1 = self.session.post(f"{BASE_URL}/api/trmm/broadcast", json={
            "agent_ids": agent_ids,
            "command": "dir",
            "label": "TEST_broadcast_status"
        })
        assert resp1.status_code == 200
        broadcast_id = resp1.json()["broadcast_id"]
        self.created_broadcast_ids.append(broadcast_id)
        
        # Get status
        resp2 = self.session.get(f"{BASE_URL}/api/trmm/broadcasts/{broadcast_id}")
        assert resp2.status_code == 200, f"Expected 200, got {resp2.status_code}: {resp2.text}"
        
        data = resp2.json()
        assert data.get("id") == broadcast_id, f"Expected id={broadcast_id}: {data}"
        assert "agents" in data, f"Expected 'agents' array in response: {data}"
        assert isinstance(data["agents"], list), f"Expected agents to be list: {data}"
        assert len(data["agents"]) == len(agent_ids), f"Expected {len(agent_ids)} agents: {data}"
        
        # Verify agents array matches agent_ids order
        for i, aid in enumerate(agent_ids):
            assert data["agents"][i].get("agent_id") == aid, f"Agent {i} mismatch: expected {aid}, got {data['agents'][i]}"
        
        # Verify other fields
        assert "status" in data, f"Expected 'status' field: {data}"
        assert "total" in data, f"Expected 'total' field: {data}"
        assert "completed" in data, f"Expected 'completed' field: {data}"
    
    def test_broadcast_status_returns_404_for_bogus_id(self):
        """GET /api/trmm/broadcasts/{id} returns 404 for bogus id"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/broadcasts/bcast-nonexistent-bogus")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
    
    def test_broadcasts_list_returns_recent_broadcasts(self):
        """GET /api/trmm/broadcasts returns list with default limit=20"""
        # Create a broadcast first
        resp1 = self.session.post(f"{BASE_URL}/api/trmm/broadcast", json={
            "agent_ids": ["test-d1"],
            "command": "whoami",
            "label": "TEST_broadcast_list"
        })
        assert resp1.status_code == 200
        broadcast_id = resp1.json()["broadcast_id"]
        self.created_broadcast_ids.append(broadcast_id)
        
        # Get list
        resp2 = self.session.get(f"{BASE_URL}/api/trmm/broadcasts")
        assert resp2.status_code == 200, f"Expected 200, got {resp2.status_code}: {resp2.text}"
        
        data = resp2.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Should find our broadcast
        our_broadcast = next((b for b in data if b.get("id") == broadcast_id), None)
        assert our_broadcast is not None, f"Our broadcast {broadcast_id} not found in list: {data[:5]}"
        
        # agent_map should be excluded from list response (for performance)
        assert "agent_map" not in our_broadcast, f"agent_map should be excluded from list: {our_broadcast}"
    
    def test_broadcasts_list_respects_limit(self):
        """GET /api/trmm/broadcasts?limit=5 respects limit parameter"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/broadcasts?limit=5")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) <= 5, f"Expected at most 5 items, got {len(data)}"
    
    def test_broadcast_completes_with_error_status_for_fake_trmm(self):
        """After ~5s with fake TRMM URL, broadcast.status becomes 'complete', agent sub-statuses are 'error'"""
        agent_ids = ["test-e1", "test-e2"]
        
        # Create broadcast
        resp1 = self.session.post(f"{BASE_URL}/api/trmm/broadcast", json={
            "agent_ids": agent_ids,
            "command": "echo test",
            "label": "TEST_broadcast_complete"
        })
        assert resp1.status_code == 200
        broadcast_id = resp1.json()["broadcast_id"]
        self.created_broadcast_ids.append(broadcast_id)
        
        # Poll for completion (max 10 seconds)
        max_wait = 10
        poll_interval = 1
        elapsed = 0
        final_status = None
        
        while elapsed < max_wait:
            time.sleep(poll_interval)
            elapsed += poll_interval
            
            resp2 = self.session.get(f"{BASE_URL}/api/trmm/broadcasts/{broadcast_id}")
            assert resp2.status_code == 200
            data = resp2.json()
            
            if data.get("status") == "complete":
                final_status = data
                break
        
        assert final_status is not None, f"Broadcast did not complete within {max_wait}s"
        assert final_status.get("status") == "complete", f"Expected status='complete': {final_status}"
        
        # Verify all agents have 'error' status (since fake TRMM URL)
        agents = final_status.get("agents", [])
        assert len(agents) == len(agent_ids), f"Expected {len(agent_ids)} agents: {agents}"
        
        for agent in agents:
            assert agent.get("status") == "error", f"Expected agent status='error' (graceful, not 500): {agent}"
            assert "run_id" in agent, f"Expected run_id in agent result: {agent}"
    
    def test_broadcast_creates_trmm_runs_per_agent(self):
        """Broadcast creates one db.trmm_runs doc per agent with broadcast_id link"""
        agent_ids = ["test-f1", "test-f2"]
        
        # Create broadcast
        resp1 = self.session.post(f"{BASE_URL}/api/trmm/broadcast", json={
            "agent_ids": agent_ids,
            "command": "hostname",
            "label": "TEST_broadcast_runs"
        })
        assert resp1.status_code == 200
        broadcast_id = resp1.json()["broadcast_id"]
        self.created_broadcast_ids.append(broadcast_id)
        
        # Wait for completion
        time.sleep(5)
        
        # Get broadcast status to get run_ids
        resp2 = self.session.get(f"{BASE_URL}/api/trmm/broadcasts/{broadcast_id}")
        assert resp2.status_code == 200
        data = resp2.json()
        
        # Verify each agent has a run_id
        for agent in data.get("agents", []):
            run_id = agent.get("run_id")
            assert run_id is not None, f"Expected run_id for agent {agent.get('agent_id')}: {agent}"
            
            # Verify run doc exists and has broadcast_id
            resp3 = self.session.get(f"{BASE_URL}/api/trmm/runs/{run_id}")
            assert resp3.status_code == 200, f"Run {run_id} not found: {resp3.text}"
            run_doc = resp3.json()
            assert run_doc.get("broadcast_id") == broadcast_id, f"Run doc should have broadcast_id: {run_doc}"
    
    def test_concurrency_clamped_to_20(self):
        """Request with concurrency=100 is silently clamped to 20"""
        agent_ids = ["test-g1", "test-g2"]
        
        resp = self.session.post(f"{BASE_URL}/api/trmm/broadcast", json={
            "agent_ids": agent_ids,
            "command": "echo test",
            "concurrency": 100,  # Should be clamped to 20
            "label": "TEST_broadcast_concurrency"
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        broadcast_id = resp.json()["broadcast_id"]
        self.created_broadcast_ids.append(broadcast_id)
        
        # Verify concurrency was clamped
        resp2 = self.session.get(f"{BASE_URL}/api/trmm/broadcasts/{broadcast_id}")
        assert resp2.status_code == 200
        data = resp2.json()
        assert data.get("concurrency") == 20, f"Expected concurrency=20 (clamped from 100): {data}"


class TestTrmmBroadcastRegression:
    """Regression tests for existing TRMM endpoints from iterations 122-126"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: login"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        
        # Ensure TRMM is not configured for regression tests
        self.session.delete(f"{BASE_URL}/api/trmm/settings")
        yield
    
    # ─────────────────────────── Iteration 122: Basic TRMM ───────────────────────────
    
    def test_regression_trmm_settings_get(self):
        """GET /api/trmm/settings returns expected shape"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/settings")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "configured" in data, f"Expected 'configured' field: {data}"
    
    def test_regression_trmm_status(self):
        """GET /api/trmm/status returns expected shape"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/status")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "configured" in data, f"Expected 'configured' field: {data}"
    
    def test_regression_trmm_summary(self):
        """GET /api/trmm/summary returns expected shape"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/summary")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "configured" in data or "stats" in data, f"Expected summary shape: {data}"
    
    def test_regression_trmm_test(self):
        """GET /api/trmm/test returns expected shape"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/test")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "success" in data, f"Expected 'success' field: {data}"
    
    def test_regression_trmm_agents_503_when_not_configured(self):
        """GET /api/trmm/agents returns 503 when not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/agents")
        assert resp.status_code == 503, f"Expected 503, got {resp.status_code}: {resp.text}"
    
    def test_regression_trmm_clients_503_when_not_configured(self):
        """GET /api/trmm/clients returns 503 when not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/clients")
        assert resp.status_code == 503, f"Expected 503, got {resp.status_code}: {resp.text}"
    
    # ─────────────────────────── Iteration 123: Auto-link ───────────────────────────
    
    def test_regression_auto_link_503_when_not_configured(self):
        """POST /api/trmm/auto-link returns 503 when not configured"""
        resp = self.session.post(f"{BASE_URL}/api/trmm/auto-link", json={"dry_run": True})
        assert resp.status_code == 503, f"Expected 503, got {resp.status_code}: {resp.text}"
    
    def test_regression_linked_devices(self):
        """GET /api/trmm/linked-devices returns list"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/linked-devices")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
    
    # ─────────────────────────── Iteration 124: Remote providers ───────────────────────────
    
    def test_regression_remote_url_graceful_when_not_configured(self):
        """GET /api/trmm/agents/{id}/remote-url returns 200 with success=false when not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/agents/test-agent/remote-url")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == False, f"Expected success=false: {data}"
    
    # ─────────────────────────── Iteration 125: Inline remote ───────────────────────────
    
    def test_regression_remote_providers_active(self):
        """GET /api/remote-providers/active returns list"""
        resp = self.session.get(f"{BASE_URL}/api/remote-providers/active")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
    
    # ─────────────────────────── Iteration 126: Workspace ───────────────────────────
    
    def test_regression_scripts_503_when_not_configured(self):
        """GET /api/trmm/scripts returns 503 when not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/scripts")
        assert resp.status_code == 503, f"Expected 503, got {resp.status_code}: {resp.text}"
    
    def test_regression_favorites_mine(self):
        """GET /api/trmm/scripts/favorites/mine returns list (works without TRMM)"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/scripts/favorites/mine")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
    
    def test_regression_services_graceful_when_not_configured(self):
        """GET /api/trmm/agents/{id}/services returns 200 with success=false when not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/agents/test-agent/services")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == False, f"Expected success=false: {data}"
    
    def test_regression_processes_graceful_when_not_configured(self):
        """GET /api/trmm/agents/{id}/processes returns 200 with success=false when not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/agents/test-agent/processes")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == False, f"Expected success=false: {data}"
    
    def test_regression_software_graceful_when_not_configured(self):
        """GET /api/trmm/agents/{id}/software returns 200 with success=false when not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/agents/test-agent/software")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == False, f"Expected success=false: {data}"
    
    def test_regression_winupdates_graceful_when_not_configured(self):
        """GET /api/trmm/agents/{id}/winupdates returns 200 with success=false when not configured"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/agents/test-agent/winupdates")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") == False, f"Expected success=false: {data}"
    
    def test_regression_run_detail_404_for_bogus(self):
        """GET /api/trmm/runs/bogus returns 404"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/runs/bogus-nonexistent")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
    
    def test_regression_actions_log(self):
        """GET /api/trmm/actions/log returns list"""
        resp = self.session.get(f"{BASE_URL}/api/trmm/actions/log")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
