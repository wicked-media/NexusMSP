"""Iteration 174 — Lead Studio backend test suite.

Covers /api/lead-studio/* endpoints + per-lead actions (NBA, draft email,
win-loss, tasks, merge-into-ticket, create-ticket).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://rmm-psa-build.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "aaron@stech.com.au"
ADMIN_PASS = "Lucky@2871$!"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def some_lead_id(client):
    r = client.get(f"{API}/leads", timeout=15)
    assert r.status_code == 200, r.text
    items = r.json() if isinstance(r.json(), list) else r.json().get("leads", [])
    if not items:
        # create one for testing
        r2 = client.post(f"{API}/leads", json={"company_name": "TEST_iter174_co", "contact_name": "Tester", "email": "t@t.com"}, timeout=15)
        assert r2.status_code in (200, 201), r2.text
        return r2.json()["id"]
    return items[0]["id"]


@pytest.fixture(scope="session")
def some_ticket(client):
    r = client.get(f"{API}/tickets", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    items = body if isinstance(body, list) else body.get("tickets", []) or body.get("items", [])
    if items:
        return items[0]
    # create a ticket
    r2 = client.post(f"{API}/tickets", json={"title": "TEST_iter174 ticket", "description": "for merge test"}, timeout=15)
    assert r2.status_code in (200, 201)
    return r2.json()


# -------- Read-only analytics endpoints --------
def test_score(client):
    r = client.get(f"{API}/lead-studio/score", timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert "scores" in data and isinstance(data["scores"], list)
    if data["scores"]:
        s = data["scores"][0]
        for k in ("id", "overall", "engagement", "budget", "fit", "urgency", "is_hot"):
            assert k in s, f"missing {k} in score"
        assert 0 <= s["overall"] <= 100


def test_hot(client):
    r = client.get(f"{API}/lead-studio/hot", timeout=20)
    assert r.status_code == 200
    data = r.json()
    # spec says "up to 5" - accept any list under 'hot' or 'leads' or 'scores'
    key = next((k for k in ("hot_leads", "hot", "leads", "scores", "items") if k in data), None)
    assert key, f"no list key in {list(data.keys())}"
    arr = data[key]
    assert isinstance(arr, list)
    assert len(arr) <= 5


def test_stale(client):
    r = client.get(f"{API}/lead-studio/stale?days=14", timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict)
    arr_key = next((k for k in ("stale", "leads", "items") if k in data), None)
    assert arr_key
    for item in data[arr_key]:
        assert "days_stale" in item


def test_activity_ticker(client):
    r = client.get(f"{API}/lead-studio/activity-ticker", timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert "events" in data and isinstance(data["events"], list)
    if data["events"]:
        e = data["events"][0]
        for k in ("kind", "icon", "label", "ts"):
            assert k in e


def test_forecast(client):
    r = client.get(f"{API}/lead-studio/forecast", timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert "weighted" in data and "raw" in data
    for k in ("this_month", "next_30d", "next_90d", "later"):
        assert k in data["weighted"]
    assert "total_weighted" in data and "total_raw" in data


def test_velocity(client):
    r = client.get(f"{API}/lead-studio/velocity", timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert "velocity" in data and isinstance(data["velocity"], list)
    assert "window_days" in data
    if data["velocity"]:
        v = data["velocity"][0]
        for k in ("stage", "avg_days", "sample_size"):
            assert k in v


def test_source_attribution(client):
    r = client.get(f"{API}/lead-studio/source-attribution", timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert "sources" in data and isinstance(data["sources"], list)
    if data["sources"]:
        s = data["sources"][0]
        for k in ("source", "leads", "won", "lost", "open", "value_won", "win_rate"):
            assert k in s


def test_conversion_funnel(client):
    r = client.get(f"{API}/lead-studio/conversion-funnel", timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert "funnel" in data and isinstance(data["funnel"], list)
    assert "lost" in data and "overall_win_rate" in data


def test_next_best_action(client, some_lead_id):
    r = client.get(f"{API}/leads/{some_lead_id}/next-best-action", timeout=15)
    assert r.status_code == 200
    data = r.json()
    for k in ("action", "label", "reason", "urgency"):
        assert k in data


@pytest.mark.parametrize("intent", ["follow_up", "intro", "proposal_followup", "winback"])
def test_ai_draft_email(client, some_lead_id, intent):
    r = client.post(f"{API}/leads/{some_lead_id}/ai-draft-email", json={"intent": intent}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "subject" in data and "body" in data
    assert data.get("intent") == intent or intent in str(data)


def test_quick_parse(client):
    text = "Sarah Reynolds\nCTO\nsarah@brightleaf.com.au\n+61 411 234 567\nwww.brightleaf.com.au"
    r = client.post(f"{API}/lead-studio/quick-parse", json={"text": text}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "brightleaf" in (data.get("company_name") or "").lower()
    assert data.get("contact_name") == "Sarah Reynolds"
    assert data.get("email") == "sarah@brightleaf.com.au"
    assert "411" in (data.get("phone") or "")
    assert "brightleaf" in (data.get("website") or "").lower()
    assert (data.get("title") or "").lower() == "cto"


def test_win_loss_reasons(client):
    r = client.get(f"{API}/lead-studio/win-loss-reasons", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert "won" in data and "lost" in data
    assert isinstance(data["won"], list) and isinstance(data["lost"], list)


def test_win_loss_post(client, some_lead_id):
    r = client.post(f"{API}/leads/{some_lead_id}/win-loss", json={"outcome": "won", "reason": "Price"}, timeout=15)
    assert r.status_code == 200, r.text
    # verify status persisted
    g = client.get(f"{API}/leads/{some_lead_id}", timeout=10)
    assert g.status_code == 200
    lead = g.json()
    assert lead.get("status") == "won"


def test_recently_viewed_and_touch(client, some_lead_id):
    # Spec said POST /api/lead-studio/{id}/touch but actual route is /api/leads/{id}/touch.
    r1 = client.post(f"{API}/leads/{some_lead_id}/touch", json={}, timeout=10)
    assert r1.status_code in (200, 201)
    r2 = client.get(f"{API}/lead-studio/recently-viewed", timeout=10)
    assert r2.status_code == 200
    data = r2.json()
    assert "recent" in data


# -------- Saved views CRUD --------
def test_saved_views_crud(client):
    # missing name -> 400
    r_bad = client.post(f"{API}/lead-studio/saved-views", json={"filters": {}}, timeout=10)
    assert r_bad.status_code == 400

    r = client.post(f"{API}/lead-studio/saved-views", json={"name": "TEST_iter174_view", "filters": {"status": "open"}}, timeout=10)
    assert r.status_code in (200, 201), r.text
    view = r.json()
    vid = view.get("id") or view.get("_id")
    assert vid

    g = client.get(f"{API}/lead-studio/saved-views", timeout=10)
    assert g.status_code == 200
    body = g.json()
    views = body if isinstance(body, list) else body.get("views", [])
    assert any((v.get("id") or v.get("_id")) == vid for v in views)

    d = client.delete(f"{API}/lead-studio/saved-views/{vid}", timeout=10)
    assert d.status_code in (200, 204)

    d404 = client.delete(f"{API}/lead-studio/saved-views/does-not-exist-xyz", timeout=10)
    assert d404.status_code == 404


# -------- Tasks CRUD --------
def test_tasks_crud(client, some_lead_id):
    # missing title -> 400
    r_bad = client.post(f"{API}/leads/{some_lead_id}/tasks", json={}, timeout=10)
    assert r_bad.status_code == 400

    r = client.post(f"{API}/leads/{some_lead_id}/tasks", json={"title": "TEST_iter174 task"}, timeout=10)
    assert r.status_code in (200, 201), r.text
    task = r.json()
    tid = task.get("id") or task.get("_id")
    assert tid

    g = client.get(f"{API}/leads/{some_lead_id}/tasks", timeout=10)
    assert g.status_code == 200
    tasks = g.json() if isinstance(g.json(), list) else g.json().get("tasks", [])
    assert any((t.get("id") or t.get("_id")) == tid for t in tasks)

    u = client.put(f"{API}/lead-studio/tasks/{tid}", json={"completed": True}, timeout=10)
    assert u.status_code == 200

    u404 = client.put(f"{API}/lead-studio/tasks/does-not-exist-xyz", json={"completed": True}, timeout=10)
    assert u404.status_code == 404

    d = client.delete(f"{API}/lead-studio/tasks/{tid}", timeout=10)
    assert d.status_code in (200, 204)

    d404 = client.delete(f"{API}/lead-studio/tasks/does-not-exist-xyz", timeout=10)
    assert d404.status_code == 404


# -------- Bulk action --------
def test_bulk_action(client):
    r = client.get(f"{API}/leads", timeout=10)
    items = r.json() if isinstance(r.json(), list) else r.json().get("leads", [])
    ids = [l["id"] for l in items[:2]]
    if not ids:
        pytest.skip("no leads to bulk-act on")

    rb = client.post(f"{API}/lead-studio/bulk-action", json={"lead_ids": ids, "action": "change_stage", "stage": "qualified"}, timeout=15)
    assert rb.status_code == 200, rb.text

    rt = client.post(f"{API}/lead-studio/bulk-action", json={"lead_ids": ids, "action": "tag", "tag": "TEST_iter174"}, timeout=15)
    assert rt.status_code == 200, rt.text

    r_bad = client.post(f"{API}/lead-studio/bulk-action", json={"lead_ids": ids, "action": "bogus"}, timeout=10)
    assert r_bad.status_code == 400


# -------- Merge into ticket --------
def test_merge_into_ticket(client, some_lead_id, some_ticket):
    ticket_id = some_ticket.get("id") or some_ticket.get("_id")
    assert ticket_id

    # missing ticket_id -> 400
    r_bad = client.post(f"{API}/leads/{some_lead_id}/merge-into-ticket", json={}, timeout=15)
    assert r_bad.status_code == 400

    # bad ticket -> 404
    r_404 = client.post(f"{API}/leads/{some_lead_id}/merge-into-ticket", json={"ticket_id": "does-not-exist-xyz"}, timeout=15)
    assert r_404.status_code == 404

    # bad lead -> 404
    r_404b = client.post(f"{API}/leads/does-not-exist-xyz/merge-into-ticket", json={"ticket_id": ticket_id}, timeout=15)
    assert r_404b.status_code == 404

    # create a fresh lead so we don't keep mutating others
    lead = client.post(f"{API}/leads", json={"company_name": "TEST_iter174_merge", "contact_name": "M", "email": "m@m.com"}, timeout=10).json()
    lead_id = lead["id"]

    r = client.post(f"{API}/leads/{lead_id}/merge-into-ticket", json={"ticket_id": ticket_id}, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("ok") is True
    assert data.get("ticket_id") == ticket_id or str(data.get("ticket_id")) == str(ticket_id)
    assert "comment_id" in data
    # lead status should be 'won'
    g = client.get(f"{API}/leads/{lead_id}", timeout=10)
    assert g.json().get("status") == "won"


# -------- Create ticket from lead --------
def test_create_ticket_from_lead(client):
    lead = client.post(f"{API}/leads", json={"company_name": "TEST_iter174_ct", "contact_name": "CT", "email": "ct@ct.com"}, timeout=10).json()
    lead_id = lead["id"]
    r = client.post(f"{API}/leads/{lead_id}/create-ticket", json={"title": "TEST_iter174 from lead", "description": "auto"}, timeout=20)
    assert r.status_code in (200, 201), r.text
