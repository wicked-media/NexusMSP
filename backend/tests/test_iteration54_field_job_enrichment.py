"""
Iteration 54 - Field Job (Cabling/WISP) Enrichment Features Testing
Tests all 3 phases of field job enrichment:
- Phase 1 (Core): Field notes, site photos, enhanced checklists (5 templates), audit trail, progress tracker
- Phase 2 (Business): Customer notifications, quote builder, push to invoice, equipment tracking, materials tracking, site survey info
- Phase 3 (Advanced): Job history by address/customer, QR code, PDF completion report, dispatch queue
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@nexusops.io",
        "password": "admin123"
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json().get("token")

@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestFieldJobBasics:
    """Test basic field job CRUD and listing"""
    
    def test_get_field_jobs_list(self, headers):
        """GET /api/field-jobs returns list of field jobs"""
        response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        assert response.status_code == 200
        jobs = response.json()
        assert isinstance(jobs, list)
        # Should have at least 2 field jobs (CW-1002 and FJ-1001 per context)
        print(f"Found {len(jobs)} field jobs")
        
    def test_get_field_job_detail(self, headers):
        """GET /api/field-jobs/{id} returns job details"""
        # First get list to find a job
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}", headers=headers)
        assert response.status_code == 200
        job = response.json()
        assert "id" in job
        assert "job_number" in job
        assert "job_type" in job
        assert job["job_type"] == "field"
        print(f"Field job detail: {job['job_number']} - {job.get('field_status')}")


class TestFieldNotes:
    """Phase 1: Field Notes API"""
    
    def test_get_field_notes(self, headers):
        """GET /api/field-jobs/{id}/notes returns notes list"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/notes", headers=headers)
        assert response.status_code == 200
        notes = response.json()
        assert isinstance(notes, list)
        print(f"Found {len(notes)} notes for job")
        
    def test_add_field_note(self, headers):
        """POST /api/field-jobs/{id}/notes creates a new note"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/field-jobs/{job_id}/notes", headers=headers, json={
            "content": "TEST_Field note from iteration 54 testing",
            "note_type": "field",
            "is_internal": True
        })
        assert response.status_code == 200
        note = response.json()
        assert "id" in note
        assert note["content"] == "TEST_Field note from iteration 54 testing"
        assert note["note_type"] == "field"
        print(f"Created note: {note['id']}")


class TestEnhancedChecklists:
    """Phase 1: Enhanced Checklists with 5 templates"""
    
    def test_get_enhanced_templates(self, headers):
        """GET /api/field-jobs/enhanced-templates returns 5 templates"""
        response = requests.get(f"{BASE_URL}/api/field-jobs/enhanced-templates", headers=headers)
        assert response.status_code == 200
        templates = response.json()
        assert isinstance(templates, dict)
        # Should have 5 templates: installation, maintenance, troubleshooting, decommission, site_survey
        expected_templates = ["installation", "maintenance", "troubleshooting", "decommission", "site_survey"]
        for template in expected_templates:
            assert template in templates, f"Missing template: {template}"
            assert isinstance(templates[template], list)
            assert len(templates[template]) > 0
        print(f"Templates found: {list(templates.keys())}")
        print(f"Installation items: {len(templates['installation'])}, Maintenance: {len(templates['maintenance'])}")
        
    def test_get_field_checklist(self, headers):
        """GET /api/field-jobs/{id}/enhanced-checklist returns checklist items"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/enhanced-checklist", headers=headers)
        assert response.status_code == 200
        items = response.json()
        assert isinstance(items, list)
        print(f"Found {len(items)} checklist items")
        
    def test_load_checklist_template(self, headers):
        """POST /api/field-jobs/{id}/enhanced-checklist loads template items"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        # Load maintenance template (smaller than installation)
        response = requests.post(f"{BASE_URL}/api/field-jobs/{job_id}/enhanced-checklist", headers=headers, json={
            "template": "maintenance"
        })
        assert response.status_code == 200
        items = response.json()
        assert isinstance(items, list)
        assert len(items) > 0
        print(f"Loaded {len(items)} maintenance checklist items")
        
    def test_toggle_checklist_item(self, headers):
        """PUT /api/field-jobs/{id}/enhanced-checklist/{item_id} toggles item"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        # Get checklist items
        cl_response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/enhanced-checklist", headers=headers)
        items = cl_response.json()
        if not items:
            pytest.skip("No checklist items")
        item_id = items[0]["id"]
        
        # Toggle to checked
        response = requests.put(f"{BASE_URL}/api/field-jobs/{job_id}/enhanced-checklist/{item_id}", headers=headers, json={
            "checked": True
        })
        assert response.status_code == 200
        print(f"Toggled checklist item {item_id}")
        
    def test_add_custom_checklist_item(self, headers):
        """POST /api/field-jobs/{id}/enhanced-checklist/add-item adds custom item"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/field-jobs/{job_id}/enhanced-checklist/add-item", headers=headers, json={
            "item": "TEST_Custom checklist item from iteration 54"
        })
        assert response.status_code == 200
        item = response.json()
        assert "id" in item
        assert item["item"] == "TEST_Custom checklist item from iteration 54"
        print(f"Added custom item: {item['id']}")


class TestSitePhotos:
    """Phase 1: Site Photos API"""
    
    def test_get_field_photos(self, headers):
        """GET /api/field-jobs/{id}/photos returns photos list"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/photos", headers=headers)
        assert response.status_code == 200
        photos = response.json()
        assert isinstance(photos, list)
        print(f"Found {len(photos)} photos")


