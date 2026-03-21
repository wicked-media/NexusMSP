"""
Iteration 55 - PO and Invoice Enhanced Features Testing
Tests for:
- PO: Stats, PDF, Approval workflow, Email vendor, Notes, Duplicate, Spend Analytics
- Invoice: Stats, Clone, Email, Credit Notes, Aging Report, Revenue Analytics
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = "https://nexus-enterprise-ops.preview.emergentagent.com"

# Test credentials
TEST_EMAIL = "admin@nexusops.io"
TEST_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")


@pytest.fixture(scope="module")
def headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ============== PURCHASE ORDER TESTS ==============

class TestPurchaseOrderStats:
    """PO Stats endpoint tests"""
    
    def test_get_po_stats(self, headers):
        """Test PO stats endpoint returns expected fields"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders/stats", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        # Verify stats fields exist
        assert "total" in data, "Missing 'total' in stats"
        assert "draft" in data, "Missing 'draft' in stats"
        assert "submitted" in data, "Missing 'submitted' in stats"
        assert "partial" in data, "Missing 'partial' in stats"
        assert "total_value" in data, "Missing 'total_value' in stats"
        print(f"PO Stats: total={data['total']}, draft={data['draft']}, submitted={data['submitted']}, total_value=${data['total_value']}")


class TestPurchaseOrderCRUD:
    """PO CRUD operations"""
    
    @pytest.fixture(scope="class")
    def test_po(self, headers):
        """Create a test PO for subsequent tests"""
        payload = {
            "vendor": "TEST_Vendor_Iter55",
            "vendor_email": "test@vendor55.com",
            "status": "draft",
            "line_items": [
                {"product_name": "Test Item 1", "quantity": 5, "unit_price": 100.00},
                {"product_name": "Test Item 2", "quantity": 3, "unit_price": 50.00}
            ],
            "subtotal": 650.00,
            "tax": 65.00,
            "shipping": 25.00,
            "total": 740.00,
            "notes": "Test PO for iteration 55",
            "expected_delivery": (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
        }
        response = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create PO: {response.text}"
        po = response.json()
        print(f"Created test PO: {po.get('po_number')}")
        yield po
        # Cleanup
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers)
    
    def test_get_po_list(self, headers):
        """Test getting PO list"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"PO list count: {len(data)}")
    
    def test_get_po_detail(self, headers, test_po):
        """Test getting PO detail"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders/{test_po['id']}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_po["id"]
        assert data["vendor"] == "TEST_Vendor_Iter55"
        print(f"PO detail: {data.get('po_number')} - {data.get('vendor')}")


class TestPOApprovalWorkflow:
    """PO Approval workflow tests"""
    
    @pytest.fixture(scope="class")
    def approval_po(self, headers):
        """Create a draft PO for approval testing"""
        payload = {
            "vendor": "TEST_Approval_Vendor",
            "status": "draft",
            "line_items": [{"product_name": "Approval Test Item", "quantity": 1, "unit_price": 500.00}],
            "subtotal": 500.00,
            "tax": 50.00,
            "total": 550.00
        }
        response = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=headers)
        assert response.status_code == 200
        po = response.json()
        yield po
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers)
    
    def test_submit_for_approval(self, headers, approval_po):
        """Test submitting PO for approval"""
        response = requests.post(
            f"{BASE_URL}/api/purchase-orders/{approval_po['id']}/submit-for-approval",
            json={"approver_id": "", "approver_name": ""},
            headers=headers
        )
        assert response.status_code == 200, f"Submit for approval failed: {response.text}"
        data = response.json()
        assert "message" in data
        print(f"Submit for approval: {data.get('message')}")
        
        # Verify status changed
        po_response = requests.get(f"{BASE_URL}/api/purchase-orders/{approval_po['id']}", headers=headers)
        po_data = po_response.json()
        assert po_data["status"] == "pending_approval", f"Expected pending_approval, got {po_data['status']}"
    
    def test_approve_po(self, headers, approval_po):
        """Test approving a PO"""
        response = requests.post(
            f"{BASE_URL}/api/purchase-orders/{approval_po['id']}/approve",
            json={"notes": "Approved for testing"},
            headers=headers
        )
        assert response.status_code == 200, f"Approve failed: {response.text}"
        data = response.json()
        assert "message" in data
        print(f"Approve PO: {data.get('message')}")
        
        # Verify status changed
        po_response = requests.get(f"{BASE_URL}/api/purchase-orders/{approval_po['id']}", headers=headers)
        po_data = po_response.json()
        assert po_data["status"] == "approved", f"Expected approved, got {po_data['status']}"
        assert po_data.get("approved_by_name") is not None


