# Nexus worktree stabilisation map

Snapshot date: 2026-09-12

Purpose: preserve the current broad development effort while making review and release checkpoints explicit.

## Safety decision

The worktree contained hundreds of pre-existing source, test, documentation and evidence changes. No file was reset or discarded during stabilisation. Local browser captures and temporary QA scripts are now ignored, and malformed generated cache entries were removed from `.gitignore`.

The snapshot immediately before this manifest contained 917 individual status records: 541 modified, 374 untracked and 2 deleted. The largest groups were backend (420), frontend (270), artifacts (92), test reports (78), docs (23) and Agent (20). This manifest added one further documentation record, bringing the reviewed total to 918. Stabilisation completed on `codex/worktree-stabilization` with a clean worktree.

## Review checkpoints

Review and commit these groups independently. A checkpoint advances only when its own focused tests and ownership review pass.

| Checkpoint | Scope | Result |
|---|---|---|
| A/B — backend platform, security and contracts | `backend` | `8f2f7bf`; deterministic backend gate and disposable two-client acceptance passed |
| C — frontend product and design system | `frontend` | `0b277b6`; unit, lint, build, dependency and workspace-consistency gates passed; both tracked deletions verified unused |
| D — endpoint Agent | `agent` | `92c3c12`; Go tests passed and staged whitespace check passed after amendment |
| E/F — deployment, recovery and operator docs | CI, Compose, scripts, `docs`, root guidance | `3210576`; configuration and documentation checkpointed with external gates still open |
| G — generated evidence | `artifacts` and `test_reports` | `149f720`; 170 files, 20.75 MB, no file over 5 MB and no high-confidence credential candidate |
| Credential cleanup | tracked project notes | `2033d83` and `de2ff84`; plaintext test password removed from the current tree |

## Completed release slice from this pass

The smallest independently reviewable slice is:

- CIPP and Microsoft 365 boundary fixes plus their focused tests;
- secure-link ticket history plus the two-client golden-path acceptance additions;
- shared workspace-header breakpoint and Leads lint cleanup;
- readiness, acceptance, design-QA and worktree documentation;
- `.gitignore` cleanup for local captures and generated frontend cache files.

The full historical working set is now preserved in the independent checkpoints above. No checkpoint has been merged or pushed by this local stabilisation pass.

## Remaining repository follow-up

- Review the seven commits as a branch and merge or push them only after owner approval.
- The removed test password existed in repository history. Rotate it if it was ever active; the current tree no longer contains the former value.
- Line-ending conversion warnings are widespread. Apply an agreed `.gitattributes` policy in a separate mechanical change; do not mix mass line-ending churn into a security or product checkpoint.
