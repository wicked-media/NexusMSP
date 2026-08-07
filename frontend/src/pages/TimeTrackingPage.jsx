import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import {
  Plus, Clock, Loader2, DollarSign, Timer, Play, Square, Trash2, Search, Download, Users, TrendingUp, FileText, ArrowRight, Check, ChevronsUpDown,
  Receipt, ShieldCheck, Eye, AlertTriangle
} from "lucide-react";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, parseISO } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const COLORS = ["#3B82F6", "#22C55E", "#EAB308", "#EF4444", "#8B5CF6", "#EC4899"];
const chartTooltipStyle = { backgroundColor: "hsl(217, 33%, 17%)", border: "1px solid hsl(217, 33%, 25%)", borderRadius: "8px", color: "hsl(210, 40%, 98%)" };
const billableValue = (entry) => {
  const recorded = Number(entry?.total_amount);
  if (Number.isFinite(recorded)) return recorded;
  const minutes = Number(entry?.minutes) || 0;
  const rate = Number(entry?.hourly_rate) || 0;
  return (minutes / 60) * rate;
};

function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyMessage = "No matching records found.",
  testId,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const selected = options.find((option) => option.value === value);
  const matches = needle
    ? options.filter((option) => `${option.label || ""} ${option.detail || ""} ${option.searchText || ""}`.toLowerCase().includes(needle))
    : options;

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setQuery("");
    }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          data-testid={testId}
          className="h-10 w-full justify-between border-white/10 bg-black/10 px-3 text-left font-normal hover:border-emerald-400/35 hover:bg-emerald-400/[0.04]"
        >
          <span className={selected ? "truncate" : "truncate text-muted-foreground"}>{selected?.label || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-emerald-300/70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[20rem] overflow-hidden border-emerald-400/25 bg-popover p-0 shadow-2xl">
        <Command shouldFilter={false}>
          <CommandInput autoFocus placeholder={searchPlaceholder} value={query} onValueChange={setQuery} data-testid={`${testId}-search`} />
          <CommandList>
            {matches.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
            ) : (
              <CommandGroup heading={`${matches.length} matching record${matches.length === 1 ? "" : "s"}`}>
                {matches.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => {
                      onValueChange(option.value);
                      setQuery("");
                      setOpen(false);
                    }}
                    className="py-2.5"
                  >
                    <Check className={`mt-0.5 h-4 w-4 shrink-0 ${value === option.value ? "text-emerald-300 opacity-100" : "opacity-0"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{option.label}</span>
                      {option.detail && <span className="block truncate text-[11px] text-muted-foreground">{option.detail}</span>}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const localToday = format(new Date(), "yyyy-MM-dd");
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
  const [timerBillable, setTimerBillable] = useState(true);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef(null);
  const [invoiceDialog, setInvoiceDialog] = useState(false);
  const [reviewEntry, setReviewEntry] = useState(null);
  const [deleteEntry, setDeleteEntry] = useState(null);
  const [invoiceClient, setInvoiceClient] = useState("");
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [formData, setFormData] = useState({
    ticket_id: "", user_id: "", description: "", minutes: "",
    billable: true, date: localToday
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

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const entryId = searchParams.get("entry");
    if (!entryId || loading) return;
    const entry = timeEntries.find((candidate) => candidate.id === entryId);
    if (entry) {
      setReviewEntry(entry);
      setActiveTab("entries");
    } else {
      toast.error("The selected time entry could not be found");
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("entry");
    setSearchParams(nextParams, { replace: true });
  }, [loading, searchParams, setSearchParams, timeEntries]);

  // Timer logic
  useEffect(() => {
    if (isTimerRunning) {
      timerRef.current = setInterval(() => setElapsedTime(Math.floor((Date.now() - timerStart) / 1000)), 1000);
    } else { clearInterval(timerRef.current); }
    return () => clearInterval(timerRef.current);
  }, [isTimerRunning, timerStart]);

  const startTimer = () => {
    if (!timerDescription.trim()) {
      toast.error("Describe the work before starting the timer");
      return;
    }
    if (timerBillable && !timerTicket) {
      toast.error("Billable time must be linked to a ticket");
      return;
    }
    setTimerStart(Date.now());
    setElapsedTime(0);
    setIsTimerRunning(true);
  };
  const stopTimer = async () => {
    setIsTimerRunning(false);
    const minutes = Math.max(1, Math.round(elapsedTime / 60));
    try {
      await axios.post(`${API}/time-entries`, { ticket_id: timerTicket || "", user_id: user?.id || "", description: timerDescription || "Timer session", minutes, billable: timerBillable, date: format(new Date(), "yyyy-MM-dd") }, { headers });
      toast.success(`Logged ${minutes} minutes`);
      setTimerDescription(""); setTimerTicket(null); setTimerBillable(true); setElapsedTime(0);
      fetchData();
    } catch { toast.error("Failed to log timer"); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const minutes = parseInt(formData.minutes, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) { toast.error("Enter a valid duration greater than zero"); return; }
    if (!formData.description.trim()) { toast.error("Add a clear work description"); return; }
    if (formData.billable && !formData.ticket_id) { toast.error("Billable time must be linked to a ticket"); return; }
    try {
      await axios.post(`${API}/time-entries`, { ...formData, description: formData.description.trim(), user_id: formData.user_id || user?.id || "", minutes }, { headers });
      toast.success("Time entry added");
      setIsDialogOpen(false);
      setFormData({ ticket_id: "", user_id: "", description: "", minutes: "", billable: true, date: format(new Date(), "yyyy-MM-dd") });
      fetchData();
    } catch { toast.error("Failed to create time entry"); }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/time-entries/${id}`, { headers });
      toast.success("Time entry deleted");
      setDeleteEntry(null);
      fetchData();
    } catch { toast.error("Failed to delete time entry"); }
  };

  const handleGenerateInvoice = async () => {
    if (!invoiceClient) { toast.error("Select a client"); return; }
    setGeneratingInvoice(true);
    try {
      const res = await axios.post(`${API}/time-entries/generate-invoice`, { client_name: invoiceClient }, { headers });
      toast.success(`Invoice ${res.data.id} created: $${res.data.total_amount} for ${res.data.total_hours}h`);
      setInvoiceDialog(false); setInvoiceClient(""); fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to generate invoice"); }
    finally { setGeneratingInvoice(false); }
  };

  const fmtTime = (secs) => { const m = Math.floor(secs / 60); const s = secs % 60; return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; };

  // Computed stats
  const totalMinutes = timeEntries.reduce((s, e) => s + (e.minutes || 0), 0);
  const billableMinutes = timeEntries.filter(e => e.billable).reduce((s, e) => s + (e.minutes || 0), 0);
  const nonBillableMinutes = totalMinutes - billableMinutes;
  const billableRate = totalMinutes > 0 ? Math.round(billableMinutes / totalMinutes * 100) : 0;
  const estimatedRevenue = timeEntries.filter(e => e.billable).reduce((sum, entry) => sum + billableValue(entry), 0);

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
    if (!clientMap[clientName]) clientMap[clientName] = { name: clientName, totalMinutes: 0, billableMinutes: 0, billableAmount: 0, entries: 0 };
    clientMap[clientName].totalMinutes += e.minutes || 0;
    clientMap[clientName].billableMinutes += e.billable ? (e.minutes || 0) : 0;
    clientMap[clientName].billableAmount += e.billable ? billableValue(e) : 0;
    clientMap[clientName].entries++;
  });
  const clientSummary = Object.values(clientMap).sort((a, b) => b.totalMinutes - a.totalMinutes);
  const ticketOptions = tickets.map((ticket) => ({
    value: ticket.id,
    label: `${ticket.ticket_number || ticket.id} · ${ticket.title || "Untitled ticket"}`,
    detail: `${ticket.client_name || "Client not assigned"} · ${String(ticket.status || "open").replaceAll("_", " ")}`,
    searchText: `${ticket.client_name || ""} ${ticket.contact_name || ""}`,
  }));
  const clientOptions = clientSummary
    .filter((client) => client.billableMinutes > 0)
    .map((client) => ({
      value: client.name,
      label: client.name,
      detail: `${(client.billableMinutes / 60).toFixed(2)} billable hours across ${client.entries} entries`,
    }));

  const filteredEntries = timeEntries.filter(e => {
    if (filterUser !== "all" && e.user_id !== filterUser) return false;
    if (filterBillable === "billable" && !e.billable) return false;
    if (filterBillable === "non-billable" && e.billable) return false;
    const linkedTicket = tickets.find((ticket) => ticket.id === e.ticket_id);
    const searchText = `${e.description || ""} ${e.ticket_number || ""} ${linkedTicket?.ticket_number || ""} ${linkedTicket?.title || ""} ${e.user_name || ""} ${e.client_name || ""}`.toLowerCase();
    if (search && !searchText.includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="time-tracking-page">
      <OperationalPageHeader
        eyebrow="Service delivery and billing evidence"
        title="Time Tracking"
        description="Capture technician effort against the correct client and ticket, validate billable evidence, and turn approved work into an auditable invoice."
        icon={Clock}
        tone="emerald"
        actions={(
          <>
            <Button variant="outline" className="h-9" onClick={() => exportCSV(filteredEntries.map(e => ({ Date: e.date, Ticket: e.ticket_number || "", Description: e.description, Minutes: e.minutes, Billable: e.billable ? "Yes" : "No", Technician: e.user_name || "" })), "time_entries")} data-testid="export-time-csv"><Download className="mr-2 h-4 w-4" />Export</Button>
            <Button variant="outline" className="h-9" onClick={() => setInvoiceDialog(true)} data-testid="gen-invoice-from-time"><DollarSign className="mr-2 h-4 w-4" />Generate invoice</Button>
            <Button className="h-9" onClick={() => setIsDialogOpen(true)} data-testid="add-time-entry-btn"><Plus className="mr-2 h-4 w-4" />Log time</Button>
          </>
        )}
      />

      {/* Timer + Stats */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Card className="overflow-hidden border-emerald-400/15 bg-gradient-to-br from-emerald-500/[0.07] via-card to-card xl:col-span-4" data-testid="live-timer">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3"><Timer className="w-5 h-5 text-primary" /><span className="font-semibold">Live Timer</span></div>
            <div className="text-center mb-4">
              <p className={`text-5xl font-mono font-bold tabular-nums ${isTimerRunning ? "text-primary" : "text-muted-foreground"}`}>{fmtTime(elapsedTime)}</p>
            </div>
            {!isTimerRunning ? (
              <div className="space-y-3">
                <SearchableSelect options={ticketOptions} value={timerTicket || ""} onValueChange={setTimerTicket} placeholder={timerBillable ? "Search ticket · required for billing" : "Search ticket · optional"} searchPlaceholder="Search ticket, client or contact…" testId="timer-ticket-search" />
                <Input placeholder="What are you working on?" value={timerDescription} onChange={e => setTimerDescription(e.target.value)} className="text-sm" />
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/10 px-3 py-2">
                  <div>
                    <p className="text-xs font-medium">Billable timer</p>
                    <p className="text-[10px] text-muted-foreground">{timerBillable ? "A linked ticket is required" : "Internal or administrative time"}</p>
                  </div>
                  <Switch checked={timerBillable} onCheckedChange={setTimerBillable} data-testid="timer-billable-switch" />
                </div>
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:col-span-8">
          <HeroTile label="Total hours" value={`${(totalMinutes / 60).toFixed(1)}h`} animated={false} icon={Clock} glow="sky" subtitle={`${timeEntries.length} recorded entries`} testId="time-total-hours-tile" />
          <HeroTile label="Billable hours" value={`${(billableMinutes / 60).toFixed(1)}h`} animated={false} icon={DollarSign} glow="emerald" subtitle={`${(nonBillableMinutes / 60).toFixed(1)}h non-billable`} testId="time-billable-hours-tile" />
          <HeroTile label="Billable rate" value={billableRate} suffix="%" icon={TrendingUp} glow="violet" subtitle="Share of recorded effort" testId="time-billable-rate-tile" />
          <HeroTile label="Unbilled value" value={`$${estimatedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} animated={false} icon={Receipt} glow="amber" subtitle="From recorded technician rates" testId="time-estimated-revenue-tile" />
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
        <TabsList className="h-auto flex-wrap justify-start gap-2 bg-transparent p-0">
          <TabsTrigger value="entries" className="gap-1.5 rounded-lg border border-white/10 bg-card px-4 py-2 data-[state=active]:border-emerald-400/35 data-[state=active]:bg-emerald-400/[0.08] data-[state=active]:text-emerald-200"><Clock className="w-4 h-4" />All Entries</TabsTrigger>
          <TabsTrigger value="by-tech" className="gap-1.5 rounded-lg border border-white/10 bg-card px-4 py-2 data-[state=active]:border-emerald-400/35 data-[state=active]:bg-emerald-400/[0.08] data-[state=active]:text-emerald-200"><Users className="w-4 h-4" />By Technician</TabsTrigger>
          <TabsTrigger value="by-client" className="gap-1.5 rounded-lg border border-white/10 bg-card px-4 py-2 data-[state=active]:border-emerald-400/35 data-[state=active]:bg-emerald-400/[0.08] data-[state=active]:text-emerald-200"><FileText className="w-4 h-4" />By Client</TabsTrigger>
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
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Ticket</TableHead><TableHead>Description</TableHead><TableHead>Technician</TableHead><TableHead className="text-center">Hours</TableHead><TableHead>Type</TableHead><TableHead className="w-[112px] text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {filteredEntries.map(entry => {
                      const linkedTicket = tickets.find((ticket) => ticket.id === entry.ticket_id);
                      const ticketReference = linkedTicket?.ticket_number || entry.ticket_number;
                      return (
                        <TableRow key={entry.id}>
                          <TableCell className="font-mono text-sm">{entry.date}</TableCell>
                          <TableCell>
                            {entry.ticket_id ? (
                              <button type="button" onClick={() => navigate(`/tickets?ticket=${encodeURIComponent(entry.ticket_id)}`)} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
                                <Badge variant="outline" className="cursor-pointer border-emerald-400/20 text-[10px] text-emerald-200 hover:bg-emerald-400/[0.08]">{ticketReference || "Linked ticket"}</Badge>
                              </button>
                            ) : <Badge variant="outline" className="text-[10px] text-muted-foreground">Not linked</Badge>}
                          </TableCell>
                          <TableCell className="max-w-[240px]">
                            <button type="button" className="block max-w-full truncate text-left hover:text-emerald-200 hover:underline" onClick={() => setReviewEntry(entry)}>{entry.description}</button>
                          </TableCell>
                          <TableCell className="text-sm">{entry.user_name || "Unassigned"}</TableCell>
                          <TableCell className="text-center font-mono">{(entry.minutes / 60).toFixed(2)}h</TableCell>
                          <TableCell><Badge className={entry.billable ? "bg-green-500/10 text-green-500" : "bg-gray-500/10 text-gray-500"}>{entry.billable ? "Billable" : "Non-Billable"}</Badge></TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-emerald-300" onClick={() => setReviewEntry(entry)} aria-label={`Review ${entry.description}`}><Eye className="h-3.5 w-3.5" /></Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-300" onClick={() => setDeleteEntry(entry)} aria-label={`Delete ${entry.description}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
          <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => exportCSV(clientSummary.map(c => ({ Client: c.name, Entries: c.entries, "Total Hours": (c.totalMinutes / 60).toFixed(1), "Billable Hours": (c.billableMinutes / 60).toFixed(1), "Unbilled Value ($)": c.billableAmount.toFixed(2) })), "client_billing")} data-testid="export-client-billing"><Download className="w-4 h-4 mr-2" />Export Billing</Button></div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-center">Entries</TableHead><TableHead className="text-center">Total Hours</TableHead><TableHead className="text-center">Billable Hours</TableHead><TableHead className="text-right">Unbilled Value</TableHead></TableRow></TableHeader>
                <TableBody>
                  {clientSummary.map(c => (
                    <TableRow key={c.name}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-center font-mono">{c.entries}</TableCell>
                      <TableCell className="text-center font-mono">{(c.totalMinutes / 60).toFixed(1)}h</TableCell>
                      <TableCell className="text-center font-mono">{(c.billableMinutes / 60).toFixed(1)}h</TableCell>
                      <TableCell className="text-right font-mono text-green-500">${c.billableAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Billing reconciliation review */}
      <Dialog open={Boolean(reviewEntry)} onOpenChange={(open) => { if (!open) setReviewEntry(null); }}>
        <DialogContent className="overflow-hidden border-emerald-400/20 p-0 sm:max-w-2xl" data-testid="time-entry-review-dialog">
          <div className="border-b border-emerald-400/15 bg-gradient-to-br from-emerald-500/[0.12] via-background to-background px-6 py-5">
            <DialogHeader>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">Billing evidence review</p>
              <DialogTitle className="mt-1 flex items-center gap-2 text-xl">
                <Clock className="h-5 w-5 text-emerald-300" />
                {reviewEntry?.description || "Time entry"}
              </DialogTitle>
              <DialogDescription>
                Validate the work, client and ticket relationship before this entry is converted into an invoice.
              </DialogDescription>
            </DialogHeader>
          </div>
          {reviewEntry && (
            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Technician</p>
                  <p className="mt-1 text-sm font-semibold">{reviewEntry.user_name || "Not assigned"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{reviewEntry.date || "No work date recorded"}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Client and ticket</p>
                  <p className="mt-1 text-sm font-semibold">{reviewEntry.client_name || "Client not linked"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{reviewEntry.ticket_title || reviewEntry.ticket_number || (reviewEntry.ticket_id ? "Linked ticket" : "Ticket not linked")}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 divide-x divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-black/10">
                <div className="p-4 text-center">
                  <p className="text-lg font-semibold">{(Number(reviewEntry.minutes || 0) / 60).toFixed(2)}h</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Duration</p>
                </div>
                <div className="p-4 text-center">
                  <p className="text-lg font-semibold">${Number(reviewEntry.hourly_rate || 0).toFixed(2)}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Hourly rate</p>
                </div>
                <div className="p-4 text-center">
                  <p className="text-lg font-semibold text-emerald-300">${Number(reviewEntry.total_amount || 0).toFixed(2)}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Billable value</p>
                </div>
              </div>
              <div className={`rounded-xl border p-4 ${reviewEntry.billable && reviewEntry.ticket_id && reviewEntry.client_name && Number(reviewEntry.minutes) > 0 && Number(reviewEntry.hourly_rate) > 0 ? "border-emerald-400/20 bg-emerald-400/[0.06]" : "border-amber-400/20 bg-amber-400/[0.06]"}`}>
                <p className="text-sm font-semibold">
                  {reviewEntry.billable && reviewEntry.ticket_id && reviewEntry.client_name && Number(reviewEntry.minutes) > 0 && Number(reviewEntry.hourly_rate) > 0 ? "Ready for invoice review" : "Billing evidence needs attention"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {reviewEntry.billable && reviewEntry.ticket_id && reviewEntry.client_name && Number(reviewEntry.minutes) > 0 && Number(reviewEntry.hourly_rate) > 0
                    ? "Duration, rate, client and ticket evidence are present."
                    : "Confirm this entry is billable and has a valid duration, rate, client and linked ticket."}
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="border-t border-white/10 bg-black/10 px-6 py-4">
            <Button variant="outline" onClick={() => setReviewEntry(null)}>Close</Button>
            {reviewEntry?.ticket_id && (
              <Button onClick={() => navigate(`/tickets?ticket=${encodeURIComponent(reviewEntry.ticket_id)}`)} data-testid="open-reviewed-time-ticket">
                Open linked ticket<ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Time Entry Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="overflow-hidden border-emerald-400/20 p-0 sm:max-w-2xl" aria-describedby="log-time-description">
          <div className="border-b border-emerald-400/15 bg-gradient-to-br from-emerald-500/[0.12] via-background to-background px-6 py-5">
            <DialogHeader>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">Auditable service record</p>
              <DialogTitle className="mt-1 flex items-center gap-2 text-xl"><Clock className="h-5 w-5 text-emerald-300" />Log time entry</DialogTitle>
              <DialogDescription id="log-time-description">Record who performed the work, what changed and which client ticket should receive the billing evidence.</DialogDescription>
            </DialogHeader>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="space-y-5 px-6 py-5">
              <div className="space-y-2"><Label>Related ticket {formData.billable && <span className="text-emerald-300">*</span>}</Label>
                <SearchableSelect options={ticketOptions} value={formData.ticket_id} onValueChange={v => setFormData({ ...formData, ticket_id: v })} placeholder="Search ticket, client or contact…" searchPlaceholder="Type a ticket number, title, client or contact…" testId="log-time-ticket-search" />
                <p className="text-[11px] text-muted-foreground">Billable entries require a ticket so the invoice, client history and audit trail remain connected.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Duration in minutes *</Label><Input type="number" min="1" value={formData.minutes} onChange={e => setFormData({ ...formData, minutes: e.target.value })} required data-testid="log-time-minutes" /></div>
                <div className="space-y-2"><Label>Work date *</Label><Input type="date" value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} required data-testid="log-time-date" /></div>
              </div>
              <div className="space-y-2"><Label>Work performed *</Label><Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={4} placeholder="Summarise the diagnosis, action taken and outcome…" required data-testid="log-time-description" /></div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/10 p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className={`mt-0.5 h-5 w-5 ${formData.billable ? "text-emerald-300" : "text-muted-foreground"}`} />
                  <div><Label>Billable work</Label><p className="mt-1 text-xs text-muted-foreground">{formData.billable ? "This entry will be available to billing reconciliation." : "This remains an internal service record."}</p></div>
                </div>
                <Switch checked={formData.billable} onCheckedChange={v => setFormData({ ...formData, billable: v })} data-testid="log-time-billable" />
              </div>
            </div>
            <DialogFooter className="border-t border-white/10 bg-black/10 px-6 py-4">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button type="submit" data-testid="submit-time-entry"><Clock className="mr-2 h-4 w-4" />Log time</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteEntry)} onOpenChange={(open) => { if (!open) setDeleteEntry(null); }}>
        <AlertDialogContent className="border-red-400/20 sm:max-w-lg">
          <AlertDialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-red-400/20 bg-red-400/[0.08]"><AlertTriangle className="h-5 w-5 text-red-300" /></div>
            <AlertDialogTitle>Delete this time entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {deleteEntry ? `${(Number(deleteEntry.minutes || 0) / 60).toFixed(2)} hours for “${deleteEntry.description}”` : "the selected service record"} and adjusts the linked ticket&apos;s tracked time. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep entry</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-500" onClick={() => deleteEntry && handleDelete(deleteEntry.id)} data-testid="confirm-delete-time-entry">Delete entry</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Generate Invoice Dialog */}
      <Dialog open={invoiceDialog} onOpenChange={setInvoiceDialog}>
        <DialogContent className="overflow-hidden border-emerald-400/20 p-0 sm:max-w-xl" aria-describedby="invoice-gen-desc">
          <div className="border-b border-emerald-400/15 bg-gradient-to-br from-emerald-500/[0.12] via-background to-background px-6 py-5">
            <DialogHeader>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">Billing hand-off</p>
              <DialogTitle className="mt-1 flex items-center gap-2 text-xl"><Receipt className="h-5 w-5 text-emerald-300" />Generate invoice from time</DialogTitle>
              <DialogDescription id="invoice-gen-desc">Create a draft invoice from the client&apos;s unbilled, billable service evidence.</DialogDescription>
            </DialogHeader>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2"><Label>Client with unbilled time</Label>
              <SearchableSelect options={clientOptions} value={invoiceClient} onValueChange={setInvoiceClient} placeholder="Search for a client…" searchPlaceholder="Type a client name…" testId="invoice-time-client-search" />
            </div>
            {invoiceClient && clientSummary.find(c => c.name === invoiceClient) && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-sm">
                <p className="font-semibold text-emerald-100">{(clientSummary.find(c => c.name === invoiceClient)?.billableMinutes / 60).toFixed(2)} billable hours ready for review</p>
                <p className="mt-1 text-xs text-muted-foreground">Across {clientSummary.find(c => c.name === invoiceClient)?.entries} service records. Nexus will create a draft for validation before sending.</p>
              </div>
            )}
          </div>
          <DialogFooter className="border-t border-white/10 bg-black/10 px-6 py-4">
            <Button variant="outline" onClick={() => setInvoiceDialog(false)}>Cancel</Button>
            <Button onClick={handleGenerateInvoice} disabled={generatingInvoice || !invoiceClient} data-testid="confirm-gen-invoice">
              {generatingInvoice ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}
              Generate Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
