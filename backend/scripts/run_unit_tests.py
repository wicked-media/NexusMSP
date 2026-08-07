"""Run deterministic backend tests while excluding legacy live-API probes.

Legacy iteration probes read REACT_APP_BACKEND_URL and require a running stack.
They remain useful for local integration testing, but must not make the unit
gate dependent on a live service or mutable customer data.
"""

from pathlib import Path
import sys

import pytest


def main() -> int:
    backend_root = Path(__file__).resolve().parents[1]
    tests_dir = backend_root / "tests"
    sys.path.insert(0, str(backend_root))
    live_tests = [
        path
        for path in tests_dir.rglob("test_*.py")
        if "REACT_APP_BACKEND_URL" in path.read_text(encoding="utf-8", errors="ignore")
    ]
    args = [str(tests_dir), "-q", *[f"--ignore={path}" for path in live_tests]]
    print(f"Running backend unit gate; excluded {len(live_tests)} live-stack probes.")
    return pytest.main(args)


if __name__ == "__main__":
    raise SystemExit(main())
