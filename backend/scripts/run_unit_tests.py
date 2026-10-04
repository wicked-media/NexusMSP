"""Run deterministic backend tests while excluding legacy live-API probes.

Legacy iteration probes read REACT_APP_BACKEND_URL and require a running stack.
They remain useful for local integration testing, but must not make the unit
gate dependent on a live service or mutable customer data.
"""

from pathlib import Path
import re
import sys

import pytest

# A live probe *reads* REACT_APP_BACKEND_URL to find a running stack.  A
# deterministic test that merely clears the variable for hermetic behaviour is
# not a live probe, so the content match keys on the env-read signature rather
# than any mention of the variable name.
_LIVE_PROBE_ENV_READ = re.compile(
    r"(environ\.get|getenv)\(\s*[\"']REACT_APP_BACKEND_URL[\"']"
    r"|environ\[\s*[\"']REACT_APP_BACKEND_URL[\"']"
)


def main() -> int:
    backend_root = Path(__file__).resolve().parents[1]
    tests_dir = backend_root / "tests"
    sys.path.insert(0, str(backend_root))
    live_tests = [
        path
        for path in tests_dir.rglob("test_*.py")
        # tests/live/ is the dedicated live-probe home (directory is the
        # marker); the content match also catches legacy probes left in place
        # by their REACT_APP_BACKEND_URL env read.
        if "live" in path.parts
        or _LIVE_PROBE_ENV_READ.search(path.read_text(encoding="utf-8", errors="ignore"))
    ]
    args = [str(tests_dir), "-q", *[f"--ignore={path}" for path in live_tests]]
    print(f"Running backend unit gate; excluded {len(live_tests)} live-stack probes.")
    return pytest.main(args)


if __name__ == "__main__":
    raise SystemExit(main())
