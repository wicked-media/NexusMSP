import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import HeroTile from "@/components/HeroTile";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Calendar, Plus, Trash2, Play, FileText,
  Send, Loader2, Eye
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

export default function ScheduledReportsPage({ embedded = false }) {
  const navigate = useNavigate();
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showOutputs, setShowOutputs] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [outputs, setOutputs] = useState([]);
  const [loadingOutputs, setLoadingOutputs] = useState(false);
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
  }, [headers]);

  useEffect(() => {
    if (embedded) fetchData();
  }, [embedded, fetchData]);
  useEffect(() => {
    if (!embedded) navigate("/reports?tab=delivery", { replace: true });
  }, [embedded, navigate]);

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

  const generateNow = async (id) => {
    try {
      const res = await axios.post(`${API}/scheduled-reports/${id}/send-now`, {}, { headers });
      toast.success(res.data.message);
      fetchData();
    } catch { toast.error("Failed to generate report snapshot"); }
  };

  const viewOutputs = async (report) => {
    setSelectedSchedule(report);
    setShowOutputs(true);
    setLoadingOutputs(true);
    try {
      const res = await axios.get(`${API}/scheduled-reports/${report.id}/outputs`, { headers });
      setOutputs(res.data);
    } catch {
      toast.error("Failed to load generated snapshots");
      setOutputs([]);
    } finally { setLoadingOutputs(false); }
  };

  const deleteReport = async (id) => {
    if (!window.confirm("Delete this scheduled report?")) return;
    try {
      await axios.delete(`${API}/scheduled-reports/${id}`, { headers });
      toast.success("Report deleted");
      fetchData();
    } catch { toast.error("Failed to delete"); }
  };

  if (!embedded) return null;
  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="scheduled-reports-page">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><h2 className="text-lg font-semibold">Scheduled delivery</h2><p className="mt-1 text-sm text-muted-foreground">Generate retained evidence snapshots on a cadence. O365 dispatch becomes available when a mailbox route is configured.</p></div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-report-btn"><Plus className="w-4 h-4 mr-1" />New schedule</Button>
      </div>

      {stats && (
        <div className="grid gap-3 sm:grid-cols-3">
          <HeroTile label="Scheduled reports" value={stats.total || 0} icon={FileText} glow="sky" subtitle="Configured evidence cadences" />
          <HeroTile label="Active schedules" value={stats.active || 0} icon={Play} glow="emerald" subtitle="Currently ready to run" />
          <HeroTile label="Snapshots generated" value={stats.total_sent || 0} icon={Send} glow="violet" subtitle="Retained audit evidence" />
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
                <TableHead>Last generated</TableHead>
                <TableHead>Snapshots</TableHead>
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
                      <Button size="sm" variant="ghost" title="Generate report snapshot" data-testid={`generate-report-${r.id}`} onClick={() => generateNow(r.id)}><FileText className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" title="View generated snapshots" data-testid={`view-outputs-${r.id}`} onClick={() => viewOutputs(r)}><Eye className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" title="Delete schedule" data-testid={`delete-report-${r.id}`} className="text-red-400" onClick={() => deleteReport(r.id)}><Trash2 className="w-3 h-3" /></Button>
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
            <DialogDescription id="create-sr-desc">Set up a recurring evidence snapshot. O365 delivery can be enabled when a mailbox route is configured.</DialogDescription>
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

      <Dialog open={showOutputs} onOpenChange={setShowOutputs}>
        <DialogContent className="max-w-3xl" aria-describedby="output-snapshots-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-blue-400" />Generated report snapshots</DialogTitle>
            <DialogDescription id="output-snapshots-desc">Evidence retained for {selectedSchedule?.name || "this schedule"}. These records show the data captured at generation time.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto space-y-3" data-testid="generated-snapshots">
            {loadingOutputs && <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>}
            {!loadingOutputs && outputs.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No snapshots have been generated yet.</p>}
            {!loadingOutputs && outputs.map(output => {
              const summary = output.sections?.summary || {};
              const billing = output.sections?.billing || {};
              return <Card key={output.id} className="border-border/70" data-testid={`output-${output.id}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div><p className="font-medium text-sm">{new Date(output.generated_at).toLocaleString()}</p><p className="text-xs text-muted-foreground">Generated by {output.generated_by || "System"} · {output.scope?.period || "Current system snapshot"}</p></div>
                    <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">Retained</Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="rounded-lg bg-muted/45 p-2"><span className="text-muted-foreground block">Tickets</span><strong>{summary.tickets_total ?? "—"}</strong></div>
                    <div className="rounded-lg bg-muted/45 p-2"><span className="text-muted-foreground block">Devices online</span><strong>{summary.devices_online ?? "—"}</strong></div>
                    <div className="rounded-lg bg-muted/45 p-2"><span className="text-muted-foreground block">Active alerts</span><strong>{summary.active_alerts ?? "—"}</strong></div>
                    <div className="rounded-lg bg-muted/45 p-2"><span className="text-muted-foreground block">Outstanding</span><strong>{billing.outstanding !== undefined ? `$${Number(billing.outstanding).toLocaleString()}` : "—"}</strong></div>
                  </div>
                </CardContent>
              </Card>;
            })}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowOutputs(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
