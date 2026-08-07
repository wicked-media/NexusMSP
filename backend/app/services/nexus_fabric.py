"""Technician-facing read model for the canonical Nexus relationship graph.

Nexus Fabric does not infer relationships.  It reshapes the persisted Nexus
Core index into a searchable client view and carries the source evidence for
every edge into the response.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any
from urllib.parse import quote


ENTITY_ORDER = (
    "client",
    "site",
    "contact",
    "user",
    "device",
    "service",
    "contract",
    "ticket",
    "project",
    "invoice",
    "documentation",
    "integration",
)

ENTITY_LABELS = {
    "client": ("Client", "Clients"),
    "site": ("Site", "Sites"),
    "contact": ("Contact", "Contacts"),
    "user": ("User", "Users"),
    "device": ("Device", "Devices"),
    "service": ("Service", "Services"),
    "contract": ("Contract", "Contracts"),
    "ticket": ("Ticket", "Tickets"),
    "project": ("Project", "Projects"),
    "invoice": ("Invoice", "Invoices"),
    "documentation": ("Document", "Documentation"),
    "integration": ("Integration", "Integrations"),
}

RELATION_LABELS = {
    "client.owns": "owns",
    "site.contains": "contains",
    "user.uses": "uses",
    "service.governed_by": "governed by",
    "integration.provides": "provides",
    "ticket.concerns": "concerns",
    "project.includes": "includes",
    "invoice.bills": "bills",
    "documentation.describes": "describes",
    "context.explains": "explains why",
}

ATTENTION_STATES = {
    "attention",
    "at_risk",
    "blocked",
    "critical",
    "disabled",
    "failed",
    "needs review",
    "needs_review",
    "offline",
    "overdue",
    "warning",
}

MEMORY_KIND_LABELS = {
    "service_history": "Service history",
    "known_risk": "Known risk",
    "documented_knowledge": "Documented knowledge",
    "commercial_context": "Commercial context",
    "operational_context": "Operational context",
}


def _route_for(node: dict[str, Any]) -> str:
    entity_type = str(node.get("entity_type") or "")
    entity_id = quote(str(node.get("entity_id") or ""), safe="")
    client_id = quote(str(node.get("client_id") or ""), safe="")
    routes = {
        "client": f"/clients?client={entity_id}",
        "site": f"/networking?client={client_id}",
        "contact": f"/contacts?clientId={client_id}",
        "user": f"/control-plane?module=microsoft365&client={client_id}",
        "device": f"/devices/{entity_id}",
        "service": f"/services-subscriptions?client={client_id}",
        "contract": f"/contracts?contract={entity_id}",
        "ticket": f"/tickets?ticket={entity_id}",
        "project": f"/projects?project={entity_id}",
        "invoice": f"/invoices?invoice={entity_id}",
        "documentation": f"/documentation-hub?tab=library&client={client_id}",
        "integration": f"/integrations?client={client_id}",
    }
    return routes.get(entity_type, f"/clients?client={client_id}")


def _memory_for_node(node: dict[str, Any]) -> dict[str, Any] | None:
    """Create a source-backed memory episode from one canonical object.

    This deliberately does not use an LLM or infer a cause.  It gives the AI
    layer a safe retrieval object whose statements can always be traced back
    to a source record or an indexed relationship.
    """

    relationships = [
        relation for relation in node.get("relationships") or []
        if relation.get("relation_type") != "client.owns"
    ]
    entity_type = str(node.get("entity_type") or "")
    metadata = node.get("metadata") or {}
    status = str(node.get("status") or "recorded").replace("_", " ")

    if entity_type == "ticket":
        kind = "service_history"
    elif node.get("attention"):
        kind = "known_risk"
    elif entity_type == "documentation" and relationships:
        kind = "documented_knowledge"
    elif entity_type in {"service", "contract", "invoice"} and relationships:
        kind = "commercial_context"
    elif relationships:
        kind = "operational_context"
    else:
        return None

    related = [relation["related"] for relation in relationships]
    related_names = [str(item.get("name") or item.get("entity_id")) for item in related]
    related_types = sorted({str(item.get("entity_type") or "record") for item in related})
    relation_summary = ", ".join(related_names[:4])
    if len(related_names) > 4:
        relation_summary += f" and {len(related_names) - 4} more"

    facts = []
    for label, key in (
        ("Priority", "priority"),
        ("Category", "category"),
        ("Technician", "assigned_to_name"),
        ("Resolution", "resolution"),
        ("Quantity source", "quantity_source"),
        ("SLA tier", "sla_tier"),
    ):
        value = metadata.get(key)
        if value not in (None, "", []):
            facts.append({"label": label, "value": str(value)})

    if relation_summary:
        narrative = f"{node['name']} is {status} and is directly connected to {relation_summary}."
    else:
        narrative = f"{node['name']} is recorded with status {status}."

    evidence = [{
        "collection": (node.get("source") or {}).get("collection"),
        "source_id": (node.get("source") or {}).get("id"),
        "statement": "Canonical source record",
    }]
    evidence.extend({
        "collection": (relation.get("source") or {}).get("collection"),
        "source_id": (relation.get("source") or {}).get("id"),
        "statement": relation.get("evidence") or "Persisted source relationship",
        "relationship": relation.get("relation_type"),
    } for relation in relationships[:8])

    search_values = [
        node.get("name"), entity_type, status, kind, *related_names, *related_types,
        *(fact["value"] for fact in facts),
    ]
    return {
        "id": f"memory:{node['id']}",
        "kind": kind,
        "kind_label": MEMORY_KIND_LABELS[kind],
        "headline": node.get("name"),
        "narrative": narrative,
        "status": node.get("status"),
        "attention": bool(node.get("attention")),
        "confidence": "verified" if relationships else "recorded",
        "why_recalled": (
            f"Nexus found {len(relationships)} persisted cross-object relationship"
            f"{'s' if len(relationships) != 1 else ''} for this {entity_type}."
            if relationships else f"Nexus retained this {entity_type} from its canonical source record."
        ),
        "occurred_at": metadata.get("closed_at") or metadata.get("resolved_at") or metadata.get("updated_at") or node.get("indexed_at"),
        "route": node.get("route"),
        "object": {
            "id": node.get("id"),
            "entity_type": entity_type,
            "entity_id": node.get("entity_id"),
            "name": node.get("name"),
        },
        "related_objects": related[:12],
        "facts": facts,
        "evidence": evidence,
        "search_text": " ".join(str(value) for value in search_values if value).casefold(),
    }


def _decision_radius(root: dict[str, Any], node_by_ref: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Return a two-hop relationship radius without claiming causation."""

    paths: list[dict[str, Any]] = []
    seen = {root["id"]}
    first_hop = [
        relation for relation in root.get("relationships") or []
        if relation.get("relation_type") != "client.owns"
    ]
    for relation in first_hop:
        related = relation["related"]
        if related["id"] in seen or related.get("entity_type") == "client":
            continue
        seen.add(related["id"])
        paths.append({
            "depth": 1,
            "object": related,
            "via": relation.get("label"),
            "evidence": relation.get("evidence"),
            "source": relation.get("source") or {},
        })

        full_related = node_by_ref.get(related["id"]) or {}
        for second_relation in full_related.get("relationships") or []:
            second = second_relation["related"]
            if second["id"] in seen or second.get("entity_type") == "client":
                continue
            if second_relation.get("relation_type") == "client.owns":
                continue
            seen.add(second["id"])
            paths.append({
                "depth": 2,
                "object": second,
                "via": f"{related['name']} · {second_relation.get('label')}",
                "evidence": second_relation.get("evidence"),
                "source": second_relation.get("source") or {},
            })

    type_counts = Counter(path["object"]["entity_type"] for path in paths)
    return {
        "id": f"radius:{root['id']}",
        "root": {
            "id": root.get("id"),
            "entity_type": root.get("entity_type"),
            "entity_id": root.get("entity_id"),
            "name": root.get("name"),
            "status": root.get("status"),
            "route": root.get("route"),
        },
        "related_objects": paths[:30],
        "direct_count": sum(1 for path in paths if path["depth"] == 1),
        "extended_count": sum(1 for path in paths if path["depth"] == 2),
        "type_counts": dict(type_counts),
        "questions": {
            "what": f"{root['name']} is recorded as {str(root.get('status') or 'needing attention').replace('_', ' ')}.",
            "why": "No verified causal explanation is recorded. Nexus is showing source-backed relationships, not claiming that this object caused another issue.",
            "next": "A forecast is unknown until trend or provider telemetry supplies predictive evidence.",
            "should": f"Validate {root['name']} in its owning workspace, then inspect the directly linked objects before wider action.",
            "can": "Nexus can open the owning records now. Remediation still requires an approved automation or technician decision.",
        },
        "disclaimer": "Relationship radius shows what may deserve checking; it is not proof of technical or business impact.",
    }


