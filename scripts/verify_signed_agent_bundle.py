#!/usr/bin/env python3
"""Verify a signed Nexus Agent Windows bundle before it is baked into an image.

The release workflow is the only producer of this bundle. This verifier is the
consumer-side gate: it rejects unsigned lab artifacts, missing components,
hash mismatches, incomplete signing evidence, and evidence that does not belong
to the requested commit/version. It deliberately uses only the Python standard
library so the same check runs on Linux release runners and inside the Docker
build stage.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
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


def verify_bundle(
    bundle: Path,
    *,
    expected_version: str | None = None,
    expected_commit: str | None = None,
) -> dict:
    """Validate a downloaded artifact directory and return its evidence summary."""
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
    if evidence.get("tool") != "signtool" or evidence.get("verification") != "signtool verify /pa":
        raise VerificationError("signing evidence does not record a signtool /pa verification")
    evidence_version = str(evidence.get("agent_version") or "").strip()
    if evidence_version != version:
        raise VerificationError(
            f"signing evidence version {evidence_version!r} does not match VERSION {version!r}"
        )

    commit = str(evidence.get("commit") or "").strip().lower()
    if not _COMMIT_RE.fullmatch(commit):
        raise VerificationError("signing evidence must contain a full 40-character commit")
    if expected_commit and commit != expected_commit.strip().lower():
        raise VerificationError(
            f"signing evidence commit {commit} does not match requested commit {expected_commit}"
        )

    certificate = evidence.get("certificate")
    if not isinstance(certificate, dict):
        raise VerificationError("signing evidence has no certificate record")
    thumbprint = str(certificate.get("thumbprint") or "").strip()
    subject = str(certificate.get("subject") or "").strip()
    if not _THUMBPRINT_RE.fullmatch(thumbprint) or not subject:
        raise VerificationError("signing evidence has no valid signer identity")

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
        if entry.get("signed") is not True or entry.get("verified") is not True:
            raise VerificationError(f"signing evidence does not verify {name}")
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

    for component in REQUIRED_COMPONENTS:
        path = dist / component
        if not path.is_file():
            raise VerificationError(f"release component is missing: {component}")
        actual = _sha256_file(path)
        evidence_hash = str(signed_files[component].get("sha256_after") or "").lower()
        if not _SHA256_RE.fullmatch(evidence_hash):
            raise VerificationError(f"signing evidence has an invalid hash for {component}")
        if actual != evidence_hash:
            raise VerificationError(f"signing evidence hash does not match {component}")
        if sums[component] != actual:
            raise VerificationError(f"SHA256SUMS.txt does not match {component}")

    return {
        "agent_version": version,
        "commit": commit,
        "certificate_thumbprint": thumbprint.upper(),
        "certificate_subject": subject,
        "components": {name: sums[name] for name in REQUIRED_COMPONENTS},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path, help="downloaded release artifact directory")
    parser.add_argument("--expected-version", default="", help="required agent version")
    parser.add_argument("--expected-commit", default="", help="required source commit")
    args = parser.parse_args(argv)

    try:
        summary = verify_bundle(
            args.bundle,
            expected_version=args.expected_version or None,
            expected_commit=args.expected_commit or None,
        )
    except VerificationError as exc:
        print(f"signed agent bundle rejected: {exc}", file=sys.stderr)
        return 1

    print(summary["agent_version"])
    print(json.dumps(summary, sort_keys=True), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
