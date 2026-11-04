"""Nexus Find Everywhere: one question across every store Nexus owns.

Technicians do not lose hours to hard problems; they lose them to *"where else
does this value appear?"* — the hardcoded IP, the hostname a script still
points at, the domain buried in a certificate record. This module answers that
in one call, and then answers the follow-up: *what breaks if I change it?*

Honesty boundaries:

* Every result is a reference Nexus can actually see in its own stores. Nexus
  cannot see hardcoded values inside customer applications, appliances or
  firmware, and the note on each response says so instead of implying coverage.
* Hostname detection is a declared heuristic over name-shaped tokens. It is
  labelled as a heuristic, not as a discovered inventory.
* Nothing here is a security control: these are reads inside the caller's
  tenant partition, and a value that appears nowhere is reported as appearing
  nowhere rather than as being absent from the estate.
"""

from __future__ import annotations

import re
from typing import Any

from app.services.scope_permissions import tenant_scoped_query

#: Hard ceiling on documents read per store, so one search can never walk a
#: large estate synchronously.
MAX_DOCS_PER_SOURCE = 500

#: How much of a matched value is returned as an excerpt.
EXCERPT_CHARS = 160

LITERAL_KINDS = ("ip", "hostname", "domain", "auto")

#: The stores Find Everywhere searches, in the order results are grouped.
SEARCH_SOURCES: tuple[dict[str, Any], ...] = (
    {"source": "devices", "collection": "devices", "label": "Devices", "owner": "asset inventory",
     "fields": ("id", "hostname", "name", "serial", "ip_address", "mac_address",
                "client_name", "notes")},
    {"source": "clients", "collection": "clients", "label": "Customers", "owner": "client record",
     "fields": ("id", "name", "domain", "email", "phone", "notes")},
    {"source": "tickets", "collection": "tickets", "label": "Tickets", "owner": "service desk",
     "fields": ("id", "ticket_number", "subject", "title", "description")},
    {"source": "users", "collection": "users", "label": "Technicians and accounts",
     "owner": "identity", "fields": ("id", "name", "email", "username", "role")},
    {"source": "scripts", "collection": "script_library", "label": "Scripts", "owner": "automation",
     "fields": ("id", "name", "description", "script", "body", "content")},
    {"source": "automations", "collection": "automation_workflows", "label": "Automations",
     "owner": "automation", "fields": ("id", "name", "description", "definition")},
    {"source": "network", "collection": "network_devices", "label": "Network equipment",
     "owner": "networking", "fields": ("id", "name", "hostname", "ip_address", "mac_address",
                                       "model", "notes")},
    {"source": "certificates", "collection": "ssl_certificates", "label": "Certificates",
     "owner": "certificate inventory",
     "fields": ("id", "domain", "common_name", "subject", "issuer", "san")},
    {"source": "intents", "collection": "nexus_intents", "label": "Business intents",
     "owner": "intent OS", "fields": ("id", "statement")},
    {"source": "runbooks", "collection": "recorded_runbooks", "label": "Recorded runbooks",
     "owner": "command recorder", "fields": ("id", "title", "detail")},
)

_SOURCES_BY_KEY = {entry["source"]: entry for entry in SEARCH_SOURCES}

