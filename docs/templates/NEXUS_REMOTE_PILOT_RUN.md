# Nexus Native Remote pilot run record

## Run identity

- Date and timezone:
- Tester:
- Tenant / client:
- Test ticket:
- Technician endpoint / agent / build hash:
- Customer endpoint / agent / companion build hash:
- Relay region and build:

## Preconditions

- [ ] Both endpoints are non-production test systems.
- [ ] `native_remote_v1` readiness confirmed for customer endpoint.
- [ ] Companion policy digest matches installed binary.
- [ ] No existing active native grant for the endpoint.
- [ ] View-only mode confirmed; no input, clipboard or native file transfer enabled.

## Results

| Case | Pass / fail | Session ID | Evidence reference | Notes |
| --- | --- | --- | --- | --- |
| Consent deny |  |  |  |  |
| Consent accept |  |  |  |  |
| Technician end |  |  |  |  |
| Endpoint hotkey stop |  |  |  |  |
| Grant expiry |  |  |  |  |
| Disconnect and reconnect |  |  |  |  |
| Replay / out-of-order frame |  |  |  |  |
| Tenant/client scope |  |  |  |  |
| Rollback |  |  |  |  |

## Decision

- [ ] Every required case passed.
- [ ] Rollback was exercised and historical evidence remained intact.
- [ ] No secret, customer content or desktop capture was attached to this record.
- Pilot decision: Not enabled / approved for limited pilot / blocked
- Approver and date:
