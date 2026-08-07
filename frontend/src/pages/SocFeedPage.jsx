import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2, AlertTriangle, Activity, Search,
  Ticket, Lock, CheckCircle, XCircle, Clock, Eye, Wrench, RefreshCw, Zap
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const SEV = {
  critical: { class: "bg-red-500/20 text-red-400 border-red-500/30", dot: "bg-red-500" },
  high: { class: "bg-orange-500/20 text-orange-400 border-orange-500/30", dot: "bg-orange-500" },
  medium: { class: "bg-amber-500/20 text-amber-400 border-amber-500/30", dot: "bg-amber-500" },
  low: { class: "bg-blue-500/20 text-blue-400 border-blue-500/30", dot: "bg-blue-500" },
};

const STATUS_CONFIG = {
  new: { label: "New", class: "bg-red-500/20 text-red-400", icon: AlertTriangle },
  investigating: { label: "Investigating", class: "bg-amber-500/20 text-amber-400", icon: Eye },
  remediated: { label: "Remediated", class: "bg-green-500/20 text-green-400", icon: CheckCircle },
  closed: { label: "Closed", class: "bg-gray-500/20 text-gray-400", icon: XCircle },
};

export default function SocFeedPage() {
  const { token } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [ticketDialog, setTicketDialog] = useState(false);
  const [ticketForm, setTicketForm] = useState({ title: "", description: "", priority: "high" });
  const [remediateDialog, setRemediateDialog] = useState(false);
  const [remediateNotes, setRemediateNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const [socRes, huntRes, huntStatusRes] = await Promise.all([
        axios.get(`${API}/soc/alerts`, { headers }),
        axios.get(`${API}/huntress/incident-reports?limit=500`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/huntress/status`, { headers }).catch(() => ({ data: { configured: false } })),
      ]);
      const socList = socRes.data || [];
      if (huntStatusRes.data?.configured && Array.isArray(huntRes.data) && huntRes.data.length > 0) {
        // Normalise Huntress incidents into the SOC alert shape
        const huntAlerts = huntRes.data.map((i) => ({
          id: `hunt-${i.id}`,
          title: i.summary || i.title || "Huntress incident",
          description: i.description || i.summary || "",
          severity: (i.severity || "low").toLowerCase(),
          status: ["resolved", "closed"].includes((i.status || "").toLowerCase()) ? "remediated" : "new",
          hostname: i.agent_hostname || i.hostname || "—",
          organization: i.organization_name || i.organization_id || "—",
          created_at: i.detected_at || i.created_at,
          source: "huntress",
          _raw_id: i.id,
        }));
        setAlerts([...huntAlerts, ...socList]);
      } else {
        setAlerts(socList);
      }
    } catch { toast.error("Failed to load alerts"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const handleAcknowledge = async (alertId) => {
    setActionLoading(alertId);
    try {
      await axios.post(`${API}/soc/alerts/${alertId}/acknowledge`, {}, { headers });
      toast.success("Alert acknowledged");
      fetchAlerts();
    } catch { toast.error("Failed"); }
    finally { setActionLoading(null); }
  };

  const handleCreateTicket = async () => {
    if (!selectedAlert) return;
    try {
      const res = await axios.post(`${API}/soc/alerts/${selectedAlert.id}/create-ticket`, ticketForm, { headers });
      toast.success(`Ticket ${res.data.ticket_number} created`);
      setTicketDialog(false);
      fetchAlerts();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleIsolate = async (alert) => {
    if (alert.source !== "huntress") {
      toast.info("Endpoint isolation requires a configured EDR integration. No isolation command was sent.");
      return;
    }
    setActionLoading(alert.id);
    try {
      const res = await axios.post(`${API}/huntress/agents/${alert._raw_id || alert.hostname}/isolate`, {}, { headers });
      if (res.data?.success) toast.success(`${alert.hostname} isolated via Huntress`);
      else toast.error(`Huntress rejected: ${res.data?.message || "not supported"}`, { duration: 6000 });
      fetchAlerts();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setActionLoading(null); }
  };

  const handleRemediate = async () => {
    if (!selectedAlert) return;
    try {
      await axios.post(`${API}/soc/alerts/${selectedAlert.id}/remediate`, { notes: remediateNotes }, { headers });
      toast.success("Alert remediated");
      setRemediateDialog(false);
      fetchAlerts();
    } catch { toast.error("Failed"); }
  };

  const handleClose = async (alertId) => {
    try {
      await axios.post(`${API}/soc/alerts/${alertId}/close`, { reason: "Resolved" }, { headers });
      toast.success("Alert closed");
      fetchAlerts();
    } catch { toast.error("Failed"); }
  };

  const filtered = alerts
    .filter(a => sevFilter === "all" || a.severity === sevFilter)
    .filter(a => statusFilter === "all" || a.status === statusFilter)
    .filter(a => !search || a.title?.toLowerCase().includes(search.toLowerCase()) || a.hostname?.toLowerCase().includes(search.toLowerCase()));

  const counts = {
    critical: alerts.filter(a => a.severity === "critical" && a.status !== "closed").length,
    high: alerts.filter(a => a.severity === "high" && a.status !== "closed").length,
    open: alerts.filter(a => ["new", "investigating"].includes(a.status)).length,
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="soc-feed">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">SOC Alert Feed</h1>
          <p className="text-muted-foreground">{alerts.length} persisted alerts{alerts.some(alert => alert.source === "huntress") ? " and connected Huntress incidents" : ""}</p>
        </div>
        <Button variant="outline" onClick={fetchAlerts}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      {/* Summary Bar */}
      <div className="flex gap-3">
        <Card className="flex-1 border-red-500/20"><CardContent className="pt-3 pb-2 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /><span className="text-xs text-muted-foreground">Critical</span><span className="text-lg font-bold text-red-400 ml-auto">{counts.critical}</span></CardContent></Card>
        <Card className="flex-1 border-orange-500/20"><CardContent className="pt-3 pb-2 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-orange-500" /><span className="text-xs text-muted-foreground">High</span><span className="text-lg font-bold text-orange-400 ml-auto">{counts.high}</span></CardContent></Card>
        <Card className="flex-1"><CardContent className="pt-3 pb-2 flex items-center gap-2"><Activity className="w-4 h-4 text-amber-400" /><span className="text-xs text-muted-foreground">Open</span><span className="text-lg font-bold ml-auto">{counts.open}</span></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search alerts..." value={search} onChange={e => setSearch(e.target.value)} data-testid="alert-search" /></div>
        <Select value={sevFilter} onValueChange={setSevFilter}><SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Severity</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="new">New</SelectItem><SelectItem value="investigating">Investigating</SelectItem><SelectItem value="remediated">Remediated</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent></Select>
      </div>

      {/* Alert List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No alerts match your filters</CardContent></Card>
        ) : filtered.map(alert => {
          const StatusIcon = STATUS_CONFIG[alert.status]?.icon || Clock;
          return (
            <Card key={alert.id} className={`transition-all hover:bg-muted/30 ${alert.severity === "critical" && alert.status === "new" ? "border-red-500/30 bg-red-500/5" : ""}`} data-testid={`alert-${alert.id}`}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${SEV[alert.severity]?.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{alert.title}</span>
                      <Badge className={SEV[alert.severity]?.class + " text-[10px]"}>{alert.severity}</Badge>
                      <Badge className={STATUS_CONFIG[alert.status]?.class + " text-[10px]"}><StatusIcon className="w-3 h-3 mr-1" />{STATUS_CONFIG[alert.status]?.label}</Badge>
                      {alert.source && <Badge variant="outline" className="text-[10px] text-muted-foreground">{alert.source === "huntress" ? "Huntress" : "NexusMSP"}</Badge>}
                      {alert.mitre_attack && <Badge variant="outline" className="text-[10px] font-mono">{alert.mitre_attack}</Badge>}
                      {alert.ticket_number && <Badge variant="outline" className="text-[10px] text-green-400 border-green-500/30"><Ticket className="w-3 h-3 mr-1" />{alert.ticket_number}</Badge>}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-[11px] text-muted-foreground">
                      <span className="font-mono">{alert.hostname}</span>
                      <span>{alert.organization}</span>
                      <span>{alert.created_at ? formatDistanceToNow(new Date(alert.created_at), { addSuffix: true }) : ""}</span>
                      {alert.assigned_to && <span className="text-blue-400">Assigned: {alert.assigned_to}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {alert.status === "new" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleAcknowledge(alert.id)} disabled={actionLoading === alert.id} data-testid={`ack-${alert.id}`}>
                        <Eye className="w-3 h-3 mr-1" />Ack
                      </Button>
                    )}
                    {!alert.ticket_id && !alert.ticket_number && (
                      <Button size="sm" variant="outline" className="h-7 text-xs text-blue-400 border-blue-500/30" onClick={() => {
                        setSelectedAlert(alert);
                        setTicketForm({ title: `[SOC] ${alert.title}`, description: `${alert.description || ""}\n\nHost: ${alert.hostname}\nSeverity: ${alert.severity}\nMITRE: ${alert.mitre_attack || "N/A"}`, priority: alert.severity === "critical" ? "critical" : "high" });
                        setTicketDialog(true);
                      }} data-testid={`create-ticket-${alert.id}`}>
                        <Ticket className="w-3 h-3 mr-1" />Ticket
                      </Button>
                    )}
                    {alert.source === "huntress" && ["new", "investigating"].includes(alert.status) && (
                      <Button size="sm" variant="outline" className="h-7 text-xs text-purple-400 border-purple-500/30" onClick={() => handleIsolate(alert)} disabled={actionLoading === alert.id} data-testid={`isolate-${alert.id}`}>
                        <Lock className="w-3 h-3 mr-1" />Isolate
                      </Button>
                    )}
                    {alert.status === "investigating" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs text-green-400 border-green-500/30" onClick={() => { setSelectedAlert(alert); setRemediateNotes(""); setRemediateDialog(true); }} data-testid={`remediate-${alert.id}`}>
                        <Wrench className="w-3 h-3 mr-1" />Fix
                      </Button>
                    )}
                    {alert.status === "remediated" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleClose(alert.id)} data-testid={`close-${alert.id}`}>
                        <CheckCircle className="w-3 h-3 mr-1" />Close
                      </Button>
                    )}
                  </div>
                </div>
                {alert.remediation_steps && alert.status !== "closed" && (
                  <div className="mt-2 ml-5 p-2 rounded bg-muted/20 border border-dashed">
                    <p className="text-[10px] font-semibold text-muted-foreground mb-1">Recommended Actions:</p>
                    <ul className="text-[11px] space-y-0.5 text-muted-foreground">{(alert.remediation_steps || []).map((s, i) => <li key={`k-${i}`} className="flex items-start gap-1"><Zap className="w-3 h-3 mt-0.5 text-amber-400 flex-shrink-0" />{s}</li>)}</ul>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Create Ticket Dialog */}
      <Dialog open={ticketDialog} onOpenChange={setTicketDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Ticket className="w-5 h-5 text-blue-400" />Create Ticket from Alert</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title</Label><Input value={ticketForm.title} onChange={e => setTicketForm({ ...ticketForm, title: e.target.value })} data-testid="ticket-title" /></div>
            <div><Label>Description</Label><Textarea value={ticketForm.description} onChange={e => setTicketForm({ ...ticketForm, description: e.target.value })} rows={4} /></div>
            <div><Label>Priority</Label>
              <Select value={ticketForm.priority} onValueChange={v => setTicketForm({ ...ticketForm, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreateTicket} className="bg-blue-600 hover:bg-blue-700" data-testid="confirm-create-ticket"><Ticket className="w-4 h-4 mr-1" />Create Ticket</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remediate Dialog */}
      <Dialog open={remediateDialog} onOpenChange={setRemediateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Wrench className="w-5 h-5 text-green-400" />Remediate Alert</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {selectedAlert && <div className="p-3 rounded-lg bg-muted/30 border text-sm"><p className="font-medium">{selectedAlert.title}</p><p className="text-xs text-muted-foreground mt-1">{selectedAlert.hostname} - {selectedAlert.severity}</p></div>}
            <div><Label>Remediation Notes</Label><Textarea value={remediateNotes} onChange={e => setRemediateNotes(e.target.value)} rows={3} placeholder="Describe actions taken..." /></div>
          </div>
          <DialogFooter><Button onClick={handleRemediate} className="bg-green-600 hover:bg-green-700" data-testid="confirm-remediate"><CheckCircle className="w-4 h-4 mr-1" />Mark Remediated</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
