"""
Phase G Testing - 5 New Features:
1. Dashboard Builder - Custom drag-and-drop widgets
2. Channel/MSP-of-MSPs Mode - White-label tenants  
3. Mobile Tech Dashboard - Tech daily view
4. SOC Realtime Feed - Live security events
5. MRR/ARR Revenue Tracker - Financial metrics
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Get authentication token for tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@nexusops.io",
            "password": os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.json()["token"]
    
    @pytest.fixture(scope="class")
    def headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestDashboardBuilder(TestAuth):
    """Dashboard Builder - Custom drag-and-drop widgets"""
    
    def test_get_layouts(self, headers):
        """GET /api/dashboard-builder/layouts - Returns layouts with widget catalog"""
        response = requests.get(f"{BASE_URL}/api/dashboard-builder/layouts", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Should have layouts array
        assert "layouts" in data
        assert isinstance(data["layouts"], list)
        assert len(data["layouts"]) >= 3, "Should have at least 3 default layouts"
        
        # Should have widget catalog
        assert "available_widgets" in data
        assert isinstance(data["available_widgets"], list)
        assert len(data["available_widgets"]) >= 12, "Should have at least 12 widget types"
        
        # Check first layout structure
        layout = data["layouts"][0]
        assert "layout_id" in layout
        assert "name" in layout
        assert "widgets" in layout
        assert "columns" in layout
        print(f"✓ Dashboard Builder: {len(data['layouts'])} layouts, {len(data['available_widgets'])} widget types")
    
    def test_get_specific_layout(self, headers):
        """GET /api/dashboard-builder/layout/{layout_id} - Get specific layout"""
        response = requests.get(f"{BASE_URL}/api/dashboard-builder/layout/default-ops", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "layout_id" in data
        assert "widgets" in data
        assert isinstance(data["widgets"], list)
        print(f"✓ Dashboard Builder: Retrieved layout '{data.get('name', 'N/A')}' with {len(data['widgets'])} widgets")
    
    def test_save_layout(self, headers):
        """POST /api/dashboard-builder/layout - Save new layout"""
        test_layout = {
            "layout_id": "TEST-phase-g-layout",
            "name": "Test Phase G Layout",
            "widgets": [
                {"id": "tw1", "type": "stat_card", "title": "Test Widget", "position": {"x": 0, "y": 0, "w": 1, "h": 1}}
            ],
            "columns": 3
        }
        response = requests.post(f"{BASE_URL}/api/dashboard-builder/layout", json=test_layout, headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("status") == "saved"
        assert "layout_id" in data
        print(f"✓ Dashboard Builder: Saved layout '{test_layout['name']}'")
    
    def test_delete_layout(self, headers):
        """DELETE /api/dashboard-builder/layout/{layout_id} - Remove layout"""
        response = requests.delete(f"{BASE_URL}/api/dashboard-builder/layout/TEST-phase-g-layout", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "deleted"
        print("✓ Dashboard Builder: Deleted test layout")


class TestChannelMode(TestAuth):
    """Channel/MSP-of-MSPs Mode - White-label tenant management"""
    
    def test_get_tenants(self, headers):
        """GET /api/channel-mode/tenants - Returns tenants with summary stats"""
        response = requests.get(f"{BASE_URL}/api/channel-mode/tenants", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Should have tenants array
        assert "tenants" in data
        assert isinstance(data["tenants"], list)
        assert len(data["tenants"]) >= 8, "Should have at least 8 tenants"
        
        # Should have summary stats
        assert "summary" in data
        summary = data["summary"]
        assert "total_tenants" in summary
        assert "active" in summary
        assert "total_endpoints" in summary
        assert "total_mrr" in summary
        assert "avg_margin" in summary
        
        # Verify tenant structure
        tenant = data["tenants"][0]
        assert "tenant_id" in tenant
        assert "name" in tenant
        assert "tier" in tenant
        assert "mrr" in tenant
        assert "endpoint_count" in tenant
        assert "margin_pct" in tenant
        
        print(f"✓ Channel Mode: {summary['total_tenants']} tenants, ${summary['total_mrr']:,} total MRR, {summary['total_endpoints']} endpoints")
    
    def test_get_channel_revenue(self, headers):
        """GET /api/channel-mode/revenue - Revenue breakdown by tier"""
        response = requests.get(f"{BASE_URL}/api/channel-mode/revenue", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "monthly_trend" in data
        assert "by_tier" in data
        assert "top_tenants" in data
        
        # Verify tier breakdown
        by_tier = data["by_tier"]
        assert "enterprise" in by_tier
        assert "professional" in by_tier
        assert "standard" in by_tier
        
        print(f"✓ Channel Mode Revenue: Enterprise ${by_tier['enterprise']:,}, Professional ${by_tier['professional']:,}, Standard ${by_tier['standard']:,}")
    
    def test_create_tenant(self, headers):
        """POST /api/channel-mode/tenant - Create new tenant"""
        new_tenant = {
            "name": "TEST Phase G MSP",
            "admin_email": "test@phaseg.com",
            "tier": "professional"
        }
        response = requests.post(f"{BASE_URL}/api/channel-mode/tenant", json=new_tenant, headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("status") == "created"
        assert "tenant" in data
        assert data["tenant"]["name"] == "TEST Phase G MSP"
        assert data["tenant"]["tier"] == "professional"
        print(f"✓ Channel Mode: Created tenant '{new_tenant['name']}'")
    
    def test_get_specific_tenant(self, headers):
        """GET /api/channel-mode/tenant/{tenant_id} - Get specific tenant"""
        # First get list to get a real tenant_id
        response = requests.get(f"{BASE_URL}/api/channel-mode/tenants", headers=headers)
        tenants = response.json()["tenants"]
        tenant_id = tenants[0]["tenant_id"]
        
        response = requests.get(f"{BASE_URL}/api/channel-mode/tenant/{tenant_id}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "tenant_id" in data
        assert "name" in data
        assert "features_enabled" in data
        print(f"✓ Channel Mode: Retrieved tenant '{data['name']}'")


class TestMobileTech(TestAuth):
    """Mobile Tech Dashboard - Tech daily view"""
    
    def test_get_my_day(self, headers):
        """GET /api/mobile-tech/my-day - Tech's daily schedule and stats"""
        response = requests.get(f"{BASE_URL}/api/mobile-tech/my-day", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Check required fields
        assert "date" in data
        assert "tech_name" in data
        assert "assigned_tickets" in data
        assert "stats" in data
        assert "schedule" in data
        assert "quick_actions" in data
        
        # Verify stats structure
        stats = data["stats"]
        assert "tickets_today" in stats
        assert "completed_today" in stats
        assert "avg_response_min" in stats
        assert "satisfaction" in stats
        
        # Verify schedule
        assert isinstance(data["schedule"], list)
        assert len(data["schedule"]) >= 1
        
        print(f"✓ Mobile Tech My Day: {stats['tickets_today']} tickets, {len(data['schedule'])} scheduled items, CSAT: {stats['satisfaction']}")
    
    def test_get_queue(self, headers):
        """GET /api/mobile-tech/queue - Tech ticket queue"""
        response = requests.get(f"{BASE_URL}/api/mobile-tech/queue", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "queue" in data
        assert isinstance(data["queue"], list)
        assert "filters" in data
        
        if data["queue"]:
            ticket = data["queue"][0]
            assert "ticket_id" in ticket
            assert "title" in ticket
            assert "priority" in ticket
            assert "status" in ticket
        
        print(f"✓ Mobile Tech Queue: {len(data['queue'])} tickets in queue")
    
    def test_get_notifications(self, headers):
        """GET /api/mobile-tech/notifications - Tech alerts"""
        response = requests.get(f"{BASE_URL}/api/mobile-tech/notifications", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "notifications" in data
        assert "unread_count" in data
        assert isinstance(data["notifications"], list)
        
        if data["notifications"]:
            notif = data["notifications"][0]
            assert "id" in notif
            assert "type" in notif
            assert "title" in notif
            assert "read" in notif
        
        print(f"✓ Mobile Tech Notifications: {len(data['notifications'])} notifications, {data['unread_count']} unread")
    
    def test_log_time_entry(self, headers):
        """POST /api/mobile-tech/time-entry - Log time entry"""
        time_entry = {
            "ticket_id": "TK-4500",
            "duration_min": 45,
            "notes": "TEST Phase G time entry",
            "billable": True
        }
        response = requests.post(f"{BASE_URL}/api/mobile-tech/time-entry", json=time_entry, headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("status") == "logged"
        assert "entry" in data
        assert data["entry"]["duration_min"] == 45
        print(f"✓ Mobile Tech: Logged {time_entry['duration_min']} min time entry")


class TestSocRealtime(TestAuth):
    """SOC Realtime Feed - Live security events"""
    
    def test_get_events(self, headers):
        """GET /api/soc-realtime/events - Get recent SOC events with stats"""
        response = requests.get(f"{BASE_URL}/api/soc-realtime/events", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Should have events array
        assert "events" in data
        assert isinstance(data["events"], list)
        assert len(data["events"]) >= 30, "Should have at least 30 events"
        
        # Should have stats
        assert "stats" in data
        stats = data["stats"]
        assert "total_events_24h" in stats
        assert "critical" in stats
        assert "high" in stats
        assert "medium" in stats
        assert "blocked" in stats
        assert "investigating" in stats
        
        # Verify event structure
        event = data["events"][0]
        assert "event_id" in event
        assert "title" in event
        assert "severity" in event
        assert "action" in event
        assert "timestamp" in event
        
        print(f"✓ SOC Realtime: {stats['total_events_24h']} events (Critical: {stats['critical']}, High: {stats['high']}, Blocked: {stats['blocked']})")
    
    def test_generate_event(self, headers):
        """POST /api/soc-realtime/generate - Simulate new SOC event"""
        response = requests.post(f"{BASE_URL}/api/soc-realtime/generate", json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("status") == "generated"
        assert "event" in data
        event = data["event"]
        assert "event_id" in event
        assert "title" in event
        assert "severity" in event
        print(f"✓ SOC Realtime: Generated event '{event['title']}' ({event['severity']})")
    
    def test_get_threat_map(self, headers):
        """GET /api/soc-realtime/threat-map - Geographic threat visualization"""
        response = requests.get(f"{BASE_URL}/api/soc-realtime/threat-map", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "attack_sources" in data
        assert isinstance(data["attack_sources"], list)
        assert len(data["attack_sources"]) >= 5, "Should have at least 5 attack source countries"
        
        assert "total_blocked_today" in data
        assert "top_attack_type" in data
        
        # Verify attack source structure
        source = data["attack_sources"][0]
        assert "country" in source
        assert "code" in source
        assert "attacks" in source
        
        print(f"✓ SOC Realtime Threat Map: {len(data['attack_sources'])} source countries, {data['total_blocked_today']} blocked, Top: {data['top_attack_type']}")


class TestRevenueTracker(TestAuth):
    """MRR/ARR Revenue Tracker - Financial metrics"""
    
    def test_get_overview(self, headers):
        """GET /api/revenue-tracker/overview - Get revenue overview with clients"""
        response = requests.get(f"{BASE_URL}/api/revenue-tracker/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        # Should have clients
        assert "clients" in data
        assert isinstance(data["clients"], list)
        assert len(data["clients"]) >= 10, "Should have at least 10 clients"
        
        # Should have summary
        assert "summary" in data
        summary = data["summary"]
        assert "current_mrr" in summary
        assert "current_arr" in summary
        assert "mrr_growth" in summary
        assert "net_revenue_retention" in summary
        assert "logo_retention" in summary
        assert "churn_risk_revenue" in summary
        assert "expansion_revenue" in summary
        
        # Should have monthly trend
        assert "monthly_trend" in data
        assert isinstance(data["monthly_trend"], list)
        
        # Should have by_service breakdown
        assert "by_service" in data
        assert isinstance(data["by_service"], list)
        
        # Verify client structure
        client = data["clients"][0]
        assert "client_name" in client
        assert "mrr" in client
        assert "endpoints" in client
        assert "churn_risk" in client
        
        print(f"✓ Revenue Tracker: MRR ${summary['current_mrr']:,}, ARR ${summary['current_arr']:,}, Growth {summary['mrr_growth']}%, NRR {summary['net_revenue_retention']}%")
    
    def test_get_cohort_analysis(self, headers):
        """GET /api/revenue-tracker/cohort - Cohort retention analysis"""
        response = requests.get(f"{BASE_URL}/api/revenue-tracker/cohort", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "cohorts" in data
        assert isinstance(data["cohorts"], list)
        assert len(data["cohorts"]) >= 3, "Should have at least 3 cohorts"
        
        # Verify cohort structure
        cohort = data["cohorts"][0]
        assert "cohort" in cohort
        assert "clients_start" in cohort
        assert "clients_now" in cohort
        assert "mrr_start" in cohort
        assert "mrr_now" in cohort
        assert "retention_pct" in cohort
        assert "expansion_pct" in cohort
        
        print(f"✓ Revenue Tracker Cohorts: {len(data['cohorts'])} cohorts analyzed")
    
    def test_get_client_revenue(self, headers):
        """GET /api/revenue-tracker/client/{client_name} - Get specific client revenue"""
        response = requests.get(f"{BASE_URL}/api/revenue-tracker/client/TechStart%20Inc", headers=headers)
        assert response.status_code == 200
        data = response.json()
        
        assert "client_name" in data
        assert "mrr" in data
        assert "history" in data
        assert isinstance(data["history"], list)
        
        print(f"✓ Revenue Tracker: Retrieved client '{data['client_name']}' with MRR ${data['mrr']:,}")


class TestNavigationAndIntegration(TestAuth):
    """Verify all 5 features are properly integrated"""
    
    def test_all_endpoints_accessible(self, headers):
        """Verify all Phase G endpoints are accessible"""
        endpoints = [
            ("/api/dashboard-builder/layouts", "Dashboard Builder"),
            ("/api/channel-mode/tenants", "Channel Mode"),
            ("/api/mobile-tech/my-day", "Mobile Tech"),
            ("/api/soc-realtime/events", "SOC Realtime"),
            ("/api/revenue-tracker/overview", "Revenue Tracker"),
        ]
        
        all_passed = True
        for endpoint, name in endpoints:
            response = requests.get(f"{BASE_URL}{endpoint}", headers=headers)
            if response.status_code == 200:
                print(f"✓ {name}: Accessible")
            else:
                print(f"✗ {name}: FAILED ({response.status_code})")
                all_passed = False
        
        assert all_passed, "Not all Phase G endpoints are accessible"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
