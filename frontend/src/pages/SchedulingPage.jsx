import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Plus, Loader2, Calendar, Clock,
  Trash2, GripVertical, User, Ticket
} from "lucide-react";
import { format, addDays, startOfWeek, addWeeks, subWeeks, isSameDay, parseISO, differenceInMinutes, setHours, setMinutes } from "date-fns";

const HOURS = Array.from({ length: 14 }, (_, i) => i + 6); // 6am to 8pm
const SLOT_HEIGHT = 60; // px per hour
const COLORS = ["#3B82F6", "#22C55E", "#8B5CF6", "#EF4444", "#F97316", "#06B6D4", "#EC4899"];

export default function SchedulingPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [entries, setEntries] = useState([]);
  const [techs, setTechs] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [view, setView] = useState("week"); // week or day
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [formData, setFormData] = useState({
    ticket_id: "", technician_id: "", start: "", end: "", notes: ""
  });

  const headers = { Authorization: `Bearer ${token}` };
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const fetchData = async () => {
    setLoading(true);
    try {
      const [eRes, tRes, tkRes] = await Promise.all([
        axios.get(`${API}/schedule`, { headers }),
        axios.get(`${API}/technicians/overview`, { headers }),
        axios.get(`${API}/tickets?status=open`, { headers }),
      ]);
      setEntries(eRes.data);
      setTechs(tRes.data);
      setTickets(tkRes.data);
    } catch { toast.error("Failed to fetch schedule"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    const ticket = tickets.find(t => t.id === formData.ticket_id);
    const tech = techs.find(t => t.id === formData.technician_id);
    try {
      await axios.post(`${API}/schedule`, {
        ...formData,
        ticket_number: ticket?.ticket_number || "",
        ticket_title: ticket?.title || formData.notes || "Scheduled block",
        technician_name: tech?.name || "",
        color: COLORS[techs.indexOf(tech) % COLORS.length] || COLORS[0],
      }, { headers });
      setIsCreateOpen(false);
      resetForm();
      fetchData();
      toast.success("Scheduled");
    } catch { toast.error("Failed to create"); }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/schedule/${id}`, { headers });
      fetchData();
      toast.success("Removed");
    } catch { toast.error("Failed"); }
  };

  const resetForm = () => setFormData({ ticket_id: "", technician_id: "", start: "", end: "", notes: "" });

  const openSlot = (day, hour, techId) => {
    const start = setMinutes(setHours(day, hour), 0);
    const end = setMinutes(setHours(day, hour + 1), 0);
    setFormData({
      ticket_id: "", technician_id: techId || "",
      start: format(start, "yyyy-MM-dd'T'HH:mm"),
      end: format(end, "yyyy-MM-dd'T'HH:mm"),
      notes: ""
    });
    setIsCreateOpen(true);
  };

  const getEntriesForDayTech = (day, techId) => {
    return entries.filter(e => {
      try {
        const eStart = parseISO(e.start);
        return isSameDay(eStart, day) && e.technician_id === techId;
      } catch { return false; }
    });
  };

  const getEntryPosition = (entry) => {
    try {
      const start = parseISO(entry.start);
      const end = parseISO(entry.end);
      const startH = start.getHours() + start.getMinutes() / 60;
      const dur = differenceInMinutes(end, start) / 60;
      return { top: (startH - 6) * SLOT_HEIGHT, height: Math.max(dur * SLOT_HEIGHT, 20) };
    } catch { return { top: 0, height: SLOT_HEIGHT }; }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-4" data-testid="scheduling-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Scheduling</h1><p className="text-muted-foreground">Drag tickets onto the calendar to schedule work</p></div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekStart(subWeeks(weekStart, 1))}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-sm font-medium min-w-[200px] text-center">{format(weekStart, "MMM d")} - {format(addDays(weekStart, 6), "MMM d, yyyy")}</span>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addWeeks(weekStart, 1))}><ChevronRight className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Today</Button>
          <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} data-testid="schedule-btn"><Plus className="w-4 h-4 mr-1" />Schedule</Button>
        </div>
      </div>

      {/* Unscheduled Tickets */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Ticket className="w-4 h-4" />Unscheduled Open Tickets</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {tickets.filter(t => !entries.some(e => e.ticket_id === t.id)).slice(0, 12).map(t => (
              <div key={t.id} className="flex-shrink-0 px-3 py-2 rounded-lg border bg-muted/30 cursor-pointer hover:border-primary/50 transition-colors min-w-[180px]"
                onClick={() => { setFormData({ ticket_id: t.id, technician_id: "", start: format(new Date(), "yyyy-MM-dd'T'09:00"), end: format(new Date(), "yyyy-MM-dd'T'10:00"), notes: "" }); setIsCreateOpen(true); }}>
                <p className="text-xs font-mono text-muted-foreground">{t.ticket_number}</p>
                <p className="text-sm font-medium truncate max-w-[160px]">{t.title}</p>
                <p className="text-xs text-muted-foreground">{t.client_name}</p>
              </div>
            ))}
            {tickets.filter(t => !entries.some(e => e.ticket_id === t.id)).length === 0 && (
              <p className="text-sm text-muted-foreground py-2">All open tickets are scheduled</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Weekly Calendar Grid */}
      <Card>
        <CardContent className="p-0">
          <div className="flex">
            {/* Time gutter */}
            <div className="flex-shrink-0 w-16 border-r">
              <div className="h-10 border-b" />
              {HOURS.map(h => (
                <div key={h} className="flex items-start justify-end pr-2 text-xs text-muted-foreground" style={{ height: SLOT_HEIGHT }}>
                  {h > 12 ? `${h - 12}pm` : h === 12 ? '12pm' : `${h}am`}
                </div>
              ))}
            </div>

            {/* Day Columns */}
            <div className="flex-1 flex overflow-x-auto">
              {days.map((day, di) => {
                const isToday = isSameDay(day, new Date());
                return (
                  <div key={di} className={`flex-1 min-w-[140px] border-r last:border-r-0 ${isToday ? 'bg-primary/5' : ''}`}>
                    {/* Day Header */}
                    <div className={`h-10 border-b flex flex-col items-center justify-center ${isToday ? 'bg-primary/10' : ''}`}>
                      <p className="text-xs text-muted-foreground">{format(day, "EEE")}</p>
                      <p className={`text-sm font-bold ${isToday ? 'text-primary' : ''}`}>{format(day, "d")}</p>
                    </div>
                    {/* Hour slots */}
                    <div className="relative" style={{ height: HOURS.length * SLOT_HEIGHT }}>
                      {HOURS.map(h => (
                        <div key={h} className="border-b border-dashed border-border/30 cursor-pointer hover:bg-muted/30 transition-colors"
                          style={{ height: SLOT_HEIGHT }}
                          onClick={() => openSlot(day, h)}
                          data-testid={`slot-${format(day, 'yyyy-MM-dd')}-${h}`} />
                      ))}
                      {/* Entries for all techs on this day */}
                      {techs.map(tech => {
                        const dayEntries = getEntriesForDayTech(day, tech.id);
                        return dayEntries.map(entry => {
                          const pos = getEntryPosition(entry);
                          return (
                            <div key={entry.id} className="absolute left-1 right-1 rounded-md px-2 py-1 text-xs cursor-pointer hover:opacity-80 transition-opacity overflow-hidden group"
                              style={{ top: pos.top, height: pos.height, backgroundColor: entry.color || "#3B82F6", zIndex: 10 }}
                              data-testid={`entry-${entry.id}`}>
                              <p className="font-medium text-white truncate">{entry.ticket_number || entry.ticket_title}</p>
                              <p className="text-white/70 truncate">{entry.technician_name}</p>
                              <button className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 rounded p-0.5"
                                onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}>
                                <Trash2 className="w-3 h-3 text-white" />
                              </button>
                            </div>
                          );
                        });
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Schedule Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule Work</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Ticket</Label>
              <Select value={formData.ticket_id} onValueChange={v => setFormData({ ...formData, ticket_id: v })}>
                <SelectTrigger data-testid="schedule-ticket"><SelectValue placeholder="Select ticket (optional)" /></SelectTrigger>
                <SelectContent>
                  {tickets.map(t => <SelectItem key={t.id} value={t.id}>{t.ticket_number} - {t.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Technician</Label>
              <Select value={formData.technician_id} onValueChange={v => setFormData({ ...formData, technician_id: v })}>
                <SelectTrigger data-testid="schedule-tech"><SelectValue placeholder="Assign to" /></SelectTrigger>
                <SelectContent>
                  {techs.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start</Label><Input type="datetime-local" value={formData.start} onChange={e => setFormData({ ...formData, start: e.target.value })} data-testid="schedule-start" /></div>
              <div><Label>End</Label><Input type="datetime-local" value={formData.end} onChange={e => setFormData({ ...formData, end: e.target.value })} data-testid="schedule-end" /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Optional notes" rows={2} /></div>
          </div>
          <DialogFooter><Button onClick={handleCreate} data-testid="schedule-submit"><Calendar className="w-4 h-4 mr-1" />Schedule</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
