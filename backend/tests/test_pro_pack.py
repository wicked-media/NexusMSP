"""
Pro-Pack Backend API Tests
Tests for: Service Catalog, Triage Queue, Notify Channels, API Tokens, 2FA, CRM Pipeline,
Customer Health, Quote-to-Cash, Patch Tuesday, DR Plans, SaaS Spend, Defender Health,
Stocktake Mobile, Cyber Insurance Export, NPS Summary, Asset Print Batch
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "aaron@stech.com.au",
        "password": "Lucky@2871$!"
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Authentication failed - skipping authenticated tests")

@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============== SERVICE CATALOG TESTS ==============
class TestServiceCatalog:
    """Service Catalog CRUD tests"""
    
    def test_list_services(self, headers):
        """GET /pro-pack/service-catalog returns 200"""
        r = requests.get(f"{BASE_URL}/api/pro-pack/service-catalog", headers=headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        print(f"✓ Service catalog list: {len(r.json())} services")
    
    def test_create_service(self, headers):
        """POST /pro-pack/service-catalog creates a service with SLA + price"""
        payload = {
            "name": "TEST_Managed Endpoint",
            "code": "TEST-ME",
            "category": "managed_services",
            "default_priority": "medium",
            "sla_response_hours": 2,
            "sla_resolve_hours": 8,
            "billing_unit_price": 25.00,
            "billing_unit": "month",
            "is_active": True
        }
        r = requests.post(f"{BASE_URL}/api/pro-pack/service-catalog", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "TEST_Managed Endpoint"
        assert data["code"] == "TEST-ME"
        assert data["sla_response_hours"] == 2
        assert data["sla_resolve_hours"] == 8
        assert data["billing_unit_price"] == 25.00
        assert "id" in data
        print(f"✓ Service created: {data['id']}")
        return data["id"]
    
    def test_update_service(self, headers):
        """PUT /pro-pack/service-catalog/{id} updates a service"""
        # First create a service
        create_r = requests.post(f"{BASE_URL}/api/pro-pack/service-catalog", json={
            "name": "TEST_Update Service",
            "code": "TEST-UPD",
            "sla_response_hours": 4,
            "billing_unit_price": 50.00
        }, headers=headers)
        assert create_r.status_code == 200
        sid = create_r.json()["id"]
        
        # Update it
        update_r = requests.put(f"{BASE_URL}/api/pro-pack/service-catalog/{sid}", json={
            "name": "TEST_Updated Service Name",
            "sla_response_hours": 1,
            "billing_unit_price": 75.00
        }, headers=headers)
        assert update_r.status_code == 200
        print(f"✓ Service updated: {sid}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/pro-pack/service-catalog/{sid}", headers=headers)
    
    def test_delete_service(self, headers):
        """DELETE /pro-pack/service-catalog/{id} removes a service"""
        # Create then delete
        create_r = requests.post(f"{BASE_URL}/api/pro-pack/service-catalog", json={
            "name": "TEST_Delete Service",
            "code": "TEST-DEL"
        }, headers=headers)
        assert create_r.status_code == 200
        sid = create_r.json()["id"]
        
        del_r = requests.delete(f"{BASE_URL}/api/pro-pack/service-catalog/{sid}", headers=headers)
        assert del_r.status_code == 200
        print(f"✓ Service deleted: {sid}")


# ============== TRIAGE QUEUE TESTS ==============
class TestTriageQueue:
    """Triage Queue tests"""
    
    def test_get_triage_queue(self, headers):
        """GET /pro-pack/triage-queue returns unassigned tickets"""
        r = requests.get(f"{BASE_URL}/api/pro-pack/triage-queue", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "count" in data
        assert "by_priority" in data
        assert "by_source" in data
        assert "oldest_age_minutes" in data
        print(f"✓ Triage queue: {data['count']} unassigned tickets")


# ============== NOTIFY CHANNELS TESTS ==============
class TestNotifyChannels:
    """Slack/Teams/Discord webhook channel tests"""
    
    def test_list_channels(self, headers):
        """GET /pro-pack/notify-channels returns 200"""
        r = requests.get(f"{BASE_URL}/api/pro-pack/notify-channels", headers=headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        print(f"✓ Notify channels list: {len(r.json())} channels")
    
    def test_create_channel(self, headers):
        """POST /pro-pack/notify-channels creates a channel"""
        payload = {
            "name": "TEST_Slack Channel",
            "kind": "slack",
            "webhook_url": "https://hooks.slack.com/services/TEST/TEST/TEST",
            "events": ["ticket_created", "sla_breach"]
        }
        r = requests.post(f"{BASE_URL}/api/pro-pack/notify-channels", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "TEST_Slack Channel"
        assert data["kind"] == "slack"
        assert "id" in data
        print(f"✓ Channel created: {data['id']}")
        return data["id"]
    
    def test_create_channel_invalid_url(self, headers):
        """POST /pro-pack/notify-channels with invalid URL returns 400"""
        payload = {
            "name": "Invalid Channel",
            "kind": "slack",
            "webhook_url": "not-a-url"
        }
        r = requests.post(f"{BASE_URL}/api/pro-pack/notify-channels", json=payload, headers=headers)
        assert r.status_code == 400
        print("✓ Invalid webhook URL correctly rejected")
    
    def test_test_channel(self, headers):
        """POST /pro-pack/notify-channels/{id}/test sends test message"""
        # Create a channel first
        create_r = requests.post(f"{BASE_URL}/api/pro-pack/notify-channels", json={
            "name": "TEST_Test Channel",
            "kind": "slack",
            "webhook_url": "https://hooks.slack.com/services/TEST/TEST/TEST"
        }, headers=headers)
        assert create_r.status_code == 200
        cid = create_r.json()["id"]
        
        # Test it (will likely fail with 502 since URL is fake, but shouldn't 500)
        test_r = requests.post(f"{BASE_URL}/api/pro-pack/notify-channels/{cid}/test", json={}, headers=headers)
        # Accept 200 (success), 400 (bad request), or 502 (webhook failed) - just not 500
        assert test_r.status_code in [200, 400, 502]
        print(f"✓ Channel test returned: {test_r.status_code}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/pro-pack/notify-channels/{cid}", headers=headers)
    
    def test_delete_channel(self, headers):
        """DELETE /pro-pack/notify-channels/{id} removes a channel"""
        create_r = requests.post(f"{BASE_URL}/api/pro-pack/notify-channels", json={
            "name": "TEST_Delete Channel",
            "kind": "teams",
            "webhook_url": "https://outlook.office.com/webhook/TEST"
        }, headers=headers)
        assert create_r.status_code == 200
        cid = create_r.json()["id"]
        
        del_r = requests.delete(f"{BASE_URL}/api/pro-pack/notify-channels/{cid}", headers=headers)
        assert del_r.status_code == 200
        print(f"✓ Channel deleted: {cid}")


# ============== API TOKENS TESTS ==============
class TestApiTokens:
    """API Token management tests"""
    
    def test_list_tokens(self, headers):
        """GET /pro-pack/api-tokens returns 200"""
        r = requests.get(f"{BASE_URL}/api/pro-pack/api-tokens", headers=headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        print(f"✓ API tokens list: {len(r.json())} tokens")
    
    def test_create_token_returns_raw(self, headers):
        """POST /pro-pack/api-tokens returns raw token only once"""
        payload = {
            "name": "TEST_API Token",
            "scopes": ["read", "write"]
        }
        r = requests.post(f"{BASE_URL}/api/pro-pack/api-tokens", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data  # Raw token returned on create
        assert "id" in data
        assert "secret_preview" in data
        assert data["name"] == "TEST_API Token"
        assert len(data["token"]) > 20  # Token should be substantial
        print(f"✓ Token created with raw value: {data['secret_preview']}")
        
        # Verify list doesn't return raw token
        list_r = requests.get(f"{BASE_URL}/api/pro-pack/api-tokens", headers=headers)
        tokens = list_r.json()
        for t in tokens:
            assert "secret" not in t or t.get("secret") is None  # Secret should be redacted
        print("✓ Token list correctly redacts secrets")
        
        # Cleanup - revoke
        requests.delete(f"{BASE_URL}/api/pro-pack/api-tokens/{data['id']}", headers=headers)
    
    def test_revoke_token(self, headers):
        """DELETE /pro-pack/api-tokens/{id} revokes a token"""
        create_r = requests.post(f"{BASE_URL}/api/pro-pack/api-tokens", json={
            "name": "TEST_Revoke Token",
            "scopes": ["read"]
        }, headers=headers)
        assert create_r.status_code == 200
        tid = create_r.json()["id"]
        
        revoke_r = requests.delete(f"{BASE_URL}/api/pro-pack/api-tokens/{tid}", headers=headers)
        assert revoke_r.status_code == 200
        print(f"✓ Token revoked: {tid}")


# ============== 2FA TESTS ==============
class Test2FA:
    """2FA TOTP setup and verification tests"""
    
    def test_setup_2fa(self, headers):
        """POST /pro-pack/2fa/setup returns secret + otpauth URI"""
        r = requests.post(f"{BASE_URL}/api/pro-pack/2fa/setup", json={}, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "secret" in data
        assert "otpauth_uri" in data
        assert data["otpauth_uri"].startswith("otpauth://totp/")
        assert "NexusOps" in data["otpauth_uri"]
        print(f"✓ 2FA setup returned secret: {data['secret'][:6]}...")
    
    def test_verify_2fa_wrong_code(self, headers):
        """POST /pro-pack/2fa/verify with wrong code returns 400"""
        # First setup
        requests.post(f"{BASE_URL}/api/pro-pack/2fa/setup", json={}, headers=headers)
        
        # Try wrong code
        r = requests.post(f"{BASE_URL}/api/pro-pack/2fa/verify", json={"code": "000000"}, headers=headers)
        assert r.status_code == 400
        print("✓ Wrong 2FA code correctly rejected")
    
    def test_disable_2fa(self, headers):
        """DELETE /pro-pack/2fa disables 2FA"""
        r = requests.delete(f"{BASE_URL}/api/pro-pack/2fa", headers=headers)
        assert r.status_code == 200
        print("✓ 2FA disabled")


# ============== CRM PIPELINE TESTS ==============
class TestCrmPipeline:
    """CRM Pipeline tests"""
    
    def test_get_pipeline(self, headers):
        """GET /pro-pack/crm/pipeline returns stages and leads"""
        r = requests.get(f"{BASE_URL}/api/pro-pack/crm/pipeline", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "stages" in data
        assert "buckets" in data
        assert "total_pipeline_value" in data
        assert len(data["stages"]) == 6  # new, qualified, proposal, negotiation, won, lost
        print(f"✓ CRM pipeline: {len(data['buckets'])} stages, ${data['total_pipeline_value']} value")
    
    def test_move_lead_stage(self, headers):
        """POST /pro-pack/crm/leads/{id}/move-stage moves a lead"""
        # First get a lead
        leads_r = requests.get(f"{BASE_URL}/api/leads", headers=headers)
        if leads_r.status_code != 200 or not leads_r.json():
            pytest.skip("No leads available to test move-stage")
        
        lead = leads_r.json()[0]
        lead_id = lead["id"]
        
        # Move to qualified
        r = requests.post(f"{BASE_URL}/api/pro-pack/crm/leads/{lead_id}/move-stage", 
                         json={"stage": "qualified"}, headers=headers)
        assert r.status_code == 200
        print(f"✓ Lead {lead_id} moved to qualified")
    
    def test_move_lead_invalid_stage(self, headers):
        """POST /pro-pack/crm/leads/{id}/move-stage with invalid stage returns 400"""
        leads_r = requests.get(f"{BASE_URL}/api/leads", headers=headers)
        if leads_r.status_code != 200 or not leads_r.json():
            pytest.skip("No leads available")
        
        lead_id = leads_r.json()[0]["id"]
        r = requests.post(f"{BASE_URL}/api/pro-pack/crm/leads/{lead_id}/move-stage",
                         json={"stage": "invalid_stage"}, headers=headers)
        assert r.status_code == 400
        print("✓ Invalid stage correctly rejected")


# ============== CUSTOMER HEALTH TESTS ==============
class TestCustomerHealth:
    """Customer Health Score tests"""
    
    def test_all_customer_health(self, headers):
        """GET /pro-pack/customer-health returns all clients with scores"""
        r = requests.get(f"{BASE_URL}/api/pro-pack/customer-health", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if data:
            assert "client_id" in data[0]
            assert "score" in data[0]
            assert "open_tickets" in data[0]
        print(f"✓ Customer health: {len(data)} clients")
    
    def test_single_customer_health(self, headers):
        """GET /pro-pack/customer-health/{client_id} returns detailed health"""
        # Get a client first
        clients_r = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        if clients_r.status_code != 200 or not clients_r.json():
            pytest.skip("No clients available")
        
        client_id = clients_r.json()[0]["id"]
        r = requests.get(f"{BASE_URL}/api/pro-pack/customer-health/{client_id}", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "score" in data
        assert "grade" in data
        assert "metrics" in data
        print(f"✓ Customer {data['client_name']}: score={data['score']}, grade={data['grade']}")


# ============== QUOTE TO CASH TESTS ==============
class TestQuoteToCash:
    """Quote-to-Cash pipeline tests"""
    
    def test_get_qtc_pipeline(self, headers):
        """GET /pro-pack/quote-to-cash returns pipeline summary"""
        r = requests.get(f"{BASE_URL}/api/pro-pack/quote-to-cash", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "leads" in data
        assert "estimates" in data
        assert "contracts" in data
        assert "invoices" in data
        assert "recurring" in data
        print(f"✓ Quote-to-Cash: leads={data['leads']['count']}, invoices={data['invoices']['count']}")


# ============== PATCH TUESDAY TESTS ==============
class TestPatchTuesday:
    """Patch Tuesday calendar tests"""
    
    def test_get_patch_tuesday(self, headers):
        """GET /pro-pack/patch-tuesday returns 12 month calendar"""
        r = requests.get(f"{BASE_URL}/api/pro-pack/patch-tuesday?months=12", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "events" in data
        assert len(data["events"]) == 12
        for event in data["events"]:
            assert "date" in event
            assert "month" in event
            assert "days_until" in event
        print(f"✓ Patch Tuesday: {len(data['events'])} months")


# ============== DR PLANS TESTS ==============
class TestDRPlans:
    """Disaster Recovery Plans tests"""
    
    def test_list_dr_plans(self, headers):
        """GET /pro-pack/dr-plans returns 200"""
        r = requests.get(f"{BASE_URL}/api/pro-pack/dr-plans", headers=headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        print(f"✓ DR plans: {len(r.json())} plans")
    
    def test_create_dr_plan(self, headers):
        """POST /pro-pack/dr-plans creates a plan with scenarios"""
        payload = {
            "name": "TEST_DR Plan",
            "rto_hours": 4,
            "rpo_hours": 1,
            "primary_contact": "John Doe",
            "after_hours_contact": "Jane Doe"
        }
        r = requests.post(f"{BASE_URL}/api/pro-pack/dr-plans", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "TEST_DR Plan"
        assert data["rto_hours"] == 4
        assert data["rpo_hours"] == 1
        assert "scenarios" in data
        assert len(data["scenarios"]) >= 3  # Default scenarios
        print(f"✓ DR plan created: {data['id']}")


# ============== SAAS SPEND TESTS ==============
class TestSaasSpend:
    """SaaS Spend Tracker tests"""
    
    def test_get_saas_spend(self, headers):
        """GET /pro-pack/saas-spend returns aggregated spend"""
        r = requests.get(f"{BASE_URL}/api/pro-pack/saas-spend", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "by_client" in data
        assert "grand_monthly" in data
        assert "grand_annual" in data
        print(f"✓ SaaS spend: ${data['grand_monthly']}/mo, ${data['grand_annual']}/yr")


# ============== DEFENDER HEALTH TESTS ==============
class TestDefenderHealth:
    """Defender/AV Health tests"""
    
    def test_get_defender_health(self, headers):
        """GET /pro-pack/defender-health returns AV status summary"""
        r = requests.get(f"{BASE_URL}/api/pro-pack/defender-health", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "summary" in data
        assert "by_client" in data
        assert "total_devices" in data["summary"]
        assert "healthy" in data["summary"]
        assert "unhealthy" in data["summary"]
        print(f"✓ Defender health: {data['summary']['total_devices']} devices, {data['summary']['coverage_pct']}% coverage")


# ============== STOCKTAKE MOBILE TESTS ==============
class TestStocktakeMobile:
    """Stocktake Mobile flow tests"""
    
    def test_stocktake_scan_not_found(self, headers):
        """POST /pro-pack/stocktake/scan with unknown SKU returns 404"""
        r = requests.post(f"{BASE_URL}/api/pro-pack/stocktake/scan", json={
            "sku_or_barcode": "NONEXISTENT-SKU-12345",
            "qty_counted": 5,
            "session_id": "test-session"
        }, headers=headers)
        assert r.status_code == 404
        print("✓ Unknown SKU correctly returns 404")
    
    def test_stocktake_session(self, headers):
        """GET /pro-pack/stocktake/session/{id} returns session data"""
        r = requests.get(f"{BASE_URL}/api/pro-pack/stocktake/session/test-session", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "session_id" in data
        assert "scans" in data
        assert "total_diff" in data
        print(f"✓ Stocktake session: {data['items_counted']} items")


# ============== NPS SUMMARY TESTS ==============
class TestNpsSummary:
    """NPS Summary tests"""
    
    def test_nps_summary(self, headers):
        """GET /pro-pack/nps/summary returns NPS score"""
        r = requests.get(f"{BASE_URL}/api/pro-pack/nps/summary?days=30", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "nps" in data
        assert "promoters" in data
        assert "passives" in data
        assert "detractors" in data
        assert "total_responses" in data
        print(f"✓ NPS summary: score={data['nps']}, responses={data['total_responses']}")


# ============== ASSET PRINT BATCH TESTS ==============
class TestAssetPrintBatch:
    """Asset Print Batch tests"""
    
    def test_print_batch_empty(self, headers):
        """POST /pro-pack/assets/print-batch with empty list returns 400"""
        r = requests.post(f"{BASE_URL}/api/pro-pack/assets/print-batch", json={
            "asset_ids": []
        }, headers=headers)
        assert r.status_code == 400
        print("✓ Empty asset list correctly rejected")
    
    def test_print_batch(self, headers):
        """POST /pro-pack/assets/print-batch returns asset data"""
        # Get some assets first
        assets_r = requests.get(f"{BASE_URL}/api/assets", headers=headers)
        if assets_r.status_code != 200 or not assets_r.json():
            pytest.skip("No assets available")
        
        asset_ids = [a["id"] for a in assets_r.json()[:3]]
        r = requests.post(f"{BASE_URL}/api/pro-pack/assets/print-batch", json={
            "asset_ids": asset_ids
        }, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "count" in data
        assert "assets" in data
        print(f"✓ Asset print batch: {data['count']} assets")


# ============== PHONE INTEGRATION TESTS ==============
class TestPhoneIntegration:
    """Phone Integration webhook tests"""
    
    def test_phone_inbound_webhook(self, headers):
        """POST /pro-pack/phone/inbound creates a ticket"""
        r = requests.post(f"{BASE_URL}/api/pro-pack/phone/inbound", json={
            "caller_number": "+61400000000",
            "caller_name": "Test Caller",
            "callee_number": "+61300000000"
        }, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "ticket_id" in data
        assert "ticket_number" in data
        print(f"✓ Phone inbound created ticket: {data['ticket_number']}")


# ============== CLEANUP ==============
@pytest.fixture(scope="module", autouse=True)
def cleanup(headers):
    """Cleanup TEST_ prefixed data after all tests"""
    yield
    # Cleanup services
    try:
        services = requests.get(f"{BASE_URL}/api/pro-pack/service-catalog", headers=headers).json()
        for s in services:
            if s.get("name", "").startswith("TEST_") or s.get("code", "").startswith("TEST"):
                requests.delete(f"{BASE_URL}/api/pro-pack/service-catalog/{s['id']}", headers=headers)
    except:
        pass
    
    # Cleanup channels
    try:
        channels = requests.get(f"{BASE_URL}/api/pro-pack/notify-channels", headers=headers).json()
        for c in channels:
            if c.get("name", "").startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/pro-pack/notify-channels/{c['id']}", headers=headers)
    except:
        pass
    
    print("\n✓ Cleanup completed")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
