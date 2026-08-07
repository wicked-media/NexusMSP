import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { AlertTriangle, Check, CheckCircle2, ClipboardList, FileWarning, Flame, HardDrive, Loader2, MoreHorizontal, Plus, RefreshCw, Search, ShieldAlert, ShieldCheck, Siren } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const EMPTY = { summary: { deployed: 0, healthy: 0, pending: 0, triggered: 0, unresolved: 0 }, canaries: [], triggers: [] };
const STATUS_CLASS = {
  queued: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  active: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  healthy: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  triggered: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  failed: "border-rose-500/30 bg-rose-500/10 text-rose-200",
};

const displayTime = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toLocaleString() : "Not recorded";
};

const agentLabel = (agent) => `${agent.hostname || agent.id} | ${agent.client_name || agent.client_id || "Unassigned"}`;

function CanaryAgentPicker({ agents, value, query, onQueryChange, onChange, disabled, loading, onlineCount }) {
  const [focused, setFocused] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const selected = agents.find((agent) => agent.id === value);
  const matches = agents.filter((agent) => {
    if (!normalizedQuery) return true;
    return [
      agent.hostname,
      agent.id,
      agent.client_name,
      agent.client_id,
    ].some((field) => String(field || "").toLowerCase().includes(normalizedQuery));
  });

  return (
    <div className="space-y-2">
      <Label htmlFor="canary-agent-search">Online unprotected endpoint</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          id="canary-agent-search"
          className="pl-9"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setFocused(true);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          placeholder={loading ? "Loading online endpoints..." : "Search by endpoint, client or agent ID"}
          autoComplete="off"
          disabled={disabled || loading || agents.length === 0}
          data-testid="canary-agent-search"
        />
        {focused && !disabled && !loading && agents.length > 0 && (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-white/10 bg-slate-950 p-1.5 shadow-2xl shadow-black/50">
            {matches.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matching unprotected endpoints</p>
            ) : matches.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-100 transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(agent.id);
                  onQueryChange(agentLabel(agent));
                  setFocused(false);
                }}
                data-testid={`canary-agent-option-${agent.id}`}
              >
                <span>
                  <span className="block font-medium">{agent.hostname || agent.id}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{agent.client_name || agent.client_id || "Unassigned client"}</span>
                </span>
                {agent.id === value && <Check className="h-4 w-4 shrink-0 text-emerald-300" />}
              </button>
            ))}
          </div>
        )}
      </div>
      {selected ? (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2.5" data-testid="canary-selected-agent">
          <div>
            <p className="text-sm font-medium text-emerald-100">{selected.hostname || selected.id}</p>
            <p className="mt-0.5 text-xs text-emerald-100/65">{selected.client_name || selected.client_id || "Unassigned client"} · Agent online</p>
          </div>
          <CheckCircle2 className="h-5 w-5 text-emerald-300" />
        </div>
      ) : !loading && agents.length === 0 ? (
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.05] p-3 text-sm text-sky-100" data-testid="canary-no-eligible-agents">
          {onlineCount > 0
            ? "Every online Windows endpoint is already protected by Nexus Canary."
            : "No online Windows Nexus Agents are currently eligible for deployment."}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Choose the client endpoint that should receive the protected decoy.</p>
      )}
    </div>
  );
}

