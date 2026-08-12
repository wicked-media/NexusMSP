# Nexus OS application compatibility catalogue

This is the release-controlled source of truth for application support on
Nexus OS Workplace. An application must have one compatibility lane:

- `native` — packaged natively for Nexus OS.
- `pwa` — browser-delivered, managed web application.
- `wine` — verified user-mode Win32 application via Wine/Bottles.
- `proton` — verified application via Proton.
- `remoteapp` — an approved Windows RemoteApp/Cloud PC dependency.
- `windows_vm` — a managed Windows VM dependency.
- `unsupported` — explicitly blocked or not yet supported.

Only `approved` entries are eligible for the customer-facing catalogue. Every
approved entry requires a version, one or more architectures, a licensing
boundary, owner, test evidence reference and a documented rollback path.

`wine` and `proton` mean *that exact version was tested*; they are never a
claim that a vendor's complete product line, drivers, plug-ins or future update
will work. Driver-dependent apps must use `remoteapp`, `windows_vm`, or remain
unsupported.

Run the local validation from the repository root:

```text
python nexus-os/catalog/validate_catalog.py
```
