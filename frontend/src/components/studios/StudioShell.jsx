import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Compass,
  ExternalLink,
  ListChecks,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Wrench,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import FleetBaselinePanel, { fleetBaselineView } from "@/components/studios/FleetBaselinePanel";
import AgentFleetPanel from "@/components/studios/AgentFleetPanel";
import BackupRecoveryPanel from "@/components/studios/BackupRecoveryPanel";
import BackupVerificationPanel from "@/components/studios/BackupVerificationPanel";
import ClientEstatePanel from "@/components/studios/ClientEstatePanel";
import ClientPortfolioPanel from "@/components/studios/ClientPortfolioPanel";
import ClientRenewalWatchPanel from "@/components/studios/ClientRenewalWatchPanel";
import CommunicationsPanel from "@/components/studios/CommunicationsPanel";
import DeviceEstatePanel from "@/components/studios/DeviceEstatePanel";
import DocumentationInventoryPanel from "@/components/studios/DocumentationInventoryPanel";
import LeadPipelinePanel from "@/components/studios/LeadPipelinePanel";
import M365TenantPanel from "@/components/studios/M365TenantPanel";
import MonitoringPulsePanel from "@/components/studios/MonitoringPulsePanel";
import MonitoringResourcesPanel from "@/components/studios/MonitoringResourcesPanel";
import MicrosoftStudioPanel from "@/components/studios/MicrosoftStudioPanel";
import MicrosoftEvidencePanel from "@/components/studios/MicrosoftEvidencePanel";
import MicrosoftOperationsPanel from "@/components/studios/MicrosoftOperationsPanel";
import NetworkOperationsPanel from "@/components/studios/NetworkOperationsPanel";
import NetworkEvidencePanel from "@/components/studios/NetworkEvidencePanel";
import NetworkSitesPanel from "@/components/studios/NetworkSitesPanel";
import PatchPosturePanel from "@/components/studios/PatchPosturePanel";
import ProxmoxOperationsPanel from "@/components/studios/ProxmoxOperationsPanel";
import SecurityPosturePanel from "@/components/studios/SecurityPosturePanel";
import SocAlertsPanel from "@/components/studios/SocAlertsPanel";
import VoiceEstatePanel from "@/components/studios/VoiceEstatePanel";
import WebEstatePanel from "@/components/studios/WebEstatePanel";
import { studioObservationView } from "@/components/studios/StudioObservationKit";

/**
 * The Studio spine: one shared nine-tab shell every Studio renders on.
 *
 * Contract rules enforced here (docs/NEXUS_STUDIO_FLEET.md, Law 9):
 * - a tab renders live data only from the endpoint its registry contract names;
 * - a tab whose capability is not registered renders the admission reason —
 *   never an empty panel that looks like a healthy nothing;
 * - no studio invents inventory, health or success it did not observe.
 *
 * A tab whose endpoint answers one of the platform's projected questions is
 * rendered by that question's own panel rather than as raw JSON — the fleet
 * baseline comparison, for instance, renders the deviation view the studio was
 * admitted against, and a studio that adopts an existing workspace projection
 * (the device estate, the agent fleet, the client rollup, protected workloads)
 * renders that projection through `StudioObservationKit`. The endpoint still
 * decides: a tab pointed anywhere else falls through to the generic endpoint
 * tab, and nothing here paraphrases data the panel does not model.
 */

const STATE_STYLE = {
  wired: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  planned: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  architecture_required: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  discovery_required: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  deferred: "bg-slate-500/10 text-slate-500 border-slate-500/20",
};

const STATE_LABEL = {
  wired: "wired",
  planned: "planned",
  architecture_required: "architecture required",
  discovery_required: "discovery required",
  deferred: "deferred",
};

export function TabStateBadge({ state }) {
  return (
    <Badge variant="outline" className={`text-[9px] uppercase tracking-wide ${STATE_STYLE[state] || STATE_STYLE.planned}`}>
      {STATE_LABEL[state] || state}
    </Badge>
  );
}

