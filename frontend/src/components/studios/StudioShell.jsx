import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, ExternalLink, Loader2, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import FleetBaselinePanel, { fleetBaselineView } from "@/components/studios/FleetBaselinePanel";
import AgentFleetPanel from "@/components/studios/AgentFleetPanel";
import BackupRecoveryPanel from "@/components/studios/BackupRecoveryPanel";
import ClientEstatePanel from "@/components/studios/ClientEstatePanel";
import CommunicationsPanel from "@/components/studios/CommunicationsPanel";
import DeviceEstatePanel from "@/components/studios/DeviceEstatePanel";
import DocumentationInventoryPanel from "@/components/studios/DocumentationInventoryPanel";
import LeadPipelinePanel from "@/components/studios/LeadPipelinePanel";
import M365TenantPanel from "@/components/studios/M365TenantPanel";
import NetworkSitesPanel from "@/components/studios/NetworkSitesPanel";
import PatchPosturePanel from "@/components/studios/PatchPosturePanel";
import SecurityPosturePanel from "@/components/studios/SecurityPosturePanel";
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
  return (
    <Card data-testid={`tab-unwired-${state}`} className="border-dashed">
      <CardContent className="pt-5 max-w-2xl">
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">This tab is not wired for {studio.name} yet</span>
          <TabStateBadge state={state} />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {spec?.summary || "No capability contract is registered for this tab."}
        </p>
        {spec?.evidence && (
          <p className="text-[11px] text-muted-foreground mt-3 font-mono">Evidence: {spec.evidence}</p>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          A Studio tab only ever renders a registered, evidence-backed capability — an unmeasured
          dimension is disclosed here instead of being shown as a clean state.
        </p>
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

  return (
    <div className="space-y-4" data-testid="studio-overview">
      <Card>
        <CardContent className="pt-5">
          <p className="text-sm leading-relaxed">{studio.tagline}</p>
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
          {studio.home_route && (
            <Button asChild variant="outline" size="sm" className="mt-4 h-8 text-xs">
              <a href={studio.home_route}>
                <ExternalLink className="w-3 h-3 mr-1" /> Open the existing operating surface
              </a>
            </Button>
          )}
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
        <Card>
          <CardContent className="pt-5 space-y-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Admission contract</p>
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
        </Card>
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

function Field({ label, value, mono }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-52 shrink-0">{label}</span>
      <span className={mono ? "font-mono text-[11px] break-all" : ""}>{value}</span>
    </div>
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
  "backup-recovery": BackupRecoveryPanel,
  "m365-tenants": M365TenantPanel,
  "voice-estate": VoiceEstatePanel,
  "web-estate": WebEstatePanel,
  "network-sites": NetworkSitesPanel,
  "patch-posture": PatchPosturePanel,
  "security-posture": SecurityPosturePanel,
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
        <Button asChild variant="outline"><a href="/studios"><ArrowLeft className="w-4 h-4 mr-1" />Back to Studio Fleet</a></Button>
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

  return (
    <div className="space-y-6" data-testid="studio-shell" data-studio={studio.id}>
      <OperationalPageHeader
        eyebrow={`${studio.domain} studio · ${wiredCount}/${studio.spine.length} tabs wired`}
        title={studio.name}
        description={studio.tagline}
        icon={Sparkles}
        tone="cyan"
        signal={studio.admission ? "ready" : "attention"}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
            <Button variant="outline" asChild><a href="/studios"><ArrowLeft className="w-4 h-4 mr-1" />Fleet</a></Button>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto flex-wrap">
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
              {tabId === "overview"
                ? <OverviewPanel studio={studio} />
                : spec?.state === "wired" && spec?.endpoint && fleetBaselineView(spec.endpoint)
                  ? <FleetBaselinePanel studio={studio} spec={spec} />
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
