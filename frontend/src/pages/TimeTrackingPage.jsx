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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Plus, Clock, Loader2, DollarSign, Timer, Play, Pause, Square,
  BarChart3, Calendar, User, Trash2, Edit, Search, Download, CheckCircle,
  XCircle, Users, TrendingUp, FileText
} from "lucide-react";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, parseISO } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const COLORS = ["#3B82F6", "#22C55E", "#EAB308", "#EF4444", "#8B5CF6", "#EC4899"];
const chartTooltipStyle = { backgroundColor: "hsl(217, 33%, 17%)", border: "1px solid hsl(217, 33%, 25%)", borderRadius: "8px", color: "hsl(210, 40%, 98%)" };

function exportCSV(data, filename) {
  if (!data?.length) { toast.error("No data"); return; }
  const headers = Object.keys(data[0]);
  const csv = [headers.join(","), ...data.map(r => headers.map(h => { const v = r[h]; return typeof v === "string" && v.includes(",") ? `"${v}"` : v ?? ""; }).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${filename}.csv`; a.click();
  toast.success(`Exported ${data.length} rows`);
}

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
  const [activeTab, setActiveTab] = useState("entries");
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
    } catch { toast.error("Failed to fetch time entries"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  // Timer logic
  useEffect(() => {
    if (isTimerRunning) {
      timerRef.current = setInterval(() => setElapsedTime(Math.floor((Date.now() - timerStart) / 1000)), 1000);
    } else { clearInterval(timerRef.current); }
    return () => clearInterval(timerRef.current);
  }, [isTimerRunning, timerStart]);

  const startTimer = () => { setTimerStart(Date.now()); setElapsedTime(0); setIsTimerRunning(true); };
  const stopTimer = async () => {
    setIsTimerRunning(false);
    const minutes = Math.max(1, Math.round(elapsedTime / 60));
    try {
      await axios.post(`${API}/time-entries`, { ticket_id: timerTicket || "", user_id: user?.id || "", description: timerDescription || "Timer session", minutes, billable: true, date: new Date().toISOString().split("T")[0] }, { headers });
      toast.success(`Logged ${minutes} minutes`);
      setTimerDescription(""); setTimerTicket(null); setElapsedTime(0);
      fetchData();
    } catch { toast.error("Failed to log timer"); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/time-entries`, { ...formData, user_id: formData.user_id || user?.id || "", minutes: parseInt(formData.minutes) || 0 }, { headers });
      toast.success("Time entry added");
      setIsDialogOpen(false);
      setFormData({ ticket_id: "", user_id: "", description: "", minutes: "", billable: true, date: new Date().toISOString().split("T")[0] });
      fetchData();
    } catch { toast.error("Failed to create time entry"); }
  };

  const handleDelete = async (id) => {
    try { await axios.delete(`${API}/time-entries/${id}`, { headers }); toast.success("Deleted"); fetchData(); } catch { toast.error("Failed"); }
  };

  const fmtTime = (secs) => { const m = Math.floor(secs / 60); const s = secs % 60; return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; };

  // Computed stats
  const totalMinutes = timeEntries.reduce((s, e) => s + (e.minutes || 0), 0);
  const billableMinutes = timeEntries.filter(e => e.billable).reduce((s, e) => s + (e.minutes || 0), 0);
  const nonBillableMinutes = totalMinutes - billableMinutes;
  const billableRate = totalMinutes > 0 ? Math.round(billableMinutes / totalMinutes * 100) : 0;
  const avgRate = 125; // Default hourly rate
  const estimatedRevenue = Math.round(billableMinutes / 60 * avgRate);

  // Weekly chart data
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: endOfWeek(new Date(), { weekStartsOn: 1 }) });
  const weeklyChartData = weekDays.map(day => {
    const dayEntries = timeEntries.filter(e => { try { return isSameDay(parseISO(e.date), day); } catch { return false; } });
    return {
      day: format(day, "EEE"),
      billable: dayEntries.filter(e => e.billable).reduce((s, e) => s + (e.minutes || 0), 0) / 60,
      nonBillable: dayEntries.filter(e => !e.billable).reduce((s, e) => s + (e.minutes || 0), 0) / 60,
    };
  });

  // Per-user summary
  const userSummary = users.map(u => {
    const userEntries = timeEntries.filter(e => e.user_id === u.id);
    const total = userEntries.reduce((s, e) => s + (e.minutes || 0), 0);
    const billable = userEntries.filter(e => e.billable).reduce((s, e) => s + (e.minutes || 0), 0);
    return { ...u, totalMinutes: total, billableMinutes: billable, entries: userEntries.length, rate: total > 0 ? Math.round(billable / total * 100) : 0 };
  }).filter(u => u.totalMinutes > 0).sort((a, b) => b.totalMinutes - a.totalMinutes);

  // Per-client summary
  const clientMap = {};
  timeEntries.forEach(e => {
    const ticket = tickets.find(t => t.id === e.ticket_id);
    const clientName = ticket?.client_name || "Unassigned";
    if (!clientMap[clientName]) clientMap[clientName] = { name: clientName, totalMinutes: 0, billableMinutes: 0, entries: 0 };
    clientMap[clientName].totalMinutes += e.minutes || 0;
    clientMap[clientName].billableMinutes += e.billable ? (e.minutes || 0) : 0;
    clientMap[clientName].entries++;
  });
  const clientSummary = Object.values(clientMap).sort((a, b) => b.totalMinutes - a.totalMinutes);

  const filteredEntries = timeEntries.filter(e => {
    if (filterUser !== "all" && e.user_id !== filterUser) return false;
    if (filterBillable === "billable" && !e.billable) return false;
    if (filterBillable === "non-billable" && e.billable) return false;
    if (search && !e.description?.toLowerCase().includes(search.toLowerCase()) && !e.ticket_number?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="time-tracking-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Time Tracking</h1><p className="text-muted-foreground">Track time, manage billing, analyze productivity</p></div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCSV(filteredEntries.map(e => ({ Date: e.date, Ticket: e.ticket_number || "", Description: e.description, Minutes: e.minutes, Billable: e.billable ? "Yes" : "No", Technician: e.user_name || "" })), "time_entries")} data-testid="export-time-csv"><Download className="w-4 h-4 mr-2" />Export</Button>
          <Button onClick={() => setIsDialogOpen(true)} data-testid="add-time-entry-btn"><Plus className="w-4 h-4 mr-2" />Log Time</Button>
        </div>
      </div>

      {/* Timer + Stats */}
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-4" data-testid="live-timer">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3"><Timer className="w-5 h-5 text-primary" /><span className="font-semibold">Live Timer</span></div>
            <div className="text-center mb-4">
              <p className={`text-5xl font-mono font-bold tabular-nums ${isTimerRunning ? "text-primary" : "text-muted-foreground"}`}>{fmtTime(elapsedTime)}</p>
            </div>
            {!isTimerRunning ? (
              <div className="space-y-3">
                <Select value={timerTicket || ""} onValueChange={setTimerTicket}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Link to ticket (optional)" /></SelectTrigger>
                  <SelectContent>{tickets.slice(0, 20).map(t => (<SelectItem key={t.id} value={t.id}>{t.ticket_number} - {t.title}</SelectItem>))}</SelectContent>
                </Select>
                <Input placeholder="What are you working on?" value={timerDescription} onChange={e => setTimerDescription(e.target.value)} className="text-sm" />
                <Button className="w-full" onClick={startTimer} data-testid="start-timer-btn"><Play className="w-4 h-4 mr-2" />Start Timer</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground text-center">{timerDescription || "Working..."}</p>
                <Button className="w-full" variant="destructive" onClick={stopTimer} data-testid="stop-timer-btn"><Square className="w-4 h-4 mr-2" />Stop & Log</Button>
              </div>
            )}
          </CardContent>
        </Card>
        <div className="col-span-8 grid grid-cols-4 gap-4">
          <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Clock className="w-5 h-5 text-blue-500" /></div><div><p className="text-2xl font-bold">{Math.round(totalMinutes / 60 * 10) / 10}h</p><p className="text-xs text-muted-foreground">Total Hours</p></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-green-500" /></div><div><p className="text-2xl font-bold">{Math.round(billableMinutes / 60 * 10) / 10}h</p><p className="text-xs text-muted-foreground">Billable Hours</p></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-purple-500" /></div><div><p className="text-2xl font-bold">{billableRate}%</p><p className="text-xs text-muted-foreground">Billable Rate</p></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-emerald-500" /></div><div><p className="text-2xl font-bold">${estimatedRevenue.toLocaleString()}</p><p className="text-xs text-muted-foreground">Est. Revenue</p></div></CardContent></Card>
        </div>
      </div>

      {/* Weekly Chart */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">This Week's Hours</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Bar dataKey="billable" name="Billable (hrs)" fill="#22C55E" radius={[4, 4, 0, 0]} stackId="a" />
                <Bar dataKey="nonBillable" name="Non-Billable (hrs)" fill="#6B7280" radius={[4, 4, 0, 0]} stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="entries" className="gap-1"><Clock className="w-4 h-4" />All Entries</TabsTrigger>
          <TabsTrigger value="by-tech" className="gap-1"><Users className="w-4 h-4" />By Technician</TabsTrigger>
          <TabsTrigger value="by-client" className="gap-1"><FileText className="w-4 h-4" />By Client</TabsTrigger>
        </TabsList>

        <TabsContent value="entries" className="space-y-4">
          <div className="flex gap-3">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Search entries..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
            <Select value={filterUser} onValueChange={setFilterUser}><SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Technicians</SelectItem>{users.map(u => (<SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>))}</SelectContent></Select>
            <Select value={filterBillable} onValueChange={setFilterBillable}><SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Types</SelectItem><SelectItem value="billable">Billable</SelectItem><SelectItem value="non-billable">Non-Billable</SelectItem></SelectContent></Select>
          </div>
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Ticket</TableHead><TableHead>Description</TableHead><TableHead>Technician</TableHead><TableHead className="text-center">Hours</TableHead><TableHead>Type</TableHead><TableHead className="w-[50px]"></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {filteredEntries.map(entry => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-mono text-sm">{entry.date}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{entry.ticket_number || "-"}</Badge></TableCell>
                        <TableCell className="max-w-[200px] truncate">{entry.description}</TableCell>
                        <TableCell className="text-sm">{entry.user_name}</TableCell>
                        <TableCell className="text-center font-mono">{(entry.minutes / 60).toFixed(1)}h</TableCell>
                        <TableCell><Badge className={entry.billable ? "bg-green-500/10 text-green-500" : "bg-gray-500/10 text-gray-500"}>{entry.billable ? "Billable" : "Non-Billable"}</Badge></TableCell>
                        <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(entry.id)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by-tech" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Technician</TableHead><TableHead className="text-center">Entries</TableHead><TableHead className="text-center">Total Hours</TableHead><TableHead className="text-center">Billable Hours</TableHead><TableHead>Billable Rate</TableHead></TableRow></TableHeader>
                <TableBody>
                  {userSummary.map(u => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="text-center font-mono">{u.entries}</TableCell>
                      <TableCell className="text-center font-mono">{(u.totalMinutes / 60).toFixed(1)}h</TableCell>
                      <TableCell className="text-center font-mono">{(u.billableMinutes / 60).toFixed(1)}h</TableCell>
                      <TableCell><div className="flex items-center gap-2"><Progress value={u.rate} className="h-2 w-20" /><span className="text-xs font-mono">{u.rate}%</span></div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by-client" className="space-y-4" data-testid="client-billing-tab">
          <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => exportCSV(clientSummary.map(c => ({ Client: c.name, Entries: c.entries, "Total Hours": (c.totalMinutes / 60).toFixed(1), "Billable Hours": (c.billableMinutes / 60).toFixed(1), "Est. Revenue ($)": Math.round(c.billableMinutes / 60 * avgRate) })), "client_billing")} data-testid="export-client-billing"><Download className="w-4 h-4 mr-2" />Export Billing</Button></div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-center">Entries</TableHead><TableHead className="text-center">Total Hours</TableHead><TableHead className="text-center">Billable Hours</TableHead><TableHead className="text-right">Est. Revenue</TableHead></TableRow></TableHeader>
                <TableBody>
                  {clientSummary.map(c => (
                    <TableRow key={c.name}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-center font-mono">{c.entries}</TableCell>
                      <TableCell className="text-center font-mono">{(c.totalMinutes / 60).toFixed(1)}h</TableCell>
                      <TableCell className="text-center font-mono">{(c.billableMinutes / 60).toFixed(1)}h</TableCell>
                      <TableCell className="text-right font-mono text-green-500">${Math.round(c.billableMinutes / 60 * avgRate).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Time Entry Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Time Entry</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2"><Label>Ticket</Label>
              <Select value={formData.ticket_id} onValueChange={v => setFormData({ ...formData, ticket_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select ticket" /></SelectTrigger>
                <SelectContent>{tickets.slice(0, 30).map(t => (<SelectItem key={t.id} value={t.id}>{t.ticket_number} - {t.title}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Minutes *</Label><Input type="number" value={formData.minutes} onChange={e => setFormData({ ...formData, minutes: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Date</Label><Input type="date" value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Description</Label><Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={2} /></div>
            <div className="flex items-center gap-2"><Switch checked={formData.billable} onCheckedChange={v => setFormData({ ...formData, billable: v })} /><Label>Billable</Label></div>
            <DialogFooter><Button type="submit">Log Time</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
