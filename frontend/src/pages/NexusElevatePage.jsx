import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  CheckCircle2, CircleAlert, Clock3, ExternalLink, FileKey2, HelpCircle,
  Loader2, MonitorCog, RefreshCw, Search, ShieldCheck, ShieldX, TimerReset,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import ElevatePolicyWorkspace from "@/components/nexus-elevate/ElevatePolicyWorkspace";

const EMPTY_OVERVIEW = {
  settings: { native_enabled: true, max_duration_minutes: 15, keeper_bridge_enabled: false },
  summary: { pending: 0, approved: 0, expiring_soon: 0, failed_or_expired: 0, native_agent_coverage: 0, native_agents_online: 0, companion_agents_ready: 0, companion_agents_online: 0, elevate_active: 0, elevate_deploying: 0, keeper_bridge_requests: 0, active_policies: 0, enforced_policies: 0 },
  recent_requests: [],
};

const STATUS_STYLE = {
  pending: "border-amber-500/30 bg-amber-500/15 text-amber-200",
  approved: "border-sky-500/30 bg-sky-500/15 text-sky-200",
  executed: "border-emerald-500/30 bg-emerald-500/15 text-emerald-200",
  denied: "border-zinc-500/30 bg-zinc-500/15 text-zinc-300",
  failed: "border-rose-500/30 bg-rose-500/15 text-rose-200",
  expired: "border-rose-500/30 bg-rose-500/15 text-rose-200",
};

const safeDate = (value) => {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.valueOf()) ? parsed : null;
};

const displayTime = (value) => safeDate(value)?.toLocaleString() || "Not recorded";

