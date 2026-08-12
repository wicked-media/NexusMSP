import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArchiveRestore,
  Box,
  Building2,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  HardDrive,
  HeartPulse,
  KeyRound,
  Network,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  WifiOff,
} from "lucide-react";

const KIND = {
  core: {
    label: "Nexus Core",
    icon: Server,
    tone: "cyan",
    description: "Your hosted NexusMSP API, worker, web and data services.",
  },
  edge: {
    label: "Nexus Edge",
    icon: Network,
    tone: "violet",
    description:
      "A client-scoped local connector for services, discovery and resilient telemetry.",
  },
  backup_vault: {
    label: "Nexus Backup Vault",
    icon: ArchiveRestore,
    tone: "emerald",
    description:
      "A client-scoped encrypted repository foundation with immutable replica readiness.",
  },
  remote_relay: {
    label: "Nexus Remote Relay",
    icon: WifiOff,
    tone: "amber",
    description:
      "A client-scoped RustDesk relay with governed Nexus Remote controls.",
  },
};
const TONE = {
  cyan: "border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-700 dark:text-cyan-200",
  violet:
    "border-violet-500/25 bg-violet-500/[0.06] text-violet-700 dark:text-violet-200",
  emerald:
    "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-200",
  amber:
    "border-amber-500/25 bg-amber-500/[0.06] text-amber-700 dark:text-amber-200",
};
const EDGE_ROLES = [
  {
    id: "discovery_probe",
    label: "Discovery probe",
    detail: "Local inventory and network discovery · 1 CPU / 1 GB RAM / 10 GB.",
    cpu: 1,
    memory: 1,
    storage: 10,
    lan: true,
  },
  {
    id: "backup_node",
    label: "Backup node",
    detail:
      "Customer-side backup/recovery · 2 CPU / 4 GB RAM / 2 TB dedicated storage.",
    cpu: 2,
    memory: 4,
    storage: 2048,
    lan: false,
  },
  {
    id: "remote_relay",
    label: "Remote relay",
    detail: "Governed Nexus Remote relay · 1 CPU / 1 GB RAM / 20 GB.",
    cpu: 1,
    memory: 1,
    storage: 20,
    lan: false,
  },
  {
    id: "jump_gateway",
    label: "Nexus Jump gateway",
    detail:
      "Future ticket-bound access broker · 2 CPU / 2 GB RAM / 20 GB + LAN visibility.",
    cpu: 2,
    memory: 2,
    storage: 20,
    lan: true,
  },
  {
    id: "dns_security",
    label: "DNS security",
    detail: "Policy and DNS-security telemetry · 1 CPU / 1 GB RAM / 10 GB.",
    cpu: 1,
    memory: 1,
    storage: 10,
    lan: true,
  },
  {
    id: "network_monitor",
    label: "Network monitor",
    detail: "Local connectivity observations · 1 CPU / 1 GB RAM / 10 GB.",
    cpu: 1,
    memory: 1,
    storage: 10,
    lan: true,
  },
  {
    id: "syslog_collector",
    label: "Syslog collector",
    detail:
      "Approved infrastructure log collection · 2 CPU / 4 GB RAM / 256 GB.",
    cpu: 2,
    memory: 4,
    storage: 256,
    lan: true,
  },
];
const EDGE_ROLE_EVIDENCE = {
  declared: {
    label: "Declared",
    className: "border-border/70 text-muted-foreground",
  },
  observed_control_plane: {
    label: "Control-plane observed",
    className:
      "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-200",
  },
  attention_control_plane: {
    label: "Control-plane attention",
    className:
      "border-amber-500/25 bg-amber-500/[0.06] text-amber-700 dark:text-amber-200",
  },
  transport_not_configured: {
    label: "Transport not configured",
    className: "border-border/70 text-muted-foreground",
  },
  transport_configured_no_session: {
    label: "Transport ready · no session",
    className:
      "border-sky-500/25 bg-sky-500/[0.06] text-sky-700 dark:text-sky-200",
  },
  transport_handshake_observed: {
    label: "Transport handshake observed",
    className:
      "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-200",
  },
  transport_attention: {
    label: "Transport attention",
    className:
      "border-amber-500/25 bg-amber-500/[0.06] text-amber-700 dark:text-amber-200",
  },
};