class TestPORejectWorkflow:
    """PO Rejection workflow tests"""
    
    @pytest.fixture(scope="class")
    def reject_po(self, headers):
        """Create a PO for rejection testing"""
        payload = {
            "vendor": "TEST_Reject_Vendor",
            "status": "draft",
            "line_items": [{"product_name": "Reject Test Item", "quantity": 1, "unit_price": 200.00}],
            "subtotal": 200.00,
            "total": 200.00
        }
        response = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=headers)
        po = response.json()
        # Submit for approval first
        requests.post(f"{BASE_URL}/api/purchase-orders/{po['id']}/submit-for-approval", json={}, headers=headers)
        yield po
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers)
    
    def test_reject_po(self, headers, reject_po):
        """Test rejecting a PO"""
        response = requests.post(
            f"{BASE_URL}/api/purchase-orders/{reject_po['id']}/reject",
            json={"reason": "Budget exceeded for testing"},
            headers=headers
        )
        assert response.status_code == 200, f"Reject failed: {response.text}"
        
        # Verify status
        po_response = requests.get(f"{BASE_URL}/api/purchase-orders/{reject_po['id']}", headers=headers)
        po_data = po_response.json()
        assert po_data["status"] == "rejected"
        assert po_data.get("rejection_reason") == "Budget exceeded for testing"
        print(f"PO rejected: {po_data.get('rejection_reason')}")