export default function NexusElevatePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const endpointScope = searchParams.get("device") || "";
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [decision, setDecision] = useState("approve");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("15");
  const [acting, setActing] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companionAgents, setCompanionAgents] = useState([]);
  const [companionScope, setCompanionScope] = useState("all");
  const [companionAgentId, setCompanionAgentId] = useState("");
  const [companionLoading, setCompanionLoading] = useState(false);
  const [companionDeploying, setCompanionDeploying] = useState(false);
  const [policyCount, setPolicyCount] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [overviewResult, requestsResult] = await Promise.all([
        axios.get(`${API}/nexus-elevate/overview`, { headers }),
        axios.get(`${API}/nexus-elevate/requests`, { headers, params: endpointScope ? { device_id: endpointScope } : undefined }),
      ]);
      setOverview(overviewResult.data || EMPTY_OVERVIEW);
      setRequests(requestsResult.data?.requests || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus Elevate could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [headers, endpointScope]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const refreshQueue = () => {
      if (document.visibilityState === "visible") load({ quiet: true });
    };
    const interval = window.setInterval(refreshQueue, 15000);
    document.addEventListener("visibilitychange", refreshQueue);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshQueue);
    };
  }, [load]);

  const openRequest = useCallback(async (request) => {
    setSelected(request);
    setDetail(null);
    setReason("");
    setDecision("approve");
    setDuration(String(overview.settings?.max_duration_minutes || 15));
    try {
      const response = await axios.get(`${API}/nexus-elevate/requests/${encodeURIComponent(request.id)}`, { headers });
      setDetail(response.data);
      setSelected(response.data.request || request);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Request details could not be loaded");
    }
  }, [headers, overview.settings?.max_duration_minutes]);

  useEffect(() => {
    const requestedStatus = searchParams.get("status");
    if (requestedStatus && ["pending", "approved", "executed", "denied", "failed", "expired"].includes(requestedStatus)) {
      setStatus(requestedStatus);
    }
    const requestId = searchParams.get("request");
    if (!requestId || !requests.length || selected?.id === requestId) return;
    const request = requests.find((item) => item.id === requestId);
    if (request) openRequest(request);
  }, [openRequest, requests, searchParams, selected?.id]);

  const openCompanionRollout = async () => {
    setCompanionOpen(true);
    setCompanionLoading(true);
    try {
      const response = await axios.get(`${API}/nexus-agent/agents`, { headers });
      const online = (response.data || []).filter((agent) => agent.online);
      setCompanionAgents(online);
      if (!companionAgentId && online[0]?.id) setCompanionAgentId(online[0].id);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Online Nexus Agents could not be loaded");
    } finally {
      setCompanionLoading(false);
    }
  };

  const deployCompanion = async () => {
    if (companionScope === "one" && !companionAgentId) {
      toast.error("Choose an online Nexus Agent");
      return;
    }
    const targetDescription = companionScope === "all" ? "all online, updated agents" : "the selected agent";
    if (!window.confirm(`Deploy the Nexus Client Chat companion to ${targetDescription}? The service will download the signed companion but will not launch it in the customer session.`)) return;
    setCompanionDeploying(true);
    try {
      const response = await axios.post(`${API}/nexus-agent/companions/deploy`, {
        all_online: companionScope === "all",
        device_ids: companionScope === "one" ? [companionAgentId] : [],
      }, { headers });
      toast.success(`Companion rollout queued to ${response.data?.queued || 0} endpoint${response.data?.queued === 1 ? "" : "s"}`);
      setCompanionOpen(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || "The companion rollout could not be queued");
    } finally {
      setCompanionDeploying(false);
    }
  };

  const decide = async () => {
    if (!selected) return;
    if (reason.trim().length < 8) {
      toast.error("Record a decision reason of at least 8 characters");
      return;
    }
    setActing(true);
    try {
      const endpoint = decision === "approve" ? "approve" : "deny";
      const payload = decision === "approve" ? { reason, duration_minutes: Number(duration) } : { reason };
      const response = await axios.post(`${API}/nexus-elevate/requests/${encodeURIComponent(selected.id)}/${endpoint}`, payload, { headers });
      const updated = response.data?.request;
      toast.success(decision === "approve" ? "Elevation approved and securely queued to the endpoint" : "Elevation request denied and audited");
      setSelected(null);
      setDetail(null);
      if (updated) setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || `Could not ${decision} the elevation request`);
    } finally {
      setActing(false);
    }
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return requests
      .filter((request) => status === "all" || request.status === status)
      .filter((request) => !query || [request.program_name, request.program_path, request.hostname, request.client_name, request.requested_by_name, request.publisher, request.ticket_id].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [requests, search, status]);

  const summary = overview.summary || EMPTY_OVERVIEW.summary;
  const settings = overview.settings || EMPTY_OVERVIEW.settings;
  const selectedStatus = selected?.status;
  const canDecide = selectedStatus === "pending";
  const jumpToPolicies = () => document.getElementById("nexus-elevate-policies")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const updatePolicyCount = useCallback((policies) => setPolicyCount(policies.filter((policy) => policy.enabled).length), []);

  return (
    <div className="space-y-6" data-testid="nexus-elevate-page">
      <OperationalPageHeader
        eyebrow="Endpoint security - controlled privilege"
        title="Nexus Elevate"
        description="A native, hash-pinned service-launch approval workflow for enrolled Windows Nexus Agents. It supports precise unattended executable tasks; it does not grant an endpoint user interactive or permanent administrator access."
        icon={ShieldCheck}
        tone="emerald"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => navigate("/help/nexus-elevate-setup")}><HelpCircle className="mr-1 h-4 w-4" />Setup guide</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/settings?tab=integrations&anchor=nexus-elevate-settings-card")}><FileKey2 className="mr-1 h-4 w-4" />Settings</Button>
          <Button variant="outline" size="sm" onClick={jumpToPolicies}><ShieldCheck className="mr-1 h-4 w-4" />Policies</Button>
          <Button variant="outline" size="sm" onClick={openCompanionRollout}><MonitorCog className="mr-1 h-4 w-4" />Companion repair</Button>
          <Button size="sm" onClick={() => load()} disabled={loading}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh queue</Button>
        </>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-7">
        <HeroTile label="Awaiting review" value={summary.pending} icon={CircleAlert} glow={summary.pending ? "amber" : "zinc"} subtitle="Needs an approver" onClick={() => setStatus("pending")} active={status === "pending"} testId="nexus-elevate-pending-tile" />
        <HeroTile label="Approved launch" value={summary.approved} icon={Clock3} glow={summary.approved ? "sky" : "zinc"} subtitle="Queued or time-bound" onClick={() => setStatus("approved")} active={status === "approved"} testId="nexus-elevate-approved-tile" />
        <HeroTile label="Expiring soon" value={summary.expiring_soon} icon={TimerReset} glow={summary.expiring_soon ? "amber" : "zinc"} subtitle="Within ten minutes" onClick={() => setStatus("approved")} testId="nexus-elevate-expiring-tile" />
        <HeroTile label="Execution exceptions" value={summary.failed_or_expired} icon={ShieldX} glow={summary.failed_or_expired ? "rose" : "zinc"} subtitle="Failures and expired requests" onClick={() => setStatus("failed")} active={status === "failed"} testId="nexus-elevate-failed-tile" />
        <HeroTile label="Elevate active" value={`${summary.elevate_active || 0}/${summary.native_agent_coverage || 0}`} icon={MonitorCog} glow={summary.elevate_active ? "emerald" : "zinc"} subtitle={summary.elevate_deploying ? `${summary.elevate_deploying} companion deployment${summary.elevate_deploying === 1 ? "" : "s"} queued` : `${summary.companion_agents_online || 0} active companion${summary.companion_agents_online === 1 ? "" : "s"} online`} animated={false} onClick={openCompanionRollout} testId="nexus-elevate-coverage-tile" />
        <HeroTile label="Service-launch policy" value={settings.native_enabled ? "Enabled" : "Paused"} icon={CheckCircle2} glow={settings.native_enabled ? "emerald" : "rose"} subtitle={`Approval cap ${settings.max_duration_minutes || 15} minutes`} animated={false} onClick={() => navigate("/settings?tab=integrations&anchor=nexus-elevate-settings-card")} testId="nexus-elevate-policy-tile" />
        <HeroTile label="Policy controls" value={String(policyCount ?? summary.active_policies ?? 0)} icon={ShieldCheck} glow={(policyCount ?? summary.active_policies ?? 0) ? "emerald" : "zinc"} subtitle={`${summary.enforced_policies || 0} enforced`} animated={false} onClick={jumpToPolicies} testId="nexus-elevate-policy-controls-tile" />
      </div>

      <Card className="border-emerald-500/20 bg-emerald-500/[0.035]">
        <CardContent className="flex flex-col gap-3 p-4 text-sm lg:flex-row lg:items-center lg:justify-between">
          <div><span className="font-semibold text-emerald-200">Universal by design.</span><span className="ml-1 text-muted-foreground">Every entitled Windows Nexus Agent receives the signed Client Chat + Elevate companion automatically when it is online. It only becomes active after the agent verifies installation. Requests run through the agent service; this is not interactive UAC elevation or a permanent local-admin grant. The optional Keeper bridge is {settings.keeper_bridge_enabled ? "configured as a provider path" : "off and not required"}.</span></div>
          <Button variant="ghost" size="sm" className="self-start text-emerald-200 hover:bg-emerald-500/10" onClick={() => navigate("/help/nexus-elevate-setup")}>Read the technician flow <ExternalLink className="ml-1 h-3.5 w-3.5" /></Button>
        </CardContent>
      </Card>

      <ElevatePolicyWorkspace api={API} headers={headers} onPolicyCountChange={updatePolicyCount} />

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[260px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search program, asset, client, requester, or ticket..." data-testid="nexus-elevate-search" /></div>
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-[180px]" data-testid="nexus-elevate-status-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All request states</SelectItem><SelectItem value="pending">Awaiting review</SelectItem><SelectItem value="approved">Approved / queued</SelectItem><SelectItem value="executed">Executed</SelectItem><SelectItem value="denied">Denied</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="expired">Expired</SelectItem></SelectContent></Select>
        {endpointScope && <Button variant="outline" size="sm" onClick={() => navigate("/nexus-elevate")}>Endpoint scope <span className="ml-1 text-muted-foreground">×</span></Button>}
        <span className="self-center text-xs text-muted-foreground">{filtered.length} shown</span>
      </div>

      <Card><CardContent className="p-0"><div className="max-h-[660px] overflow-auto"><Table><TableHeader><TableRow><TableHead>Request</TableHead><TableHead>Asset / client</TableHead><TableHead>Requester</TableHead><TableHead>Trust evidence</TableHead><TableHead>Requested</TableHead><TableHead>State</TableHead><TableHead className="text-right">Review</TableHead></TableRow></TableHeader><TableBody>
        {loading ? <TableRow><TableCell colSpan={7} className="py-14 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow> : filtered.length === 0 ? <TableRow><TableCell colSpan={7} className="py-14 text-center text-sm text-muted-foreground">No elevation requests match the current filter.</TableCell></TableRow> : filtered.map((request) => <TableRow key={request.id} data-testid={`nexus-elevate-request-${request.id}`}><TableCell className="max-w-xs"><div className="truncate font-medium" title={request.program_path}>{request.program_name || "Approved executable"}</div><div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={request.program_path}>{request.program_path}</div>{request.ticket_id && <div className="mt-1 text-[10px] text-sky-300">Ticket {request.ticket_id}</div>}</TableCell><TableCell><div className="text-sm">{request.asset_name || request.hostname || "Managed endpoint"}</div><div className="mt-1 text-xs text-muted-foreground">{request.client_name || "Unassigned client"}</div></TableCell><TableCell><div className="text-sm">{request.requested_by_name || "Endpoint user"}</div><div className="mt-1 max-w-[180px] truncate text-[10px] text-muted-foreground" title={request.justification}>{request.justification || "No reason supplied"}</div></TableCell><TableCell><div className="max-w-[210px] truncate text-xs" title={request.publisher}>{request.publisher || "Publisher not provided"}</div><div className="mt-1 font-mono text-[10px] text-emerald-300">{request.sha256?.slice(0, 12)}...</div></TableCell><TableCell className="text-xs text-muted-foreground">{displayTime(request.requested_at)}</TableCell><TableCell><Badge variant="outline" className={`text-[10px] uppercase ${STATUS_STYLE[request.status] || STATUS_STYLE.pending}`}>{String(request.status || "pending").replace(/_/g, " ")}</Badge>{request.approved_until && request.status === "approved" && <div className="mt-1 text-[10px] text-muted-foreground">Until {safeDate(request.approved_until)?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>}</TableCell><TableCell className="text-right"><Button variant={request.status === "pending" ? "default" : "ghost"} size="sm" onClick={() => openRequest(request)}>{request.status === "pending" ? "Review" : "Details"}</Button></TableCell></TableRow>)}
      </TableBody></Table></div></CardContent></Card>

      <Dialog open={companionOpen} onOpenChange={setCompanionOpen}>
        <DialogContent className="max-w-xl" data-testid="nexus-elevate-companion-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><MonitorCog className="h-5 w-5 text-emerald-300" />Repair or retry Elevate companion</DialogTitle></DialogHeader>
          <div className="space-y-4"><p className="text-sm text-muted-foreground">Nexus automatically delivers the signed Client Chat + Elevate companion when an eligible Windows agent enrols or checks in. Use this only to force an immediate retry or repair. The agent verifies the SHA-256 and copies the companion to its installation directory; it never launches a customer-session window itself.</p><div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3 text-xs text-emerald-100">Only online agents running the current companion-rollout version are eligible. Devices become <strong>Elevate active</strong> only after a verified agent result—not when this command is merely queued.</div><Select value={companionScope} onValueChange={setCompanionScope}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All online, updated agents</SelectItem><SelectItem value="one">One online agent</SelectItem></SelectContent></Select>{companionScope === "one" && <Select value={companionAgentId} onValueChange={setCompanionAgentId} disabled={companionLoading}><SelectTrigger><SelectValue placeholder={companionLoading ? "Loading agents..." : "Choose an online agent"} /></SelectTrigger><SelectContent>{companionAgents.length === 0 ? <SelectItem value="none" disabled>No online agents found</SelectItem> : companionAgents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.hostname || agent.id} · {agent.client_name || agent.client_id || "Unassigned"} · {agent.agent_version || "unknown"}</SelectItem>)}</SelectContent></Select>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setCompanionOpen(false)} disabled={companionDeploying}>Cancel</Button><Button onClick={deployCompanion} disabled={companionDeploying || companionLoading}>{companionDeploying && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Queue immediate retry</Button></div></div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="nexus-elevate-review-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-300" />Nexus Elevate request review</DialogTitle></DialogHeader>
          {!selected ? null : <div className="space-y-5">
            <div className="grid gap-3 rounded-xl border border-border bg-muted/25 p-4 sm:grid-cols-2"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Approved program</p><p className="mt-1 break-all text-sm font-medium">{selected.program_name}</p><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{selected.program_path}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Endpoint context</p><p className="mt-1 text-sm font-medium">{selected.asset_name || selected.hostname}</p><p className="mt-1 text-xs text-muted-foreground">{selected.client_name || "Unassigned client"} · {selected.requested_by_name || "Endpoint user"}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Fingerprint (verified on endpoint)</p><p className="mt-1 break-all font-mono text-[10px] text-emerald-300">{selected.sha256}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Publisher and arguments</p><p className="mt-1 text-xs">{selected.publisher || "Unknown publisher"}</p><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{(selected.arguments || []).join(" ") || "No arguments"}</p></div></div>
            <div className="rounded-lg border border-border bg-background/40 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Requester justification</p><p className="mt-1 whitespace-pre-wrap text-sm">{selected.justification || "No justification supplied"}</p>{selected.parent_process && <p className="mt-2 font-mono text-[10px] text-muted-foreground">Parent process: {selected.parent_process}</p>}</div>
            {detail?.audit?.length > 0 && <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Audit timeline</p><div className="space-y-2">{detail.audit.map((event) => <div key={event.id} className="flex gap-3 rounded-lg border border-border/70 px-3 py-2 text-xs"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><div><span className="font-medium capitalize">{String(event.kind || "event").replace(/_/g, " ")}</span><span className="ml-2 text-muted-foreground">{displayTime(event.at)}</span></div></div>)}</div></div>}
            {canDecide ? <div className="space-y-3 border-t border-border pt-4"><div className="flex gap-2"><Button variant={decision === "approve" ? "default" : "outline"} size="sm" onClick={() => setDecision("approve")}>Approve controlled launch</Button><Button variant={decision === "deny" ? "destructive" : "outline"} size="sm" onClick={() => setDecision("deny")}>Deny request</Button></div>{decision === "approve" && <div className="max-w-xs"><Label htmlFor="elevation-duration">Time bound</Label><Select value={duration} onValueChange={setDuration}><SelectTrigger id="elevation-duration" className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{[5, 10, 15, 30, 45, 60].filter((value) => value <= (settings.max_duration_minutes || 15)).map((value) => <SelectItem key={value} value={String(value)}>{value} minutes</SelectItem>)}</SelectContent></Select></div>}<div><Label htmlFor="elevation-decision-reason">{decision === "approve" ? "Approval rationale" : "Denial rationale"}</Label><Textarea id="elevation-decision-reason" className="mt-1" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={decision === "approve" ? "Why is this precise, time-bound launch appropriate?" : "Explain why the request cannot be approved and what the requester should do next."} /></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSelected(null)} disabled={acting}>Cancel</Button><Button variant={decision === "deny" ? "destructive" : "default"} onClick={decide} disabled={acting || reason.trim().length < 8}>{acting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{decision === "approve" ? "Approve and queue" : "Deny and record"}</Button></div></div> : <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">This request is already <strong className="capitalize text-foreground">{selected.status}</strong>. Its full activity remains above for audit.</div>}
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
