import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity, CheckCircle2, Clock3, History, Laptop, Loader2, Monitor,
  MonitorUp, Network, RefreshCw, Search, ShieldCheck, Users, XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const BUILD_STAGES = [
  { name: "Trust & grants", detail: "Per-tenant Ed25519 identity, ten-minute grants, device binding, revocation and durable replay protection.", state: "ready", icon: ShieldCheck },
  { name: "Remote Companion", detail: "Signed user-session companion for attended consent, local stop and guarded view-only capture.", state: "ready", icon: Laptop },
  { name: "Nexus Relay", detail: "Authenticated, tenant-scoped frame relay with bounded uploads, freshness expiry and transport evidence.", state: "ready", icon: Network },
  { name: "Technician Viewer", detail: "Live view-only desktop canvas with freshness state, session evidence and an emergency end control.", state: "ready", icon: MonitorUp },
];

const CAPABILITY_TARGETS = [
  "Attended and policy-controlled unattended access", "Multi-monitor canvas", "Reboot and reconnect",
  "Multi-technician collaboration", "Secure clipboard and file exchange", "Session recording and playback",
  "Background diagnostics", "Credential-safe elevation", "In-session chat", "Ticket, time and billing evidence",
];

function messageFor(error, fallback) {
  const detail = error?.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : fallback;
}

function lifecycleEvidence(session) {
  const labels = [session?.transport_state, session?.launch_status]
    .filter(Boolean)
    .map(value => String(value).replaceAll("_", " "));
  if (session?.transport_detail) labels.push(String(session.transport_detail));
  return [...new Set(labels)].join(" · ");
}

function sessionTimeline(session) {
  const events = [
    ["Authorised", session?.started_at],
    ["Consent recorded", session?.consent_confirmed_at],
    ["Companion acknowledged", session?.companion_acknowledged_at],
    ["Transport reported", session?.transport_reported_at],
    ["Companion disconnected", session?.last_transport_disconnect_at],
    ["Latest protected capture", session?.last_heartbeat_at],
    ["Session closed", session?.ended_at],
  ].filter(([, at]) => at);
  return events
    .filter(([label, at], index) => !events.slice(0, index).some(([priorLabel, priorAt]) => priorLabel === label && priorAt === at))
    .sort(([, first], [, second]) => Date.parse(first) - Date.parse(second));
}

function displayEvidenceTime(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Recorded";
}

