# Roadmap merge review — next control-plane features as workspace tools

Scope: the next committed roadmap candidates (#488, #500, #501, #502) were
reviewed for duplication against existing NexusMSP workspaces before any new
workspace was created. Each one overlapped an existing workspace that already
owns its problem space, so each is delivered as a **tool merged into that
workspace** rather than a parallel destination. Promotion policy still applies:
dependencies, evidence, an owner and a release gate are required before any
idea becomes roadmap work (`app/services/nexus_ideas.py`).

## #488 Nexus Access — merged into Nexus Elevate

- **Roadmap intent:** broker privileged access through just-in-time grants,
  approvals, expiry, session evidence and credential-rotation boundaries.
- **Duplicate check:** Nexus Elevate (`app/routers/permission_elevation.py`,
  `frontend/src/pages/NexusElevatePage.jsx`) already covers ~70% of this:
  hash-pinned JIT requests, SLA escalation, time-boxed approvals with
  auto-expiry, break-glass, Entra PIM / Windows LAPS hand-off (credential-free),
  and session evidence. `m365_access_governance.py` covers tenant readiness.
- **Missing differentiator:** credential-**rotation** boundaries.
- **Merge decision:** no new workspace. New tool in the Elevate workspace:
  `app/routers/nexus_access.py` + `NexusAccessPanel.jsx` — a rotation register
  (label, provider, interval, owner, scope) with due/overdue scheduling and
  retained rotation evidence. The boundary is enforced: payloads carrying
  anything shaped like credential material are refused outright.

## #500 Nexus Application Manager — merged into itself (lifecycle rings)

- **Roadmap intent:** govern the full application lifecycle — catalogue,
  approved version, test ring, canary, staged deployment, verification and
  rollback evidence.
- **Duplicate check:** the workspace already exists
  (`app/routers/application_manager.py`, `NexusApplicationManagerPage.jsx`):
  evidence-first inventory, global approval register, scoped action planning.
  Patch evidence lives in Third-Party Patching and Patch Compliance.
- **Missing differentiator:** staged rollout **rings** with promotion gates and
  rollback evidence.
- **Merge decision:** extend the existing Application Manager. New tool:
  lifecycle rings (`test → canary → pilot → broad`) where a ring may only open
  when every earlier ring has recorded verification evidence, and rollback
  evidence is always retained. Governance records only — no endpoint dispatch.

## #501 Nexus Configuration as Code — merged into Expected State

- **Roadmap intent:** version customer standards as reviewable policy,
  calculate the impact of a standard change, and stage remediations behind
  approvals.
- **Duplicate check:** Expected State (`app/routers/expected_state.py`,
  `NexusAssurancePage.jsx` via `ExpectedStatePage.jsx`) already compares
  declared scope against observed evidence, and Change Management owns the
  change-approval workflow. `nexus_ideas.py` #487 (Nexus Desired State) is a
  separate future control-plane vision, not an implemented duplicate.
- **Missing differentiator:** standards **revisions** (immutable versioning),
  pre-adoption impact calculation, and staged remediation behind approval.
- **Merge decision:** no new workspace. New tool in Expected State: standards
  as code — every change is a retained numbered revision, `impact` compares a
  proposed revision before adoption, and remediation is staged `awaiting_approval`
  with an explicit approve step. Execution stays in the owning workspace.

## #502 Nexus Test Environment — merged into Nexus Proving Ground

- **Roadmap intent:** run representative, non-production simulations for
  scripts, packages, policies, automations, agent updates and connectors
  before broad rollout.
- **Duplicate check:** Nexus Proving Ground
  (`app/routers/nexus_proving_ground.py`, `NexusProvingGroundPage.jsx`) is
  already the "prove a workflow safely" workspace (simulation ledger, approval
  boundaries, configuration gaps). Workflow Automation has per-workflow
  simulation; Nexus Elevate has policy simulation.
- **Missing differentiator:** a per-**candidate** pre-rollout bench covering
  the six rollout candidate kinds with explicit gate checks.
- **Merge decision:** no new workspace. New tool in the Proving Ground: the
  pre-rollout bench — deterministic, explainable verdicts (`pass`,
  `needs_review`, `fail`) computed from declared candidate metadata with every
  check shown, and clearance for rollout only on a passing verdict with
  retained approval evidence. The bench never executes on endpoints and
  refuses credential material.

## Shared policy

Pure decision policy lives in `app/services/roadmap_tools.py` (credential
material refusal, rotation scheduling, promotion gates, revision impact, bench
verdicts) with focused tests in
`backend/tests/test_roadmap_merged_tools.py`. Storage decisions for the new
records are recorded in `docs/DATA_OWNERSHIP.md`.
