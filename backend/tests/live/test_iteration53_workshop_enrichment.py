"""
Iteration 53 - Workshop Enrichment Features Testing
Tests for Workshop Job Enrichment with IT Technician Features:
- Phase 1: Repair notes, photo attachments, diagnostic checklists, audit trail
- Phase 2: Customer notifications, quote builder, push to invoice, device intake
- Phase 3: Repair history, QR code generation, workshop queue/bench view
"""

import pytest
import requests
import os
import json

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
TEST_EMAIL = "admin@nexusops.io"
TEST_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


@pytest.fixture(scope="module")
def auth_token():
    """Authenticate and get token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    data = response.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def workshop_job(headers):
    """Get existing workshop job WS-1001 or create one"""
    # First try to get existing workshop jobs
    response = requests.get(f"{BASE_URL}/api/workshop/jobs", headers=headers)
    assert response.status_code == 200
    jobs = response.json()
    if jobs:
        # Return first workshop job
        return jobs[0]
    # Create new workshop job if none exists
    response = requests.post(f"{BASE_URL}/api/workshop/jobs", json={
        "customer_name": "Test Customer",
        "customer_phone": "555-0123",
        "customer_email": "test@customer.com",
        "device_type": "laptop",
        "device_brand": "Dell",
        "device_model": "XPS 15",
        "serial_number": "TEST-SN-12345",
        "fault_description": "Screen flickering and battery not charging",
        "priority": "normal"
    }, headers=headers)
    assert response.status_code == 200
    return response.json()


# =============== PHASE 1: CORE TOOLS ===============

class TestWorkshopNotes:
    """Tests for repair notes functionality"""

    def test_get_workshop_notes(self, headers, workshop_job):
        """Get repair notes for a workshop job"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/notes", headers=headers)
        assert response.status_code == 200
        notes = response.json()
        assert isinstance(notes, list)
        print(f"Found {len(notes)} existing notes")

    def test_add_repair_note(self, headers, workshop_job):
        """Add a new repair note"""
        response = requests.post(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/notes", json={
            "content": "TEST_NOTE: Initial diagnosis shows screen connector issue.",
            "note_type": "repair",
            "is_internal": True
        }, headers=headers)
        assert response.status_code == 200
        note = response.json()
        assert "id" in note
        assert "TEST_NOTE" in note["content"]
        assert note["note_type"] == "repair"
        print(f"Note created: {note['id']}")

    def test_verify_note_persisted(self, headers, workshop_job):
        """Verify note was persisted"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/notes", headers=headers)
        assert response.status_code == 200
        notes = response.json()
        test_notes = [n for n in notes if "TEST_NOTE" in n.get("content", "")]
        assert len(test_notes) > 0, "Test note should be persisted"


class TestDiagnosticChecklist:
    """Tests for diagnostic checklist functionality"""

    def test_get_diagnostic_templates(self, headers):
        """Get available diagnostic checklist templates"""
        response = requests.get(f"{BASE_URL}/api/workshop/diagnostic-templates", headers=headers)
        assert response.status_code == 200
        templates = response.json()
        # Should have laptop, desktop, phone, printer, network
        assert "laptop" in templates
        assert "desktop" in templates
        assert "phone" in templates
        assert "printer" in templates
        assert "network" in templates
        print(f"Templates available: {list(templates.keys())}")

    def test_get_checklist(self, headers, workshop_job):
        """Get checklist items for workshop job"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/checklist", headers=headers)
        assert response.status_code == 200
        items = response.json()
        assert isinstance(items, list)
        print(f"Found {len(items)} checklist items")

    def test_load_laptop_template(self, headers, workshop_job):
        """Load laptop diagnostic template"""
        # Clear first by checking existing
        response = requests.post(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/checklist", json={
            "template": "laptop"
        }, headers=headers)
        assert response.status_code == 200
        items = response.json()
        # Laptop template has 15 items
        assert len(items) > 0
        print(f"Loaded {len(items)} laptop checklist items")

    def test_toggle_checklist_item(self, headers, workshop_job):
        """Toggle a checklist item on/off"""
        # Get checklist first
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/checklist", headers=headers)
        assert response.status_code == 200
        items = response.json()
        if items:
            item = items[0]
            # Toggle to checked
            toggle_response = requests.put(
                f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/checklist/{item['id']}",
                json={"checked": True},
                headers=headers
            )
            assert toggle_response.status_code == 200
            print(f"Toggled item {item['id']} to checked")

    def test_add_custom_checklist_item(self, headers, workshop_job):
        """Add custom checklist item"""
        response = requests.post(
            f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/checklist/add-item",
            json={"item": "TEST_CUSTOM: Check BIOS version"},
            headers=headers
        )
        assert response.status_code == 200
        item = response.json()
        assert "id" in item
        assert "TEST_CUSTOM" in item["item"]
        print(f"Custom item added: {item['id']}")


