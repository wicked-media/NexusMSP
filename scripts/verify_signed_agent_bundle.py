#!/usr/bin/env python3
"""Verify a signed Nexus Agent Windows bundle before it is baked into an image.

The release workflow is the only producer of this bundle. This verifier is the
consumer-side gate:

* the release evidence must bind the expected version and source commit;
* every component's SHA-256 sum must match the evidence and ``SHA256SUMS.txt``;
* every PE must carry a valid Authenticode signature from the pinned signer;
* the signature must include a cryptographically verified RFC 3161 timestamp.

The signature, signer and timestamp checks are performed by ``osslsigncode``
against the PE bytes. The evidence JSON's self-declared ``signed`` / ``verified``
strings are not trusted and are deliberately not required.

The script stays within the Python standard library so it can run both on a
Linux release runner and inside the Docker build stage. ``osslsigncode`` is the
only external executable required by the release gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REQUIRED_COMPONENTS = (
    "nexus-agent.exe",
    "nexus-client-chat.exe",
    "nexus-agent-tray.exe",
    "nexus-remote-companion.exe",
)
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_THUMBPRINT_RE = re.compile(r"^[0-9a-f]{40}$", re.IGNORECASE)
_VERSION_RE = re.compile(r"^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$")
_OSSLSIGNCODE_TIMEOUT_SECONDS = 60


class VerificationError(ValueError):
    """Raised when a downloaded bundle is not safe to distribute."""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 64), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_version(dist: Path) -> str:
    path = dist / "VERSION"
    try:
        version = path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError) as exc:
        raise VerificationError(f"release VERSION file is unavailable: {exc}") from exc
    if not _VERSION_RE.fullmatch(version):
        raise VerificationError(f"release VERSION is invalid: {version!r}")
    return version


def _read_evidence(signing: Path) -> dict:
    evidence_files = sorted(signing.glob("agent-signing-evidence-*.json"))
    if len(evidence_files) != 1:
        raise VerificationError(
            f"exactly one signing evidence file is required; found {len(evidence_files)}"
        )
    try:
        evidence = json.loads(evidence_files[0].read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise VerificationError(f"signing evidence is unreadable: {exc}") from exc
    if not isinstance(evidence, dict):
        raise VerificationError("signing evidence must be a JSON object")
    return evidence


def _read_sums(path: Path) -> dict[str, str]:
    try:
        lines = path.read_text(encoding="ascii").splitlines()
    except (OSError, UnicodeError) as exc:
        raise VerificationError(f"SHA256SUMS.txt is unreadable: {exc}") from exc
    sums: dict[str, str] = {}
    for line in lines:
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) != 2 or not _SHA256_RE.fullmatch(parts[0].lower()):
            raise VerificationError(f"SHA256SUMS.txt has an invalid entry: {line!r}")
        digest, name = parts
        if name in sums:
            raise VerificationError(f"SHA256SUMS.txt repeats {name}")
        sums[name] = digest.lower()
    return sums


def _normalise_thumbprint(value: str) -> str:
    thumbprint = str(value or "").strip()
    if not _THUMBPRINT_RE.fullmatch(thumbprint):
        raise VerificationError(
            "an expected signer thumbprint (40 hexadecimal characters) is required"
        )
    return thumbprint.lower()


def _normalise_subject(value: str) -> str:
    return " ".join(str(value or "").split())


def _resolve_osslsigncode() -> str:
    resolved = shutil.which("osslsigncode")
    if resolved and Path(resolved).is_file() and os.access(resolved, os.X_OK):
        return resolved
    raise VerificationError(
        "osslsigncode was not found; the release gate requires it for real "
        "Authenticode and timestamp verification"
    )


def _signer_subject(output: str) -> str:
    match = re.search(
        r"Signer's certificate:.*?^\s*Subject:\s*([^\r\n]+)",
        output,
        re.MULTILINE | re.DOTALL,
    )
    if not match:
        raise VerificationError("Authenticode signer subject was not reported")
    return _normalise_subject(match.group(1))


def _describe_verification_failure(component: str, output: str) -> str:
    lowered = output.lower()
    if "no signature found" in lowered:
        return f"{component} has no Authenticode signature"
    if "leaf hash" in lowered and "mismatch" in lowered:
        return f"{component} was signed by a signer that does not match the pinned thumbprint"
    if "timestamp" in lowered and "not available" in lowered:
        return f"{component} has no Authenticode timestamp"
    if "timestamp" in lowered and "failed" in lowered:
        return f"{component} Authenticode timestamp verification failed"
    if "message digest" in lowered:
        return f"{component} Authenticode message digest does not match its contents"
    return f"{component} Authenticode signature verification failed"


def _verify_authenticode(
    path: Path,
    *,
    component: str,
    expected_thumbprint: str,
    expected_subject: str | None,
    ca_file: Path | None,
    tsa_ca_file: Path | None,
    osslsigncode: str,
) -> str:
    command = [
        osslsigncode,
        "verify",
        "-in",
        str(path),
        "-index",
        "0",
        "-require-leaf-hash",
        f"sha1:{expected_thumbprint}",
        # The release must not depend on a CRL/OCSP endpoint being reachable.
        # The code-signing and timestamp signatures are still verified locally.
        "-ignore-cdp",
        "-ignore-crl",
    ]
    if ca_file is not None:
        command.extend(["-CAfile", str(ca_file)])
    if tsa_ca_file is not None:
        command.extend(["-TSA-CAfile", str(tsa_ca_file)])

    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=_OSSLSIGNCODE_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise VerificationError(
            f"{component} could not be verified because osslsigncode is unavailable"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise VerificationError(
            f"{component} Authenticode verification timed out"
        ) from exc

    output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
    if result.returncode != 0:
        raise VerificationError(_describe_verification_failure(component, output))

    lowered = output.lower()
    if "signature verification: ok" not in lowered:
        raise VerificationError(f"{component} Authenticode signature was not verified")
    if "number of verified signatures:" not in lowered:
        raise VerificationError(f"{component} has no verified Authenticode signature")
    if "timestamp is not available" in lowered:
        raise VerificationError(f"{component} has no Authenticode timestamp")
    if "timestamp verified using:" not in lowered:
        raise VerificationError(f"{component} Authenticode timestamp was not verified")
    if "timestamp server signature verification: ok" not in lowered:
        raise VerificationError(f"{component} Authenticode timestamp verification failed")

    subject = _signer_subject(output)
    if expected_subject and _normalise_subject(expected_subject) != subject:
        raise VerificationError(
            f"{component} signer subject does not match the pinned subject: {subject!r}"
        )
    return subject


def verify_bundle(
    bundle: Path,
    *,
    expected_commit: str,
    expected_signer_thumbprint: str,
    expected_version: str | None = None,
    expected_signer_subject: str | None = None,
    ca_file: Path | None = None,
    tsa_ca_file: Path | None = None,
) -> dict:
    """Validate a downloaded artifact directory and return its verified summary."""
    expected_commit = str(expected_commit or "").strip().lower()
    if not _COMMIT_RE.fullmatch(expected_commit):
        raise VerificationError("a full 40-character expected commit is required")
    expected_thumbprint = _normalise_thumbprint(expected_signer_thumbprint)
    verifier = _resolve_osslsigncode()

    dist = bundle / "agent" / "dist"
    signing = bundle / "artifacts" / "agent-signing"

    if not dist.is_dir():
        raise VerificationError(f"release directory is missing: {dist}")
    if (dist / "UNSIGNED.txt").exists():
        raise VerificationError("bundle is labelled UNSIGNED and cannot enter a release image")

    entries = list(dist.iterdir())
    if any(path.is_symlink() or not path.is_file() for path in entries):
        raise VerificationError("release directory contains a non-regular file entry")
    actual_files = {path.name for path in entries}
    expected_files = set(REQUIRED_COMPONENTS) | {"VERSION"}
    if actual_files != expected_files:
        missing = sorted(expected_files - actual_files)
        extra = sorted(actual_files - expected_files)
        raise VerificationError(f"release directory set mismatch; missing={missing} extra={extra}")

    version = _read_version(dist)
    if expected_version and version != expected_version:
        raise VerificationError(
            f"bundle version {version!r} does not match requested version {expected_version!r}"
        )

    evidence = _read_evidence(signing)
    evidence_version = str(evidence.get("agent_version") or "").strip()
    if evidence_version != version:
        raise VerificationError(
            f"signing evidence version {evidence_version!r} does not match VERSION {version!r}"
        )

    commit = str(evidence.get("commit") or "").strip().lower()
    if not _COMMIT_RE.fullmatch(commit):
        raise VerificationError("signing evidence must contain a full 40-character commit")
    if commit != expected_commit:
        raise VerificationError(
            f"signing evidence commit {commit} does not match requested commit {expected_commit}"
        )

    file_entries = evidence.get("files")
    if not isinstance(file_entries, list):
        raise VerificationError("signing evidence has no file list")
    signed_files: dict[str, dict] = {}
    for entry in file_entries:
        if not isinstance(entry, dict):
            raise VerificationError("signing evidence contains a non-object file entry")
        name = str(entry.get("file") or "").strip()
        if not name:
            raise VerificationError("signing evidence contains an unnamed file")
        if name in signed_files:
            raise VerificationError(f"signing evidence repeats {name}")
        evidence_hash = str(entry.get("sha256_after") or "").lower()
        if not _SHA256_RE.fullmatch(evidence_hash):
            raise VerificationError(f"signing evidence has an invalid hash for {name}")
        signed_files[name] = entry

    if set(signed_files) != set(REQUIRED_COMPONENTS):
        missing = sorted(set(REQUIRED_COMPONENTS) - set(signed_files))
        extra = sorted(set(signed_files) - set(REQUIRED_COMPONENTS))
        raise VerificationError(f"signed component set mismatch; missing={missing} extra={extra}")

    sums = _read_sums(signing / "SHA256SUMS.txt")
    if set(sums) != set(REQUIRED_COMPONENTS):
        missing = sorted(set(REQUIRED_COMPONENTS) - set(sums))
        extra = sorted(set(sums) - set(REQUIRED_COMPONENTS))
        raise VerificationError(f"checksum component set mismatch; missing={missing} extra={extra}")

    signer_subjects: dict[str, str] = {}
    for component in REQUIRED_COMPONENTS:
        path = dist / component
        if not path.is_file():
            raise VerificationError(f"release component is missing: {component}")
        actual = _sha256_file(path)
        evidence_hash = str(signed_files[component].get("sha256_after") or "").lower()
        if actual != evidence_hash:
            raise VerificationError(f"signing evidence hash does not match {component}")
        if sums[component] != actual:
            raise VerificationError(f"SHA256SUMS.txt does not match {component}")
        signer_subjects[component] = _verify_authenticode(
            path,
            component=component,
            expected_thumbprint=expected_thumbprint,
            expected_subject=expected_signer_subject,
            ca_file=ca_file,
            tsa_ca_file=tsa_ca_file,
            osslsigncode=verifier,
        )

    return {
        "agent_version": version,
        "commit": commit,
        "certificate_thumbprint": expected_thumbprint.upper(),
        "certificate_subject": signer_subjects[REQUIRED_COMPONENTS[0]],
        "timestamp_verified": True,
        "components": {name: sums[name] for name in REQUIRED_COMPONENTS},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path, help="downloaded release artifact directory")
    parser.add_argument("--expected-version", default="", help="required agent version")
    parser.add_argument("--expected-commit", required=True, help="required 40-character source commit")
    parser.add_argument(
        "--expected-signer-thumbprint",
        required=True,
        help="required SHA-1 Authenticode signer thumbprint (40 hexadecimal characters)",
    )
    parser.add_argument(
        "--expected-signer-subject",
        default="",
        help="optional exact Authenticode signer subject",
    )
    parser.add_argument("--ca-file", type=Path, default=None, help="optional code-signing CA bundle")
    parser.add_argument("--tsa-ca-file", type=Path, default=None, help="optional timestamp CA bundle")
    args = parser.parse_args(argv)

    try:
        summary = verify_bundle(
            args.bundle,
            expected_version=args.expected_version or None,
            expected_commit=args.expected_commit,
            expected_signer_thumbprint=args.expected_signer_thumbprint,
            expected_signer_subject=args.expected_signer_subject or None,
            ca_file=args.ca_file,
            tsa_ca_file=args.tsa_ca_file,
        )
    except VerificationError as exc:
        print(f"signed agent bundle rejected: {exc}", file=sys.stderr)
        return 1

    print(summary["agent_version"])
    print(json.dumps(summary, sort_keys=True), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