export default function NativeRemoteAccessPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [devices, setDevices] = useState([]);
  const [agents, setAgents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const mode = "view";
  const [purpose, setPurpose] = useState("");
  const [consent, setConsent] = useState(false);
  const [viewerSession, setViewerSession] = useState(null);
  const [viewerFrame, setViewerFrame] = useState("");
  const [viewerFrameCapturedAt, setViewerFrameCapturedAt] = useState("");
  const [viewerState, setViewerState] = useState("waiting");
  const [viewerClock, setViewerClock] = useState(() => Date.now());
  const [endingSessionId, setEndingSessionId] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [deviceResponse, agentResponse, sessionResponse] = await Promise.all([
        axios.get(`${API}/devices`, { headers }),
        axios.get(`${API}/nexus-agent/agents`, { headers }),
        axios.get(`${API}/remote/sessions`, { headers }),
      ]);
      setDevices((deviceResponse.data || []).filter(device => !device.archived));
      setAgents(agentResponse.data || []);
      setSessions((sessionResponse.data || []).filter(session => session.provider === "nexus"));
    } catch (error) {
      toast.error(messageFor(error, "Nexus Native Remote could not load"));
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const agentById = useMemo(() => new Map(agents.map(agent => [agent.id, agent])), [agents]);
  const enrolled = devices.filter(device => device.nexus_agent_id && agentById.has(device.nexus_agent_id));
  const online = enrolled.filter(device => agentById.get(device.nexus_agent_id)?.online);
  const capable = online.filter(device => {
    const agent = agentById.get(device.nexus_agent_id) || {};
    return [...(agent.agent_runtime_capabilities || []), ...(agent.nexus_shield_capabilities || [])].includes("native_remote_v1");
  });
  const activeSessions = sessions.filter(session => ["authorised", "active", "ending"].includes(session.status));
  const activeSessionDeviceIds = useMemo(() => new Set(activeSessions.map(session => session.device_id)), [activeSessions]);
  const viewerSessionRecord = useMemo(
    () => viewerSession ? sessions.find(session => session.id === viewerSession.id) : null,
    [sessions, viewerSession],
  );
  const viewerCaptureState = !viewerSessionRecord
    ? "unknown"
    : viewerSessionRecord.status !== "active"
      ? "ended"
      : viewerSessionRecord.capture_freshness || "unknown";
  const viewerExpirySeconds = (() => {
    const expiry = Date.parse(viewerSessionRecord?.native_grant_expires_at || "");
    return Number.isFinite(expiry) ? Math.max(0, Math.ceil((expiry - viewerClock) / 1000)) : null;
  })();
  const viewerExpiryLabel = viewerExpirySeconds === null ? "" : viewerExpirySeconds === 0
    ? " · session limit reached"
    : ` · limit ${Math.floor(viewerExpirySeconds / 60)}m ${viewerExpirySeconds % 60}s`;
  const viewerLimitReached = viewerExpirySeconds === 0;
  const viewerStatusLabel = viewerCaptureState === "ended"
    ? "Session no longer active"
    : viewerLimitReached
      ? "Signed session limit reached · closing protected capture"
    : viewerState === "disconnected"
      ? "Endpoint companion disconnected · awaiting reconnect"
    : viewerState === "stale"
      ? "Frame stale · awaiting a newer server capture"
      : viewerCaptureState === "stale"
        ? `Capture stale${Number.isFinite(viewerSessionRecord?.capture_age_seconds) ? ` · last verified ${viewerSessionRecord.capture_age_seconds}s ago` : ""}`
      : viewerState === "live"
        ? `Live view-only${viewerFrameCapturedAt ? ` · server capture ${new Date(viewerFrameCapturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}${viewerExpiryLabel}`
        : viewerState === "reconnecting"
          ? "Reconnecting"
          : "Waiting for endpoint capture";
  const visibleDevices = devices.filter(device => {
    const value = query.trim().toLowerCase();
    if (!value) return true;
    return [device.name, device.hostname, device.client_name, device.os].some(field => String(field || "").toLowerCase().includes(value));
  });

  useEffect(() => {
    if (!activeSessions.length) return undefined;
    let cancelled = false;
    const refreshSessionState = async () => {
      try {
        const response = await axios.get(`${API}/remote/sessions`, { headers });
        if (!cancelled) setSessions((response.data || []).filter(session => session.provider === "nexus"));
      } catch {
        // A transient refresh failure must not hide the existing audited state.
      }
    };
    const interval = window.setInterval(refreshSessionState, 5000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [activeSessions.length, headers]);

  const inspectDevice = useCallback(async device => {
    setSelected(device);
    setReadiness(null);
    setConsent(false);
    setPurpose("");
    setChecking(true);
    try {
      const response = await axios.get(`${API}/devices/${device.id}/native-remote/readiness`, { headers });
      setReadiness(response.data);
    } catch (error) {
      setReadiness({ ready: false, state: "unavailable", detail: messageFor(error, "Readiness could not be confirmed") });
    } finally {
      setChecking(false);
    }
  }, [headers]);

  useEffect(() => {
    const requested = searchParams.get("device");
    if (!requested || loading || !devices.length) return;
    const device = devices.find(item => item.id === requested);
    if (device) inspectDevice(device);
    const next = new URLSearchParams(searchParams);
    next.delete("device");
    setSearchParams(next, { replace: true });
  }, [devices, inspectDevice, loading, searchParams, setSearchParams]);

  useEffect(() => {
    if (!viewerSession) return undefined;
    if (viewerLimitReached) return undefined;
    if (viewerCaptureState === "stale" || viewerCaptureState === "ended") {
      setViewerState(viewerCaptureState);
      setViewerFrame(previous => {
        if (previous) URL.revokeObjectURL(previous);
        return "";
      });
      setViewerFrameCapturedAt("");
      return undefined;
    }
    let currentUrl = "";
    let cancelled = false;
    const loadFrame = async () => {
      try {
        const response = await axios.get(`${API}/remote/sessions/${viewerSession.id}/native-frame`, { headers, responseType: "blob" });
        if (cancelled) return;
        const nextUrl = URL.createObjectURL(response.data);
        setViewerFrame(previous => { if (previous) URL.revokeObjectURL(previous); return nextUrl; });
        currentUrl = nextUrl;
        setViewerFrameCapturedAt(response.headers["x-nexus-remote-captured-at"] || "");
        setViewerState("live");
      } catch (error) {
        if (!cancelled) {
          const detail = String(error?.response?.data?.detail || "").toLowerCase();
          if (error?.response?.status === 409 && detail.includes("capture is stale")) {
            setViewerState("stale");
            setViewerFrame(previous => { if (previous) URL.revokeObjectURL(previous); return ""; });
            setViewerFrameCapturedAt("");
          } else if (error?.response?.status === 409 && detail.includes("transport is disconnected")) {
            setViewerState("disconnected");
            setViewerFrame(previous => { if (previous) URL.revokeObjectURL(previous); return ""; });
            setViewerFrameCapturedAt("");
          } else {
            if (error?.response?.status === 404) {
              setViewerFrame(previous => { if (previous) URL.revokeObjectURL(previous); return ""; });
              setViewerFrameCapturedAt("");
            }
            setViewerState(error?.response?.status === 404 ? "waiting" : "reconnecting");
          }
        }
      }
    };
    loadFrame();
    const interval = window.setInterval(loadFrame, 900);
    return () => { cancelled = true; window.clearInterval(interval); if (currentUrl) URL.revokeObjectURL(currentUrl); };
  }, [headers, viewerCaptureState, viewerLimitReached, viewerSession]);

  useEffect(() => {
    if (!viewerSession) return undefined;
    setViewerClock(Date.now());
    const interval = window.setInterval(() => setViewerClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [viewerSession]);

  useEffect(() => {
    if (!viewerLimitReached) return;
    setViewerState("expired");
    setViewerFrame(previous => { if (previous) URL.revokeObjectURL(previous); return ""; });
    setViewerFrameCapturedAt("");
  }, [viewerLimitReached]);

  const startSession = async () => {
    if (!selected || !readiness?.ready || !consent) return;
    setStarting(true);
    try {
      const response = await axios.post(`${API}/devices/${selected.id}/remote-sessions/start`, {
        provider: "nexus",
        mode,
        session_type: "remote_desktop",
        purpose: purpose.trim() || "Technician support session",
        consent_confirmed: true,
        consent_method: "attended_prompt",
        ticket_id: searchParams.get("ticket"),
        work_session_id: searchParams.get("workSession"),
        idempotency_key: window.crypto?.randomUUID?.() || `${selected.id}-${Date.now()}`,
      }, { headers });
      toast.success(response.data?.message || "Native session grant issued");
      setSelected(null);
      await fetchData();
    } catch (error) {
      toast.error(messageFor(error, "Native session could not be started"));
    } finally {
      setStarting(false);
    }
  };

  const endSession = async (session) => {
    if (!session?.id || endingSessionId) return;
    if (!window.confirm("End this Nexus Remote session? The endpoint companion will stop on its next protected status check.")) return;
    setEndingSessionId(session.id);
    try {
      await axios.put(`${API}/remote/sessions/${encodeURIComponent(session.id)}/end`, {
        notes: "Technician ended Nexus Remote session from the native viewer",
      }, { headers });
      toast.success("Nexus Remote session ended and its grant was revoked");
      if (viewerSession?.id === session.id) setViewerSession(null);
      await fetchData();
    } catch (error) {
      toast.error(messageFor(error, "Nexus Remote session could not be ended"));
    } finally {
      setEndingSessionId("");
    }
  };

  if (loading) return <div className="flex h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-cyan-300" /></div>;

  return (
    <div className="space-y-5" data-testid="native-remote-access-page">
      <OperationalPageHeader
        eyebrow="Managed access"
        title="Nexus Remote"
        description="Nexus-owned remote support through the enrolled agent, with consent, scope, revocation and service evidence built in."
        icon={Laptop}
        tone="sky"
        signal={capable.length ? "healthy" : "working"}
        signalLabel={capable.length ? `${capable.length} native-ready endpoints` : "Remote Companion build required"}
        signalDescription={capable.length ? "The native grant path is available on enrolled endpoints." : "Trust and grant infrastructure is ready; no endpoint advertises the capture companion yet."}
        actions={<><Button variant="outline" size="sm" onClick={() => navigate("/nexus-agent")}><ShieldCheck className="mr-2 h-4 w-4" />Nexus Agent</Button><Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></>}
      />

      <MetricStrip columns={4}>
        <MetricTile label="Enrolled endpoints" value={enrolled.length} icon={ShieldCheck} accent="cyan" />
        <MetricTile label="Agents online" value={online.length} icon={Activity} accent="emerald" />
        <MetricTile label="Native capable" value={capable.length} icon={MonitorUp} accent="violet" />
        <MetricTile label="Active sessions" value={activeSessions.length} icon={Users} accent="amber" />
      </MetricStrip>

      <Card className="overflow-hidden border-cyan-400/20 bg-[linear-gradient(112deg,rgba(8,145,178,0.10),rgba(15,23,42,0.82)_52%,rgba(30,64,175,0.08))]" data-testid="nexus-native-build-status">
        <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/10 text-cyan-100">NEXUS NATIVE</Badge><CardTitle className="mt-2 text-lg">First-party engine build status</CardTitle><p className="mt-1 text-xs leading-5 text-muted-foreground">The external transport path is retired. These gates show what is implemented versus what remains before a real desktop can connect.</p></div><Badge variant="outline" className="border-amber-400/30 text-amber-300">Pre-production</Badge></div></CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {BUILD_STAGES.map((stage, index) => { const Icon = stage.icon; return <div key={stage.name} className={`rounded-xl border p-3 ${stage.state === "ready" ? "border-emerald-400/25 bg-emerald-400/[0.05]" : stage.state === "building" ? "border-cyan-400/25 bg-cyan-400/[0.05]" : "border-border/60 bg-black/10"}`}><div className="flex items-center justify-between gap-2"><Icon className={`h-4 w-4 ${stage.state === "ready" ? "text-emerald-300" : "text-cyan-300"}`} /><Badge variant="outline" className="text-[9px] uppercase">{stage.state}</Badge></div><p className="mt-3 text-sm font-semibold">{index + 1}. {stage.name}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{stage.detail}</p></div>; })}
        </CardContent>
      </Card>

      <Tabs defaultValue="fleet">
        <TabsList><TabsTrigger value="fleet"><Monitor className="mr-1.5 h-3.5 w-3.5" />Native fleet</TabsTrigger><TabsTrigger value="sessions"><History className="mr-1.5 h-3.5 w-3.5" />Session evidence</TabsTrigger><TabsTrigger value="capabilities"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Capability target</TabsTrigger></TabsList>
        <TabsContent value="fleet" className="mt-4 space-y-3">
          <div className="relative max-w-xl"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search endpoint, client or operating system" className="pl-9" /></div>
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleDevices.map(device => { const agent = agentById.get(device.nexus_agent_id); const nativeReady = Boolean(agent?.online && [...(agent.agent_runtime_capabilities || []), ...(agent.nexus_shield_capabilities || [])].includes("native_remote_v1")); const sessionActive = activeSessionDeviceIds.has(device.id); return <Card key={device.id} className="border-border/60"><CardContent className="flex items-center gap-3 p-4"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${nativeReady ? "bg-emerald-500/10 text-emerald-300" : "bg-muted text-muted-foreground"}`}><Monitor className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{device.name || device.hostname}</p><p className="truncate text-xs text-muted-foreground">{device.client_name || "Managed client"} · {agent?.online ? "Agent online" : agent ? "Agent offline" : "Agent not linked"}</p></div><Badge variant="outline" className={sessionActive ? "border-amber-400/25 text-amber-300" : nativeReady ? "border-emerald-400/25 text-emerald-300" : "text-muted-foreground"}>{sessionActive ? "Session active" : nativeReady ? "Ready" : "Companion needed"}</Badge><Button size="sm" onClick={() => inspectDevice(device)} disabled={!device.nexus_agent_id || sessionActive}>{sessionActive ? "In session" : "Connect"}</Button></CardContent></Card>; })}
          </div>
        </TabsContent>
        <TabsContent value="sessions" className="mt-4"><Card><CardContent className="space-y-2 p-4">{sessions.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No Nexus Native sessions recorded yet.</p> : sessions.map(session => <div key={session.id} className="flex items-center gap-3 rounded-xl border border-border/60 p-3"><Clock3 className="h-4 w-4 text-cyan-300" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{session.device_name || session.device_id}</p><p className="text-xs text-muted-foreground">{session.user_name} · {session.client_name || session.client_id}</p>{lifecycleEvidence(session) && <p className="mt-0.5 truncate text-[11px] capitalize text-muted-foreground">{lifecycleEvidence(session)}</p>}</div>{session.status === "active" && session.transport_state === "connected" && <Button size="sm" variant="outline" onClick={() => setViewerSession(session)}><MonitorUp className="mr-1.5 h-3.5 w-3.5" />View</Button>}{["authorised", "active", "ending"].includes(session.status) && <Button size="sm" variant="outline" className="border-rose-500/30 text-rose-200 hover:bg-rose-500/10" onClick={() => endSession(session)} disabled={Boolean(endingSessionId)}>{endingSessionId === session.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "End"}</Button>}{session.status === "active" && <Badge variant="outline" className={session.capture_freshness === "fresh" ? "border-emerald-400/30 text-emerald-300" : session.capture_freshness === "stale" ? "border-amber-400/30 text-amber-200" : "text-muted-foreground"}>{session.capture_freshness === "fresh" ? "Live capture" : session.capture_freshness === "stale" ? "Capture stale" : "Capture unknown"}</Badge>}<Badge variant="outline" className="capitalize">{session.status}</Badge></div>)}</CardContent></Card></TabsContent>
        <TabsContent value="capabilities" className="mt-4"><Card><CardHeader><CardTitle className="text-sm">Production capability target</CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-2">{CAPABILITY_TARGETS.map(item => <div key={item} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"><CheckCircle2 className="h-4 w-4 text-cyan-300" />{item}</div>)}</CardContent></Card></TabsContent>
      </Tabs>

      <Dialog open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}>
        <NexusWorkflowDialog eyebrow="Nexus Native" title="Authorise remote support" description="The grant is short-lived, single-session and bound to this technician, tenant and endpoint." icon={MonitorUp} tone="cyan" className="max-w-xl" footer={<><Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button><Button onClick={startSession} disabled={!readiness?.ready || !consent || starting}>{starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MonitorUp className="mr-2 h-4 w-4" />}Issue native grant</Button></>}>
          <div className="rounded-xl border border-border/60 p-3"><p className="text-sm font-semibold">{selected?.name || selected?.hostname}</p><p className="mt-1 text-xs text-muted-foreground">{selected?.client_name || "Managed client"}</p></div>
          <div className={`rounded-xl border p-3 ${readiness?.ready ? "border-emerald-400/25 bg-emerald-400/[0.05]" : "border-amber-400/25 bg-amber-400/[0.05]"}`}><div className="flex items-center gap-2">{checking ? <Loader2 className="h-4 w-4 animate-spin" /> : readiness?.ready ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-amber-300" />}<p className="text-sm font-semibold">{checking ? "Checking agent readiness" : readiness?.ready ? "Native companion ready" : "Native companion unavailable"}</p></div>{readiness?.detail && <p className="mt-1 text-xs text-muted-foreground">{readiness.detail}</p>}{readiness?.ready && <p className="mt-2 text-[11px] text-muted-foreground">Protected companion capability confirmed · agent heartbeat {displayEvidenceTime(readiness.agent_last_seen)}</p>}</div>
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-3"><p className="text-sm font-medium">View-only access</p><p className="mt-1 text-xs text-muted-foreground">Input control, clipboard and file transfer remain disabled until their separate safety boundaries are implemented.</p></div>
          <div className="space-y-2"><Label>Purpose</Label><Textarea value={purpose} onChange={event => setPurpose(event.target.value)} placeholder="What will this session be used to diagnose or repair?" maxLength={500} /></div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 p-3"><Checkbox checked={consent} onCheckedChange={value => setConsent(Boolean(value))} /><span className="text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Customer consent is confirmed.</strong> The endpoint companion will still show the local attended prompt and can reject or revoke this session.</span></label>
        </NexusWorkflowDialog>
      </Dialog>
      <Dialog open={Boolean(viewerSession)} onOpenChange={open => !open && setViewerSession(null)}>
        <NexusWorkflowDialog eyebrow="Nexus Native Viewer" title={viewerSession?.device_name || viewerSession?.device_id || "Remote desktop"} description="Live view-only endpoint capture. The latest frame is held briefly in the Nexus relay and is never cached by the browser." icon={MonitorUp} tone="cyan" className="max-w-5xl" footer={<><Button variant="outline" onClick={() => setViewerSession(null)} disabled={Boolean(endingSessionId)}>Close viewer</Button><Button variant="destructive" onClick={() => endSession(viewerSession)} disabled={Boolean(endingSessionId)}>{endingSessionId === viewerSession?.id && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}End session</Button></>}>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-black"><div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[11px] text-muted-foreground"><span role="status" aria-live="polite" className={`font-medium uppercase tracking-[0.14em] ${viewerCaptureState === "stale" || viewerState === "stale" ? "text-amber-200" : viewerCaptureState === "ended" || viewerState === "disconnected" || viewerLimitReached ? "text-rose-200" : ""}`}>{viewerStatusLabel}</span><span>{viewerSession?.id}</span></div>{viewerFrame && !viewerLimitReached && viewerCaptureState !== "stale" && viewerCaptureState !== "ended" && viewerState !== "stale" && viewerState !== "disconnected" ? <img src={viewerFrame} alt="Live endpoint desktop" className="block max-h-[68vh] w-full object-contain" /> : <div role="status" aria-live="polite" className="flex min-h-80 items-center justify-center px-6 text-center text-sm text-muted-foreground">{viewerLimitReached ? "The signed session limit has elapsed, so the browser has removed the desktop image. The endpoint companion is closing its protected capture." : viewerCaptureState === "stale" || viewerState === "stale" ? "The last desktop capture is no longer current, so it has been removed from view. Check the endpoint connection or end the session." : viewerCaptureState === "ended" ? "This session is no longer active. Start a new attended session when the endpoint user is ready." : viewerState === "disconnected" ? "The endpoint companion disconnected, so its desktop image has been removed. Waiting for a new protected connection." : <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{viewerState === "reconnecting" ? "Checking the secure relay…" : "Waiting for the attended companion to send its first frame…"}</>}</div>}</div>
          <div className="mt-3 rounded-xl border border-border/60 bg-muted/20 p-3"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Session evidence</p><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{sessionTimeline(viewerSessionRecord).length ? sessionTimeline(viewerSessionRecord).map(([label, at]) => <div key={`${label}-${at}`} className="rounded-lg border border-border/50 px-2.5 py-2"><p className="text-xs font-medium">{label}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{displayEvidenceTime(at)}</p></div>) : <p className="text-xs text-muted-foreground">Waiting for protected endpoint evidence.</p>}</div></div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}
