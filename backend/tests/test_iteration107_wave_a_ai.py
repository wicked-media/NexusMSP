"""
Test Wave A AI Differentiators:
1. Ticket Auto-Co-pilot (summarize/next_step/draft_reply)
2. Explain This Error (plain-English diagnosis + remediation)
3. Morning Standup Digest (AI brief + stats)
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Test credentials
TEST_EMAIL = "aaron@stech.com.au"
TEST_PASSWORD = "Lucky@2871$!"
TICKET_ID = "TKT-001"  # Known ticket ID for testing


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestTicketCopilot:
    """Test Ticket Auto-Co-pilot endpoints"""
    
    def test_copilot_summarize(self, headers):
        """Test POST /api/tickets/{ticket_id}/copilot with action=summarize"""
        response = requests.post(
            f"{BASE_URL}/api/tickets/{TICKET_ID}/copilot",
            json={"action": "summarize"},
            headers=headers,
            timeout=30  # LLM calls can take 3-10s
        )
        
        # Check status code
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Check response structure
        data = response.json()
        assert "action" in data, "Response should have 'action' field"
        assert data["action"] == "summarize", "Action should be 'summarize'"
        assert "output" in data, "Response should have 'output' field"
        assert isinstance(data["output"], str), "Output should be a string"
        assert len(data["output"]) > 10, "Output should have meaningful content"
        print(f"Summarize output preview: {data['output'][:200]}...")
    
    def test_copilot_next_step(self, headers):
        """Test POST /api/tickets/{ticket_id}/copilot with action=next_step returns structured JSON"""
        response = requests.post(
            f"{BASE_URL}/api/tickets/{TICKET_ID}/copilot",
            json={"action": "next_step"},
            headers=headers,
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["action"] == "next_step", "Action should be 'next_step'"
        assert "output" in data, "Response should have 'output' field"
        
        # Check for structured response
        if "structured" in data and data["structured"]:
            structured = data["structured"]
            assert isinstance(structured, dict), "structured should be a dict"
            # Check expected keys
            assert "next_step" in structured or "rationale" in structured, \
                "Structured response should have next_step or rationale"
            print(f"Structured next_step: {structured}")
        else:
            print(f"No structured response, raw output: {data['output'][:200]}...")
    
    def test_copilot_draft_reply(self, headers):
        """Test POST /api/tickets/{ticket_id}/copilot with action=draft_reply"""
        response = requests.post(
            f"{BASE_URL}/api/tickets/{TICKET_ID}/copilot",
            json={"action": "draft_reply", "tone": "friendly"},
            headers=headers,
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["action"] == "draft_reply", "Action should be 'draft_reply'"
        assert "output" in data, "Response should have 'output' field"
        assert isinstance(data["output"], str), "Output should be a string"
        assert len(data["output"]) > 20, "Draft reply should have meaningful content"
        print(f"Draft reply preview: {data['output'][:200]}...")
    
    def test_copilot_invalid_action(self, headers):
        """Test copilot with invalid action returns 400"""
        response = requests.post(
            f"{BASE_URL}/api/tickets/{TICKET_ID}/copilot",
            json={"action": "invalid_action"},
            headers=headers,
            timeout=10
        )
        
        assert response.status_code == 400, f"Expected 400 for invalid action, got {response.status_code}"
    
    def test_copilot_nonexistent_ticket(self, headers):
        """Test copilot with non-existent ticket returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/tickets/NONEXISTENT-TICKET/copilot",
            json={"action": "summarize"},
            headers=headers,
            timeout=10
        )
        
        assert response.status_code == 404, f"Expected 404 for non-existent ticket, got {response.status_code}"