class TestPhotos:
    """Tests for photo attachments"""

    def test_get_photos(self, headers, workshop_job):
        """Get photos for workshop job"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/photos", headers=headers)
        assert response.status_code == 200
        photos = response.json()
        assert isinstance(photos, list)
        print(f"Found {len(photos)} photos")


class TestAuditTrail:
    """Tests for audit trail functionality"""

    def test_get_audit_log(self, headers, workshop_job):
        """Get audit log for workshop job"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/audit-log", headers=headers)
        assert response.status_code == 200
        logs = response.json()
        assert isinstance(logs, list)
        print(f"Found {len(logs)} audit entries")
        if logs:
            # Verify audit entry structure
            entry = logs[0]
            assert "action" in entry
            assert "details" in entry
            assert "created_at" in entry


# =============== PHASE 2: BUSINESS TOOLS ===============

class TestQuoteBuilder:
    """Tests for quote/estimate builder"""

    def test_get_quote(self, headers, workshop_job):
        """Get quote for workshop job"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/quote", headers=headers)
        assert response.status_code == 200
        # May return null if no quote exists
        print(f"Quote response: {response.json()}")

    def test_create_quote(self, headers, workshop_job):
        """Create/update repair quote"""
        response = requests.post(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/quote", json={
            "line_items": [
                {"description": "Screen Replacement", "quantity": 1, "unit_price": 150.00, "total": 150.00},
                {"description": "Labour - 1 hour", "quantity": 1, "unit_price": 75.00, "total": 75.00}
            ],
            "notes": "TEST_QUOTE: Estimated completion 2-3 business days",
            "tax": 0
        }, headers=headers)
        assert response.status_code == 200
        quote = response.json()
        assert "id" in quote
        assert quote["subtotal"] == 225.00
        assert quote["total"] == 225.00
        print(f"Quote created: ${quote['total']}")

    def test_send_quote(self, headers, workshop_job):
        """Send quote to customer"""
        response = requests.post(
            f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/quote/send",
            json={"email": "test@customer.com"},
            headers=headers
        )
        assert response.status_code == 200
        result = response.json()
        assert result["status"] == "sent"
        print("Quote sent to customer")

    def test_approve_quote(self, headers, workshop_job):
        """Approve quote"""
        response = requests.post(
            f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/quote/approve",
            json={},
            headers=headers
        )
        assert response.status_code == 200
        print("Quote approved")

    def test_verify_quote_status(self, headers, workshop_job):
        """Verify quote status updated"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/quote", headers=headers)
        assert response.status_code == 200
        quote = response.json()
        if quote:
            assert quote["status"] == "approved"
            print(f"Quote status: {quote['status']}")


class TestCustomerNotifications:
    """Tests for customer notification system"""

    def test_send_notification(self, headers, workshop_job):
        """Send customer notification"""
        response = requests.post(
            f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/notify-customer",
            json={
                "email": "test@customer.com",
                "subject": "Your device is ready for pickup",
                "message": "TEST_NOTIFY: Your repair is complete. Please collect your device.",
                "notification_type": "ready_for_pickup"
            },
            headers=headers
        )
        assert response.status_code == 200
        notif = response.json()
        assert "id" in notif
        assert notif["type"] == "ready_for_pickup"
        print(f"Notification sent: {notif['id']}")

    def test_get_notifications(self, headers, workshop_job):
        """Get notification history"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/notifications", headers=headers)
        assert response.status_code == 200
        notifs = response.json()
        assert isinstance(notifs, list)
        print(f"Found {len(notifs)} notifications")


class TestDeviceIntake:
    """Tests for device intake enhancements"""

    def test_update_intake_info(self, headers, workshop_job):
        """Update device intake information"""
        response = requests.put(
            f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/intake",
            json={
                "condition_on_arrival": "fair",
                "accessories_received": ["Charger", "Bag/Case"],
                "customer_password": "test1234",
                "warranty_status": "expired",
                "customer_email": "test@customer.com"
            },
            headers=headers
        )
        assert response.status_code == 200
        print("Intake info updated")

    def test_verify_intake_saved(self, headers, workshop_job):
        """Verify intake data was saved"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}", headers=headers)
        assert response.status_code == 200
        job = response.json()
        assert job["condition_on_arrival"] == "fair"
        assert "Charger" in job["accessories_received"]
        assert job["warranty_status"] == "expired"
        print("Intake data verified")