export function NexusCanaryPanel({ embedded = false }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [deployOpen, setDeployOpen] = useState(false);
  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState("");
  const [agentQuery, setAgentQuery] = useState("");
  const [onlineAgentCount, setOnlineAgentCount] = useState(0);
  const [filePath, setFilePath] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [resolving, setResolving] = useState(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await axios.get(`${API}/ransomware-canary/status`, { headers });
      setData(response.data || EMPTY);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Ransomware canary telemetry could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const openDeploy = async () => {
    setDeployOpen(true);
    setDeploying(true);
    setAgentId("");
    setAgentQuery("");
    try {
      const response = await axios.get(`${API}/nexus-agent/agents`, { headers });
      const onlineWindows = (response.data || []).filter((agent) => {
        const platform = String(agent.os_name || agent.os || "").toLowerCase();
        return agent.online && agent.is_active !== false && (!platform || platform.includes("windows"));
      });
      const protectedAgentIds = new Set(
        (data.canaries || [])
          .filter((canary) => ["queued", "active", "healthy", "triggered"].includes(canary.status))
          .map((canary) => canary.agent_id),
      );
      const eligible = onlineWindows.filter((agent) => !protectedAgentIds.has(agent.id));
      setOnlineAgentCount(onlineWindows.length);
      setAgents(eligible);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Online Nexus Agents could not be loaded");
      setAgents([]);
      setOnlineAgentCount(0);
    } finally {
      setDeploying(false);
    }
  };

  const deploy = async () => {
    if (!agentId) {
      toast.error("Choose an online Nexus Agent");
      return;
    }
    setActing(true);
    try {
      const response = await axios.post(`${API}/ransomware-canary/deploy`, { agent_id: agentId, file_path: filePath.trim() || undefined }, { headers });
      toast.success(`Canary deployment queued for ${response.data?.canary?.device_name || "the selected endpoint"}`);
      setDeployOpen(false);
      setFilePath("");
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Canary deployment could not be queued");
    } finally {
      setActing(false);
    }
  };

  const resolveTrigger = async () => {
    if (!resolving || resolutionNote.trim().length < 8) {
      toast.error("Record an investigation note of at least 8 characters");
      return;
    }
    setActing(true);
    try {
      await axios.post(`${API}/ransomware-canary/triggers/${encodeURIComponent(resolving.id)}/resolve`, { note: resolutionNote.trim() }, { headers });
      toast.success("Canary alert resolved and audited");
      setResolving(null);
      setResolutionNote("");
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Canary alert could not be resolved");
    } finally {
      setActing(false);
    }
  };

  const summary = data.summary || EMPTY.summary;
  const unresolved = (data.triggers || []).filter((trigger) => !trigger.resolved);

  return (
    <div className="space-y-6" data-testid="ransomware-canary">
      {!embedded && <OperationalPageHeader
        eyebrow="Nexus Shield | active endpoint detection"
        title="Nexus Canary"
        description="Deploy, verify and investigate branded endpoint canary files through Nexus Agent. A changed or missing fingerprint creates an auditable ransomware response signal."
        icon={Flame}
        tone="rose"
        actions={<>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm"><MoreHorizontal className="mr-1 h-4 w-4" />Workspace</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => navigate("/ransomware-tabletop")}><ClipboardList className="mr-2 h-4 w-4" />Tabletop exercises</DropdownMenuItem><DropdownMenuItem onClick={() => navigate("/remediation-playbooks")}><FileWarning className="mr-2 h-4 w-4" />Response playbooks</DropdownMenuItem><DropdownMenuItem onClick={() => navigate("/dr-plans")}><HardDrive className="mr-2 h-4 w-4" />Disaster recovery plans</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh telemetry</Button>
          <Button size="sm" onClick={openDeploy}><Plus className="mr-1 h-4 w-4" />Deploy canary</Button>
        </>}
      />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroTile label="Deployed canaries" value={summary.deployed || 0} icon={ShieldCheck} glow="sky" subtitle="Registered with Nexus Agent" animated={false} />
        <HeroTile label="Integrity healthy" value={summary.healthy || 0} icon={CheckCircle2} glow={summary.healthy ? "emerald" : "zinc"} subtitle="Latest agent verification" animated={false} />
        <HeroTile label="Pending deployment" value={summary.pending || 0} icon={Loader2} glow={summary.pending ? "amber" : "zinc"} subtitle="Queued or awaiting first check" animated={false} />
        <HeroTile label="Open ransomware signals" value={summary.unresolved || 0} icon={Siren} glow={summary.unresolved ? "rose" : "zinc"} subtitle="Integrity changes needing review" animated={Boolean(summary.unresolved)} />
      </div>

      {unresolved.length > 0 && <Card className="border-rose-500/35 bg-rose-500/[0.06]" data-testid="canary-alert"><CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex gap-3"><ShieldAlert className="mt-0.5 h-7 w-7 shrink-0 text-rose-300" /><div><p className="font-semibold text-rose-100">Canary integrity signal detected</p><p className="mt-1 text-sm text-rose-100/75">{unresolved.length} endpoint {unresolved.length === 1 ? "signal requires" : "signals require"} investigation. Isolation is deliberately not automatic. Use the verified response playbook before taking disruptive action.</p></div></div><Button variant="destructive" onClick={() => navigate("/remediation-playbooks")}><FileWarning className="mr-1 h-4 w-4" />Open response playbook</Button></CardContent></Card>}

      <Card><CardHeader className="flex-row items-center justify-between gap-3 space-y-0"><div><CardTitle className="text-base">Nexus Canary sensors</CardTitle><p className="mt-1 text-sm text-muted-foreground">The agent writes the decoy, stores its expected SHA-256 locally and reports only its integrity state.</p></div><div className="flex shrink-0 items-center gap-2">{embedded && <Button size="sm" onClick={openDeploy}><Plus className="mr-1 h-4 w-4" />Deploy canary</Button>}<Badge variant="outline" className="border-sky-500/30 text-sky-200">30-second agent check</Badge></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Endpoint</TableHead><TableHead>Client</TableHead><TableHead>Canary path</TableHead><TableHead>State</TableHead><TableHead>Last verification</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={5} className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow> : (data.canaries || []).length === 0 ? <TableRow><TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">No Nexus Canary sensors are deployed. Choose an online Nexus Agent to start protected monitoring.</TableCell></TableRow> : (data.canaries || []).map((canary) => <TableRow key={canary.id} className={canary.status === "triggered" ? "bg-rose-500/[0.05]" : ""}><TableCell><p className="font-medium">{canary.device_name || canary.agent_id}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{canary.agent_id}</p></TableCell><TableCell className="text-sm text-muted-foreground">{canary.client_name || "Unassigned client"}</TableCell><TableCell className="max-w-sm truncate font-mono text-xs" title={canary.file_path}>{canary.file_path}</TableCell><TableCell><Badge variant="outline" className={`text-[10px] uppercase ${STATUS_CLASS[canary.status] || STATUS_CLASS.queued}`}>{String(canary.status || "queued").replace(/_/g, " ")}</Badge>{canary.deployment_error && <p className="mt-1 max-w-48 truncate text-[10px] text-rose-200" title={canary.deployment_error}>{canary.deployment_error}</p>}</TableCell><TableCell className="text-xs text-muted-foreground">{displayTime(canary.last_verified || canary.deployed_at || canary.created_at)}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>

      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-rose-300" />Ransomware response signals</CardTitle></CardHeader><CardContent className="space-y-3">{(data.triggers || []).length === 0 ? <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4 text-sm text-emerald-100">No integrity changes have been reported. Each deployed canary is checked by its agent and sends an audited signal if it is changed or removed.</div> : (data.triggers || []).map((trigger) => <div key={trigger.id} className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2"><Badge variant="outline" className={trigger.resolved ? "border-emerald-500/30 text-emerald-200" : "border-rose-500/30 text-rose-200"}>{trigger.resolved ? "Resolved" : "Investigation required"}</Badge><span className="text-xs text-muted-foreground">{displayTime(trigger.triggered_at)}</span></div><p className="mt-2 font-medium">{trigger.device_name || "Managed endpoint"} <span className="font-normal text-muted-foreground">| {trigger.file_path}</span></p><p className="mt-1 text-sm text-muted-foreground">{trigger.reason || "Canary integrity changed"}</p>{trigger.resolution_note && <p className="mt-2 rounded-md bg-background/50 p-2 text-xs text-muted-foreground">Resolution: {trigger.resolution_note}</p>}</div>{!trigger.resolved && <Button variant="outline" size="sm" onClick={() => { setResolving(trigger); setResolutionNote(""); }}><CheckCircle2 className="mr-1 h-4 w-4" />Resolve with note</Button>}</div>)}</CardContent></Card>

      <Card className="border-sky-500/15 bg-sky-500/[0.025]"><CardContent className="p-4 text-sm text-muted-foreground"><p><strong className="text-sky-100">Operational boundary.</strong> A canary is an early-warning signal, not a substitute for EDR, immutable backups or an incident-response plan. A changed canary creates an audited signal; technicians choose and record the appropriate containment action from the response playbook.</p></CardContent></Card>

      <Dialog open={deployOpen} onOpenChange={setDeployOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Flame className="h-5 w-5 text-rose-300" />Deploy Nexus Canary</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Nexus Agent creates a small decoy text file, stores its expected fingerprint locally, and reports changes every 30 seconds. The file contents never leave the endpoint.</p>
            <CanaryAgentPicker
              agents={agents}
              value={agentId}
              query={agentQuery}
              onQueryChange={setAgentQuery}
              onChange={setAgentId}
              disabled={acting}
              loading={deploying}
              onlineCount={onlineAgentCount}
            />
            <div>
              <Label htmlFor="canary-path">Canary path (optional)</Label>
              <Input id="canary-path" className="mt-1 font-mono text-xs" value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder="Default: C:\\Users\\Public\\Documents\\NexusMSP-[id]-Canary.txt" />
              <p className="mt-1 text-xs text-muted-foreground">Use an absolute Windows .txt path. Leave blank for the protected public-documents default.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeployOpen(false)} disabled={acting}>Cancel</Button>
              <Button onClick={deploy} disabled={acting || deploying || !agentId}>{acting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Queue protected canary</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolving} onOpenChange={(open) => !open && setResolving(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Resolve ransomware response signal</DialogTitle></DialogHeader><div className="space-y-4"><p className="text-sm text-muted-foreground">Resolution closes the current investigation record; it does not overwrite the endpoint canary fingerprint or suppress future integrity changes.</p><div><Label htmlFor="canary-resolution-note">Investigation and containment note</Label><Textarea id="canary-resolution-note" className="mt-1" rows={4} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="Record what changed, checks performed, containment action and outcome." /></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setResolving(null)} disabled={acting}>Cancel</Button><Button onClick={resolveTrigger} disabled={acting || resolutionNote.trim().length < 8}>{acting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Resolve and audit</Button></div></div></DialogContent></Dialog>
    </div>
  );
}

export default function RansomwareCanaryPage() {
  return <NexusCanaryPanel />;
}
