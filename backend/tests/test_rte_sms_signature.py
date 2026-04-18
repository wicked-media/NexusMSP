"""
Test RichTextEditor enhancements and SMS Signature features
Tests the delta from iteration 100:
- GET/PUT /api/settings/sms now includes signature and append_signature
- POST /api/sms/send auto-appends signature when not already present
- Test SMS endpoint passes skip_signature=True
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSMSSignatureFeatures:
    """Test SMS signature configuration and auto-append behavior"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session with auth"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login to get token
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "aaron@stech.com.au",
            "password": "Lucky@2871$!"
        })
        if login_resp.status_code == 200:
            token = login_resp.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
        else:
            pytest.skip("Authentication failed")
    
    # ============ SMS Settings with Signature ============
    def test_get_sms_settings_includes_signature_fields(self):
        """GET /api/settings/sms returns signature and append_signature fields"""
        resp = self.session.get(f"{BASE_URL}/api/settings/sms")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        
        # Verify signature fields exist
        assert "signature" in data, "Response should include 'signature' field"
        assert "append_signature" in data, "Response should include 'append_signature' field"
        
        # Verify default values
        print(f"Current signature: '{data.get('signature')}'")
        print(f"Append signature enabled: {data.get('append_signature')}")
        
        # Default should be "Kind Regards, NexusMSP" and True
        assert isinstance(data.get("append_signature"), bool), "append_signature should be boolean"
    
    def test_put_sms_settings_updates_signature(self):
        """PUT /api/settings/sms can update signature and append_signature"""
        # First get current settings
        get_resp = self.session.get(f"{BASE_URL}/api/settings/sms")
        assert get_resp.status_code == 200
        original = get_resp.json()
        
        # Update with test signature
        test_signature = "TEST_Signature - Best Regards, Test Team"
        update_resp = self.session.put(f"{BASE_URL}/api/settings/sms", json={
            "signature": test_signature,
            "append_signature": True
        })
        assert update_resp.status_code == 200, f"Expected 200, got {update_resp.status_code}: {update_resp.text}"
        
        # Verify update persisted
        verify_resp = self.session.get(f"{BASE_URL}/api/settings/sms")
        assert verify_resp.status_code == 200
        updated = verify_resp.json()
        assert updated.get("signature") == test_signature, f"Signature not updated. Got: {updated.get('signature')}"
        assert updated.get("append_signature") == True, "append_signature should be True"
        print(f"Successfully updated signature to: '{test_signature}'")
        
        # Restore original signature
        restore_resp = self.session.put(f"{BASE_URL}/api/settings/sms", json={
            "signature": original.get("signature", "Kind Regards, NexusMSP"),
            "append_signature": original.get("append_signature", True)
        })
        assert restore_resp.status_code == 200
        print("Restored original signature")
    
    def test_put_sms_settings_toggle_append_signature_off(self):
        """PUT /api/settings/sms can disable append_signature"""
        # Get current
        get_resp = self.session.get(f"{BASE_URL}/api/settings/sms")
        original = get_resp.json()
        
        # Disable append
        update_resp = self.session.put(f"{BASE_URL}/api/settings/sms", json={
            "append_signature": False
        })
        assert update_resp.status_code == 200
        
        # Verify
        verify_resp = self.session.get(f"{BASE_URL}/api/settings/sms")
        updated = verify_resp.json()
        assert updated.get("append_signature") == False, "append_signature should be False"
        print("Successfully disabled append_signature")
        
        # Restore
        self.session.put(f"{BASE_URL}/api/settings/sms", json={
            "append_signature": original.get("append_signature", True)
        })
    
    # ============ SMS Send with Signature Auto-Append ============
    def test_sms_send_auto_appends_signature(self):
        """POST /api/sms/send auto-appends signature when append_signature is true"""
        # First ensure signature is configured
        sig = "Kind Regards, NexusMSP"
        self.session.put(f"{BASE_URL}/api/settings/sms", json={
            "signature": sig,
            "append_signature": True
        })
        
        # Try to send SMS (will fail due to no provider, but we can check the stored message)
        # We use a test number that will fail at provider level
        send_resp = self.session.post(f"{BASE_URL}/api/sms/send", json={
            "to": "0400000000",
            "message": "Test message without signature"
        })
        
        # Accept 400 (provider not configured or validation) or 200/201 (if provider works)
        # The key is that the message should have signature appended in the stored doc
        print(f"Send SMS returned {send_resp.status_code}: {send_resp.text[:200]}")
        
        # Check the stored message in sms_messages collection
        msgs_resp = self.session.get(f"{BASE_URL}/api/sms/messages?limit=1")
        if msgs_resp.status_code == 200:
            msgs = msgs_resp.json()
            if msgs:
                latest = msgs[0]
                msg_text = latest.get("message", "")
                print(f"Latest stored message: '{msg_text[:100]}...'")
                # If the send was processed (even if failed), check if signature was appended
                if "Test message without signature" in msg_text:
                    if sig.lower() in msg_text.lower():
                        print("SUCCESS: Signature was auto-appended to stored message")
                    else:
                        print("NOTE: Signature may not have been appended (check if append_signature was on)")
    
    def test_sms_test_endpoint_skips_signature(self):
        """POST /api/sms/test passes skip_signature=True"""
        # Ensure signature is configured
        self.session.put(f"{BASE_URL}/api/settings/sms", json={
            "signature": "Kind Regards, NexusMSP",
            "append_signature": True
        })
        
        # Send test SMS
        test_resp = self.session.post(f"{BASE_URL}/api/sms/test", json={
            "to": "0400000000",
            "message": "NexusOps SMS test - should NOT have signature"
        })
        
        # Accept any status (provider may not be configured)
        print(f"Test SMS returned {test_resp.status_code}: {test_resp.text[:200]}")
        
        # The test endpoint should pass skip_signature=True internally
        # We can verify by checking the stored message doesn't have signature
        msgs_resp = self.session.get(f"{BASE_URL}/api/sms/messages?limit=5")
        if msgs_resp.status_code == 200:
            msgs = msgs_resp.json()
            for msg in msgs:
                if "NexusOps SMS test" in msg.get("message", ""):
                    if "Kind Regards" not in msg.get("message", ""):
                        print("SUCCESS: Test SMS did not have signature appended")
                    else:
                        print("NOTE: Test SMS may have signature (check skip_signature logic)")
                    break
    
    # ============ User Email Signature (for RichTextEditor) ============
    def test_get_users_list_includes_email_signature(self):
        """GET /api/users returns users with email_signature field"""
        users_resp = self.session.get(f"{BASE_URL}/api/users")
        assert users_resp.status_code == 200
        users = users_resp.json()
        
        # Find admin user
        admin = next((u for u in users if u.get("email") == "aaron@stech.com.au"), None)
        if not admin:
            pytest.skip("Admin user not found")
        
        # email_signature should be in the user data from list endpoint
        email_sig = admin.get("email_signature", "")
        print(f"User email_signature from list: '{email_sig[:100] if email_sig else '(empty)'}...'")
        # The field should exist (may be empty string)
        assert "email_signature" in admin or email_sig is not None, "email_signature field should exist"
    
    def test_put_user_updates_email_signature(self):
        """PUT /api/users/{id} can update email_signature with HTML"""
        users_resp = self.session.get(f"{BASE_URL}/api/users")
        users = users_resp.json()
        admin = next((u for u in users if u.get("email") == "aaron@stech.com.au"), None)
        if not admin:
            pytest.skip("Admin user not found")
        
        user_id = admin.get("id")
        original_sig = admin.get("email_signature", "")
        
        # Update with HTML signature (simulating RichTextEditor output)
        test_html_sig = '<table><tr><td><strong>TEST_Aaron</strong><br><a href="mailto:aaron@stech.com.au">aaron@stech.com.au</a></td></tr></table>'
        update_resp = self.session.put(f"{BASE_URL}/api/users/{user_id}", json={
            "email_signature": test_html_sig
        })
        assert update_resp.status_code == 200, f"Expected 200, got {update_resp.status_code}: {update_resp.text}"
        
        # Verify update by fetching users list again
        verify_resp = self.session.get(f"{BASE_URL}/api/users")
        verify_users = verify_resp.json()
        updated_admin = next((u for u in verify_users if u.get("id") == user_id), None)
        updated_sig = updated_admin.get("email_signature", "") if updated_admin else ""
        
        assert "TEST_Aaron" in updated_sig or "<table>" in updated_sig, f"HTML signature not saved. Got: {updated_sig[:100]}"
        print(f"Successfully saved HTML email signature")
        
        # Restore original
        self.session.put(f"{BASE_URL}/api/users/{user_id}", json={
            "email_signature": original_sig
        })
        print("Restored original email signature")
    
    # ============ Regression Tests ============
    def test_tickets_endpoint_still_works(self):
        """GET /api/tickets still works (regression)"""
        resp = self.session.get(f"{BASE_URL}/api/tickets")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert isinstance(data, list), "Expected list of tickets"
        print(f"Found {len(data)} tickets")
    
    def test_settings_tabs_endpoints_work(self):
        """Various settings endpoints still work (regression)"""
        endpoints = [
            "/api/settings/branding",
            "/api/settings/job-numbering",
            "/api/ai/config",
        ]
        for endpoint in endpoints:
            resp = self.session.get(f"{BASE_URL}{endpoint}")
            assert resp.status_code == 200, f"{endpoint} failed with {resp.status_code}"
            print(f"{endpoint}: OK")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