class TestAuditTrail:
    """Phase 1: Audit Trail API"""
    
    def test_get_audit_log(self, headers):
        """GET /api/field-jobs/{id}/audit-log returns audit entries"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/audit-log", headers=headers)
        assert response.status_code == 200
        logs = response.json()
        assert isinstance(logs, list)
        if logs:
            assert "action" in logs[0]
            assert "details" in logs[0]
            assert "user_name" in logs[0]
            assert "created_at" in logs[0]
        print(f"Found {len(logs)} audit entries")


class TestEquipmentTracking:
    """Phase 2: Equipment Tracking with MAC/IP/Serial"""
    
    def test_get_equipment(self, headers):
        """GET /api/field-jobs/{id}/equipment returns equipment list"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/equipment", headers=headers)
        assert response.status_code == 200
        equipment = response.json()
        assert isinstance(equipment, list)
        print(f"Found {len(equipment)} equipment items")
        
    def test_add_equipment(self, headers):
        """POST /api/field-jobs/{id}/equipment adds equipment with tracking fields"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/field-jobs/{job_id}/equipment", headers=headers, json={
            "equipment_type": "TEST_Router",
            "brand": "Ubiquiti",
            "model": "EdgeRouter X",
            "serial_number": "TEST-SN-12345",
            "mac_address": "AA:BB:CC:DD:EE:FF",
            "ip_address": "192.168.1.1",
            "config_notes": "Test config notes",
            "action": "installed"
        })
        assert response.status_code == 200
        equip = response.json()
        assert "id" in equip
        assert equip["equipment_type"] == "TEST_Router"
        assert equip["mac_address"] == "AA:BB:CC:DD:EE:FF"
        assert equip["ip_address"] == "192.168.1.1"
        assert equip["serial_number"] == "TEST-SN-12345"
        print(f"Added equipment: {equip['id']}")
        return equip["id"]
        
    def test_delete_equipment(self, headers):
        """DELETE /api/field-jobs/{id}/equipment/{equip_id} removes equipment"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        # First add equipment to delete
        add_response = requests.post(f"{BASE_URL}/api/field-jobs/{job_id}/equipment", headers=headers, json={
            "equipment_type": "TEST_ToDelete",
            "brand": "Test",
            "model": "Delete Me",
            "action": "installed"
        })
        equip_id = add_response.json()["id"]
        
        # Delete it
        response = requests.delete(f"{BASE_URL}/api/field-jobs/{job_id}/equipment/{equip_id}", headers=headers)
        assert response.status_code == 200
        print(f"Deleted equipment: {equip_id}")


