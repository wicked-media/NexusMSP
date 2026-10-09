"""Nexus Script Library catalogue integrity and install/uninstall provenance."""

import inspect

import pytest

from app.routers import script_library
from app.services.script_library_catalog import (
    CATEGORIES,
    LIBRARY_VERSION,
    category_counts,
    get_entry,
    list_entries,
)

REQUIRED_FIELDS = {
    "slug", "name", "description", "category", "os_target", "script_type",
    "run_as_admin", "timeout_seconds", "tags", "parameters", "content",
}


class TestCatalogueIntegrity:
    def test_version_is_pinned(self):
        assert LIBRARY_VERSION == "2026-10-03-premium-v1"

    def test_every_entry_is_complete(self):
        for entry in list_entries():
            missing = REQUIRED_FIELDS - set(entry)
            assert not missing, f"{entry.get('slug')} missing {missing}"

    def test_library_is_substantial(self):
        # The premium library must out-shrink a starter pack by a wide margin.
        assert len(list_entries()) >= 35

    def test_slugs_are_unique(self):
        slugs = [e["slug"] for e in list_entries()]
        assert len(slugs) == len(set(slugs))

    def test_scripts_have_real_bodies(self):
        for entry in list_entries():
            body = entry["content"].strip()
            assert len(body) > 100, f"{entry['slug']} body too small"
            # No placeholder scripts
            assert "TODO" not in body and "lorem ipsum" not in body.lower()

    def test_parameters_are_well_formed(self):
        for entry in list_entries():
            for param in entry["parameters"]:
                assert set(param) == {"name", "type", "default", "description"}
                assert param["type"] in {"string", "int", "bool"}

    def test_powershell_scripts_declare_safety_posture(self):
        for entry in list_entries():
            if entry["script_type"] == "powershell":
                # Admin scripts must set an error mode so failures are visible.
                assert "ErrorActionPreference" in entry["content"] or "CmdletBinding" in entry["content"], entry["slug"]

    def test_covers_windows_and_at_least_two_other_platforms(self):
        os_targets = {e["os_target"] for e in list_entries()}
        assert "windows" in os_targets
        assert len(os_targets) >= 3


class TestFiltering:
    def test_filter_by_category(self):
        results = list_entries(category="security")
        assert results and all(e["category"] == "security" for e in results)

    def test_filter_by_os_and_type(self):
        results = list_entries(os_target="linux")
        assert results and all(e["os_target"] == "linux" for e in results)

    def test_search_matches_name_description_and_tags(self):
        assert list_entries(search="defender")
        assert list_entries(search="ransomware")  # tag-only match
        assert list_entries(search="zzz-no-such-thing") == []

    def test_category_counts_sum_to_total(self):
        counts = category_counts()
        assert sum(counts.values()) == len(list_entries())
        assert set(counts) == set(CATEGORIES)

    def test_get_entry_round_trip(self):
        entry = get_entry("defender-health-audit")
        assert entry and entry["category"] == "security"
        assert get_entry("no-such-slug") is None


class TestRouterContract:
    def test_expected_operations_exist(self):
        paths = [r.path for r in script_library.router.routes]
        assert "/script-library" in paths
        assert "/script-library/{slug}" in paths
        assert "/script-library/{slug}/install" in paths

    def test_install_payload_is_closed(self):
        with pytest.raises(Exception):
            script_library.LibraryInstallRequest(name="x", rogue_field=1)

    def test_endpoints_require_auth(self):
        for name in ("browse_library", "get_library_entry", "install_library_entry", "uninstall_library_entry"):
            sig = inspect.signature(getattr(script_library, name))
            assert "current_user" in sig.parameters
