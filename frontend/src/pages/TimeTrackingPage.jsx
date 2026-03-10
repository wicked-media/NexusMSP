import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus, Clock, Loader2, DollarSign, Timer, Play, Pause, Square,
  BarChart3, Calendar, User, Trash2, Edit, Search
} from "lucide-react";
import { format } from "date-fns";

export default function TimeTrackingPage() {
  const { token, user } = useAuth();
  const [timeEntries, setTimeEntries] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [users, setUsers] = useState([]);
  const [weeklySummary, setWeeklySummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterUser, setFilterUser] = useState("all");
  const [filterBillable, setFilterBillable] = useState("all");
  // Timer state
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState(null);
  const [timerTicket, setTimerTicket] = useState(null);
  const [timerDescription, setTimerDescription] = useState("");
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef(null);

  const [formData, setFormData] = useState({
    ticket_id: "", user_id: "", description: "", minutes: "",
    billable: true, date: new Date().toISOString().split("T")[0]
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [entriesRes, ticketsRes, usersRes, weeklyRes] = await Promise.all([
        axios.get(`${API}/time-entries`, { headers }),
        axios.get(`${API}/tickets`, { headers }),
        axios.get(`${API}/users`, { headers }),
        axios.get(`${API}/time-entries/weekly-summary`, { headers }),
      ]);
      setTimeEntries(entriesRes.data);
      setTickets(ticketsRes.data);
      setUsers(usersRes.data);
      setWeeklySummary(weeklyRes.data);
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  // Timer
  useEffect(() => {
    if (isTimerRunning) {
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - timerStart) / 1000));
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [isTimerRunning, timerStart]);

  const startTimer = () => {
    if (!timerTicket) { toast.error("Select a ticket first"); return; }
    setTimerStart(Date.now());
    setIsTimerRunning(true);
    setElapsedTime(0);
  };

  const stopTimer = async () => {
    setIsTimerRunning(false);
    clearInterval(timerRef.current);
    const minutes = Math.max(1, Math.round(elapsedTime / 60));
    try {
      await axios.post(`${API}/time-entries`, {
        ticket_id: timerTicket, user_id: user?.id || "",
        description: timerDescription || "Timer entry", minutes, billable: true,
        date: new Date().toISOString().split("T")[0]
      }, { headers });
      toast.success(`Logged ${minutes} minutes`);
      setTimerTicket(null); setTimerDescription(""); setElapsedTime(0);
      fetchData();
    } catch { toast.error("Failed to save"); }
  };

  const formatTimer = (secs) => {
    const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60); const s = secs % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const handleCreate = async () => {
    if (!formData.ticket_id || !formData.minutes) { toast.error("Ticket and minutes required"); return; }
    try {
      await axios.post(`${API}/time-entries`, { ...formData, minutes: parseInt(formData.minutes), user_id: formData.user_id || user?.id || "" }, { headers });
      toast.success("Time entry added");
      setIsDialogOpen(false);
      setFormData({ ticket_id: "", user_id: "", description: "", minutes: "", billable: true, date: new Date().toISOString().split("T")[0] });
      fetchData();
    } catch { toast.error("Failed to save"); }
  };

  const handleDelete = async (id) => {
    try { await axios.delete(`${API}/time-entries/${id}`, { headers }); toast.success("Deleted"); fetchData(); }
    catch { toast.error("Failed"); }
  };

  const filtered = timeEntries
    .filter(e => filterUser === "all" || e.user_id === filterUser)
    .filter(e => filterBillable === "all" || (filterBillable === "billable" ? e.billable : !e.billable))
    .filter(e => !search || e.description?.toLowerCase().includes(search.toLowerCase()) || e.ticket_id?.toLowerCase().includes(search.toLowerCase()));

  const totalMins = timeEntries.reduce((s, e) => s + (e.minutes || 0), 0);
  const billableMins = timeEntries.filter(e => e.billable).reduce((s, e) => s + (e.minutes || 0), 0);
  const totalAmount = timeEntries.reduce((s, e) => s + (e.total_amount || 0), 0);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="time-tracking-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Time Tracking</h1><p className="text-muted-foreground">{timeEntries.length} entries logged</p></div>
        <Button onClick={() => setIsDialogOpen(true)} data-testid="add-time-entry-btn"><Plus className="w-4 h-4 mr-1" />Log Time</Button>
      </div>

      {/* Live Timer */}
      <Card className={isTimerRunning ? "border-green-500/50 bg-green-500/5" : ""}>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Timer className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 grid grid-cols-3 gap-3">
              <Select value={timerTicket || ""} onValueChange={setTimerTicket}>
                <SelectTrigger data-testid="timer-ticket"><SelectValue placeholder="Select ticket..." /></SelectTrigger>
                <SelectContent>{tickets.slice(0, 30).map(t => <SelectItem key={t.id} value={t.id}>{t.ticket_number} - {t.title?.slice(0, 30)}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="What are you working on?" value={timerDescription} onChange={e => setTimerDescription(e.target.value)} data-testid="timer-description" />
              <div className="flex items-center gap-2">
                <span className={`font-mono text-2xl font-bold tabular-nums ${isTimerRunning ? "text-green-500" : ""}`} data-testid="timer-display">{formatTimer(elapsedTime)}</span>
                {!isTimerRunning ? (
                  <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={startTimer} data-testid="start-timer"><Play className="w-4 h-4" /></Button>
                ) : (
                  <Button size="sm" variant="destructive" onClick={stopTimer} data-testid="stop-timer"><Square className="w-4 h-4" /></Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats + Weekly */}
      <Tabs defaultValue="entries">
        <TabsList><TabsTrigger value="entries">Entries</TabsTrigger><TabsTrigger value="weekly">Weekly Summary</TabsTrigger></TabsList>

        <TabsContent value="entries" className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Clock className="w-5 h-5 text-blue-500" /></div><div><p className="text-xs text-muted-foreground">Total Hours</p><p className="text-xl font-bold">{(totalMins / 60).toFixed(1)}h</p></div></div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-green-500" /></div><div><p className="text-xs text-muted-foreground">Billable</p><p className="text-xl font-bold text-green-500">{(billableMins / 60).toFixed(1)}h</p></div></div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center"><BarChart3 className="w-5 h-5 text-yellow-500" /></div><div><p className="text-xs text-muted-foreground">Non-Billable</p><p className="text-xl font-bold">{((totalMins - billableMins) / 60).toFixed(1)}h</p></div></div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-cyan-500" /></div><div><p className="text-xs text-muted-foreground">Revenue</p><p className="text-xl font-bold">${totalAmount.toFixed(0)}</p></div></div></CardContent></Card>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search entries..." value={search} onChange={e => setSearch(e.target.value)} data-testid="time-search" /></div>
            <Select value={filterUser} onValueChange={setFilterUser}><SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Users</SelectItem>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent></Select>
            <Select value={filterBillable} onValueChange={setFilterBillable}><SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="billable">Billable</SelectItem><SelectItem value="non-billable">Non-Billable</SelectItem></SelectContent></Select>
          </div>

          {/* Table */}
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Ticket</TableHead><TableHead>User</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Duration</TableHead><TableHead>Billable</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No time entries found. Use the timer or log time manually.</TableCell></TableRow>
                ) : filtered.map(e => (
                  <TableRow key={e.id} data-testid={`time-entry-${e.id}`}>
                    <TableCell className="font-mono text-sm">{e.date || "-"}</TableCell>
                    <TableCell className="text-sm">{e.ticket_id?.slice(0, 8)}...</TableCell>
                    <TableCell className="text-sm">{e.user_name || users.find(u => u.id === e.user_id)?.name || "-"}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">{e.description}</TableCell>
                    <TableCell className="text-right font-mono">{e.minutes >= 60 ? `${Math.floor(e.minutes/60)}h ${e.minutes%60}m` : `${e.minutes}m`}</TableCell>
                    <TableCell>{e.billable ? <Badge className="bg-green-500/20 text-green-400 text-[10px]">Billable</Badge> : <Badge variant="secondary" className="text-[10px]">Non-Billable</Badge>}</TableCell>
                    <TableCell className="text-right font-mono">${(e.total_amount || 0).toFixed(2)}</TableCell>
                    <TableCell><Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(e.id)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="weekly" className="space-y-4">
          {weeklySummary && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground mb-1">This Week Total</p><p className="text-3xl font-bold">{weeklySummary.total_hours}h</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground mb-1">Billable</p><p className="text-3xl font-bold text-green-500">{weeklySummary.billable_hours}h</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground mb-1">Non-Billable</p><p className="text-3xl font-bold text-yellow-500">{weeklySummary.non_billable_hours}h</p></CardContent></Card>
              </div>
              {weeklySummary.by_user?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><User className="w-4 h-4" />By Technician</CardTitle></CardHeader>
                  <CardContent>
                    <Table><TableHeader><TableRow><TableHead>Technician</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Billable</TableHead><TableHead className="text-right">Entries</TableHead></TableRow></TableHeader>
                      <TableBody>{weeklySummary.by_user.map((u, i) => (
                        <TableRow key={i}><TableCell className="font-medium">{u.user_name || u.user_id.slice(0,8)}</TableCell><TableCell className="text-right font-mono">{(u.total_minutes/60).toFixed(1)}h</TableCell><TableCell className="text-right font-mono text-green-500">{(u.billable_minutes/60).toFixed(1)}h</TableCell><TableCell className="text-right">{u.entries}</TableCell></TableRow>
                      ))}</TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
              {weeklySummary.by_day?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="w-4 h-4" />By Day</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-7 gap-2">
                      {weeklySummary.by_day.map((d, i) => (
                        <div key={i} className="p-3 rounded-lg border bg-muted/30 text-center">
                          <p className="text-xs text-muted-foreground mb-1">{d.date}</p>
                          <p className="text-lg font-bold">{(d.total_minutes/60).toFixed(1)}h</p>
                          <p className="text-xs text-green-500">{(d.billable_minutes/60).toFixed(1)}h billable</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Create Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Log Time Entry</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Ticket *</Label><Select value={formData.ticket_id} onValueChange={v => setFormData({ ...formData, ticket_id: v })}><SelectTrigger data-testid="entry-ticket"><SelectValue placeholder="Select ticket" /></SelectTrigger><SelectContent>{tickets.slice(0, 50).map(t => <SelectItem key={t.id} value={t.id}>{t.ticket_number} - {t.title?.slice(0, 30)}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Technician</Label><Select value={formData.user_id || user?.id || ""} onValueChange={v => setFormData({ ...formData, user_id: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Minutes *</Label><Input type="number" value={formData.minutes} onChange={e => setFormData({ ...formData, minutes: e.target.value })} data-testid="entry-minutes" /></div>
              <div><Label>Date</Label><Input type="date" value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} /></div>
            </div>
            <div><Label>Description</Label><Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="What did you work on?" rows={2} /></div>
            <div className="flex items-center gap-2"><Switch checked={formData.billable} onCheckedChange={v => setFormData({ ...formData, billable: v })} /><Label>Billable</Label></div>
          </div>
          <DialogFooter><Button onClick={handleCreate} data-testid="save-time-entry-btn">Save Entry</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
