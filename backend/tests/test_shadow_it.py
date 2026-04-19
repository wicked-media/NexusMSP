"""
Shadow IT Detector - Backend API Tests
Tests for P1 Wave C feature 1: Shadow IT Detector
- Baseline management (GET/PUT)
- Device software report
- Scan functionality (all clients / single client)
- Summary endpoint
- Findings endpoint with filters
- Actions: approve, create_ticket, ignore
- Seed demo endpoint
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestShadowITBackend:
    """Shadow IT Detector API tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth token for all tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get token
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        token = login_response.json().get("token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
    
    # ==================== BASELINE TESTS ====================
    
    def test_get_baseline_default(self):
        """GET /api/clients/{id}/shadow-it/baseline returns default baseline when no custom set"""
        response = self.session.get(f"{BASE_URL}/api/clients/client-001/shadow-it/baseline")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify structure
        assert "client_id" in data
        assert "approved" in data
        assert isinstance(data["approved"], list)
        
        # Verify default baseline includes expected apps
        approved_lower = [a.lower() for a in data["approved"]]
        assert any("microsoft" in a for a in approved_lower), "Microsoft apps should be in default baseline"
        assert any("chrome" in a for a in approved_lower), "Chrome should be in default baseline"
        assert any("zoom" in a for a in approved_lower), "Zoom should be in default baseline"
        assert any("slack" in a for a in approved_lower), "Slack should be in default baseline"
        print(f"✓ Default baseline has {len(data['approved'])} approved apps")
    
    def test_put_baseline_custom(self):
        """PUT /api/clients/{id}/shadow-it/baseline persists custom approved list"""
        custom_baseline = ["Microsoft Office", "Chrome", "Zoom", "Slack", "Custom App 123"]
        
        response = self.session.put(
            f"{BASE_URL}/api/clients/client-001/shadow-it/baseline",
            json={"approved": custom_baseline}
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "approved" in data
        assert "Custom App 123" in data["approved"]
        assert "updated_at" in data
        
        # Verify persistence with GET
        get_response = self.session.get(f"{BASE_URL}/api/clients/client-001/shadow-it/baseline")
        assert get_response.status_code == 200
        get_data = get_response.json()
        assert get_data.get("source") == "custom", "Should be marked as custom baseline"
        assert "Custom App 123" in get_data["approved"]
        print(f"✓ Custom baseline persisted with {len(get_data['approved'])} apps")
    
    # ==================== DEVICE SOFTWARE REPORT TESTS ====================
    
    def test_device_software_report(self):
        """POST /api/devices/{id}/software-report accepts installed_software and updates device"""
        # First get a device ID
        devices_response = self.session.get(f"{BASE_URL}/api/devices?limit=1")
        assert devices_response.status_code == 200
        devices = devices_response.json()
        
        if not devices or len(devices) == 0:
            pytest.skip("No devices available for testing")
        
        device_id = devices[0].get("id")
        
        # Post software report
        software_list = [
            {"name": "Dropbox", "version": "197.4.5"},
            {"name": "Microsoft Office 365"},
            {"name": "Chrome"}
        ]
        
        response = self.session.post(
            f"{BASE_URL}/api/devices/{device_id}/software-report",
            json={"installed_software": software_list}
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data.get("device_id") == device_id
        assert data.get("count") == 3
        assert "reported_at" in data
        print(f"✓ Software report accepted for device {device_id}")
    
    def test_device_software_report_not_found(self):
        """POST /api/devices/{id}/software-report returns 404 for non-existent device"""
        response = self.session.post(
            f"{BASE_URL}/api/devices/non-existent-device-xyz/software-report",
            json={"installed_software": [{"name": "Test App"}]}
        )
        assert response.status_code == 404
        print("✓ 404 returned for non-existent device")
    
    # ==================== SEED DEMO TESTS ====================
    
    def test_seed_demo(self):
        """POST /api/shadow-it/seed-demo populates installed_software on devices (idempotent)"""
        response = self.session.post(f"{BASE_URL}/api/shadow-it/seed-demo", json={})
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "devices_seeded" in data
        assert data["devices_seeded"] > 0, "Should seed at least some devices"
        print(f"✓ Seeded {data['devices_seeded']} devices with demo software")
    
    # ==================== SCAN TESTS ====================
    
    def test_scan_all_clients(self):
        """POST /api/shadow-it/scan {} runs across all clients"""
        response = self.session.post(f"{BASE_URL}/api/shadow-it/scan", json={})
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "results" in data
        assert isinstance(data["results"], list)
        assert "clients_scanned" in data
        
        # Check result structure
        if len(data["results"]) > 0:
            result = data["results"][0]
            assert "client_id" in result
            assert "devices_scanned" in result or "skipped" in result
            if not result.get("skipped"):
                assert "findings" in result
                assert "risk_counts" in result
        
        print(f"✓ Scanned {data['clients_scanned']} clients, {len(data['results'])} results")
    
    def test_scan_single_client(self):
        """POST /api/shadow-it/scan {client_id:'client-001'} runs only for one client"""
        response = self.session.post(
            f"{BASE_URL}/api/shadow-it/scan",
            json={"client_id": "client-001"}
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "results" in data
        assert len(data["results"]) == 1, "Should only have one result for single client scan"
        
        result = data["results"][0]
        assert result.get("client_id") == "client-001"
        print(f"✓ Single client scan: {result.get('findings', 0)} findings, {result.get('devices_scanned', 0)} devices")
    
    # ==================== SUMMARY TESTS ====================
    
    def test_summary(self):
        """GET /api/shadow-it/summary returns aggregated dashboard data"""
        response = self.session.get(f"{BASE_URL}/api/shadow-it/summary")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify structure
        assert "total_findings" in data
        assert "by_risk" in data
        assert "clients_with_findings" in data
        assert "per_client" in data
        assert "top_apps" in data
        
        # Verify by_risk structure
        by_risk = data["by_risk"]
        assert "critical" in by_risk
        assert "high" in by_risk
        assert "medium" in by_risk
        assert "low" in by_risk
        
        # Verify per_client structure if present
        if len(data["per_client"]) > 0:
            client = data["per_client"][0]
            assert "client_id" in client
            assert "client_name" in client
            assert "findings_total" in client
            assert "by_risk" in client
        
        # Verify top_apps structure if present
        if len(data["top_apps"]) > 0:
            app = data["top_apps"][0]
            assert "name" in app
            assert "risk" in app
            assert "devices" in app
        
        print(f"✓ Summary: {data['total_findings']} findings, {data['clients_with_findings']} clients affected")
        print(f"  Risk breakdown: Critical={by_risk['critical']}, High={by_risk['high']}, Medium={by_risk['medium']}, Low={by_risk['low']}")
    
    # ==================== FINDINGS TESTS ====================
    
    def test_findings_list(self):
        """GET /api/shadow-it/findings returns findings sorted by risk DESC"""
        response = self.session.get(f"{BASE_URL}/api/shadow-it/findings")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert isinstance(data, list)
        
        if len(data) > 0:
            finding = data[0]
            assert "id" in finding
            assert "app" in finding
            assert "client_id" in finding
            assert "risk" in finding
            assert "category" in finding
            assert "device_count" in finding
            assert "status" in finding
            
            # Verify sorting (critical > high > medium > low)
            risk_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
            for i in range(len(data) - 1):
                current_risk = risk_order.get(data[i].get("risk"), 4)
                next_risk = risk_order.get(data[i+1].get("risk"), 4)
                assert current_risk <= next_risk, "Findings should be sorted by risk DESC"
        
        print(f"✓ Findings list: {len(data)} findings returned")
    
    def test_findings_filter_by_client(self):
        """GET /api/shadow-it/findings supports client_id filter"""
        response = self.session.get(f"{BASE_URL}/api/shadow-it/findings?client_id=client-001")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # All findings should be for client-001
        for finding in data:
            assert finding.get("client_id") == "client-001"
        
        print(f"✓ Client filter: {len(data)} findings for client-001")
    
    def test_findings_filter_by_risk(self):
        """GET /api/shadow-it/findings supports risk filter"""
        response = self.session.get(f"{BASE_URL}/api/shadow-it/findings?risk=high")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # All findings should be high risk
        for finding in data:
            assert finding.get("risk") == "high"
        
        print(f"✓ Risk filter: {len(data)} high-risk findings")
    
    def test_findings_filter_by_category(self):
        """GET /api/shadow-it/findings supports category filter"""
        response = self.session.get(f"{BASE_URL}/api/shadow-it/findings?category=file_sharing")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # All findings should be file_sharing category
        for finding in data:
            assert finding.get("category") == "file_sharing"
        
        print(f"✓ Category filter: {len(data)} file_sharing findings")
    
    # ==================== ACTION TESTS ====================
    
    def test_action_approve(self):
        """POST /api/shadow-it/findings/{id}/approve adds app to baseline and marks status=approved"""
        # First get a finding to approve
        findings_response = self.session.get(f"{BASE_URL}/api/shadow-it/findings?limit=100")
        assert findings_response.status_code == 200
        findings = findings_response.json()
        
        if len(findings) == 0:
            pytest.skip("No findings available to test approve action")
        
        finding = findings[0]
        finding_id = finding.get("id")
        app_name = finding.get("app")
        client_id = finding.get("client_id")
        
        # Approve the finding
        response = self.session.post(f"{BASE_URL}/api/shadow-it/findings/{finding_id}/approve", json={})
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data.get("status") == "approved"
        assert "app_added_to_baseline" in data
        
        # Verify app was added to baseline
        baseline_response = self.session.get(f"{BASE_URL}/api/clients/{client_id}/shadow-it/baseline")
        assert baseline_response.status_code == 200
        baseline = baseline_response.json()
        assert app_name in baseline.get("approved", []), "App should be added to baseline"
        
        print(f"✓ Approved finding {finding_id}, added '{app_name}' to baseline")
    
    def test_action_ignore(self):
        """POST /api/shadow-it/findings/{id}/ignore marks status=ignored"""
        # First run a scan to get fresh findings
        self.session.post(f"{BASE_URL}/api/shadow-it/scan", json={})
        
        # Get a finding to ignore
        findings_response = self.session.get(f"{BASE_URL}/api/shadow-it/findings?limit=100")
        assert findings_response.status_code == 200
        findings = findings_response.json()
        
        if len(findings) == 0:
            pytest.skip("No findings available to test ignore action")
        
        finding = findings[0]
        finding_id = finding.get("id")
        
        # Ignore the finding
        response = self.session.post(f"{BASE_URL}/api/shadow-it/findings/{finding_id}/ignore", json={})
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data.get("status") == "ignored"
        print(f"✓ Ignored finding {finding_id}")
    
    def test_action_create_ticket(self):
        """POST /api/shadow-it/findings/{id}/create_ticket creates a NEW ticket"""
        # First run a scan to get fresh findings
        self.session.post(f"{BASE_URL}/api/shadow-it/scan", json={})
        
        # Get a finding to create ticket for
        findings_response = self.session.get(f"{BASE_URL}/api/shadow-it/findings?limit=100")
        assert findings_response.status_code == 200
        findings = findings_response.json()
        
        if len(findings) == 0:
            pytest.skip("No findings available to test create_ticket action")
        
        finding = findings[0]
        finding_id = finding.get("id")
        finding_risk = finding.get("risk")
        
        # Create ticket
        response = self.session.post(f"{BASE_URL}/api/shadow-it/findings/{finding_id}/create_ticket", json={})
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data.get("status") == "ticketed"
        assert "ticket" in data
        
        ticket = data["ticket"]
        assert "id" in ticket
        assert "ticket_number" in ticket
        assert ticket.get("category") == "security"
        assert ticket.get("source") == "shadow_it"
        
        # Verify priority matches risk level
        expected_priority = {"critical": "critical", "high": "high", "medium": "medium", "low": "low"}.get(finding_risk, "medium")
        assert ticket.get("priority") == expected_priority, f"Ticket priority should match finding risk"
        
        print(f"✓ Created ticket {ticket['ticket_number']} for finding {finding_id}")
    
    def test_action_invalid(self):
        """POST /api/shadow-it/findings/{id}/{invalid_action} returns 400"""
        # Get any finding
        findings_response = self.session.get(f"{BASE_URL}/api/shadow-it/findings?limit=1")
        findings = findings_response.json()
        
        if len(findings) == 0:
            pytest.skip("No findings available")
        
        finding_id = findings[0].get("id")
        
        response = self.session.post(f"{BASE_URL}/api/shadow-it/findings/{finding_id}/invalid_action", json={})
        assert response.status_code == 400
        print("✓ Invalid action returns 400")
    
    def test_action_finding_not_found(self):
        """POST /api/shadow-it/findings/{invalid_id}/approve returns 404"""
        response = self.session.post(f"{BASE_URL}/api/shadow-it/findings/non-existent-finding/approve", json={})
        assert response.status_code == 404
        print("✓ Non-existent finding returns 404")
    
    # ==================== AUTH TESTS ====================
    
    def test_endpoints_require_auth(self):
        """All Shadow IT endpoints require authentication"""
        no_auth_session = requests.Session()
        no_auth_session.headers.update({"Content-Type": "application/json"})
        
        endpoints = [
            ("GET", "/api/clients/client-001/shadow-it/baseline"),
            ("PUT", "/api/clients/client-001/shadow-it/baseline"),
            ("POST", "/api/shadow-it/scan"),
            ("GET", "/api/shadow-it/summary"),
            ("GET", "/api/shadow-it/findings"),
            ("POST", "/api/shadow-it/seed-demo"),
        ]
        
        for method, endpoint in endpoints:
            if method == "GET":
                response = no_auth_session.get(f"{BASE_URL}{endpoint}")
            elif method == "PUT":
                response = no_auth_session.put(f"{BASE_URL}{endpoint}", json={})
            else:
                response = no_auth_session.post(f"{BASE_URL}{endpoint}", json={})
            
            assert response.status_code in [401, 403], f"{method} {endpoint} should require auth, got {response.status_code}"
        
        print("✓ All endpoints require authentication")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
