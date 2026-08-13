import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertTriangle, Building2, Cloud, Loader2, Phone, PhoneCall, PhoneIncoming, Radio, RefreshCw, Users, Wifi } from "lucide-react";
import { toast } from "sonner";

const formatDuration = (seconds) => {
  const total = Math.max(0, Number(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const compactDate = (value) => value ? new Date(value).toLocaleString() : "Not yet";

function WallboardFact({ label, value }) {
  return <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2"><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-1 truncate text-xs font-medium text-slate-200" title={value}>{value}</p></div>;
}

function LiveCallCard({ call }) {
  const ringing = String(call.status || "").toLowerCase().includes("ring");
  const tone = ringing
    ? "border-amber-400/30 bg-amber-500/[0.07] hover:border-amber-300/55 hover:shadow-amber-950/20"
    : "border-rose-400/25 bg-rose-500/[0.055] hover:border-rose-300/50 hover:shadow-rose-950/20";
  const label = ringing ? "Incoming call" : "Call in progress";
  return <div className={`group relative overflow-hidden rounded-xl border p-4 transition hover:shadow-lg ${tone}`}>
    <div className={`absolute inset-y-0 left-0 w-1 ${ringing ? "bg-amber-400" : "bg-rose-400"}`}><span className={`absolute inset-0 animate-pulse ${ringing ? "bg-amber-100/70" : "bg-rose-100/60"}`} /></div>
    <div className="flex items-start justify-between gap-3 pl-2"><div className="flex min-w-0 gap-3"><div className={`mt-0.5 rounded-lg border p-2 ${ringing ? "border-amber-400/25 bg-amber-400/[0.1] text-amber-200" : "border-rose-400/25 bg-rose-400/[0.1] text-rose-200"}`}>{ringing ? <PhoneIncoming className="nx-voice-ringing h-4 w-4" /> : <PhoneCall className="h-4 w-4" />}</div><div className="min-w-0"><p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${ringing ? "text-amber-300" : "text-rose-300"}`}>{label} · {call.pbx?.client_name || "Client"} · {call.pbx?.name || "PBX"}</p><p className="mt-1 truncate text-sm font-semibold">{call.caller_name || call.caller || "Unknown caller"} → {call.callee_name || call.callee || "Destination pending"}</p></div></div><span className={`shrink-0 rounded-md border px-2 py-1 font-mono text-xs ${ringing ? "border-amber-400/25 bg-amber-400/[0.1] text-amber-100" : "border-rose-400/25 bg-rose-400/[0.1] text-rose-100"}`}>{formatDuration(call.duration)}</span></div>
    <div className="mt-4 grid gap-2 pl-2 sm:grid-cols-2"><WallboardFact label="Landed at" value={call.landing_target || call.callee_name || call.callee || "PBX destination"} /><WallboardFact label={ringing ? "Waiting for" : "Answered by"} value={call.answered_by || (ringing ? "Available extensions" : "Not reported by PBX")} /></div>
  </div>;
}

function PresenceItem({ item }) {
  const tone = {
    available: "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200",
    away: "border-amber-500/25 bg-amber-500/[0.06] text-amber-200",
    do_not_disturb: "border-violet-500/25 bg-violet-500/[0.06] text-violet-200",
    on_call: "border-rose-500/25 bg-rose-500/[0.07] text-rose-200",
    ringing: "border-amber-400/35 bg-amber-400/[0.09] text-amber-100",
    offline: "border-border/70 bg-muted/30 text-muted-foreground",
  }[item.state] || "border-border/70 bg-muted/30 text-muted-foreground";
  const label = { available: "Available", away: "Away", do_not_disturb: "Do not disturb", on_call: "On call", ringing: "Incoming call", offline: "Offline" }[item.state] || "Unknown";
  return <div className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 ${tone}`} title={`${item.number} · ${label}${item.raw_status ? ` · Yeastar: ${item.raw_status}` : ""}`}><span className={`relative flex h-2.5 w-2.5 shrink-0 ${item.state === "ringing" ? "nx-voice-ringing" : ""}`}><span className="absolute inset-0 rounded-full bg-current opacity-25" /><span className="relative m-auto h-1.5 w-1.5 rounded-full bg-current" /></span><div className="min-w-0"><p className="truncate text-xs font-medium">{item.name || item.number}</p><p className="truncate text-[10px] opacity-80">{item.number} · {label}</p></div></div>;
}

function PresencePbxCard({ snapshot }) {
  const items = snapshot.presence?.extensions || [];
  const summary = snapshot.presence?.summary || {};
  const pbx = snapshot.pbx || {};
  return <Card className="border-border/60"><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="truncate text-sm">{pbx.client_name || "Client"} / {pbx.name || "PBX"}</CardTitle><CardDescription>{summary.on_call || 0} on call · {summary.ringing || 0} ringing · {summary.away || 0} away</CardDescription></div><Badge variant="outline" className="border-cyan-500/25 text-cyan-200">{items.length} extensions</Badge></div></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{items.length ? items.slice(0, 12).map((item) => <PresenceItem key={item.id} item={item} />) : <p className="py-4 text-center text-xs text-muted-foreground sm:col-span-2">No extension presence reported by this PBX.</p>}{items.length > 12 ? <p className="text-xs text-muted-foreground sm:col-span-2">Showing 12 of {items.length} extensions. Open the PBX monitor for the complete roster.</p> : null}</CardContent></Card>;
}

function PbxCard({ snapshot, onOpen }) {
  const isOnline = snapshot.health === "online";
  const pbx = snapshot.pbx || {};
  return <Card className="group border-border/60 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-400/35 hover:shadow-lg hover:shadow-cyan-950/15">
    <CardContent className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{pbx.client_name || "Client"} <span className="text-muted-foreground">/</span> {pbx.name || "PBX"}</p><p className="mt-1 text-xs text-muted-foreground">{snapshot.extensions?.registered || 0}/{snapshot.extensions?.total || 0} extensions registered</p></div>
        <Badge variant="outline" className={isOnline ? "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-200" : "border-amber-500/30 bg-amber-500/[0.07] text-amber-200"}>{isOnline ? "Online" : "Needs attention"}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center"><WallboardFact label="Live calls" value={String(snapshot.active_calls?.length || 0)} /><WallboardFact label="Missed" value={String(snapshot.missed_calls || 0)} /><WallboardFact label="Latency" value={`${snapshot.api_latency_ms || 0}ms`} /></div>
      <Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => onOpen(pbx.id)}>Open PBX monitor</Button>
    </CardContent>
  </Card>;
}

export default function VoiceWallboardPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [wallboard, setWallboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const { data } = await axios.get(`${API}/yeastar/monitoring/wallboard`, { headers });
      setWallboard(data);
    } catch (error) {
      if (!quiet) toast.error(error.response?.data?.detail || "Could not load the Voice wallboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ quiet: true }), 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  const snapshots = wallboard?.pbxs || [];
  const activeCalls = snapshots.flatMap((snapshot) => (snapshot.active_calls || []).map((call) => ({ ...call, pbx: snapshot.pbx })));
  const online = snapshots.filter((snapshot) => snapshot.health === "online").length;
  const attention = snapshots.length - online;
  const attentionSnapshots = snapshots.filter((snapshot) => snapshot.health !== "online");
  const openPbx = (pbxId) => navigate(`/voice?tab=monitoring${pbxId ? `&pbxId=${encodeURIComponent(pbxId)}` : ""}`);

  return <div className="space-y-5">
    <OperationalPageHeader eyebrow="Voice operations" title="Live PBX Wallboard" icon={Radio} tone="sky" signal="live-voice" description="A real-time, permission-scoped view of calls and PBX health across every client connection you are authorised to operate." actions={<><Button variant="outline" onClick={() => navigate("/voice?tab=pbxs")}><Building2 className="mr-2 h-4 w-4" />Manage PBXs</Button><Button onClick={() => load()} disabled={loading || refreshing}><RefreshCw className={`mr-2 h-4 w-4 ${(loading || refreshing) ? "animate-spin" : ""}`} />Refresh live feed</Button></>} />

    <MetricStrip columns={5}>
      <MetricTile label="Authorised PBXs" value={snapshots.length} accent="cyan" icon={Building2} />
      <MetricTile label="Healthy now" value={online} accent="emerald" icon={Cloud} />
      <MetricTile label="Need attention" value={attention} accent={attention ? "amber" : "emerald"} icon={AlertTriangle} />
      <MetricTile label="Calls in progress" value={activeCalls.length} accent="sky" icon={Phone} />
      <MetricTile label="Registered extensions" value={`${snapshots.reduce((sum, item) => sum + (item.extensions?.registered || 0), 0)}/${snapshots.reduce((sum, item) => sum + (item.extensions?.total || 0), 0)}`} accent="emerald" icon={Users} />
    </MetricStrip>

    <Card className={attention ? "border-amber-500/25 bg-amber-500/[0.035]" : "border-emerald-500/20 bg-emerald-500/[0.025]"}>
      <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-sm">{attention ? <AlertTriangle className="h-4 w-4 text-amber-300" /> : <Cloud className="h-4 w-4 text-emerald-300" />}{attention ? "PBXs needing a technician" : "Voice estate is operating normally"}</CardTitle><CardDescription>{attention ? "Open the client-scoped monitor to investigate a failed API check or an incomplete PBX configuration." : "Every PBX available to you passed its most recent live health check."}</CardDescription></div><Badge variant="outline" className={attention ? "border-amber-500/30 text-amber-200" : "border-emerald-500/30 text-emerald-200"}>{attention ? `${attention} need attention` : "All healthy"}</Badge></div></CardHeader>
      {attention ? <CardContent className="grid gap-2 pt-0 lg:grid-cols-2">{attentionSnapshots.map((snapshot) => <div key={snapshot.pbx?.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/15 bg-background/40 p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{snapshot.pbx?.client_name || "Client"} / {snapshot.pbx?.name || "PBX"}</p><p className="mt-1 text-xs text-muted-foreground">{snapshot.health === "not_configured" ? "Needs API credentials or a completed connection test." : "The most recent live check did not complete successfully."}</p></div><Button size="sm" variant="outline" onClick={() => openPbx(snapshot.pbx?.id)}>Investigate</Button></div>)}</CardContent> : null}
    </Card>

    <Card className="overflow-hidden border-cyan-500/25 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.14),transparent_42%),linear-gradient(135deg,rgba(8,47,73,0.24),rgba(15,23,42,0.4))]" data-testid="voice-all-tenant-wallboard">
      <CardHeader className="border-b border-cyan-500/10"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Radio className="h-4 w-4 text-emerald-300" />Live calls across your PBX estate</CardTitle><CardDescription>Caller, landing group or queue, and the extension that answers — refreshed automatically every 10 seconds.</CardDescription></div><div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-1.5 text-xs text-emerald-200"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>Live estate feed</div></div></CardHeader>
      <CardContent className="p-4">{loading ? <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting to authorised PBXs…</div> : activeCalls.length ? <div className="grid gap-3 xl:grid-cols-2">{activeCalls.map((call) => <LiveCallCard key={`${call.pbx?.id}-${call.call_id}`} call={call} />)}</div> : <div className="py-12 text-center"><Phone className="mx-auto mb-3 h-9 w-9 text-cyan-300/40" /><p className="text-sm font-medium">No live calls across your authorised PBXs</p><p className="mt-1 text-xs text-muted-foreground">Incoming and active calls will animate here as PBXs report them.</p></div>}</CardContent>
    </Card>

    {!loading && snapshots.length ? <section className="space-y-3"><div><h2 className="text-base font-semibold">Live extension presence</h2><p className="mt-1 text-xs text-muted-foreground">Yeastar presence status, enhanced by active-call data. On-call is red, away is amber, and an incoming call vibrates until it is answered.</p></div><div className="grid gap-3 xl:grid-cols-2">{snapshots.map((snapshot) => <PresencePbxCard key={snapshot.pbx?.id} snapshot={snapshot} />)}</div></section> : null}

    <section><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-semibold">PBX estate</h2><p className="text-xs text-muted-foreground">Last refreshed {compactDate(wallboard?.checked_at)}. Each tile opens the client-scoped diagnostic monitor.</p></div><span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Wifi className="h-3.5 w-3.5 text-cyan-300" />Data remains scoped to your role</span></div>{loading ? null : snapshots.length ? <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{snapshots.map((snapshot) => <PbxCard key={snapshot.pbx?.id} snapshot={snapshot} onOpen={openPbx} />)}</div> : <Card><CardContent className="py-12 text-center"><Activity className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><p className="text-sm font-medium">No PBXs are available to this role</p><p className="mt-1 text-xs text-muted-foreground">Add a client PBX in Voice services, then its health and calls will automatically feed this wallboard.</p><Button className="mt-4" onClick={() => navigate("/voice?tab=pbxs")}>Add client PBX</Button></CardContent></Card>}</section>
  </div>;
}
