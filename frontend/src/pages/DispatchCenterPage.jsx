import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TicketModuleHeader } from "@/components/tickets/TicketWorkspaceShell";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { TICKET_PRIORITY_STYLES } from "@/lib/ticketWorkspaceHelpers";
import { LOCAL_PREVIEW_TICKETS, LOCAL_PREVIEW_USERS, localPreviewCollection, localPreviewRecord } from "@/lib/ticketPreviewData";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, CalendarDays, Users, Truck, Clock, Zap } from "lucide-react";

const DISPATCH_TABS = ["board", "calendar", "availability"];

export default function DispatchCenterPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState(DISPATCH_TABS.includes(requestedTab) ? requestedTab : "board");
  const [board, setBoard] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [availability, setAvailability] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/dispatch/board`, { headers }).catch(() => ({ data: null })),
      axios.get(`${API}/scheduling/calendar`, { headers }).catch(() => ({ data: null })),
      axios.get(`${API}/scheduling/technician-availability`, { headers }).catch(() => ({ data: [] })),
    ]).then(([b, c, a]) => {
      setBoard(localPreviewRecord(b.data, {
        unassigned: LOCAL_PREVIEW_TICKETS.filter(ticket => !ticket.assigned_to && !["resolved", "closed"].includes(ticket.status)),
        dispatched: LOCAL_PREVIEW_TICKETS.filter(ticket => ticket.assigned_to && !["resolved", "closed"].includes(ticket.status)),
      }));
      setCalendar(localPreviewRecord(c.data, { events: [
        { title: "On-site access point replacement", technician_name: "Priya Shah", client_name: "Harbour Legal", start: new Date(Date.now() + 86400000).toISOString() },
        { title: "New starter equipment delivery", technician_name: "Aaron Thompson", client_name: "Northstar Health", start: new Date(Date.now() + 172800000).toISOString() },
      ] }));
      setAvailability(localPreviewCollection(Array.isArray(a.data) ? a.data : a.data?.technicians, LOCAL_PREVIEW_USERS.map((user, index) => ({ ...user, available: index !== 2, current_tickets: index + 1 }))));
    }).finally(() => setLoading(false));
  }, [headers]);

  useEffect(() => {
    if (DISPATCH_TABS.includes(requestedTab)) setTab(requestedTab);
  }, [requestedTab]);

  const selectTab = (nextTab) => {
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === "board") url.searchParams.delete("tab");
    else url.searchParams.set("tab", nextTab);
    window.history.replaceState({}, "", url);
  };

  if (loading) return <div className="space-y-5"><TicketModuleHeader title="Dispatch & scheduling" subtitle="Loading assignments and technician availability…" /><div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div></div>;

  const unassigned = board?.unassigned || [];
  const dispatched = board?.dispatched || board?.assigned || [];
  const events = calendar?.events || calendar || [];
  const availList = Array.isArray(availability) ? availability : availability?.technicians || [];
  const openTicket = (ticket) => {
    const id = ticket?.id || ticket?.ticket_id;
    if (id) navigate(`/tickets?ticket=${encodeURIComponent(id)}`);
  };

  return (
    <div className="space-y-5" data-testid="dispatch-center">
      <TicketModuleHeader title="Dispatch & scheduling" subtitle="Assign unowned work, review the calendar, and balance technician availability." />
      <MetricStrip columns={4}>
        <MetricTile label="Unassigned" value={unassigned.length} accent="amber" icon={<Clock className="w-2.5 h-2.5 text-amber-400" />} testid="dispatch-metric-unassigned" />
        <MetricTile label="Dispatched" value={dispatched.length} accent="sky" icon={<Truck className="w-2.5 h-2.5 text-sky-400" />} testid="dispatch-metric-dispatched" />
        <MetricTile label="Scheduled Events" value={Array.isArray(events) ? events.length : 0} accent="violet" icon={<CalendarDays className="w-2.5 h-2.5 text-violet-400" />} testid="dispatch-metric-scheduled" />
        <MetricTile label="Techs Available" value={`${availList.filter(a => a.available || a.status === "available").length}/${availList.length}`} accent="emerald" icon={<Users className="w-2.5 h-2.5 text-emerald-400" />} testid="dispatch-metric-available" />
      </MetricStrip>
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="board"><Zap className="w-3 h-3 mr-1" />Dispatch Board</TabsTrigger>
          <TabsTrigger value="calendar"><CalendarDays className="w-3 h-3 mr-1" />Calendar</TabsTrigger>
          <TabsTrigger value="availability"><Users className="w-3 h-3 mr-1" />Availability</TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {unassigned.length > 0 && (<Card className="overflow-hidden border-amber-500/25"><CardHeader className="pb-3 border-b border-amber-500/15 bg-amber-500/[0.045]"><div className="flex items-center justify-between"><div><CardTitle className="text-sm flex items-center gap-2 text-amber-300"><Clock className="w-4 h-4" />Needs an owner</CardTitle><p className="text-[11px] text-muted-foreground mt-1">Prioritise and assign before the queue becomes stale.</p></div><Badge className="bg-amber-500/15 text-amber-300 border-amber-500/25">{unassigned.length}</Badge></div></CardHeader><CardContent className="p-3 space-y-2">
            {unassigned.map((t, i) => (<button key={t.id || t.ticket_id || i} className="w-full text-left rounded-xl border border-border/70 bg-card p-3 hover:border-amber-500/35 hover:bg-amber-500/[0.035] transition-colors" onClick={() => openTicket(t)}><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{t.title || t.ticket_id}</p><p className="text-xs text-muted-foreground mt-1">{t.client_name || "Client pending"} <span className="mx-1.5 text-muted-foreground/35">•</span> {(t.created_at || "").slice(0, 10) || "New"}</p></div><Badge className={`shrink-0 text-[10px] capitalize ${TICKET_PRIORITY_STYLES[t.priority]?.badge || TICKET_PRIORITY_STYLES.medium.badge}`}>{t.priority || "normal"}</Badge></div></button>))}
          </CardContent></Card>)}
          {dispatched.length > 0 && (<Card className="overflow-hidden border-blue-500/20"><CardHeader className="pb-3 border-b border-blue-500/15 bg-blue-500/[0.04]"><div className="flex items-center justify-between"><div><CardTitle className="text-sm flex items-center gap-2"><Truck className="w-4 h-4 text-blue-300" />In technician ownership</CardTitle><p className="text-[11px] text-muted-foreground mt-1">Open work already assigned to the service team.</p></div><Badge variant="outline" className="border-blue-500/25 text-blue-200">{dispatched.length}</Badge></div></CardHeader><CardContent className="p-3 space-y-2">
            {dispatched.map((t, i) => (<button key={t.id || t.ticket_id || i} className="w-full text-left rounded-xl border border-border/70 bg-card p-3 hover:border-blue-500/35 hover:bg-blue-500/[0.03] transition-colors" onClick={() => openTicket(t)}><div className="flex items-start gap-2"><div className="w-7 h-7 rounded-full bg-blue-500/12 text-blue-200 flex items-center justify-center text-xs font-semibold shrink-0">{(t.assigned_name || t.tech_name || "?").slice(0, 1)}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold truncate">{t.title || t.ticket_id}</p><Badge variant="outline" className="text-[9px] capitalize shrink-0">{(t.status || "open").replace("_", " ")}</Badge></div><p className="text-xs text-muted-foreground mt-1">{t.assigned_name || t.tech_name || "Technician pending"} <span className="mx-1.5 text-muted-foreground/35">•</span> {t.client_name || "Client pending"}</p></div></div></button>))}
          </CardContent></Card>)}
          </div>
          {unassigned.length === 0 && dispatched.length === 0 && <p className="text-center text-muted-foreground py-8">Dispatch board is clear</p>}
        </TabsContent>
        <TabsContent value="calendar" className="space-y-3">
          {Array.isArray(events) && events.length > 0 ? (
            <Card className="overflow-hidden"><CardHeader className="pb-3 border-b bg-violet-500/[0.035]"><CardTitle className="text-sm flex items-center gap-2"><CalendarDays className="w-4 h-4 text-violet-300" />Upcoming field commitments</CardTitle></CardHeader><CardContent className="p-3 space-y-2">{events.slice(0, 20).map((e, i) => (<div key={i} className="flex items-center gap-3 rounded-xl border border-border/70 p-3 hover:bg-muted/[0.25] transition-colors"><div className="w-12 rounded-lg bg-violet-500/10 text-center py-1.5 shrink-0"><p className="text-[9px] uppercase text-violet-300">{(e.date || e.start || "").slice(5, 7) || "—"}</p><p className="font-mono text-sm font-semibold">{(e.date || e.start || "").slice(8, 10) || "—"}</p></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{e.title || e.event_type || "Scheduled work"}</p><p className="text-xs text-muted-foreground mt-0.5">{e.client_name || "Client pending"} <span className="mx-1.5 text-muted-foreground/35">•</span> {e.technician_name || e.tech || "Technician pending"}</p></div><Badge variant="outline" className="font-mono text-[10px] shrink-0">{e.time || (e.start || "").slice(11, 16) || "TBC"}</Badge></div>))}</CardContent></Card>
          ) : <p className="text-center text-muted-foreground py-8">No scheduled events</p>}
        </TabsContent>
        <TabsContent value="availability">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{availList.map((a, i) => {
            const isAvailable = a.available || a.status === "available";
            const load = a.current_tickets || a.open_tickets || 0;
            return <Card key={i} className={isAvailable ? "border-emerald-500/20" : "border-border/70"}><CardContent className="py-4"><div className="flex items-center gap-3"><div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isAvailable ? "bg-emerald-500/15" : "bg-amber-500/15"}`}><Users className={`w-5 h-5 ${isAvailable ? "text-emerald-400" : "text-amber-400"}`} /></div><div className="min-w-0 flex-1"><p className="font-semibold text-sm truncate">{a.name || a.tech_name}</p><p className="text-[10px] text-muted-foreground mt-0.5">{load} open {load === 1 ? "ticket" : "tickets"}</p></div><Badge variant="outline" className={`text-[10px] ${isAvailable ? "border-emerald-500/25 text-emerald-300" : "border-amber-500/25 text-amber-300"}`}>{isAvailable ? "Available" : a.status || "Busy"}</Badge></div><div className="mt-3 h-1.5 rounded-full bg-muted/60 overflow-hidden"><div className={`h-full rounded-full ${isAvailable ? "bg-emerald-400" : "bg-amber-400"}`} style={{ width: `${Math.min(100, Math.max(12, load * 20))}%` }} /></div></CardContent></Card>;
          })}</div>
          {availList.length === 0 && <p className="text-center text-muted-foreground py-8">No technician data</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
