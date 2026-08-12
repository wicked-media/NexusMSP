"""Nexus Deployment Hub: governed Core, Edge, Backup Vault and Remote Relay provisioning.

This router intentionally creates activation and observability contracts rather
than pretending an installation completed from a browser click.  Deployment
bundles are customer-scoped, activation codes are single-use, and an Edge must
prove a later heartbeat before it is shown as online or billable.
"""
from __future__ import annotations

import hashlib
import io
import ipaddress
import secrets
import re
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.scope_permissions import assert_client_scope, scoped_query


router = APIRouter(tags=["Nexus Deployment Hub"])
ONLINE_WINDOW_SECONDS = 300
# Planning minima rather than a claim that a role has been installed.  These are
# deliberately conservative starting points for the appliance sizing workflow;
# the eventual Edge inventory report will replace them with measured capacity.
EDGE_ROLE_CATALOG = {
    "discovery_probe": {"cpu_cores": 1, "memory_gb": 1, "storage_gb": 10, "lan_visibility": True},
    "backup_node": {"cpu_cores": 2, "memory_gb": 4, "storage_gb": 2048, "lan_visibility": False},
    "remote_relay": {"cpu_cores": 1, "memory_gb": 1, "storage_gb": 20, "lan_visibility": False},
    "jump_gateway": {"cpu_cores": 2, "memory_gb": 2, "storage_gb": 20, "lan_visibility": True},
    "dns_security": {"cpu_cores": 1, "memory_gb": 1, "storage_gb": 10, "lan_visibility": True},
    "network_monitor": {"cpu_cores": 1, "memory_gb": 1, "storage_gb": 10, "lan_visibility": True},
    "syslog_collector": {"cpu_cores": 2, "memory_gb": 4, "storage_gb": 256, "lan_visibility": True},
}
EDGE_ROLE_IDS = set(EDGE_ROLE_CATALOG)
JUMP_PROTOCOLS = {"https", "ssh", "rdp", "vnc", "winrm", "ipmi"}
JUMP_ENDPOINT_RE = re.compile(
    r"^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\]):([1-9][0-9]{0,4})$"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _timestamp(value: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except (TypeError, ValueError):
        return None


def _is_platform_admin(user: dict) -> bool:
    return bool(user.get("is_admin") or str(user.get("role") or "").lower() in {"admin", "owner"})


def _deployment_scope_user(user: dict) -> dict:
    """Treat an owner as a platform administrator for this global workspace."""
    return {**user, "is_admin": True} if _is_platform_admin(user) else user


async def _require_deployment_admin(user=Depends(get_current_user)) -> dict:
    if not _is_platform_admin(user):
        raise HTTPException(status_code=403, detail="Nexus Deployment Hub administrator permission required")
    return user


def _deployment_requirements(kind: str, owner_type: str = "nexus") -> list[dict]:
    common = [
        {"id": "dns", "label": "DNS and TLS", "detail": "A public FQDN and a valid TLS certificate are required before activation.", "required": True},
        {"id": "docker", "label": "Docker Engine", "detail": "Docker Compose v2 with persistent storage is required on the target host.", "required": True},
        {"id": "outbound", "label": "Outbound control-plane access", "detail": "The deployment initiates outbound HTTPS to Nexus; no inbound control-plane port is required.", "required": True},
    ]
    if kind == "remote_relay":
        return common + [
            {"id": "relay_ports", "label": "RustDesk relay ports", "detail": "Allow TCP 21115-21119 and UDP 21116 only after reviewing the customer firewall policy.", "required": True},
            {"id": "consent", "label": "Remote consent policy", "detail": "Configure consent and ticket linkage in Nexus Remote before technicians connect.", "required": True},
        ]
    if kind == "core":
        requirements = common + [
            {"id": "secrets", "label": "Production secrets", "detail": "Generate unique MongoDB, JWT and encryption secrets. Do not reuse the activation code as an application secret.", "required": True},
            {"id": "backup", "label": "Backup and recovery", "detail": "Back up MongoDB and uploaded installer volumes before accepting production users.", "required": True},
        ]
        if owner_type == "msp_partner":
            requirements.append({"id": "partner_boundary", "label": "MSP tenant boundary", "detail": "Confirm the partner tenant, branding and support-access policy before inviting technicians.", "required": True})
        return requirements
    if kind == "backup_vault":
        return common + [
            {"id": "storage", "label": "Dedicated backup storage", "detail": "Provide persistent block storage sized for retention, restore staging and repository maintenance. Do not use the operating-system disk.", "required": True},
            {"id": "immutability", "label": "Immutable off-site copy", "detail": "Configure a separate S3-compatible target with Object Lock before marking customer backups protected.", "required": True},
            {"id": "vault_tls", "label": "Vault TLS certificate", "detail": "Place a certificate and key in kopia-tls before start. Keep the Kopia port private behind the approved reverse proxy or VPN.", "required": True},
            {"id": "keys", "label": "Customer encryption boundary", "detail": "Store each customer repository key in the approved Nexus secret store; never put recoverable keys in the deployment bundle.", "required": True},
            {"id": "recovery", "label": "Restore verification", "detail": "Run and record a test restore before relying on this Vault for recovery or billing.", "required": True},
        ]
    scope_label = "MSP partner scope" if owner_type == "msp_partner" else "Client scope"
    scope_detail = "Confirm this service is bound to the intended MSP partner before sharing its activation code." if owner_type == "msp_partner" else "Confirm this Edge is assigned to the intended customer before sharing its activation code."
    return common + [
        {"id": "scope", "label": scope_label, "detail": scope_detail, "required": True},
        {"id": "privacy", "label": "Data boundary", "detail": "Choose which local services and telemetry are permitted to leave the customer environment.", "required": True},
    ]


class EdgeResourceProfile(BaseModel):
    """Operator-declared appliance capacity used for safe Edge role planning."""
    cpu_cores: int = Field(ge=1, le=256)
    memory_gb: int = Field(ge=1, le=2048)
    storage_gb: int = Field(ge=10, le=1_000_000)
    lan_visibility: bool = True


class DeploymentCreate(BaseModel):
    kind: Literal["core", "edge", "backup_vault", "remote_relay"]
    name: str = Field(min_length=2, max_length=120)
    owner_type: Literal["nexus", "msp_partner"] = "nexus"
    channel_tenant_id: str | None = None
    channel_tenant_name: str | None = Field(default=None, max_length=160)
    client_id: str | None = None
    client_name: str | None = None
    public_url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=1000)
    edge_roles: list[str] = Field(default_factory=list, max_length=6)
    edge_resources: EdgeResourceProfile | None = None


def _edge_role_plan(roles: list[str], resources: EdgeResourceProfile | None) -> dict:
    requirements = {
        "cpu_cores": sum(EDGE_ROLE_CATALOG[role]["cpu_cores"] for role in roles),
        "memory_gb": sum(EDGE_ROLE_CATALOG[role]["memory_gb"] for role in roles),
        "storage_gb": sum(EDGE_ROLE_CATALOG[role]["storage_gb"] for role in roles),
        "lan_visibility": any(EDGE_ROLE_CATALOG[role]["lan_visibility"] for role in roles),
    }
    provided = resources.model_dump() if resources else None
    gaps: list[str] = []
    if provided:
        for field, label in (("cpu_cores", "CPU"), ("memory_gb", "memory"), ("storage_gb", "persistent storage")):
            if provided[field] < requirements[field]:
                gaps.append(f"{label}: need {requirements[field]}, provided {provided[field]}")
        if requirements["lan_visibility"] and not provided["lan_visibility"]:
            gaps.append("LAN visibility: one or more selected roles need customer LAN access")
    return {"roles": roles, "requirements": requirements, "provided": provided, "gaps": gaps, "ready": not gaps}


def _safe_connectivity_target(value: str) -> str:
    host = value.strip().rstrip(".")
    # Commands are intentionally host + port rather than a URL, shell command
    # or arbitrary argument vector. Internal RFC1918 targets are valid because
    # the check is scoped to the customer Edge and its own client/ticket.
    if not host or not re.fullmatch(r"[A-Za-z0-9._:-]+", host) or "/" in host or "://" in host:
        raise HTTPException(status_code=422, detail="Target must be a hostname or IP address without a URL, path or command")
    return host


async def _expire_jump_access_requests(query: dict | None = None) -> None:
    """Expire unfulfilled access intent without pretending a session existed."""
    now = _now()
    criteria = {**(query or {}), "status": "awaiting_transport", "expires_at": {"$lte": now}}
    await db.nexus_jump_access_requests.update_many(criteria, {"$set": {"status": "expired", "expired_at": now}})


class DeploymentActivate(BaseModel):
    deployment_id: str
    activation_code: str = Field(min_length=20, max_length=200)
    instance_id: str = Field(min_length=3, max_length=160)
    hostname: str = Field(min_length=2, max_length=255)
    version: str = Field(default="0.1.0", max_length=80)


class EdgeSitePulse(BaseModel):
    """A bounded Edge-to-control-plane observation, not a synthetic site pass."""
    scope: Literal["edge_to_control_plane"] = "edge_to_control_plane"
    control_plane_dns: Literal["healthy", "attention"]
    control_plane_transport: Literal["healthy", "attention"]
    latency_ms: int | None = Field(default=None, ge=0, le=120_000)
    observed_at: str = Field(min_length=10, max_length=64)


class ConnectivityCheckRequest(BaseModel):
    deployment_id: str = Field(min_length=8, max_length=80)
    ticket_id: str = Field(min_length=2, max_length=120)
    target_host: str = Field(min_length=1, max_length=253)
    target_port: int = Field(ge=1, le=65535)
    require_tls: bool = False


class ConnectivityCheckResult(BaseModel):
    check_id: str = Field(min_length=8, max_length=80)
    dns: Literal["healthy", "attention", "not_run"]
    tcp: Literal["healthy", "attention", "not_run"]
    tls: Literal["healthy", "attention", "not_run"]
    latency_ms: int | None = Field(default=None, ge=0, le=120_000)
    observed_at: str = Field(min_length=10, max_length=64)


class JumpAccessRequest(BaseModel):
    """A policy request only; Nexus Jump transport is not yet implemented."""
    deployment_id: str = Field(min_length=8, max_length=80)
    ticket_id: str = Field(min_length=2, max_length=120)
    target_host: str = Field(min_length=1, max_length=253)
    target_port: int = Field(ge=1, le=65535)
    protocol: Literal["https", "ssh", "rdp", "vnc", "winrm", "ipmi"]
    duration_minutes: int = Field(ge=5, le=240)
    reason: str = Field(min_length=8, max_length=800)


class JumpLabGatewayRegister(BaseModel):
    """Public metadata for an isolated Jump lab gateway, never transport secrets."""

    gateway_id: str = Field(min_length=3, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")
    display_name: str = Field(min_length=3, max_length=120)
    environment: Literal["lab"] = "lab"
    endpoint: str = Field(min_length=4, max_length=253)
    public_key: str = Field(min_length=32, max_length=128)
    allowed_resource_cidrs: list[str] = Field(min_length=1, max_length=32)
    allowed_protocols: list[Literal["https", "ssh", "rdp", "vnc", "winrm", "ipmi"]] = Field(min_length=1, max_length=6)
    maximum_session_minutes: int = Field(ge=5, le=240)
    approval_required: Literal[True] = True
    ticket_required: Literal[True] = True

    @model_validator(mode="after")
    def validate_lab_boundary(self):
        endpoint = JUMP_ENDPOINT_RE.match(self.endpoint)
        if not endpoint or int(endpoint.group(1)) > 65535:
            raise ValueError("endpoint must be a hostname or bracketed IPv6 address with an explicit port")
        if self.public_key.startswith("REPLACE_"):
            raise ValueError("public_key must contain the gateway public key, not a placeholder")
        for cidr in self.allowed_resource_cidrs:
            try:
                network = ipaddress.ip_network(cidr, strict=True)
            except ValueError as exc:
                raise ValueError(f"{cidr!r} is not a valid CIDR") from exc
            if not network.is_private or network.prefixlen == 0:
                raise ValueError(f"{cidr} is not an allowed private, least-privilege resource subnet")
        return self


class DeploymentHeartbeat(BaseModel):
    deployment_id: str
    instance_id: str = Field(min_length=3, max_length=160)
    version: str = Field(default="0.1.0", max_length=80)
    agent_count: int = Field(default=0, ge=0, le=1_000_000)
    relay_status: Literal["not_enabled", "healthy", "attention", "offline"] = "not_enabled"
    services: dict[str, str] = Field(default_factory=dict)
    attestation: dict[str, Literal["verified", "attention", "not_reported", "not_supported"]] = Field(default_factory=dict)
    site_pulse: EdgeSitePulse | None = None
    connectivity_results: list[ConnectivityCheckResult] = Field(default_factory=list, max_length=8)
    jump_transport: dict[str, Literal["not_configured", "configured_no_session", "ready", "attention", "not_supported"]] = Field(default_factory=dict)


class DeploymentBundleRequest(BaseModel):
    """Optional client-held activation code used to build the first bundle.

    The server only stores its hash. Supplying the code lets a newly prepared
    deployment receive a matching bundle without making the secret recoverable.
    """
    activation_code: str | None = Field(default=None, min_length=20, max_length=200)


def _bundle_files(deployment: dict, activation_code: str) -> dict[str, str]:
    deployment_id = deployment["id"]
    public_url = deployment.get("public_url") or "https://nexus.example.com"
    core_compose = """services:\n  mongo:\n    image: mongo:7.0\n    restart: unless-stopped\n    environment:\n      MONGO_INITDB_ROOT_USERNAME: ${MONGO_USERNAME:?Set MONGO_USERNAME}\n      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD:?Set MONGO_PASSWORD}\n    volumes:\n      - nexus-mongo:/data/db\n\n  api:\n    image: ${NEXUS_API_IMAGE:?Set your signed Nexus API image}\n    restart: unless-stopped\n    environment: &nexus-env\n      APP_ENV: production\n      MONGO_URL: mongodb://${MONGO_USERNAME}:${MONGO_PASSWORD}@mongo:27017/nexusmsp?authSource=admin\n      DB_NAME: nexusmsp\n      JWT_SECRET: ${JWT_SECRET:?Set JWT_SECRET}\n      NEXUS_SECRET_ENCRYPTION_KEY: ${NEXUS_SECRET_ENCRYPTION_KEY:?Set NEXUS_SECRET_ENCRYPTION_KEY}\n      CORS_ORIGINS: ${CORS_ORIGINS:?Set CORS_ORIGINS}\n      NEXUS_RUN_BACKGROUND_WORKERS: \"false\"\n    depends_on: [mongo]\n    volumes:\n      - nexus-uploads:/app/uploads\n      - nexus-installers:/app/data/agent-installers\n\n  worker:\n    image: ${NEXUS_API_IMAGE:?Set your signed Nexus API image}\n    command: [\"python\", \"worker.py\"]\n    restart: unless-stopped\n    environment:\n      <<: *nexus-env\n      NEXUS_RUN_BACKGROUND_WORKERS: \"true\"\n    depends_on: [mongo]\n    volumes:\n      - nexus-uploads:/app/uploads\n      - nexus-installers:/app/data/agent-installers\n\n  web:\n    image: ${NEXUS_WEB_IMAGE:?Set your signed Nexus web image}\n    restart: unless-stopped\n    ports:\n      - \"${NEXUS_HTTP_PORT:-8080}:8080\"\n    depends_on: [api]\n\nvolumes:\n  nexus-mongo:\n  nexus-uploads:\n  nexus-installers:\n"""
    edge_compose = """services:\n  nexus-edge:\n    image: ${NEXUS_EDGE_IMAGE:?Set your signed Nexus Edge image}\n    restart: unless-stopped\n    env_file: .env\n    volumes:\n      - nexus-edge-data:/var/lib/nexus-edge\nvolumes:\n  nexus-edge-data:\n"""
    relay_compose = """services:\n  hbbs:\n    image: rustdesk/rustdesk-server:latest\n    command: hbbs -r ${RELAY_PUBLIC_HOST}:21117\n    restart: unless-stopped\n    volumes:\n      - rustdesk-data:/root\n    ports:\n      - \"21115:21115/tcp\"\n      - \"21116:21116/tcp\"\n      - \"21116:21116/udp\"\n      - \"21118:21118/tcp\"\n  hbbr:\n    image: rustdesk/rustdesk-server:latest\n    command: hbbr\n    restart: unless-stopped\n    volumes:\n      - rustdesk-data:/root\n    ports:\n      - \"21117:21117/tcp\"\n      - \"21119:21119/tcp\"\nvolumes:\n  rustdesk-data:\n"""
    backup_vault_compose = """services:\n  minio:\n    image: minio/minio:latest\n    command: server /data --console-address \":9001\"\n    restart: unless-stopped\n    environment:\n      MINIO_ROOT_USER: ${MINIO_ROOT_USER:?Set MINIO_ROOT_USER}\n      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?Set a long MINIO_ROOT_PASSWORD}\n      MINIO_SERVER_URL: ${VAULT_PUBLIC_URL:?Set VAULT_PUBLIC_URL}\n    ports:\n      - \"${VAULT_S3_PORT:-9000}:9000\"\n      - \"${VAULT_CONSOLE_PORT:-9001}:9001\"\n    volumes:\n      - nexus-vault-data:/data\n\n  kopia-server:\n    image: kopia/kopia:latest\n    command: server start --address=0.0.0.0:51515 --tls-cert-file=/app/config/tls/server.crt --tls-key-file=/app/config/tls/server.key --server-username=${KOPIA_SERVER_USERNAME:?Set KOPIA_SERVER_USERNAME} --server-password=${KOPIA_SERVER_PASSWORD:?Set a long KOPIA_SERVER_PASSWORD} --server-control-password=${KOPIA_SERVER_CONTROL_PASSWORD:?Set a long KOPIA_SERVER_CONTROL_PASSWORD}\n    restart: unless-stopped\n    depends_on: [minio]\n    ports:\n      - \"${KOPIA_BIND_HOST:-127.0.0.1}:${KOPIA_PORT:-51515}:51515\"\n    volumes:\n      - nexus-kopia-config:/app/config\n      - nexus-kopia-cache:/app/cache\n      - ./kopia-tls:/app/config/tls:ro\n\nvolumes:\n  nexus-vault-data:\n  nexus-kopia-config:\n  nexus-kopia-cache:\n"""
    compose = {"core": core_compose, "edge": edge_compose, "backup_vault": backup_vault_compose, "remote_relay": relay_compose}[deployment["kind"]]
    env_lines = [
        f"NEXUS_CONTROL_PLANE_URL={public_url.rstrip('/')}",
        f"NEXUS_DEPLOYMENT_ID={deployment_id}",
        f"NEXUS_ACTIVATION_CODE={activation_code}",
    ]
    if deployment["kind"] == "core":
        env_lines += ["NEXUS_API_IMAGE=ghcr.io/your-org/nexus-api:replace-before-production", "NEXUS_WEB_IMAGE=ghcr.io/your-org/nexus-web:replace-before-production", "NEXUS_HTTP_PORT=8080", "MONGO_USERNAME=nexus", "MONGO_PASSWORD=replace-with-a-long-url-safe-secret", "JWT_SECRET=replace-with-a-unique-long-secret", "NEXUS_SECRET_ENCRYPTION_KEY=replace-with-a-unique-encryption-key", f"CORS_ORIGINS={public_url.rstrip('/')}"]
    elif deployment["kind"] == "edge":
        role_plan = deployment.get("edge_role_plan") or {}
        required = role_plan.get("requirements") or {}
        env_lines += [
            "NEXUS_EDGE_IMAGE=ghcr.io/your-org/nexus-edge:replace-before-production",
            f"NEXUS_EDGE_ROLES={','.join(deployment.get('edge_roles') or [])}",
            f"NEXUS_EDGE_PLANNED_CPU_CORES={required.get('cpu_cores', 0)}",
            f"NEXUS_EDGE_PLANNED_MEMORY_GB={required.get('memory_gb', 0)}",
            f"NEXUS_EDGE_PLANNED_STORAGE_GB={required.get('storage_gb', 0)}",
        ]
        if "jump_gateway" in (deployment.get("edge_roles") or []):
            env_lines += [
                "# Nexus Jump remains disabled until a reviewed transport controller is configured.",
                "NEXUS_JUMP_TRANSPORT=disabled",
                "NEXUS_JUMP_INTERFACE=nexus-jump0",
                "NEXUS_JUMP_GATEWAY_ENDPOINT=",
                "NEXUS_JUMP_GATEWAY_PUBLIC_KEY=",
            ]
    elif deployment["kind"] == "backup_vault":
        env_lines += ["VAULT_PUBLIC_URL=https://vault.example.com", "VAULT_S3_PORT=9000", "VAULT_CONSOLE_PORT=9001", "KOPIA_BIND_HOST=127.0.0.1", "KOPIA_PORT=51515", "MINIO_ROOT_USER=nexus-vault-admin", "MINIO_ROOT_PASSWORD=replace-with-a-long-unique-secret", "KOPIA_SERVER_USERNAME=nexus-vault", "KOPIA_SERVER_PASSWORD=replace-with-a-long-unique-secret", "KOPIA_SERVER_CONTROL_PASSWORD=replace-with-a-separate-long-unique-secret"]
    else:
        env_lines += ["RELAY_PUBLIC_HOST=relay.example.com"]
    env = "\n".join(env_lines + [""])
    readme = f"""Nexus Deployment Hub bundle\n\nDeployment: {deployment['name']}\nKind: {deployment['kind']}\n\n1. Review .env and replace every example hostname/image before starting.\n2. Run: docker compose up -d\n3. The deployment exchanges its one-time activation code with Nexus.\n4. Return to Nexus Deployment Hub and wait for a verified heartbeat.\n5. For Nexus Edge, remove NEXUS_ACTIVATION_CODE from .env after the first\n   heartbeat, then restart the container. Its persistent identity remains.\n\nSecurity boundary\n- This code expires after 24 hours and may be used once.\n- Do not commit .env to source control or send it through email/chat.\n- A deployment is never considered online or billable until a verified heartbeat is recorded.\n"""
    bootstrap_sh = """#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Nexus bootstrap needs Docker Engine and Docker Compose v2 on this host." >&2
  echo "Install and approve Docker first, then run this script again." >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo "Missing .env. Extract the complete Nexus bundle before running bootstrap." >&2
  exit 1
fi
echo "[Nexus] Pulling approved deployment images..."
docker compose pull
echo "[Nexus] Starting services..."
docker compose up -d --remove-orphans
echo "[Nexus] Service status:"
docker compose ps
echo "[Nexus] Bootstrap complete. Return to Deployment Hub for the authenticated heartbeat."
"""
    bootstrap_ps1 = """$ErrorActionPreference = 'Stop'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Nexus bootstrap needs Docker Engine and Docker Compose v2 on this host. Install and approve Docker, then run this script again.'
}
& docker compose version | Out-Null
if (-not (Test-Path '.env')) { throw 'Missing .env. Extract the complete Nexus bundle before running bootstrap.' }
Write-Host '[Nexus] Pulling approved deployment images...'
& docker compose pull
Write-Host '[Nexus] Starting services...'
& docker compose up -d --remove-orphans
Write-Host '[Nexus] Service status:'
& docker compose ps
Write-Host '[Nexus] Bootstrap complete. Return to Deployment Hub for the authenticated heartbeat.'
"""
    files = {"docker-compose.yml": compose, ".env": env, "README.txt": readme, "bootstrap.sh": bootstrap_sh, "bootstrap.ps1": bootstrap_ps1}
    if deployment["kind"] == "edge" and "jump_gateway" in (deployment.get("edge_roles") or []):
        files["nexus-jump/README.md"] = """# Nexus Jump transport prerequisites

This bundle does **not** enable a WireGuard tunnel or create a customer VPN.
Nexus Jump requires a separately reviewed controller that can issue and revoke
short-lived, ticket-scoped peer configuration.

Before enabling transport through the approved Nexus secret/configuration path,
provide a dedicated gateway endpoint, gateway public key, per-resource route
policy, maximum session duration, tested revocation, customer approval and a
local kill-switch policy. Never place Edge private keys in tickets, chat or
source control.

`NEXUS_JUMP_TRANSPORT=disabled` is the safe default. Setting it to `wireguard`
only enables local readiness evidence; it never creates an interface, peer,
route or session by itself.
"""
    if deployment["kind"] == "backup_vault":
        files["kopia-tls/README.txt"] = "Place the PEM-encoded TLS certificate here as server.crt and its private key as server.key before running bootstrap. This directory is mounted read-only. Keep the Kopia service bound to localhost unless an approved reverse proxy or VPN is configured.\\n"
    return files


@router.get("/deployment-hub/overview")
async def deployment_overview(user=Depends(_require_deployment_admin)):
    query = scoped_query(_deployment_scope_user(user), {})
    deployments = await db.nexus_deployments.find(query, {"_id": 0, "activation_code_hash": 0, "edge_token_hash": 0}).sort("created_at", -1).to_list(300)
    now = datetime.now(timezone.utc)
    for item in deployments:
        last = _timestamp(item.get("last_seen_at"))
        age = (now - last).total_seconds() if last else None
        item["online"] = age is not None and age <= ONLINE_WINDOW_SECONDS
        item["heartbeat_age_seconds"] = int(age) if age is not None else None
        activation_expires = _timestamp(item.get("activation_expires_at"))
        item["activation_expired"] = bool(
            not item.get("activation_used_at")
            and activation_expires is not None
            and activation_expires <= now
        )
    return {
        "deployments": deployments,
        "summary": {
            "total": len(deployments),
            "online": sum(1 for item in deployments if item["online"]),
            "activation_attention": sum(1 for item in deployments if item["activation_expired"]),
            "edge": sum(1 for item in deployments if item.get("kind") == "edge"),
            "backup_vault": sum(1 for item in deployments if item.get("kind") == "backup_vault"),
            "partner_msp": len({item.get("channel_tenant_id") for item in deployments if item.get("channel_tenant_id")}),
            "relay": sum(1 for item in deployments if item.get("kind") == "remote_relay"),
            "metered_agents": sum(int((item.get("metering") or {}).get("agent_count") or 0) for item in deployments),
        },
        "online_window_seconds": ONLINE_WINDOW_SECONDS,
    }


@router.get("/deployment-hub/jump-lab-gateways")
async def list_jump_lab_gateways(user=Depends(_require_deployment_admin)):
    """Return public, lab-only gateway policy records—never tunnel material."""
    gateways = await db.nexus_jump_lab_gateways.find(
        {}, {"_id": 0, "private_key": 0, "transport_secret": 0}
    ).sort("created_at", -1).to_list(100)
    return {"gateways": gateways}


@router.post("/deployment-hub/jump-lab-gateways")
async def register_jump_lab_gateway(payload: JumpLabGatewayRegister, user=Depends(_require_deployment_admin)):
    """Register a reviewed lab boundary without configuring any transport."""
    existing = await db.nexus_jump_lab_gateways.find_one({"gateway_id": payload.gateway_id}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="A Nexus Jump lab gateway already uses this gateway ID")
    now = _now()
    gateway = {
        "id": str(uuid.uuid4()),
        **payload.model_dump(),
        "status": "lab_pending_transport",
        "created_at": now,
        "created_by": user.get("email") or user.get("id") or "Nexus administrator",
        "transport_attested_at": None,
        "last_session_at": None,
    }
    await db.nexus_jump_lab_gateways.insert_one(dict(gateway))
    await log_activity(
        user,
        "nexus_jump_lab_gateway_registered",
        "deployment",
        gateway["id"],
        gateway["display_name"],
        "Registered Nexus Jump lab gateway public policy metadata; no transport was configured.",
        metadata={
            "gateway_id": gateway["gateway_id"],
            "endpoint": gateway["endpoint"],
            "allowed_resource_cidrs": gateway["allowed_resource_cidrs"],
            "allowed_protocols": gateway["allowed_protocols"],
        },
    )
    return {
        "gateway": gateway,
        "message": "Lab gateway policy registered. No tunnel, proxy, private key or active session was created.",
    }


@router.post("/deployment-hub/deployments")
async def create_deployment(payload: DeploymentCreate, request: Request, user=Depends(_require_deployment_admin)):
    if payload.owner_type == "msp_partner" and not payload.channel_tenant_id:
        raise HTTPException(status_code=422, detail="Choose the MSP partner that owns this deployment")
    if payload.owner_type == "nexus" and payload.kind in {"edge", "backup_vault", "remote_relay"} and not payload.client_id:
        raise HTTPException(status_code=422, detail="Choose a client for an Edge, Backup Vault or Remote Relay deployment")
    edge_roles = list(dict.fromkeys(payload.edge_roles))
    if payload.kind != "edge" and edge_roles:
        raise HTTPException(status_code=422, detail="Nexus OS roles can only be assigned to a Nexus Edge deployment")
    if any(role not in EDGE_ROLE_IDS for role in edge_roles):
        raise HTTPException(status_code=422, detail="One or more Nexus OS roles are not recognised")
    if payload.kind != "edge" and payload.edge_resources:
        raise HTTPException(status_code=422, detail="Appliance capacity can only be supplied for a Nexus Edge deployment")
    role_plan = _edge_role_plan(edge_roles, payload.edge_resources) if payload.kind == "edge" else None
    if role_plan and role_plan["gaps"]:
        raise HTTPException(
            status_code=422,
            detail="Selected Nexus OS roles exceed the appliance plan: " + "; ".join(role_plan["gaps"]),
        )
    client_name = payload.client_name or ""
    channel_tenant_name = payload.channel_tenant_name or ""
    if payload.owner_type == "msp_partner":
        tenant = await db.channel_tenants.find_one({"tenant_id": payload.channel_tenant_id}, {"_id": 0, "tenant_id": 1, "name": 1, "status": 1})
        if not tenant:
            raise HTTPException(status_code=404, detail="MSP partner was not found")
        if tenant.get("status") not in {"active", "provisioning"}:
            raise HTTPException(status_code=409, detail="This MSP partner is not eligible for new deployments")
        channel_tenant_name = tenant.get("name") or channel_tenant_name
    if payload.client_id:
        await assert_client_scope(_deployment_scope_user(user), payload.client_id, operation="deployment.create")
        client = await db.clients.find_one({"id": payload.client_id}, {"_id": 0, "name": 1})
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        client_name = client.get("name") or client_name
    activation_code = f"nxact_{secrets.token_urlsafe(32)}"
    now = _now()
    deployment = {
        "id": str(uuid.uuid4()), "kind": payload.kind, "name": payload.name.strip(),
        "owner_type": payload.owner_type, "channel_tenant_id": payload.channel_tenant_id if payload.owner_type == "msp_partner" else None,
        "channel_tenant_name": channel_tenant_name or None,
        "client_id": payload.client_id if payload.owner_type == "nexus" else None, "client_name": client_name or None,
        "public_url": str(payload.public_url or "").strip() or None,
        "notes": str(payload.notes or "").strip(), "edge_roles": edge_roles, "edge_role_plan": role_plan, "status": "prepared",
        "activation_code_hash": _hash(activation_code),
        "activation_expires_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
        "activation_used_at": None, "edge_token_hash": None, "instance_id": None,
        "hostname": None, "version": None, "last_seen_at": None,
        "metering": {"agent_count": 0, "relay_status": "not_enabled"},
        "requirements": _deployment_requirements(payload.kind, payload.owner_type) + ([{
            "id": "role_capacity", "label": "Nexus OS role capacity", "detail": "The selected Edge roles were checked against the operator-declared appliance CPU, memory, persistent storage and LAN visibility.", "required": True,
        }] if role_plan and edge_roles else []),
        "created_at": now, "created_by": user.get("email") or user.get("id"),
    }
    await db.nexus_deployments.insert_one(dict(deployment))
    if deployment["owner_type"] == "msp_partner" and deployment["kind"] == "core":
        await db.channel_tenants.update_one(
            {"tenant_id": deployment["channel_tenant_id"]},
            {"$set": {"platform": {
                "core_deployment_id": deployment["id"],
                "core_status": "prepared",
                "core_last_seen_at": None,
                "core_public_url": deployment["public_url"],
                "updated_at": now,
            }}},
        )
    await log_activity(user, "deployment_prepared", "deployment", deployment["id"], deployment["name"], f"Prepared Nexus {payload.kind.replace('_', ' ')} deployment", metadata={"client_id": payload.client_id, "channel_tenant_id": deployment["channel_tenant_id"], "owner_type": payload.owner_type, "kind": payload.kind})
    return {"deployment": {key: value for key, value in deployment.items() if key not in {"activation_code_hash", "edge_token_hash"}}, "activation_code": activation_code, "bundle_url": f"{str(request.base_url).rstrip('/')}/api/deployment-hub/deployments/{deployment['id']}/bundle"}


@router.get("/deployment-hub/deployments/{deployment_id}/bundle")
async def download_deployment_bundle(deployment_id: str, user=Depends(_require_deployment_admin)):
    deployment = await db.nexus_deployments.find_one(scoped_query(_deployment_scope_user(user), {"id": deployment_id}), {"_id": 0})
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")
    # The code cannot be recovered after preparation. Generate a fresh activation
    # instead of ever storing a usable secret at rest.
    raise HTTPException(status_code=409, detail="Generate a fresh deployment bundle to receive a new one-time activation code")


@router.post("/deployment-hub/deployments/{deployment_id}/bundle")
async def regenerate_deployment_bundle(deployment_id: str, payload: DeploymentBundleRequest | None = None, user=Depends(_require_deployment_admin)):
    deployment = await db.nexus_deployments.find_one(scoped_query(_deployment_scope_user(user), {"id": deployment_id}), {"_id": 0})
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")
    if deployment.get("activation_used_at"):
        raise HTTPException(status_code=409, detail="This deployment is already activated; rotate its Edge identity from the deployment record instead")
    activation_code = str(payload.activation_code or "") if payload else ""
    if activation_code:
        try:
            expired = datetime.fromisoformat(str(deployment.get("activation_expires_at")).replace("Z", "+00:00")) <= datetime.now(timezone.utc)
        except (TypeError, ValueError):
            expired = True
        if expired or not secrets.compare_digest(str(deployment.get("activation_code_hash") or ""), _hash(activation_code)):
            raise HTTPException(status_code=401, detail="The activation code is invalid or expired. Generate a fresh bundle instead.")
    else:
        activation_code = f"nxact_{secrets.token_urlsafe(32)}"
        await db.nexus_deployments.update_one({"id": deployment_id}, {"$set": {"activation_code_hash": _hash(activation_code), "activation_expires_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(), "status": "prepared"}})
    files = _bundle_files(deployment, activation_code)
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, content in files.items(): archive.writestr(path, content)
    return Response(content=data.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="nexus-{deployment["kind"]}-{deployment_id[:8]}.zip"'})


@router.post("/deployment-hub/activate")
async def activate_deployment(payload: DeploymentActivate):
    deployment = await db.nexus_deployments.find_one({"id": payload.deployment_id}, {"_id": 0})
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")
    if deployment.get("activation_used_at"):
        raise HTTPException(status_code=409, detail="Deployment activation code has already been used")
    try:
        expired = datetime.fromisoformat(str(deployment.get("activation_expires_at")).replace("Z", "+00:00")) <= datetime.now(timezone.utc)
    except (TypeError, ValueError):
        expired = True
    if expired or not secrets.compare_digest(str(deployment.get("activation_code_hash") or ""), _hash(payload.activation_code)):
        raise HTTPException(status_code=401, detail="Deployment activation code is invalid or expired")
    edge_token = f"nxedge_{secrets.token_urlsafe(40)}"
    now = _now()
    await db.nexus_deployments.update_one({"id": deployment["id"]}, {"$set": {"status": "activated", "activation_used_at": now, "edge_token_hash": _hash(edge_token), "instance_id": payload.instance_id, "hostname": payload.hostname, "version": payload.version, "last_seen_at": now}})
    if deployment.get("owner_type") == "msp_partner" and deployment.get("kind") == "core":
        await db.channel_tenants.update_one(
            {"tenant_id": deployment.get("channel_tenant_id")},
            {"$set": {"platform.core_status": "activated", "platform.core_last_seen_at": now, "platform.updated_at": now}},
        )
    return {"deployment_id": deployment["id"], "edge_token": edge_token, "heartbeat_interval_seconds": 60, "heartbeat_url": "/api/deployment-hub/heartbeat", "message": "Activation accepted. Store the Edge token in the target secret store; it is not recoverable."}


@router.post("/deployment-hub/connectivity-checks")
async def request_connectivity_check(payload: ConnectivityCheckRequest, user=Depends(get_current_user)):
    """Queue one bounded, ticket-scoped diagnostic for an eligible Nexus Edge."""
    deployment = await db.nexus_deployments.find_one(scoped_query(_deployment_scope_user(user), {"id": payload.deployment_id}), {"_id": 0})
    if not deployment or deployment.get("kind") != "edge":
        raise HTTPException(status_code=404, detail="Eligible Nexus Edge deployment was not found")
    if "network_monitor" not in (deployment.get("edge_roles") or []):
        raise HTTPException(status_code=409, detail="This Edge needs the declared Network monitor role before it can run a connectivity verification")
    if not deployment.get("activation_used_at"):
        raise HTTPException(status_code=409, detail="Activate this Edge before requesting a connectivity verification")
    ticket = await db.tickets.find_one({"id": payload.ticket_id}, {"_id": 0, "id": 1, "client_id": 1, "title": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket was not found")
    await assert_client_scope(_deployment_scope_user(user), ticket.get("client_id"), operation="deployment.connectivity_check.create")
    if not deployment.get("client_id") or ticket.get("client_id") != deployment.get("client_id"):
        raise HTTPException(status_code=409, detail="The ticket and Nexus Edge must belong to the same customer")
    target_host = _safe_connectivity_target(payload.target_host)
    now = _now()
    check = {
        "id": str(uuid.uuid4()), "deployment_id": deployment["id"], "client_id": deployment["client_id"],
        "ticket_id": ticket["id"], "ticket_title": ticket.get("title") or "Ticket",
        "target_host": target_host, "target_port": payload.target_port, "require_tls": payload.require_tls,
        "status": "queued", "requested_at": now, "requested_by": user.get("email") or user.get("id"),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
    }
    await db.nexus_edge_connectivity_checks.insert_one(dict(check))
    await log_activity(user, "edge_connectivity_check_requested", "ticket", ticket["id"], ticket.get("title") or ticket["id"], f"Requested Edge connectivity verification for {target_host}:{payload.target_port}", metadata={"deployment_id": deployment["id"], "target_host": target_host, "target_port": payload.target_port, "require_tls": payload.require_tls})
    return {"check": check, "message": "The check is queued for the customer Edge. It expires after 15 minutes and does not create network access."}


@router.get("/deployment-hub/connectivity-edges/{ticket_id}")
async def get_connectivity_edges(ticket_id: str, user=Depends(get_current_user)):
    """Expose only eligible Edges for one ticket's customer to its scoped operator."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "client_id": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket was not found")
    await assert_client_scope(_deployment_scope_user(user), ticket.get("client_id"), operation="deployment.connectivity_edge.read")
    edges = await db.nexus_deployments.find(
        scoped_query(_deployment_scope_user(user), {"kind": "edge", "client_id": ticket.get("client_id")}),
        {"_id": 0, "id": 1, "kind": 1, "client_id": 1, "name": 1, "hostname": 1, "activation_used_at": 1, "edge_roles": 1, "last_seen_at": 1},
    ).to_list(50)
    return {"edges": edges}


@router.get("/deployment-hub/jump-edges/{ticket_id}")
async def get_jump_edges(ticket_id: str, user=Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "client_id": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket was not found")
    await assert_client_scope(_deployment_scope_user(user), ticket.get("client_id"), operation="deployment.jump_edge.read")
    edges = await db.nexus_deployments.find(
        scoped_query(_deployment_scope_user(user), {"kind": "edge", "client_id": ticket.get("client_id"), "edge_roles": "jump_gateway"}),
        {"_id": 0, "id": 1, "name": 1, "hostname": 1, "activation_used_at": 1, "last_seen_at": 1, "jump_transport": 1},
    ).to_list(50)
    return {"edges": edges}


@router.get("/deployment-hub/connectivity-checks/{ticket_id}")
async def get_connectivity_checks(ticket_id: str, user=Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "client_id": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket was not found")
    await assert_client_scope(_deployment_scope_user(user), ticket.get("client_id"), operation="deployment.connectivity_check.read")
    checks = await db.nexus_edge_connectivity_checks.find({"ticket_id": ticket_id}, {"_id": 0}).sort("requested_at", -1).to_list(30)
    return {"checks": checks}


@router.get("/deployment-hub/jump-access-requests/{ticket_id}")
async def get_jump_access_requests(ticket_id: str, user=Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "client_id": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket was not found")
    await assert_client_scope(_deployment_scope_user(user), ticket.get("client_id"), operation="deployment.jump_access.read")
    await _expire_jump_access_requests({"ticket_id": ticket_id})
    requests = await db.nexus_jump_access_requests.find({"ticket_id": ticket_id}, {"_id": 0}).sort("requested_at", -1).to_list(30)
    return {"requests": requests}


@router.post("/deployment-hub/jump-access-requests")
async def request_jump_access(payload: JumpAccessRequest, user=Depends(get_current_user)):
    """Create a bounded, auditable Nexus Jump policy request.

    This route intentionally does not issue a credential, proxy URL, tunnel or
    firewall rule. That only becomes possible once the separately reviewed
    Nexus Jump transport enforces the same scope at the Edge boundary.
    """
    deployment = await db.nexus_deployments.find_one(scoped_query(_deployment_scope_user(user), {"id": payload.deployment_id}), {"_id": 0})
    if not deployment or deployment.get("kind") != "edge":
        raise HTTPException(status_code=404, detail="Eligible Nexus Edge deployment was not found")
    if "jump_gateway" not in (deployment.get("edge_roles") or []):
        raise HTTPException(status_code=409, detail="This Edge needs the declared Nexus Jump gateway role before access can be requested")
    if not deployment.get("activation_used_at"):
        raise HTTPException(status_code=409, detail="Activate this Edge before requesting Nexus Jump access")
    ticket = await db.tickets.find_one({"id": payload.ticket_id}, {"_id": 0, "id": 1, "client_id": 1, "title": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket was not found")
    await assert_client_scope(_deployment_scope_user(user), ticket.get("client_id"), operation="deployment.jump_access.create")
    if not deployment.get("client_id") or ticket.get("client_id") != deployment.get("client_id"):
        raise HTTPException(status_code=409, detail="The ticket and Nexus Edge must belong to the same customer")
    target_host = _safe_connectivity_target(payload.target_host)
    now = _now()
    request = {
        "id": str(uuid.uuid4()), "deployment_id": deployment["id"], "client_id": deployment["client_id"],
        "ticket_id": ticket["id"], "ticket_title": ticket.get("title") or "Ticket",
        "target_host": target_host, "target_port": payload.target_port, "protocol": payload.protocol,
        "duration_minutes": payload.duration_minutes, "reason": payload.reason.strip(),
        "status": "awaiting_transport", "requested_at": now, "requested_by": user.get("email") or user.get("id"),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=payload.duration_minutes)).isoformat(),
        "transport": "not_configured",
    }
    await db.nexus_jump_access_requests.insert_one(dict(request))
    await log_activity(user, "nexus_jump_access_requested", "ticket", ticket["id"], ticket.get("title") or ticket["id"], f"Requested Nexus Jump scope for {payload.protocol} {target_host}:{payload.target_port}", metadata={"deployment_id": deployment["id"], "target_host": target_host, "target_port": payload.target_port, "protocol": payload.protocol, "duration_minutes": payload.duration_minutes})
    return {"request": request, "message": "Nexus recorded the ticket-bound access scope. No tunnel, proxy or credential was created because Nexus Jump transport is not configured."}


@router.post("/deployment-hub/jump-access-requests/{request_id}/revoke")
async def revoke_jump_access_request(request_id: str, user=Depends(get_current_user)):
    """Revoke an unfulfilled Jump scope now; future transport must honour this state."""
    request = await db.nexus_jump_access_requests.find_one({"id": request_id}, {"_id": 0})
    if not request:
        raise HTTPException(status_code=404, detail="Nexus Jump access scope was not found")
    await assert_client_scope(_deployment_scope_user(user), request.get("client_id"), operation="deployment.jump_access.revoke")
    await _expire_jump_access_requests({"id": request_id})
    request = await db.nexus_jump_access_requests.find_one({"id": request_id}, {"_id": 0})
    if request.get("status") == "revoked":
        return {"request": request, "message": "Nexus Jump scope was already revoked"}
    if request.get("status") == "expired":
        return {"request": request, "message": "Nexus Jump scope had already expired"}
    if request.get("status") != "awaiting_transport":
        raise HTTPException(status_code=409, detail="This Nexus Jump scope cannot be revoked from its current state")
    now = _now()
    await db.nexus_jump_access_requests.update_one(
        {"id": request_id, "status": "awaiting_transport"},
        {"$set": {"status": "revoked", "revoked_at": now, "revoked_by": user.get("email") or user.get("id")}},
    )
    request["status"] = "revoked"
    request["revoked_at"] = now
    await log_activity(user, "nexus_jump_access_revoked", "ticket", request["ticket_id"], request.get("ticket_title") or request["ticket_id"], f"Revoked Nexus Jump scope for {request['protocol']} {request['target_host']}:{request['target_port']}", metadata={"request_id": request_id, "deployment_id": request["deployment_id"], "target_host": request["target_host"], "target_port": request["target_port"], "protocol": request["protocol"]})
    return {"request": request, "message": "Nexus Jump scope revoked. No active transport session existed."}


@router.post("/deployment-hub/heartbeat")
async def deployment_heartbeat(payload: DeploymentHeartbeat, x_nexus_edge_token: str | None = Header(None)):
    deployment = await db.nexus_deployments.find_one({"id": payload.deployment_id}, {"_id": 0})
    if not deployment or not x_nexus_edge_token or not deployment.get("edge_token_hash") or not secrets.compare_digest(str(deployment["edge_token_hash"]), _hash(x_nexus_edge_token)):
        raise HTTPException(status_code=401, detail="Deployment identity is not valid")
    if deployment.get("instance_id") != payload.instance_id:
        raise HTTPException(status_code=409, detail="Deployment instance identity does not match")
    if payload.site_pulse and deployment.get("kind") != "edge":
        raise HTTPException(status_code=422, detail="A Nexus Site Pulse may only be reported by a Nexus Edge deployment")
    if payload.jump_transport and deployment.get("kind") != "edge":
        raise HTTPException(status_code=422, detail="Nexus Jump transport evidence may only be reported by a Nexus Edge deployment")
    now = _now()
    # Metering is derived from Nexus' authoritative agent registry when the
    # deployment belongs to a client.  A relay cannot inflate its billable
    # quantity by merely reporting a larger number in a heartbeat payload.
    registered_agents = payload.agent_count
    if deployment.get("client_id"):
        registered_agents = await db.nexus_agents.count_documents({"client_id": deployment["client_id"], "is_active": True})
    update = {
        "status": "online", "last_seen_at": now, "version": payload.version,
        "metering": {"agent_count": registered_agents, "reported_agent_count": payload.agent_count, "relay_status": payload.relay_status, "services": payload.services, "reported_at": now},
        "attestation": payload.attestation, "attestation_reported_at": now,
    }
    if payload.site_pulse:
        # This remains evidence of the Edge's path to Nexus only.  It is not a
        # synthetic business-service check and must not be rendered as one.
        update["site_pulse"] = payload.site_pulse.model_dump()
    if payload.jump_transport:
        update["jump_transport"] = payload.jump_transport
        update["jump_transport_reported_at"] = now
    await db.nexus_deployments.update_one({"id": deployment["id"]}, {"$set": update})
    for result in payload.connectivity_results:
        await db.nexus_edge_connectivity_checks.update_one(
            {"id": result.check_id, "deployment_id": deployment["id"], "status": {"$in": ["queued", "dispatched"]}},
            {"$set": {"status": "completed", "result": result.model_dump(), "completed_at": now}},
        )
    await db.nexus_edge_connectivity_checks.update_many(
        {"deployment_id": deployment["id"], "status": {"$in": ["queued", "dispatched"]}, "expires_at": {"$lte": now}},
        {"$set": {"status": "expired", "expired_at": now}},
    )
    checks = await db.nexus_edge_connectivity_checks.find(
        {"deployment_id": deployment["id"], "status": {"$in": ["queued", "dispatched"]}, "expires_at": {"$gt": now}},
        {"_id": 0, "id": 1, "target_host": 1, "target_port": 1, "require_tls": 1, "ticket_id": 1, "expires_at": 1},
    ).sort("requested_at", 1).to_list(3)
    if checks:
        await db.nexus_edge_connectivity_checks.update_many({"id": {"$in": [item["id"] for item in checks]}}, {"$set": {"status": "dispatched", "last_dispatched_at": now}})
    if deployment.get("owner_type") == "msp_partner" and deployment.get("kind") == "core":
        await db.channel_tenants.update_one(
            {"tenant_id": deployment.get("channel_tenant_id")},
            {"$set": {"platform.core_status": "online", "platform.core_last_seen_at": now, "platform.updated_at": now}},
        )
    return {
        "ok": True, "next_heartbeat_seconds": 60, "server_time": now,
        "connectivity_checks": checks,
        "acknowledged_connectivity_results": [result.check_id for result in payload.connectivity_results],
    }