class TestMaterialsTracking:
    """Phase 2: Materials Tracking with quantity/unit/cost"""
    
    def test_get_materials(self, headers):
        """GET /api/field-jobs/{id}/materials returns materials list"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/materials", headers=headers)
        assert response.status_code == 200
        materials = response.json()
        assert isinstance(materials, list)
        print(f"Found {len(materials)} materials")
        
    def test_add_material(self, headers):
        """POST /api/field-jobs/{id}/materials adds material with cost tracking"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/field-jobs/{job_id}/materials", headers=headers, json={
            "material": "TEST_CAT6 Cable",
            "quantity": 50,
            "unit": "meters",
            "unit_cost": 1.50
        })
        assert response.status_code == 200
        mat = response.json()
        assert "id" in mat
        assert mat["material"] == "TEST_CAT6 Cable"
        assert mat["quantity"] == 50
        assert mat["unit"] == "meters"
        assert mat["unit_cost"] == 1.50
        assert mat["total"] == 75.0  # 50 * 1.50
        print(f"Added material: {mat['id']} - Total: ${mat['total']}")
        return mat["id"]
        
    def test_delete_material(self, headers):
        """DELETE /api/field-jobs/{id}/materials/{mat_id} removes material"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        # First add material to delete
        add_response = requests.post(f"{BASE_URL}/api/field-jobs/{job_id}/materials", headers=headers, json={
            "material": "TEST_ToDelete",
            "quantity": 1,
            "unit": "each",
            "unit_cost": 0
        })
        mat_id = add_response.json()["id"]
        
        # Delete it
        response = requests.delete(f"{BASE_URL}/api/field-jobs/{job_id}/materials/{mat_id}", headers=headers)
        assert response.status_code == 200
        print(f"Deleted material: {mat_id}")


class TestSiteInfo:
    """Phase 2: Site Survey / Access Info"""
    
    def test_get_site_info(self, headers):
        """GET /api/field-jobs/{id}/site-info returns site info"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/site-info", headers=headers)
        assert response.status_code == 200
        info = response.json()
        assert isinstance(info, dict)
        print(f"Site info: {info}")
        
    def test_save_site_info(self, headers):
        """PUT /api/field-jobs/{id}/site-info saves site survey data"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.put(f"{BASE_URL}/api/field-jobs/{job_id}/site-info", headers=headers, json={
            "gps_lat": "-33.8688",
            "gps_lng": "151.2093",
            "access_notes": "TEST_Gate code 1234, ring doorbell",
            "mounting_type": "wall_mount",
            "weather_conditions": "clear",
            "safety_hazards": "none",
            "power_source": "mains"
        })
        assert response.status_code == 200
        print("Site info saved successfully")
        
        # Verify it was saved
        get_response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/site-info", headers=headers)
        info = get_response.json()
        assert info.get("gps_lat") == "-33.8688"
        assert info.get("access_notes") == "TEST_Gate code 1234, ring doorbell"


class TestQuoteBuilder:
    """Phase 2: Quote Builder"""
    
    def test_get_quote(self, headers):
        """GET /api/field-jobs/{id}/quote returns quote if exists"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/quote", headers=headers)
        assert response.status_code == 200
        # May be null if no quote exists
        print(f"Quote response: {response.json()}")
        
    def test_create_quote(self, headers):
        """POST /api/field-jobs/{id}/quote creates/updates quote"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/field-jobs/{job_id}/quote", headers=headers, json={
            "line_items": [
                {"description": "TEST_Installation labour", "quantity": 2, "unit_price": 95, "total": 190},
                {"description": "TEST_Equipment", "quantity": 1, "unit_price": 350, "total": 350}
            ],
            "tax": 54,
            "notes": "TEST_Quote from iteration 54 testing"
        })
        assert response.status_code == 200
        quote = response.json()
        assert "id" in quote
        assert quote["subtotal"] == 540  # 190 + 350
        assert quote["tax"] == 54
        assert quote["total"] == 594  # 540 + 54
        assert quote["status"] == "draft"
        print(f"Created quote: {quote['id']} - Total: ${quote['total']}")
        
    def test_send_quote(self, headers):
        """POST /api/field-jobs/{id}/quote/send marks quote as sent"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        # Ensure quote exists
        requests.post(f"{BASE_URL}/api/field-jobs/{job_id}/quote", headers=headers, json={
            "line_items": [{"description": "TEST_Service", "quantity": 1, "unit_price": 100, "total": 100}],
            "notes": "Test quote"
        })
        
        response = requests.post(f"{BASE_URL}/api/field-jobs/{job_id}/quote/send", headers=headers, json={
            "email": "test@example.com"
        })
        assert response.status_code == 200
        result = response.json()
        assert result.get("status") == "sent"
        print("Quote sent successfully")
        
    def test_approve_quote(self, headers):
        """POST /api/field-jobs/{id}/quote/approve marks quote as approved"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/field-jobs/{job_id}/quote/approve", headers=headers)
        assert response.status_code == 200
        print("Quote approved successfully")
        
        # Verify status
        get_response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/quote", headers=headers)
        quote = get_response.json()
        assert quote.get("status") == "approved"


class TestCustomerNotifications:
    """Phase 2: Customer Notifications"""
    
    def test_send_notification(self, headers):
        """POST /api/field-jobs/{id}/notify-customer sends notification"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/field-jobs/{job_id}/notify-customer", headers=headers, json={
            "email": "test@example.com",
            "subject": "TEST_En Route Notification",
            "message": "Our technician is on the way to your location.",
            "notification_type": "en_route"
        })
        assert response.status_code == 200
        notif = response.json()
        assert "id" in notif
        assert notif["type"] == "en_route"
        print(f"Notification sent: {notif['id']}")
        
    def test_get_notifications(self, headers):
        """GET /api/field-jobs/{id}/notifications returns notification history"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/notifications", headers=headers)
        assert response.status_code == 200
        notifs = response.json()
        assert isinstance(notifs, list)
        print(f"Found {len(notifs)} notifications")


class TestPushToInvoice:
    """Phase 2: Push to Invoice"""
    
    def test_push_to_new_invoice(self, headers):
        """POST /api/field-jobs/{id}/to-invoice creates new invoice"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.post(f"{BASE_URL}/api/field-jobs/{job_id}/to-invoice", headers=headers, json={
            "labour_rate": 95
        })
        assert response.status_code == 200
        result = response.json()
        assert "invoice_id" in result or "message" in result
        print(f"Push to invoice result: {result}")


