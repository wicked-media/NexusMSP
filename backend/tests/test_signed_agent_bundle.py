"""Real fail-closed checks for the signed Windows Agent release bundle.

The fixtures under ``tests/fixtures/signed_agent`` contain actual Authenticode
signatures and an RFC 3161 timestamp. These tests invoke ``osslsigncode``
against the PE bytes; they never pass merely because the evidence JSON says
``signed`` or ``verified``.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import verify_signed_agent_bundle as verifier  # noqa: E402


FIXTURES = Path(__file__).resolve().parent / "fixtures" / "signed_agent"
CA_A = FIXTURES / "signer-a.crt"
CA_B = FIXTURES / "signer-b.crt"
COMMIT = "a" * 40
VERSION = "0.1.20-test"
FIXTURE_FILES = (
    "unsigned.exe",
    "signed-no-timestamp.exe",
    "signed-valid.exe",
    "signed-wrong-signer.exe",
    "signed-signature-removed.exe",
    "signed-invalid-timestamp.exe",
    "signer-a.crt",
    "signer-b.crt",
)


@pytest.fixture(scope="module", autouse=True)
def _require_verification_material():
    """Fail the suite loudly when real verification cannot run."""
    missing = [name for name in FIXTURE_FILES if not (FIXTURES / name).is_file()]
    if missing:
        pytest.fail(f"signed-agent fixture set is incomplete: {missing}")
    try:
        verifier._resolve_osslsigncode()
    except verifier.VerificationError as exc:
        pytest.fail(f"test environment cannot verify signed bundles: {exc}")


def _thumbprint(cert_path: Path) -> str:
    certificate = x509.load_pem_x509_certificate(cert_path.read_bytes())
    return certificate.fingerprint(hashes.SHA1()).hex()


THUMBPRINT_A = _thumbprint(CA_A)
THUMBPRINT_B = _thumbprint(CA_B)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_bundle(
    tmp_path: Path,
    *,
    source: str = "signed-valid.exe",
    evidence_commit: str = COMMIT,
    evidence_flags: bool | None = None,
    unsigned_marker: bool = False,
) -> Path:
    dist = tmp_path / "agent" / "dist"
    signing = tmp_path / "artifacts" / "agent-signing"
    dist.mkdir(parents=True)
    signing.mkdir(parents=True)

    (dist / "VERSION").write_text(VERSION + "\n", encoding="utf-8")
    if unsigned_marker:
        (dist / "UNSIGNED.txt").write_text("UNSIGNED\n", encoding="utf-8")

    fixture = FIXTURES / source
    files = []
    sums = []
    for component in verifier.REQUIRED_COMPONENTS:
        destination = dist / component
        shutil.copyfile(fixture, destination)
        digest = _sha256(destination)
        entry = {
            "file": component,
            "sha256_before": digest,
            "sha256_after": digest,
        }
        if evidence_flags is not None:
            entry.update({"signed": evidence_flags, "verified": evidence_flags})
        files.append(entry)
        sums.append(f"{digest}  {component}")

    evidence = {
        "tool": "signtool",
        "agent_version": VERSION,
        "commit": evidence_commit,
        "certificate": {
            "source": "PfxFile",
            "thumbprint": THUMBPRINT_A.upper(),
            "subject": "CN=Nexus Test Signing, O=NexusMSP",
        },
        "files": files,
        "verification": "signtool verify /pa",
    }
    (signing / "agent-signing-evidence-20260101T000000Z.json").write_text(
        json.dumps(evidence), encoding="utf-8"
    )
    (signing / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n", encoding="ascii")
    return tmp_path


def _verify(bundle: Path, **overrides):
    options = {
        "expected_version": VERSION,
        "expected_commit": COMMIT,
        "expected_signer_thumbprint": THUMBPRINT_A,
        "ca_file": CA_A,
    }
    options.update(overrides)
    return verifier.verify_bundle(bundle, **options)


def _refresh_hashes(bundle: Path) -> None:
    """Update the evidence and checksum manifest after deliberately tampering."""
    dist = bundle / "agent" / "dist"
    signing = bundle / "artifacts" / "agent-signing"
    evidence_path = next(signing.glob("agent-signing-evidence-*.json"))
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    sums = []
    for entry in evidence["files"]:
        digest = _sha256(dist / entry["file"])
        entry["sha256_before"] = digest
        entry["sha256_after"] = digest
        sums.append(f"{digest}  {entry['file']}")
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
    (signing / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n", encoding="ascii")


def test_real_signed_bundle_with_valid_timestamp_is_accepted(tmp_path):
    bundle = _write_bundle(tmp_path)
    summary = _verify(bundle)

    assert summary["agent_version"] == VERSION
    assert summary["commit"] == COMMIT
    assert summary["certificate_thumbprint"] == THUMBPRINT_A.upper()
    assert summary["certificate_subject"] == "O=NexusMSP,CN=Nexus Test Signing"
    assert summary["timestamp_verified"] is True
    assert set(summary["components"]) == set(verifier.REQUIRED_COMPONENTS)
    for component in verifier.REQUIRED_COMPONENTS:
        assert summary["components"][component] == _sha256(
            bundle / "agent" / "dist" / component
        )


def test_evidence_signed_and_verified_booleans_are_not_the_proof(tmp_path):
    # The real PE signature is valid even though the evidence's self-declared
    # booleans are false. The gate must ignore those strings and use the PE.
    summary = _verify(_write_bundle(tmp_path, evidence_flags=False))

    assert summary["timestamp_verified"] is True


def test_unsigned_pe_is_rejected(tmp_path):
    with pytest.raises(verifier.VerificationError, match="no Authenticode signature"):
        _verify(_write_bundle(tmp_path, source="unsigned.exe"))


def test_evidence_claiming_signed_does_not_rescue_an_unsigned_pe(tmp_path):
    with pytest.raises(verifier.VerificationError, match="no Authenticode signature"):
        _verify(_write_bundle(tmp_path, source="unsigned.exe", evidence_flags=True))


def test_pe_with_signature_removed_is_rejected(tmp_path):
    with pytest.raises(verifier.VerificationError, match="no Authenticode signature"):
        _verify(_write_bundle(tmp_path, source="signed-signature-removed.exe"))


def test_modified_pe_bytes_are_rejected_even_when_hashes_are_updated(tmp_path):
    bundle = _write_bundle(tmp_path)
    component = bundle / "agent" / "dist" / "nexus-agent.exe"
    payload = bytearray(component.read_bytes())
    payload[0x200] ^= 0x01
    component.write_bytes(payload)
    _refresh_hashes(bundle)

    with pytest.raises(verifier.VerificationError, match="message digest|signature"):
        _verify(bundle)


def test_modified_pe_bytes_are_rejected_when_hashes_are_stale(tmp_path):
    bundle = _write_bundle(tmp_path)
    component = bundle / "agent" / "dist" / "nexus-agent.exe"
    payload = bytearray(component.read_bytes())
    payload[0x200] ^= 0x01
    component.write_bytes(payload)

    with pytest.raises(verifier.VerificationError, match="hash does not match"):
        _verify(bundle)


def test_signer_other_than_the_pinned_thumbprint_is_rejected(tmp_path):
    # Verify the wrong-signer fixture against its own CA so the test reaches the
    # leaf-hash pin rather than failing first on an untrusted chain.
    with pytest.raises(verifier.VerificationError, match="pinned thumbprint"):
        _verify(
            _write_bundle(tmp_path, source="signed-wrong-signer.exe"),
            ca_file=CA_B,
        )


def test_wrong_expected_commit_is_rejected(tmp_path):
    with pytest.raises(verifier.VerificationError, match="does not match requested commit"):
        _verify(
            _write_bundle(tmp_path, evidence_commit="b" * 40),
        )


def test_missing_timestamp_is_rejected(tmp_path):
    with pytest.raises(verifier.VerificationError, match="no Authenticode timestamp"):
        _verify(_write_bundle(tmp_path, source="signed-no-timestamp.exe"))


def test_invalid_timestamp_is_rejected(tmp_path):
    with pytest.raises(verifier.VerificationError, match="timestamp"):
        _verify(_write_bundle(tmp_path, source="signed-invalid-timestamp.exe"))


def test_unsigned_lab_marker_is_rejected(tmp_path):
    with pytest.raises(verifier.VerificationError, match="UNSIGNED"):
        _verify(_write_bundle(tmp_path, unsigned_marker=True))


def test_extra_release_file_is_rejected(tmp_path):
    bundle = _write_bundle(tmp_path)
    (bundle / "agent" / "dist" / "unexpected.exe").write_bytes(b"extra")

    with pytest.raises(verifier.VerificationError, match="release directory set mismatch"):
        _verify(bundle)


def test_checksum_manifest_must_cover_every_component(tmp_path):
    bundle = _write_bundle(tmp_path)
    sums_path = bundle / "artifacts" / "agent-signing" / "SHA256SUMS.txt"
    lines = [
        line
        for line in sums_path.read_text(encoding="ascii").splitlines()
        if "nexus-client-chat.exe" not in line
    ]
    sums_path.write_text("\n".join(lines) + "\n", encoding="ascii")

    with pytest.raises(verifier.VerificationError, match="checksum component set mismatch"):
        _verify(bundle)


def test_expected_signer_thumbprint_must_be_a_sha1_hex_digest(tmp_path):
    with pytest.raises(verifier.VerificationError, match="thumbprint"):
        _verify(_write_bundle(tmp_path), expected_signer_thumbprint="not-a-thumbprint")


def _cli(bundle: Path, *, ca_file: Path = CA_A, expected_commit: str = COMMIT) -> int:
    return verifier.main(
        [
            "--bundle",
            str(bundle),
            "--expected-version",
            VERSION,
            "--expected-commit",
            expected_commit,
            "--expected-signer-thumbprint",
            THUMBPRINT_A,
            "--ca-file",
            str(ca_file),
        ]
    )


def test_cli_accepts_a_genuinely_valid_bundle(tmp_path, capsys):
    code = _cli(_write_bundle(tmp_path))

    assert code == 0
    captured = capsys.readouterr()
    assert captured.out.strip() == VERSION
    assert '"timestamp_verified": true' in captured.err


@pytest.mark.parametrize(
    "source, ca_file, evidence_commit, expected_message",
    [
        ("unsigned.exe", CA_A, COMMIT, "no Authenticode signature"),
        ("signed-signature-removed.exe", CA_A, COMMIT, "no Authenticode signature"),
        ("signed-wrong-signer.exe", CA_B, COMMIT, "pinned thumbprint"),
        ("signed-valid.exe", CA_A, "b" * 40, "does not match requested commit"),
        ("signed-no-timestamp.exe", CA_A, COMMIT, "no Authenticode timestamp"),
        ("signed-invalid-timestamp.exe", CA_A, COMMIT, "timestamp"),
    ],
)
def test_cli_rejects_every_negative_signed_bundle(
    tmp_path, capsys, source, ca_file, evidence_commit, expected_message
):
    bundle = _write_bundle(tmp_path, source=source, evidence_commit=evidence_commit)
    code = _cli(bundle, ca_file=ca_file)

    assert code == 1
    assert expected_message in capsys.readouterr().err


def test_cli_rejects_tampered_pe_bytes(tmp_path, capsys):
    bundle = _write_bundle(tmp_path)
    component = bundle / "agent" / "dist" / "nexus-agent.exe"
    payload = bytearray(component.read_bytes())
    payload[0x200] ^= 0x01
    component.write_bytes(payload)
    _refresh_hashes(bundle)

    code = _cli(bundle)
    error = capsys.readouterr().err

    assert code == 1
    assert "message digest" in error or "signature" in error


def test_cli_requires_expected_commit(tmp_path):
    bundle = _write_bundle(tmp_path)
    with pytest.raises(SystemExit) as exc:
        verifier.main(
            [
                "--bundle",
                str(bundle),
                "--expected-signer-thumbprint",
                THUMBPRINT_A,
            ]
        )
    assert exc.value.code == 2


def test_cli_requires_expected_signer_thumbprint(tmp_path):
    bundle = _write_bundle(tmp_path)
    with pytest.raises(SystemExit) as exc:
        verifier.main(
            [
                "--bundle",
                str(bundle),
                "--expected-commit",
                COMMIT,
            ]
        )
    assert exc.value.code == 2
