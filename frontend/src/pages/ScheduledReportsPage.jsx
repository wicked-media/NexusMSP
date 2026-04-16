import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Calendar, Plus, Trash2, Play, Pause, Mail, Clock, FileText,
  Send, RefreshCw, Loader2, CheckCircle, Edit, BarChart3, Users
} from "lucide-react";

const REPORT_TYPES = [
  { id: "executive_summary", label: "Executive Summary", desc: "High-level overview of all operations" },
  { id: "ticket_report", label: "Ticket Report", desc: "Ticket volume, SLA compliance, resolution times" },
  { id: "device_health", label: "Device Health Report", desc: "Device status, uptime, performance metrics" },
  { id: "billing_summary", label: "Billing Summary", desc: "Revenue, outstanding invoices, collections" },
  { id: "security_report", label: "Security Report", desc: "Alerts, compliance scores, vulnerabilities" },
  { id: "client_health", label: "Client Health Report", desc: "Per-client health scores and trends" },
];

const FREQUENCIES = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

export default function ScheduledReportsPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", report_type: "executive_summary", frequency: "weekly",
    day_of_week: "monday", time: "08:00", recipients: "", timezone: "Australia/Sydney",
  });

  const fetchData = useCallback(async () => {
    try {
      const [rRes, sRes] = await Promise.all([
        axios.get(`${API}/scheduled-reports`, { headers }),
        axios.get(`${API}/scheduled-reports/stats/overview`, { headers }),
      ]);
      setReports(rRes.data);
      setStats(sRes.data);
    } catch { toast.error("Failed to load scheduled reports"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const createReport = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/scheduled-reports`, {
        ...form,
        recipients: form.recipients.split(",").map(r => r.trim()).filter(Boolean),
      }, { headers });
      toast.success("Scheduled report created");
      setShowCreate(false);
      setForm({ name: "", report_type: "executive_summary", frequency: "weekly", day_of_week: "monday", time: "08:00", recipients: "", timezone: "Australia/Sydney" });
      fetchData();
    } catch { toast.error("Failed to create report"); }
    finally { setSaving(false); }
  };

  const toggleReport = async (id) => {
    try {
      const res = await axios.post(`${API}/scheduled-reports/${id}/toggle`, {}, { headers });
      toast.success(res.data.enabled ? "Report enabled" : "Report paused");
      fetchData();
    } catch { toast.error("Failed to toggle"); }
  };

  const sendNow = async (id) => {
    try {
      const res = await axios.post(`${API}/scheduled-reports/${id}/send-now`, {}, { headers });
      toast.success(res.data.message);
      fetchData();
    } catch { toast.error("Failed to send"); }
  };

  const deleteReport = async (id) => {
    if (!window.confirm("Delete this scheduled report?")) return;
    try {
      await axios.delete(`${API}/scheduled-reports/${id}`, { headers });
      toast.success("Report deleted");
      fetchData();
    } catch { toast.error("Failed to delete"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="scheduled-reports-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Calendar className="w-6 h-6 text-blue-400" />Scheduled Reports</h1>
          <p className="text-muted-foreground mt-1">Auto-send reports to clients and team on a schedule</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-report-btn"><Plus className="w-4 h-4 mr-1" />New Schedule</Button>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><FileText className="w-5 h-5 text-blue-400" /></div>
            <div><p className="text-2xl font-bold">{stats.total}</p><p className="text-[10px] text-muted-foreground uppercase">Total Schedules</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center"><Play className="w-5 h-5 text-emerald-400" /></div>
            <div><p className="text-2xl font-bold">{stats.active}</p><p className="text-[10px] text-muted-foreground uppercase">Active</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center"><Send className="w-5 h-5 text-violet-400" /></div>
            <div><p className="text-2xl font-bold">{stats.total_sent}</p><p className="text-[10px] text-muted-foreground uppercase">Total Sent</p></div>
          </CardContent></Card>
        </div>
      )}

      {/* Reports List */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Recipients</TableHead>
                <TableHead>Last Sent</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No scheduled reports yet</TableCell></TableRow>
              )}
              {reports.map(r => (
                <TableRow key={r.id} data-testid={`report-${r.id}`}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[9px]">{r.report_type?.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell className="capitalize">{r.frequency} {r.frequency === "weekly" ? `(${r.day_of_week})` : ""} at {r.time}</TableCell>
                  <TableCell><span className="text-xs">{(r.recipients || []).length} recipients</span></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.last_sent ? new Date(r.last_sent).toLocaleDateString() : "Never"}</TableCell>
                  <TableCell>{r.send_count || 0}</TableCell>
                  <TableCell><Switch checked={r.enabled} onCheckedChange={() => toggleReport(r.id)} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => sendNow(r.id)}><Send className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" className="text-red-400" onClick={() => deleteReport(r.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md" aria-describedby="create-sr-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Calendar className="w-5 h-5 text-blue-400" />New Scheduled Report</DialogTitle>
            <DialogDescription id="create-sr-desc">Set up an automated report to be sent on a schedule</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Weekly Client Summary" data-testid="sr-name" /></div>
            <div><Label>Report Type</Label>
              <Select value={form.report_type} onValueChange={v => setForm(p => ({ ...p, report_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{REPORT_TYPES.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={v => setForm(p => ({ ...p, frequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FREQUENCIES.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Time</Label><Input type="time" value={form.time} onChange={e => setForm(p => ({ ...p, time: e.target.value }))} /></div>
            </div>
            <div><Label>Recipients (comma-separated emails)</Label><Input value={form.recipients} onChange={e => setForm(p => ({ ...p, recipients: e.target.value }))} placeholder="team@company.com, cfo@client.com" data-testid="sr-recipients" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createReport} disabled={saving} data-testid="sr-submit">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Schedule"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
