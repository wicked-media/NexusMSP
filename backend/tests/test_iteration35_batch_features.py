"""
Test iteration 35: NexusOps Batch Features
- Invoice PDF generation with branding
- Proxmox VM management + backups
- Acronis integration with customer sync
- Gradient MSP billing reconciliation
- Financial Reports (8 reports)
- Ticket attachments
- Device chat with typing/read status
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
TEST_EMAIL = "admin@nexusops.io"
TEST_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json().get("token")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Authenticated headers"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# =============================================================================
# INVOICE PDF TESTS
# =============================================================================
class TestInvoicePDF:
    """Invoice PDF generation tests"""

    def test_get_invoices_list(self, headers):
        """Get list of invoices to find one for PDF test"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        assert response.status_code == 200
        invoices = response.json()
        assert isinstance(invoices, list)
        print(f"Found {len(invoices)} invoices")

    def test_invoice_pdf_preview(self, headers):
        """GET /api/invoices/{id}/pdf returns PDF with inline disposition"""
        # First get an invoice
        inv_res = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        invoices = inv_res.json()
        if not invoices:
            pytest.skip("No invoices to test PDF")
        invoice_id = invoices[0].get("id")
        
        response = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}/pdf", headers=headers)
        assert response.status_code == 200
        assert response.headers.get("content-type") == "application/pdf"
        assert "inline" in response.headers.get("content-disposition", "")
        assert len(response.content) > 2000, "PDF should be > 2KB"
        print(f"Invoice PDF preview: {len(response.content)} bytes")

    def test_invoice_pdf_download(self, headers):
        """GET /api/invoices/{id}/pdf/download returns PDF with attachment disposition"""
        inv_res = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        invoices = inv_res.json()
        if not invoices:
            pytest.skip("No invoices to test PDF")
        invoice_id = invoices[0].get("id")
        
        response = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}/pdf/download", headers=headers)
        assert response.status_code == 200
        assert response.headers.get("content-type") == "application/pdf"
        assert "attachment" in response.headers.get("content-disposition", "")
        assert len(response.content) > 2000
        print(f"Invoice PDF download: {len(response.content)} bytes")

    def test_invoice_pdf_not_found(self, headers):
        """Returns 404 for invalid invoice"""
        response = requests.get(f"{BASE_URL}/api/invoices/invalid-id-123/pdf", headers=headers)
        assert response.status_code == 404


