# Nexus Native Remote pilot acceptance

This is an attended, view-only pilot gate. It does not authorise remote input,
clipboard sync, native file transfer, unattended access, secure-desktop access,
or production rollout.

## Two-machine setup

- Use two separately enrolled Windows endpoints in the same non-production tenant.
- Record stable tenant, client, device, agent, technician and test ticket IDs.
- Confirm the companion hash is policy-pinned and the endpoint reports `native_remote_v1`.
- Capture only non-sensitive test desktops; never use production credentials or secrets.

## Required acceptance cases

| Case | Expected result | Evidence |
| --- | --- | --- |
| Consent deny | No capture starts; session ends with companion rejection | session lifecycle and grant status |
| Consent accept | Exactly one view-only session activates | scoped session, grant and transport evidence |
| Technician end | Grant revokes; companion stops; frame is removed | revoke timestamp and empty relay frame |
| Endpoint hotkey stop | Endpoint owns revocation; technician cannot resume it | endpoint-user revocation evidence |
| Expiry | Browser removes the frame; endpoint closes session | expired grant and ended session |
| Disconnect/reconnect | Reconnect requires fresh protected transport before a frame | transport transitions and ordered sequence |
| Replay frame | Relay rejects it without updating view or heartbeat | 409 result and retained sequence |
| Tenant/client scope | Out-of-scope technician cannot read frame or session | permission result with no frame body |
| Rollback | Disable pilot policy; new grants fail closed; history remains | policy result and preserved records |

## Relay production gate

The bounded HTTPS JPEG relay is pre-production only. Before pilot enablement,
the authenticated relay must provide mutual endpoint authentication, encrypted
transport, bounded queues, connection timeout, regional deployment policy and
reconnect coverage. Do not claim WebRTC, interactive control or recording until
separately implemented and tested.

## Sign-off

Record tester, date, build hashes, test ticket IDs, case outcomes, relay region,
rollback result and failed cases. A failed or skipped required case blocks pilot enablement.
Use `docs/templates/NEXUS_REMOTE_PILOT_RUN.md` for each recorded run.