class TestPONotes:
    """PO Notes functionality tests"""
    
    @pytest.fixture(scope="class")
    def notes_po(self, headers):
        """Create a PO for notes testing"""
        payload = {
            "vendor": "TEST_Notes_Vendor",
            "status": "draft",
            "line_items": [{"product_name": "Notes Test Item", "quantity": 1, "unit_price": 100.00}],
            "subtotal": 100.00,
            "total": 100.00
        }
        response = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=headers)
        po = response.json()
        yield po
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers)
    
    def test_add_po_note(self, headers, notes_po):
        """Test adding a note to PO"""
        response = requests.post(
            f"{BASE_URL}/api/purchase-orders/{notes_po['id']}/notes",
            json={"content": "Test note for iteration 55", "note_type": "general"},
            headers=headers
        )
        assert response.status_code == 200, f"Add note failed: {response.text}"
        data = response.json()
        assert data.get("content") == "Test note for iteration 55"
        print(f"Added note: {data.get('content')}")
    
    def test_get_po_notes(self, headers, notes_po):
        """Test getting PO notes"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders/{notes_po['id']}/notes", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        print(f"PO notes count: {len(data)}")


class TestPODuplicate:
    """PO Duplicate functionality tests"""
    
    @pytest.fixture(scope="class")
    def dup_po(self, headers):
        """Create a PO for duplication testing"""
        payload = {
            "vendor": "TEST_Duplicate_Vendor",
            "status": "draft",
            "line_items": [{"product_name": "Dup Test Item", "quantity": 2, "unit_price": 150.00}],
            "subtotal": 300.00,
            "total": 300.00
        }
        response = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=headers)
        po = response.json()
        yield po
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers)
    
    def test_duplicate_po(self, headers, dup_po):
        """Test duplicating a PO"""
        response = requests.post(
            f"{BASE_URL}/api/purchase-orders/{dup_po['id']}/duplicate",
            json={},
            headers=headers
        )
        assert response.status_code == 200, f"Duplicate failed: {response.text}"
        data = response.json()
        assert data["id"] != dup_po["id"], "Duplicate should have new ID"
        assert data["po_number"] != dup_po["po_number"], "Duplicate should have new PO number"
        assert data["status"] == "draft", "Duplicate should be draft status"
        assert data["vendor"] == dup_po["vendor"], "Duplicate should have same vendor"
        print(f"Duplicated PO: {dup_po['po_number']} -> {data['po_number']}")
        # Cleanup duplicate
        requests.delete(f"{BASE_URL}/api/purchase-orders/{data['id']}", headers=headers)


class TestPOPDF:
    """PO PDF generation tests"""
    
    @pytest.fixture(scope="class")
    def pdf_po(self, headers):
        """Create a PO for PDF testing"""
        payload = {
            "vendor": "TEST_PDF_Vendor",
            "vendor_email": "pdf@vendor.com",
            "status": "approved",
            "line_items": [
                {"product_name": "PDF Test Item 1", "quantity": 3, "unit_price": 100.00},
                {"product_name": "PDF Test Item 2", "quantity": 2, "unit_price": 75.00}
            ],
            "subtotal": 450.00,
            "tax": 45.00,
            "shipping": 15.00,
            "total": 510.00,
            "notes": "PDF generation test"
        }
        response = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=headers)
        po = response.json()
        yield po
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers)
    
    def test_download_po_pdf(self, headers, pdf_po):
        """Test downloading PO PDF"""
        response = requests.get(
            f"{BASE_URL}/api/purchase-orders/{pdf_po['id']}/pdf",
            headers=headers
        )
        assert response.status_code == 200, f"PDF download failed: {response.text}"
        assert response.headers.get("content-type") == "application/pdf"
        assert len(response.content) > 1000, "PDF content too small"
        print(f"PDF downloaded: {len(response.content)} bytes")


class TestPOEmailVendor:
    """PO Email to vendor tests"""
    
    @pytest.fixture(scope="class")
    def email_po(self, headers):
        """Create a PO for email testing"""
        payload = {
            "vendor": "TEST_Email_Vendor",
            "vendor_email": "email@vendor55.com",
            "status": "approved",
            "line_items": [{"product_name": "Email Test Item", "quantity": 1, "unit_price": 200.00}],
            "subtotal": 200.00,
            "total": 200.00
        }
        response = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=headers)
        po = response.json()
        yield po
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers)
    
    def test_email_po_to_vendor(self, headers, email_po):
        """Test emailing PO to vendor (MOCKED - email not actually sent)"""
        response = requests.post(
            f"{BASE_URL}/api/purchase-orders/{email_po['id']}/email-vendor",
            json={
                "email": "test@vendor55.com",
                "subject": "Test PO Email",
                "message": "Please review attached PO"
            },
            headers=headers
        )
        assert response.status_code == 200, f"Email vendor failed: {response.text}"
        data = response.json()
        assert "message" in data
        print(f"Email vendor result: {data.get('message')} (sent: {data.get('sent', 'N/A')})")


class TestPOAuditLog:
    """PO Audit log tests"""
    
    @pytest.fixture(scope="class")
    def audit_po(self, headers):
        """Create a PO for audit testing"""
        payload = {
            "vendor": "TEST_Audit_Vendor",
            "status": "draft",
            "line_items": [{"product_name": "Audit Test Item", "quantity": 1, "unit_price": 100.00}],
            "subtotal": 100.00,
            "total": 100.00
        }
        response = requests.post(f"{BASE_URL}/api/purchase-orders", json=payload, headers=headers)
        po = response.json()
        yield po
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers)
    
    def test_get_po_audit_log(self, headers, audit_po):
        """Test getting PO audit log"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders/{audit_po['id']}/audit-log", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Should have at least 'created' entry
        assert len(data) >= 1
        print(f"Audit log entries: {len(data)}")


