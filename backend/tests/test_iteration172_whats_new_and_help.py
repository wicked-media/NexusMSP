"""Iteration 172 — What's New changelog + Help Center modern seed.

Covers:
- /api/changelog/entries (auth required)
- /api/changelog/since?date=YYYY-MM-DD
- /api/help/articles (modern slugs present, stale slugs absent)
- /api/help/articles/whats-new (full markdown body)
- /api/help/seed (admin reseed with pruning)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://rmm-psa-build.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "aaron@stech.com.au"
ADMIN_PASS = "Lucky@2871$!"

MODERN_SLUGS = {
    "whats-new", "client-insights-hub", "auto-ops-hub", "credentials-hub",
    "team-hub", "settings-hub", "tactical-ticket-console-v2",
    "m365-command-center", "maintenance-windows", "device-smart-bar",
    "invoice-studio",
}
STALE_SLUGS = {
    "soc-audit", "outage-detective", "cipp-audit", "pax8-audit",
    "hudu-audit", "tickets-toolbar-reference", "stale-agent-radar",
}


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=20,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"no token in {data}"
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


# ── Changelog ─────────────────────────────────────────────────────────
class TestChangelog:
    def test_entries_returns_at_least_six(self, headers):
        r = requests.get(f"{BASE_URL}/api/changelog/entries", headers=headers, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        entries = body.get("entries", [])
        assert len(entries) >= 6, f"expected >=6 entries, got {len(entries)}"
        # Newest first — first entry is 2026-06-25 Big Cleanup
        first = entries[0]
        assert first["date"] == "2026-06-25", f"first entry date {first['date']}"
        assert "Big Cleanup" in first["title"], first["title"]
        # Each entry has required keys
        for e in entries:
            for key in ("id", "date", "title", "summary", "category"):
                assert key in e, f"missing {key} in {e}"
            assert e["category"] in ("feature", "merge", "fix", "polish")

    def test_entries_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/changelog/entries", timeout=20)
        assert r.status_code in (401, 403), f"expected auth required, got {r.status_code}"

    def test_since_filters_by_date(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/changelog/since",
            params={"date": "2026-06-23"},
            headers=headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        rows = body.get("entries", [])
        assert len(rows) == 3, f"expected 3 entries >= 2026-06-23, got {len(rows)}"
        for e in rows:
            assert e["date"] >= "2026-06-23"

    def test_since_no_date_returns_all(self, headers):
        r = requests.get(f"{BASE_URL}/api/changelog/since", headers=headers, timeout=20)
        assert r.status_code == 200
        assert r.json().get("count", 0) >= 6


# ── Help articles ─────────────────────────────────────────────────────
class TestHelpArticles:
    def test_articles_contains_modern_and_excludes_stale(self, headers):
        r = requests.get(f"{BASE_URL}/api/help/articles", headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        payload = r.json()
        # The endpoint may return list or {articles:[...]}.
        articles = payload if isinstance(payload, list) else payload.get("articles", [])
        slugs = {a.get("slug") for a in articles}
        missing = MODERN_SLUGS - slugs
        assert not missing, f"modern slugs missing: {missing}"
        leftover = STALE_SLUGS & slugs
        assert not leftover, f"stale slugs still present: {leftover}"

        # whats-new metadata
        wn = next((a for a in articles if a.get("slug") == "whats-new"), None)
        assert wn is not None
        assert wn.get("category") == "Release Notes", wn
        assert wn.get("order") == -1, wn

    def test_whats_new_article_body(self, headers):
        r = requests.get(f"{BASE_URL}/api/help/articles/whats-new", headers=headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        body = data.get("body_md") or data.get("body") or ""
        assert "Latest Releases" in body, "missing 'Latest Releases' heading"
        assert "2026-06-25" in body, "missing 2026-06-25 release reference"
        assert "Big Cleanup" in body, "missing Big Cleanup reference"


# ── Reseed (admin) ────────────────────────────────────────────────────
class TestHelpReseed:
    def test_reseed_returns_expected_fields_and_prunes(self, headers):
        r = requests.post(f"{BASE_URL}/api/help/seed", headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("seeded", "modern_seeded", "pruned"):
            assert k in body, f"missing field {k} in reseed response: {body}"

        # After reseed, stale slugs must NOT be reintroduced
        r2 = requests.get(f"{BASE_URL}/api/help/articles", headers=headers, timeout=30)
        assert r2.status_code == 200
        payload = r2.json()
        articles = payload if isinstance(payload, list) else payload.get("articles", [])
        slugs = {a.get("slug") for a in articles}
        leftover = STALE_SLUGS & slugs
        assert not leftover, f"reseed reintroduced stale slugs: {leftover}"
        # Modern slugs still all present
        missing = MODERN_SLUGS - slugs
        assert not missing, f"reseed dropped modern slugs: {missing}"