function onlineBadge(deployment) {
  if (deployment.online)
    return (
      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200">
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Online
      </Badge>
    );
  if (deployment.activation_expired)
    return (
      <Badge
        variant="outline"
        className="border-rose-500/30 text-rose-700 dark:text-rose-200"
      >
        Activation expired
      </Badge>
    );
  if (deployment.status === "prepared")
    return (
      <Badge
        variant="outline"
        className="border-amber-500/25 text-amber-700 dark:text-amber-200"
      >
        Awaiting deployment
      </Badge>
    );
  if (deployment.status === "activated")
    return (
      <Badge
        variant="outline"
        className="border-sky-500/25 text-sky-700 dark:text-sky-200"
      >
        Awaiting heartbeat
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="border-rose-500/25 text-rose-700 dark:text-rose-200"
    >
      Offline
    </Badge>
  );
}

export default function DeploymentHubPage() {
  const { token } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );
  const [data, setData] = useState({ deployments: [], summary: {} });
  const [clients, setClients] = useState([]);
  const [partners, setPartners] = useState([]);
  const [jumpGateways, setJumpGateways] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [jumpLabOpen, setJumpLabOpen] = useState(false);
  const [registeringJumpLab, setRegisteringJumpLab] = useState(false);
  const [jumpLabForm, setJumpLabForm] = useState({
    gateway_id: "nexus-jump-lab-au-01",
    display_name: "Nexus Jump — AU lab gateway",
    endpoint: "",
    public_key: "",
    allowed_resource_cidrs: "10.42.10.0/24",
    allowed_protocols: ["https", "ssh", "rdp", "vnc", "winrm", "ipmi"],
    maximum_session_minutes: 60,
    approval_required: true,
    ticket_required: true,
  });
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({
    kind: "edge",
    owner_type: "nexus",
    channel_tenant_id: "",
    name: "",
    client_id: "",
    public_url: "",
    notes: "",
    edge_roles: [],
    edge_resources: {
      cpu_cores: 16,
      memory_gb: 32,
      storage_gb: 4096,
      lan_visibility: true,
    },
  });
  const edgePlan = useMemo(() => {
    const selected = EDGE_ROLES.filter((role) =>
      form.edge_roles.includes(role.id),
    );
    return {
      cpu: selected.reduce((total, role) => total + role.cpu, 0),
      memory: selected.reduce((total, role) => total + role.memory, 0),
      storage: selected.reduce((total, role) => total + role.storage, 0),
      lan: selected.some((role) => role.lan),
    };
  }, [form.edge_roles]);
  const resourceGaps =
    form.kind === "edge"
      ? [
          form.edge_resources.cpu_cores < edgePlan.cpu
            ? `CPU needs ${edgePlan.cpu}`
            : null,
          form.edge_resources.memory_gb < edgePlan.memory
            ? `memory needs ${edgePlan.memory} GB`
            : null,
          form.edge_resources.storage_gb < edgePlan.storage
            ? `storage needs ${edgePlan.storage.toLocaleString()} GB`
            : null,
          edgePlan.lan && !form.edge_resources.lan_visibility
            ? "customer LAN visibility is required"
            : null,
        ].filter(Boolean)
      : [];

  const load = async () => {
    setLoading(true);
    try {
      const [overview, clientRows, partnerRows, jumpGatewayRows] =
        await Promise.all([
        axios.get(`${API}/deployment-hub/overview`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/channel-mode/tenants`, { headers }),
        axios.get(`${API}/deployment-hub/jump-lab-gateways`, { headers }),
      ]);
      setData(overview.data || { deployments: [], summary: {} });
      setClients(
        Array.isArray(clientRows.data)
          ? clientRows.data
          : clientRows.data?.clients || [],
      );
      setPartners(partnerRows.data?.tenants || []);
      setJumpGateways(jumpGatewayRows.data?.gateways || []);
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Deployment Hub could not be loaded",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (!form.name.trim())
      return toast.error("Name this deployment before continuing");
    if (form.owner_type === "msp_partner" && !form.channel_tenant_id)
      return toast.error("Choose the MSP partner that owns this deployment");
    if (
      form.owner_type === "nexus" &&
      ["edge", "backup_vault", "remote_relay"].includes(form.kind) &&
      !form.client_id
    )
      return toast.error("Choose the customer that owns this deployment");
    if (resourceGaps.length)
      return toast.error(
        `Appliance plan needs attention: ${resourceGaps.join(", ")}`,
      );
    setBuilding(true);
    try {
      const selected = clients.find((client) => client.id === form.client_id);
      const partner = partners.find(
        (item) => item.tenant_id === form.channel_tenant_id,
      );
      const response = await axios.post(
        `${API}/deployment-hub/deployments`,
        {
          ...form,
          client_name: selected?.name || "",
          channel_tenant_name: partner?.name || "",
        },
        { headers },
      );
      setResult(response.data);
      setOpen(false);
      toast.success(
        "Deployment record prepared. Save the activation code once.",
      );
      await load();
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Could not prepare deployment",
      );
    } finally {
      setBuilding(false);
    }
  };

  const downloadBundle = async (deployment, activationCode) => {
    try {
      const response = await axios.post(
        `${API}/deployment-hub/deployments/${deployment.id}/bundle`,
        activationCode ? { activation_code: activationCode } : {},
        { headers, responseType: "blob" },
      );
      const href = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `nexus-${deployment.kind}-${deployment.id.slice(0, 8)}.zip`;
      anchor.click();
      URL.revokeObjectURL(href);
      toast.success(
        activationCode
          ? "Matching deployment bundle downloaded. Run its bootstrap script after approving the target host."
          : "Fresh deployment bundle downloaded. Run the included bootstrap script after approving the target host.",
      );
    } catch (error) {
      toast.error(
        error.response?.data?.detail ||
          "Could not generate a deployment bundle",
      );
    }
  };
  const downloadJumpLabPolicy = () => {
    const policy = {
      gateway_id: "nexus-jump-lab-au-01",
      display_name: "Nexus Jump — AU lab gateway",
      environment: "lab",
      endpoint: "jump-lab.example.net:51820",
      public_key: "REPLACE_WITH_THE_GATEWAY_PUBLIC_KEY",
      allowed_resource_cidrs: ["10.42.10.0/24"],
      allowed_protocols: ["https", "ssh", "rdp", "vnc", "winrm", "ipmi"],
      maximum_session_minutes: 60,
      approval_required: true,
      ticket_required: true,
    };
    const href = URL.createObjectURL(
      new Blob([JSON.stringify(policy, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "nexus-jump-lab-policy.json";
    anchor.click();
    URL.revokeObjectURL(href);
    toast.success("Lab policy template downloaded. It cannot create a tunnel.");
  };
  const registerJumpLabGateway = async () => {
    setRegisteringJumpLab(true);
    try {
      const response = await axios.post(
        `${API}/deployment-hub/jump-lab-gateways`,
        {
          ...jumpLabForm,
          environment: "lab",
          allowed_resource_cidrs: jumpLabForm.allowed_resource_cidrs
            .split(",")
            .map((cidr) => cidr.trim())
            .filter(Boolean),
        },
        { headers },
      );
      setJumpGateways((current) => [response.data.gateway, ...current]);
      setJumpLabOpen(false);
      toast.success(response.data.message || "Nexus Jump lab policy registered");
    } catch (error) {
      toast.error(
        error.response?.data?.detail ||
          "Could not register the Nexus Jump lab policy",
      );
    } finally {
      setRegisteringJumpLab(false);
    }
  };
  const copy = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Clipboard access was unavailable");
    }
  };
  const nextAction = data.summary?.activation_attention
    ? {
        label: "Refresh expired activation bundles",
        description: `${data.summary.activation_attention} prepared deployment${data.summary.activation_attention === 1 ? " has" : "s have"} passed its activation window and needs a newly generated bundle before installation can continue.`,
        action: "Review deployment estate",
        route: "#deployment-estate",
        onClick: () =>
          window.scrollTo({
            top: document.documentElement.scrollHeight,
            behavior: "smooth",
          }),
        tone: "amber",
      }
    : !data.summary?.total
      ? {
          label: "Prepare the first customer Edge",
          description:
            "Start with a scoped Nexus Edge to establish the customer identity, local telemetry and verified metering contract.",
          action: "Prepare customer Edge",
          tone: "cyan",
          create: true,
          onClick: () => {
            setForm((current) => ({
              ...current,
              owner_type: "nexus",
              kind: "edge",
              name: current.name || "Nexus Edge",
            }));
            setOpen(true);
          },
        }
      : !data.summary?.online
        ? {
            label: "Activate a prepared deployment",
            description:
              "Nexus only treats an installed service as online after its authenticated heartbeat. Download the matching bundle and complete its approved bootstrap.",
            action: "Review deployment estate",
            route: "#deployment-estate",
            onClick: () =>
              window.scrollTo({
                top: document.documentElement.scrollHeight,
                behavior: "smooth",
              }),
            tone: "cyan",
          }
        : {
            label: "Deployment estate is verified",
            description:
              "At least one deployment has a recent authenticated heartbeat. Use the estate record to review agent metering and support readiness.",
            action: "Review deployment estate",
            route: "#deployment-estate",
            onClick: () =>
              window.scrollTo({
                top: document.documentElement.scrollHeight,
                behavior: "smooth",
              }),
            tone: "emerald",
          };
  const deploymentSignal = data.summary?.activation_attention
    ? "attention"
    : data.summary?.total && !data.summary?.online
      ? "working"
      : data.summary?.online
        ? "healthy"
        : "recommendation";

  return (
    <div
      className="nx-page-stage space-y-5 p-6"
      data-testid="deployment-hub-page"
    >
      <OperationalPageHeader
        eyebrow="Nexus platform · governed provisioning"
        title="Deployment Hub"
        description="Prepare, activate and observe Nexus Core, customer Edge and Remote Relay deployments from the same operational control plane."
        icon={Box}
        tone="sky"
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/help/nexus-agent-enrolment">Deployment guide</Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw
                className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setResult(null);
                setOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Prepare deployment
            </Button>
          </>
        }
      />

      <Card
        className="nx-ambient-surface overflow-hidden border-cyan-500/20 bg-gradient-to-r from-cyan-500/[0.07] via-card to-violet-500/[0.05]"
        data-nx-signal={deploymentSignal}
        data-testid="deployment-hub-boundary"
      >
        <CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
              A trustworthy deployment lifecycle
            </p>
            <h2 className="mt-1 text-xl font-semibold">
              Prepared is not deployed. Activated is not online.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Nexus only treats a customer deployment as supportable and
              billable after its own authenticated heartbeat. Activation codes
              are one-time, expire after 24 hours, and are never retained as
              recoverable secrets.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/55 px-3 py-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Outbound first · scoped · auditable
          </div>
        </CardContent>
      </Card>

      <Card
        className="overflow-hidden border-violet-500/20 bg-gradient-to-br from-violet-500/[0.075] via-card to-cyan-500/[0.045]"
        data-testid="nexus-os-edge-foundation"
      >
        <CardContent className="grid gap-5 p-5 xl:grid-cols-[1.15fr_.85fr]">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-700 dark:text-violet-300">
              Nexus OS Edge 0.1
            </p>
            <h2 className="mt-1 text-xl font-semibold">
              One managed appliance, explicit local roles.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Nexus OS starts here as the appliance control layer—not a Windows
              or Linux replacement. An Edge has a customer scope, one-time
              enrolment, a persistent authenticated identity and declared local
              roles. It becomes operational only after a verified heartbeat.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-background/45 p-3">
                <p className="text-xs font-medium">Evidence available today</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Scope, activation, persistent deployment identity and service
                  heartbeat.
                </p>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.045] p-3">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                  Not yet attested by an appliance
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Secure Boot/TPM, immutable updates, image signing and rollback
                  health. These remain unverified until Nexus OS reports them.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-violet-500/20 bg-background/35 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Lifecycle contract
            </p>
            <div className="mt-3 space-y-2 text-sm">
              {[
                "Prepare customer scope + selected roles",
                "Activate using a single-use enrolment code",
                "Receive authenticated Edge heartbeat",
                "Report appliance security/update evidence",
                "Enable and govern local roles",
              ].map((step, index) => (
                <div key={step} className="flex gap-3">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-violet-500/25 bg-violet-500/10 text-[10px] font-semibold text-violet-700 dark:text-violet-200">
                    {index + 1}
                  </span>
                  <span className="text-muted-foreground">{step}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card
        className="overflow-hidden border-sky-500/20 bg-gradient-to-r from-sky-500/[0.075] via-card to-violet-500/[0.05]"
        data-testid="nexus-jump-lab-readiness"
      >
        <CardContent className="grid gap-4 p-5 xl:grid-cols-[1fr_auto] xl:items-center">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
                Nexus Jump · Lab readiness
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                Define the boundary before enabling the transport.
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                Download the offline policy template for the isolated gateway.
                It accepts only a lab endpoint, a gateway public key, private
                least-privilege resource subnets, ticket-bound access and
                approval-gated sessions. It never creates a tunnel or exposes
                a customer service.
              </p>
              {jumpGateways.length > 0 && (
                <p className="mt-2 text-xs font-medium text-sky-700 dark:text-sky-300">
                  {jumpGateways.length} lab gateway
                  {jumpGateways.length === 1 ? " is" : "s are"} registered —
                  all remain transport-pending.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 xl:justify-end">
            <Button variant="outline" size="sm" onClick={() => setJumpLabOpen(true)}>
              Review safeguards
            </Button>
            <Button size="sm" onClick={downloadJumpLabPolicy}>
              <FileDown className="mr-1.5 h-3.5 w-3.5" />
              Download lab policy
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <HeroTile
          label="Deployments"
          value={data.summary?.total || 0}
          icon={Server}
          glow="cyan"
          subtitle="Core, Edge, Vault and relay"
        />
        <HeroTile
          label="Online"
          value={data.summary?.online || 0}
          icon={HeartPulse}
          glow={
            data.summary?.activation_attention
              ? "amber"
              : data.summary?.online
                ? "emerald"
                : "zinc"
          }
          subtitle={
            data.summary?.activation_attention
              ? `${data.summary.activation_attention} activation window${data.summary.activation_attention === 1 ? "" : "s"} need refresh`
              : "Verified in the last 5 minutes"
          }
        />
        <HeroTile
          label="Customer Edge"
          value={data.summary?.edge || 0}
          icon={Network}
          glow="violet"
          subtitle="Client-scoped local nodes"
        />
        <HeroTile
          label="Backup Vaults"
          value={data.summary?.backup_vault || 0}
          icon={ArchiveRestore}
          glow="emerald"
          subtitle="Protection foundations"
        />
        <HeroTile
          label="Metered agents"
          value={data.summary?.metered_agents || 0}
          icon={HardDrive}
          glow="amber"
          subtitle="Reported by verified Edge"
        />
      </div>

      <Card
        className={
          nextAction.tone === "emerald"
            ? "border-emerald-500/25 bg-emerald-500/[0.045]"
            : nextAction.tone === "amber"
              ? "border-amber-500/25 bg-amber-500/[0.045]"
              : "border-cyan-500/25 bg-cyan-500/[0.045]"
        }
        data-testid="deployment-hub-next-action"
      >
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${nextAction.tone === "emerald" ? "border-emerald-500/25 bg-emerald-500/[0.09] text-emerald-300" : nextAction.tone === "amber" ? "border-amber-500/25 bg-amber-500/[0.09] text-amber-300" : "border-cyan-500/25 bg-cyan-500/[0.09] text-cyan-300"}`}
            >
              {nextAction.tone === "emerald" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Recommended next action
              </p>
              <p className="mt-1 text-sm font-semibold">{nextAction.label}</p>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                {nextAction.description}
              </p>
            </div>
          </div>
          {nextAction.onClick ? (
            <Button size="sm" className="shrink-0" onClick={nextAction.onClick}>
              {nextAction.action}
              {nextAction.create ? (
                <Plus className="ml-1.5 h-3.5 w-3.5" />
              ) : (
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              )}
            </Button>
          ) : (
            <Button
              size="sm"
              className="shrink-0"
              variant={nextAction.tone === "emerald" ? "outline" : "default"}
              asChild
            >
              <a href={nextAction.route}>
                {nextAction.action}
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={jumpLabOpen} onOpenChange={setJumpLabOpen}>
        <DialogContent className="nx-workflow-dialog max-w-xl">
          <DialogHeader>
            <DialogTitle>Nexus Jump lab safeguards</DialogTitle>
            <DialogDescription>
              The current Nexus Jump workflow records controlled, ticket-bound
              intent only. It will remain unable to broker a live connection
              until a reviewed transport controller has been built and verified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            {[
              "Use an isolated lab gateway—not a customer network or production route.",
              "Keep private keys in the future encrypted secret store; a policy includes public metadata only.",
              "Limit every route to a required private subnet. Broad routes are rejected by the offline preflight.",
              "Require a ticket, approval, MFA policy and an expiry for every session.",
              "Prove revocation and audit evidence in the lab before enabling customer access.",
            ].map((safeguard, index) => (
              <div key={safeguard} className="flex gap-3 rounded-xl border border-border/70 bg-muted/25 p-3">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sky-500/10 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                  {index + 1}
                </span>
                <span>{safeguard}</span>
              </div>
            ))}
          </div>
          <div className="grid gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/[0.035] p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className="text-xs font-semibold text-foreground">
                Register lab gateway boundary
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Nexus stores public policy metadata only. Do not enter a
                private key anywhere in this workflow.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jump-lab-name">Gateway name</Label>
              <Input
                id="jump-lab-name"
                value={jumpLabForm.display_name}
                onChange={(event) =>
                  setJumpLabForm((current) => ({
                    ...current,
                    display_name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jump-lab-id">Gateway ID</Label>
              <Input
                id="jump-lab-id"
                value={jumpLabForm.gateway_id}
                onChange={(event) =>
                  setJumpLabForm((current) => ({
                    ...current,
                    gateway_id: event.target.value.toLowerCase(),
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jump-lab-endpoint">Lab endpoint</Label>
              <Input
                id="jump-lab-endpoint"
                placeholder="jump-lab.example.net:51820"
                value={jumpLabForm.endpoint}
                onChange={(event) =>
                  setJumpLabForm((current) => ({
                    ...current,
                    endpoint: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jump-lab-duration">Maximum session (minutes)</Label>
              <Input
                id="jump-lab-duration"
                type="number"
                min="5"
                max="240"
                value={jumpLabForm.maximum_session_minutes}
                onChange={(event) =>
                  setJumpLabForm((current) => ({
                    ...current,
                    maximum_session_minutes: Number(event.target.value),
                  }))
                }
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="jump-lab-public-key">Gateway public key</Label>
              <Input
                id="jump-lab-public-key"
                placeholder="Public key only — never a private key"
                autoComplete="off"
                value={jumpLabForm.public_key}
                onChange={(event) =>
                  setJumpLabForm((current) => ({
                    ...current,
                    public_key: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="jump-lab-cidrs">Approved lab resource CIDRs</Label>
              <Input
                id="jump-lab-cidrs"
                placeholder="10.42.10.0/24, 10.42.11.0/24"
                value={jumpLabForm.allowed_resource_cidrs}
                onChange={(event) =>
                  setJumpLabForm((current) => ({
                    ...current,
                    allowed_resource_cidrs: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJumpLabOpen(false)}>
              Close
            </Button>
            <Button onClick={downloadJumpLabPolicy}>
              <FileDown className="mr-1.5 h-3.5 w-3.5" />
              Download policy
            </Button>
            <Button onClick={registerJumpLabGateway} disabled={registeringJumpLab}>
              {registeringJumpLab ? "Registering…" : "Register lab boundary"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card
        className="border-violet-500/20 bg-gradient-to-r from-violet-500/[0.07] via-card to-cyan-500/[0.04]"
        data-testid="deployment-hub-channel-mode"
      >
        <CardContent className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-violet-500/25 bg-violet-500/10">
              <Building2 className="h-4 w-4 text-violet-500" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-700 dark:text-violet-300">
                Nexus Channel
              </p>
              <p className="mt-1 text-sm font-semibold">
                Provision an isolated MSP platform estate.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Partner-hosted infrastructure remains under the MSP’s approval;
                Nexus prepares its identity, bootstrap and health contract
                automatically.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={form.channel_tenant_id || undefined}
              onValueChange={(channel_tenant_id) =>
                setForm((current) => ({ ...current, channel_tenant_id }))
              }
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Choose MSP partner" />
              </SelectTrigger>
              <SelectContent>
                {partners.map((partner) => (
                  <SelectItem key={partner.tenant_id} value={partner.tenant_id}>
                    {partner.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!form.channel_tenant_id}
              onClick={() => {
                const partner = partners.find(
                  (item) => item.tenant_id === form.channel_tenant_id,
                );
                setForm((current) => ({
                  ...current,
                  owner_type: "msp_partner",
                  kind: "core",
                  name: `${partner?.name || "Partner"} Core`,
                }));
                setOpen(true);
              }}
            >
              Prepare MSP Core
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/channel-mode">Manage partners</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-4">
        {Object.entries(KIND).map(([key, item]) => {
          const Icon = item.icon;
          return (
            <Card key={key} className="border-border/80 bg-card/70">
              <CardHeader className="pb-3">
                <div
                  className={`mb-2 flex h-10 w-10 items-center justify-center rounded-xl border ${TONE[item.tone]}`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <CardTitle className="text-base">{item.label}</CardTitle>
                <CardDescription className="text-xs leading-5">
                  {item.description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => {
                    setForm((current) => ({
                      ...current,
                      owner_type: "nexus",
                      kind: key,
                      name: current.name || item.label,
                    }));
                    setOpen(true);
                  }}
                >
                  Prepare {item.label}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/70">
          <CardTitle className="text-base">Deployment estate</CardTitle>
          <CardDescription className="text-xs">
            Live status is based only on a recent authenticated heartbeat;
            records without one remain visibly pending or offline.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border/60">
            {!data.deployments?.length && (
              <div className="px-5 py-14 text-center text-sm text-muted-foreground">
                No deployments prepared yet. Start with a client Edge, Backup
                Vault or Remote Relay.
              </div>
            )}
            {data.deployments?.map((deployment) => {
              const item = KIND[deployment.kind] || KIND.edge;
              const Icon = item.icon;
              const evidence = Object.values(deployment.attestation || {});
              const verifiedEvidence = evidence.filter(
                (status) => status === "verified",
              ).length;
              return (
                <div
                  key={deployment.id}
                  className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center"
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${TONE[item.tone]}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{deployment.name}</p>
                      {onlineBadge(deployment)}
                      <Badge
                        variant="outline"
                        className="text-[9px] uppercase tracking-[0.12em]"
                      >
                        {item.label}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {deployment.client_name || "Nexus platform"}
                      {deployment.hostname
                        ? ` · ${deployment.hostname}`
                        : " · not activated"}
                      {deployment.version ? ` · v${deployment.version}` : ""}
                    </p>
                    {deployment.kind === "edge" && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {deployment.edge_roles?.length ? (
                          deployment.edge_roles.map((role) => {
                            const roleEvidence =
                              EDGE_ROLE_EVIDENCE[
                                deployment.metering?.services?.[role]
                              ] || EDGE_ROLE_EVIDENCE.declared;
                            return (
                              <div
                                key={role}
                                className="inline-flex overflow-hidden rounded-md border border-violet-500/25 bg-violet-500/[0.045] text-[9px] text-violet-700 dark:text-violet-200"
                              >
                                <span className="px-1.5 py-0.5">
                                  {EDGE_ROLES.find((item) => item.id === role)
                                    ?.label || role}
                                </span>
                                <span
                                  className={`border-l px-1.5 py-0.5 ${roleEvidence.className}`}
                                >
                                  {roleEvidence.label}
                                </span>
                              </div>
                            );
                          })
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            No local roles declared
                          </span>
                        )}
                        <Badge
                          variant="outline"
                          className={
                            evidence.length
                              ? "border-cyan-500/25 bg-cyan-500/[0.045] text-[9px] text-cyan-700 dark:text-cyan-200"
                              : "text-[9px] text-muted-foreground"
                          }
                        >
                          {evidence.length
                            ? `${verifiedEvidence}/${evidence.length} attested`
                            : "attestation pending"}
                        </Badge>
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground lg:text-right">
                    <p>
                      {deployment.metering?.agent_count || 0} reported agents
                    </p>
                    <p className="mt-1 font-mono text-[10px]">
                      {deployment.online
                        ? `${deployment.heartbeat_age_seconds}s ago`
                        : deployment.activation_expired
                          ? "new activation code required"
                          : deployment.activation_expires_at
                            ? "activation window managed"
                            : "no heartbeat"}
                    </p>
                  </div>
                  {!deployment.activation_used_at && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadBundle(deployment)}
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      {deployment.activation_expired
                        ? "Refresh bundle"
                        : "Bundle"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Prepare a Nexus deployment</DialogTitle>
            <DialogDescription>
              Generate one scoped deployment record first. The one-time
              activation code is shown only after preparation.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Deployment type</Label>
              <Select
                value={form.kind}
                onValueChange={(kind) =>
                  setForm((current) => ({
                    ...current,
                    kind,
                    edge_roles: kind === "edge" ? current.edge_roles : [],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KIND).map(([key, item]) => (
                    <SelectItem value={key} key={key}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="e.g. Acme Sydney Edge"
                autoFocus
              />
            </div>
            {form.kind !== "core" && (
              <div className="grid gap-2">
                <Label>Customer</Label>
                <Select
                  value={form.client_id}
                  onValueChange={(client_id) =>
                    setForm((current) => ({ ...current, client_id }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.kind === "edge" && (
              <div className="grid gap-2">
                <Label>
                  Nexus OS roles{" "}
                  <span className="text-muted-foreground">
                    (declared intent)
                  </span>
                </Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {EDGE_ROLES.map((role) => {
                    const selected = form.edge_roles.includes(role.id);
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            edge_roles: selected
                              ? current.edge_roles.filter(
                                  (item) => item !== role.id,
                                )
                              : [...current.edge_roles, role.id],
                          }))
                        }
                        className={`rounded-lg border p-3 text-left transition-colors ${selected ? "border-violet-500/40 bg-violet-500/[0.09]" : "border-border/70 bg-background/35 hover:border-violet-500/30"}`}
                      >
                        <span className="block text-xs font-medium">
                          {role.label}
                        </span>
                        <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
                          {role.detail}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  Roles are saved as the deployment intent. They are not
                  considered installed or healthy until the appliance reports
                  them.
                </p>
              </div>
            )}
            <div className="grid gap-2">
              <Label>
                Public control-plane URL{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                value={form.public_url}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    public_url: event.target.value,
                  }))
                }
                placeholder="https://nexus.example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label>
                Deployment note{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                placeholder="Customer site, change reference, or intended local services"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={building}
            >
              Cancel
            </Button>
            <Button onClick={create} disabled={building}>
              {building ? "Preparing…" : "Prepare secure bundle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(result)}
        onOpenChange={(value) => !value && setResult(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Download the matching activation bundle</DialogTitle>
            <DialogDescription>
              This secret is shown once. Download the prepared bundle now so its{" "}
              <code>.env</code> contains this exact code; it expires in 24 hours
              and must never be added to a ticket, email or source repository.
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-200">
                  One-time activation code
                </p>
                <div className="mt-2 flex gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg bg-background/75 p-3 text-xs text-foreground">
                    {result.activation_code}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      copy(result.activation_code, "Activation code")
                    }
                    aria-label="Copy activation code"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {result.deployment.requirements?.map((requirement) => (
                  <div
                    key={requirement.id}
                    className="rounded-lg border border-border/70 p-3"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      {requirement.label}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {requirement.detail}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                If you close this dialog before downloading, a later Bundle
                download safely rotates the code and embeds the new one in the
                replacement package.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResult(null)}>
              Close without download
            </Button>
            {result && (
              <Button
                onClick={() =>
                  downloadBundle(result.deployment, result.activation_code)
                }
              >
                <Download className="mr-1.5 h-4 w-4" />
                Download matching bundle
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
