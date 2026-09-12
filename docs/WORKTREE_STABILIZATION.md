# Nexus worktree stabilisation map

Snapshot date: 2026-09-12

Purpose: preserve the current broad development effort while making review and release checkpoints explicit.

## Safety decision

The worktree contains hundreds of pre-existing source, test, documentation and evidence changes. No unrelated file was reset, deleted, staged or committed during the production-readiness pass. Local browser captures and temporary QA scripts are now ignored, and malformed generated cache entries were removed from `.gitignore`.

The snapshot immediately before this manifest contained 917 individual status records: 541 modified, 374 untracked and 2 deleted. The largest groups were backend (420), frontend (270), artifacts (92), test reports (78), docs (23) and Agent (20). This manifest adds one further untracked documentation record, bringing the current total to 918.

## Review checkpoints

Review and commit these groups independently. A checkpoint advances only when its own focused tests and ownership review pass.

| Checkpoint | Scope | Required review before commit |
|---|---|---|
| A — platform and security | `backend/app`, `backend/server.py`, backend runtime configuration | Tenant/client scope, permission, audit, failure and data-ownership review; deterministic backend gate |
| B — backend contracts | `backend/tests`, acceptance runner and acceptance Compose file | Match each changed boundary to positive and negative coverage; disposable acceptance run |
| C — frontend product and design system | `frontend/src`, frontend configuration and dependency manifests | Unit, lint, build, dependency, workspace consistency, responsive and permission-aware UX checks |
| D — endpoint Agent | `agent` and Agent repair/release scripts | Go tests/vet/build, trust and replay checks, Windows signing/pilot evidence when applicable |
| E — deployment and recovery | production Docker/Compose files, CI and recovery scripts | Secret boundary, durable-volume ownership, clean-host build, restore and rollback rehearsal |
| F — architecture and operator docs | `docs`, root README and design QA record | Statements match current evidence; external gates remain explicitly open |
| G — generated evidence | `artifacts` and `test_reports` | Retain only intentional, non-secret evidence; remove or regenerate stale reports in a separately reviewed change |

## Immediate release slice from this pass

The smallest independently reviewable slice is:

- CIPP and Microsoft 365 boundary fixes plus their focused tests;
- secure-link ticket history plus the two-client golden-path acceptance additions;
- shared workspace-header breakpoint and Leads lint cleanup;
- readiness, acceptance, design-QA and worktree documentation;
- `.gitignore` cleanup for local captures and generated frontend cache files.

Do not combine this slice with the full historical working set until the other checkpoint owners confirm which untracked files and two tracked deletions are intentional.

## Known worktree blockers

- The two tracked deletions (`frontend/src/components/ui/calendar.jsx` and `frontend/src/lib/supabase.js`) require explicit owner confirmation.
- Hundreds of untracked backend, frontend, script and documentation files appear to be substantive product work, not disposable output. They must be reviewed and committed by checkpoint or deliberately removed by their owner.
- `artifacts` and `test_reports` contain a large evidence set. Release owners must decide which files are authoritative and which are stale before packaging.
- Line-ending conversion warnings are widespread. Apply an agreed `.gitattributes` policy in a separate mechanical change; do not mix mass line-ending churn into a security or product checkpoint.