class TestPushToInvoice:
    """Tests for push to invoice functionality"""

    def test_push_to_new_invoice(self, headers, workshop_job):
        """Push workshop job to create new invoice"""
        response = requests.post(
            f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/to-invoice",
            json={},
            headers=headers
        )
        assert response.status_code == 200
        result = response.json()
        assert "message" in result
        # Should contain invoice number if created
        if "invoice_number" in result:
            print(f"Invoice created: {result['invoice_number']}")
        else:
            print(f"Push to invoice result: {result['message']}")


# =============== PHASE 3: ADVANCED ===============

class TestRepairHistory:
    """Tests for repair history lookup"""

    def test_get_repair_history(self, headers, workshop_job):
        """Get repair history for same serial/customer"""
        response = requests.get(
            f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/repair-history",
            headers=headers
        )
        assert response.status_code == 200
        history = response.json()
        assert isinstance(history, list)
        print(f"Found {len(history)} historical repairs")


class TestQRCode:
    """Tests for QR code generation"""

    def test_get_qr_code(self, headers, workshop_job):
        """Get QR code for workshop job"""
        response = requests.get(
            f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/qr-code",
            headers=headers
        )
        assert response.status_code == 200
        assert response.headers.get("content-type") == "image/png"
        print("QR code generated successfully")


class TestWorkshopPDF:
    """Tests for PDF job card generation"""

    def test_generate_pdf(self, headers, workshop_job):
        """Generate workshop job PDF"""
        response = requests.get(
            f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/pdf",
            headers=headers
        )
        assert response.status_code == 200
        assert "pdf" in response.headers.get("content-type", "")
        print("PDF generated successfully")


class TestWorkshopQueue:
    """Tests for workshop queue/bench view"""

    def test_get_workshop_queue(self, headers):
        """Get kanban-style workshop queue"""
        response = requests.get(f"{BASE_URL}/api/workshop/queue", headers=headers)
        assert response.status_code == 200
        queue = response.json()
        # Should have columns: checked_in, diagnosing, parts_ordered, repairing, ready_for_pickup
        assert "checked_in" in queue
        assert "diagnosing" in queue
        assert "parts_ordered" in queue
        assert "repairing" in queue
        assert "ready_for_pickup" in queue
        print(f"Queue columns: {list(queue.keys())}")
        for col, jobs in queue.items():
            print(f"  {col}: {len(jobs)} jobs")


class TestWorkshopJobStatus:
    """Tests for workshop job status updates with audit"""

    def test_update_status_with_audit(self, headers, workshop_job):
        """Update status and verify audit log entry"""
        # Get current status
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}", headers=headers)
        current_status = response.json().get("repair_status", "checked_in")
        
        # Update to diagnosing
        response = requests.put(
            f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/status",
            json={"status": "diagnosing"},
            headers=headers
        )
        assert response.status_code == 200
        
        # Verify audit log has entry
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}/audit-log", headers=headers)
        assert response.status_code == 200
        logs = response.json()
        status_changes = [l for l in logs if l.get("action") == "status_changed"]
        assert len(status_changes) > 0, "Status change should be in audit log"
        print(f"Status updated to diagnosing, audit logged")


class TestWorkshopJobCRUD:
    """Tests for workshop job CRUD with new intake fields"""

    def test_create_job_with_email(self, headers):
        """Create workshop job with customer_email field"""
        response = requests.post(f"{BASE_URL}/api/workshop/jobs", json={
            "customer_name": "Test Customer 2",
            "customer_phone": "555-9999",
            "customer_email": "testcustomer2@example.com",
            "device_type": "desktop",
            "fault_description": "Computer won't boot",
            "priority": "high"
        }, headers=headers)
        assert response.status_code == 200
        job = response.json()
        assert job["customer_email"] == "testcustomer2@example.com"
        print(f"Job created with email: {job['job_number']}")

    def test_workshop_stats(self, headers):
        """Get workshop statistics"""
        response = requests.get(f"{BASE_URL}/api/workshop/stats", headers=headers)
        assert response.status_code == 200
        stats = response.json()
        assert "total_jobs" in stats
        assert "statuses" in stats
        print(f"Stats: {stats['total_jobs']} total jobs, statuses: {stats['statuses']}")


class TestBillingSummary:
    """Tests for billing summary (parts + labour)"""

    def test_job_costs(self, headers, workshop_job):
        """Verify job has cost fields"""
        response = requests.get(f"{BASE_URL}/api/workshop/jobs/{workshop_job['id']}", headers=headers)
        assert response.status_code == 200
        job = response.json()
        # Verify cost fields exist
        assert "total_parts_cost" in job
        assert "total_labour_cost" in job
        assert "total_cost" in job
        assert "labour_minutes" in job
        assert "labour_rate" in job
        print(f"Parts: ${job['total_parts_cost']}, Labour: ${job['total_labour_cost']}, Total: ${job['total_cost']}")


# Run if executed directly
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