function useEndpoint(url) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [state, setState] = useState({ loading: true, data: null, error: null });

  const load = useCallback(async () => {
    if (!url) {
      setState({ loading: false, data: null, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await axios.get(`${API}${url}`, { headers });
      setState({ loading: false, data: res.data, error: null });
    } catch (err) {
      setState({ loading: false, data: null, error: apiErrorMessage(err, "This endpoint did not answer; nothing is being claimed.") });
    }
  }, [url, headers]);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

function Panel({ studio, spec, children }) {
  if (!spec || spec.state !== "wired") {
    return <NotWiredPanel studio={studio} spec={spec} />;
  }
  return <>{children}</>;
}

function NotWiredPanel({ studio, spec }) {
  const state = spec?.state || "planned";
  const statusLabel = state.replace(/_/g, " ");
  return (
    <Card data-testid={`tab-unwired-${state}`} className="max-w-3xl border-dashed border-border/80 bg-muted/[0.18]">
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-background text-muted-foreground">
            <ShieldAlert className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Capability status</span>
              <TabStateBadge state={state} />
            </div>
            <h3 className="mt-1 text-sm font-semibold tracking-tight text-foreground">
              {statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)} for {studio.name}
            </h3>
          </div>
        </div>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {spec?.summary || "No capability contract is registered for this tab."}
        </p>
        <div className="grid gap-2 border-t border-border/60 pt-3 text-[11px] sm:grid-cols-2">
          <div>
            <p className="font-medium text-foreground">What this means</p>
            <p className="mt-0.5 leading-relaxed text-muted-foreground">No action or health state is being implied for this area.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Admission requirement</p>
            <p className="mt-0.5 leading-relaxed text-muted-foreground">A provider adapter, permission boundary and evidence contract must be admitted first.</p>
          </div>
        </div>
        {spec?.evidence && <p className="font-mono text-[11px] text-muted-foreground">Evidence reference: {spec.evidence}</p>}
      </CardContent>
    </Card>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading observed data…
    </div>
  );
}

function EndpointError({ error, onRetry }) {
  return (
    <Card className="border-yellow-500/30 bg-yellow-500/5">
      <CardContent className="pt-4 flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">{error}</p>
        {onRetry && <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onRetry}>Retry</Button>}
      </CardContent>
    </Card>
  );
}

/* ------------------------------- Overview -------------------------------- */