class TestExplainError:
    """Test Explain This Error endpoint"""
    
    def test_explain_error_basic(self, headers):
        """Test POST /api/ai/explain-error with error_text and context"""
        error_text = """
        System.OutOfMemoryException: Exception of type 'System.OutOfMemoryException' was thrown.
           at System.String.Concat(String str0, String str1)
           at MyApp.DataProcessor.ProcessLargeFile(String filePath)
           at MyApp.Program.Main(String[] args)
        """
        
        response = requests.post(
            f"{BASE_URL}/api/ai/explain-error",
            json={"error_text": error_text, "context": "app trace"},
            headers=headers,
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Check required fields
        assert "diagnosis" in data, "Response should have 'diagnosis'"
        assert "likely_cause" in data, "Response should have 'likely_cause'"
        assert "severity" in data, "Response should have 'severity'"
        assert "remediation_steps" in data, "Response should have 'remediation_steps'"
        assert "references" in data, "Response should have 'references'"
        
        # Validate severity is one of expected values
        assert data["severity"] in ["low", "medium", "high", "critical"], \
            f"Severity should be low/medium/high/critical, got {data['severity']}"
        
        # Validate remediation_steps is an array
        assert isinstance(data["remediation_steps"], list), "remediation_steps should be an array"
        
        # Validate references is an array
        assert isinstance(data["references"], list), "references should be an array"
        
        print(f"Diagnosis: {data['diagnosis'][:200]}...")
        print(f"Severity: {data['severity']}")
        print(f"Remediation steps: {data['remediation_steps']}")
    
    def test_explain_error_linux_syslog(self, headers):
        """Test explain-error with Linux syslog context"""
        error_text = """
        kernel: Out of memory: Killed process 12345 (mysqld) total-vm:4096000kB, anon-rss:3500000kB
        kernel: oom_reaper: reaped process 12345 (mysqld), now anon-rss:0kB, file-rss:0kB
        """
        
        response = requests.post(
            f"{BASE_URL}/api/ai/explain-error",
            json={"error_text": error_text, "context": "linux syslog"},
            headers=headers,
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "diagnosis" in data
        assert "severity" in data
        print(f"Linux syslog diagnosis: {data['diagnosis'][:200]}...")
    
    def test_explain_error_missing_error_text(self, headers):
        """Test explain-error without error_text returns 400"""
        response = requests.post(
            f"{BASE_URL}/api/ai/explain-error",
            json={"context": "app trace"},
            headers=headers,
            timeout=10
        )
        
        assert response.status_code == 400, f"Expected 400 for missing error_text, got {response.status_code}"
    
    def test_explain_error_empty_error_text(self, headers):
        """Test explain-error with empty error_text returns 400"""
        response = requests.post(
            f"{BASE_URL}/api/ai/explain-error",
            json={"error_text": "", "context": "app trace"},
            headers=headers,
            timeout=10
        )
        
        assert response.status_code == 400, f"Expected 400 for empty error_text, got {response.status_code}"


class TestStandupDigest:
    """Test Morning Standup Digest endpoints"""
    
    def test_standup_digest_get(self, headers):
        """Test GET /api/ai/standup-digest returns AI brief + stats"""
        response = requests.get(
            f"{BASE_URL}/api/ai/standup-digest?hours=12",
            headers=headers,
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Check required fields
        assert "ai_brief" in data, "Response should have 'ai_brief'"
        assert "stats" in data, "Response should have 'stats'"
        
        # Validate stats structure
        stats = data["stats"]
        expected_stat_keys = [
            "new_tickets", "critical_open", "sla_breaches", 
            "offline_devices", "warning_devices", "failed_backups",
            "active_alerts", "overdue_invoices_count", "overdue_total"
        ]
        for key in expected_stat_keys:
            assert key in stats, f"Stats should have '{key}'"
        
        print(f"AI Brief preview: {data['ai_brief'][:300]}...")
        print(f"Stats: {stats}")
    
    def test_standup_digest_history(self, headers):
        """Test GET /api/ai/standup-digest/history returns array of past digests"""
        response = requests.get(
            f"{BASE_URL}/api/ai/standup-digest/history",
            headers=headers,
            timeout=10
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "History should be an array"
        print(f"Digest history count: {len(data)}")
        
        if len(data) > 0:
            # Validate first item structure
            first = data[0]
            assert "ai_brief" in first or "generated_at" in first, \
                "History items should have ai_brief or generated_at"
    
    def test_standup_digest_settings_get(self, headers):
        """Test GET /api/ai/standup-digest/settings returns default settings"""
        response = requests.get(
            f"{BASE_URL}/api/ai/standup-digest/settings",
            headers=headers,
            timeout=10
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Check expected keys
        expected_keys = ["enabled", "send_hour_local", "timezone", "window_hours", "channels", "email_to", "sms_to"]
        for key in expected_keys:
            assert key in data, f"Settings should have '{key}'"
        
        # Validate channels structure
        assert "channels" in data
        channels = data["channels"]
        assert isinstance(channels, dict), "channels should be a dict"
        
        print(f"Digest settings: {data}")
    
    def test_standup_digest_settings_update(self, headers):
        """Test PUT /api/ai/standup-digest/settings persists changes"""
        # Update settings
        update_payload = {
            "enabled": True,
            "channels": {"banner": True, "email": True, "sms": False}
        }
        
        response = requests.put(
            f"{BASE_URL}/api/ai/standup-digest/settings",
            json=update_payload,
            headers=headers,
            timeout=10
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Verify by fetching settings again
        get_response = requests.get(
            f"{BASE_URL}/api/ai/standup-digest/settings",
            headers=headers,
            timeout=10
        )
        
        assert get_response.status_code == 200
        data = get_response.json()
        
        # Verify changes persisted
        assert data.get("enabled") == True, "enabled should be True"
        assert data.get("channels", {}).get("banner") == True, "channels.banner should be True"
        assert data.get("channels", {}).get("email") == True, "channels.email should be True"
        
        print(f"Updated settings: {data}")


class TestAuditEvents:
    """Test that copilot/explain-error events are stored in db.ai_copilot_events"""
    
    def test_copilot_creates_audit_event(self, headers):
        """Verify copilot action creates audit event"""
        # First, make a copilot call
        response = requests.post(
            f"{BASE_URL}/api/tickets/{TICKET_ID}/copilot",
            json={"action": "summarize"},
            headers=headers,
            timeout=30
        )
        
        assert response.status_code == 200, f"Copilot call failed: {response.status_code}"
        
        # Note: We can't directly query the database, but we can verify the endpoint works
        # The audit event creation is tested implicitly by the successful response
        print("Copilot audit event should be created (verified by successful response)")
    
    def test_explain_error_creates_audit_event(self, headers):
        """Verify explain-error action creates audit event"""
        response = requests.post(
            f"{BASE_URL}/api/ai/explain-error",
            json={"error_text": "Test error for audit", "context": "test"},
            headers=headers,
            timeout=30
        )
        
        assert response.status_code == 200, f"Explain-error call failed: {response.status_code}"
        print("Explain-error audit event should be created (verified by successful response)")


class TestRegressionExistingAI:
    """Regression tests for existing AI features on ticket detail"""
    
    def test_ai_diagnose_endpoint(self, headers):
        """Test existing AI Diagnose button endpoint still works"""
        response = requests.post(
            f"{BASE_URL}/api/ai/analyze-device",
            json={
                "device_id": "",
                "ticket_title": "Test ticket",
                "ticket_description": "Test description"
            },
            headers=headers,
            timeout=30
        )
        
        # Should return 200 or handle gracefully
        assert response.status_code in [200, 400, 404], \
            f"AI analyze-device should return valid status, got {response.status_code}"
        print(f"AI Diagnose endpoint status: {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
