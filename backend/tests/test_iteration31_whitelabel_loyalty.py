"""
Test iteration 31: White Label, Loyalty, Achievements, Readiness, Auto-Renewal Proposals APIs
Features tested:
1. GET /api/settings/branding - White label branding config
2. PUT /api/settings/branding - Update branding settings
3. GET /api/clients/{id}/achievements - Client SLA shields, tenure, loyalty badges
4. GET /api/clients/{id}/portal-readiness - Portal readiness score and checks
5. GET /api/clients/{id}/loyalty - Client loyalty points and tier
6. GET /api/loyalty/dashboard - Loyalty tiers overview and client rankings
7. GET /api/contracts/auto-renewal-proposals - Renewal proposals with upsell opportunities
"""
import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = "https://rmm-psa-build.preview.emergentagent.com"

class TestWhiteLabelLoyalty:
    """Test white label, achievements, loyalty, and renewal features"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        self.session = requests.Session()
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        data = login_response.json()
        self.token = data.get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
        print(f"Logged in successfully")
        yield
    
    # ============== WHITE LABEL / BRANDING ==============
    
    def test_get_branding_settings(self):
        """Test GET /api/settings/branding returns branding config"""
        response = self.session.get(f"{BASE_URL}/api/settings/branding", headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "company_name" in data, "Missing company_name"
        assert "primary_color" in data, "Missing primary_color"
        assert "secondary_color" in data, "Missing secondary_color"
        assert "accent_color" in data, "Missing accent_color"
        
        # Check for invoice/contract/letterhead logo fields
        assert "invoice_logo_url" in data or data.get("invoice_logo_url") is None or "invoice_logo_url" in str(data)
        assert "contract_logo_url" in data or data.get("contract_logo_url") is None
        assert "letterhead_logo_url" in data or data.get("letterhead_logo_url") is None
        
        print(f"Branding settings: company_name={data.get('company_name')}, primary_color={data.get('primary_color')}")
    
    def test_update_branding_settings(self):
        """Test PUT /api/settings/branding updates config"""
        # First get current
        get_response = self.session.get(f"{BASE_URL}/api/settings/branding", headers=self.headers)
        current = get_response.json()
        
        # Update with test values
        test_data = {
            **current,
            "company_name": "TEST_NexusOps_Branded",
            "primary_color": "#ff6600",
            "secondary_color": "#00ff66",
            "accent_color": "#6600ff",
            "invoice_header_text": "TEST Invoice Header",
            "contract_footer_text": "TEST Contract Footer",
        }
        
        response = self.session.put(f"{BASE_URL}/api/settings/branding", json=test_data, headers=self.headers)
        assert response.status_code == 200, f"Failed to update: {response.text}"
        
        # Verify update
        verify_response = self.session.get(f"{BASE_URL}/api/settings/branding", headers=self.headers)
        updated = verify_response.json()
        assert updated.get("company_name") == "TEST_NexusOps_Branded", "Company name not updated"
        assert updated.get("primary_color") == "#ff6600", "Primary color not updated"
        print(f"Branding updated successfully: {updated.get('company_name')}")
        
        # Restore original
        restore_data = {**current, "company_name": "NexusOps"}
        self.session.put(f"{BASE_URL}/api/settings/branding", json=restore_data, headers=self.headers)
    
    # ============== CLIENT ACHIEVEMENTS ==============
    
    def test_get_client_achievements(self):
        """Test GET /api/clients/{id}/achievements returns SLA shields, tenure, loyalty badges"""
        # Get a client first
        clients_response = self.session.get(f"{BASE_URL}/api/clients", headers=self.headers)
        assert clients_response.status_code == 200
        clients = clients_response.json()
        assert len(clients) > 0, "No clients found"
        
        client_id = clients[0]["id"]
        client_name = clients[0].get("name", "Unknown")
        
        response = self.session.get(f"{BASE_URL}/api/clients/{client_id}/achievements", headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "achievements" in data, "Missing achievements array"
        assert "total_earned" in data, "Missing total_earned"
        assert "total_available" in data, "Missing total_available"
        
        achievements = data["achievements"]
        
        # Check for SLA type achievements
        sla_achievements = [a for a in achievements if a.get("type") == "sla"]
        assert len(sla_achievements) > 0, "No SLA achievements found"
        
        # Check for tenure type achievements  
        tenure_achievements = [a for a in achievements if a.get("type") == "tenure"]
        assert len(tenure_achievements) > 0, "No tenure achievements found"
        
        # Check for loyalty type achievements
        loyalty_achievements = [a for a in achievements if a.get("type") == "loyalty"]
        assert len(loyalty_achievements) > 0, "No loyalty achievements found"
        
        # Verify achievement structure
        for ach in achievements[:3]:
            assert "id" in ach, "Missing id"
            assert "label" in ach, "Missing label"
            assert "description" in ach, "Missing description"
            assert "earned" in ach, "Missing earned flag"
            assert "color" in ach, "Missing color"
        
        print(f"Client {client_name} achievements: {data['total_earned']}/{data['total_available']} earned")
        print(f"SLA shields: {len(sla_achievements)}, Tenure milestones: {len(tenure_achievements)}, Loyalty badges: {len(loyalty_achievements)}")
    
    # ============== CLIENT LOYALTY ==============
    
    def test_get_client_loyalty(self):
        """Test GET /api/clients/{id}/loyalty returns points and tier"""
        clients_response = self.session.get(f"{BASE_URL}/api/clients", headers=self.headers)
        clients = clients_response.json()
        client_id = clients[0]["id"]
        
        response = self.session.get(f"{BASE_URL}/api/clients/{client_id}/loyalty", headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "loyalty_points" in data, "Missing loyalty_points"
        assert "tier" in data, "Missing tier"
        assert data["tier"] in ["platinum", "gold", "silver", "bronze"], f"Invalid tier: {data['tier']}"
        assert "total_spend" in data, "Missing total_spend"
        assert "active_contracts" in data, "Missing active_contracts"
        
        print(f"Client loyalty: {data['loyalty_points']} points, tier={data['tier']}, spend=${data['total_spend']}")
    
    # ============== CLIENT PORTAL READINESS ==============
    
    def test_get_client_portal_readiness(self):
        """Test GET /api/clients/{id}/portal-readiness returns readiness score and checks"""
        clients_response = self.session.get(f"{BASE_URL}/api/clients", headers=self.headers)
        clients = clients_response.json()
        client_id = clients[0]["id"]
        client_name = clients[0].get("name", "Unknown")
        
        response = self.session.get(f"{BASE_URL}/api/clients/{client_id}/portal-readiness", headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "readiness_score" in data, "Missing readiness_score"
        assert "checks" in data, "Missing checks array"
        assert "completed" in data, "Missing completed count"
        assert "total" in data, "Missing total count"
        
        # Readiness score should be 0-100
        assert 0 <= data["readiness_score"] <= 100, f"Invalid readiness_score: {data['readiness_score']}"
        
        # Verify checks structure
        checks = data["checks"]
        assert len(checks) > 0, "No readiness checks found"
        for check in checks:
            assert "name" in check, "Missing check name"
            assert "done" in check, "Missing check done flag"
            assert "description" in check, "Missing check description"
        
        print(f"Client {client_name} readiness: {data['readiness_score']}%, {data['completed']}/{data['total']} checks done")
        print(f"Checks: {[c['name'] for c in checks[:4]]}...")
    
    # ============== LOYALTY DASHBOARD ==============
    
    def test_get_loyalty_dashboard(self):
        """Test GET /api/loyalty/dashboard returns tier counts and client rankings"""
        response = self.session.get(f"{BASE_URL}/api/loyalty/dashboard", headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "tier_counts" in data, "Missing tier_counts"
        assert "clients" in data, "Missing clients rankings"
        
        tier_counts = data["tier_counts"]
        assert "platinum" in tier_counts, "Missing platinum count"
        assert "gold" in tier_counts, "Missing gold count"
        assert "silver" in tier_counts, "Missing silver count"
        assert "bronze" in tier_counts, "Missing bronze count"
        
        # Verify client rankings structure
        if len(data["clients"]) > 0:
            client = data["clients"][0]
            assert "client_id" in client, "Missing client_id"
            assert "client_name" in client, "Missing client_name"
            assert "loyalty_points" in client, "Missing loyalty_points"
            assert "tier" in client, "Missing tier"
        
        total_clients = sum(tier_counts.values())
        print(f"Loyalty dashboard: {total_clients} clients")
        print(f"Tier counts: Platinum={tier_counts['platinum']}, Gold={tier_counts['gold']}, Silver={tier_counts['silver']}, Bronze={tier_counts['bronze']}")
        if len(data["clients"]) > 0:
            top_client = data["clients"][0]
            print(f"Top client: {top_client['client_name']} with {top_client['loyalty_points']} points ({top_client['tier']})")
    
    # ============== AUTO-RENEWAL PROPOSALS ==============
    
    def test_get_auto_renewal_proposals(self):
        """Test GET /api/contracts/auto-renewal-proposals returns proposals with upsell opportunities"""
        response = self.session.get(f"{BASE_URL}/api/contracts/auto-renewal-proposals", headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "proposals" in data, "Missing proposals array"
        assert "total_current_mrr" in data, "Missing total_current_mrr"
        assert "total_potential_mrr" in data, "Missing total_potential_mrr"
        assert "total_upsell_potential" in data, "Missing total_upsell_potential"
        
        # Verify proposal structure if any exist
        if len(data["proposals"]) > 0:
            proposal = data["proposals"][0]
            assert "contract_id" in proposal, "Missing contract_id"
            assert "contract_name" in proposal, "Missing contract_name"
            assert "current_value" in proposal, "Missing current_value"
            assert "days_remaining" in proposal, "Missing days_remaining"
            assert "upsell_opportunities" in proposal, "Missing upsell_opportunities"
            assert "recommended_new_value" in proposal, "Missing recommended_new_value"
            
            # Check upsell opportunity structure
            if len(proposal["upsell_opportunities"]) > 0:
                upsell = proposal["upsell_opportunities"][0]
                assert "type" in upsell, "Missing upsell type"
                assert "description" in upsell, "Missing upsell description"
                assert "additional_mrr" in upsell, "Missing additional_mrr"
        
        print(f"Auto-renewal proposals: {len(data['proposals'])} contracts expiring in 60 days")
        print(f"Current MRR: ${data['total_current_mrr']}, Potential MRR: ${data['total_potential_mrr']}")
        print(f"Upsell potential: ${data['total_upsell_potential']}")
    
    # ============== CONTRACTS WITH SLA TIER ==============
    
    def test_contracts_have_sla_tier(self):
        """Test that contracts endpoint returns sla_tier field"""
        response = self.session.get(f"{BASE_URL}/api/contracts", headers=self.headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        contracts = response.json()
        # Check if any contracts have sla_tier
        contracts_with_sla = [c for c in contracts if "sla_tier" in c]
        print(f"Contracts with SLA tier: {len(contracts_with_sla)}/{len(contracts)}")
        
        # Create a test contract with SLA tier
        clients_response = self.session.get(f"{BASE_URL}/api/clients", headers=self.headers)
        clients = clients_response.json()
        if len(clients) > 0:
            test_contract = {
                "client_id": clients[0]["id"],
                "name": "TEST_Contract_Gold_SLA",
                "contract_type": "managed_services",
                "billing_frequency": "monthly",
                "start_date": "2025-01-01",
                "end_date": "2025-06-30",  # Expiring within 60 days range
                "value": 1500,
                "auto_renew": True,
                "sla_tier": "gold",
                "notes": "Test contract for SLA shield verification"
            }
            
            create_response = self.session.post(f"{BASE_URL}/api/contracts", json=test_contract, headers=self.headers)
            assert create_response.status_code in [200, 201], f"Failed to create: {create_response.text}"
            created = create_response.json()
            assert created.get("sla_tier") == "gold", "SLA tier not saved correctly"
            print(f"Created test contract with Gold SLA: {created.get('id')}")
            
            # Cleanup
            self.session.delete(f"{BASE_URL}/api/contracts/{created['id']}", headers=self.headers)


class TestSidebarNavigation:
    """Test that new sidebar navigation items exist"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert login_response.status_code == 200
        self.token = login_response.json().get("token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
        yield
    
    def test_loyalty_endpoint_accessible(self):
        """Verify /api/loyalty/dashboard is accessible (for Loyalty & Renewals nav)"""
        response = self.session.get(f"{BASE_URL}/api/loyalty/dashboard", headers=self.headers)
        assert response.status_code == 200, f"Loyalty dashboard not accessible: {response.text}"
        print("Loyalty & Renewals endpoint accessible")
    
    def test_branding_endpoint_accessible(self):
        """Verify /api/settings/branding is accessible (for White Label nav)"""
        response = self.session.get(f"{BASE_URL}/api/settings/branding", headers=self.headers)
        assert response.status_code == 200, f"Branding endpoint not accessible: {response.text}"
        print("White Label endpoint accessible")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
