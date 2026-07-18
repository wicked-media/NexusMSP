"""Iteration 175 â€” Client Studio (25 endpoints under /api/client-studio/*)."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8001").rstrip("/")
ADMIN_EMAIL = "aaron@stech.com.au"
ADMIN_PASS = "Lucky@2871$!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20, verify=False)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    j = r.json()
    tok = j.get("token") or j.get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def client_id(H):
    r = requests.get(f"{BASE_URL}/api/clients", headers=H, timeout=20, verify=False)
    assert r.status_code == 200
    d = r.json()
    items = d if isinstance(d, list) else d.get("clients") or d.get("items") or []
    assert items, "no clients available"
    return items[0]["id"]


# ---- Studio Home endpoints ----
def test_universe(H):
    r = requests.get(f"{BASE_URL}/api/client-studio/universe", headers=H, timeout=20, verify=False)
    assert r.status_code == 200
    d = r.json()
    assert "nodes" in d or "clients" in d or isinstance(d, list)


def test_pulse(H):
    r = requests.get(f"{BASE_URL}/api/client-studio/pulse", headers=H, timeout=20, verify=False)
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d, (list, dict))


def test_my_accounts(H):
    r = requests.get(f"{BASE_URL}/api/client-studio/my-accounts", headers=H, timeout=20, verify=False)
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d, (list, dict))


def test_renewal_watch(H):
    r = requests.get(f"{BASE_URL}/api/client-studio/renewal-watch", headers=H, timeout=20, verify=False)
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d, (list, dict))


# ---- Per-client endpoints ----
def test_360_context(H, client_id):
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/360-context", headers=H, timeout=30, verify=False)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    # interconnected view: must reference devices/subscriptions/tier/mrr/contracts
    keys = " ".join(d.keys()) if isinstance(d, dict) else ""
    assert any(k in keys for k in ["device", "subscription", "tier", "mrr", "contract", "client"])


def test_expansion(H, client_id):
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/expansion", headers=H, timeout=20, verify=False)
    assert r.status_code == 200


def test_renewal_forecast(H, client_id):
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/renewal-forecast", headers=H, timeout=20, verify=False)
    assert r.status_code == 200


def test_account_briefing(H, client_id):
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/account-briefing", headers=H, timeout=60, verify=False)
    assert r.status_code == 200, r.text[:300]


def test_account_plan_get_and_post(H, client_id):
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/account-plan", headers=H, timeout=20, verify=False)
    assert r.status_code == 200
    payload = {"goals": ["TEST_iter175 goal A"], "risks": ["TEST risk"], "actions": ["TEST action"], "objectives": "Test plan"}
    r2 = requests.post(f"{BASE_URL}/api/client-studio/{client_id}/account-plan", headers=H, json=payload, timeout=20, verify=False)
    assert r2.status_code in (200, 201), r2.text[:300]
    # Verify persistence
    r3 = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/account-plan", headers=H, timeout=20, verify=False)
    assert r3.status_code == 200
    body = r3.json()
    s = str(body)
    assert "TEST_iter175 goal A" in s or "TEST" in s


def test_stakeholders_crud(H, client_id):
    # GET initial
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/stakeholders", headers=H, timeout=20, verify=False)
    assert r.status_code == 200
    # POST new
    payload = {"name": "TEST_iter175 Stakeholder", "email": "test175@example.com", "role": "Champion", "influence": 80}
    r2 = requests.post(f"{BASE_URL}/api/client-studio/{client_id}/stakeholders", headers=H, json=payload, timeout=20, verify=False)
    assert r2.status_code in (200, 201), r2.text[:300]
    created = r2.json()
    sid = created.get("id") or created.get("_id") or created.get("stakeholder_id")
    assert sid, f"no id returned: {created}"
    # PUT update
    r3 = requests.put(f"{BASE_URL}/api/client-studio/stakeholders/{sid}", headers=H, json={"role": "Executive Sponsor"}, timeout=20, verify=False)
    assert r3.status_code in (200, 204), r3.text[:300]
    # DELETE
    r4 = requests.delete(f"{BASE_URL}/api/client-studio/stakeholders/{sid}", headers=H, timeout=20, verify=False)
    assert r4.status_code in (200, 204), r4.text[:300]


def test_achievements(H, client_id):
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/achievements", headers=H, timeout=20, verify=False)
    assert r.status_code == 200


def test_lifecycle(H, client_id):
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/lifecycle", headers=H, timeout=20, verify=False)
    assert r.status_code == 200


def test_churn_radar(H, client_id):
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/churn-radar", headers=H, timeout=20, verify=False)
    assert r.status_code == 200


def test_activity_heatmap(H, client_id):
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/activity-heatmap", headers=H, timeout=20, verify=False)
    assert r.status_code == 200


def test_hours_burndown(H, client_id):
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/hours-burndown", headers=H, timeout=20, verify=False)
    assert r.status_code == 200


def test_contracts(H, client_id):
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/contracts", headers=H, timeout=20, verify=False)
    assert r.status_code == 200


def test_scorecard(H, client_id):
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/scorecard", headers=H, timeout=20, verify=False)
    assert r.status_code == 200


def test_compliance(H, client_id):
    r = requests.get(f"{BASE_URL}/api/client-studio/{client_id}/compliance", headers=H, timeout=20, verify=False)
    assert r.status_code == 200


def test_vip_toggle(H, client_id):
    # Set VIP true
    r = requests.post(f"{BASE_URL}/api/client-studio/{client_id}/vip", headers=H, json={"vip": True}, timeout=20, verify=False)
    assert r.status_code in (200, 201), r.text[:300]
    # And back to false
    r2 = requests.post(f"{BASE_URL}/api/client-studio/{client_id}/vip", headers=H, json={"vip": False}, timeout=20, verify=False)
    assert r2.status_code in (200, 201)


def test_recompute_tiers(H):
    r = requests.post(f"{BASE_URL}/api/client-studio/recompute-tiers", headers=H, timeout=60, verify=False)
    assert r.status_code in (200, 201, 202), r.text[:300]


# ---- Unauthenticated guard ----
def test_unauth_universe_returns_401():
    r = requests.get(f"{BASE_URL}/api/client-studio/universe", timeout=20, verify=False)
    assert r.status_code in (401, 403)


# ---- Path collision check ----
def test_clients_route_still_works(H):
    r = requests.get(f"{BASE_URL}/api/clients", headers=H, timeout=20, verify=False)
    assert r.status_code == 200
