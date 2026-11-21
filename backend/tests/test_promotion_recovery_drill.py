"""Execution and conformance guards for the promotion-recovery drill.

The drill (`scripts/promotion_recovery_drill.py`) is fully local: it runs the
real workflow manifest writer, the real shared promotion script and the recovery
job's run blocks against a disposable fake registry. Unlike the Docker-host
drills, this one *can* execute in the deterministic backend gate, so the happy
path is exercised rather than only inspected.

The drill proves the recorded-digest retag path after an interruption, including
that valid-format but unrecorded API and web digests are rejected before any tag
is written. It does not prove live registry, keyless Cosign or GitHub Actions
artifact behavior; that remains the live interrupted-run recovery in the
release runbook.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
DRILL_PATH = ROOT / "scripts" / "promotion_recovery_drill.py"
PROMOTION_SCRIPT_PATH = ROOT / "scripts" / "promote_signed_images.sh"
RUNBOOK_PATH = ROOT / "docs" / "RELEASE_RUNBOOK.md"
READINESS_PATH = ROOT / "docs" / "PRODUCTION_READINESS.md"
CI_PATH = ROOT / ".github" / "workflows" / "ci.yml"
REQUIREMENTS_PATH = ROOT / "backend" / "requirements.txt"


@pytest.fixture(scope="module")
def drill_evidence(tmp_path_factory: pytest.TempPathFactory) -> dict:
    assert DRILL_PATH.is_file()
    evidence_dir = tmp_path_factory.mktemp("promotion-recovery-evidence")
    result = subprocess.run(
        [
            sys.executable,
            str(DRILL_PATH),
            "--evidence-dir",
            str(evidence_dir),
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=120,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout
    paths = sorted(evidence_dir.glob("promotion-recovery-drill-*.json"))
    assert len(paths) == 1
    return json.loads(paths[0].read_text(encoding="utf-8"))


def test_the_drill_interrupts_a_promotion_rejects_tampered_digests_and_recovers_both_tags(
    drill_evidence: dict,
):
    evidence = drill_evidence

    assert evidence["drill"] == "nexus-promotion-recovery"
    assert evidence["artifact_name"] == "nexus-promotion-1.4.0-424242"
    assert evidence["result"] == "passed"

    interruption = evidence["interruption"]
    assert interruption["normal_promotion_exit_code"] != 0
    assert interruption["web_tags_at_interruption"] == {}
    assert interruption["api_tags_at_interruption"] == {
        "1.4.0": evidence["recorded"]["api"]["digest"],
        "sha-ccccccc": evidence["recorded"]["api"]["digest"],
    }
    assert "injected registry interruption" in interruption["stderr"]

    expected_api = {
        "1.4.0": evidence["recorded"]["api"]["digest"],
        "sha-ccccccc": evidence["recorded"]["api"]["digest"],
    }
    expected_web = {
        "1.4.0": evidence["recorded"]["web"]["digest"],
        "sha-ccccccc": evidence["recorded"]["web"]["digest"],
    }

    controls = {
        control["component"]: control for control in evidence["negative_controls"]
    }
    assert set(controls) == {"api", "web"}
    assert controls["api"]["tampered"]["image"] == evidence["recorded"]["api"]["image"]
    assert controls["api"]["tampered"]["recorded_digest"] == evidence["recorded"]["api"]["digest"]
    assert controls["web"]["tampered"]["image"] == evidence["recorded"]["web"]["image"]
    assert controls["web"]["tampered"]["recorded_digest"] == evidence["recorded"]["web"]["digest"]
    assert controls["api"]["verified_before_rejection"] == 0
    assert controls["web"]["verified_before_rejection"] == 1
    for control in controls.values():
        assert control["tampered"]["digest"] != control["tampered"]["recorded_digest"]
        assert control["tampered"]["digest"].startswith("sha256:")
        assert len(control["tampered"]["digest"]) == len("sha256:") + 64
        assert control["stage"] == "promotion"
        assert control["exit_code"] != 0
        assert control["tagged_commands"] == 0
        assert control["api_tags_after"] == expected_api
        assert control["web_tags_after"] == {}
        assert "signature not found" in control["stderr"]
    assert evidence["verification"]["corrupted_api_digest_rejected_before_tagging"] is True
    assert evidence["verification"]["corrupted_web_digest_rejected_before_tagging"] is True

    assert evidence["recovery"]["api_tags"] == expected_api
    assert evidence["recovery"]["web_tags"] == expected_web
    assert evidence["recovery"]["rerun_api_tags"] == expected_api
    assert evidence["recovery"]["rerun_web_tags"] == expected_web
    assert evidence["recovery"]["cosign_verifications"] == 7
    assert all(evidence["verification"].values())


def test_the_drill_uses_the_actual_recovery_run_blocks_and_shared_script():
    drill = DRILL_PATH.read_text(encoding="utf-8")

    # The drill must exercise the workflow's run blocks, not a reimplementation.
    for step_name in (
        "Record promotion manifest",
        "Validate recovery inputs",
        "Validate recorded promotion manifest",
        "Verify and promote recorded digests",
    ):
        assert step_name in drill
    assert "PROMOTION_SCRIPT_PATH" in drill
    assert "promote_signed_images.sh" in drill

    # It must not reach for the normal build or signing steps.
    for forbidden in (
        "Build and stage API image",
        "Build and stage web image",
        "Sign staged API image digest",
        "Sign staged web image digest",
        "docker build",
        "docker/build-push-action",
        "cosign sign --yes",
    ):
        assert forbidden not in drill


def test_the_drill_is_disposable_and_retains_scoped_evidence(drill_evidence: dict):
    drill = DRILL_PATH.read_text(encoding="utf-8")
    evidence = drill_evidence

    assert "tempfile.mkdtemp" in drill
    assert "shutil.rmtree" in drill
    assert "evidence_dir.mkdir" in drill
    assert "EVIDENCE_PREFIX" in drill
    assert "release-drills" in drill

    assert "fake-registry" in evidence["evidence_note"]
    assert "no deployment secrets" in evidence["evidence_note"]
    assert "GitHub Actions artifact upload/download" in evidence["not_exercised"]
    assert "real keyless Cosign verification" in evidence["not_exercised"]
    assert "container build and image signing" in evidence["not_exercised"]
    assert evidence["executed_recovery_steps"] == [
        "Validate recovery inputs",
        "Validate recorded promotion manifest",
        "Verify and promote recorded digests",
    ]


def test_the_runbook_documents_the_drill_and_its_limits():
    runbook = RUNBOOK_PATH.read_text(encoding="utf-8")
    readiness = READINESS_PATH.read_text(encoding="utf-8")

    assert "promotion_recovery_drill.py" in runbook
    assert "promotion-recovery-drill-*.json" in runbook
    assert "promotion-recovery-drill-evidence" in runbook
    assert "job summary" in runbook
    assert "corrupted" in runbook
    assert "does not contact a real registry" in runbook
    assert "promotion_recovery_drill.py" in readiness
    assert "promotion-recovery-drill-*.json" in readiness
    assert "promotion-recovery-drill-evidence" in readiness
    assert "corrupted" in readiness
    assert "does not replace a live interrupted-run recovery" in " ".join(
        readiness.split()
    )


def test_failed_drill_still_writes_evidence_for_the_ci_upload(tmp_path: Path):
    evidence_dir = tmp_path / "artifacts" / "release-drills"
    result = subprocess.run(
        [
            sys.executable,
            str(DRILL_PATH),
            "--evidence-dir",
            str(evidence_dir),
            "--inject-failure",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=120,
        check=False,
    )
    assert result.returncode != 0

    paths = sorted(evidence_dir.glob("promotion-recovery-drill-*.json"))
    assert len(paths) == 1
    evidence = json.loads(paths[0].read_text(encoding="utf-8"))
    assert evidence["result"] == "failed"
    assert "injected drill failure" in evidence["failure"]
    assert evidence["verification"]["normal_promotion_interrupted"] is True
    assert "negative_controls" not in evidence
    assert "recovery" not in evidence

    workflow = yaml.safe_load(CI_PATH.read_text(encoding="utf-8"))
    upload = next(
        step
        for step in workflow["jobs"]["promotion-recovery-drill"]["steps"]
        if step.get("uses") == "actions/upload-artifact@v4"
    )
    assert upload["if"] == "always()"
    assert upload["with"]["path"] == (
        "artifacts/release-drills/promotion-recovery-drill-*.json"
    )
    assert upload["with"]["if-no-files-found"] == "error"


def test_ci_summary_links_the_uploaded_evidence_artifact():
    workflow = yaml.safe_load(CI_PATH.read_text(encoding="utf-8"))
    steps = workflow["jobs"]["promotion-recovery-drill"]["steps"]

    drill = next(
        step for step in steps if step.get("name") == "Run promotion recovery drill"
    )
    upload = next(
        step for step in steps if step.get("uses") == "actions/upload-artifact@v4"
    )
    summary = next(
        step
        for step in steps
        if step.get("name") == "Promotion recovery drill summary"
    )
    assert steps.index(drill) < steps.index(upload) < steps.index(summary)
    assert drill["id"] == "drill"
    assert upload["id"] == "upload"
    assert summary["if"] == "always()"
    assert summary["env"]["DRILL_OUTCOME"] == "${{ steps.drill.outcome }}"
    assert summary["env"]["ARTIFACT_URL"] == (
        "${{ steps.upload.outputs.artifact-url }}"
    )
    assert "GITHUB_STEP_SUMMARY" in summary["run"]
    assert "promotion-recovery-drill-evidence" in summary["run"]
    assert "negative_controls" in summary["run"]
    assert "tagged_commands" in summary["run"]
    assert "verified_before_rejection" in summary["run"]


def test_ci_summary_renders_tamper_controls(tmp_path: Path):
    workflow = yaml.safe_load(CI_PATH.read_text(encoding="utf-8"))
    steps = workflow["jobs"]["promotion-recovery-drill"]["steps"]
    summary = next(
        step
        for step in steps
        if step.get("name") == "Promotion recovery drill summary"
    )

    def render(root: Path, outcome: str, url: str) -> str:
        evidence_dir = root / "artifacts" / "release-drills"
        evidence_dir.mkdir(parents=True)
        evidence = {
            "result": "passed" if outcome == "success" else "failed",
        }
        if outcome == "success":
            evidence["negative_controls"] = [
                {
                    "component": "api",
                    "tagged_commands": 0,
                    "verified_before_rejection": 0,
                },
                {
                    "component": "web",
                    "tagged_commands": 0,
                    "verified_before_rejection": 1,
                },
            ]
            evidence["verification"] = {
                "both_images_have_both_recorded_tags": True
            }
        (evidence_dir / "promotion-recovery-drill-test.json").write_text(
            json.dumps(evidence), encoding="utf-8"
        )
        summary_path = root / "summary.md"
        result = subprocess.run(
            ["bash", "-c", summary["run"]],
            cwd=root,
            text=True,
            capture_output=True,
            timeout=60,
            check=False,
            env=os.environ
            | {
                "DRILL_OUTCOME": outcome,
                "ARTIFACT_URL": url,
                "GITHUB_STEP_SUMMARY": str(summary_path),
            },
        )
        assert result.returncode == 0, result.stderr
        return summary_path.read_text(encoding="utf-8")

    success = render(
        tmp_path / "success",
        "success",
        "https://example.invalid/artifact/123",
    )
    assert "## Promotion recovery drill" in success
    assert "- Result: success" in success
    assert (
        "[promotion-recovery-drill-evidence]"
        "(https://example.invalid/artifact/123)"
    ) in success
    assert (
        "- API digest: rejected before tagging "
        "(0 tags, 0 verified before rejection)"
    ) in success
    assert (
        "- WEB digest: rejected before tagging "
        "(0 tags, 1 verified before rejection)"
    ) in success
    assert "- Positive recovery: both images have both recorded tags." in success

    failure = render(tmp_path / "failure", "failure", "")
    assert "- Result: failure" in failure
    assert (
        "- Evidence: artifact upload did not return a URL; "
        "inspect the job's artifacts."
    ) in failure
    assert "- Not reached; see the retained evidence JSON." in failure


def test_ci_runs_the_drill_and_uploads_its_evidence():
    workflow = yaml.safe_load(CI_PATH.read_text(encoding="utf-8"))
    job = workflow["jobs"]["promotion-recovery-drill"]
    assert job["runs-on"] == "ubuntu-latest"

    steps = job["steps"]
    assert any(step.get("uses") == "actions/checkout@v4" for step in steps)
    setup = next(
        step
        for step in steps
        if str(step.get("uses", "")).startswith("actions/setup-python@")
    )
    assert setup["with"]["python-version"] == "3.12"

    pyyaml_pin = next(
        line
        for line in REQUIREMENTS_PATH.read_text(encoding="utf-8").splitlines()
        if line.lower().startswith("pyyaml==")
    )
    install = next(
        step for step in steps if step.get("name") == "Install drill dependency"
    )
    assert pyyaml_pin in install["run"]

    drill = next(
        step for step in steps if step.get("name") == "Run promotion recovery drill"
    )
    assert "python scripts/promotion_recovery_drill.py" in drill["run"]
    assert "--evidence-dir artifacts/release-drills" in drill["run"]

    upload = next(
        step for step in steps if step.get("uses") == "actions/upload-artifact@v4"
    )
    assert upload["if"] == "always()"
    assert upload["with"]["name"] == "promotion-recovery-drill-evidence"
    assert upload["with"]["path"] == (
        "artifacts/release-drills/promotion-recovery-drill-*.json"
    )
    assert upload["with"]["if-no-files-found"] == "error"
    assert upload["with"]["retention-days"] == 30
    assert "secrets." not in yaml.safe_dump(job)