function OverviewPanel({ studio }) {
  const endpoint = studio.tabs.overview?.endpoint;
  const { loading, data, error, reload } = useEndpoint(endpoint || null);
  const admission = studio.admission;
  const wiredTabs = Object.entries(studio.tabs || {}).filter(([, spec]) => spec?.state === "wired");
  const pendingTabs = Object.entries(studio.tabs || {}).filter(([, spec]) => spec?.state !== "wired");
  const nextConstraint = pendingTabs[0];

  return (
    <div className="space-y-4" data-testid="studio-overview">
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">What this studio is for</p>
              <p className="mt-1.5 text-sm leading-relaxed">{studio.tagline}</p>
            </div>
            {studio.home_route ? (
              <Button asChild className="shrink-0">
                <a href={studio.home_route}>
                  <Wrench className="mr-1.5 h-4 w-4" />Open workspace <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
                </a>
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <Badge variant="outline" className="text-[10px]">{studio.domain}</Badge>
            <Badge variant="outline" className="text-[10px]">Priority {studio.priority}</Badge>
            <Badge variant="outline" className="text-[10px]">Release {studio.release}</Badge>
            <Badge variant="outline" className="text-[10px]">Owner: {studio.owner}</Badge>
            <Badge variant="outline" className={`text-[10px] ${admission ? "" : "border-amber-500/40 text-amber-500"}`}>
              Admission: {admission?.state || "open"}
            </Badge>
          </div>
          <div className="mt-4 grid gap-2 text-xs">
            <div className="flex gap-2"><span className="text-muted-foreground w-40 shrink-0">Provider contract</span>
              <span>{studio.provider?.name} — <span className="uppercase text-[10px]">{studio.provider?.state}</span></span></div>
            {studio.provider?.reference && (
              <div className="flex gap-2"><span className="text-muted-foreground w-40 shrink-0">Reference</span>
                <span className="font-mono text-[11px]">{studio.provider.reference}</span></div>
            )}
          </div>
          {studio.home_route && <p className="mt-4 text-[11px] text-muted-foreground"><ExternalLink className="mr-1 inline h-3 w-3" />The workspace is where operational actions happen; this brief records its scope and evidence boundary.</p>}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/60" data-testid="studio-operating-brief">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Technician operating brief</p>
              <p className="mt-1 text-sm font-medium">Start with what Nexus can evidence today.</p>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">This keeps the Studio useful during delivery: live operating areas, the correct workspace and the next declared capability constraint stay together instead of being inferred from an empty tab.</p>
            </div>
            <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/5 text-emerald-500 text-[10px]">{wiredTabs.length} live area{wiredTabs.length === 1 ? "" : "s"}</Badge>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <BriefItem label="Work now">
              {studio.home_route ? <a className="inline-flex items-center gap-1 font-medium text-primary hover:underline" href={studio.home_route}>Open operational workspace <ArrowUpRight className="h-3 w-3" /></a> : "No operational workspace is admitted yet"}
            </BriefItem>
            <BriefItem label="Evidence available">
              {wiredTabs.length ? wiredTabs.map(([tab]) => tab).join(" · ") : "No evidence-backed area is registered yet"}
            </BriefItem>
            <BriefItem label="Next delivery constraint">
              {nextConstraint ? `${nextConstraint[0]} — ${nextConstraint[1]?.summary || STATE_LABEL[nextConstraint[1]?.state] || "admission required"}` : "All registered Studio areas are wired"}
            </BriefItem>
          </div>
        </CardContent>
      </Card>

      {endpoint && (
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Live provider health</p>
            {loading && <Loading />}
            {!loading && error && <EndpointError error={error} onRetry={reload} />}
            {!loading && !error && data && (
              <div className="space-y-1 text-xs" data-testid="studio-overview-health">
                <p className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${data.configured ? "bg-emerald-500" : "bg-yellow-500"}`} />
                  {data.configured
                    ? `${(data.connections || []).length} connection(s) configured`
                    : "No connection configured — execution requests are refused, never simulated as success."}
                </p>
                {(data.connections || []).map((conn) => (
                  <p key={conn.server_id || conn.name} className="text-muted-foreground pl-4">
                    {conn.name || conn.host}: health <span className="uppercase">{conn.health}</span>
                    {conn.error ? ` — ${conn.error}` : ""}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {admission ? (
        <details className="rounded-xl border border-border/60 bg-card/50" data-testid="studio-admission-contract">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-medium marker:hidden">
            <span>Scope, controls and evidence</span>
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Review contract</span>
          </summary>
          <CardContent className="space-y-3 border-t border-border/60 pt-5">
            <p className="text-xs leading-relaxed text-muted-foreground">Use this when scoping a change, checking required access, or explaining exactly what this Studio can and cannot claim.</p>
            <div className="grid gap-3 text-xs">
              <Field label="Customer problem" value={admission.problem} />
              <Field label="Canonical objects" value={(admission.objects || []).join(", ")} mono />
              <Field label="Provider contracts" value={(admission.provider_contracts || []).join(", ")} mono />
              <Field label="Permissions" value={(admission.permissions || []).join(", ") || "none registered yet"} mono />
              <Field label="Scopes / audit / retention" value={admission.scopes_audit_retention} />
              <Field label="Verification / rollback / failure" value={admission.verification_rollback_failure} />
              <Field label="Commercial source" value={admission.commercial} />
              <Field label="Release gate" value={admission.release_gate} />
              <Field label="Test plan" value={admission.test_plan} />
              <Field label="Documentation" value={admission.documentation} mono />
            </div>
          </CardContent>
        </details>
      ) : (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-5">
            <p className="text-sm font-medium mb-1">Admission is open — this studio is not active implementation</p>
            <p className="text-xs text-muted-foreground">
              Per the capability admission gate, {studio.name} cannot start as a workspace until it
              names its provider contracts, verification behaviour and accountable owner. It stays
              <span className="font-medium"> {studio.status}</span> until then.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BriefItem({ label, children }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-background/35 p-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <div className="mt-1.5 text-xs leading-relaxed">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-52 shrink-0">{label}</span>
      <span className={mono ? "font-mono text-[11px] break-all" : ""}>{value}</span>
    </div>
  );
}

function StudioWorkbench({ wiredTabs, pendingTabs, onSelectTab }) {
  const nextCapability = pendingTabs[0];

  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)]" aria-label="Studio workbench" data-testid="studio-workbench">
      <Card className="border-cyan-500/20 bg-[linear-gradient(135deg,rgba(6,182,212,0.07),rgba(15,23,42,0.22))]">
        <CardContent className="p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Technician workbench</p>
              <h2 className="mt-1 text-base font-semibold tracking-tight">Work from evidence, not empty screens</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">Choose a live area to review recorded evidence. Nexus only exposes a capability here when its provider, scope and evidence contract are registered.</p>
            </div>
            <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-100">{wiredTabs.length} live areas</Badge>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {wiredTabs.map(([tabId]) => (
              <Button key={tabId} type="button" size="sm" variant="outline" className="border-cyan-500/20 bg-background/35 hover:border-cyan-400/45" onClick={() => onSelectTab(tabId)} data-testid={`studio-workbench-open-${tabId}`}>
                <Compass className="mr-1.5 h-3.5 w-3.5 text-cyan-200" />{tabId.charAt(0).toUpperCase() + tabId.slice(1)}
              </Button>
            ))}
            {wiredTabs.length === 0 && <span className="text-xs text-muted-foreground">No evidence-backed operating area is registered yet.</span>}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/65">
        <CardContent className="p-4 md:p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/30"><ListChecks className="h-4 w-4 text-muted-foreground" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Delivery status</p>
              <p className="mt-1 text-sm font-semibold tracking-tight">{nextCapability ? `Next: ${nextCapability[0]}` : "All registered areas are wired"}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{nextCapability ? nextCapability[1]?.summary : "Continue validating the existing operating flows against live tenant evidence."}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/* ------------------------------- Activity -------------------------------- */

function ActivityPanel({ studio, spec }) {
  const { loading, data, error, reload } = useEndpoint(spec.endpoint);
  // Memoised so the filter below keeps a stable dependency across renders.
  const subjects = useMemo(() => spec.subjects || [], [spec.subjects]);

  const rows = useMemo(() => {
    if (!Array.isArray(data)) return [];
    return data
      .filter((event) => subjects.some((prefix) => String(event?.subject || "").startsWith(prefix)))
      .slice(0, 50);
  }, [data, subjects]);

  return (
    <Panel studio={studio} spec={spec}>
      <div className="space-y-3" data-testid="studio-activity">
        <p className="text-xs text-muted-foreground">
          Scoped platform events filtered to this studio's registered subjects
          ({subjects.join(", ")}) — window: latest {Array.isArray(data) ? data.length : 0} scoped events.
        </p>
        {loading && <Loading />}
        {!loading && error && <EndpointError error={error} onRetry={reload} />}
        {!loading && !error && rows.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="pt-4 text-xs text-muted-foreground">
              No events with this studio's subjects appeared in the recent scoped window. That is an
              empty observation, not a claim that nothing happened outside the window.
            </CardContent>
          </Card>
        )}
        {!loading && rows.length > 0 && (
          <div className="space-y-1">
            {rows.map((event) => (
              <div key={event.id} className="flex items-start gap-3 text-xs py-1.5 border-b border-border/40 last:border-0">
                <span className="font-mono text-[11px] text-muted-foreground w-44 shrink-0">{event.subject}</span>
                <span className="flex-1">{event.payload?.summary || event.payload?.detail || ""}</span>
                <span className="text-muted-foreground text-[11px] shrink-0">{event.actor?.name || event.source}</span>
                <span className="text-muted-foreground text-[11px] shrink-0">{String(event.occurred_at || "").replace("T", " ").slice(0, 16)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ---------------------- Adopted workspace projections --------------------- */

// One panel per projected question a studio tab may adopt. The endpoint decides
// which one renders; an endpoint nobody models is not silently given a panel
// that would describe it wrongly.
const OBSERVATION_PANELS = {
  "device-estate": DeviceEstatePanel,
  "agent-fleet": AgentFleetPanel,
  "client-estate": ClientEstatePanel,
  "client-portfolio": ClientPortfolioPanel,
  "client-renewal-watch": ClientRenewalWatchPanel,
  "backup-recovery": BackupRecoveryPanel,
  "backup-verification": BackupVerificationPanel,
  "microsoft-studio": MicrosoftStudioPanel,
  "microsoft-evidence": MicrosoftEvidencePanel,
  "microsoft-operations": MicrosoftOperationsPanel,
  "m365-tenants": M365TenantPanel,
  "monitoring-pulse": MonitoringPulsePanel,
  "monitoring-resources": MonitoringResourcesPanel,
  "voice-estate": VoiceEstatePanel,
  "web-estate": WebEstatePanel,
  "network-operations": NetworkOperationsPanel,
  "network-evidence": NetworkEvidencePanel,
  "network-sites": NetworkSitesPanel,
  "patch-posture": PatchPosturePanel,
  "proxmox-operations": ProxmoxOperationsPanel,
  "security-posture": SecurityPosturePanel,
  "soc-alerts": SocAlertsPanel,
  "lead-pipeline": LeadPipelinePanel,
  "documentation-inventory": DocumentationInventoryPanel,
  "communications-csat": CommunicationsPanel,
};

function StudioObservationPanel({ studio, spec }) {
  const PanelComponent = OBSERVATION_PANELS[studioObservationView(spec?.endpoint)];
  if (!PanelComponent) return <EndpointTab studio={studio} spec={spec} />;
  return <PanelComponent studio={studio} spec={spec} />;
}

/* -------------------------- Generic wired tabs ---------------------------- */

function RemoteSessionsPanel({ studio, spec }) {
  const { loading, data, error, reload } = useEndpoint(spec.endpoint);
  const sessions = Array.isArray(data) ? data : [];

  return (
    <Panel studio={studio} spec={spec}>
      <div className="space-y-3" data-testid="remote-sessions-panel">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-sm font-semibold tracking-tight">Governed session inventory</p>
            <p className="mt-1 text-xs text-muted-foreground">Tenant-scoped session evidence. Start, control and close sessions in Nexus Remote.</p>
          </div>
          <Button size="sm" variant="outline" asChild><a href="/nexus-remote">Open Nexus Remote <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></a></Button>
        </div>
        {loading && <Loading />}
        {!loading && error && <EndpointError error={error} onRetry={reload} />}
        {!loading && !error && sessions.length === 0 && (
          <Card className="border-dashed" data-testid="remote-sessions-empty">
            <CardContent className="py-8 text-center text-xs text-muted-foreground">No governed remote sessions are recorded in the current tenant scope.</CardContent>
          </Card>
        )}
        {!loading && !error && sessions.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border/60" data-testid="remote-sessions-list">
            {sessions.map((session, index) => {
              const active = ["authorised", "active", "ending"].includes(String(session.status || "").toLowerCase());
              return (
                <div key={session.id || session.session_id || index} className="grid gap-2 border-b border-border/50 px-4 py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{session.device_name || session.device_id || "Managed endpoint"}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{session.technician_name || session.user_name || session.user_id || "Technician not recorded"} · {String(session.started_at || session.created_at || "Recorded session").replace("T", " ").slice(0, 16)}</p>
                  </div>
                  <Badge variant="outline" className={active ? "w-fit border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : "w-fit border-border/80 text-muted-foreground"}>{session.status || "recorded"}</Badge>
                  <span className="text-[11px] text-muted-foreground sm:text-right">{session.mode || session.session_type || "remote desktop"}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}

function JsonPanel({ children }) {
  return (
    <Card>
      <CardContent className="pt-4 text-xs font-mono whitespace-pre-wrap max-h-96 overflow-auto">
        {children}
      </CardContent>
    </Card>
  );
}

function EndpointTab({ studio, spec }) {
  const { loading, data, error, reload } = useEndpoint(spec.endpoint);

  // Node-shaped inventories render as a table; anything else is shown as the
  // raw observed payload so the shell never paraphrases data it does not model.
  const isNodeList = spec.endpoint === "/proxmox/nodes";

  return (
    <Panel studio={studio} spec={spec}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Reads <span className="font-mono">{spec.endpoint}</span> — observed data with server-side scope.</p>
        {loading && <Loading />}
        {!loading && error && <EndpointError error={error} onRetry={reload} />}
        {!loading && !error && (
          isNodeList ? (
            Array.isArray(data) && data.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="pt-4 text-xs text-muted-foreground" data-testid="studio-inventory-empty">
                  No nodes observed. This endpoint returns live provider state, so an empty list means
                  nothing is configured or observed yet — never demo inventory.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-1" data-testid="studio-inventory">
                {(data || []).map((node) => (
                  <div key={node.id || node.name} className="flex items-center gap-3 text-xs py-1.5 border-b border-border/40 last:border-0">
                    <span className={`w-2 h-2 rounded-full ${node.status === "online" ? "bg-emerald-500" : "bg-yellow-500"}`} />
                    <span className="font-medium">{node.name}</span>
                    <span className="text-muted-foreground">CPU {node.cpu_usage}% · RAM {node.memory_usage}% · Disk {node.disk_usage}%</span>
                    <span className="text-muted-foreground ml-auto text-[11px]">{node.vm_count} guests · observed {String(node.observed_at || "").replace("T", " ").slice(0, 16)}</span>
                  </div>
                ))}
              </div>
            )
          ) : <JsonPanel>{JSON.stringify(data, null, 2)}</JsonPanel>
        )}
      </div>
    </Panel>
  );
}

/* --------------------------------- Shell --------------------------------- */

export default function StudioShell({ studioId }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [studio, setStudio] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await axios.get(`${API}/studios/${studioId}`, { headers });
      setStudio(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, `Studio '${studioId}' is not part of the fleet.`));
    }
  }, [studioId, headers]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="space-y-4" data-testid="studio-not-found">
        <OperationalPageHeader eyebrow="Studio fleet" title="Studio not found" description={error} icon={ShieldAlert} tone="amber" />
        <Button asChild variant="outline"><a href="/studios"><ArrowLeft className="w-4 h-4 mr-1" />Back to Nexus Studios</a></Button>
      </div>
    );
  }

  if (!studio) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading {studioId} Studio…
      </div>
    );
  }

  const wiredCount = Object.values(studio.tabs).filter((tab) => tab.state === "wired").length;
  const unwiredCount = studio.spine.length - wiredCount;
  const wiredTabs = studio.spine
    .filter((tabId) => studio.tabs[tabId]?.state === "wired")
    .map((tabId) => [tabId, studio.tabs[tabId]]);
  const pendingTabs = studio.spine
    .filter((tabId) => studio.tabs[tabId]?.state !== "wired")
    .map((tabId) => [tabId, studio.tabs[tabId]]);
  const firstWiredTab = studio.spine.find((tabId) => tabId !== "overview" && studio.tabs[tabId]?.state === "wired");
  const microsoftStudio = studio.id === "m365";

  return (
    <div className="space-y-6" data-testid="studio-shell" data-studio={studio.id}>
      <OperationalPageHeader
        eyebrow={`${microsoftStudio ? studio.name : `${studio.domain} Studio`} · ${wiredCount}/${studio.spine.length} areas ready`}
        title={studio.name}
        description={studio.tagline}
        icon={Sparkles}
        tone="cyan"
        signal={microsoftStudio ? "attention" : studio.admission ? "ready" : "attention"}
        signalLabel={microsoftStudio ? "Evidence connection required" : undefined}
        signalDescription={microsoftStudio ? "A configured connection is not evidence until the Microsoft collector has completed a verified read." : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {studio.home_route ? <Button asChild><a href={studio.home_route}><Wrench className="mr-1 h-4 w-4" />Open workspace</a></Button> : null}
            <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
            <Button variant="outline" asChild><a href="/studios"><ArrowLeft className="w-4 h-4 mr-1" />All Studios</a></Button>
          </div>
        }
      />

      <section className="grid gap-3 md:grid-cols-[1fr_auto]" data-testid="studio-readiness-strip">
        <Card className="border-border/60 bg-card/65">
          <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3.5">
            <span className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-chip-emerald" />{wiredCount} areas ready</span>
            <span className="text-xs text-muted-foreground">{unwiredCount ? `${unwiredCount} disclosed as not admitted yet` : "Every registered area is ready"}</span>
          </CardContent>
        </Card>
        {firstWiredTab ? (
          <Button variant="outline" className="h-auto min-h-12" onClick={() => setActiveTab(firstWiredTab)}>
            Review live evidence <ArrowUpRight className="ml-1.5 h-4 w-4" />
          </Button>
        ) : null}
      </section>

      <StudioWorkbench
        wiredTabs={wiredTabs}
        pendingTabs={pendingTabs}
        onSelectTab={setActiveTab}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-border/60 bg-muted/30 p-1.5">
          {studio.spine.map((tabId) => (
            <TabsTrigger key={tabId} value={tabId} className="text-xs gap-1.5" data-testid={`tab-${tabId}`}>
              {studio.tabs[tabId] ? studio.tabs[tabId].state === "wired" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> : null}
              {tabId.charAt(0).toUpperCase() + tabId.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>

        {studio.spine.map((tabId) => {
          const spec = studio.tabs[tabId];
          return (
            <TabsContent key={tabId} value={tabId}>
              {tabId === "overview" && spec?.state === "wired" && spec?.endpoint && studioObservationView(spec.endpoint)
                ? <StudioObservationPanel studio={studio} spec={spec} />
                : tabId === "overview"
                  ? <OverviewPanel studio={studio} />
                : spec?.state === "wired" && spec?.endpoint && fleetBaselineView(spec.endpoint)
                  ? <FleetBaselinePanel studio={studio} spec={spec} />
                  : spec?.state === "wired" && spec?.endpoint === "/remote/sessions"
                    ? <RemoteSessionsPanel studio={studio} spec={spec} />
                  : spec?.state === "wired" && spec?.endpoint && studioObservationView(spec.endpoint)
                    ? <StudioObservationPanel studio={studio} spec={spec} />
                    : spec?.state === "wired" && spec?.endpoint && spec?.subjects
                      ? <ActivityPanel studio={studio} spec={spec} />
                      : spec?.state === "wired" && spec?.endpoint
                        ? <EndpointTab studio={studio} spec={spec} />
                        : <NotWiredPanel studio={studio} spec={spec} />}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
