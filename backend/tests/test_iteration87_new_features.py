"""
Iteration 87 - Testing New Features:
1. Workflow Automation Builder - CRUD, toggle, test execution
2. Device Terminal - Sessions, command execution
3. Stripe Billing Portal - Client billing, portal links, stats
4. Scheduled Reports - CRUD, toggle, send-now
5. AI Ticket Triage - GPT-powered ticket analysis
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json().get("token")

@pytest.fixture(scope="module")
def headers(auth_token):
    """Auth headers for requests"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============== WORKFLOW AUTOMATION TESTS ==============

class TestWorkflowAutomation:
    """Workflow Automation Builder API tests"""
    
    created_workflow_id = None
    
    def test_get_workflow_triggers(self, headers):
        """GET /api/workflows/triggers - Should return 12 trigger types"""
        response = requests.get(f"{BASE_URL}/api/workflows/triggers", headers=headers)
        assert response.status_code == 200
        triggers = response.json()
        assert isinstance(triggers, list)
        assert len(triggers) == 12, f"Expected 12 triggers, got {len(triggers)}"
        # Verify trigger structure
        trigger_ids = [t["id"] for t in triggers]
        assert "ticket_created" in trigger_ids
        assert "device_offline" in trigger_ids
        assert "schedule" in trigger_ids
        print(f"✓ Got {len(triggers)} workflow triggers")
    
    def test_get_workflow_actions(self, headers):
        """GET /api/workflows/actions - Should return 14 action types"""
        response = requests.get(f"{BASE_URL}/api/workflows/actions", headers=headers)
        assert response.status_code == 200
        actions = response.json()
        assert isinstance(actions, list)
        assert len(actions) == 14, f"Expected 14 actions, got {len(actions)}"
        # Verify action structure
        action_ids = [a["id"] for a in actions]
        assert "send_email" in action_ids
        assert "create_ticket" in action_ids
        assert "run_script" in action_ids
        print(f"✓ Got {len(actions)} workflow actions")
    
    def test_create_workflow(self, headers):
        """POST /api/workflows - Create a new workflow"""
        payload = {
            "name": "TEST_Auto-Escalate Critical Tickets",
            "description": "Automatically escalate critical tickets after 30 minutes",
            "trigger": {"type": "ticket_created", "config": {"priority": "critical"}},
            "actions": [
                {"type": "wait", "config": {"duration_minutes": "30"}},
                {"type": "escalate", "config": {"escalation_level": "2", "notify": "true"}}
            ]
        }
        response = requests.post(f"{BASE_URL}/api/workflows", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["name"] == payload["name"]
        assert data["enabled"] == False  # Default disabled
        TestWorkflowAutomation.created_workflow_id = data["id"]
        print(f"✓ Created workflow: {data['id']}")
    
    def test_get_workflows(self, headers):
        """GET /api/workflows - List all workflows"""
        response = requests.get(f"{BASE_URL}/api/workflows", headers=headers)
        assert response.status_code == 200
        workflows = response.json()
        assert isinstance(workflows, list)
        # Verify our created workflow exists
        if TestWorkflowAutomation.created_workflow_id:
            wf_ids = [w["id"] for w in workflows]
            assert TestWorkflowAutomation.created_workflow_id in wf_ids
        print(f"✓ Got {len(workflows)} workflows")
    
    def test_update_workflow(self, headers):
        """PUT /api/workflows/{id} - Update a workflow"""
        if not TestWorkflowAutomation.created_workflow_id:
            pytest.skip("No workflow created")
        payload = {
            "name": "TEST_Auto-Escalate Critical Tickets (Updated)",
            "description": "Updated description"
        }
        response = requests.put(
            f"{BASE_URL}/api/workflows/{TestWorkflowAutomation.created_workflow_id}",
            json=payload, headers=headers
        )
        assert response.status_code == 200
        # Verify update
        get_resp = requests.get(
            f"{BASE_URL}/api/workflows/{TestWorkflowAutomation.created_workflow_id}",
            headers=headers
        )
        assert get_resp.status_code == 200
        assert "Updated" in get_resp.json()["name"]
        print(f"✓ Updated workflow")
    
    def test_toggle_workflow(self, headers):
        """POST /api/workflows/{id}/toggle - Enable/disable workflow"""
        if not TestWorkflowAutomation.created_workflow_id:
            pytest.skip("No workflow created")
        response = requests.post(
            f"{BASE_URL}/api/workflows/{TestWorkflowAutomation.created_workflow_id}/toggle",
            json={}, headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "enabled" in data
        assert data["enabled"] == True  # Should toggle to enabled
        print(f"✓ Toggled workflow to enabled={data['enabled']}")
    
    def test_test_workflow(self, headers):
        """POST /api/workflows/{id}/test - Run test execution"""
        if not TestWorkflowAutomation.created_workflow_id:
            pytest.skip("No workflow created")
        response = requests.post(
            f"{BASE_URL}/api/workflows/{TestWorkflowAutomation.created_workflow_id}/test",
            json={"test_data": {"ticket_id": "TKT-001"}}, headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "test_completed"
        assert "results" in data
        assert "log_id" in data
        print(f"✓ Test execution completed with {len(data['results'])} action results")
    
    def test_get_workflow_stats(self, headers):
        """GET /api/workflows/stats/overview - Get workflow statistics"""
        response = requests.get(f"{BASE_URL}/api/workflows/stats/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "active" in data
        assert "total_executions" in data
        print(f"✓ Stats: {data['total']} total, {data['active']} active, {data['total_executions']} executions")
    
    def test_delete_workflow(self, headers):
        """DELETE /api/workflows/{id} - Delete workflow"""
        if not TestWorkflowAutomation.created_workflow_id:
            pytest.skip("No workflow created")
        response = requests.delete(
            f"{BASE_URL}/api/workflows/{TestWorkflowAutomation.created_workflow_id}",
            headers=headers
        )
        assert response.status_code == 200
        # Verify deletion
        get_resp = requests.get(
            f"{BASE_URL}/api/workflows/{TestWorkflowAutomation.created_workflow_id}",
            headers=headers
        )
        assert get_resp.status_code == 404
        print(f"✓ Deleted workflow")


# ============== DEVICE TERMINAL TESTS ==============

class TestDeviceTerminal:
    """Device Terminal API tests"""
    
    created_session_id = None
    test_device_id = "dev-001"  # Known online device
    
    def test_get_terminal_sessions(self, headers):
        """GET /api/device-terminal/sessions - List sessions"""
        response = requests.get(f"{BASE_URL}/api/device-terminal/sessions", headers=headers)
        assert response.status_code == 200
        sessions = response.json()
        assert isinstance(sessions, list)
        print(f"✓ Got {len(sessions)} terminal sessions")
    
    def test_create_terminal_session(self, headers):
        """POST /api/device-terminal/sessions - Create session for online device"""
        payload = {
            "device_id": self.test_device_id,
            "session_type": "powershell"
        }
        response = requests.post(f"{BASE_URL}/api/device-terminal/sessions", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["device_id"] == self.test_device_id
        assert data["status"] == "active"
        assert data["session_type"] == "powershell"
        TestDeviceTerminal.created_session_id = data["id"]
        print(f"✓ Created terminal session: {data['id']} for device {data['device_name']}")
    
    def test_create_session_offline_device_fails(self, headers):
        """POST /api/device-terminal/sessions - Should fail for offline device"""
        # First find an offline device or use a non-existent one
        payload = {"device_id": "nonexistent-device", "session_type": "bash"}
        response = requests.post(f"{BASE_URL}/api/device-terminal/sessions", json=payload, headers=headers)
        assert response.status_code in [400, 404]
        print(f"✓ Correctly rejected session for invalid device")
    
    def test_execute_command(self, headers):
        """POST /api/device-terminal/sessions/{id}/execute - Execute command"""
        if not TestDeviceTerminal.created_session_id:
            pytest.skip("No session created")
        payload = {"command": "whoami"}
        response = requests.post(
            f"{BASE_URL}/api/device-terminal/sessions/{TestDeviceTerminal.created_session_id}/execute",
            json=payload, headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "output" in data
        assert "exit_code" in data
        assert data["exit_code"] == 0
        print(f"✓ Executed command, output: {data['output'][:50]}...")
    
    def test_execute_multiple_commands(self, headers):
        """Execute multiple commands in session"""
        if not TestDeviceTerminal.created_session_id:
            pytest.skip("No session created")
        commands = ["hostname", "ipconfig", "dir"]
        for cmd in commands:
            response = requests.post(
                f"{BASE_URL}/api/device-terminal/sessions/{TestDeviceTerminal.created_session_id}/execute",
                json={"command": cmd}, headers=headers
            )
            assert response.status_code == 200
            assert "output" in response.json()
        print(f"✓ Executed {len(commands)} commands successfully")
    
    def test_end_terminal_session(self, headers):
        """POST /api/device-terminal/sessions/{id}/end - End session"""
        if not TestDeviceTerminal.created_session_id:
            pytest.skip("No session created")
        response = requests.post(
            f"{BASE_URL}/api/device-terminal/sessions/{TestDeviceTerminal.created_session_id}/end",
            json={}, headers=headers
        )
        assert response.status_code == 200
        print(f"✓ Ended terminal session")


# ============== STRIPE BILLING PORTAL TESTS ==============

class TestStripeBillingPortal:
    """Stripe Billing Portal API tests"""
    
    def test_get_billing_portal_stats(self, headers):
        """GET /api/billing-portal/stats - Get billing statistics"""
        response = requests.get(f"{BASE_URL}/api/billing-portal/stats", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total_clients" in data
        assert "total_revenue" in data
        assert "outstanding" in data
        assert "overdue" in data
        assert "collection_rate" in data
        assert "reminders_sent" in data
        print(f"✓ Billing stats: {data['total_clients']} clients, ${data['total_revenue']} revenue, {data['collection_rate']}% collection rate")
    
    def test_get_client_billing_status(self, headers):
        """GET /api/billing-portal/clients - Get client billing status"""
        response = requests.get(f"{BASE_URL}/api/billing-portal/clients", headers=headers)
        assert response.status_code == 200
        clients = response.json()
        assert isinstance(clients, list)
        if clients:
            client = clients[0]
            assert "id" in client
            assert "name" in client
            assert "total_invoices" in client
            assert "outstanding_amount" in client
            assert "overdue_count" in client
        print(f"✓ Got billing status for {len(clients)} clients")
    
    def test_create_portal_link(self, headers):
        """POST /api/billing-portal/clients/{id}/create-portal-link - Generate portal link"""
        # First get a client
        clients_resp = requests.get(f"{BASE_URL}/api/billing-portal/clients", headers=headers)
        clients = clients_resp.json()
        if not clients:
            pytest.skip("No clients available")
        client_id = clients[0]["id"]
        
        response = requests.post(
            f"{BASE_URL}/api/billing-portal/clients/{client_id}/create-portal-link",
            json={}, headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "url" in data
        assert "billing.stripe.com" in data["url"]
        assert data["client_id"] == client_id
        print(f"✓ Created portal link for client: {data['url'][:50]}...")
    
    def test_send_payment_reminder(self, headers):
        """POST /api/billing-portal/send-reminder - Send payment reminder"""
        # Get a client
        clients_resp = requests.get(f"{BASE_URL}/api/billing-portal/clients", headers=headers)
        clients = clients_resp.json()
        if not clients:
            pytest.skip("No clients available")
        client_id = clients[0]["id"]
        
        response = requests.post(
            f"{BASE_URL}/api/billing-portal/send-reminder",
            json={"client_id": client_id}, headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "reminder_id" in data
        print(f"✓ Sent payment reminder: {data['message']}")
    
    def test_get_billing_portal_config(self, headers):
        """GET /api/billing-portal/config - Get portal configuration"""
        response = requests.get(f"{BASE_URL}/api/billing-portal/config", headers=headers)
        assert response.status_code == 200
        data = response.json()
        # Config may have default values
        print(f"✓ Got billing portal config")


# ============== SCHEDULED REPORTS TESTS ==============

class TestScheduledReports:
    """Scheduled Reports API tests"""
    
    created_report_id = None
    
    def test_get_scheduled_reports(self, headers):
        """GET /api/scheduled-reports - List scheduled reports"""
        response = requests.get(f"{BASE_URL}/api/scheduled-reports", headers=headers)
        assert response.status_code == 200
        reports = response.json()
        assert isinstance(reports, list)
        print(f"✓ Got {len(reports)} scheduled reports")
    
    def test_create_scheduled_report(self, headers):
        """POST /api/scheduled-reports - Create a scheduled report"""
        payload = {
            "name": "TEST_Weekly Executive Summary",
            "report_type": "executive_summary",
            "frequency": "weekly",
            "day_of_week": "monday",
            "time": "08:00",
            "timezone": "Australia/Sydney",
            "recipients": ["test@example.com", "admin@example.com"],
            "include_sections": ["summary", "tickets", "devices", "sla"]
        }
        response = requests.post(f"{BASE_URL}/api/scheduled-reports", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["name"] == payload["name"]
        assert data["report_type"] == "executive_summary"
        assert data["frequency"] == "weekly"
        assert data["enabled"] == True
        assert len(data["recipients"]) == 2
        TestScheduledReports.created_report_id = data["id"]
        print(f"✓ Created scheduled report: {data['id']}")
    
    def test_update_scheduled_report(self, headers):
        """PUT /api/scheduled-reports/{id} - Update report"""
        if not TestScheduledReports.created_report_id:
            pytest.skip("No report created")
        payload = {
            "name": "TEST_Weekly Executive Summary (Updated)",
            "time": "09:00"
        }
        response = requests.put(
            f"{BASE_URL}/api/scheduled-reports/{TestScheduledReports.created_report_id}",
            json=payload, headers=headers
        )
        assert response.status_code == 200
        print(f"✓ Updated scheduled report")
    
    def test_toggle_scheduled_report(self, headers):
        """POST /api/scheduled-reports/{id}/toggle - Toggle report enabled state"""
        if not TestScheduledReports.created_report_id:
            pytest.skip("No report created")
        response = requests.post(
            f"{BASE_URL}/api/scheduled-reports/{TestScheduledReports.created_report_id}/toggle",
            json={}, headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "enabled" in data
        assert data["enabled"] == False  # Should toggle to disabled
        print(f"✓ Toggled report to enabled={data['enabled']}")
    
    def test_send_report_now(self, headers):
        """POST /api/scheduled-reports/{id}/send-now - Trigger immediate send"""
        if not TestScheduledReports.created_report_id:
            pytest.skip("No report created")
        response = requests.post(
            f"{BASE_URL}/api/scheduled-reports/{TestScheduledReports.created_report_id}/send-now",
            json={}, headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "log_id" in data
        print(f"✓ Sent report now: {data['message']}")
    
    def test_get_report_logs(self, headers):
        """GET /api/scheduled-reports/{id}/logs - Get report send logs"""
        if not TestScheduledReports.created_report_id:
            pytest.skip("No report created")
        response = requests.get(
            f"{BASE_URL}/api/scheduled-reports/{TestScheduledReports.created_report_id}/logs",
            headers=headers
        )
        assert response.status_code == 200
        logs = response.json()
        assert isinstance(logs, list)
        assert len(logs) >= 1  # Should have at least the send-now log
        print(f"✓ Got {len(logs)} report logs")
    
    def test_get_scheduled_report_stats(self, headers):
        """GET /api/scheduled-reports/stats/overview - Get stats"""
        response = requests.get(f"{BASE_URL}/api/scheduled-reports/stats/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "active" in data
        assert "total_sent" in data
        print(f"✓ Stats: {data['total']} total, {data['active']} active, {data['total_sent']} sent")
    
    def test_delete_scheduled_report(self, headers):
        """DELETE /api/scheduled-reports/{id} - Delete report"""
        if not TestScheduledReports.created_report_id:
            pytest.skip("No report created")
        response = requests.delete(
            f"{BASE_URL}/api/scheduled-reports/{TestScheduledReports.created_report_id}",
            headers=headers
        )
        assert response.status_code == 200
        print(f"✓ Deleted scheduled report")


# ============== AI TICKET TRIAGE TESTS ==============

class TestAITicketTriage:
    """AI Ticket Triage API tests"""
    
    def test_ai_triage_ticket(self, headers):
        """POST /api/tickets/{id}/ai-triage - Analyze ticket with GPT"""
        # Use existing ticket TKT-001
        ticket_id = "TKT-001"
        response = requests.post(
            f"{BASE_URL}/api/tickets/{ticket_id}/ai-triage",
            json={}, headers=headers, timeout=30  # AI may take time
        )
        assert response.status_code == 200
        data = response.json()
        # Check triage response structure
        assert "suggested_priority" in data
        assert "suggested_category" in data
        assert "resolution_steps" in data
        assert "summary" in data
        # Check if AI error occurred (fallback response)
        if "ai_error" in data:
            print(f"⚠ AI triage used fallback due to: {data.get('ai_error', 'unknown')[:50]}")
        else:
            print(f"✓ AI triage: priority={data['suggested_priority']}, category={data['suggested_category']}")
        print(f"  Summary: {data.get('summary', 'N/A')[:80]}...")
    
    def test_ai_triage_nonexistent_ticket(self, headers):
        """POST /api/tickets/{id}/ai-triage - Should fail for nonexistent ticket"""
        response = requests.post(
            f"{BASE_URL}/api/tickets/NONEXISTENT/ai-triage",
            json={}, headers=headers
        )
        assert response.status_code == 404
        print(f"✓ Correctly rejected triage for nonexistent ticket")
    
    def test_get_triage_stats(self, headers):
        """GET /api/ai-triage/stats - Get triage statistics"""
        response = requests.get(f"{BASE_URL}/api/ai-triage/stats", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total_triages" in data
        print(f"✓ Triage stats: {data['total_triages']} total triages")


# ============== CLEANUP ==============

class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_workflows(self, headers):
        """Delete any remaining TEST_ workflows"""
        response = requests.get(f"{BASE_URL}/api/workflows", headers=headers)
        if response.status_code == 200:
            workflows = response.json()
            for wf in workflows:
                if wf.get("name", "").startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/workflows/{wf['id']}", headers=headers)
        print("✓ Cleaned up test workflows")
    
    def test_cleanup_test_reports(self, headers):
        """Delete any remaining TEST_ scheduled reports"""
        response = requests.get(f"{BASE_URL}/api/scheduled-reports", headers=headers)
        if response.status_code == 200:
            reports = response.json()
            for r in reports:
                if r.get("name", "").startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/scheduled-reports/{r['id']}", headers=headers)
        print("✓ Cleaned up test scheduled reports")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
