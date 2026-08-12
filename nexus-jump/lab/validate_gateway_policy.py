#!/usr/bin/env python3
"""Offline preflight for a Nexus Jump lab gateway policy.

This tool deliberately validates metadata only.  It never opens a listener,
creates a tunnel, generates a private key, or attempts a connection.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import sys
from pathlib import Path


SUPPORTED_PROTOCOLS = {"https", "ssh", "rdp", "vnc", "winrm", "ipmi"}
ENDPOINT_RE = re.compile(r"^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\]):([1-9][0-9]{0,4})$")


def validate(policy: object) -> list[str]:
    """Return validation errors for a gateway policy object."""
    if not isinstance(policy, dict):
        return ["Policy must be a JSON object."]

    errors: list[str] = []
    for field in ("gateway_id", "display_name", "environment", "endpoint", "public_key"):
        if not isinstance(policy.get(field), str) or not policy[field].strip():
            errors.append(f"{field} must be a non-empty string.")

    if policy.get("environment") != "lab":
        errors.append("environment must be 'lab'. Production gateway activation is not available in this preflight.")

    endpoint = policy.get("endpoint")
    endpoint_match = ENDPOINT_RE.match(endpoint) if isinstance(endpoint, str) else None
    if not endpoint_match:
        errors.append("endpoint must be a hostname or bracketed IPv6 address with an explicit port.")
    elif int(endpoint_match.group(1)) > 65535:
        errors.append("endpoint port must be between 1 and 65535.")

    public_key = policy.get("public_key")
    if not isinstance(public_key, str) or public_key.startswith("REPLACE_") or len(public_key.strip()) < 32:
        errors.append("public_key must contain the gateway public key; a placeholder is not valid.")

    cidrs = policy.get("allowed_resource_cidrs")
    if not isinstance(cidrs, list) or not cidrs:
        errors.append("allowed_resource_cidrs must contain at least one private resource subnet.")
    else:
        for cidr in cidrs:
            try:
                network = ipaddress.ip_network(cidr, strict=True)
            except ValueError:
                errors.append(f"{cidr!r} is not a valid CIDR.")
                continue
            if not network.is_private or network.prefixlen == 0:
                errors.append(f"{cidr} is not an allowed private, least-privilege resource subnet.")

    protocols = policy.get("allowed_protocols")
    if not isinstance(protocols, list) or not protocols:
        errors.append("allowed_protocols must contain at least one supported protocol.")
    elif unsupported := sorted(set(protocols) - SUPPORTED_PROTOCOLS):
        errors.append(f"Unsupported protocol(s): {', '.join(unsupported)}.")

    duration = policy.get("maximum_session_minutes")
    if not isinstance(duration, int) or isinstance(duration, bool) or not 5 <= duration <= 240:
        errors.append("maximum_session_minutes must be an integer between 5 and 240.")

    if policy.get("approval_required") is not True:
        errors.append("approval_required must be true for lab access.")
    if policy.get("ticket_required") is not True:
        errors.append("ticket_required must be true for lab access.")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a Nexus Jump lab gateway policy without connecting to anything.")
    parser.add_argument("policy", type=Path, help="Path to a gateway-policy JSON file")
    args = parser.parse_args()

    try:
        policy = json.loads(args.policy.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Invalid policy file: {exc}", file=sys.stderr)
        return 2

    errors = validate(policy)
    if errors:
        print("Nexus Jump lab preflight failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Nexus Jump lab preflight passed. This does not create a tunnel or expose a gateway.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