def build_client_fabric(graph: dict[str, Any]) -> dict[str, Any]:
    """Build a deterministic relationship explorer from a Nexus Core graph."""

    raw_nodes = graph.get("nodes") or []
    raw_edges = graph.get("edges") or []
    node_by_ref = {
        str(node.get("id")): dict(node)
        for node in raw_nodes
        if node.get("id")
    }
    adjacency: dict[str, list[dict[str, Any]]] = defaultdict(list)
    operationally_linked: set[str] = set()
    source_counts: Counter[str] = Counter()
    relationship_counts: Counter[str] = Counter()

    for edge in raw_edges:
        from_ref = str(edge.get("from_ref") or "")
        to_ref = str(edge.get("to_ref") or "")
        if from_ref not in node_by_ref or to_ref not in node_by_ref:
            continue
        relation_type = str(edge.get("relation_type") or "related")
        relationship_counts[relation_type] += 1
        source = str((edge.get("source") or {}).get("collection") or "unknown")
        source_counts[source] += 1
        relation = {
            "id": edge.get("id"),
            "relation_type": relation_type,
            "label": RELATION_LABELS.get(relation_type, relation_type.replace(".", " ").replace("_", " ")),
            "evidence": edge.get("evidence") or "Source relationship",
            "source": edge.get("source") or {},
            "context": edge.get("context") or {},
        }
        adjacency[from_ref].append({**relation, "direction": "outbound", "related_ref": to_ref})
        adjacency[to_ref].append({**relation, "direction": "inbound", "related_ref": from_ref})
        if relation_type != "client.owns":
            operationally_linked.update((from_ref, to_ref))

    nodes: list[dict[str, Any]] = []
    groups: list[dict[str, Any]] = []
    group_nodes: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for ref, node in node_by_ref.items():
        entity_type = str(node.get("entity_type") or "unknown")
        status = str(node.get("status") or "").strip().lower()
        related = adjacency.get(ref, [])
        shaped = {
            "id": ref,
            "entity_type": entity_type,
            "entity_id": node.get("entity_id"),
            "name": node.get("name") or node.get("entity_id") or ref,
            "status": node.get("status"),
            "attention": status in ATTENTION_STATES,
            "route": _route_for(node),
            "source": node.get("source") or {},
            "external_refs": node.get("external_refs") or {},
            "metadata": node.get("metadata") or {},
            "indexed_at": node.get("indexed_at"),
            "relationship_count": len(related),
            "relationships": [],
        }
        nodes.append(shaped)
        group_nodes[entity_type].append(shaped)

    shaped_by_ref = {node["id"]: node for node in nodes}
    for node in nodes:
        for relation in adjacency.get(node["id"], []):
            related_node = shaped_by_ref.get(relation["related_ref"])
            if not related_node:
                continue
            node["relationships"].append({
                **relation,
                "related": {
                    "id": related_node["id"],
                    "entity_type": related_node["entity_type"],
                    "entity_id": related_node["entity_id"],
                    "name": related_node["name"],
                    "status": related_node["status"],
                    "attention": related_node["attention"],
                    "route": related_node["route"],
                },
            })
        node["relationships"].sort(
            key=lambda item: (
                item["relation_type"] == "client.owns",
                item["related"]["entity_type"],
                str(item["related"]["name"]).casefold(),
            )
        )

    for entity_type in ENTITY_ORDER:
        members = group_nodes.get(entity_type, [])
        singular, plural = ENTITY_LABELS[entity_type]
        groups.append({
            "entity_type": entity_type,
            "label": singular if len(members) == 1 else plural,
            "count": len(members),
            "attention_count": sum(1 for item in members if item["attention"]),
            "relationship_count": sum(item["relationship_count"] for item in members),
        })

    non_client_nodes = [node for node in nodes if node["entity_type"] != "client"]
    operational_nodes = {
        ref for ref in operationally_linked
        if shaped_by_ref.get(ref, {}).get("entity_type") != "client"
    }
    threads = []
    for edge in raw_edges:
        if edge.get("relation_type") == "client.owns":
            continue
        left = shaped_by_ref.get(str(edge.get("from_ref") or ""))
        right = shaped_by_ref.get(str(edge.get("to_ref") or ""))
        if not left or not right:
            continue
        threads.append({
            "id": edge.get("id"),
            "relation_type": edge.get("relation_type"),
            "label": RELATION_LABELS.get(str(edge.get("relation_type")), str(edge.get("relation_type") or "related")),
            "from": {key: left[key] for key in ("id", "entity_type", "entity_id", "name", "status", "route")},
            "to": {key: right[key] for key in ("id", "entity_type", "entity_id", "name", "status", "route")},
            "evidence": edge.get("evidence") or "Source relationship",
            "source": edge.get("source") or {},
            "context": edge.get("context") or {},
        })
    threads.sort(key=lambda item: (item["relation_type"], str(item["from"]["name"]).casefold()))

    memories = [memory for node in nodes if (memory := _memory_for_node(node))]
    memories.sort(
        key=lambda item: (
            not item["attention"],
            item["kind"] != "service_history",
            str(item.get("occurred_at") or ""),
            str(item.get("headline") or "").casefold(),
        )
    )
    memory_counts = Counter(item["kind"] for item in memories)
    decision_radii = [
        _decision_radius(node, shaped_by_ref)
        for node in nodes
        if node["attention"] and node["entity_type"] != "client"
    ]
    decision_radii.sort(
        key=lambda item: (
            -(item["direct_count"] + item["extended_count"]),
            str(item["root"]["name"]).casefold(),
        )
    )

    relationship_coverage = (
        round(len(operational_nodes) / len(non_client_nodes) * 100, 1)
        if non_client_nodes else 100.0
    )
    document_count = len(group_nodes.get("documentation", []))
    coverage_points = round(relationship_coverage * 0.45)
    source_points = min(20, len(source_counts) * 4)
    memory_points = min(20, len(memories) * 2)
    documentation_points = min(15, document_count * 3)
    knowledge_score = min(100, coverage_points + source_points + memory_points + documentation_points)
    knowledge_band = "bright" if knowledge_score >= 80 else "developing" if knowledge_score >= 50 else "dim"

    return {
        "client": graph.get("client") or {},
        "client_id": graph.get("client_id"),
        "schema_version": graph.get("schema_version"),
        "indexed": bool(nodes),
        "summary": {
            "objects": len(nodes),
            "relationships": sum(relationship_counts.values()),
            "operational_threads": len(threads),
            "relationship_coverage_pct": relationship_coverage,
            "attention_objects": sum(1 for item in nodes if item["attention"]),
            "source_count": len(source_counts),
            "operational_memories": len(memories),
        },
        "groups": groups,
        "nodes": sorted(
            nodes,
            key=lambda item: (
                ENTITY_ORDER.index(item["entity_type"]) if item["entity_type"] in ENTITY_ORDER else 99,
                str(item["name"]).casefold(),
            ),
        ),
        "threads": threads[:300],
        "memory": {
            "items": memories[:120],
            "counts": dict(memory_counts),
            "evidence_count": sum(len(item["evidence"]) for item in memories),
            "principles": [
                "Memory is retrieved from canonical source records and persisted relationships.",
                "Nexus explains why each memory was recalled and shows its evidence.",
                "Missing evidence stays unknown; Nexus does not invent causes or resolutions.",
            ],
        },
        "decision_lens": {
            "radii": decision_radii[:20],
            "attention_count": len(decision_radii),
            "principle": "Nexus separates observed state, relationship evidence, forecasts, recommendations, and approved action capability.",
        },
        "knowledge_readiness": {
            "score": knowledge_score,
            "band": knowledge_band,
            "label": "Memory Crystal",
            "description": "A transparent measure of how much source-backed context Nexus can use for this client; it is not a client health score.",
            "components": [
                {"label": "Relationship coverage", "points": coverage_points, "maximum": 45},
                {"label": "Source diversity", "points": source_points, "maximum": 20},
                {"label": "Operational memory", "points": memory_points, "maximum": 20},
                {"label": "Linked documentation", "points": documentation_points, "maximum": 15},
            ],
        },
        "relationship_counts": dict(relationship_counts),
        "source_counts": dict(source_counts),
        "principles": [
            "Every line is backed by a persisted source relationship.",
            "Missing links remain visible as coverage gaps; Nexus does not infer them.",
            "Open an object in its owning workspace before making a change.",
        ],
    }
