# Nexus OS image programme

This directory is intentionally separate from the NexusMSP application code. It
contains the first image definition for **Nexus OS Edge**, a bootable,
immutable-Linux appliance foundation that is managed by the Deployment Hub.

It is a development scaffold, not a released operating-system image. Do not
install it at a customer site until the signing, Secure Boot, update/rollback,
hardware support and recovery acceptance gates in
[`docs/NEXUS_OS_ARCHITECTURE.md`](../docs/NEXUS_OS_ARCHITECTURE.md) have passed.

## What the Edge image does today

- Uses a Fedora bootc base to establish an image-based/immutable update path.
- Starts the existing outbound-only Nexus Edge companion with systemd.
- Persists the enrolled Edge identity outside the immutable system image.
- Reads a root-owned deployment environment file supplied at approved install
  time.

## Build the reference image

From the repository root, using Podman or Docker with the repository root as
the build context:

```text
podman build -f nexus-os/edge/Containerfile -t nexus-os-edge:dev .
```

The resulting OCI image is not yet a signed installation ISO. The next
engineering step is to connect this build to a dedicated image pipeline that
generates an SBOM, signs the image, publishes immutable digests and produces a
tested install/recovery medium.

## Remote build option

The `Nexus OS Edge image` GitHub Actions workflow validates this image remotely
whenever its source changes. It can also be started manually with **publish**
enabled to publish the validated OCI image to GitHub Container Registry. Normal
pull requests and branch pushes only build; they never publish an image. A
manual published image receives Buildx provenance, an SBOM and a keyless Cosign
signature. These are release inputs, not proof that a customer appliance has
passed the Nexus OS hardware or security acceptance gates.

## Deployment secret boundary

The control plane generates a single-use activation code. Place it in the
root-owned `/etc/nexus-edge/edge.env` file only for first boot. The companion
stores its persistent identity under `/var/lib/nexus-edge`; remove the
activation code after the first authenticated heartbeat. It must never be
committed into an image, bundle repository, ticket or chat transcript.