IPV4_RE = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
FQDN_RE = re.compile(r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b", re.IGNORECASE)
#: Name-shaped tokens such as SERVER03, PRINT01 or ACME-DC-01. A declared
#: heuristic: it finds candidates, it does not prove a hostname exists.
HOSTNAME_RE = re.compile(r"\b[A-Z][A-Z0-9]{2,15}(?:-[A-Z0-9]{1,15})?(?:\d{1,4})?\b")

PRIVATE_PREFIXES = ("10.", "192.168.", "127.", "169.254.")
LOOPBACK = "127."

SEARCH_NOTE = (
    "Results are references Nexus can see in its own stores inside your tenant. Nexus cannot see "
    "hardcoded values inside applications, appliances, firmware or unmanaged systems, so a value "
    "that does not appear here is not proof that it is unused."
)


def search_sources() -> dict:
    """Publish exactly which stores Find Everywhere reads, and who owns them."""
    return {
        "sources": [{"source": entry["source"], "label": entry["label"], "owner": entry["owner"],
                     "fields": list(entry["fields"])} for entry in SEARCH_SOURCES],
        "max_documents_per_source": MAX_DOCS_PER_SOURCE,
        "note": SEARCH_NOTE,
    }


def _is_private_ip(value: str) -> bool:
    return value.startswith(PRIVATE_PREFIXES) or value.startswith(LOOPBACK)


def _text_pairs(document: dict, fields: tuple[str, ...]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for field in fields:
        value = document.get(field)
        if isinstance(value, str) and value.strip():
            pairs.append((field, value))
    return pairs


def _excerpt(value: str) -> str:
    collapsed = " ".join(value.split())
    return collapsed[:EXCERPT_CHARS]


def _label_for(document: dict, entry: dict) -> str:
    for field in ("hostname", "name", "title", "subject", "domain", "id"):
        value = document.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()[:120]
    return str(document.get("id") or "unknown")


def _compile(query: str) -> re.Pattern:
    return re.compile(re.escape(query), re.IGNORECASE)


async def _load(db: Any, user: dict, entry: dict) -> list[dict]:
    """Read the caller's documents from one store, tenant-scoped."""
    return await getattr(db, entry["collection"]).find(
        tenant_scoped_query(user, {}), {"_id": 0}).limit(MAX_DOCS_PER_SOURCE).to_list(MAX_DOCS_PER_SOURCE)


async def _scan(db: Any, user: dict, entries: list[dict], needle: str, limit: int) -> dict:
    """Find one literal across the requested stores and group the hits."""
    pattern = _compile(needle)
    groups: list[dict] = []
    empty: list[str] = []
    total = 0
    for entry in entries:
        hits: list[dict] = []
        documents = await _load(db, user, entry)
        for document in documents:
            matched = [field for field, value in _text_pairs(document, tuple(entry["fields"]))
                       if pattern.search(value)]
            if not matched:
                continue
            first_field, first_value = next(
                (pair for pair in _text_pairs(document, tuple(entry["fields"])) if pair[0] == matched[0]),
                (matched[0], ""),
            )
            hits.append({
                "source": entry["source"],
                "id": str(document.get("id") or ""),
                "label": _label_for(document, entry),
                "matched_fields": matched,
                "excerpt": _excerpt(first_value),
                "client_id": str(document.get("client_id") or ""),
            })
        if hits:
            hits = hits[:limit]
            total += len(hits)
            groups.append({"source": entry["source"], "label": entry["label"],
                           "owner": entry["owner"], "count": len(hits), "hits": hits})
        else:
            empty.append(entry["source"])
    return {"total": total, "groups": groups, "empty": empty,
            "sources_searched": [entry["source"] for entry in entries]}


def _resolve_sources(sources: Any) -> tuple[list[dict] | None, str | None]:
    if sources is None:
        return list(SEARCH_SOURCES), None
    if isinstance(sources, str):
        sources = [sources]
    if not isinstance(sources, (list, tuple)):
        return None, "sources must be a list of source keys"
    selected = []
    for key in sources:
        entry = _SOURCES_BY_KEY.get(str(key))
        if not entry:
            return None, (f"unknown source '{key}' — see the source list "
                          f"({', '.join(entry['source'] for entry in SEARCH_SOURCES)})")
        selected.append(entry)
    if not selected:
        return None, "sources must not be empty"
    return selected, None


async def find_everywhere(db: Any, user: dict, query: str, sources: Any = None,
                          limit: int = 25) -> dict:
    """Find one value everywhere in the stores Nexus owns, grouped by store."""
    needle = str(query or "").strip()
    if not needle:
        return {"found": False, "error": "query is required"}
    if len(needle) > 200:
        return {"found": False, "error": "query is too long to search"}
    entries, problem = _resolve_sources(sources)
    if problem:
        return {"found": False, "error": problem}
    try:
        bounded = max(1, min(int(limit), 100))
    except (TypeError, ValueError):
        bounded = 25

    scanned = await _scan(db, user, entries or [], needle, bounded)
    return {
        "found": True,
        "query": needle,
        "total": scanned["total"],
        "groups": scanned["groups"],
        "sources_searched": scanned["sources_searched"],
        "empty": scanned["empty"],
        "note": SEARCH_NOTE,
    }


def _literals_in(text: str, kind: str) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    if kind in ("ip", "auto"):
        found.extend((match, "ip") for match in IPV4_RE.findall(text))
    if kind in ("domain", "auto"):
        found.extend((match.lower(), "domain") for match in FQDN_RE.findall(text))
    if kind in ("hostname", "auto"):
        for match in HOSTNAME_RE.findall(text):
            if FQDN_RE.fullmatch(match) or IPV4_RE.fullmatch(match):
                continue
            # Name-shaped alone is too noisy (VPN, INT, CPU). A real host token
            # carries a digit or a separator, so require one before reporting it.
            if not any(char.isdigit() or char == "-" for char in match):
                continue
            found.append((match, "hostname"))
    return found


async def literal_scan(db: Any, user: dict, payload: dict) -> dict:
    """The hardcoded-literal hunter: either locate one value, or discover the
    literals that actually appear in this tenant's stores."""
    kind = str(payload.get("kind") or "auto").strip().lower()
    if kind not in LITERAL_KINDS:
        return {"found": False, "error": f"kind must be one of {', '.join(LITERAL_KINDS)}"}
    value = str(payload.get("value") or "").strip()
    entries, problem = _resolve_sources(payload.get("sources"))
    if problem:
        return {"found": False, "error": problem}
    entries = entries or []

    if value:
        scanned = await _scan(db, user, entries, value, 25)
        classified = "ip" if IPV4_RE.fullmatch(value) else ("domain" if "." in value else kind)
        return {
            "found": True,
            "mode": "locate",
            "kind": classified,
            "value": value,
            "total": scanned["total"],
            "groups": scanned["groups"],
            "empty": scanned["empty"],
            "sources_searched": scanned["sources_searched"],
            "change_impact": _risk_band(scanned["total"]),
            "note": SEARCH_NOTE,
        }

    tally: dict[tuple[str, str], dict] = {}
    documents_scanned = 0
    for entry in entries:
        documents = await _load(db, user, entry)
        documents_scanned += len(documents)
        for document in documents:
            for field, text in _text_pairs(document, tuple(entry["fields"])):
                for literal, literal_kind in _literals_in(text, kind):
                    key = (literal, literal_kind)
                    bucket = tally.setdefault(key, {
                        "value": literal, "kind": literal_kind, "occurrences": 0,
                        "sources": set(), "sample_locations": [],
                    })
                    bucket["occurrences"] += 1
                    bucket["sources"].add(entry["source"])
                    if len(bucket["sample_locations"]) < 3:
                        bucket["sample_locations"].append({
                            "source": entry["source"],
                            "id": str(document.get("id") or ""),
                            "label": _label_for(document, entry),
                            "field": field,
                        })

    discovered = []
    for bucket in tally.values():
        discovered.append({
            "value": bucket["value"],
            "kind": bucket["kind"],
            "occurrences": bucket["occurrences"],
            "sources": sorted(bucket["sources"]),
            "sample_locations": bucket["sample_locations"],
            "private": _is_private_ip(bucket["value"]) if bucket["kind"] == "ip" else None,
        })
    discovered.sort(key=lambda item: (-item["occurrences"], item["value"]))
    return {
        "found": True,
        "mode": "discover",
        "kind": kind,
        "count": len(discovered),
        "literals": discovered[:100],
        "scanned": {"sources": [entry["source"] for entry in entries],
                    "documents": documents_scanned},
        "note": (SEARCH_NOTE + (" Hostname results are name-shaped tokens from a declared heuristic, "
                                "not a discovered inventory." if kind in ("hostname", "auto") else "")),
    }


def _risk_band(total: int) -> dict:
    if total == 0:
        return {"band": "low",
                "reason": "No reference to this value was found in the stores Nexus can see.",
                "certainty": "unverified"}
    if total <= 3:
        return {"band": "medium",
                "reason": f"{total} reference(s) found — small enough to check by hand before changing it.",
                "certainty": "observed"}
    return {"band": "high",
            "reason": f"{total} reference(s) found — changing this value touches other things.",
            "certainty": "observed"}


async def change_impact(db: Any, user: dict, payload: dict) -> dict:
    """Before changing a value: everything in Nexus that mentions it."""
    value = str(payload.get("value") or "").strip()
    if not value:
        return {"found": False, "error": "value is required"}
    written = await find_everywhere(db, user, value, payload.get("sources"),
                                    payload.get("limit") or 50)
    if not written.get("found"):
        return written

    affected_devices: set[str] = set()
    affected_clients: set[str] = set()
    for group in written["groups"]:
        for hit in group["hits"]:
            if group["source"] == "devices" and hit["id"]:
                affected_devices.add(hit["id"])
            if hit.get("client_id"):
                affected_clients.add(hit["client_id"])

    subnet_note = ""
    if IPV4_RE.fullmatch(value):
        octets = value.split(".")
        subnet = ".".join(octets[:3]) + "."
        devices = await getattr(db, "devices").find(
            tenant_scoped_query(user, {"ip_address": {"$regex": "^" + re.escape(subnet)}}),
            {"_id": 0}).limit(MAX_DOCS_PER_SOURCE).to_list(MAX_DOCS_PER_SOURCE)
        neighbours = sorted(str(row.get("ip_address") or "") for row in devices if row.get("ip_address"))
        if neighbours:
            subnet_note = (f" {len(neighbours)} device address(es) are recorded in the {subnet}0/24 "
                           f"range, so a subnet change reaches further than this single address.")

    return {
        "found": True,
        "value": value,
        "total": written["total"],
        "groups": written["groups"],
        "affected": {"devices": len(affected_devices), "clients": len(affected_clients)},
        "risk_band": _risk_band(written["total"]),
        "sources_searched": written["sources_searched"],
        "empty": written["empty"],
        "note": (written["note"] + subnet_note),
    }
