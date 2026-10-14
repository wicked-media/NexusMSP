"""Public uploads serving boundary.

The /api/uploads mount serves intentionally public assets: runtime uploads from
the configured uploads directory (NEXUS_UPLOADS_DIR) plus the shipped public
assets committed under backend/uploads (demo avatars, branding, help guide
visuals). These tests pin the fallback order and the path-traversal refusal so
shipped help visuals resolve in every environment without widening the public
surface.
"""

from pathlib import Path

from server import _PublicUploadsStatic

BACKEND_UPLOADS = Path(__file__).resolve().parents[1] / "uploads"


def test_shipped_assets_resolve_when_the_runtime_directory_is_empty(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    static = _PublicUploadsStatic(runtime, BACKEND_UPLOADS)

    full_path, stat_result = static.lookup_path("help/guides/invoices-workspace.png")

    assert stat_result is not None
    assert Path(full_path) == BACKEND_UPLOADS / "help" / "guides" / "invoices-workspace.png"


def test_runtime_uploads_win_over_shipped_assets_with_the_same_name(tmp_path):
    runtime = tmp_path / "runtime"
    (runtime / "help").mkdir(parents=True)
    (runtime / "help" / "guide.txt").write_text("runtime copy", encoding="utf-8")
    static = _PublicUploadsStatic(runtime, BACKEND_UPLOADS)

    full_path, stat_result = static.lookup_path("help/guide.txt")

    assert stat_result is not None
    assert Path(full_path) == runtime / "help" / "guide.txt"


def test_missing_paths_and_traversal_attempts_are_refused_for_both_roots(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    static = _PublicUploadsStatic(runtime, BACKEND_UPLOADS)

    assert static.lookup_path("help/guides/does-not-exist.png") == ("", None)
    assert static.lookup_path("../server.py") == ("", None)
    assert static.lookup_path("help/../../../server.py") == ("", None)
