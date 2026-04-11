"""
Iteration 75 - Morning Checks Dashboard, Live Terminal, Remote Providers, Module Templates
Tests for:
- GET /api/morning-checks - NOC morning briefing aggregation
- POST /api/scripts/{id}/live-run - Live script execution with output
- GET /api/script-executions/{id} - Execution detail
- GET /api/remote-providers - Multi-provider remote access hub (4 providers)
- PUT /api/remote-providers/{id}/settings - Save provider config
- POST /api/remote-providers/{id}/test - Test provider connection
- GET /api/templates/tickets - 12 ticket templates
- GET /api/templates/onboarding - 4 onboarding templates
- GET /api/templates/sla - 4 SLA tier templates
- GET /api/templates/runbooks - 6 runbook templates
- GET /api/templates/scripts - 8 script templates
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication for testing"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in response"
        return data["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        """Get headers with auth token"""
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestMorningChecks(TestAuth):
    """Morning Checks Dashboard endpoint tests"""
    
    def test_morning_checks_endpoint(self, headers):
        """Test GET /api/morning-checks returns aggregated health data"""
        response = requests.get(f"{BASE_URL}/api/morning-checks", headers=headers)
        assert response.status_code == 200, f"Morning checks failed: {response.text}"
        data = response.json()
        
        # Verify required top-level fields
        assert "timestamp" in data, "Missing timestamp"
        assert "health_score" in data, "Missing health_score"
        assert isinstance(data["health_score"], int), "health_score should be int"
        assert 0 <= data["health_score"] <= 100, "health_score should be 0-100"
        
        # Verify devices section
        assert "devices" in data, "Missing devices section"
        devices = data["devices"]
        assert "total" in devices, "Missing devices.total"
        assert "online" in devices, "Missing devices.online"
        assert "offline" in devices, "Missing devices.offline"
        assert "offline_list" in devices, "Missing devices.offline_list"
        
        # Verify tickets section
        assert "tickets" in data, "Missing tickets section"
        tickets = data["tickets"]
        assert "total_open" in tickets, "Missing tickets.total_open"
        assert "critical_high" in tickets, "Missing tickets.critical_high"
        assert "unassigned" in tickets, "Missing tickets.unassigned"
        assert "sla_breaches" in tickets, "Missing tickets.sla_breaches"
        assert "overnight_new" in tickets, "Missing tickets.overnight_new"
        assert "critical_list" in tickets, "Missing tickets.critical_list"
        assert "overnight_list" in tickets, "Missing tickets.overnight_list"
        
        # Verify backups section
        assert "backups" in data, "Missing backups section"
        backups = data["backups"]
        assert "total" in backups, "Missing backups.total"
        assert "success" in backups, "Missing backups.success"
        assert "failed" in backups, "Missing backups.failed"
        assert "failed_list" in backups, "Missing backups.failed_list"
        
        # Verify security section
        assert "security" in data, "Missing security section"
        security = data["security"]
        assert "alerts_24h" in security, "Missing security.alerts_24h"
        assert "critical_alerts" in security, "Missing security.critical_alerts"
        
        # Verify client_health section (RAG board)
        assert "client_health" in data, "Missing client_health section"
        assert isinstance(data["client_health"], list), "client_health should be list"
        
        # Verify phones section (Yeastar)
        assert "phones" in data, "Missing phones section"
        assert "configured" in data["phones"], "Missing phones.configured"
        
        # Verify overdue_invoices section
        assert "overdue_invoices" in data, "Missing overdue_invoices section"
        overdue = data["overdue_invoices"]
        assert "count" in overdue, "Missing overdue_invoices.count"
        assert "total_amount" in overdue, "Missing overdue_invoices.total_amount"
        assert "list" in overdue, "Missing overdue_invoices.list"
        
        # Verify patches_pending
        assert "patches_pending" in data, "Missing patches_pending"
        
        # Verify scheduled_tasks
        assert "scheduled_tasks" in data, "Missing scheduled_tasks"
        
        # Verify recurring_due
        assert "recurring_due" in data, "Missing recurring_due"
        
        print(f"Morning checks returned health_score: {data['health_score']}")
        print(f"Devices: {devices['total']} total, {devices['offline']} offline")
        print(f"Tickets: {tickets['total_open']} open, {tickets['critical_high']} critical/high")
        print(f"Client health entries: {len(data['client_health'])}")


class TestRemoteProviders(TestAuth):
    """Remote Access Providers endpoint tests"""
    
    def test_get_remote_providers(self, headers):
        """Test GET /api/remote-providers returns 4 providers"""
        response = requests.get(f"{BASE_URL}/api/remote-providers", headers=headers)
        assert response.status_code == 200, f"Remote providers failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Response should be a list"
        assert len(data) == 4, f"Expected 4 providers, got {len(data)}"
        
        # Verify expected providers
        provider_ids = [p["id"] for p in data]
        assert "rustdesk" in provider_ids, "Missing RustDesk provider"
        assert "meshcentral" in provider_ids, "Missing MeshCentral provider"
        assert "splashtop" in provider_ids, "Missing Splashtop provider"
        assert "guacamole" in provider_ids, "Missing Apache Guacamole provider"
        
        # Verify provider structure
        for provider in data:
            assert "id" in provider, "Missing provider id"
            assert "name" in provider, "Missing provider name"
            assert "description" in provider, "Missing provider description"
            assert "type" in provider, "Missing provider type"
            assert "license" in provider, "Missing provider license"
            assert "features" in provider, "Missing provider features"
            assert "config_fields" in provider, "Missing provider config_fields"
            assert "docs_url" in provider, "Missing provider docs_url"
            assert "configured" in provider, "Missing provider configured status"
            assert "active" in provider, "Missing provider active status"
            
            print(f"Provider: {provider['name']} ({provider['type']}) - configured: {provider['configured']}")
    
    def test_save_provider_settings(self, headers):
        """Test PUT /api/remote-providers/{id}/settings saves config"""
        # Save settings for RustDesk
        settings = {
            "server_url": "https://rustdesk.test.com",
            "api_key": "test-api-key-12345",
            "active": True
        }
        response = requests.put(f"{BASE_URL}/api/remote-providers/rustdesk/settings", 
                               json=settings, headers=headers)
        assert response.status_code == 200, f"Save settings failed: {response.text}"
        data = response.json()
        assert "message" in data, "Missing message in response"
        print(f"Save settings response: {data['message']}")
    
    def test_get_provider_settings(self, headers):
        """Test GET /api/remote-providers/{id}/settings returns config"""
        response = requests.get(f"{BASE_URL}/api/remote-providers/rustdesk/settings", headers=headers)
        assert response.status_code == 200, f"Get settings failed: {response.text}"
        data = response.json()
        assert "type" in data, "Missing type in settings"
        print(f"Provider settings: {data}")
    
    def test_test_provider_connection(self, headers):
        """Test POST /api/remote-providers/{id}/test tests connection"""
        response = requests.post(f"{BASE_URL}/api/remote-providers/rustdesk/test", headers=headers)
        assert response.status_code == 200, f"Test connection failed: {response.text}"
        data = response.json()
        assert "success" in data, "Missing success in response"
        assert "message" in data, "Missing message in response"
        print(f"Test connection: success={data['success']}, message={data['message']}")
    
    def test_toggle_provider(self, headers):
        """Test PUT /api/remote-providers/{id}/toggle toggles active status"""
        response = requests.put(f"{BASE_URL}/api/remote-providers/meshcentral/toggle", headers=headers)
        assert response.status_code == 200, f"Toggle provider failed: {response.text}"
        data = response.json()
        assert "active" in data, "Missing active in response"
        assert "message" in data, "Missing message in response"
        print(f"Toggle provider: active={data['active']}, message={data['message']}")


class TestModuleTemplates(TestAuth):
    """Module Templates endpoint tests"""
    
    def test_ticket_templates(self, headers):
        """Test GET /api/templates/tickets returns 12 templates"""
        response = requests.get(f"{BASE_URL}/api/templates/tickets", headers=headers)
        assert response.status_code == 200, f"Ticket templates failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Response should be a list"
        assert len(data) == 12, f"Expected 12 ticket templates, got {len(data)}"
        
        # Verify template structure
        for template in data:
            assert "id" in template, "Missing template id"
            assert "name" in template, "Missing template name"
            assert "category" in template, "Missing template category"
            assert "priority" in template, "Missing template priority"
            assert "description" in template, "Missing template description"
            assert "checklist" in template, "Missing template checklist"
            assert isinstance(template["checklist"], list), "Checklist should be list"
        
        # Verify some expected templates
        template_names = [t["name"] for t in data]
        assert "Password Reset" in template_names, "Missing Password Reset template"
        assert "New User Onboarding" in template_names, "Missing New User Onboarding template"
        assert "Network Connectivity Down" in template_names, "Missing Network Connectivity Down template"
        assert "Security Incident" in template_names, "Missing Security Incident template"
        
        print(f"Ticket templates: {len(data)} templates")
        for t in data[:3]:
            print(f"  - {t['name']} ({t['category']}, {t['priority']})")
    
    def test_onboarding_templates(self, headers):
        """Test GET /api/templates/onboarding returns 4 templates"""
        response = requests.get(f"{BASE_URL}/api/templates/onboarding", headers=headers)
        assert response.status_code == 200, f"Onboarding templates failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Response should be a list"
        assert len(data) == 4, f"Expected 4 onboarding templates, got {len(data)}"
        
        # Verify template structure
        for template in data:
            assert "id" in template, "Missing template id"
            assert "name" in template, "Missing template name"
            assert "category" in template, "Missing template category"
            assert "description" in template, "Missing template description"
            assert "steps" in template, "Missing template steps"
            assert isinstance(template["steps"], list), "Steps should be list"
        
        # Verify expected templates
        template_names = [t["name"] for t in data]
        assert "New Client IT Audit" in template_names, "Missing New Client IT Audit template"
        assert "Microsoft 365 Migration" in template_names, "Missing Microsoft 365 Migration template"
        assert "Security Baseline Setup" in template_names, "Missing Security Baseline Setup template"
        assert "RMM Agent Deployment" in template_names, "Missing RMM Agent Deployment template"
        
        print(f"Onboarding templates: {len(data)} templates")
        for t in data:
            print(f"  - {t['name']} ({t['category']})")
    
    def test_sla_templates(self, headers):
        """Test GET /api/templates/sla returns 4 SLA tier templates"""
        response = requests.get(f"{BASE_URL}/api/templates/sla", headers=headers)
        assert response.status_code == 200, f"SLA templates failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Response should be a list"
        assert len(data) == 4, f"Expected 4 SLA templates, got {len(data)}"
        
        # Verify template structure
        for template in data:
            assert "id" in template, "Missing template id"
            assert "name" in template, "Missing template name"
            assert "tier" in template, "Missing template tier"
            assert "response_critical" in template, "Missing response_critical"
            assert "response_high" in template, "Missing response_high"
            assert "response_medium" in template, "Missing response_medium"
            assert "response_low" in template, "Missing response_low"
            assert "resolve_critical" in template, "Missing resolve_critical"
            assert "availability" in template, "Missing availability"
            assert "support_hours" in template, "Missing support_hours"
            assert "features" in template, "Missing features"
        
        # Verify expected tiers
        tiers = [t["tier"] for t in data]
        assert "platinum" in tiers, "Missing Platinum tier"
        assert "gold" in tiers, "Missing Gold tier"
        assert "silver" in tiers, "Missing Silver tier"
        assert "bronze" in tiers, "Missing Bronze tier"
        
        print(f"SLA templates: {len(data)} tiers")
        for t in data:
            print(f"  - {t['name']} ({t['tier']}): {t['response_critical']} critical response")
    
    def test_runbook_templates(self, headers):
        """Test GET /api/templates/runbooks returns 6 runbook templates"""
        response = requests.get(f"{BASE_URL}/api/templates/runbooks", headers=headers)
        assert response.status_code == 200, f"Runbook templates failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Response should be a list"
        assert len(data) == 6, f"Expected 6 runbook templates, got {len(data)}"
        
        # Verify template structure
        for template in data:
            assert "id" in template, "Missing template id"
            assert "name" in template, "Missing template name"
            assert "category" in template, "Missing template category"
            assert "severity" in template, "Missing template severity"
            assert "steps" in template, "Missing template steps"
            assert isinstance(template["steps"], list), "Steps should be list"
        
        # Verify expected runbooks
        template_names = [t["name"] for t in data]
        assert "Server Down - Emergency Response" in template_names, "Missing Server Down runbook"
        assert "Ransomware Response" in template_names, "Missing Ransomware Response runbook"
        assert "New Employee IT Setup" in template_names, "Missing New Employee IT Setup runbook"
        
        print(f"Runbook templates: {len(data)} runbooks")
        for t in data:
            print(f"  - {t['name']} ({t['category']}, {t['severity']})")
    
    def test_script_templates(self, headers):
        """Test GET /api/templates/scripts returns 8 script templates"""
        response = requests.get(f"{BASE_URL}/api/templates/scripts", headers=headers)
        assert response.status_code == 200, f"Script templates failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Response should be a list"
        assert len(data) == 8, f"Expected 8 script templates, got {len(data)}"
        
        # Verify template structure
        for template in data:
            assert "id" in template, "Missing template id"
            assert "name" in template, "Missing template name"
            assert "category" in template, "Missing template category"
            assert "os_target" in template, "Missing template os_target"
            assert "language" in template, "Missing template language"
            assert "content" in template, "Missing template content"
        
        # Verify expected scripts
        template_names = [t["name"] for t in data]
        assert "Disk Space Cleanup" in template_names, "Missing Disk Space Cleanup script"
        assert "AD User Audit" in template_names, "Missing AD User Audit script"
        assert "Windows Update Check" in template_names, "Missing Windows Update Check script"
        assert "Linux System Health" in template_names, "Missing Linux System Health script"
        
        print(f"Script templates: {len(data)} scripts")
        for t in data:
            print(f"  - {t['name']} ({t['language']}, {t['os_target']})")


class TestLiveTerminal(TestAuth):
    """Live Terminal / Script Execution tests"""
    
    def test_create_script_for_live_run(self, headers):
        """Create a test script for live run testing"""
        script_data = {
            "name": "TEST_Live_Terminal_Script",
            "description": "Test script for live terminal testing",
            "script_type": "powershell",
            "content": "Write-Host 'Hello from live terminal'\nGet-Date\nWrite-Host 'Test complete'",
            "category": "general",
            "os_target": "windows",
            "run_as_admin": False,
            "timeout_seconds": 60
        }
        response = requests.post(f"{BASE_URL}/api/scripts", json=script_data, headers=headers)
        assert response.status_code == 200, f"Create script failed: {response.text}"
        data = response.json()
        assert "id" in data, "Missing script id"
        print(f"Created test script: {data['id']}")
        return data["id"]
    
    def test_live_run_script(self, headers):
        """Test POST /api/scripts/{id}/live-run returns execution output"""
        # First create a script
        script_id = self.test_create_script_for_live_run(headers)
        
        # Run the script
        run_data = {
            "device_id": "",
            "target": "localhost"
        }
        response = requests.post(f"{BASE_URL}/api/scripts/{script_id}/live-run", 
                                json=run_data, headers=headers)
        assert response.status_code == 200, f"Live run failed: {response.text}"
        data = response.json()
        
        # Verify execution response
        assert "id" in data, "Missing execution id"
        assert "script_id" in data, "Missing script_id"
        assert "script_name" in data, "Missing script_name"
        assert "device_name" in data, "Missing device_name"
        assert "status" in data, "Missing status"
        assert "output" in data, "Missing output"
        assert "duration_ms" in data, "Missing duration_ms"
        assert "created_at" in data, "Missing created_at"
        
        # Verify output structure
        output = data["output"]
        assert isinstance(output, list), "Output should be a list"
        assert len(output) > 0, "Output should not be empty"
        
        # Verify output line structure
        for line in output:
            assert "time" in line, "Missing time in output line"
            assert "type" in line, "Missing type in output line"
            assert "text" in line, "Missing text in output line"
            assert line["type"] in ["info", "success", "error", "warning", "command", "output", "comment"], \
                f"Invalid output type: {line['type']}"
        
        print(f"Live run execution: {data['id']}")
        print(f"Status: {data['status']}, Duration: {data['duration_ms']}ms")
        print(f"Output lines: {len(output)}")
        for line in output[:5]:
            print(f"  [{line['type']}] {line['text'][:60]}")
        
        # Clean up - delete test script
        requests.delete(f"{BASE_URL}/api/scripts/{script_id}", headers=headers)
        
        return data["id"]
    
    def test_get_execution_detail(self, headers):
        """Test GET /api/script-executions/{id} returns execution detail"""
        # First create and run a script
        script_data = {
            "name": "TEST_Execution_Detail_Script",
            "description": "Test script for execution detail",
            "script_type": "powershell",
            "content": "Write-Host 'Testing execution detail'",
            "category": "general",
            "os_target": "windows",
            "run_as_admin": False,
            "timeout_seconds": 60
        }
        create_response = requests.post(f"{BASE_URL}/api/scripts", json=script_data, headers=headers)
        script_id = create_response.json()["id"]
        
        # Run the script
        run_response = requests.post(f"{BASE_URL}/api/scripts/{script_id}/live-run", 
                                    json={"target": "localhost"}, headers=headers)
        execution_id = run_response.json()["id"]
        
        # Get execution detail
        response = requests.get(f"{BASE_URL}/api/script-executions/{execution_id}", headers=headers)
        assert response.status_code == 200, f"Get execution detail failed: {response.text}"
        data = response.json()
        
        assert data["id"] == execution_id, "Execution ID mismatch"
        assert "output" in data, "Missing output in execution detail"
        
        print(f"Execution detail retrieved: {execution_id}")
        
        # Clean up
        requests.delete(f"{BASE_URL}/api/scripts/{script_id}", headers=headers)
    
    def test_get_script_executions_list(self, headers):
        """Test GET /api/script-executions returns execution list"""
        response = requests.get(f"{BASE_URL}/api/script-executions?limit=10", headers=headers)
        assert response.status_code == 200, f"Get executions list failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Response should be a list"
        print(f"Script executions: {len(data)} records")


class TestScriptsEndpoints(TestAuth):
    """Scripts CRUD endpoint tests"""
    
    def test_get_scripts(self, headers):
        """Test GET /api/scripts returns script list"""
        response = requests.get(f"{BASE_URL}/api/scripts", headers=headers)
        assert response.status_code == 200, f"Get scripts failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Scripts: {len(data)} scripts in library")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
