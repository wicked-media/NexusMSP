import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TicketModuleHeader } from "@/components/tickets/TicketWorkspaceShell";
import HeroTile from "@/components/HeroTile";
import { TICKET_PRIORITY_STYLES } from "@/lib/ticketWorkspaceHelpers";
import { CalendarDays, Clock, Loader2, Plus, ShieldAlert, Truck, UserRoundCheck, Users, Zap } from "lucide-react";
import { toast } from "sonner";

const DISPATCH_TABS = ["board", "calendar", "availability"];
const newBooking = () => ({
  date: new Date().toISOString().slice(0, 10), start_time: "09:00", end_time: "10:00",
  user_id: "", ticket_id: "", client_id: "", title: "", location: "", description: "", approval_note: "",
});

function DispatchTicketCard({ ticket, tone, onOpen, onAssign, assigned = false }) {
  const assignee = ticket.assigned_name || ticket.assigned_to_name || "Technician pending";
  return <div className={`rounded-xl border border-border/70 bg-card p-3 transition-colors ${tone === "amber" ? "hover:border-amber-500/35 hover:bg-amber-500/[0.035]" : "hover:border-blue-500/35 hover:bg-blue-500/[0.03]"}`}>
    <button type="button" className="w-full text-left" onClick={() => onOpen(ticket)}>
      <div className="flex items-start gap-2">
        {assigned && <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/12 text-xs font-semibold text-blue-200">{assignee.slice(0, 1)}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-semibold">{ticket.ticket_number ? `${ticket.ticket_number} - ` : ""}{ticket.title || ticket.id}</p><Badge className={`shrink-0 text-[10px] capitalize ${TICKET_PRIORITY_STYLES[ticket.priority]?.badge || TICKET_PRIORITY_STYLES.medium.badge}`}>{ticket.priority || "medium"}</Badge></div>
          <p className="mt-1 text-xs text-muted-foreground">{assigned ? assignee : ticket.client_name || "Client pending"} <span className="mx-1.5 text-muted-foreground/35">-</span> {assigned ? ticket.client_name || "Client pending" : (ticket.created_at || "").slice(0, 10) || "New"}</p>
        </div>
      </div>
    </button>
    <Button variant={assigned ? "ghost" : "outline"} size="sm" className="mt-3 h-8 w-full text-xs" onClick={() => onAssign(ticket)}>
      <UserRoundCheck className="mr-1.5 h-3.5 w-3.5" />{assigned ? "Reassign technician" : "Assign technician"}
    </Button>
  </div>;
}

export default function DispatchCenterPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const requestedClientId = new URLSearchParams(location.search).get("client") || "";
  const [tab, setTab] = useState(DISPATCH_TABS.includes(requestedTab) ? requestedTab : "board");
  const [board, setBoard] = useState({ unassigned: [], dispatched: [], technicians: [], suggestions: [] });
  const [calendar, setCalendar] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [workload, setWorkload] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [booking, setBooking] = useState(newBooking);
  const [assignment, setAssignment] = useState({ ticket: null, technicianId: "" });
  const [assignmentBusy, setAssignmentBusy] = useState(false);

  const loadDispatch = useCallback(async () => {
    setLoading(true);
    try {
      const [boardResponse, calendarResponse, availabilityResponse, workloadResponse] = await Promise.all([
        axios.get(`${API}/dispatch/board`, { headers }), axios.get(`${API}/scheduling/calendar`, { headers }),
        axios.get(`${API}/scheduling/technician-availability`, { headers }), axios.get(`${API}/scheduling/technician-workload`, { headers }),
      ]);
      const boardData = boardResponse.data || {};
      const jobs = Array.isArray(boardData.jobs) ? boardData.jobs : [];
      setBoard({
        ...boardData,
        unassigned: Array.isArray(boardData.unassigned) ? boardData.unassigned : jobs.filter((ticket) => !ticket.assigned_to),
        dispatched: Array.isArray(boardData.dispatched) ? boardData.dispatched : jobs.filter((ticket) => ticket.assigned_to),
        technicians: Array.isArray(boardData.technicians) ? boardData.technicians : [],
        suggestions: Array.isArray(boardData.suggestions) ? boardData.suggestions : [],
      });
      setCalendar(Array.isArray(calendarResponse.data) ? calendarResponse.data : calendarResponse.data?.events || []);
      setAvailability(Array.isArray(availabilityResponse.data) ? availabilityResponse.data : availabilityResponse.data?.technicians || []);
      setWorkload(Array.isArray(workloadResponse.data) ? workloadResponse.data : []);
    } catch (error) {
      setBoard({ unassigned: [], dispatched: [], technicians: [], suggestions: [] });
      setCalendar([]); setAvailability([]); setWorkload([]);
      toast.error(error.response?.data?.detail || "Could not load the dispatch workspace");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { loadDispatch(); }, [loadDispatch]);
  useEffect(() => { if (DISPATCH_TABS.includes(requestedTab)) setTab(requestedTab); }, [requestedTab]);
  useEffect(() => { if (requestedClientId) setBooking((current) => ({ ...current, client_id: requestedClientId })); }, [requestedClientId]);

  const selectTab = (nextTab) => {
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === "board") url.searchParams.delete("tab"); else url.searchParams.set("tab", nextTab);
    window.history.replaceState({}, "", url);
  };
  const unassigned = board.unassigned || [];
  const dispatched = board.dispatched || [];
  const technicians = board.technicians?.length ? board.technicians : availability;
  const events = calendar || [];
  const bookingTicket = [...unassigned, ...dispatched].find((ticket) => ticket.id === booking.ticket_id);
  const openTicket = (ticket) => { if (ticket?.id) navigate(`/tickets?ticket=${encodeURIComponent(ticket.id)}`); };
  const openAssignment = (ticket) => setAssignment({ ticket, technicianId: ticket.assigned_to || board.suggestions.find((item) => item.job_id === ticket.id)?.suggested_tech_id || "" });

  const submitAssignment = async () => {
    if (!assignment.ticket?.id || !assignment.technicianId) return;
    setAssignmentBusy(true);
    try {
      const response = await axios.post(`${API}/dispatch/assign`, { ticket_id: assignment.ticket.id, tech_id: assignment.technicianId }, { headers });
      toast.success(response.data?.message || "Ticket assignment updated");
      setAssignment({ ticket: null, technicianId: "" });
      await loadDispatch();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not update the ticket assignment");
    } finally { setAssignmentBusy(false); }
  };

  const submitBooking = async (approve = false) => {
    if (!booking.user_id || !booking.title.trim()) { toast.error("Choose a technician and add an appointment title"); return; }
    setBookingBusy(true);
    try {
      const response = await axios.post(`${API}/schedule`, {
        ...booking, client_id: bookingTicket?.client_id || booking.client_id, approve_conflict: approve,
        override_reason: booking.approval_note, sync_to_calendar: true, event_type: "appointment",
      }, { headers });
      toast.success(response.data?.conflict_approved ? "Appointment booked with recorded approval" : "Appointment booked and linked to the calendar");
      setBookingOpen(false); setConflict(null); setBooking(newBooking());
      await loadDispatch();
    } catch (error) {
      if (error.response?.status === 409) {
        setConflict(error.response.data?.detail?.conflicts || {});
        toast.warning("Coordinator approval is required before booking this conflict");
      } else toast.error(error.response?.data?.detail || "Could not create appointment");
    } finally { setBookingBusy(false); }
  };

  if (loading) return <div className="space-y-5"><TicketModuleHeader title="Dispatch & scheduling" subtitle="Loading live assignments and technician availability..." /><div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin" /></div></div>;

  return <div className="space-y-5" data-testid="dispatch-center">
    <TicketModuleHeader title="Dispatch & scheduling" subtitle="Assign work, protect calendar commitments, and balance technician capacity." />
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <HeroTile label="Unassigned" value={unassigned.length} icon={Clock} glow="amber" subtitle="Needs a technician owner" testId="dispatch-metric-unassigned" />
      <HeroTile label="Dispatched" value={dispatched.length} icon={Truck} glow="sky" subtitle="In technician ownership" testId="dispatch-metric-dispatched" />
      <HeroTile label="Scheduled" value={events.length} icon={CalendarDays} glow="violet" subtitle="Calendar commitments" testId="dispatch-metric-scheduled" />
      <HeroTile label="Available" value={`${technicians.filter((tech) => tech.available || tech.status === "available").length}/${technicians.length}`} icon={Users} glow="emerald" subtitle="Ready for new work" animated={false} testId="dispatch-metric-available" />
    </div>
    <Tabs value={tab} onValueChange={selectTab}>
      <TabsList className="h-auto flex-wrap gap-1"><TabsTrigger value="board"><Zap className="mr-1 h-3 w-3" />Dispatch board</TabsTrigger><TabsTrigger value="calendar"><CalendarDays className="mr-1 h-3 w-3" />Calendar</TabsTrigger><TabsTrigger value="availability"><Users className="mr-1 h-3 w-3" />Availability</TabsTrigger></TabsList>
      <TabsContent value="board" className="space-y-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="overflow-hidden border-amber-500/25"><CardHeader className="border-b border-amber-500/15 bg-amber-500/[0.045] pb-3"><div className="flex items-center justify-between"><div><CardTitle className="flex items-center gap-2 text-sm text-amber-300"><Clock className="h-4 w-4" />Needs an owner</CardTitle><p className="mt-1 text-[11px] text-muted-foreground">Assign every open item from the real service queue.</p></div><Badge className="border-amber-500/25 bg-amber-500/15 text-amber-300">{unassigned.length}</Badge></div></CardHeader><CardContent className="space-y-2 p-3">{unassigned.length ? unassigned.map((ticket) => <DispatchTicketCard key={ticket.id} ticket={ticket} tone="amber" onOpen={openTicket} onAssign={openAssignment} />) : <p className="py-7 text-center text-sm text-muted-foreground">Nothing is waiting for a technician.</p>}</CardContent></Card>
          <Card className="overflow-hidden border-blue-500/20"><CardHeader className="border-b border-blue-500/15 bg-blue-500/[0.04] pb-3"><div className="flex items-center justify-between"><div><CardTitle className="flex items-center gap-2 text-sm"><Truck className="h-4 w-4 text-blue-300" />In technician ownership</CardTitle><p className="mt-1 text-[11px] text-muted-foreground">Open work already owned by a service team member.</p></div><Badge variant="outline" className="border-blue-500/25 text-blue-200">{dispatched.length}</Badge></div></CardHeader><CardContent className="space-y-2 p-3">{dispatched.length ? dispatched.map((ticket) => <DispatchTicketCard key={ticket.id} ticket={ticket} tone="blue" assigned onOpen={openTicket} onAssign={openAssignment} />) : <p className="py-7 text-center text-sm text-muted-foreground">No work is currently assigned.</p>}</CardContent></Card>
        </div>
      </TabsContent>
      <TabsContent value="calendar" className="space-y-3">
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.035] p-4 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold">Calendar-aware booking</p><p className="mt-1 text-xs text-muted-foreground">Double bookings and same-location opportunities need a recorded approval reason and are written to the linked ticket audit trail.</p></div><Button size="sm" onClick={() => { setConflict(null); setBookingOpen(true); }} data-testid="create-dispatch-appointment"><Plus className="mr-1.5 h-4 w-4" />Book appointment</Button></div>
        {requestedClientId && <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.035] px-4 py-3 text-xs text-cyan-100">Booking context is set to the selected client. Link a ticket in the appointment form to inherit its full client and audit context.</div>}
        {events.length ? <Card className="overflow-hidden"><CardHeader className="border-b bg-violet-500/[0.035] pb-3"><CardTitle className="flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4 text-violet-300" />Scheduled commitments</CardTitle></CardHeader><CardContent className="space-y-2 p-3">{events.slice(0, 30).map((event) => {
          const calendarState = event.calendar_sync_state;
          const calendarTone = calendarState === "synced" ? "border-emerald-500/30 text-emerald-300" : ["failed", "authentication_failed"].includes(calendarState) ? "border-rose-500/30 text-rose-300" : "border-amber-500/30 text-amber-300";
          return <div key={event.id} className="flex items-center gap-3 rounded-xl border border-border/70 p-3"><div className="w-12 shrink-0 rounded-lg bg-violet-500/10 py-1.5 text-center"><p className="text-[9px] uppercase text-violet-300">{(event.date || "").slice(5, 7) || "--"}</p><p className="font-mono text-sm font-semibold">{(event.date || "").slice(8, 10) || "--"}</p></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{event.title || "Scheduled work"}</p><p className="mt-0.5 text-xs text-muted-foreground">{event.client_name || "Client pending"} <span className="mx-1.5 text-muted-foreground/35">-</span> {event.technician_name || event.technician || "Technician pending"}</p></div>{calendarState && <Badge variant="outline" className={`hidden shrink-0 text-[10px] sm:inline-flex ${calendarTone}`}>M365 {calendarState.replaceAll("_", " ")}</Badge>}<Badge variant="outline" className="shrink-0 font-mono text-[10px]">{event.time || event.start_time || "TBC"}</Badge></div>;
        })}</CardContent></Card> : <div className="rounded-xl border border-dashed border-border/70 p-8 text-center"><CalendarDays className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No scheduled commitments</p><p className="mt-1 text-xs text-muted-foreground">Create an audited appointment to start the field calendar.</p></div>}
      </TabsContent>
      <TabsContent value="availability" className="space-y-3">
        {workload.length > 0 && <Card className="overflow-hidden"><CardHeader className="border-b bg-muted/[0.18] pb-3"><CardTitle className="text-sm">Today&apos;s bookings at a glance</CardTitle></CardHeader><CardContent className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">{workload.map((tech) => <div key={tech.id} className="rounded-lg border border-border/70 p-3"><p className="text-sm font-semibold">{tech.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{tech.bookings?.length || 0} scheduled commitment{tech.bookings?.length === 1 ? "" : "s"}</p>{tech.bookings?.slice(0, 3).map((item) => <div key={item.id} className="mt-2 rounded-md bg-muted/50 px-2 py-1 text-[10px]"><span className="font-mono text-emerald-300">{item.start_time}-{item.end_time}</span><span className="ml-1">{item.title}</span></div>)}</div>)}</CardContent></Card>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{technicians.map((tech) => { const available = tech.available || tech.status === "available"; const load = tech.current_tickets || tech.total_open || tech.open_tickets || 0; return <Card key={tech.id} className={available ? "border-emerald-500/20" : "border-border/70"}><CardContent className="py-4"><div className="flex items-center gap-3"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${available ? "bg-emerald-500/15" : "bg-amber-500/15"}`}><Users className={`h-5 w-5 ${available ? "text-emerald-400" : "text-amber-400"}`} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{tech.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{load} open ticket{load === 1 ? "" : "s"} - {tech.scheduled_today || 0} booked today</p></div><Badge variant="outline" className={`text-[10px] ${available ? "border-emerald-500/25 text-emerald-300" : "border-amber-500/25 text-amber-300"}`}>{available ? "Available" : tech.status || "Busy"}</Badge></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted/60"><div className={`h-full rounded-full ${available ? "bg-emerald-400" : "bg-amber-400"}`} style={{ width: `${Math.min(100, Math.max(12, (load + (tech.scheduled_today || 0)) * 20))}%` }} /></div></CardContent></Card>; })}</div>
        {!technicians.length && <p className="py-8 text-center text-muted-foreground">No technicians are available to dispatch.</p>}
      </TabsContent>
    </Tabs>
    <Dialog open={bookingOpen} onOpenChange={(open) => { setBookingOpen(open); if (!open) setConflict(null); }}><DialogContent className="max-w-xl" data-testid="dispatch-appointment-dialog"><DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-emerald-300" />Book client appointment</DialogTitle><DialogDescription>Conflict checks, the linked ticket note, and audit history are all created when this appointment is saved.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Technician</Label><Select value={booking.user_id} onValueChange={(user_id) => setBooking((current) => ({ ...current, user_id }))}><SelectTrigger><SelectValue placeholder="Choose technician" /></SelectTrigger><SelectContent>{technicians.map((tech) => <SelectItem key={tech.id} value={tech.id}>{tech.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Linked ticket</Label><Select value={booking.ticket_id || "none"} onValueChange={(ticket_id) => setBooking((current) => ({ ...current, ticket_id: ticket_id === "none" ? "" : ticket_id, title: !current.title && ticket_id !== "none" ? ([...unassigned, ...dispatched].find((ticket) => ticket.id === ticket_id)?.title || "") : current.title }))}><SelectTrigger><SelectValue placeholder="No ticket link" /></SelectTrigger><SelectContent><SelectItem value="none">No ticket link</SelectItem>{[...unassigned, ...dispatched].map((ticket) => <SelectItem key={ticket.id} value={ticket.id}>{ticket.ticket_number || "Ticket"} - {ticket.title}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Date</Label><Input type="date" value={booking.date} onChange={(event) => setBooking((current) => ({ ...current, date: event.target.value }))} /></div><div className="grid grid-cols-2 gap-2"><div className="space-y-2"><Label>Start</Label><Input type="time" value={booking.start_time} onChange={(event) => setBooking((current) => ({ ...current, start_time: event.target.value }))} /></div><div className="space-y-2"><Label>Finish</Label><Input type="time" value={booking.end_time} onChange={(event) => setBooking((current) => ({ ...current, end_time: event.target.value }))} /></div></div><div className="space-y-2 sm:col-span-2"><Label>Appointment title</Label><Input value={booking.title} onChange={(event) => setBooking((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Onsite network review" /></div><div className="space-y-2 sm:col-span-2"><Label>Client site / location</Label><Input value={booking.location} onChange={(event) => setBooking((current) => ({ ...current, location: event.target.value }))} placeholder="Used to surface same-location opportunities" /></div><div className="space-y-2 sm:col-span-2"><Label>Internal booking note</Label><Textarea value={booking.description} onChange={(event) => setBooking((current) => ({ ...current, description: event.target.value }))} rows={2} placeholder="Context for dispatch and the linked ticket" /></div></div>{conflict && <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.07] p-3"><div className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><div><p className="text-sm font-semibold text-amber-200">Approval required</p><p className="mt-1 text-xs text-muted-foreground">{(conflict.overlaps?.length || 0) > 0 ? `${conflict.overlaps.length} overlapping booking(s)` : "A technician is already booked at this location"}. Record why this remains the best assignment before continuing.</p></div></div><Textarea className="mt-3" value={booking.approval_note} onChange={(event) => setBooking((current) => ({ ...current, approval_note: event.target.value }))} rows={2} placeholder="Approval reason - written to the ticket and audit history" data-testid="booking-approval-note" /></div>}<DialogFooter><Button variant="outline" onClick={() => setBookingOpen(false)}>Cancel</Button>{conflict ? <Button disabled={bookingBusy || !booking.approval_note.trim()} onClick={() => submitBooking(true)}>{bookingBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approve and book</Button> : <Button disabled={bookingBusy} onClick={() => submitBooking(false)}>{bookingBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Check and book</Button>}</DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(assignment.ticket)} onOpenChange={(open) => !open && setAssignment({ ticket: null, technicianId: "" })}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><UserRoundCheck className="h-5 w-5 text-cyan-300" />{assignment.ticket?.assigned_to ? "Reassign ticket" : "Assign ticket"}</DialogTitle><DialogDescription>{assignment.ticket?.ticket_number || assignment.ticket?.title} will be updated immediately, with the prior owner and new owner recorded in the ticket audit history.</DialogDescription></DialogHeader><div className="space-y-2"><Label>Technician</Label><Select value={assignment.technicianId} onValueChange={(technicianId) => setAssignment((current) => ({ ...current, technicianId }))}><SelectTrigger><SelectValue placeholder="Choose technician" /></SelectTrigger><SelectContent>{technicians.map((tech) => <SelectItem key={tech.id} value={tech.id}>{tech.name}{tech.capacity != null ? ` - ${tech.capacity} capacity` : ""}</SelectItem>)}</SelectContent></Select>{board.suggestions.find((item) => item.job_id === assignment.ticket?.id)?.reason && <p className="text-xs text-muted-foreground">Suggested assignment: {board.suggestions.find((item) => item.job_id === assignment.ticket?.id)?.reason}</p>}</div><DialogFooter><Button variant="outline" onClick={() => setAssignment({ ticket: null, technicianId: "" })}>Cancel</Button><Button disabled={assignmentBusy || !assignment.technicianId} onClick={submitAssignment}>{assignmentBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save assignment</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