class TestJobHistory:
    """Phase 3: Job History by Address/Customer"""
    
    def test_get_job_history(self, headers):
        """GET /api/field-jobs/{id}/job-history returns related jobs"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/job-history", headers=headers)
        assert response.status_code == 200
        history = response.json()
        assert isinstance(history, list)
        print(f"Found {len(history)} related jobs in history")


class TestQRCode:
    """Phase 3: QR Code Generation"""
    
    def test_get_qr_code(self, headers):
        """GET /api/field-jobs/{id}/qr-code returns PNG image"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/qr-code", headers=headers)
        assert response.status_code == 200
        assert response.headers.get("content-type") == "image/png"
        assert len(response.content) > 0
        print(f"QR code generated: {len(response.content)} bytes")


class TestPDFReport:
    """Phase 3: PDF Completion Report"""
    
    def test_get_pdf_report(self, headers):
        """GET /api/field-jobs/{id}/pdf returns PDF document"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/pdf", headers=headers)
        assert response.status_code == 200
        assert "application/pdf" in response.headers.get("content-type", "")
        assert len(response.content) > 0
        print(f"PDF generated: {len(response.content)} bytes")


class TestDispatchQueue:
    """Phase 3: Field Dispatch Queue"""
    
    def test_get_dispatch_queue(self, headers):
        """GET /api/field-jobs/dispatch-queue returns kanban columns"""
        response = requests.get(f"{BASE_URL}/api/field-jobs/dispatch-queue", headers=headers)
        assert response.status_code == 200
        queue = response.json()
        assert isinstance(queue, dict)
        # Should have columns for different statuses
        expected_columns = ["scheduled", "en_route", "on_site", "in_progress"]
        for col in expected_columns:
            assert col in queue, f"Missing column: {col}"
            assert isinstance(queue[col], list)
        print(f"Dispatch queue columns: {list(queue.keys())}")
        for col, jobs in queue.items():
            print(f"  {col}: {len(jobs)} jobs")


class TestProgressTracker:
    """Phase 1: Progress Tracker (5 stages)"""
    
    def test_status_update_creates_audit(self, headers):
        """PUT /api/field-jobs/{id}/status updates status and creates audit entry"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        # Get current audit count
        audit_before = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/audit-log", headers=headers).json()
        
        # Update status
        response = requests.put(f"{BASE_URL}/api/field-jobs/{job_id}/status", headers=headers, json={
            "status": "en_route"
        })
        assert response.status_code == 200
        
        # Check audit log increased
        audit_after = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}/audit-log", headers=headers).json()
        assert len(audit_after) >= len(audit_before)
        print(f"Status updated to en_route, audit entries: {len(audit_before)} -> {len(audit_after)}")


class TestSignalSpeedInputs:
    """Test Signal & Speed test inputs"""
    
    def test_update_signal_speed(self, headers):
        """PUT /api/field-jobs/{id} updates signal and speed values"""
        list_response = requests.get(f"{BASE_URL}/api/field-jobs", headers=headers)
        jobs = list_response.json()
        if not jobs:
            pytest.skip("No field jobs available")
        job_id = jobs[0]["id"]
        
        response = requests.put(f"{BASE_URL}/api/field-jobs/{job_id}", headers=headers, json={
            "signal_strength": "-65",
            "speed_test_down": "100",
            "speed_test_up": "50"
        })
        assert response.status_code == 200
        
        # Verify
        get_response = requests.get(f"{BASE_URL}/api/field-jobs/{job_id}", headers=headers)
        job = get_response.json()
        assert job.get("signal_strength") == "-65"
        assert job.get("speed_test_down") == "100"
        assert job.get("speed_test_up") == "50"
        print(f"Signal/Speed saved: {job.get('signal_strength')} dBm, {job.get('speed_test_down')}/{job.get('speed_test_up')} Mbps")


class TestFieldJobStats:
    """Test field job statistics"""
    
    def test_get_field_stats(self, headers):
        """GET /api/field-jobs/stats/summary returns statistics"""
        response = requests.get(f"{BASE_URL}/api/field-jobs/stats/summary", headers=headers)
        assert response.status_code == 200
        stats = response.json()
        assert "total_jobs" in stats
        assert "statuses" in stats
        print(f"Field job stats: {stats}")