class TestPOSpendAnalytics:
    """PO Spend Analytics tests"""
    
    def test_get_spend_analytics(self, headers):
        """Test getting PO spend analytics"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders/analytics/spend", headers=headers)
        assert response.status_code == 200, f"Spend analytics failed: {response.text}"
        data = response.json()
        assert "total_spend" in data
        assert "total_pos" in data
        assert "avg_po_value" in data
        assert "top_vendors" in data
        assert "monthly_spend" in data
        assert "status_breakdown" in data
        print(f"Spend Analytics: total_spend=${data['total_spend']}, total_pos={data['total_pos']}, avg=${data['avg_po_value']}")
        print(f"Top vendors: {len(data['top_vendors'])}, Monthly data points: {len(data['monthly_spend'])}")


# ============== INVOICE TESTS ==============

class TestInvoiceStats:
    """Invoice Stats endpoint tests"""
    
    def test_get_invoice_stats(self, headers):
        """Test invoice stats endpoint"""
        response = requests.get(f"{BASE_URL}/api/invoices/stats/summary", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "total" in data
        assert "paid" in data
        assert "unpaid" in data
        assert "total_revenue" in data
        assert "total_collected" in data
        assert "total_outstanding" in data
        print(f"Invoice Stats: total={data['total']}, paid={data['paid']}, unpaid={data['unpaid']}, outstanding=${data['total_outstanding']}")


class TestInvoiceCRUD:
    """Invoice CRUD operations"""
    
    @pytest.fixture(scope="class")
    def test_client(self, headers):
        """Get or create a test client"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        if clients:
            return clients[0]
        # Create a test client
        client_payload = {"name": "TEST_Invoice_Client", "email": "invoice@test55.com"}
        response = requests.post(f"{BASE_URL}/api/clients", json=client_payload, headers=headers)
        return response.json()
    
    @pytest.fixture(scope="class")
    def test_invoice(self, headers, test_client):
        """Create a test invoice"""
        payload = {
            "client_id": test_client["id"],
            "due_date": (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d"),
            "line_items": [
                {"name": "Test Service 1", "quantity": 2, "unit_price": 150.00, "total": 300.00},
                {"name": "Test Service 2", "quantity": 1, "unit_price": 200.00, "total": 200.00}
            ],
            "tax_rate": 10,
            "notes": "Test invoice for iteration 55"
        }
        response = requests.post(f"{BASE_URL}/api/invoices", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create invoice: {response.text}"
        invoice = response.json()
        print(f"Created test invoice: {invoice.get('invoice_number')}")
        yield invoice
        requests.delete(f"{BASE_URL}/api/invoices/{invoice['id']}", headers=headers)
    
    def test_get_invoice_list(self, headers):
        """Test getting invoice list"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Invoice list count: {len(data)}")
    
    def test_get_invoice_detail(self, headers, test_invoice):
        """Test getting invoice detail"""
        response = requests.get(f"{BASE_URL}/api/invoices/{test_invoice['id']}", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_invoice["id"]
        print(f"Invoice detail: {data.get('invoice_number')} - ${data.get('total')}")


class TestInvoiceClone:
    """Invoice Clone functionality tests"""
    
    @pytest.fixture(scope="class")
    def clone_client(self, headers):
        """Get a client for clone testing"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        return clients[0] if clients else None
    
    @pytest.fixture(scope="class")
    def clone_invoice(self, headers, clone_client):
        """Create an invoice for cloning"""
        if not clone_client:
            pytest.skip("No client available")
        payload = {
            "client_id": clone_client["id"],
            "due_date": (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d"),
            "line_items": [{"name": "Clone Test Service", "quantity": 1, "unit_price": 500.00, "total": 500.00}],
            "tax_rate": 10,
            "notes": "Invoice to be cloned"
        }
        response = requests.post(f"{BASE_URL}/api/invoices", json=payload, headers=headers)
        invoice = response.json()
        yield invoice
        requests.delete(f"{BASE_URL}/api/invoices/{invoice['id']}", headers=headers)
    
    def test_clone_invoice(self, headers, clone_invoice):
        """Test cloning an invoice"""
        response = requests.post(
            f"{BASE_URL}/api/invoices/{clone_invoice['id']}/clone",
            json={},
            headers=headers
        )
        assert response.status_code == 200, f"Clone failed: {response.text}"
        data = response.json()
        assert data["id"] != clone_invoice["id"], "Clone should have new ID"
        assert data["invoice_number"] != clone_invoice["invoice_number"], "Clone should have new invoice number"
        assert data["payment_status"] == "unpaid", "Clone should be unpaid"
        assert data["status"] == "draft", "Clone should be draft"
        print(f"Cloned invoice: {clone_invoice['invoice_number']} -> {data['invoice_number']}")
        # Cleanup
        requests.delete(f"{BASE_URL}/api/invoices/{data['id']}", headers=headers)


class TestInvoiceEmail:
    """Invoice Email functionality tests"""
    
    @pytest.fixture(scope="class")
    def email_client(self, headers):
        """Get a client for email testing"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        return clients[0] if clients else None
    
    @pytest.fixture(scope="class")
    def email_invoice(self, headers, email_client):
        """Create an invoice for email testing"""
        if not email_client:
            pytest.skip("No client available")
        payload = {
            "client_id": email_client["id"],
            "due_date": (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d"),
            "line_items": [{"name": "Email Test Service", "quantity": 1, "unit_price": 300.00, "total": 300.00}],
            "tax_rate": 10
        }
        response = requests.post(f"{BASE_URL}/api/invoices", json=payload, headers=headers)
        invoice = response.json()
        yield invoice
        requests.delete(f"{BASE_URL}/api/invoices/{invoice['id']}", headers=headers)
    
    def test_email_invoice(self, headers, email_invoice):
        """Test emailing invoice (MOCKED - email not actually sent)"""
        response = requests.post(
            f"{BASE_URL}/api/invoices/{email_invoice['id']}/email",
            json={
                "email": "test@client55.com",
                "subject": "Test Invoice Email",
                "message": "Please review attached invoice"
            },
            headers=headers
        )
        assert response.status_code == 200, f"Email invoice failed: {response.text}"
        data = response.json()
        assert "message" in data
        print(f"Email invoice result: {data.get('message')} (sent: {data.get('sent', 'N/A')})")
    
    def test_get_email_history(self, headers, email_invoice):
        """Test getting invoice email history"""
        response = requests.get(f"{BASE_URL}/api/invoices/{email_invoice['id']}/email-history", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Email history count: {len(data)}")


class TestCreditNotes:
    """Credit Notes functionality tests"""
    
    @pytest.fixture(scope="class")
    def cn_client(self, headers):
        """Get a client for credit note testing"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        return clients[0] if clients else None
    
    @pytest.fixture(scope="class")
    def cn_invoice(self, headers, cn_client):
        """Create an invoice for credit note testing"""
        if not cn_client:
            pytest.skip("No client available")
        payload = {
            "client_id": cn_client["id"],
            "due_date": (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d"),
            "line_items": [{"name": "Credit Note Test Service", "quantity": 1, "unit_price": 1000.00, "total": 1000.00}],
            "tax_rate": 10
        }
        response = requests.post(f"{BASE_URL}/api/invoices", json=payload, headers=headers)
        invoice = response.json()
        yield invoice
        requests.delete(f"{BASE_URL}/api/invoices/{invoice['id']}", headers=headers)
    
    def test_create_credit_note(self, headers, cn_invoice, cn_client):
        """Test creating a credit note"""
        response = requests.post(
            f"{BASE_URL}/api/credit-notes",
            json={
                "invoice_id": cn_invoice["id"],
                "client_id": cn_client["id"],
                "client_name": cn_client.get("name", "Test Client"),
                "reason": "Partial refund for testing",
                "subtotal": 100.00,
                "tax": 10.00,
                "total": 110.00,
                "line_items": []
            },
            headers=headers
        )
        assert response.status_code == 200, f"Create credit note failed: {response.text}"
        data = response.json()
        assert "credit_note_number" in data
        assert data["total"] == 110.00
        print(f"Created credit note: {data.get('credit_note_number')} for ${data.get('total')}")
    
    def test_get_credit_notes(self, headers):
        """Test getting credit notes list"""
        response = requests.get(f"{BASE_URL}/api/credit-notes", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Credit notes count: {len(data)}")


class TestAgingReport:
    """Aging Report functionality tests"""
    
    def test_get_aging_report(self, headers):
        """Test getting aging report"""
        response = requests.get(f"{BASE_URL}/api/invoices/aging-report", headers=headers)
        assert response.status_code == 200, f"Aging report failed: {response.text}"
        data = response.json()
        assert "buckets" in data
        assert "grand_total" in data
        assert "total_invoices" in data
        # Check bucket structure
        buckets = data["buckets"]
        expected_buckets = ["current", "30", "60", "90", "120_plus"]
        for bucket in expected_buckets:
            assert bucket in buckets, f"Missing bucket: {bucket}"
            assert "total" in buckets[bucket]
            assert "count" in buckets[bucket]
            assert "invoices" in buckets[bucket]
        print(f"Aging Report: grand_total=${data['grand_total']}, total_invoices={data['total_invoices']}")
        for bucket in expected_buckets:
            print(f"  {bucket}: ${buckets[bucket]['total']} ({buckets[bucket]['count']} invoices)")


class TestRevenueAnalytics:
    """Revenue Analytics functionality tests"""
    
    def test_get_revenue_analytics(self, headers):
        """Test getting revenue analytics"""
        response = requests.get(f"{BASE_URL}/api/invoices/analytics/revenue", headers=headers)
        assert response.status_code == 200, f"Revenue analytics failed: {response.text}"
        data = response.json()
        assert "total_revenue" in data
        assert "total_collected" in data
        assert "outstanding" in data
        assert "collection_rate" in data
        assert "mrr" in data
        assert "arr" in data
        assert "monthly_revenue" in data
        assert "top_clients" in data
        print(f"Revenue Analytics: total_revenue=${data['total_revenue']}, collected=${data['total_collected']}")
        print(f"  MRR=${data['mrr']}, ARR=${data['arr']}, collection_rate={data['collection_rate']}%")
        print(f"  Monthly data points: {len(data['monthly_revenue'])}, Top clients: {len(data['top_clients'])}")


class TestInvoiceActivityLog:
    """Invoice Activity Log tests"""
    
    @pytest.fixture(scope="class")
    def activity_client(self, headers):
        """Get a client for activity testing"""
        response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
        clients = response.json()
        return clients[0] if clients else None
    
    @pytest.fixture(scope="class")
    def activity_invoice(self, headers, activity_client):
        """Create an invoice for activity testing"""
        if not activity_client:
            pytest.skip("No client available")
        payload = {
            "client_id": activity_client["id"],
            "due_date": (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d"),
            "line_items": [{"name": "Activity Test Service", "quantity": 1, "unit_price": 200.00, "total": 200.00}],
            "tax_rate": 10
        }
        response = requests.post(f"{BASE_URL}/api/invoices", json=payload, headers=headers)
        invoice = response.json()
        yield invoice
        requests.delete(f"{BASE_URL}/api/invoices/{invoice['id']}", headers=headers)
    
    def test_get_invoice_activity_log(self, headers, activity_invoice):
        """Test getting invoice activity log"""
        response = requests.get(f"{BASE_URL}/api/invoices/{activity_invoice['id']}/activity-log", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Invoice activity log entries: {len(data)}")


# ============== CLEANUP ==============

class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_pos(self, headers):
        """Cleanup any remaining test POs"""
        response = requests.get(f"{BASE_URL}/api/purchase-orders", headers=headers)
        if response.status_code == 200:
            pos = response.json()
            deleted = 0
            for po in pos:
                if po.get("vendor", "").startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers)
                    deleted += 1
            print(f"Cleaned up {deleted} test POs")
    
    def test_cleanup_test_invoices(self, headers):
        """Cleanup any remaining test invoices"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        if response.status_code == 200:
            invoices = response.json()
            deleted = 0
            for inv in invoices:
                if inv.get("notes", "").startswith("Test invoice for iteration 55"):
                    requests.delete(f"{BASE_URL}/api/invoices/{inv['id']}", headers=headers)
                    deleted += 1
            print(f"Cleaned up {deleted} test invoices")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
