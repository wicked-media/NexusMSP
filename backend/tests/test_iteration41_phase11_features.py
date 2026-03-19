"""
Phase 11 - 15 MSP Features Backend API Tests
Testing all 15 new features: KB, Timeline, Compliance, RPE, Dispatch, Contract Profit,
Vendor Scorecard, IT Roadmap, Warranty Tracker, Client Compare, Skills Matrix,
Approval Workflows, Asset Depreciation, Postmortem Generator, CSAT Surveys
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


@pytest.fixture(scope="session")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="session")
def auth_token(api_client):
    """Get authentication token"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": "admin123"
    })
    assert response.status_code == 200, f"Auth failed: {response.text}"
    return response.json().get("token")


@pytest.fixture(scope="session")
def authenticated_client(api_client, auth_token):
    """Session with auth header"""
    api_client.headers.update({"Authorization": f"Bearer {auth_token}"})
    return api_client


@pytest.fixture(scope="session")
def test_client_id(authenticated_client):
    """Get a test client ID"""
    response = authenticated_client.get(f"{BASE_URL}/api/clients")
    if response.status_code == 200:
        clients = response.json()
        if clients and len(clients) > 0:
            return clients[0].get("id")
    pytest.skip("No clients available for testing")


@pytest.fixture(scope="session")
def test_ticket_id(authenticated_client):
    """Get a test ticket ID"""
    response = authenticated_client.get(f"{BASE_URL}/api/tickets")
    if response.status_code == 200:
        tickets = response.json()
        if tickets and len(tickets) > 0:
            return tickets[0].get("id")
    pytest.skip("No tickets available for testing")


@pytest.fixture(scope="session")
def test_user_id(authenticated_client):
    """Get a test user ID"""
    response = authenticated_client.get(f"{BASE_URL}/api/technicians")
    if response.status_code == 200:
        techs = response.json()
        if techs and len(techs) > 0:
            return techs[0].get("id")
    pytest.skip("No technicians available for testing")


# =============================================================================
# 1. AI-Powered Knowledge Base Tests
# =============================================================================
class TestKnowledgeBase:
    """Test KB articles CRUD and search"""

    def test_get_kb_articles(self, authenticated_client):
        """GET /api/kb/articles - returns list of KB articles"""
        response = authenticated_client.get(f"{BASE_URL}/api/kb/articles")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"KB: Found {len(data)} articles")

    def test_create_kb_article(self, authenticated_client):
        """POST /api/kb/articles - create new KB article"""
        payload = {
            "title": "TEST_How to Reset Network Switch",
            "content": "## Steps\n1. Locate the reset button\n2. Press for 10 seconds",
            "category": "networking",
            "tags": ["network", "switch", "reset"]
        }
        response = authenticated_client.post(f"{BASE_URL}/api/kb/articles", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["title"] == payload["title"]
        assert data["category"] == "networking"
        print(f"KB: Created article {data['id']}")

    def test_search_kb(self, authenticated_client):
        """GET /api/kb/search?q=test - search KB articles"""
        response = authenticated_client.get(f"{BASE_URL}/api/kb/search?q=network")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"KB: Search returned {len(data)} results for 'network'")


# =============================================================================
# 2. Client Communication Timeline Tests
# =============================================================================
class TestClientTimeline:
    """Test client unified timeline"""

    def test_get_client_timeline(self, authenticated_client, test_client_id):
        """GET /api/client-timeline/{client_id} - returns unified timeline"""
        response = authenticated_client.get(f"{BASE_URL}/api/client-timeline/{test_client_id}")
        assert response.status_code == 200
        data = response.json()
        assert "client" in data
        assert "events" in data
        assert "total_events" in data
        print(f"Timeline: Client {test_client_id} has {data['total_events']} events")


# =============================================================================
# 3. Automated Compliance Reporting Tests
# =============================================================================
class TestCompliance:
    """Test compliance frameworks and scanning"""

    def test_get_frameworks(self, authenticated_client):
        """GET /api/compliance/frameworks - returns list of frameworks"""
        response = authenticated_client.get(f"{BASE_URL}/api/compliance/frameworks")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 2  # At least CIS and HIPAA
        frameworks = [f["id"] for f in data]
        assert "cis" in frameworks
        print(f"Compliance: Found frameworks: {frameworks}")

    def test_scan_client_cis(self, authenticated_client, test_client_id):
        """GET /api/compliance/scan/{client_id}?framework=cis - scan client compliance"""
        response = authenticated_client.get(f"{BASE_URL}/api/compliance/scan/{test_client_id}?framework=cis")
        assert response.status_code == 200
        data = response.json()
        assert "score" in data
        assert "controls" in data
        assert "passed" in data
        assert "total" in data
        print(f"Compliance: Client {test_client_id} CIS score: {data['score']}% ({data['passed']}/{data['total']})")

    def test_get_compliance_reports(self, authenticated_client):
        """GET /api/compliance/reports - list saved reports"""
        response = authenticated_client.get(f"{BASE_URL}/api/compliance/reports")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Compliance: Found {len(data)} reports")


