"""Nexus Universal Connector: one operational abstraction over every vendor.

Instead of every workflow speaking Fortinet/Sophos/Cisco/Microsoft/Acronis APIs,
workflows speak capability verbs — ``identity.user.disable``, ``endpoint.isolate``,
``backup.restore``, ``network.firewall.block`` — and the connector layer resolves
those verbs to vendor-specific operations.

That is what makes vendors replaceable components (change EDR provider without
rewriting workflows) and what the migration engine, marketplace and autonomy
network will all sit on.

Honesty boundary: this module is the *registry and translator*. It resolves a
verb to a concrete vendor operation plan with verification steps; it does not
execute vendor calls. Execution wires in through the existing integration
services and always passes the Nexus Laws gate first.
"""

from __future__ import annotations

from typing import Any

from app.services.scope_permissions import platform_tenant_id

# Capability verbs workflows are written against. Stable interface contract.
CAPABILITIES: dict[str, dict] = {
    "identity.user.provision": {
        "category": "identity", "description": "Create a user identity and baseline access",
        "params": ["user", "role", "licenses"],
    },
    "identity.user.disable": {
        "category": "identity", "description": "Disable a user and revoke sessions",
        "params": ["user"],
    },
    "identity.access.grant": {
        "category": "identity", "description": "Grant a specific application or data access",
        "params": ["user", "resource"],
    },
    "endpoint.isolate": {
        "category": "endpoint", "description": "Network-isolate a compromised endpoint",
        "params": ["device"],
    },
    "endpoint.patch": {
        "category": "endpoint", "description": "Apply pending patches to a device",
        "params": ["device", "patch_set"],
    },
    "endpoint.audit": {
        "category": "endpoint", "description": "Collect an inventory/security posture snapshot",
        "params": ["device"],
    },
    "backup.restore": {
        "category": "backup", "description": "Restore a workload from backup",
        "params": ["workload", "point_in_time"],
    },
    "backup.verify": {
        "category": "backup", "description": "Run a verified restore test",
        "params": ["workload"],
    },
    "network.firewall.block": {
        "category": "network", "description": "Block an address or domain at the perimeter",
        "params": ["indicator", "direction"],
    },
    "network.dns.record_set": {
        "category": "network", "description": "Create/update a DNS record",
        "params": ["zone", "name", "value"],
    },
    "license.assign": {
        "category": "commerce", "description": "Assign a licence to a user or workload",
        "params": ["sku", "target"],
    },
    "license.reclaim": {
        "category": "commerce", "description": "Remove an unused licence",
        "params": ["sku", "target"],
    },
    "email.security.enable": {
        "category": "security", "description": "Enable mail hygiene (anti-phish, DMARC enforcement)",
        "params": ["tenant", "policy"],
    },
    "ticket.create": {
        "category": "service", "description": "Open a service ticket in the PSA",
        "params": ["summary", "client", "priority"],
    },
}

# Adapter registry: which vendors implement which verbs, and how honestly.
# "wired" = an implementation path exists in this codebase; "planned" = known
# vendor surface, not yet wired. Never claim wired when it is not.
ADAPTERS: dict[str, dict] = {
    "microsoft365": {
        "vendor": "Microsoft", "implementation": "app.services.microsoft_graph_connection",
        "capabilities": {
            "identity.user.provision": "wired", "identity.user.disable": "wired",
            "identity.access.grant": "wired", "license.assign": "wired",
            "license.reclaim": "wired", "email.security.enable": "planned",
        },
    },
    "acronis": {
        "vendor": "Acronis", "implementation": "app.services.integrations.AcronisService",
        "capabilities": {"backup.restore": "wired", "backup.verify": "wired", "endpoint.audit": "planned"},
    },
    "pax8": {
        "vendor": "Pax8", "implementation": "app.services.integrations.Pax8Service",
        "capabilities": {"license.assign": "wired", "license.reclaim": "wired"},
    },
    "unifi": {
        "vendor": "Ubiquiti", "implementation": "app.routers.unifi",
        "capabilities": {"network.firewall.block": "planned", "network.dns.record_set": "planned"},
    },
    "native_remote": {
        "vendor": "Nexus", "implementation": "app.services.native_remote",
        "capabilities": {"endpoint.isolate": "wired", "endpoint.patch": "wired", "endpoint.audit": "wired"},
    },
    "nexus_psa": {
        "vendor": "Nexus", "implementation": "app.routers.tickets",
        "capabilities": {"ticket.create": "wired"},
    },
    "synergy_wholesale": {
        "vendor": "Synergy Wholesale", "implementation": "app.services.synergy_wholesale",
        "capabilities": {"network.dns.record_set": "wired", "license.assign": "planned"},
    },
}


