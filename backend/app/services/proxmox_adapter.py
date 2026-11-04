"""Executing Proxmox VE adapter — the first executing provider behind Nexus.

``app.services.nexus_connector`` is the registry and translator: it resolves a
capability verb to a *plan* and never calls a vendor. This module is the other
half — it performs the provider call for real, verifies the outcome against
the provider's own task record, and fails closed when the provider is not
configured.

Honesty boundary (docs/NEXUS_PRODUCT_CONSTITUTION.md, Law 9):

- **No configured credential, no execution.** An unconfigured provider answers
  ``not_configured`` and never a success-shaped payload.
- **Nexus claims only what Nexus observed.** A mutation is ``verified`` only
  when the provider task finished OK *and* the guest's observed state matches
  the expectation recorded before the call. Anything else is ``inconclusive``
  or ``failed`` and both values are retained as evidence.
- **Credentials are decrypted for the request only.** They are never logged,
  returned, or written to an action or evidence record.
- Every mutation is expressed as a canonical action descriptor
  (``nexus_protocol.validate_action_descriptor``, P0 #1) before any network
  call is made.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx

from app.services.secret_store import decrypt_secret

PROVIDER = "proxmox"
CONNECTOR_IMPLEMENTATION = "app.services.proxmox_adapter"

DEFAULT_PORT = 8006
# Every Proxmox VE REST call lives under this prefix (docs/INTEGRATIONS/PROXMOX.md:
# ``https://{host}:{port}/api2/json/...``). The client's base URL is the host
# root, so the prefix belongs on each request path: without it the call lands on
# the Proxmox web UI instead of the API and every observation is a false failure.
API_ROOT = "/api2/json"
DEFAULT_TASK_TIMEOUT = 30.0
DEFAULT_POLL_INTERVAL = 0.5
REQUEST_TIMEOUT = 15.0

# The guest kinds Proxmox's REST paths accept.
GUEST_KINDS = frozenset({"qemu", "lxc"})


class ProxmoxAdapterError(Exception):
    """Base class for adapter failures. ``kind`` drives the HTTP mapping."""

    kind = "adapter_error"

    def __init__(self, detail: str, *, kind: str | None = None, evidence: dict | None = None):
        super().__init__(detail)
        self.detail = detail
        if kind:
            self.kind = kind
        self.evidence = evidence or {}


class ProxmoxNotConfigured(ProxmoxAdapterError):
    kind = "not_configured"


class ProxmoxBindingError(ProxmoxAdapterError):
    kind = "binding"


class ProxmoxProviderError(ProxmoxAdapterError):
    """The provider was reached but rejected or failed the call."""

    kind = "provider_error"


# ============== ACTION CONTRACT ==============
#
# Every power action Nexus can perform, with the honest safety facts the
# canonical action descriptor needs: whether it is destructive, what reverses
# it, and the state Nexus expects to observe afterwards. ``expected_status``
# of ``None`` means Nexus does not assert an end state for that action — the
# provider task record alone is the evidence, and the plan says so.

VM_ACTIONS: dict[str, dict[str, Any]] = {
    "start": {
        "destructive": False,
        "target_status": "running",
        "expected_status": "running",
        "rollback": "shutdown",
        "description": "Power on the guest",
    },
    "resume": {
        "destructive": False,
        "target_status": "running",
        "expected_status": "running",
        "rollback": "suspend",
        "description": "Resume a suspended guest",
    },
    "shutdown": {
        "destructive": True,
        "target_status": "stopped",
        "expected_status": "stopped",
        "rollback": "start",
        "description": "Gracefully shut the guest down",
    },
    "stop": {
        "destructive": True,
        "target_status": "stopped",
        "expected_status": "stopped",
        "rollback": "start",
        "description": "Force the guest to stop (risk of data loss on the guest)",
    },
    "reboot": {
        "destructive": True,
        "target_status": "running",
        "expected_status": "running",
        "rollback": "start",
        "description": "Restart the guest (service interruption)",
    },
    "reset": {
        "destructive": True,
        "target_status": "running",
        "expected_status": "running",
        "rollback": "start",
        "description": "Force-reset the guest (risk of data loss on the guest)",
    },
    "suspend": {
        "destructive": True,
        "target_status": "stopped",
        # Proxmox reports a suspended guest's state inconsistently across
        # versions, so Nexus records the observed state as evidence without
        # asserting an end state it has not proven.
        "expected_status": None,
        "rollback": "resume",
        "description": "Suspend the guest (workloads pause)",
    },
}


def action_spec(action: str) -> dict[str, Any] | None:
    """Return the safety contract for one power action, or None if unknown."""
    return VM_ACTIONS.get(str(action or "").strip().lower())


def guest_ref(guest: dict[str, Any]) -> dict[str, str]:
    """Resolve the Proxmox coordinates (node/vmid/kind) from a Nexus VM record.

    Raises ``ProxmoxBindingError`` rather than guessing: a record without a
    provider binding cannot be acted on, and inventing coordinates would be a
    claim Nexus cannot back.
    """
    node = str(guest.get("node") or guest.get("node_name") or "").strip()
    vmid = str(guest.get("vmid") or "").strip()
    raw_kind = str(guest.get("vm_type") or guest.get("type") or "qemu").strip().lower()
    kind = "lxc" if raw_kind in {"lxc", "container"} else "qemu" if raw_kind in {"qemu", "kvm", "vm"} else raw_kind
    missing = [
        name
        for name, value in (("node", node), ("vmid", vmid))
        if not value
    ]
    if kind not in GUEST_KINDS:
        missing.append("vm_type")
    if missing:
        raise ProxmoxBindingError(
            "This virtual machine record has no Proxmox resource binding "
            f"({', '.join(missing)}); Nexus will not invent a target. "
            "Re-sync the inventory from Infrastructure.",
            kind="binding",
        )
    return {"node": node, "vmid": vmid, "kind": kind}


# ============== CONNECTION ==============


@dataclass(frozen=True)
class ProxmoxConnection:
    """Decrypted, request-scoped connection settings. Never persisted back."""

    server_id: str
    name: str
    base_url: str
    token_header: str | None
    ssl_verify: bool
    client_id: str | None
    tenant_id: str | None

    @property
    def configured(self) -> bool:
        return bool(self.token_header)


def _normalise_base_url(host: str, port: int) -> str:
    value = str(host or "").strip().rstrip("/")
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://"):
        # A scheme-bearing host keeps its own port unless none is present.
        return value if "://" in value and value.split("://", 1)[1].find(":") != -1 else f"{value}:{port}"
    return f"https://{value}:{port}"


def load_connection(server_doc: dict[str, Any] | None) -> ProxmoxConnection | None:
    """Build a connection from a stored ``proxmox_servers`` document.

    Returns ``None`` when the document cannot produce a usable credential, so
    every caller fails closed. The token is decrypted in this function only
    and lives on the returned object for the duration of one request.
    """
    if not isinstance(server_doc, dict):
        return None
    host = str(server_doc.get("host") or "").strip()
    if not host:
        return None
    try:
        port = int(server_doc.get("port") or DEFAULT_PORT)
    except (TypeError, ValueError):
        port = DEFAULT_PORT

    raw_token = str(server_doc.get("token_value") or "")
    # Credentials written before the secret store existed are plaintext;
    # newer ones are Fernet tokens. decrypt_secret returns "" for anything it
    # cannot decrypt, which is the fallback signal for a legacy plaintext value.
    token_value = decrypt_secret(raw_token) or raw_token
    username = str(server_doc.get("username") or "").strip()
    token_name = str(server_doc.get("token_name") or "").strip()
    token_header = None
    if token_value and username and token_name and "@" in username:
        token_header = f"PVEAPIToken={username}!{token_name}={token_value}"

    return ProxmoxConnection(
        server_id=str(server_doc.get("id") or ""),
        name=str(server_doc.get("name") or server_doc.get("host") or ""),
        base_url=_normalise_base_url(host, port),
        token_header=token_header,
        ssl_verify=bool(server_doc.get("ssl_verify")),
        client_id=str(server_doc.get("client_id") or "") or None,
        tenant_id=str(server_doc.get("tenant_id") or "") or None,
    )


def connection_summary(server_doc: dict[str, Any] | None) -> dict[str, Any]:
    """A safe-to-render description of a connection: no token, ever."""
    connection = load_connection(server_doc)
    if not connection:
        return {"configured": False}
    return {
        "configured": connection.configured,
        "server_id": connection.server_id,
        "name": connection.name,
        "host": connection.base_url.split("://", 1)[-1],
        "client_id": connection.client_id,
        "ssl_verify": connection.ssl_verify,
    }


# ============== PROVIDER CLIENT ==============


class ProxmoxClient:
    """Thin async client for the Proxmox VE ``/api2/json`` surface."""

    def __init__(
        self,
        connection: ProxmoxConnection,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = REQUEST_TIMEOUT,
    ):
        if not connection.configured:
            raise ProxmoxNotConfigured(
                "No Proxmox API token is configured for this client.",
                kind="not_configured",
            )
        self.connection = connection
        self._client = httpx.AsyncClient(
            base_url=connection.base_url,
            headers={
                "Authorization": connection.token_header or "",
                "Accept": "application/json",
            },
            verify=connection.ssl_verify,
            timeout=timeout,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "ProxmoxClient":
        return self

    async def __aexit__(self, *_exc) -> None:
        await self.aclose()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json_body: dict | None = None,
    ) -> Any:
        url = f"{API_ROOT}{path}" if path.startswith("/") else f"{API_ROOT}/{path}"
        try:
            response = await self._client.request(method, url, params=params, json=json_body)
        except httpx.HTTPError as exc:
            raise ProxmoxProviderError(
                "Nexus could not reach the Proxmox API; no change was made.",
                kind="unreachable",
            ) from exc

        body: Any = None
        try:
            body = response.json()
        except ValueError:
            body = None

        if response.status_code in (401, 403):
            raise ProxmoxProviderError(
                "Proxmox rejected the stored API token; no change was made. "
                "Re-check the token's role and privileges.",
                kind="auth",
            )
        if response.status_code >= 400:
            message = ""
            if isinstance(body, dict):
                message = str(body.get("message") or body.get("errors") or "").strip()
            raise ProxmoxProviderError(
                (message[:300] + " — ") if message else ""
                + f"Proxmox returned HTTP {response.status_code}; no change was made.",
                kind="provider_error",
            )
        if not isinstance(body, dict) or "data" not in body:
            raise ProxmoxProviderError(
                "Proxmox returned an unrecognised response; the outcome is unknown.",
                kind="invalid_response",
            )
        return body.get("data")

    async def version(self) -> dict:
        data = await self._request("GET", "/version")
        return data if isinstance(data, dict) else {}

    async def nodes(self) -> list[dict]:
        data = await self._request("GET", "/nodes")
        return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []

    async def cluster_resources(self, resource_type: str = "vm") -> list[dict]:
        data = await self._request(
            "GET", "/cluster/resources", params={"type": resource_type}
        )
        return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []

    async def guest_current(self, ref: dict[str, str]) -> dict:
        data = await self._request(
            "GET", f"/nodes/{ref['node']}/{ref['kind']}/{ref['vmid']}/status/current"
        )
        return data if isinstance(data, dict) else {}

    async def guest_power_action(self, ref: dict[str, str], action: str) -> str:
        data = await self._request(
            "POST", f"/nodes/{ref['node']}/{ref['kind']}/{ref['vmid']}/status/{action}"
        )
        upid = str(data or "").strip()
        if not upid:
            raise ProxmoxProviderError(
                "Proxmox accepted the request but returned no task ID; "
                "the outcome is unknown.",
                kind="invalid_response",
            )
        return upid

    async def task_status(self, node: str, upid: str) -> dict:
        data = await self._request("GET", f"/nodes/{node}/tasks/{upid}/status")
        return data if isinstance(data, dict) else {}

    async def wait_for_task(
        self,
        node: str,
        upid: str,
        *,
        timeout: float = DEFAULT_TASK_TIMEOUT,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
    ) -> dict:
        """Poll one Proxmox task until it stops. Never fabricates a finish."""
        deadline = asyncio.get_running_loop().time() + max(0.0, timeout)
        last: dict = {}
        while True:
            last = await self.task_status(node, upid)
            if str(last.get("status") or "") == "stopped":
                return {
                    "finished": True,
                    "exitstatus": str(last.get("exitstatus") or "").strip() or None,
                    "timed_out": False,
                }
            if asyncio.get_running_loop().time() >= deadline:
                return {
                    "finished": False,
                    "exitstatus": None,
                    "timed_out": True,
                    "last_status": str(last.get("status") or "unknown"),
                }
            await asyncio.sleep(poll_interval)


# ============== INVENTORY (observe) ==============


async def fetch_inventory(
    connection: ProxmoxConnection,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    """Live, provenance-carrying inventory from the provider itself."""
    observed_at = datetime.now(timezone.utc).isoformat()
    async with ProxmoxClient(connection, transport=transport) as client:
        version = await client.version()
        nodes = await client.nodes()
        guests = await client.cluster_resources("vm")

    guest_counts: dict[str, int] = {}
    for guest in guests:
        node = str(guest.get("node") or "")
        if node:
            guest_counts[node] = guest_counts.get(node, 0) + 1

    return {
        "provider": PROVIDER,
        "observed_at": observed_at,
        "source": f"proxmox:{connection.server_id}",
        "version": str(version.get("version") or "") or None,
        "nodes": [
            {
                "node": str(node.get("node") or ""),
                "status": str(node.get("status") or "unknown"),
                "cpu_usage": round(float(node.get("cpu") or 0) * 100, 1),
                "memory_usage": _percent(node.get("mem"), node.get("maxmem")),
                "disk_usage": _percent(node.get("disk"), node.get("maxdisk")),
                "uptime_hours": int(float(node.get("uptime") or 0) // 3600),
                "vm_count": guest_counts.get(str(node.get("node") or ""), 0),
            }
            for node in nodes
        ],
        "guests": guests,
    }


def _percent(used: Any, total: Any) -> float:
    try:
        used_value = float(used or 0)
        total_value = float(total or 0)
    except (TypeError, ValueError):
        return 0.0
    if total_value <= 0:
        return 0.0
    return round(min(used_value / total_value, 1.0) * 100, 1)


# ============== EXECUTION (deploy/configure + verification) ==============


def verify_power_action(
    spec: dict[str, Any],
    task: dict[str, Any],
    observed_status: str | None,
) -> dict[str, Any]:
    """Turn observed provider facts into an honest verification verdict.

    ``verified`` requires a finished task with exitstatus OK *and* a guest
    state matching the expectation recorded before the call. A finished OK
    task with an unexpected state is ``inconclusive`` — Nexus reports what it
    saw instead of claiming success or inventing a failure.
    """
    expected = spec.get("expected_status")
    evidence: list[str] = []
    verdict: str

    if not task.get("finished"):
        verdict = "unknown"
        evidence.append(
            "task did not finish within the verification window; outcome unconfirmed"
        )
    elif str(task.get("exitstatus") or "").upper() != "OK":
        verdict = "failed"
        evidence.append(f"provider task exitstatus: {task.get('exitstatus')}")
    elif expected is None:
        verdict = "verified"
        evidence.append("provider task completed OK; end-state expectation not asserted for this action")
    elif observed_status == expected:
        verdict = "verified"
        evidence.append(f"observed guest status '{observed_status}' matches the pre-action expectation")
    else:
        verdict = "inconclusive"
        evidence.append(
            f"provider task completed OK but observed status is '{observed_status}', "
            f"expected '{expected}'"
        )

    return {
        "verdict": verdict,
        "expected_status": expected,
        "observed_status": observed_status,
        "evidence": evidence,
    }


async def execute_power_action(
    connection: ProxmoxConnection,
    guest: dict[str, Any],
    action: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    task_timeout: float = DEFAULT_TASK_TIMEOUT,
    poll_interval: float = DEFAULT_POLL_INTERVAL,
) -> dict[str, Any]:
    """Submit one power action, wait for its task, and verify the outcome.

    Raises ``ProxmoxProviderError`` when the provider rejected or could not be
    reached (nothing was changed); returns a verdict dict when the provider
    accepted the call, because then Nexus must report exactly what it observed
    rather than raising a generic failure.
    """
    spec = action_spec(action)
    if spec is None:
        raise ProxmoxBindingError(
            f"'{action}' is not a supported Proxmox power action.",
            kind="binding",
        )
    ref = guest_ref(guest)

    async with ProxmoxClient(connection, transport=transport) as client:
        upid = await client.guest_power_action(ref, action)
        task = await client.wait_for_task(
            ref["node"], upid, timeout=task_timeout, poll_interval=poll_interval
        )
        observed_status = None
        if task.get("finished"):
            # Only read the guest state once the task has actually finished,
            # so the observation is anchored to a completed provider action.
            current = await client.guest_current(ref)
            observed_status = str(current.get("status") or "") or None

    verification = verify_power_action(spec, task, observed_status)
    verification["plan"] = (
        f"Proxmox task {upid} must finish OK, then {ref['kind']} {ref['vmid']} on "
        f"{ref['node']} must report status "
        + (f"'{spec['expected_status']}'" if spec.get("expected_status") else "(recorded, not asserted)")
    )
    return {
        "provider": PROVIDER,
        "connection_id": connection.server_id,
        "action": action,
        "destructive": bool(spec["destructive"]),
        "node": ref["node"],
        "vmid": ref["vmid"],
        "kind": ref["kind"],
        "submitted": {"upid": upid, "submitted_at": datetime.now(timezone.utc).isoformat()},
        "task": task,
        "observed": {"status": observed_status, "observed_at": datetime.now(timezone.utc).isoformat()},
        "verification": verification,
    }


# ============== SIMULATION (plan, never executed) ==============


def simulate_power_action(
    guest: dict[str, Any],
    action: str,
    *,
    actor_id: str,
) -> dict[str, Any]:
    """A plan for what Nexus *would* do. Never labelled as an execution."""
    spec = action_spec(action) or {}
    ref: dict[str, str]
    try:
        ref = guest_ref(guest)
        binding_error = None
    except ProxmoxBindingError as exc:
        ref = {"node": "", "vmid": "", "kind": ""}
        binding_error = exc.detail

    plan = [
        "validate the canonical action descriptor (actor, target, scope, rollback)",
        "authorise the actor against virtualization.vm.control and the client scope",
    ]
    if spec.get("destructive"):
        plan.append(f"require independent approval: {spec.get('description')}")
    plan.extend([
        f"POST /api2/json/nodes/{ref['node']}/{ref['kind']}/{ref['vmid']}/status/{action}",
        "poll the Proxmox task until it stops and read its exitstatus",
        f"re-read guest status and verify against '{spec.get('expected_status') or 'recorded (not asserted)'}'",
        "write the action record, evidence and audit entry",
    ])

    return {
        "provider": PROVIDER,
        "mode": "simulation",
        "status": "simulated",
        "executed": False,
        "action": action,
        "destructive": bool(spec.get("destructive")),
        "vm_id": str(guest.get("id") or ""),
        "target": ref,
        "plan": plan,
        "rollback": {
            "action": spec.get("rollback"),
            "plan": f"reverse by performing '{spec.get('rollback')}' on the same guest",
        },
        "verification_plan": (
            f"task exitstatus OK and guest status '{spec.get('expected_status')}'"
            if spec.get("expected_status")
            else "task exitstatus OK (end state recorded, not asserted)"
        ),
        "simulated_by": actor_id,
        "note": (
            "Simulation only: Nexus did not call Proxmox and no change was made. "
            + (binding_error or "")
        ).strip(),
    }