# =============================================================================
# 4. Real-Time RPE Dashboard Tests
# =============================================================================
class TestRPEDashboard:
    """Test Revenue Per Endpoint dashboard"""

    def test_get_rpe_dashboard(self, authenticated_client):
        """GET /api/rpe/dashboard - returns RPE data with summary"""
        response = authenticated_client.get(f"{BASE_URL}/api/rpe/dashboard")
        assert response.status_code == 200
        data = response.json()
        assert "clients" in data
        assert "summary" in data
        summary = data["summary"]
        assert "total_revenue" in summary
        assert "total_endpoints" in summary
        assert "avg_rpe" in summary
        assert "target_rpe" in summary
        print(f"RPE: {len(data['clients'])} clients, avg RPE ${summary['avg_rpe']}")


# =============================================================================
# 5. Intelligent Dispatch Board Tests
# =============================================================================
class TestDispatchBoard:
    """Test dispatch board and job assignment"""

    def test_get_dispatch_board(self, authenticated_client):
        """GET /api/dispatch/board - returns jobs, techs, suggestions"""
        response = authenticated_client.get(f"{BASE_URL}/api/dispatch/board")
        assert response.status_code == 200
        data = response.json()
        assert "jobs" in data
        assert "technicians" in data
        assert "suggestions" in data
        assert "stats" in data
        print(f"Dispatch: {len(data['jobs'])} jobs, {len(data['technicians'])} techs, {len(data['suggestions'])} suggestions")

    def test_dispatch_assign(self, authenticated_client, test_ticket_id, test_user_id):
        """POST /api/dispatch/assign - assign a job to a tech"""
        if not test_ticket_id or not test_user_id:
            pytest.skip("No ticket or user for testing")
        payload = {"ticket_id": test_ticket_id, "tech_id": test_user_id}
        response = authenticated_client.post(f"{BASE_URL}/api/dispatch/assign", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        print(f"Dispatch: Assigned ticket {test_ticket_id} to tech {test_user_id}")


# =============================================================================
# 6. Contract Profitability Analyzer Tests
# =============================================================================
class TestContractProfit:
    """Test contract profitability analysis"""

    def test_get_contract_profit_overview(self, authenticated_client):
        """GET /api/contract-profit/overview - analyze contract profitability"""
        response = authenticated_client.get(f"{BASE_URL}/api/contract-profit/overview")
        assert response.status_code == 200
        data = response.json()
        assert "contracts" in data
        assert "summary" in data
        summary = data["summary"]
        assert "total_contracts" in summary
        assert "profitable" in summary
        assert "net" in summary
        print(f"Contract Profit: {summary['total_contracts']} contracts, net ${summary['net']}")


# =============================================================================
# 7. Vendor Scorecard & Spend Analytics Tests
# =============================================================================
class TestVendorScorecard:
    """Test vendor performance scorecard"""

    def test_get_vendor_scorecard_overview(self, authenticated_client):
        """GET /api/vendor-scorecard/overview - vendor performance scores"""
        response = authenticated_client.get(f"{BASE_URL}/api/vendor-scorecard/overview")
        assert response.status_code == 200
        data = response.json()
        assert "vendors" in data
        assert "summary" in data
        summary = data["summary"]
        assert "total_vendors" in summary
        assert "total_spend" in summary
        print(f"Vendor Scorecard: {summary['total_vendors']} vendors, ${summary['total_spend']} total spend")


# =============================================================================
# 8. Client IT Roadmap Builder Tests
# =============================================================================
class TestITRoadmap:
    """Test IT roadmap CRUD operations"""

    def test_get_all_roadmaps(self, authenticated_client):
        """GET /api/it-roadmap - list all client roadmaps"""
        response = authenticated_client.get(f"{BASE_URL}/api/it-roadmap")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"IT Roadmap: {len(data)} clients with roadmaps")

    def test_get_client_roadmap(self, authenticated_client, test_client_id):
        """GET /api/it-roadmap/{client_id} - get client roadmap items"""
        response = authenticated_client.get(f"{BASE_URL}/api/it-roadmap/{test_client_id}")
        assert response.status_code == 200
        data = response.json()
        assert "client" in data
        assert "items" in data
        print(f"IT Roadmap: Client {test_client_id} has {len(data['items'])} items")

    def test_add_roadmap_item(self, authenticated_client, test_client_id):
        """POST /api/it-roadmap/{client_id} - add roadmap item"""
        payload = {
            "title": "TEST_Server Upgrade",
            "description": "Upgrade to Windows Server 2025",
            "category": "upgrade",
            "target_date": "2026-06-01",
            "quarter": "Q2 2026",
            "estimated_cost": 5000,
            "priority": "high"
        }
        response = authenticated_client.post(f"{BASE_URL}/api/it-roadmap/{test_client_id}", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["title"] == payload["title"]
        print(f"IT Roadmap: Added item {data['id']} for client {test_client_id}")


# =============================================================================
# 9. Automated Warranty Tracker Tests
# =============================================================================
class TestWarrantyTracker:
    """Test warranty tracking"""

    def test_get_warranty_overview(self, authenticated_client):
        """GET /api/warranty/overview - returns warranty categorized by status"""
        response = authenticated_client.get(f"{BASE_URL}/api/warranty/overview")
        assert response.status_code == 200
        data = response.json()
        assert "expired" in data
        assert "expiring_soon" in data
        assert "active" in data
        assert "unknown" in data
        assert "stats" in data
        stats = data["stats"]
        print(f"Warranty: {stats['total']} devices - {stats['active']} active, {stats['expiring_soon']} expiring, {stats['expired']} expired")


# =============================================================================
# 10. Multi-Tenant Client Comparison Dashboard Tests
# =============================================================================
class TestClientCompare:
    """Test client comparison dashboard"""

    def test_get_client_compare(self, authenticated_client):
        """GET /api/client-compare - multi-tenant comparison dashboard"""
        response = authenticated_client.get(f"{BASE_URL}/api/client-compare")
        assert response.status_code == 200
        data = response.json()
        assert "clients" in data
        assert "total" in data
        if data["clients"]:
            client = data["clients"][0]
            assert "client_id" in client
            assert "total_tickets" in client
            assert "devices" in client
            assert "monthly_revenue" in client
            assert "rpe" in client
        print(f"Client Compare: {data['total']} clients compared")


# =============================================================================
# 11. Technician Skills Matrix Tests
# =============================================================================
class TestSkillsMatrix:
    """Test technician skills matrix"""

    def test_get_skills_matrix(self, authenticated_client):
        """GET /api/skills-matrix - technician skills matrix"""
        response = authenticated_client.get(f"{BASE_URL}/api/skills-matrix")
        assert response.status_code == 200
        data = response.json()
        assert "technicians" in data
        assert "all_skills" in data
        print(f"Skills Matrix: {len(data['technicians'])} techs, skills: {data['all_skills']}")

    def test_update_skills(self, authenticated_client, test_user_id):
        """PUT /api/skills-matrix/{user_id} - update tech skills"""
        if not test_user_id:
            pytest.skip("No user for testing")
        payload = {
            "skills": {"networking": 4, "server": 5, "cloud": 3},
            "certifications": ["CCNA", "Azure"]
        }
        response = authenticated_client.put(f"{BASE_URL}/api/skills-matrix/{test_user_id}", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        print(f"Skills Matrix: Updated skills for user {test_user_id}")


# =============================================================================
# 12. Approval Workflows Engine Tests
# =============================================================================
class TestApprovalWorkflows:
    """Test approval workflows engine"""

    def test_get_pending_approvals(self, authenticated_client):
        """GET /api/approvals - pending approvals"""
        response = authenticated_client.get(f"{BASE_URL}/api/approvals")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Approvals: {len(data)} pending approvals")

    def test_get_all_approvals(self, authenticated_client):
        """GET /api/approvals/all - all approvals"""
        response = authenticated_client.get(f"{BASE_URL}/api/approvals/all")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Approvals: {len(data)} total approvals")

    def test_get_workflows(self, authenticated_client):
        """GET /api/approvals/workflows - approval workflow rules"""
        response = authenticated_client.get(f"{BASE_URL}/api/approvals/workflows")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1  # At least default workflows
        print(f"Approvals: {len(data)} workflows configured")

    def test_create_approval(self, authenticated_client):
        """POST /api/approvals - create approval request"""
        payload = {
            "type": "purchase",
            "title": "TEST_Laptop Purchase",
            "description": "New laptop for dev team",
            "amount": 1500
        }
        response = authenticated_client.post(f"{BASE_URL}/api/approvals", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["status"] == "pending"
        assert data["title"] == payload["title"]
        print(f"Approvals: Created approval {data['id']}")
        return data["id"]

    def test_approve_request(self, authenticated_client):
        """POST /api/approvals/{id}/approve - approve request"""
        # First create one
        payload = {"type": "test", "title": "TEST_Auto Approve", "amount": 100}
        create_resp = authenticated_client.post(f"{BASE_URL}/api/approvals", json=payload)
        approval_id = create_resp.json().get("id")
        
        # Then approve
        response = authenticated_client.post(f"{BASE_URL}/api/approvals/{approval_id}/approve", json={"note": "Approved by test"})
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        print(f"Approvals: Approved {approval_id}")


# =============================================================================
# 13. Asset Depreciation & Refresh Planner Tests
# =============================================================================
class TestAssetDepreciation:
    """Test asset depreciation schedule"""

    def test_get_asset_depreciation(self, authenticated_client):
        """GET /api/asset-depreciation - asset depreciation schedule"""
        response = authenticated_client.get(f"{BASE_URL}/api/asset-depreciation")
        assert response.status_code == 200
        data = response.json()
        assert "assets" in data
        assert "stats" in data
        stats = data["stats"]
        assert "total" in stats
        assert "end_of_life" in stats
        assert "refresh_soon" in stats
        print(f"Asset Depreciation: {stats['total']} assets, {stats['end_of_life']} EOL, {stats['refresh_soon']} refresh soon")


# =============================================================================
# 14. Incident Post-Mortem Generator Tests
# =============================================================================
class TestPostmortem:
    """Test incident post-mortem generator"""

    def test_get_postmortems(self, authenticated_client):
        """GET /api/postmortem - list postmortems"""
        response = authenticated_client.get(f"{BASE_URL}/api/postmortem")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Postmortem: {len(data)} postmortems found")

    def test_generate_postmortem(self, authenticated_client, test_ticket_id):
        """POST /api/postmortem/generate/{ticket_id} - generate AI postmortem"""
        if not test_ticket_id:
            pytest.skip("No ticket for testing")
        response = authenticated_client.post(f"{BASE_URL}/api/postmortem/generate/{test_ticket_id}")
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "title" in data
        assert "ticket_id" in data
        print(f"Postmortem: Generated {data['id']} for ticket {test_ticket_id}")


# =============================================================================
# 15. Client Satisfaction Pulse Surveys Tests
# =============================================================================
class TestCSATSurveys:
    """Test CSAT surveys"""

    def test_get_csat_dashboard(self, authenticated_client):
        """GET /api/csat/dashboard - CSAT dashboard"""
        response = authenticated_client.get(f"{BASE_URL}/api/csat/dashboard")
        assert response.status_code == 200
        data = response.json()
        assert "avg_score" in data
        assert "total_responses" in data
        print(f"CSAT: Avg score {data['avg_score']}, {data['total_responses']} responses")

    def test_get_csat_surveys(self, authenticated_client):
        """GET /api/csat/surveys - list survey responses"""
        response = authenticated_client.get(f"{BASE_URL}/api/csat/surveys")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"CSAT: {len(data)} survey responses")

    def test_submit_csat(self, authenticated_client, test_client_id, test_ticket_id, test_user_id):
        """POST /api/csat/submit - submit a CSAT response"""
        payload = {
            "ticket_id": test_ticket_id or "t-test",
            "ticket_title": "Test Ticket",
            "client_id": test_client_id or "c-test",
            "client_name": "Test Client",
            "tech_id": test_user_id or "u-test",
            "tech_name": "Test Tech",
            "score": 5,
            "comment": "TEST_Excellent service!"
        }
        response = authenticated_client.post(f"{BASE_URL}/api/csat/submit", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["score"] == 5
        print(f"CSAT: Submitted survey {data['id']}")

    def test_seed_demo_data(self, authenticated_client):
        """POST /api/csat/seed-demo - seed demo CSAT data"""
        response = authenticated_client.post(f"{BASE_URL}/api/csat/seed-demo")
        assert response.status_code == 200
        data = response.json()
        assert "seeded" in data
        print(f"CSAT: Seeded {data['seeded']} demo surveys")


# =============================================================================
# Run tests
# =============================================================================
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