def list_capabilities() -> dict:
    return {
        "capabilities": [
            {"verb": verb, **definition} for verb, definition in sorted(CAPABILITIES.items())
        ],
        "count": len(CAPABILITIES),
        "note": "stable workflow interface; vendor adapters resolve these verbs",
    }


def list_adapters() -> dict:
    return {
        "adapters": [
            {
                "adapter": name,
                "vendor": adapter["vendor"],
                "implementation": adapter["implementation"],
                "capabilities": adapter["capabilities"],
                "wired": sum(1 for state in adapter["capabilities"].values() if state == "wired"),
            }
            for name, adapter in sorted(ADAPTERS.items())
        ],
        "count": len(ADAPTERS),
    }


def capability_coverage() -> dict:
    """Which verbs have at least one wired adapter — and where a single vendor is a risk."""
    rows = []
    for verb, definition in sorted(CAPABILITIES.items()):
        providers = {
            name: adapter["capabilities"].get(verb, "absent")
            for name, adapter in ADAPTERS.items()
            if adapter["capabilities"].get(verb)
        }
        wired = [name for name, state in providers.items() if state == "wired"]
        rows.append({
            "verb": verb,
            "category": definition["category"],
            "providers": providers,
            "wired_providers": wired,
            "portable": len(wired) >= 2,  # portable = swap vendors without rewriting workflows
            "single_vendor_risk": len(wired) == 1,
        })
    portable_count = sum(1 for row in rows if row["portable"])
    return {
        "coverage": rows,
        "verbs_total": len(rows),
        "verbs_with_wired_adapter": sum(1 for row in rows if row["wired_providers"]),
        "verbs_portable_now": portable_count,
        "single_vendor_risks": [row["verb"] for row in rows if row["single_vendor_risk"]],
    }


def translate(verb: str, adapter_name: str) -> dict:
    """Resolve a capability verb to a vendor-specific operation plan (plan, not execution)."""
    verb = str(verb or "").strip().lower()
    definition = CAPABILITIES.get(verb)
    if not definition:
        return {"found": False, "error": f"unknown capability verb '{verb}'"}
    adapter = ADAPTERS.get(str(adapter_name or "").strip().lower())
    if not adapter:
        return {"found": False, "error": f"unknown adapter '{adapter_name}'"}
    state = adapter["capabilities"].get(verb)
    if not state:
        return {"found": False, "error": f"adapter '{adapter_name}' does not implement {verb}"}
    return {
        "found": True,
        "verb": verb,
        "adapter": adapter_name,
        "vendor": adapter["vendor"],
        "status": state,
        "operation": {
            "implementation": adapter["implementation"],
            "params": definition["params"],
        },
        "plan": [
            f"validate targets against {definition['params']}",
            f"execute via {adapter['implementation']}",
            "verify outcome against authoritative records (Law 9: never claim an unverified fix)",
            "write evidence record and audit entry",
        ],
        "note": ("execution is not performed by the connector; workflows run this plan "
                 "through the autonomy stack with the Laws gate applied"),
    }


def swap_plan(verb: str, from_adapter: str, to_adapter: str) -> dict:
    """What changing the vendor under a workflow actually touches."""
    verb = str(verb or "").strip().lower()
    definition = CAPABILITIES.get(verb)
    if not definition:
        return {"found": False, "error": f"unknown capability verb '{verb}'"}
    source = ADAPTERS.get(str(from_adapter or "").strip().lower())
    target = ADAPTERS.get(str(to_adapter or "").strip().lower())
    if not source or not target:
        return {"found": False, "error": "both adapters must be registered"}
    if not source["capabilities"].get(verb):
        return {"found": False, "error": f"'{from_adapter}' does not implement {verb}"}
    if not target["capabilities"].get(verb):
        return {"found": False, "error": f"'{to_adapter}' does not implement {verb}"}
    target_state = target["capabilities"][verb]
    return {
        "found": True,
        "verb": verb,
        "from": {"adapter": from_adapter, "vendor": source["vendor"]},
        "to": {"adapter": to_adapter, "vendor": target["vendor"], "status": target_state},
        "checklist": [
            "translate saved policies and automation recipes to the target operation shape",
            "re-point scheduled jobs and event subscriptions",
            "migrate billing/entitlement records to the new vendor SKUs",
            "run both providers in parallel for one billing cycle where possible",
            "verify parity with evidence records before decommissioning the old adapter",
            "update documentation and the trust/evidence chain",
        ],
        "note": ("workflows stay unchanged because they speak the capability verb — "
                 "only this resolution changes. Target adapter status: " + target_state),
    }
