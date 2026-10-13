"""Operations Assurance Studio routes — did the promised outcome happen?

Read-only. Evidence for each commitment is assembled from records that already
have an owner and are already tenant/client-scoped; the evaluation itself lives
in ``app.services.operations_assurance`` as pure policy.

Nothing here writes, and nothing claims an outcome it could not measure.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from app.auth import get_current_user
from app.database import db
from app.services import operations_assurance as policy
from app.services.scope_permissions import assert_client_scope, scoped_query, tenant_scoped_query

router = APIRouter(prefix="/operations-assurance", tags=["Operations Assurance"])

# The window a monitoring agreement is assumed to promise when the record itself
# does not state one. It is disclosed on every row it is applied to.
DEFAULT_REPORTING_WINDOW_HOURS = 24


def _scoped(user: dict[str, Any], query: dict[str, Any] | None = None) -> dict[str, Any]:
    return tenant_scoped_query(user, scoped_query(user, query))


def _is_critical_website(site: dict[str, Any]) -> bool:
    return site.get("critical") is True or str(site.get("priority") or "").lower() == "critical"


async def _evidence(user: dict[str, Any], client_id: str | None) -> dict[str, list[dict[str, Any]]]:
    """Assemble the already-scoped evidence each commitment evaluates.

    ``departed_user_access_revoked`` is deliberately absent: Nexus has no
    authoritative offboarding source yet, so the commitment is reported as
    ``not_measured`` with that reason rather than evaluated against a guess. The
    named gate for that source is recorded in ``docs/NEXUS_FOUNDATIONS_BATCH_4.md``.
    """
    client_scope = {"client_id": client_id} if client_id else {}

    workloads = await db.backup_jobs.find(_scoped(user, client_scope), {"_id": 0}).to_list(5000)

    websites = await db.web_sites.find(_scoped(user, client_scope), {"_id": 0}).to_list(5000)
    critical_websites = [site for site in websites if _is_critical_website(site)]
    for site in critical_websites:
        site.setdefault("enquiry_form_state", site.get("enquiry_form_state") or "")

    agents = await db.nexus_agents.find(_scoped(user, client_scope), {"_id": 0}).to_list(5000)
    monitored = []
    for agent in agents:
        row = dict(agent)
        row.setdefault("device_id", agent.get("device_id") or agent.get("id"))
        # A window the monitoring record does not state is disclosed as the
        # default rather than treated as unlimited.
        row["window_hours"] = agent.get("window_hours") or DEFAULT_REPORTING_WINDOW_HOURS
        monitored.append(row)

    return {
        "verified_recovery_point": workloads,
        "website_enquiry_form": critical_websites,
        "monitoring_reporting_window": monitored,
    }


@router.get("/contract")
async def assurance_contract(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """The promises this studio evaluates, and the evidence each one needs."""
    return {
        "commitments": [
            {
                "id": commitment["id"],
                "title": commitment["title"],
                "promise": commitment["promise"],
                "evidence_source": commitment["evidence_source"],
                "owner": commitment["owner"],
            }
            for commitment in policy.COMMITMENTS
        ],
        "states": sorted(policy.COMMITMENT_STATES),
        "boundary": policy.ASSURANCE_BOUNDARY,
    }


@router.get("/commitments")
async def assurance_commitments(
    client_id: str | None = Query(None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Evaluate every promised operational outcome for the caller's scope.

    ``client_id`` narrows the evaluation to one customer and is refused unless it
    is inside the caller's client boundary.
    """
    if client_id:
        await assert_client_scope(user, client_id, operation="operations-assurance.evaluate")
    evidence = await _evidence(user, client_id)
    report = policy.evaluate_all(evidence)
    report["client_id"] = client_id
    return report
