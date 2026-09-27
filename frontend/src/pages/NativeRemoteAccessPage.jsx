import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity, ArrowLeft, CheckCircle2, Clock3, ExternalLink, History, Laptop,
  Loader2, Maximize2, Minimize2, Monitor, MonitorUp, Network, RefreshCw,
  Search, ShieldCheck, Users, ZoomIn, ZoomOut, XCircle,
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
  const [mode, setMode] = useState("view");
  const [purpose, setPurpose] = useState("");
  const [consent, setConsent] = useState(false);
  const [viewerSession, setViewerSession] = useState(null);
  const [viewerFrame, setViewerFrame] = useState("");
  const [viewerFrameCapturedAt, setViewerFrameCapturedAt] = useState("");
  const [viewerState, setViewerState] = useState("waiting");
  const [viewerClock, setViewerClock] = useState(() => Date.now());
  const [endingSessionId, setEndingSessionId] = useState("");
  const [viewerZoom, setViewerZoom] = useState(1);
  const [viewerFit, setViewerFit] = useState(true);
  const [viewerFocus, setViewerFocus] = useState(false);
  const [viewerFullscreen, setViewerFullscreen] = useState(false);
  const viewerSessionId = viewerSession?.id || "";

  const viewerUrl = useCallback((sessionId) => {
    const params = new URLSearchParams();
    params.set("viewer", sessionId);
    return `/nexus-remote?${params.toString()}`;
  }, []);

  const closeViewer = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    setViewerSession(null);
    const next = new URLSearchParams(searchParams);
    next.delete("viewer");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const resetViewerCanvas = useCallback(() => {
    setViewerZoom(1);
    setViewerFit(true);
  }, []);

  const updateViewerZoom = useCallback((next) => {
    setViewerFit(false);
    setViewerZoom(current => Math.max(0.5, Math.min(3, typeof next === "function" ? next(current) : next)));
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      toast.error("Fullscreen is unavailable in this browser window");
    }
  }, []);

  const openViewer = useCallback((session, { popOut = false } = {}) => {
    if (!session?.id) return;
    const url = viewerUrl(session.id);
    if (popOut) {
      window.open(url, "nexus-remote-viewer", "popup=yes,width=1500,height=950,resizable=yes,scrollbars=no");
      return;
    }
    setViewerSession(session);
    navigate(url);
  }, [navigate, viewerUrl]);

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
    : viewerSessionRecord.status === "ended"
      ? "ended"
      : viewerSessionRecord.status !== "active"
        ? "awaiting_consent"
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
    : viewerCaptureState === "awaiting_consent"
      ? "Waiting for endpoint consent"
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
  const companionStateLabel = evidence => {
    const state = String(evidence?.status || "readiness_unreported");
    if (state === "ready") return "Companion ready";
    if (state === "waiting_for_user_session") return "Awaiting user session";
    if (state === "waiting_for_policy") return "Applying remote policy";
    if (state === "integrity_unverified") return "Companion integrity check needed";
    if (state === "unsupported_platform") return "Windows companion required";
    return "Companion state unavailable";
  };

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
    const requestedViewer = searchParams.get("viewer");
    if (!requestedViewer || loading) return;
    const session = sessions.find(item => item.id === requestedViewer && item.provider === "nexus");
    if (session) setViewerSession(session);
  }, [loading, searchParams, sessions]);

  useEffect(() => {
    if (!viewerSession) return undefined;
    if (viewerLimitReached) return undefined;
    if (viewerCaptureState === "stale" || viewerCaptureState === "ended" || viewerCaptureState === "awaiting_consent") {
      setViewerState(viewerCaptureState === "awaiting_consent" ? "waiting" : viewerCaptureState);
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
    const updateFullscreen = () => setViewerFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  useEffect(() => {
    if (viewerSessionId) {
      resetViewerCanvas();
      setViewerFocus(false);
    }
  }, [viewerSessionId, resetViewerCanvas]);

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
        control_consent_confirmed: mode === "control",
        consent_method: "attended_prompt",
        ticket_id: searchParams.get("ticket"),
        work_session_id: searchParams.get("workSession"),
        idempotency_key: window.crypto?.randomUUID?.() || `${selected.id}-${Date.now()}`,
      }, { headers });
      toast.success(response.data?.message || "Native session grant issued");
      setSelected(null);
      await fetchData();
      if (response.data?.session?.id) openViewer(response.data.session);
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
      if (viewerSession?.id === session.id) closeViewer();
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
            {visibleDevices.map(device => { const agent = agentById.get(device.nexus_agent_id); const companionEvidence = agent?.native_remote_evidence || {}; const nativeReady = Boolean(agent?.online && [...(agent.agent_runtime_capabilities || []), ...(agent.nexus_shield_capabilities || [])].includes("native_remote_v1") && companionEvidence.status === "ready"); const sessionActive = activeSessionDeviceIds.has(device.id); return <Card key={device.id} className="border-border/60"><CardContent className="flex items-center gap-3 p-4"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${nativeReady ? "bg-emerald-500/10 text-emerald-300" : "bg-muted text-muted-foreground"}`}><Monitor className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{device.name || device.hostname}</p><p className="truncate text-xs text-muted-foreground">{device.client_name || "Managed client"} · {agent?.online ? "Agent online" : agent ? "Agent offline" : "Agent not linked"}</p><p className="truncate text-[11px] text-muted-foreground" title={companionEvidence.detail || companionStateLabel(companionEvidence)}>{agent ? companionStateLabel(companionEvidence) : "Companion needed"}</p></div><Badge variant="outline" className={sessionActive ? "border-amber-400/25 text-amber-300" : nativeReady ? "border-emerald-400/25 text-emerald-300" : "text-muted-foreground"}>{sessionActive ? "Session active" : nativeReady ? "Ready" : companionStateLabel(companionEvidence)}</Badge><Button size="sm" onClick={() => inspectDevice(device)} disabled={!nativeReady || sessionActive}>{sessionActive ? "In session" : "Connect"}</Button></CardContent></Card>; })}
          </div>
        </TabsContent>
        <TabsContent value="sessions" className="mt-4"><Card><CardContent className="space-y-2 p-4">{sessions.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No Nexus Native sessions recorded yet.</p> : sessions.map(session => <div key={session.id} className="flex items-center gap-3 rounded-xl border border-border/60 p-3"><Clock3 className="h-4 w-4 text-cyan-300" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{session.device_name || session.device_id}</p><p className="text-xs text-muted-foreground">{session.user_name} · {session.client_name || session.client_id}</p>{lifecycleEvidence(session) && <p className="mt-0.5 truncate text-[11px] capitalize text-muted-foreground">{lifecycleEvidence(session)}</p>}</div>{session.status === "active" && session.transport_state === "connected" && <Button size="sm" variant="outline" onClick={() => openViewer(session)}><MonitorUp className="mr-1.5 h-3.5 w-3.5" />Open viewer</Button>}{["authorised", "active", "ending"].includes(session.status) && <Button size="sm" variant="outline" className="border-rose-500/30 text-rose-200 hover:bg-rose-500/10" onClick={() => endSession(session)} disabled={Boolean(endingSessionId)}>{endingSessionId === session.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "End"}</Button>}{session.status === "active" && <Badge variant="outline" className={session.capture_freshness === "fresh" ? "border-emerald-400/30 text-emerald-300" : session.capture_freshness === "stale" ? "border-amber-400/30 text-amber-200" : "text-muted-foreground"}>{session.capture_freshness === "fresh" ? "Live capture" : session.capture_freshness === "stale" ? "Capture stale" : "Capture unknown"}</Badge>}<Badge variant="outline" className="capitalize">{session.status}</Badge></div>)}</CardContent></Card></TabsContent>
        <TabsContent value="capabilities" className="mt-4"><Card><CardHeader><CardTitle className="text-sm">Production capability target</CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-2">{CAPABILITY_TARGETS.map(item => <div key={item} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"><CheckCircle2 className="h-4 w-4 text-cyan-300" />{item}</div>)}</CardContent></Card></TabsContent>
      </Tabs>

      <Dialog open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}>
        <NexusWorkflowDialog eyebrow="Nexus Native" title="Authorise remote support" description="The grant is short-lived, single-session and bound to this technician, tenant and endpoint." icon={MonitorUp} tone="cyan" className="max-w-xl" footer={<><Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button><Button onClick={startSession} disabled={!readiness?.ready || !consent || starting}>{starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MonitorUp className="mr-2 h-4 w-4" />}Issue native grant</Button></>}>
          <div className="rounded-xl border border-border/60 p-3"><p className="text-sm font-semibold">{selected?.name || selected?.hostname}</p><p className="mt-1 text-xs text-muted-foreground">{selected?.client_name || "Managed client"}</p></div>
          <div className={`rounded-xl border p-3 ${readiness?.ready ? "border-emerald-400/25 bg-emerald-400/[0.05]" : "border-amber-400/25 bg-amber-400/[0.05]"}`}><div className="flex items-center gap-2">{checking ? <Loader2 className="h-4 w-4 animate-spin" /> : readiness?.ready ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-amber-300" />}<p className="text-sm font-semibold">{checking ? "Checking agent readiness" : readiness?.ready ? "Native companion ready" : "Native companion unavailable"}</p></div>{readiness?.detail && <p className="mt-1 text-xs text-muted-foreground">{readiness.detail}</p>}{readiness?.ready && <p className="mt-2 text-[11px] text-muted-foreground">Protected companion capability confirmed · agent heartbeat {displayEvidenceTime(readiness.agent_last_seen)}</p>}</div>
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-3"><p className="text-sm font-medium">View-only access</p><p className="mt-1 text-xs text-muted-foreground">Input control, clipboard and file transfer remain disabled until their separate safety boundaries are implemented.</p></div>
          <div className="space-y-2"><Label>Purpose</Label><Textarea value={purpose} onChange={event => setPurpose(event.target.value)} placeholder="What will this session be used to diagnose or repair?" maxLength={500} /></div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 p-3"><Checkbox checked={consent} onCheckedChange={value => setConsent(Boolean(value))} /><span className="text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Customer consent is confirmed.</strong> The endpoint companion will still show the local attended prompt and can reject or revoke this session.</span></label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-3"><Checkbox checked={mode === "control"} onCheckedChange={value => setMode(value ? "control" : "view")} /><span className="text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Request interactive control.</strong> This starts a fresh, attended session. The endpoint user must explicitly approve mouse and keyboard control and can stop it locally at any time.</span></label>
        </NexusWorkflowDialog>
      </Dialog>
      {viewerSession && <section className="fixed inset-0 z-[100] flex min-h-screen flex-col bg-[radial-gradient(circle_at_top_right,rgba(8,145,178,0.16),transparent_32%),linear-gradient(135deg,#07121c,#020617_62%,#07131f)] text-foreground" data-testid="nexus-remote-viewer">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-cyan-400/15 bg-black/20 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10"><MonitorUp className="h-4 w-4 text-cyan-200" /></span><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Nexus Remote · attended view</p><h2 className="truncate text-base font-semibold">{viewerSession?.device_name || viewerSession?.device_id || "Remote desktop"}</h2></div></div>
          <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-cyan-400/25 bg-cyan-400/5 text-cyan-100">View-only</Badge><Button variant="outline" size="sm" onClick={toggleFullscreen} title="Use the entire display for the remote canvas">{viewerFullscreen ? <Minimize2 className="mr-1.5 h-3.5 w-3.5" /> : <Maximize2 className="mr-1.5 h-3.5 w-3.5" />}{viewerFullscreen ? "Exit full screen" : "Full screen"}</Button><Button variant="outline" size="sm" onClick={() => openViewer(viewerSession, { popOut: true })}><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Pop out</Button><Button variant="outline" size="sm" onClick={closeViewer} disabled={Boolean(endingSessionId)}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Return</Button><Button variant="destructive" size="sm" onClick={() => endSession(viewerSession)} disabled={Boolean(endingSessionId)}>{endingSessionId === viewerSession?.id && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}End session</Button></div>
        </header>
        <main className={`grid min-h-0 flex-1 gap-3 p-3 ${viewerFocus ? "grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_20rem]"} lg:p-5`}>
          <div className="flex min-h-[50vh] flex-col overflow-hidden rounded-2xl border border-cyan-400/20 bg-black shadow-2xl shadow-cyan-950/30"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-3 py-2 text-[11px] text-muted-foreground"><span role="status" aria-live="polite" className={`font-medium uppercase tracking-[0.14em] ${viewerCaptureState === "stale" || viewerState === "stale" ? "text-amber-200" : viewerCaptureState === "ended" || viewerState === "disconnected" || viewerLimitReached ? "text-rose-200" : "text-emerald-200"}`}>{viewerStatusLabel}</span><div className="flex items-center gap-1"><Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => updateViewerZoom(zoom => zoom - 0.25)} disabled={viewerFit || viewerZoom <= 0.5} title="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={resetViewerCanvas} title="Fit desktop to available space">{viewerFit ? "Fit" : `${Math.round(viewerZoom * 100)}%`}</Button><Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => updateViewerZoom(zoom => zoom + 0.25)} disabled={!viewerFit && viewerZoom >= 3} title="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setViewerFocus(value => !value)} title="Hide or show session evidence">{viewerFocus ? "Show evidence" : "Focus desktop"}</Button></div><span className="hidden font-mono text-[10px] sm:inline">{viewerSession?.id}</span></div>{viewerFrame && !viewerLimitReached && viewerCaptureState !== "stale" && viewerCaptureState !== "ended" && viewerState !== "stale" && viewerState !== "disconnected" ? <div className={`flex min-h-0 flex-1 items-center justify-center ${viewerFit ? "overflow-hidden" : "overflow-auto p-6"}`}><img src={viewerFrame} alt="Live endpoint desktop" className={viewerFit ? "block h-full w-full object-contain" : "block h-auto max-w-none shadow-2xl"} style={viewerFit ? undefined : { width: `${Math.round(viewerZoom * 100)}%` }} /></div> : <div role="status" aria-live="polite" className="flex min-h-80 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">{viewerLimitReached ? "The signed session limit has elapsed, so the browser has removed the desktop image. The endpoint companion is closing its protected capture." : viewerCaptureState === "stale" || viewerState === "stale" ? "The last desktop capture is no longer current, so it has been removed from view. Check the endpoint connection or end the session." : viewerCaptureState === "ended" ? "This session is no longer active. Start a new attended session when the endpoint user is ready." : viewerState === "disconnected" ? "The endpoint companion disconnected, so its desktop image has been removed. Waiting for a new protected connection." : <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{viewerCaptureState === "awaiting_consent" ? "Waiting for the endpoint user to accept…" : viewerState === "reconnecting" ? "Checking the secure relay…" : "Waiting for the attended companion to send its first frame…"}</>}</div>}</div>
          {!viewerFocus && <aside className="space-y-3"><div className="rounded-2xl border border-border/60 bg-background/65 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Session evidence</p><div className="mt-3 space-y-2">{sessionTimeline(viewerSessionRecord).length ? sessionTimeline(viewerSessionRecord).map(([label, at]) => <div key={`${label}-${at}`} className="rounded-lg border border-border/50 px-3 py-2"><p className="text-xs font-medium">{label}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{displayEvidenceTime(at)}</p></div>) : <p className="text-xs text-muted-foreground">Waiting for protected endpoint evidence.</p>}</div></div><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4 text-xs leading-5 text-muted-foreground"><p className="font-semibold text-foreground">Control boundary</p><p className="mt-1">This session is view-only. Mouse, keyboard, clipboard and transfer controls remain locked until the endpoint presents a separate control-consent prompt and every action is auditable.</p></div></aside>}
        </main>
      </section>}
    </div>
  );
}
