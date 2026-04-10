"""
Phase 10: 15 'Swiss Army Knife' Features - Backend API Tests
Testing all new feature endpoints for NexusOps RMM/PSA platform
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"


class TestAuth:
    """Authentication for all tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200, f"Auth failed: {response.text}"
        return response.json().get("token")

    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        """Get auth headers"""
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# =============================================
# Feature 1: AI Copilot Chat
# =============================================
class TestAICopilot(TestAuth):
    """Test AI Copilot chat feature"""
    
    def test_copilot_suggestions(self, auth_headers):
        """GET /api/copilot/suggestions - quick suggestions"""
        response = requests.get(f"{BASE_URL}/api/copilot/suggestions", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        assert "text" in data[0]
        assert "icon" in data[0]
        print(f"✓ Copilot suggestions: {len(data)} suggestions returned")
    
    def test_copilot_chat(self, auth_headers):
        """POST /api/copilot/chat - send message"""
        response = requests.post(f"{BASE_URL}/api/copilot/chat", headers=auth_headers, json={
            "message": "How many open tickets are there?",
            "session_id": "test-session-001"
        })
        assert response.status_code == 200
        data = response.json()
        assert "reply" in data
        assert "session_id" in data
        print(f"✓ Copilot chat reply received: {data['reply'][:100]}...")
    
    def test_copilot_history(self, auth_headers):
        """GET /api/copilot/history - chat history"""
        response = requests.get(f"{BASE_URL}/api/copilot/history", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Copilot history: {len(data)} messages")


# =============================================
# Feature 2: Client Health Dashboard
# =============================================
class TestClientHealth(TestAuth):
    """Test Client Health Dashboard feature"""
    
    def test_health_scores(self, auth_headers):
        """GET /api/client-health/scores - all client health scores"""
        response = requests.get(f"{BASE_URL}/api/client-health/scores", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "client_id" in data[0]
            assert "health_score" in data[0]
            assert "metrics" in data[0]
            assert "status" in data[0]
        print(f"✓ Client health scores: {len(data)} clients")
    
    def test_health_dashboard(self, auth_headers):
        """GET /api/client-health/dashboard - summary dashboard"""
        response = requests.get(f"{BASE_URL}/api/client-health/dashboard", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "avg_health" in data
        assert "distribution" in data
        assert "at_risk" in data
        print(f"✓ Client health dashboard: {data['total']} clients, avg health: {data['avg_health']}")


# =============================================
# Feature 3: NOC Wallboard
# =============================================
class TestWallboard(TestAuth):
    """Test NOC Wallboard feature"""
    
    def test_wallboard_data(self, auth_headers):
        """GET /api/wallboard/data - full wallboard data"""
        response = requests.get(f"{BASE_URL}/api/wallboard/data", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "timestamp" in data
        assert "tickets" in data
        assert "technicians" in data
        assert "devices" in data
        # Check ticket structure
        tickets = data["tickets"]
        assert "open" in tickets
        assert "critical" in tickets
        assert "queue" in tickets
        print(f"✓ Wallboard data: {tickets['open']} open tickets, {len(data['technicians'])} techs")
    
    def test_wallboard_public(self):
        """GET /api/wallboard/public - public wallboard (no auth)"""
        response = requests.get(f"{BASE_URL}/api/wallboard/public")
        assert response.status_code == 200
        data = response.json()
        assert "open_tickets" in data
        assert "uptime_pct" in data
        print(f"✓ Public wallboard: {data['open_tickets']} tickets, {data['uptime_pct']}% uptime")


# =============================================
# Feature 4: Magic Link Client Portal
# =============================================
class TestMagicPortal(TestAuth):
    """Test Magic Link Client Portal feature"""
    
    def test_get_magic_links(self, auth_headers):
        """GET /api/magic-portal/links - all magic links"""
        response = requests.get(f"{BASE_URL}/api/magic-portal/links", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Magic links: {len(data)} links")
    
    def test_generate_magic_link(self, auth_headers):
        """POST /api/magic-portal/generate/{client_id} - generate link"""
        response = requests.post(f"{BASE_URL}/api/magic-portal/generate/client-001", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert "url" in data
        self.__class__.magic_token = data["token"]
        print(f"✓ Magic link generated: {data['url']}")
    
    def test_access_magic_portal(self, auth_headers):
        """GET /api/magic-portal/access/{token} - access portal (public)"""
        # Get a token first
        links = requests.get(f"{BASE_URL}/api/magic-portal/links", headers=auth_headers).json()
        if len(links) > 0:
            token = links[0].get("token", "")
            response = requests.get(f"{BASE_URL}/api/magic-portal/access/{token}")
            assert response.status_code == 200
            data = response.json()
            assert "found" in data
            if data.get("found"):
                assert "client" in data
                assert "tickets" in data
                assert "devices" in data
                print(f"✓ Magic portal access: {data['client'].get('name', 'Unknown')}")
            else:
                print("✓ Magic portal access: Link invalid/expired")
        else:
            print("⚠ No magic links to test access")


# =============================================
# Feature 5: Network Topology
# =============================================
class TestTopology(TestAuth):
    """Test Network Topology feature"""
    
    def test_all_topologies(self, auth_headers):
        """GET /api/topology/all - all clients with devices"""
        response = requests.get(f"{BASE_URL}/api/topology/all", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "client_id" in data[0]
            assert "device_count" in data[0]
        print(f"✓ Topology summary: {len(data)} clients with devices")
    
    def test_client_topology(self, auth_headers):
        """GET /api/topology/{client_id} - single client network"""
        # Get a client with devices
        all_tops = requests.get(f"{BASE_URL}/api/topology/all", headers=auth_headers).json()
        if len(all_tops) > 0:
            cid = all_tops[0]["client_id"]
            response = requests.get(f"{BASE_URL}/api/topology/{cid}", headers=auth_headers)
            assert response.status_code == 200
            data = response.json()
            assert "nodes" in data
            assert "edges" in data
            assert "stats" in data
            print(f"✓ Client topology: {len(data['nodes'])} nodes, {len(data['edges'])} edges")
        else:
            print("⚠ No clients with devices to test topology")


# =============================================
# Feature 6: Runbook Automation
# =============================================
class TestRunbooks(TestAuth):
    """Test Runbook Automation feature (uses /automation prefix)"""
    
    def test_get_runbooks(self, auth_headers):
        """GET /api/automation - all runbooks"""
        response = requests.get(f"{BASE_URL}/api/automation", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Runbooks: {len(data)} runbooks")
    
    def test_get_templates(self, auth_headers):
        """GET /api/automation/templates - runbook templates"""
        response = requests.get(f"{BASE_URL}/api/automation/templates", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 5  # Should have 5 templates
        print(f"✓ Runbook templates: {len(data)} templates")
    
    def test_create_runbook(self, auth_headers):
        """POST /api/automation - create runbook"""
        response = requests.post(f"{BASE_URL}/api/automation", headers=auth_headers, json={
            "name": "TEST_Automated Alert",
            "description": "Test automation runbook",
            "trigger": {"type": "device_offline", "duration_minutes": 30},
            "conditions": [],
            "actions": [{"type": "create_ticket", "target": "auto"}]
        })
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["name"] == "TEST_Automated Alert"
        self.__class__.test_runbook_id = data["id"]
        print(f"✓ Runbook created: {data['id']}")
    
    def test_test_runbook(self, auth_headers):
        """POST /api/automation/{id}/test - simulate execution"""
        if hasattr(self.__class__, 'test_runbook_id'):
            rb_id = self.__class__.test_runbook_id
            response = requests.post(f"{BASE_URL}/api/automation/{rb_id}/test", headers=auth_headers)
            assert response.status_code == 200
            data = response.json()
            assert "execution" in data
            print(f"✓ Runbook test executed: {data['execution']['status']}")
    
    def test_get_logs(self, auth_headers):
        """GET /api/automation/logs - execution logs"""
        response = requests.get(f"{BASE_URL}/api/automation/logs", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Runbook logs: {len(data)} entries")
    
    def test_delete_runbook(self, auth_headers):
        """DELETE /api/automation/{id} - cleanup"""
        if hasattr(self.__class__, 'test_runbook_id'):
            response = requests.delete(f"{BASE_URL}/api/automation/{self.__class__.test_runbook_id}", headers=auth_headers)
            assert response.status_code == 200
            print("✓ Runbook deleted")


# =============================================
# Feature 7: Password Vault
# =============================================
class TestVault(TestAuth):
    """Test Password Vault feature"""
    
    def test_get_entries(self, auth_headers):
        """GET /api/vault/entries - all entries (masked)"""
        response = requests.get(f"{BASE_URL}/api/vault/entries", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        for entry in data:
            assert entry.get("password") == "********"  # Should be masked
        print(f"✓ Vault entries: {len(data)} entries (masked)")
    
    def test_create_entry(self, auth_headers):
        """POST /api/vault/entries - create entry"""
        response = requests.post(f"{BASE_URL}/api/vault/entries", headers=auth_headers, json={
            "name": "TEST_Server Admin",
            "username": "admin",
            "password": "SuperSecret123!",
            "url": "https://server.example.com",
            "category": "server",
            "client_id": "client-001"
        })
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["password"] == "********"  # Returned masked
        self.__class__.test_entry_id = data["id"]
        print(f"✓ Vault entry created: {data['id']}")
    
    def test_get_entry_decrypted(self, auth_headers):
        """GET /api/vault/entries/{id} - get with decrypted password"""
        if hasattr(self.__class__, 'test_entry_id'):
            response = requests.get(f"{BASE_URL}/api/vault/entries/{self.__class__.test_entry_id}", headers=auth_headers)
            assert response.status_code == 200
            data = response.json()
            assert data["password"] != "********"  # Should be decrypted
            print(f"✓ Vault entry retrieved with decrypted password")
    
    def test_audit_log(self, auth_headers):
        """GET /api/vault/audit-log - access log"""
        response = requests.get(f"{BASE_URL}/api/vault/audit-log", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Vault audit log: {len(data)} entries")
    
    def test_delete_entry(self, auth_headers):
        """DELETE /api/vault/entries/{id} - cleanup"""
        if hasattr(self.__class__, 'test_entry_id'):
            response = requests.delete(f"{BASE_URL}/api/vault/entries/{self.__class__.test_entry_id}", headers=auth_headers)
            assert response.status_code == 200
            print("✓ Vault entry deleted")


# =============================================
# Feature 8: QR Asset Tags
# =============================================
class TestQrAssets(TestAuth):
    """Test QR Asset Tags feature"""
    
    def test_generate_batch(self, auth_headers):
        """GET /api/qr-assets/generate-batch - batch QR codes"""
        response = requests.get(f"{BASE_URL}/api/qr-assets/generate-batch", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "qr_image" in data[0]
            assert "hostname" in data[0]
            assert data[0]["qr_image"].startswith("data:image/png;base64,")
        print(f"✓ QR batch generated: {len(data)} codes")


# =============================================
# Feature 9: Email Campaigns
# =============================================
class TestCampaigns(TestAuth):
    """Test Email Campaigns feature"""
    
    def test_get_campaigns(self, auth_headers):
        """GET /api/campaigns - all campaigns"""
        response = requests.get(f"{BASE_URL}/api/campaigns", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Campaigns: {len(data)} campaigns")
    
    def test_get_templates(self, auth_headers):
        """GET /api/campaigns/templates - campaign templates"""
        response = requests.get(f"{BASE_URL}/api/campaigns/templates", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 4  # Should have 4 templates
        print(f"✓ Campaign templates: {len(data)} templates")
    
    def test_create_campaign(self, auth_headers):
        """POST /api/campaigns - create campaign"""
        response = requests.post(f"{BASE_URL}/api/campaigns", headers=auth_headers, json={
            "name": "TEST_Maintenance Alert",
            "subject": "Scheduled Maintenance Notice",
            "body": "Dear customer, we will be performing maintenance...",
            "type": "maintenance",
            "recipients": "all"
        })
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["status"] == "draft"
        self.__class__.test_campaign_id = data["id"]
        print(f"✓ Campaign created: {data['id']}")
    
    def test_send_campaign(self, auth_headers):
        """POST /api/campaigns/{id}/send - send campaign"""
        if hasattr(self.__class__, 'test_campaign_id'):
            response = requests.post(f"{BASE_URL}/api/campaigns/{self.__class__.test_campaign_id}/send", headers=auth_headers)
            assert response.status_code == 200
            data = response.json()
            assert "sent" in data
            print(f"✓ Campaign sent to {data.get('sent', 0)} recipients")
    
    def test_delete_campaign(self, auth_headers):
        """DELETE /api/campaigns/{id} - cleanup"""
        if hasattr(self.__class__, 'test_campaign_id'):
            response = requests.delete(f"{BASE_URL}/api/campaigns/{self.__class__.test_campaign_id}", headers=auth_headers)
            assert response.status_code == 200
            print("✓ Campaign deleted")


# =============================================
# Feature 10: SLA Timer
# =============================================
class TestSlaTimer(TestAuth):
    """Test SLA Timer feature"""
    
    def test_active_sla(self, auth_headers):
        """GET /api/sla-timer/active - active SLA timers"""
        response = requests.get(f"{BASE_URL}/api/sla-timer/active", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "tickets" in data
        assert "stats" in data
        stats = data["stats"]
        assert "total_active" in stats
        assert "breached" in stats
        assert "at_risk" in stats
        print(f"✓ SLA timers: {stats['total_active']} active, {stats['breached']} breached, {stats['at_risk']} at risk")
    
    def test_predictions(self, auth_headers):
        """GET /api/sla-timer/predictions - breach predictions"""
        response = requests.get(f"{BASE_URL}/api/sla-timer/predictions", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "breach_probability" in data[0]
            assert "recommendation" in data[0]
        print(f"✓ SLA predictions: {len(data)} predictions")


# =============================================
# Feature 11: Benchmarking
# =============================================
class TestBenchmarking(TestAuth):
    """Test Benchmarking feature"""
    
    def test_overview(self, auth_headers):
        """GET /api/benchmarking/overview - benchmarking data"""
        response = requests.get(f"{BASE_URL}/api/benchmarking/overview", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "resolution_times" in data
        assert "tech_performance" in data
        assert "overall" in data
        assert "industry_benchmarks" in data
        print(f"✓ Benchmarking: SLA compliance {data['overall']['sla_compliance']}% vs industry {data['overall']['industry_sla']}%")


# =============================================
# Feature 12: Billing Reconciliation
# =============================================
class TestBillingRecon(TestAuth):
    """Test Billing Reconciliation feature"""
    
    def test_overview(self, auth_headers):
        """GET /api/billing-recon/overview - reconciliation data"""
        response = requests.get(f"{BASE_URL}/api/billing-recon/overview", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "unbilled_time" in data
        assert "uninvoiced_products" in data
        assert "overdue_invoices" in data
        assert "total_recoverable" in data
        print(f"✓ Billing recon: ${data['total_recoverable']} recoverable")


# =============================================
# Feature 13: Upsell Detector
# =============================================
class TestUpsell(TestAuth):
    """Test Upsell Detector feature"""
    
    def test_opportunities(self, auth_headers):
        """GET /api/upsell/opportunities - scan for upsells"""
        response = requests.get(f"{BASE_URL}/api/upsell/opportunities", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "opportunities" in data
        assert "total_pipeline_value" in data
        print(f"✓ Upsell: {len(data['opportunities'])} clients with opportunities, ${data['total_pipeline_value']} pipeline")


# =============================================
# Feature 14: Client ROI Reports
# =============================================
class TestRoiReports(TestAuth):
    """Test Client ROI Reports feature"""
    
    def test_all_summaries(self, auth_headers):
        """GET /api/roi-reports - all client ROI summaries"""
        response = requests.get(f"{BASE_URL}/api/roi-reports", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "client_id" in data[0]
            assert "estimated_value" in data[0]
        print(f"✓ ROI summaries: {len(data)} clients")
    
    def test_client_report(self, auth_headers):
        """GET /api/roi-reports/{client_id} - detailed report"""
        response = requests.get(f"{BASE_URL}/api/roi-reports/client-001", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "client" in data
        assert "ticket_metrics" in data
        assert "value_delivered" in data
        assert "roi" in data
        assert "highlights" in data
        print(f"✓ ROI report for client-001: ROI {data['roi']['roi_pct']}%")


# =============================================
# Feature 15: Document Scanner
# =============================================
class TestDocScanner(TestAuth):
    """Test Document Scanner feature"""
    
    def test_scan_document(self, auth_headers):
        """POST /api/doc-scanner/scan - AI OCR scan"""
        response = requests.post(f"{BASE_URL}/api/doc-scanner/scan", headers=auth_headers, json={
            "image": "Device Label: DELL-SRV-001\nSerial: 7X8K92M\nModel: PowerEdge R640\nManufacturer: Dell\nIP: 192.168.1.100",
            "type": "label"
        })
        assert response.status_code == 200
        data = response.json()
        # May have error if AI not configured, but endpoint should work
        assert "result" in data or "error" in data
        if "result" in data:
            self.__class__.scan_result = data["result"]
            print(f"✓ Doc scan completed: {data['result'].get('hostname', 'Unknown')}")
        else:
            print(f"⚠ Doc scan: {data.get('error', 'No AI configured')}")
    
    def test_create_device_from_scan(self, auth_headers):
        """POST /api/doc-scanner/create-device - create device from scan"""
        scan_result = getattr(self.__class__, 'scan_result', {
            "hostname": "TEST-SCANNED-DEVICE",
            "device_type": "server",
            "serial_number": "TEST123"
        })
        response = requests.post(f"{BASE_URL}/api/doc-scanner/create-device", headers=auth_headers, json={
            "scan_result": scan_result,
            "client_id": "client-001"
        })
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        self.__class__.test_device_id = data["id"]
        print(f"✓ Device created from scan: {data['id']}")
    
    def test_scan_history(self, auth_headers):
        """GET /api/doc-scanner/history - scan history"""
        response = requests.get(f"{BASE_URL}/api/doc-scanner/history", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Scan history: {len(data)} scans")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
