# NexusMSP release runbook

This runbook covers the release pipeline for the containerised platform (API
and web images) and the Windows Agent release components: how releases are cut,
deployed, rolled back to a previous tag, and what evidence is retained. It
complements `docs/PRODUCTION_READINESS.md` (§4 backup proof, §7 rollback) and
`docs/PLATFORM_RECOVERY_RUNBOOK.md` (data recovery).

## Release model

- Every release produces **immutable image references**: an exact semantic
  version tag (`<registry>/<owner>/nexusmsp-api:1.4.0`) and a `sha-<commit>`
  tag. The truly immutable reference is the image **digest**, recorded in the
  workflow summary and in the release evidence.
- Tags are immutable by policy: never retag or overwrite a released version
  tag. If your registry supports tag immutability rules, enable them.
- Deployments pin images through `NEXUS_API_IMAGE` / `NEXUS_WEB_IMAGE`; a host
  never runs `:latest`, and `scripts/Deploy-NexusImageTag.ps1` refuses it.
- The registry is parameterised. The default is GitHub Container Registry
  (matching the Nexus OS Edge workflow); any other OCI registry can be used by
  dispatching the workflow with a `registry` input and configuring the
  `NEXUS_REGISTRY_USERNAME` / `NEXUS_REGISTRY_PASSWORD` secrets.

## Cutting a container release

1. Ensure CI is green on the commit being released.
2. Either push a tag `v<version>` (for example `v1.4.0`), or run the
   **NexusMSP container release** workflow manually with the `version` input.
3. The workflow builds `nexusmsp-api` (from `backend/Dockerfile.production`)
   and `nexusmsp-web` (from `frontend/Dockerfile`), publishes both with the
   version and `sha-` tags, attaches Buildx provenance and an SBOM, and signs
   the published digests with keyless Cosign.
4. Retain the workflow summary (image names, version, commit, digests) with the
   release record. These digests are the rollback target of last resort.

## Deploying a released image

On the deployment host, with the normal Compose variables already configured:

```powershell
./scripts/Deploy-NexusImageTag.ps1 `
  -ApiImage 'ghcr.io/<owner>/nexusmsp-api:1.4.0' `
  -WebImage 'ghcr.io/<owner>/nexusmsp-web:1.4.0'
```

The script validates the pinned Compose model (`docker compose config`), pulls
the pinned images, and rolls `api`, `worker` and `web` with `--no-build` — no
rebuild can silently substitute different code. Use `-ValidateOnly` to check a
pin without touching the running stack.

## Rollback to a previous tag

Rollback is the identical command with the previous accepted release:

```powershell
./scripts/Deploy-NexusImageTag.ps1 `
  -ApiImage 'ghcr.io/<owner>/nexusmsp-api:1.3.2' `
  -WebImage 'ghcr.io/<owner>/nexusmsp-web:1.3.2'
```

Then complete `docs/PRODUCTION_READINESS.md` §7 (freeze writes, capture logs,
validate login/tenant isolation/ticket history/billing/agent heartbeat). If the
rolled-back release applied a database migration, the migration's documented
rollback must run **before** older images start; the image pin alone does not
revert schema or data changes.

## Windows Agent release and Authenticode signing

1. Run the **Nexus Agent release** workflow (tag `agent-v<version>` or manual
   dispatch with the `version` input). It runs the Go tests and vet, then builds
   `nexus-agent.exe`, `nexus-client-chat.exe` and `nexus-agent-tray.exe`.
2. Configure the signing secrets for real releases:
   - `NEXUS_AGENT_SIGNING_CERTIFICATE` — base64-encoded PFX of the Authenticode
     code-signing certificate.
   - `NEXUS_AGENT_SIGNING_PASSWORD` — the PFX password.
3. Release runs fail without the certificate secret. Dispatch with `sign=false`
   only for explicitly unsigned lab builds; those artifacts are labelled
   `UNSIGNED` and must never ship to managed endpoints.
4. Signing runs `scripts/Sign-NexusAgent.ps1`, which signs each component with
   `signtool` (SHA-256 + RFC3161 timestamp), verifies every signature, and
   writes `artifacts/agent-signing/agent-signing-evidence-*.json` (signer
   identity, thumbprint, timestamp URL, per-file SHA-256) plus `SHA256SUMS.txt`.
   The same script signs local release builds when run on a Windows host with
   the certificate installed.

## Release evidence checklist

Retain with every release:

- [ ] Container workflow summary: image names, version tag, commit, digests.
- [ ] Cosign verification output for the published digests (`cosign verify`).
- [ ] Agent signing evidence JSON + `SHA256SUMS.txt` (or the `UNSIGNED` lab label).
- [ ] Recovery drill evidence (`artifacts/recovery-drills/recovery-drill-*.json`)
      from `scripts/Smoke-Test-NexusDockerRecovery.ps1`, run on the deployment
      Docker host after any change to the capture/storage/restore path.
- [ ] Golden-workflow acceptance evidence (`docs/PRODUCTION_READINESS.md` §5).
- [ ] The exact previous release tag or digest that rollback will pin.
