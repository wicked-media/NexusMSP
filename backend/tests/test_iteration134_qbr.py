"""
Iteration 134: QBR Auto-Generator Tests
Tests for Quarterly Business Review generation, save, list, get, and PDF export endpoints.
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestQBRAuth:
    """Authentication for QBR tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        """Headers with auth token"""
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestQBRGenerate(TestQBRAuth):
    """Tests for GET /api/qbr/{client_id} - QBR generation"""
    
    def test_generate_qbr_with_quarter(self, headers):
        """Test QBR generation with explicit quarter parameter"""
        response = requests.get(f"{BASE_URL}/api/qbr/client-001?quarter=2026-Q1", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        # Verify required fields
        assert data["quarter"] == "2026-Q1"
        assert data["client_id"] == "client-001"
        assert data["client_name"] == "Acme Corporation"
        assert "stats" in data
        assert "sections" in data
        assert "generated_at" in data
        assert data["ai_model"] == "claude-sonnet-4-5-20250929"
        
        # Verify stats structure
        stats = data["stats"]
        assert "tix_total" in stats
        assert "by_priority" in stats
        assert all(k in stats["by_priority"] for k in ["critical", "high", "medium", "low"])
        assert "top_issues" in stats
        assert "sla_breaches" in stats
        assert "resolved_this_q" in stats
        assert "devices" in stats
        assert all(k in stats["devices"] for k in ["online", "warning", "offline", "total"])
        assert "backup" in stats
        assert all(k in stats["backup"] for k in ["healthy", "failed"])
        assert "critical_alerts" in stats
        assert "spend" in stats
        assert "pattern_hits" in stats
        
        # Verify sections structure (AI-generated)
        sections = data["sections"]
        assert "executive_summary" in sections
        assert "key_wins" in sections
        assert "incident_breakdown" in sections
        assert "infrastructure_health" in sections
        assert "risks_and_recommendations" in sections
        assert "msp_intelligence" in sections
        assert "next_quarter_focus" in sections
        
        print(f"QBR generated successfully: {data['quarter']} for {data['client_name']}")
        print(f"Stats: {stats['tix_total']} tickets, {stats['devices']['total']} devices")
    
    def test_generate_qbr_without_quarter_defaults_to_recent(self, headers):
        """Test QBR generation without quarter param defaults to most recently completed quarter"""
        response = requests.get(f"{BASE_URL}/api/qbr/client-001", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        # Should have a valid quarter format
        assert "quarter" in data
        assert data["quarter"].startswith("202")  # Year 202x
        assert "-Q" in data["quarter"]
        
        # In Jan 2026, should default to 2025-Q4 or 2026-Q1 depending on current date
        # The code uses most recently completed quarter
        print(f"Default quarter: {data['quarter']}")
    
    def test_generate_qbr_invalid_quarter_format(self, headers):
        """Test QBR generation with invalid quarter format returns 400"""
        response = requests.get(f"{BASE_URL}/api/qbr/client-001?quarter=invalid", headers=headers)
        assert response.status_code == 400
        assert "YYYY-Q[1-4]" in response.json()["detail"]
    
    def test_generate_qbr_invalid_quarter_q5(self, headers):
        """Test QBR generation with Q5 returns 400"""
        response = requests.get(f"{BASE_URL}/api/qbr/client-001?quarter=2026-Q5", headers=headers)
        assert response.status_code == 400
    
    def test_generate_qbr_invalid_client(self, headers):
        """Test QBR generation with non-existent client returns 404"""
        response = requests.get(f"{BASE_URL}/api/qbr/invalid-client?quarter=2026-Q1", headers=headers)
        assert response.status_code == 404
        assert "Client not found" in response.json()["detail"]
    
    def test_generate_qbr_unauthorized(self):
        """Test QBR generation without auth returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/qbr/client-001?quarter=2026-Q1")
        assert response.status_code in [401, 403]


class TestQBRSave(TestQBRAuth):
    """Tests for POST /api/qbr/{client_id}/save - Save QBR"""
    
    def test_save_qbr_success(self, headers):
        """Test saving a QBR with valid data"""
        payload = {
            "quarter": "2026-Q1",
            "sections": {
                "executive_summary": "TEST_QBR: Test executive summary",
                "key_wins": ["Win 1", "Win 2", "Win 3"],
                "incident_breakdown": {"paragraph": "Test breakdown", "sla_assessment": "on_track"},
                "infrastructure_health": "Test infra health",
                "risks_and_recommendations": [
                    {"area": "Security", "risk": "Test risk", "recommendation": "Test rec"}
                ],
                "msp_intelligence": "Test MSP intelligence",
                "next_quarter_focus": ["Focus 1", "Focus 2"]
            },
            "stats": {
                "tix_total": 25,
                "by_priority": {"critical": 5, "high": 10, "medium": 8, "low": 2},
                "sla_breaches": 2,
                "devices": {"online": 15, "warning": 3, "offline": 2, "total": 20}
            }
        }
        
        response = requests.post(f"{BASE_URL}/api/qbr/client-001/save", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "id" in data
        assert data["id"].startswith("qbr-")
        assert data["client_id"] == "client-001"
        assert data["client_name"] == "Acme Corporation"
        assert data["quarter"] == "2026-Q1"
        assert data["sections"]["executive_summary"] == "TEST_QBR: Test executive summary"
        assert "saved_at" in data
        assert "saved_by" in data
        
        print(f"QBR saved with ID: {data['id']}")
        return data["id"]
    
    def test_save_qbr_missing_quarter(self, headers):
        """Test saving QBR without quarter returns 400"""
        payload = {
            "sections": {"executive_summary": "Test"}
        }
        response = requests.post(f"{BASE_URL}/api/qbr/client-001/save", json=payload, headers=headers)
        assert response.status_code == 400
        assert "quarter and sections required" in response.json()["detail"]
    
    def test_save_qbr_missing_sections(self, headers):
        """Test saving QBR without sections returns 400"""
        payload = {
            "quarter": "2026-Q1"
        }
        response = requests.post(f"{BASE_URL}/api/qbr/client-001/save", json=payload, headers=headers)
        assert response.status_code == 400
        assert "quarter and sections required" in response.json()["detail"]
    
    def test_save_qbr_unauthorized(self):
        """Test saving QBR without auth returns 401/403"""
        payload = {"quarter": "2026-Q1", "sections": {"executive_summary": "Test"}}
        response = requests.post(f"{BASE_URL}/api/qbr/client-001/save", json=payload)
        assert response.status_code in [401, 403]


class TestQBRList(TestQBRAuth):
    """Tests for GET /api/qbr/{client_id}/list - List saved QBRs"""
    
    def test_list_qbrs_success(self, headers):
        """Test listing saved QBRs for a client"""
        response = requests.get(f"{BASE_URL}/api/qbr/client-001/list", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list)
        
        if len(data) > 0:
            qbr = data[0]
            assert "id" in qbr
            assert "client_id" in qbr
            assert "quarter" in qbr
            assert "saved_at" in qbr
            # sections and stats should be excluded from list
            assert "sections" not in qbr
            assert "stats" not in qbr
            
            # Verify sorted by saved_at desc
            if len(data) > 1:
                assert data[0]["saved_at"] >= data[1]["saved_at"]
        
        print(f"Found {len(data)} saved QBRs for client-001")
    
    def test_list_qbrs_unauthorized(self):
        """Test listing QBRs without auth returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/qbr/client-001/list")
        assert response.status_code in [401, 403]


class TestQBRGet(TestQBRAuth):
    """Tests for GET /api/qbrs/{qbr_id} - Get saved QBR"""
    
    def test_get_qbr_success(self, headers):
        """Test getting a saved QBR by ID"""
        # First save a QBR
        save_payload = {
            "quarter": "2026-Q1",
            "sections": {"executive_summary": "TEST_GET_QBR: Test summary"},
            "stats": {"tix_total": 5}
        }
        save_response = requests.post(f"{BASE_URL}/api/qbr/client-001/save", json=save_payload, headers=headers)
        assert save_response.status_code == 200
        qbr_id = save_response.json()["id"]
        
        # Now get it
        response = requests.get(f"{BASE_URL}/api/qbrs/{qbr_id}", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert data["id"] == qbr_id
        assert data["client_id"] == "client-001"
        assert data["quarter"] == "2026-Q1"
        assert "sections" in data
        assert "stats" in data
        assert data["sections"]["executive_summary"] == "TEST_GET_QBR: Test summary"
        
        print(f"Retrieved QBR: {qbr_id}")
    
    def test_get_qbr_not_found(self, headers):
        """Test getting non-existent QBR returns 404"""
        response = requests.get(f"{BASE_URL}/api/qbrs/qbr-nonexistent", headers=headers)
        assert response.status_code == 404
        assert "QBR not found" in response.json()["detail"]
    
    def test_get_qbr_unauthorized(self):
        """Test getting QBR without auth returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/qbrs/qbr-test")
        assert response.status_code in [401, 403]


class TestQBRPdf(TestQBRAuth):
    """Tests for GET /api/qbrs/{qbr_id}/pdf - PDF export"""
    
    def test_pdf_download_success(self, auth_token, headers):
        """Test PDF download with valid token"""
        # First save a QBR
        save_payload = {
            "quarter": "2026-Q1",
            "sections": {
                "executive_summary": "TEST_PDF: Executive summary for PDF test",
                "key_wins": ["Win 1", "Win 2"],
                "incident_breakdown": "Test incident breakdown",
                "infrastructure_health": "Test infra health",
                "risks_and_recommendations": [{"area": "Test", "risk": "Risk", "recommendation": "Rec"}],
                "msp_intelligence": "Test MSP intel",
                "next_quarter_focus": ["Focus 1"]
            },
            "stats": {"tix_total": 10, "by_priority": {"critical": 2, "high": 3, "medium": 4, "low": 1}}
        }
        save_response = requests.post(f"{BASE_URL}/api/qbr/client-001/save", json=save_payload, headers=headers)
        assert save_response.status_code == 200
        qbr_id = save_response.json()["id"]
        
        # Download PDF using token query param (not Bearer header)
        response = requests.get(f"{BASE_URL}/api/qbrs/{qbr_id}/pdf?token={auth_token}")
        assert response.status_code == 200, f"Failed: {response.status_code}"
        
        # Verify content type
        assert "application/pdf" in response.headers.get("Content-Type", "")
        
        # Verify PDF header
        assert response.content[:8] == b"%PDF-1.3" or response.content[:8].startswith(b"%PDF")
        
        # Verify content disposition
        content_disp = response.headers.get("Content-Disposition", "")
        assert "attachment" in content_disp
        assert ".pdf" in content_disp
        
        print(f"PDF downloaded: {len(response.content)} bytes")
    
    def test_pdf_without_token(self):
        """Test PDF download without token returns 401"""
        response = requests.get(f"{BASE_URL}/api/qbrs/qbr-test/pdf")
        assert response.status_code == 401
        assert "Token required" in response.json()["detail"]
    
    def test_pdf_invalid_token(self):
        """Test PDF download with invalid token returns 401"""
        response = requests.get(f"{BASE_URL}/api/qbrs/qbr-test/pdf?token=invalid-token")
        assert response.status_code == 401
    
    def test_pdf_qbr_not_found(self, auth_token):
        """Test PDF download for non-existent QBR returns 404"""
        response = requests.get(f"{BASE_URL}/api/qbrs/qbr-nonexistent/pdf?token={auth_token}")
        assert response.status_code == 404
        assert "QBR not found" in response.json()["detail"]


class TestQBRPatternHits(TestQBRAuth):
    """Tests for pattern_hits in QBR stats"""
    
    def test_pattern_hits_structure(self, headers):
        """Test that pattern_hits has correct structure when present"""
        response = requests.get(f"{BASE_URL}/api/qbr/client-001?quarter=2026-Q1", headers=headers)
        assert response.status_code == 200
        
        data = response.json()
        pattern_hits = data["stats"]["pattern_hits"]
        assert isinstance(pattern_hits, list)
        
        # If there are pattern hits, verify structure
        for hit in pattern_hits:
            assert "name" in hit
            assert "tokens" in hit
            assert isinstance(hit["tokens"], list)
            assert "client_tickets" in hit
            assert "msp_tickets" in hit
            assert "msp_clients" in hit
        
        print(f"Pattern hits: {len(pattern_hits)}")


class TestBlueprintTrendsRegression(TestQBRAuth):
    """Regression tests for /api/blueprint-patterns/trends"""
    
    def test_trends_endpoint_still_works(self, headers):
        """Verify blueprint-patterns/trends endpoint still works"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns/trends", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "rising" in data
        assert "window_days" in data
        assert isinstance(data["rising"], list)
        
        print(f"Trends endpoint working: {len(data['rising'])} rising patterns")


class TestBlueprintsRegression(TestQBRAuth):
    """Regression tests for /api/blueprints"""
    
    def test_blueprints_list_still_works(self, headers):
        """Verify blueprints list endpoint still works"""
        response = requests.get(f"{BASE_URL}/api/blueprints", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list)
        
        print(f"Blueprints endpoint working: {len(data)} blueprints")
    
    def test_blueprint_patterns_still_works(self, headers):
        """Verify blueprint-patterns endpoint still works"""
        response = requests.get(f"{BASE_URL}/api/blueprint-patterns?limit=5", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        # Endpoint returns {patterns: [], total_scanned, window}
        assert "patterns" in data
        assert isinstance(data["patterns"], list)
        
        print(f"Blueprint patterns endpoint working: {len(data['patterns'])} patterns")


# Cleanup fixture
@pytest.fixture(scope="module", autouse=True)
def cleanup_test_qbrs():
    """Cleanup TEST_ prefixed QBRs after tests"""
    yield
    # Note: In production, we'd delete TEST_ prefixed QBRs here
    # For now, we leave them as they don't affect other tests
