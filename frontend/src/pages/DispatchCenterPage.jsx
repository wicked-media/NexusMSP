import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, CalendarDays, MapPin, Users, Truck, Clock, Zap } from "lucide-react";

export default function DispatchCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("board");
  const [board, setBoard] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [availability, setAvailability] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/dispatch/board`, { headers }).catch(() => ({ data: null })),
      axios.get(`${API}/scheduling/calendar`, { headers }).catch(() => ({ data: null })),
      axios.get(`${API}/scheduling/technician-availability`, { headers }).catch(() => ({ data: [] })),
    ]).then(([b, c, a]) => { setBoard(b.data); setCalendar(c.data); setAvailability(a.data || []); }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const bs = board?.summary || board || {};
  const unassigned = board?.unassigned || [];
  const dispatched = board?.dispatched || board?.assigned || [];
  const events = calendar?.events || calendar || [];
  const availList = Array.isArray(availability) ? availability : availability?.technicians || [];

  return (
    <div className="space-y-5" data-testid="dispatch-center">
      <div><h1 className="text-3xl font-bold tracking-tight">Dispatch & Scheduling</h1><p className="text-sm text-muted-foreground">Dispatch board, smart scheduling, and technician availability — all in one place</p></div>
      <div className="grid grid-cols-4 gap-3">
        <Card className="border-amber-500/20"><CardContent className="pt-4 pb-3"><Clock className="w-5 h-5 text-amber-400 mb-1" /><p className="text-2xl font-bold text-amber-400">{unassigned.length}</p><p className="text-[11px] text-muted-foreground">Unassigned</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><Truck className="w-5 h-5 text-blue-400 mb-1" /><p className="text-2xl font-bold">{dispatched.length}</p><p className="text-[11px] text-muted-foreground">Dispatched</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><CalendarDays className="w-5 h-5 text-violet-400 mb-1" /><p className="text-2xl font-bold">{Array.isArray(events) ? events.length : 0}</p><p className="text-[11px] text-muted-foreground">Scheduled Events</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><Users className="w-5 h-5 text-emerald-400 mb-1" /><p className="text-2xl font-bold">{availList.filter(a => a.available || a.status === "available").length}/{availList.length}</p><p className="text-[11px] text-muted-foreground">Techs Available</p></CardContent></Card>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="board"><Zap className="w-3 h-3 mr-1" />Dispatch Board</TabsTrigger>
          <TabsTrigger value="calendar"><CalendarDays className="w-3 h-3 mr-1" />Calendar</TabsTrigger>
          <TabsTrigger value="availability"><Users className="w-3 h-3 mr-1" />Availability</TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="space-y-4">
          {unassigned.length > 0 && (<Card className="border-amber-500/20"><CardHeader className="pb-2"><CardTitle className="text-sm text-amber-400">Unassigned ({unassigned.length})</CardTitle></CardHeader><CardContent>
            <Table><TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Client</TableHead><TableHead>Priority</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
              <TableBody>{unassigned.map((t, i) => (<TableRow key={i}><TableCell className="font-medium">{t.title || t.ticket_id}</TableCell><TableCell>{t.client_name}</TableCell><TableCell><Badge variant={t.priority === "critical" ? "destructive" : "secondary"} className="text-[10px] capitalize">{t.priority}</Badge></TableCell><TableCell className="text-sm">{(t.created_at || "").slice(0, 10)}</TableCell></TableRow>))}</TableBody></Table>
          </CardContent></Card>)}
          {dispatched.length > 0 && (<Card><CardHeader className="pb-2"><CardTitle className="text-sm">Dispatched ({dispatched.length})</CardTitle></CardHeader><CardContent>
            <Table><TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Technician</TableHead><TableHead>Client</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>{dispatched.map((t, i) => (<TableRow key={i}><TableCell className="font-medium">{t.title || t.ticket_id}</TableCell><TableCell>{t.assigned_name || t.tech_name}</TableCell><TableCell>{t.client_name}</TableCell><TableCell><Badge variant="outline" className="text-[10px] capitalize">{(t.status || "").replace("_", " ")}</Badge></TableCell></TableRow>))}</TableBody></Table>
          </CardContent></Card>)}
          {unassigned.length === 0 && dispatched.length === 0 && <p className="text-center text-muted-foreground py-8">Dispatch board is clear</p>}
        </TabsContent>
        <TabsContent value="calendar">
          {Array.isArray(events) && events.length > 0 ? (
            <Table><TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Technician</TableHead><TableHead>Client</TableHead><TableHead>Date</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
              <TableBody>{events.slice(0, 20).map((e, i) => (<TableRow key={i}><TableCell className="font-medium">{e.title || e.event_type}</TableCell><TableCell>{e.technician_name || e.tech}</TableCell><TableCell>{e.client_name}</TableCell><TableCell className="text-sm">{(e.date || e.start || "").slice(0, 10)}</TableCell><TableCell className="text-sm">{e.time || (e.start || "").slice(11, 16)}</TableCell></TableRow>))}</TableBody></Table>
          ) : <p className="text-center text-muted-foreground py-8">No scheduled events</p>}
        </TabsContent>
        <TabsContent value="availability">
          <div className="grid grid-cols-3 gap-3">{availList.map((a, i) => (
            <Card key={i}><CardContent className="py-3"><div className="flex items-center gap-3"><div className={`w-10 h-10 rounded-lg flex items-center justify-center ${(a.available || a.status === "available") ? "bg-emerald-500/15" : "bg-red-500/15"}`}><Users className={`w-5 h-5 ${(a.available || a.status === "available") ? "text-emerald-400" : "text-red-400"}`} /></div><div><p className="font-medium text-sm">{a.name || a.tech_name}</p><p className="text-[10px] text-muted-foreground">{a.current_tickets || a.open_tickets || 0} open tickets</p></div><Badge variant={(a.available || a.status === "available") ? "default" : "secondary"} className="text-[10px] ml-auto">{(a.available || a.status === "available") ? "Available" : a.status || "Busy"}</Badge></div></CardContent></Card>
          ))}</div>
          {availList.length === 0 && <p className="text-center text-muted-foreground py-8">No technician data</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
