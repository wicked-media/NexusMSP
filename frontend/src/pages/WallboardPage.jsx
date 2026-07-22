import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Activity, AlertTriangle, BellRing, CheckCircle2, CircleAlert, Clock3, ExternalLink, Gauge, Loader2, Monitor, Radio, RefreshCw, ServerCog, Ticket, UsersRound, Wifi, WifiOff, Zap } from "lucide-react";

const PRIORITY_STYLES = {
  critical: "border-red-500/25 bg-red-500/10 text-red-300",
  urgent: "border-red-500/25 bg-red-500/10 text-red-300",
  p1: "border-red-500/25 bg-red-500/10 text-red-300",
  high: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  medium: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  low: "border-zinc-500/25 bg-zinc-500/10 text-zinc-300",
};

const PRESENCE_STYLES = {
  active: { dot: "bg-emerald-400", label: "Available", badge: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" },
  busy: { dot: "bg-sky-400", label: "Busy", badge: "border-sky-500/20 bg-sky-500/10 text-sky-300" },
  away: { dot: "bg-amber-400", label: "Away", badge: "border-amber-500/20 bg-amber-500/10 text-amber-300" },
  dnd: { dot: "bg-red-400", label: "Do not disturb", badge: "border-red-500/20 bg-red-500/10 text-red-300" },
  break: { dot: "bg-amber-400", label: "On break", badge: "border-amber-500/20 bg-amber-500/10 text-amber-300" },
  offline: { dot: "bg-zinc-500", label: "Offline", badge: "border-zinc-500/25 bg-zinc-500/10 text-zinc-300" },
  not_reported: { dot: "bg-zinc-600", label: "No heartbeat", badge: "border-zinc-500/25 bg-zinc-500/10 text-zinc-400" },
};

function formatTimer(seconds, slaState) {
  if (slaState === "not_assessed") return "No SLA";
  if (slaState === "invalid") return "Invalid SLA";
  if (slaState === "breached" || (Number.isFinite(seconds) && seconds <= 0)) return "Breached";
  if (!Number.isFinite(seconds)) return "No SLA";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function initials(name) {
  return String(name || "Nexus User").split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function formatActivity(activity) {
  return activity?.message || activity?.description || activity?.action || activity?.event_type || activity?.type || "Recorded operational activity";
}

function formatActivityTime(activity) {
  const raw = activity?.timestamp || activity?.created_at || activity?.ts;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "Recorded event";
}

export default function WallboardPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loadError, setLoadError] = useState("");

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await axios.get(`${API}/wallboard/data`, { headers });
      setData(response.data || {});
      setUpdatedAt(new Date());
      setLoadError("");
    } catch (error) {
      setLoadError(error?.response?.data?.detail || "Unable to refresh live wallboard data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-cyan-300" /></div>;

  const tickets = data?.tickets || {};
  const devices = data?.devices || {};
  const queue = tickets.queue || [];
  const technicians = data?.technicians || [];
  const recentActivity = data?.recent_activity || [];
  const secondsSinceUpdate = updatedAt ? Math.max(0, Math.floor((clock.getTime() - updatedAt.getTime()) / 1000)) : null;
  const isStale = secondsSinceUpdate === null || secondsSinceUpdate > 45;
  const healthTone = loadError ? "rose" : isStale ? "amber" : "emerald";
  const healthCopy = loadError || (isStale ? "Data refresh is overdue" : "Live data is connected");
  const availability = Number(devices.availability_pct || 0);
  const availabilityColor = availability >= 95 ? "#34d399" : availability >= 85 ? "#fbbf24" : "#fb7185";
  const workloadPressure = technicians.filter((tech) => tech.workload_state === "at_capacity").length;

  const openTicketQueue = (filters = {}) => {
    try { localStorage.setItem("nexus.tickets.applyView", JSON.stringify({ id: "wallboard", filters })); } catch { /* tickets still open without saved filters */ }
    navigate("/tickets");
  };

  return (
    <main className="min-h-screen space-y-5 bg-background p-4 text-foreground sm:p-6" data-testid="wallboard-page">
      <OperationalPageHeader
        eyebrow="Network operations centre"
        title="NOC Wallboard"
        description="A live operational view of ticket pressure, SLA exposure, technician capacity and managed-asset health."
        icon={Monitor}
        tone="sky"
        actions={<>
          <div className="hidden text-right xl:block"><p className="font-mono text-xl font-bold text-cyan-300">{clock.toLocaleTimeString()}</p><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{clock.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</p></div>
          <Button variant="outline" onClick={() => navigate("/tickets")}><Ticket className="mr-1.5 h-4 w-4" />Service desk</Button>
          <Button variant="outline" onClick={fetchData} disabled={refreshing} data-testid="refresh-wallboard"><RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />{refreshing ? "Refreshing" : "Refresh"}</Button>
        </>}
      />

      <section className={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-4 py-3 text-xs ${healthTone === "rose" ? "border-red-500/25 bg-red-500/[0.06]" : healthTone === "amber" ? "border-amber-500/25 bg-amber-500/[0.06]" : "border-emerald-500/20 bg-emerald-500/[0.045]"}`} data-testid="wallboard-live-strip">
        <span className="flex items-center gap-2 font-semibold"><span className={`relative flex h-2.5 w-2.5 rounded-full ${healthTone === "rose" ? "bg-red-400" : healthTone === "amber" ? "bg-amber-400" : "bg-emerald-400"}`}><span className={`absolute inset-0 animate-ping rounded-full opacity-70 ${healthTone === "rose" ? "bg-red-400" : healthTone === "amber" ? "bg-amber-400" : "bg-emerald-400"}`} /></span>{healthCopy}</span>
        <span>{updatedAt ? `Updated ${secondsSinceUpdate}s ago` : "Awaiting first refresh"}</span>
        <span className="hidden sm:inline">{tickets.sla_breached || 0} SLA breach{Number(tickets.sla_breached || 0) === 1 ? "" : "es"}</span>
        <span className="hidden sm:inline">{devices.active_alerts || 0} active monitoring alert{Number(devices.active_alerts || 0) === 1 ? "" : "s"}</span>
        <span className="hidden lg:inline">{workloadPressure} technician{workloadPressure === 1 ? "" : "s"} at capacity</span>
        <span className="ml-auto flex items-center gap-1.5 text-muted-foreground"><Radio className="h-3.5 w-3.5 text-cyan-300" />15-second refresh cadence</span>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <HeroTile label="Open tickets" value={tickets.open || 0} subtitle="Current service workload" icon={Ticket} glow="sky" onClick={() => openTicketQueue({ status: "open" })} testId="wallboard-open-tickets" />
        <HeroTile label="Critical" value={tickets.critical || 0} subtitle="Immediate attention" icon={CircleAlert} glow={(tickets.critical || 0) > 0 ? "rose" : "emerald"} onClick={() => openTicketQueue({ priority: "critical" })} testId="wallboard-critical-tickets" />
        <HeroTile label="High priority" value={tickets.high || 0} subtitle="Needs prompt action" icon={AlertTriangle} glow="amber" onClick={() => openTicketQueue({ priority: "high" })} testId="wallboard-high-tickets" />
        <HeroTile label="SLA breaches" value={tickets.sla_breached || 0} subtitle={`${tickets.sla_measured || 0} measured records`} icon={Clock3} glow={(tickets.sla_breached || 0) > 0 ? "rose" : "emerald"} onClick={() => openTicketQueue({ sla_state: "breached" })} testId="wallboard-sla-breaches" />
        <HeroTile label="Agents online" value={devices.enrolled ? `${devices.online || 0}/${devices.enrolled}` : "N/A"} subtitle={`${devices.offline || 0} endpoint${devices.offline === 1 ? "" : "s"} offline`} icon={Wifi} glow="cyan" animated={false} onClick={() => navigate("/devices")} testId="wallboard-agents-online" />
        <HeroTile label="Availability" value={devices.availability_pct == null ? "N/A" : devices.availability_pct} suffix={devices.availability_pct == null ? "" : "%"} subtitle="Agent-enrolled asset base" icon={Gauge} glow={availability >= 95 ? "emerald" : availability >= 85 ? "amber" : "rose"} animated={devices.availability_pct != null} onClick={() => navigate("/devices")} testId="wallboard-availability" />
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <Card className="overflow-hidden border-border/70 bg-card/70 xl:col-span-7">
          <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Service desk pulse</p><CardTitle className="mt-1 flex items-center gap-2 text-base"><Zap className="h-4 w-4 text-amber-300" />Live ticket queue</CardTitle></div><Button size="sm" variant="outline" onClick={() => openTicketQueue()}><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Open queue</Button></div></CardHeader>
          <CardContent className="p-0"><div className="divide-y divide-border/50 xl:max-h-[calc(100vh-495px)] xl:overflow-y-auto">{queue.slice(0, 20).map((ticket) => { const breached = ticket.sla_state === "breached" || (Number.isFinite(ticket.sla_remaining_seconds) && ticket.sla_remaining_seconds <= 0); const atRisk = ticket.sla_state === "measured" && !breached && ticket.sla_remaining_seconds < 1800; const slaClass = breached ? "text-red-300" : atRisk ? "text-amber-300" : ticket.sla_state === "not_assessed" ? "text-muted-foreground" : "text-emerald-300"; return <button key={ticket.id} type="button" onClick={() => navigate(`/tickets?ticket=${encodeURIComponent(ticket.ticket_number || ticket.id)}`)} className={`flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-sky-500/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-300 ${breached ? "bg-red-500/[0.035]" : atRisk ? "bg-amber-500/[0.035]" : ""}`}><Badge className={`${PRIORITY_STYLES[ticket.priority] || PRIORITY_STYLES.low} w-[58px] justify-center border text-[10px] capitalize`}>{ticket.priority || "normal"}</Badge><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{ticket.ticket_number ? `#${ticket.ticket_number} ` : ""}{ticket.title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{ticket.client_name || "Unassigned client"}<span className="mx-1.5">•</span>{ticket.assigned_to_name || "Unassigned"}</p></div><div className="min-w-[92px] text-right"><p className={`flex items-center justify-end gap-1 text-xs font-semibold ${slaClass}`}><Clock3 className="h-3.5 w-3.5" />{formatTimer(ticket.sla_remaining_seconds, ticket.sla_state)}</p><p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">SLA status</p></div></button>; })}{queue.length === 0 && <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center"><CheckCircle2 className="mb-3 h-8 w-8 text-emerald-300" /><p className="font-medium">The service desk is clear</p><p className="mt-1 text-sm text-muted-foreground">No open tickets are currently available for the NOC queue.</p></div>}</div></CardContent>
        </Card>

        <div className="space-y-4 xl:col-span-5">
          <Card className="border-border/70 bg-card/70"><CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-4"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Managed asset health</p><CardTitle className="mt-1 flex items-center gap-2 text-base"><ServerCog className="h-4 w-4 text-cyan-300" />Infrastructure pulse</CardTitle></CardHeader><CardContent className="grid gap-4 p-5 sm:grid-cols-[150px_1fr]"><div className="relative mx-auto flex h-36 w-36 items-center justify-center rounded-full" style={{ background: `conic-gradient(${availabilityColor} ${Math.max(0, Math.min(100, availability)) * 3.6}deg, rgba(113,113,122,0.18) 0deg)` }}><div className="flex h-[112px] w-[112px] flex-col items-center justify-center rounded-full bg-card"><span className="text-2xl font-bold">{devices.availability_pct == null ? "N/A" : `${devices.availability_pct}%`}</span><span className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">Availability</span></div></div><div className="grid content-center grid-cols-2 gap-3"><div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3"><Wifi className="h-4 w-4 text-emerald-300" /><p className="mt-2 text-xl font-bold">{devices.online || 0}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Agent online</p></div><div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-3"><WifiOff className="h-4 w-4 text-red-300" /><p className="mt-2 text-xl font-bold">{devices.offline || 0}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Agent offline</p></div><div className="col-span-2 rounded-xl border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground">{devices.enrolled || 0}</span> enrolled endpoints • <span className="font-semibold text-foreground">{devices.unmonitored || 0}</span> inventory-only assets</div></div>{Number(devices.active_alerts || 0) > 0 && <button type="button" onClick={() => navigate("/alert-rules")} className="sm:col-span-2 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.055] p-3 text-left text-xs text-amber-200 transition hover:bg-amber-500/[0.1]"><BellRing className="h-4 w-4 shrink-0 animate-pulse text-amber-300" /><span><strong>{devices.active_alerts} active alert{devices.active_alerts === 1 ? "" : "s"}</strong><span className="text-amber-200/70"> — open the alert rules engine to review policy coverage.</span></span></button>}</CardContent></Card>

          <Card className="border-border/70 bg-card/70"><CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Recorded audit</p><CardTitle className="mt-1 flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-violet-300" />Recent operational activity</CardTitle></div><Button size="sm" variant="ghost" onClick={() => navigate("/audit-trail")}>Audit trail</Button></div></CardHeader><CardContent className="p-0"><div className="divide-y divide-border/50">{recentActivity.slice(0, 5).map((activity, index) => <div key={activity.id || `${activity.timestamp}-${index}`} className="flex gap-3 px-5 py-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-300" /><div className="min-w-0"><p className="truncate text-sm">{formatActivity(activity)}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{formatActivityTime(activity)}</p></div></div>)}{recentActivity.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted-foreground">No recorded operational activity is available yet.</p>}</div></CardContent></Card>
        </div>
      </section>

      <Card className="border-border/70 bg-card/70"><CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Team capacity</p><CardTitle className="mt-1 flex items-center gap-2 text-base"><UsersRound className="h-4 w-4 text-sky-300" />Technician presence and workload</CardTitle></div><Button size="sm" variant="outline" onClick={() => navigate("/team-hub?view=directory")}>Team directory</Button></div></CardHeader><CardContent className="p-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{technicians.map((technician) => { const presence = PRESENCE_STYLES[technician.presence] || PRESENCE_STYLES.not_reported; const pressure = Math.min(100, (Number(technician.active_tickets || 0) / 5) * 100); const capacity = technician.workload_state === "at_capacity"; return <div key={technician.id} className="rounded-xl border border-border/60 bg-muted/[0.12] p-4"><div className="flex items-start gap-3"><div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-sky-500/20 bg-sky-500/10 text-xs font-bold text-sky-200">{initials(technician.name)}<span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card ${presence.dot}`} /></div><div className="min-w-0 flex-1"><p className="truncate font-semibold">{technician.name}</p><Badge className={`mt-1 border text-[9px] ${presence.badge}`}>{presence.label}</Badge></div></div><div className="mt-4 flex items-center justify-between text-xs"><span className="text-muted-foreground">{technician.active_tickets || 0} active • {technician.total_open || 0} open</span><span className={capacity ? "font-semibold text-red-300" : "font-semibold text-emerald-300"}>{capacity ? "At capacity" : technician.workload_state === "active" ? "Engaged" : "Clear"}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={capacity ? "h-full bg-red-400" : "h-full bg-sky-400"} style={{ width: `${pressure}%` }} /></div>{technician.work_item && <p className="mt-3 truncate text-[11px] text-muted-foreground">Working on: {technician.work_item}</p>}</div>; })}{technicians.length === 0 && <p className="col-span-full py-6 text-center text-sm text-muted-foreground">No technician presence records are available.</p>}</div></CardContent></Card>
    </main>
  );
}