# =============================================================================
# PROXMOX VM MANAGEMENT TESTS
# =============================================================================
class TestProxmox:
    """Proxmox VM management and backup tests"""

    def test_get_proxmox_nodes(self, headers):
        """GET /api/proxmox/nodes returns node list"""
        response = requests.get(f"{BASE_URL}/api/proxmox/nodes", headers=headers)
        assert response.status_code == 200
        nodes = response.json()
        assert isinstance(nodes, list)
        assert len(nodes) > 0, "Should have demo nodes"
        for node in nodes:
            assert "id" in node
            assert "name" in node
            assert "status" in node
        print(f"Proxmox nodes: {len(nodes)}")

    def test_get_proxmox_vms(self, headers):
        """GET /api/proxmox/vms returns VM list"""
        response = requests.get(f"{BASE_URL}/api/proxmox/vms", headers=headers)
        assert response.status_code == 200
        vms = response.json()
        assert isinstance(vms, list)
        assert len(vms) > 0, "Should have demo VMs"
        for vm in vms[:3]:
            assert "id" in vm
            assert "name" in vm
            assert "status" in vm
            assert "vcpu" in vm
            assert "ram_gb" in vm
        print(f"Proxmox VMs: {len(vms)}")

    def test_vm_action_start(self, headers):
        """POST /api/proxmox/vms/{id}/action - start action"""
        # Get a stopped VM or any VM
        vms_res = requests.get(f"{BASE_URL}/api/proxmox/vms", headers=headers)
        vms = vms_res.json()
        if not vms:
            pytest.skip("No VMs to test")
        vm_id = vms[0].get("id")
        
        response = requests.post(f"{BASE_URL}/api/proxmox/vms/{vm_id}/action", 
                                 json={"action": "start"}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert data.get("action") == "start"
        print(f"VM start action: {data}")

    def test_vm_action_reboot(self, headers):
        """POST /api/proxmox/vms/{id}/action - reboot action"""
        vms_res = requests.get(f"{BASE_URL}/api/proxmox/vms", headers=headers)
        vms = vms_res.json()
        if not vms:
            pytest.skip("No VMs to test")
        vm_id = vms[0].get("id")
        
        response = requests.post(f"{BASE_URL}/api/proxmox/vms/{vm_id}/action", 
                                 json={"action": "reboot"}, headers=headers)
        assert response.status_code == 200

    def test_vm_action_shutdown(self, headers):
        """POST /api/proxmox/vms/{id}/action - shutdown action"""
        vms_res = requests.get(f"{BASE_URL}/api/proxmox/vms", headers=headers)
        vms = vms_res.json()
        if not vms:
            pytest.skip("No VMs to test")
        vm_id = vms[0].get("id")
        
        response = requests.post(f"{BASE_URL}/api/proxmox/vms/{vm_id}/action", 
                                 json={"action": "shutdown"}, headers=headers)
        assert response.status_code == 200

    def test_vm_action_stop(self, headers):
        """POST /api/proxmox/vms/{id}/action - stop action"""
        vms_res = requests.get(f"{BASE_URL}/api/proxmox/vms", headers=headers)
        vms = vms_res.json()
        if not vms:
            pytest.skip("No VMs to test")
        vm_id = vms[0].get("id")
        
        response = requests.post(f"{BASE_URL}/api/proxmox/vms/{vm_id}/action", 
                                 json={"action": "stop"}, headers=headers)
        assert response.status_code == 200

    def test_vm_action_invalid(self, headers):
        """Invalid action returns 400"""
        vms_res = requests.get(f"{BASE_URL}/api/proxmox/vms", headers=headers)
        vms = vms_res.json()
        if not vms:
            pytest.skip("No VMs to test")
        vm_id = vms[0].get("id")
        
        response = requests.post(f"{BASE_URL}/api/proxmox/vms/{vm_id}/action", 
                                 json={"action": "invalid_action"}, headers=headers)
        assert response.status_code == 400

    def test_get_proxmox_backups(self, headers):
        """GET /api/proxmox/backups returns backup list"""
        response = requests.get(f"{BASE_URL}/api/proxmox/backups", headers=headers)
        assert response.status_code == 200
        backups = response.json()
        assert isinstance(backups, list)
        print(f"Proxmox backups: {len(backups)}")

    def test_create_backup(self, headers):
        """POST /api/proxmox/backups creates a backup job"""
        vms_res = requests.get(f"{BASE_URL}/api/proxmox/vms", headers=headers)
        vms = vms_res.json()
        if not vms:
            pytest.skip("No VMs to backup")
        
        response = requests.post(f"{BASE_URL}/api/proxmox/backups", json={
            "vm_id": vms[0]["id"],
            "vm_name": vms[0]["name"],
            "type": "full",
            "storage": "local-zfs",
            "retention_days": 30
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data.get("status") == "running"

    def test_get_backup_schedules(self, headers):
        """GET /api/proxmox/backup-schedules returns schedules"""
        response = requests.get(f"{BASE_URL}/api/proxmox/backup-schedules", headers=headers)
        assert response.status_code == 200
        schedules = response.json()
        assert isinstance(schedules, list)
        print(f"Backup schedules: {len(schedules)}")


# =============================================================================
# ACRONIS INTEGRATION TESTS
# =============================================================================
class TestAcronis:
    """Acronis integration tests"""

    def test_get_acronis_customers(self, headers):
        """GET /api/acronis/customers returns customer list"""
        response = requests.get(f"{BASE_URL}/api/acronis/customers", headers=headers)
        assert response.status_code == 200
        customers = response.json()
        assert isinstance(customers, list)
        if customers:
            for c in customers[:3]:
                assert "id" in c
                assert "name" in c
        print(f"Acronis customers: {len(customers)}")

    def test_get_acronis_subscriptions(self, headers):
        """GET /api/acronis/subscriptions returns subscription list"""
        response = requests.get(f"{BASE_URL}/api/acronis/subscriptions", headers=headers)
        assert response.status_code == 200
        subs = response.json()
        assert isinstance(subs, list)
        if subs:
            for s in subs[:3]:
                assert "service_name" in s
                assert "monthly_cost" in s
        print(f"Acronis subscriptions: {len(subs)}")

    def test_get_acronis_usage_summary(self, headers):
        """GET /api/acronis/usage-summary returns summary"""
        response = requests.get(f"{BASE_URL}/api/acronis/usage-summary", headers=headers)
        assert response.status_code == 200
        summary = response.json()
        assert "total_customers" in summary
        assert "total_devices" in summary
        print(f"Acronis summary: {summary}")

    def test_acronis_sync(self, headers):
        """POST /api/acronis/sync triggers sync"""
        response = requests.post(f"{BASE_URL}/api/acronis/sync", json={}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "synced_at" in data

    def test_link_acronis_customer(self, headers):
        """POST /api/acronis/customers/{id}/link links to client"""
        # Get customers
        cust_res = requests.get(f"{BASE_URL}/api/acronis/customers", headers=headers)
        customers = cust_res.json()
        if not customers:
            pytest.skip("No Acronis customers")
        
        # Get clients
        client_res = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = client_res.json()
        if not clients:
            pytest.skip("No clients")
        
        response = requests.post(
            f"{BASE_URL}/api/acronis/customers/{customers[0]['id']}/link",
            json={"client_id": clients[0]["id"]},
            headers=headers
        )
        assert response.status_code == 200


# =============================================================================
# GRADIENT MSP BILLING RECONCILIATION TESTS
# =============================================================================
class TestGradient:
    """Gradient MSP billing reconciliation tests"""

    def test_get_reconciliation_dashboard(self, headers):
        """GET /api/gradient/reconciliation returns dashboard data"""
        response = requests.get(f"{BASE_URL}/api/gradient/reconciliation", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "summary" in data
        summary = data["summary"]
        assert "total_billed" in summary
        assert "total_actual_usage" in summary
        assert "missed_revenue" in summary
        assert "matched_count" in summary
        assert "under_billed_count" in summary
        assert "over_billed_count" in summary
        print(f"Gradient reconciliation items: {len(data['items'])}, summary: {summary}")

    def test_get_revenue_opportunities(self, headers):
        """GET /api/gradient/revenue-opportunities returns opportunities"""
        response = requests.get(f"{BASE_URL}/api/gradient/revenue-opportunities", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "opportunities" in data
        assert "total_potential_mrr" in data
        opps = data["opportunities"]
        if opps:
            for o in opps[:3]:
                assert "client_name" in o
                assert "service" in o
                assert "potential_mrr" in o
        print(f"Revenue opportunities: {len(opps)}, total MRR: ${data['total_potential_mrr']}")


# =============================================================================
# FINANCIAL REPORTS TESTS (8 reports)
# =============================================================================
class TestFinancialReports:
    """Financial reports tests - all 8 endpoints"""

    def test_revenue_summary(self, headers):
        """GET /api/reports/financial/revenue-summary"""
        response = requests.get(f"{BASE_URL}/api/reports/financial/revenue-summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "monthly_data" in data
        assert "current_mrr" in data
        assert "current_arr" in data
        assert "total_revenue" in data
        assert "total_collected" in data
        assert "total_outstanding" in data
        print(f"Revenue: MRR=${data['current_mrr']}, ARR=${data['current_arr']}")

    def test_aging_report(self, headers):
        """GET /api/reports/financial/aging"""
        response = requests.get(f"{BASE_URL}/api/reports/financial/aging", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "buckets" in data
        assert "grand_total" in data
        buckets = data["buckets"]
        assert "current" in buckets
        assert "30_days" in buckets
        assert "60_days" in buckets
        assert "90_days" in buckets
        assert "over_90" in buckets
        print(f"Aging: grand total = ${data['grand_total']}")

    def test_profit_loss(self, headers):
        """GET /api/reports/financial/profit-loss"""
        response = requests.get(f"{BASE_URL}/api/reports/financial/profit-loss", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "monthly_data" in data
        if data["monthly_data"]:
            month = data["monthly_data"][0]
            assert "revenue" in month
            assert "cogs" in month
            assert "gross_profit" in month
            assert "net_profit" in month
        print(f"P&L: {len(data['monthly_data'])} months")

    def test_client_revenue(self, headers):
        """GET /api/reports/financial/client-revenue"""
        response = requests.get(f"{BASE_URL}/api/reports/financial/client-revenue", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "clients" in data
        assert "total_invoiced" in data
        assert "total_collected" in data
        print(f"Client revenue: {len(data['clients'])} clients")

    def test_service_revenue(self, headers):
        """GET /api/reports/financial/service-revenue"""
        response = requests.get(f"{BASE_URL}/api/reports/financial/service-revenue", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "services" in data
        assert "total_service_revenue" in data
        print(f"Service revenue: {len(data['services'])} services")

    def test_payment_collection(self, headers):
        """GET /api/reports/financial/payment-collection"""
        response = requests.get(f"{BASE_URL}/api/reports/financial/payment-collection", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "by_method" in data
        assert "monthly" in data
        print(f"Collections: {len(data['by_method'])} methods, {len(data['monthly'])} months")

    def test_tax_summary(self, headers):
        """GET /api/reports/financial/tax-summary"""
        response = requests.get(f"{BASE_URL}/api/reports/financial/tax-summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "quarters" in data
        assert "total_tax_collected" in data
        print(f"Tax: {len(data['quarters'])} quarters, total=${data['total_tax_collected']}")

    def test_monthly_allocations(self, headers):
        """GET /api/reports/financial/monthly-allocations"""
        response = requests.get(f"{BASE_URL}/api/reports/financial/monthly-allocations", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "month" in data
        assert "allocations" in data
        assert "summary" in data
        summary = data["summary"]
        assert "total_mrr" in summary
        assert "total_adhoc" in summary
        assert "total_revenue" in summary
        print(f"Allocations: {len(data['allocations'])} items, MRR=${summary['total_mrr']}")


# =============================================================================
# TICKET ATTACHMENTS TESTS
# =============================================================================
class TestTicketAttachments:
    """Ticket attachment tests"""

    def test_get_tickets_list(self, headers):
        """Get tickets to find one for attachment test"""
        response = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        assert response.status_code == 200
        tickets = response.json()
        assert isinstance(tickets, list)
        print(f"Found {len(tickets)} tickets")

    def test_get_ticket_attachments(self, headers):
        """GET /api/tickets/{id}/attachments returns attachment list"""
        tickets_res = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = tickets_res.json()
        if not tickets:
            pytest.skip("No tickets to test")
        ticket_id = tickets[0].get("id")
        
        response = requests.get(f"{BASE_URL}/api/tickets/{ticket_id}/attachments", headers=headers)
        assert response.status_code == 200
        attachments = response.json()
        assert isinstance(attachments, list)
        print(f"Ticket {ticket_id} attachments: {len(attachments)}")

    def test_upload_ticket_attachment(self, headers):
        """POST /api/tickets/{id}/attachments uploads file"""
        tickets_res = requests.get(f"{BASE_URL}/api/tickets", headers=headers)
        tickets = tickets_res.json()
        if not tickets:
            pytest.skip("No tickets to test")
        ticket_id = tickets[0].get("id")
        
        # Create a test file content
        test_content = b"Test attachment content for NexusOps ticket"
        files = {"file": ("test_attachment.txt", test_content, "text/plain")}
        
        # Remove Content-Type from headers for multipart
        upload_headers = {"Authorization": headers["Authorization"]}
        
        response = requests.post(
            f"{BASE_URL}/api/tickets/{ticket_id}/attachments",
            files=files,
            headers=upload_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "filename" in data
        assert "url" in data
        print(f"Uploaded attachment: {data}")


# =============================================================================
# DEVICE CHAT TESTS
# =============================================================================
class TestDeviceChat:
    """Device chat with typing/read status tests"""

    def test_get_devices(self, headers):
        """Get devices to find one for chat test"""
        response = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        assert response.status_code == 200
        devices = response.json()
        assert isinstance(devices, list)
        print(f"Found {len(devices)} devices")

    def test_send_chat_message(self, headers):
        """POST /api/devices/{id}/chat sends a message"""
        devices_res = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        devices = devices_res.json()
        if not devices:
            pytest.skip("No devices to test")
        device_id = devices[0].get("id")
        
        response = requests.post(f"{BASE_URL}/api/devices/{device_id}/chat", json={
            "content": "Test chat message from pytest",
            "message_type": "text"
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "content" in data
        assert data["content"] == "Test chat message from pytest"
        print(f"Sent message: {data['id']}")
        return data["id"], device_id

    def test_get_chat_messages(self, headers):
        """GET /api/devices/{id}/chat returns messages"""
        devices_res = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        devices = devices_res.json()
        if not devices:
            pytest.skip("No devices to test")
        device_id = devices[0].get("id")
        
        response = requests.get(f"{BASE_URL}/api/devices/{device_id}/chat", headers=headers)
        assert response.status_code == 200
        messages = response.json()
        assert isinstance(messages, list)
        print(f"Device {device_id} chat messages: {len(messages)}")

    def test_set_typing_status(self, headers):
        """POST /api/devices/{id}/chat/typing sets typing status"""
        devices_res = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        devices = devices_res.json()
        if not devices:
            pytest.skip("No devices to test")
        device_id = devices[0].get("id")
        
        response = requests.post(f"{BASE_URL}/api/devices/{device_id}/chat/typing", json={
            "typing": True
        }, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "typing_users" in data
        print(f"Typing users: {data['typing_users']}")

    def test_get_typing_status(self, headers):
        """GET /api/devices/{id}/chat/typing returns typing users"""
        devices_res = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        devices = devices_res.json()
        if not devices:
            pytest.skip("No devices to test")
        device_id = devices[0].get("id")
        
        response = requests.get(f"{BASE_URL}/api/devices/{device_id}/chat/typing", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "typing_users" in data

    def test_export_chat_pdf(self, headers):
        """GET /api/devices/{id}/chat/export-pdf returns PDF"""
        devices_res = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        devices = devices_res.json()
        if not devices:
            pytest.skip("No devices to test")
        device_id = devices[0].get("id")
        
        response = requests.get(f"{BASE_URL}/api/devices/{device_id}/chat/export-pdf", headers=headers)
        assert response.status_code == 200
        assert response.headers.get("content-type") == "application/pdf"
        assert len(response.content) > 500
        print(f"Chat PDF export: {len(response.content)} bytes")

    def test_mark_messages_read(self, headers):
        """POST /api/devices/{id}/chat/mark-read marks messages read"""
        devices_res = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        devices = devices_res.json()
        if not devices:
            pytest.skip("No devices to test")
        device_id = devices[0].get("id")
        
        response = requests.post(f"{BASE_URL}/api/devices/{device_id}/chat/mark-read", json={
            "message_ids": []  # Mark all
        }, headers=headers)
        assert response.status_code == 200

    def test_get_unread_count(self, headers):
        """GET /api/devices/{id}/chat/unread-count returns count"""
        devices_res = requests.get(f"{BASE_URL}/api/devices", headers=headers)
        devices = devices_res.json()
        if not devices:
            pytest.skip("No devices to test")
        device_id = devices[0].get("id")
        
        response = requests.get(f"{BASE_URL}/api/devices/{device_id}/chat/unread-count", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "unread_count" in data


# =============================================================================
# SIDEBAR VERIFICATION - Check routes exist
# =============================================================================
class TestSidebarRoutes:
    """Verify new sidebar routes are accessible"""

    def test_gradient_page_loads(self, headers):
        """Gradient page route should work"""
        # This tests the API, frontend routes handled by Playwright
        response = requests.get(f"{BASE_URL}/api/gradient/reconciliation", headers=headers)
        assert response.status_code == 200

    def test_financial_reports_page_loads(self, headers):
        """Financial reports page route should work"""
        response = requests.get(f"{BASE_URL}/api/reports/financial/revenue-summary", headers=headers)
        assert response.status_code == 200


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
