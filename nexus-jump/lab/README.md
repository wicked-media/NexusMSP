# Nexus Jump lab gateway preflight

This folder is the safe first step for a Nexus-hosted **lab** gateway. It lets
us define and check the access boundary before a transport controller is
introduced.

It does **not** start a WireGuard service, expose a port, create an inbound
tunnel, generate a private key, or grant access to a customer network.

## Lab flow

1. Copy `gateway-policy.example.json` to a private working location outside
   source control.
2. Replace the example endpoint and public key with the lab gateway metadata.
   Keep all private keys in the eventual encrypted secrets store, never in a
   policy file, ticket, chat message, or repository.
3. Restrict `allowed_resource_cidrs` to the lab subnet(s) that are genuinely
   required. Broad routes such as `0.0.0.0/0` are rejected.
4. Validate the policy offline:

   ```powershell
   python .\validate_gateway_policy.py C:\private\gateway-policy.lab.json
   ```

5. Only after the controller, certificate/identity model, key lifecycle,
   revocation path, and audit export have passed review should the lab gateway
   be enrolled. That later step is intentionally not automated here.

## Required production safeguards (not yet enabled)

- ticket-bound, time-limited, per-resource access scopes;
- technician MFA and policy/approval checks;
- gateway and Edge identity attestation;
- encrypted secret storage and key rotation;
- immediate revocation and session audit evidence;
- no broad network routes and no customer deployment until the lab test passes.

The existing Nexus Deployment Hub and ticket workflow can request a scoped
Nexus Jump action, but they correctly remain in `awaiting_transport` until this
transport-control layer exists and has been verified.
