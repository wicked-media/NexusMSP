"""Fail-closed checks for the signed Windows Agent release bundle."""

import hashlib
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import verify_signed_agent_bundle as verifier  # noqa: E402


def _write_bundle(tmp_path: Path, *, unsigned: bool = False, version: str = "0.1.20-test"):
    dist = tmp_path / "agent" / "dist"
    signing = tmp_path / "artifacts" / "agent-signing"
    dist.mkdir(parents=True)
    signing.mkdir(parents=True)

    (dist / "VERSION").write_text(version + "\n", encoding="utf-8")
    if unsigned:
        (dist / "UNSIGNED.txt").write_text("UNSIGNED\n", encoding="utf-8")

    files = []
    sums = []
    for component in verifier.REQUIRED_COMPONENTS:
        payload = f"{version}:{component}".encode()
        (dist / component).write_bytes(payload)
        digest = hashlib.sha256(payload).hexdigest()
        files.append({
            "file": component,
            "sha256_before": digest,
            "sha256_after": digest,
            "signed": True,
            "verified": True,
        })
        sums.append(f"{digest}  {component}")

    evidence = {
        "tool": "signtool",
        "agent_version": version,
        "commit": "a" * 40,
        "certificate": {
            "source": "PfxFile",
            "thumbprint": "B" * 40,
            "subject": "CN=Nexus Test Signing",
        },
        "files": files,
        "verification": "signtool verify /pa",
    }
    (signing / "agent-signing-evidence-20260101T000000Z.json").write_text(
        json.dumps(evidence), encoding="utf-8"
    )
    (signing / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n", encoding="ascii")
    return tmp_path


def test_verified_bundle_is_accepted_and_reports_its_version(tmp_path):
    summary = verifier.verify_bundle(
        _write_bundle(tmp_path),
        expected_version="0.1.20-test",
        expected_commit="a" * 40,
    )

    assert summary["agent_version"] == "0.1.20-test"
    assert summary["commit"] == "a" * 40
    assert set(summary["components"]) == set(verifier.REQUIRED_COMPONENTS)


def test_unsigned_lab_bundle_is_rejected(tmp_path):
    with pytest.raises(verifier.VerificationError, match="UNSIGNED"):
        verifier.verify_bundle(_write_bundle(tmp_path, unsigned=True))


def test_tampered_component_is_rejected(tmp_path):
    bundle = _write_bundle(tmp_path)
    (bundle / "agent" / "dist" / "nexus-agent.exe").write_bytes(b"tampered")

    with pytest.raises(verifier.VerificationError, match="hash does not match"):
        verifier.verify_bundle(bundle)


def test_missing_signing_verification_is_rejected(tmp_path):
    bundle = _write_bundle(tmp_path)
    evidence_path = next((bundle / "artifacts" / "agent-signing").glob("agent-signing-evidence-*.json"))
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    evidence["files"][0]["verified"] = False
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")

    with pytest.raises(verifier.VerificationError, match="does not verify"):
        verifier.verify_bundle(bundle)


def test_wrong_source_commit_is_rejected(tmp_path):
    with pytest.raises(verifier.VerificationError, match="does not match requested commit"):
        verifier.verify_bundle(_write_bundle(tmp_path), expected_commit="b" * 40)


def test_signing_evidence_must_record_signtool_verification(tmp_path):
    bundle = _write_bundle(tmp_path)
    evidence_path = (
        bundle / "artifacts" / "agent-signing" / "agent-signing-evidence-20260101T000000Z.json"
    )
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    evidence["verification"] = "unverified"
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")

    with pytest.raises(verifier.VerificationError, match="signtool /pa"):
        verifier.verify_bundle(bundle)


def test_extra_release_file_is_rejected(tmp_path):
    bundle = _write_bundle(tmp_path)
    (bundle / "agent" / "dist" / "unexpected.exe").write_bytes(b"extra")

    with pytest.raises(verifier.VerificationError, match="release directory set mismatch"):
        verifier.verify_bundle(bundle)


def test_checksum_manifest_must_cover_every_component(tmp_path):
    bundle = _write_bundle(tmp_path)
    sums_path = bundle / "artifacts" / "agent-signing" / "SHA256SUMS.txt"
    lines = [line for line in sums_path.read_text(encoding="ascii").splitlines() if "nexus-client-chat.exe" not in line]
    sums_path.write_text("\n".join(lines) + "\n", encoding="ascii")

    with pytest.raises(verifier.VerificationError, match="checksum component set mismatch"):
        verifier.verify_bundle(bundle)
