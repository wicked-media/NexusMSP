"""
Iteration 89 - Proposals, Contracts & Portal API Testing
Tests for:
1. Proposal Builder: CRUD, stats, send/accept/decline/duplicate/convert-to-contract
2. Contract Enhancements: link-recurring, apply-price-increase, price-history
3. Client Portal API: invoices, devices/health, summary
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_headers():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    token = response.json().get("token")
    return {"Authorization": f"Bearer {token}"}


class TestProposalStats:
    """Test GET /api/proposals/stats"""
    
    def test_get_proposal_stats(self, auth_headers):
        """Stats should return total, by_status, total_value, won_value, pipeline_value, win_rate"""
        response = requests.get(f"{BASE_URL}/api/proposals/stats", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify all required fields
        assert "total" in data, "Missing 'total' field"
        assert "by_status" in data, "Missing 'by_status' field"
        assert "total_value" in data, "Missing 'total_value' field"
        assert "won_value" in data, "Missing 'won_value' field"
        assert "pipeline_value" in data, "Missing 'pipeline_value' field"
        assert "win_rate" in data, "Missing 'win_rate' field"
        
        # Verify by_status has expected statuses
        by_status = data["by_status"]
        for status in ["draft", "sent", "viewed", "accepted", "declined", "expired", "converted"]:
            assert status in by_status, f"Missing status '{status}' in by_status"
        
        print(f"PASS: Proposal stats - total={data['total']}, pipeline=${data['pipeline_value']}, won=${data['won_value']}, win_rate={data['win_rate']}%")


class TestProposalCRUD:
    """Test Proposal CRUD operations"""
    
    def test_get_proposals_list(self, auth_headers):
        """GET /api/proposals should return list"""
        response = requests.get(f"{BASE_URL}/api/proposals", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list of proposals"
        print(f"PASS: GET /api/proposals returned {len(data)} proposals")
    
    def test_create_proposal_with_line_items(self, auth_headers):
        """POST /api/proposals creates proposal with recurring + one_time line items"""
        # First get a client
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=auth_headers)
        assert clients_resp.status_code == 200
        clients = clients_resp.json()
        assert len(clients) > 0, "No clients found for testing"
        client = clients[0]
        
        proposal_data = {
            "client_id": client["id"],
            "title": f"TEST_Proposal_{uuid.uuid4().hex[:6]}",
            "description": "Test proposal with mixed billing types",
            "valid_until": "2026-03-01",
            "tax_percent": 10,
            "line_items": [
                {
                    "description": "Managed IT Services",
                    "quantity": 1,
                    "rate": 2500,
                    "amount": 2500,
                    "total": 2500,
                    "unit_price": 2500,
                    "billing_type": "recurring"
                },
                {
                    "description": "Setup Fee",
                    "quantity": 1,
                    "rate": 500,
                    "amount": 500,
                    "total": 500,
                    "unit_price": 500,
                    "billing_type": "one_time"
                }
            ]
        }
        
        response = requests.post(f"{BASE_URL}/api/proposals", json=proposal_data, headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "id" in data, "Missing proposal ID"
        assert data["client_id"] == client["id"]
        assert data["title"] == proposal_data["title"]
        assert len(data.get("line_items", [])) == 2
        assert data["subtotal"] == 3000  # 2500 + 500
        assert data["tax_amount"] == 300  # 10% of 3000
        assert data["total"] == 3300  # 3000 + 300
        
        print(f"PASS: Created proposal {data['id']} with total=${data['total']}")
        return data["id"]
    
    def test_get_single_proposal(self, auth_headers):
        """GET /api/proposals/{id} returns proposal details"""
        # Create a proposal first
        proposal_id = self.test_create_proposal_with_line_items(auth_headers)
        
        response = requests.get(f"{BASE_URL}/api/proposals/{proposal_id}", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data["id"] == proposal_id
        print(f"PASS: GET single proposal {proposal_id}")
    
    def test_delete_proposal(self, auth_headers):
        """DELETE /api/proposals/{id} deletes proposal"""
        # Create a proposal first
        proposal_id = self.test_create_proposal_with_line_items(auth_headers)
        
        response = requests.delete(f"{BASE_URL}/api/proposals/{proposal_id}", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        # Verify deleted
        get_resp = requests.get(f"{BASE_URL}/api/proposals/{proposal_id}", headers=auth_headers)
        assert get_resp.status_code == 404, "Proposal should be deleted"
        print(f"PASS: Deleted proposal {proposal_id}")


class TestProposalLifecycle:
    """Test proposal lifecycle: send → accept/decline → convert"""
    
    def _create_test_proposal(self, auth_headers):
        """Helper to create a test proposal"""
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=auth_headers)
        clients = clients_resp.json()
        client = clients[0]
        
        proposal_data = {
            "client_id": client["id"],
            "title": f"TEST_Lifecycle_{uuid.uuid4().hex[:6]}",
            "tax_percent": 10,
            "line_items": [
                {"description": "Monthly Support", "quantity": 1, "rate": 1500, "amount": 1500, "total": 1500, "unit_price": 1500, "billing_type": "recurring"},
            ]
        }
        response = requests.post(f"{BASE_URL}/api/proposals", json=proposal_data, headers=auth_headers)
        assert response.status_code == 200
        return response.json()["id"]
    
    def test_send_proposal(self, auth_headers):
        """POST /api/proposals/{id}/send marks proposal as sent"""
        proposal_id = self._create_test_proposal(auth_headers)
        
        response = requests.post(f"{BASE_URL}/api/proposals/{proposal_id}/send", json={}, headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        # Verify status changed
        get_resp = requests.get(f"{BASE_URL}/api/proposals/{proposal_id}", headers=auth_headers)
        assert get_resp.json()["status"] == "sent"
        print(f"PASS: Sent proposal {proposal_id}")
        return proposal_id
    
    def test_accept_proposal(self, auth_headers):
        """POST /api/proposals/{id}/accept marks proposal as accepted"""
        proposal_id = self.test_send_proposal(auth_headers)
        
        response = requests.post(f"{BASE_URL}/api/proposals/{proposal_id}/accept", json={}, headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        # Verify status changed
        get_resp = requests.get(f"{BASE_URL}/api/proposals/{proposal_id}", headers=auth_headers)
        assert get_resp.json()["status"] == "accepted"
        print(f"PASS: Accepted proposal {proposal_id}")
        return proposal_id
    
    def test_decline_proposal(self, auth_headers):
        """POST /api/proposals/{id}/decline marks proposal as declined"""
        proposal_id = self.test_send_proposal(auth_headers)
        
        response = requests.post(f"{BASE_URL}/api/proposals/{proposal_id}/decline", json={}, headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        # Verify status changed
        get_resp = requests.get(f"{BASE_URL}/api/proposals/{proposal_id}", headers=auth_headers)
        assert get_resp.json()["status"] == "declined"
        print(f"PASS: Declined proposal {proposal_id}")
    
    def test_duplicate_proposal(self, auth_headers):
        """POST /api/proposals/{id}/duplicate clones proposal as draft"""
        proposal_id = self._create_test_proposal(auth_headers)
        
        response = requests.post(f"{BASE_URL}/api/proposals/{proposal_id}/duplicate", json={}, headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["id"] != proposal_id, "Duplicate should have new ID"
        assert data["status"] == "draft", "Duplicate should be draft"
        assert "(Copy)" in data["title"], "Duplicate should have (Copy) in title"
        print(f"PASS: Duplicated proposal {proposal_id} → {data['id']}")
    
    def test_convert_to_contract(self, auth_headers):
        """POST /api/proposals/{id}/convert-to-contract creates contract + recurring invoice"""
        # Create and accept a proposal
        proposal_id = self.test_accept_proposal(auth_headers)
        
        response = requests.post(f"{BASE_URL}/api/proposals/{proposal_id}/convert-to-contract", json={}, headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "contract_id" in data, "Missing contract_id in response"
        assert "recurring_invoice_id" in data, "Missing recurring_invoice_id in response"
        assert "message" in data
        
        # Verify proposal status changed to converted
        get_resp = requests.get(f"{BASE_URL}/api/proposals/{proposal_id}", headers=auth_headers)
        assert get_resp.json()["status"] == "converted"
        
        # Verify contract was created
        contract_resp = requests.get(f"{BASE_URL}/api/contracts/{data['contract_id']}", headers=auth_headers)
        assert contract_resp.status_code == 200, "Contract should exist"
        
        # Verify recurring invoice was created (if MRR > 0)
        if data["recurring_invoice_id"]:
            ri_resp = requests.get(f"{BASE_URL}/api/recurring-invoices/{data['recurring_invoice_id']}", headers=auth_headers)
            assert ri_resp.status_code == 200, "Recurring invoice should exist"
        
        print(f"PASS: Converted proposal {proposal_id} → contract {data['contract_id']}, RI {data['recurring_invoice_id']}")


class TestContractEnhancements:
    """Test contract link-recurring, price-increase, price-history"""
    
    def test_link_contract_to_recurring(self, auth_headers):
        """POST /api/contracts/{id}/link-recurring links contract to recurring invoice"""
        # Get existing contract
        contracts_resp = requests.get(f"{BASE_URL}/api/contracts", headers=auth_headers)
        assert contracts_resp.status_code == 200
        contracts = contracts_resp.json()
        
        if not contracts:
            pytest.skip("No contracts available for testing")
        
        contract = contracts[0]
        
        # Get existing recurring invoice
        ri_resp = requests.get(f"{BASE_URL}/api/recurring-invoices/list", headers=auth_headers)
        assert ri_resp.status_code == 200
        ris = ri_resp.json()
        
        if not ris:
            pytest.skip("No recurring invoices available for testing")
        
        ri = ris[0]
        
        response = requests.post(
            f"{BASE_URL}/api/contracts/{contract['id']}/link-recurring",
            json={"recurring_invoice_id": ri["id"]},
            headers=auth_headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data
        print(f"PASS: Linked contract {contract['id']} to RI {ri['id']}")
    
    def test_get_contract_recurring_invoices(self, auth_headers):
        """GET /api/contracts/{id}/recurring-invoices returns linked RIs"""
        # Use contract-001 which should have linked RIs
        response = requests.get(f"{BASE_URL}/api/contracts/contract-001/recurring-invoices", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list of recurring invoices"
        print(f"PASS: Contract contract-001 has {len(data)} linked recurring invoices")
    
    def test_apply_price_increase(self, auth_headers):
        """POST /api/contracts/{id}/apply-price-increase applies percentage increase"""
        # Get a contract first
        contracts_resp = requests.get(f"{BASE_URL}/api/contracts", headers=auth_headers)
        contracts = contracts_resp.json()
        
        if not contracts:
            pytest.skip("No contracts available")
        
        contract = contracts[0]
        old_value = contract.get("value", 0)
        
        response = requests.post(
            f"{BASE_URL}/api/contracts/{contract['id']}/apply-price-increase",
            json={"increase_percent": 5, "reason": "Annual CPI adjustment"},
            headers=auth_headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "old_value" in data
        assert "new_value" in data
        assert data["new_value"] > data["old_value"], "New value should be higher"
        print(f"PASS: Applied 5% increase to contract {contract['id']}: ${data['old_value']} → ${data['new_value']}")
    
    def test_get_price_history(self, auth_headers):
        """GET /api/contracts/{id}/price-history returns price increase history"""
        # Get a contract that has had price increases
        contracts_resp = requests.get(f"{BASE_URL}/api/contracts", headers=auth_headers)
        contracts = contracts_resp.json()
        
        if not contracts:
            pytest.skip("No contracts available")
        
        contract = contracts[0]
        
        response = requests.get(f"{BASE_URL}/api/contracts/{contract['id']}/price-history", headers=auth_headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list of price history entries"
        print(f"PASS: Contract {contract['id']} has {len(data)} price history entries")
    
    def test_price_increase_validation(self, auth_headers):
        """Price increase should fail with invalid data"""
        contracts_resp = requests.get(f"{BASE_URL}/api/contracts", headers=auth_headers)
        contracts = contracts_resp.json()
        
        if not contracts:
            pytest.skip("No contracts available")
        
        contract = contracts[0]
        
        # Test with no increase values
        response = requests.post(
            f"{BASE_URL}/api/contracts/{contract['id']}/apply-price-increase",
            json={"reason": "Test"},
            headers=auth_headers
        )
        assert response.status_code == 400, "Should fail without increase values"
        print("PASS: Price increase validation works")


class TestClientPortalAPI:
    """Test portal-api endpoints for client self-service"""
    
    @pytest.fixture(scope="class")
    def portal_token(self, auth_headers):
        """Generate a portal token for testing"""
        # Get a client
        clients_resp = requests.get(f"{BASE_URL}/api/clients", headers=auth_headers)
        clients = clients_resp.json()
        
        if not clients:
            pytest.skip("No clients available")
        
        client = clients[0]
        
        # Generate portal token
        response = requests.post(
            f"{BASE_URL}/api/client-portal/generate-token/{client['id']}",
            json={"contact_name": "Test Contact", "contact_email": "test@example.com", "expiry_days": 30},
            headers=auth_headers
        )
        assert response.status_code == 200, f"Failed to generate token: {response.text}"
        data = response.json()
        return data["token"]
    
    def test_portal_get_invoices(self, auth_headers, portal_token):
        """GET /api/portal-api/{token}/invoices returns client invoices"""
        response = requests.get(f"{BASE_URL}/api/portal-api/{portal_token}/invoices")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list of invoices"
        print(f"PASS: Portal invoices returned {len(data)} invoices")
    
    def test_portal_get_device_health(self, auth_headers, portal_token):
        """GET /api/portal-api/{token}/devices/health returns device health summary"""
        response = requests.get(f"{BASE_URL}/api/portal-api/{portal_token}/devices/health")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "total" in data, "Missing 'total' field"
        assert "online" in data, "Missing 'online' field"
        assert "offline" in data, "Missing 'offline' field"
        assert "warning" in data, "Missing 'warning' field"
        assert "devices" in data, "Missing 'devices' field"
        
        print(f"PASS: Portal device health - total={data['total']}, online={data['online']}, offline={data['offline']}")
    
    def test_portal_get_summary(self, auth_headers, portal_token):
        """GET /api/portal-api/{token}/summary returns full client summary"""
        response = requests.get(f"{BASE_URL}/api/portal-api/{portal_token}/summary")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "client" in data, "Missing 'client' field"
        assert "devices" in data, "Missing 'devices' field"
        assert "tickets" in data, "Missing 'tickets' field"
        assert "invoices" in data, "Missing 'invoices' field"
        
        # Verify nested structure
        assert "total" in data["devices"]
        assert "online" in data["devices"]
        assert "total" in data["tickets"]
        assert "open" in data["tickets"]
        assert "total" in data["invoices"]
        assert "outstanding" in data["invoices"]
        
        print(f"PASS: Portal summary - devices={data['devices']['total']}, tickets={data['tickets']['total']}, invoices={data['invoices']['total']}")
    
    def test_portal_invalid_token(self):
        """Portal API should return 404 for invalid token"""
        response = requests.get(f"{BASE_URL}/api/portal-api/invalid_token_12345/invoices")
        assert response.status_code == 404, "Should return 404 for invalid token"
        print("PASS: Invalid portal token returns 404")


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_proposals(self, auth_headers):
        """Delete TEST_ prefixed proposals"""
        response = requests.get(f"{BASE_URL}/api/proposals", headers=auth_headers)
        if response.status_code == 200:
            proposals = response.json()
            deleted = 0
            for p in proposals:
                if p.get("title", "").startswith("TEST_"):
                    del_resp = requests.delete(f"{BASE_URL}/api/proposals/{p['id']}", headers=auth_headers)
                    if del_resp.status_code == 200:
                        deleted += 1
            print(f"PASS: Cleaned up {deleted} test proposals")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
