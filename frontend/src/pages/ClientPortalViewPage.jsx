import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Monitor, Ticket, FileText, DollarSign, CheckCircle, XCircle, AlertTriangle,
  Loader2, Wifi, WifiOff, Shield, HardDrive, Clock, Send, Plus,
  Activity, Users, Server, Laptop
} from "lucide-react";

export default function ClientPortalViewPage() {
  const { token: portalToken } = useParams();
  const [data, setData] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [devices, setDevices] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");
  const [showSubmitTicket, setShowSubmitTicket] = useState(false);
  const [ticketForm, setTicketForm] = useState({ title: "", description: "", priority: "medium" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [summaryRes, invRes, devRes, tktRes] = await Promise.all([
          axios.get(`${API}/portal-api/${portalToken}/summary`),
          axios.get(`${API}/portal-api/${portalToken}/invoices`),
          axios.get(`${API}/portal-api/${portalToken}/devices/health`),
          axios.get(`${API}/portal-api/${portalToken}/tickets`).catch(() => ({ data: [] })),
        ]);
        setData(summaryRes.data);
        setInvoices(invRes.data);
        setDevices(devRes.data);
        setTickets(tktRes.data);
      } catch (e) {
        setError(e.response?.status === 404 ? "Portal link expired or invalid" : "Failed to load portal");
      }
      finally { setLoading(false); }
    };
    fetchAll();
  }, [portalToken]);

  const submitTicket = async () => {
    if (!ticketForm.title.trim()) { toast.error("Title required"); return; }
    setSubmitting(true);
    try {
      await axios.post(`${API}/portal-api/${portalToken}/tickets`, ticketForm);
      toast.success("Ticket submitted! Our team will respond shortly.");
      setShowSubmitTicket(false);
      setTicketForm({ title: "", description: "", priority: "medium" });
      // Refresh tickets
      const tktRes = await axios.get(`${API}/portal-api/${portalToken}/tickets`).catch(() => ({ data: [] }));
      setTickets(tktRes.data);
    } catch { toast.error("Failed to submit ticket"); }
    finally { setSubmitting(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <Card className="max-w-md w-full"><CardContent className="py-12 text-center">
        <XCircle className="w-12 h-12 mx-auto text-red-400 mb-4" />
        <p className="text-lg font-medium">{error}</p>
        <p className="text-sm text-muted-foreground mt-2">Please contact your IT provider for a new portal link.</p>
      </CardContent></Card>
    </div>
  );

  const { client, devices: devStats, tickets: tktStats, invoices: invStats } = data;

  return (
    <div className="min-h-screen bg-background" data-testid="client-portal-view">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{client?.name} — Client Portal</h1>
          <p className="text-sm text-muted-foreground">Welcome to your IT service dashboard</p>
        </div>
        <Button onClick={() => setShowSubmitTicket(true)} data-testid="submit-ticket-btn">
          <Plus className="w-4 h-4 mr-1" />Submit Ticket
        </Button>
      </div>

      <div className="max-w-7xl mx-auto p-6 space-y-5">
        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><Monitor className="w-5 h-5 text-blue-400" /></div>
              <div>
                <p className="text-2xl font-bold">{devStats?.total || 0}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Devices Managed</p>
                <div className="flex gap-2 mt-1 text-[10px]">
                  <span className="text-emerald-400">{devStats?.online || 0} online</span>
                  {devStats?.offline > 0 && <span className="text-red-400">{devStats.offline} offline</span>}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center"><Ticket className="w-5 h-5 text-amber-400" /></div>
              <div>
                <p className="text-2xl font-bold">{tktStats?.open || 0}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Open Tickets</p>
                {tktStats?.critical > 0 && <p className="text-[10px] text-red-400">{tktStats.critical} critical</p>}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-emerald-400" /></div>
              <div>
                <p className="text-2xl font-bold">{invStats?.paid || 0}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Invoices Paid</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${invStats?.outstanding > 0 ? "bg-red-500/10" : "bg-emerald-500/10"} flex items-center justify-center`}>
                <FileText className={`w-5 h-5 ${invStats?.outstanding > 0 ? "text-red-400" : "text-emerald-400"}`} />
              </div>
              <div>
                <p className={`text-2xl font-bold ${invStats?.outstanding > 0 ? "text-amber-400" : ""}`}>${invStats?.outstanding?.toLocaleString() || 0}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Outstanding</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview" data-testid="portal-tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="devices" data-testid="portal-tab-devices">Devices ({devStats?.total || 0})</TabsTrigger>
            <TabsTrigger value="tickets" data-testid="portal-tab-tickets">Tickets ({tickets.length})</TabsTrigger>
            <TabsTrigger value="invoices" data-testid="portal-tab-invoices">Invoices ({invoices.length})</TabsTrigger>
          </TabsList>

          {/* OVERVIEW TAB */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Device Health */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" />Device Health</CardTitle></CardHeader>
                <CardContent>
                  {devStats?.total > 0 ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Uptime</span>
                        <span className="font-bold text-emerald-400">{devStats.total > 0 ? Math.round((devStats.online / devStats.total) * 100) : 0}%</span>
                      </div>
                      <Progress value={devStats.total > 0 ? (devStats.online / devStats.total) * 100 : 0} className="h-3" />
                      <div className="grid grid-cols-3 gap-2 mt-2">
                        <div className="text-center p-2 rounded-lg bg-emerald-500/10"><p className="text-lg font-bold text-emerald-400">{devStats.online}</p><p className="text-[10px] text-muted-foreground">Online</p></div>
                        <div className="text-center p-2 rounded-lg bg-amber-500/10"><p className="text-lg font-bold text-amber-400">{devStats.warning || 0}</p><p className="text-[10px] text-muted-foreground">Warning</p></div>
                        <div className="text-center p-2 rounded-lg bg-red-500/10"><p className="text-lg font-bold text-red-400">{devStats.offline}</p><p className="text-[10px] text-muted-foreground">Offline</p></div>
                      </div>
                    </div>
                  ) : <p className="text-muted-foreground text-sm py-4">No devices configured</p>}
                </CardContent>
              </Card>

              {/* Recent Invoices */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" />Recent Invoices</CardTitle></CardHeader>
                <CardContent>
                  {invoices.length > 0 ? (
                    <div className="space-y-2">
                      {invoices.slice(0, 5).map(inv => (
                        <div key={inv.id} className="flex items-center justify-between p-2 rounded-lg border">
                          <div>
                            <span className="font-mono text-xs font-medium">{inv.invoice_number}</span>
                            <p className="text-[10px] text-muted-foreground">{inv.due_date}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold">${inv.total?.toLocaleString()}</span>
                            <Badge className={inv.payment_status === "paid" ? "bg-emerald-500/10 text-emerald-400" : inv.status === "overdue" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"} variant="outline">
                              {inv.payment_status || inv.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-muted-foreground text-sm py-4">No invoices</p>}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* DEVICES TAB */}
          <TabsContent value="devices" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Type</TableHead><TableHead>OS</TableHead><TableHead>IP</TableHead><TableHead>CPU</TableHead><TableHead>RAM</TableHead><TableHead>Disk</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(devices?.devices || []).map(d => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[9px] capitalize">{d.device_type}</Badge></TableCell>
                        <TableCell className="text-xs">{d.os}</TableCell>
                        <TableCell className="font-mono text-xs">{d.ip_address}</TableCell>
                        <TableCell>{d.cpu_usage ? <span className={d.cpu_usage > 80 ? "text-red-400" : "text-emerald-400"}>{d.cpu_usage}%</span> : "-"}</TableCell>
                        <TableCell>{d.memory_usage ? <span className={d.memory_usage > 80 ? "text-red-400" : "text-emerald-400"}>{d.memory_usage}%</span> : "-"}</TableCell>
                        <TableCell>{d.disk_usage ? <span className={d.disk_usage > 85 ? "text-red-400" : "text-emerald-400"}>{d.disk_usage}%</span> : "-"}</TableCell>
                        <TableCell>
                          <Badge className={d.status === "online" ? "bg-emerald-500/10 text-emerald-400" : d.status === "warning" ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"}>
                            {d.status === "online" ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}{d.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TICKETS TAB */}
          <TabsContent value="tickets" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Assigned</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {tickets.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No tickets</TableCell></TableRow>}
                    {tickets.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.title}</TableCell>
                        <TableCell><Badge className={t.priority === "critical" ? "bg-red-500/10 text-red-400" : t.priority === "high" ? "bg-orange-500/10 text-orange-400" : "bg-zinc-500/10 text-zinc-400"} variant="outline">{t.priority}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="capitalize">{t.status}</Badge></TableCell>
                        <TableCell className="text-xs">{t.assigned_name || "Unassigned"}</TableCell>
                        <TableCell className="text-xs">{t.created_at ? new Date(t.created_at).toLocaleDateString() : ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* INVOICES TAB */}
          <TabsContent value="invoices" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead>Description</TableHead><TableHead>Amount</TableHead><TableHead>Due Date</TableHead><TableHead>Paid</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {invoices.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No invoices</TableCell></TableRow>}
                    {invoices.map(inv => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono font-medium">{inv.invoice_number}</TableCell>
                        <TableCell className="text-xs">{inv.description}</TableCell>
                        <TableCell className="font-mono font-bold">${inv.total?.toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{inv.due_date}</TableCell>
                        <TableCell className="font-mono text-xs">${(inv.amount_paid || 0).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge className={inv.payment_status === "paid" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : inv.status === "overdue" ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"} variant="outline">
                            {inv.payment_status || inv.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Submit Ticket Dialog */}
      <Dialog open={showSubmitTicket} onOpenChange={setShowSubmitTicket}>
        <DialogContent className="max-w-md" aria-describedby="submit-ticket-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Ticket className="w-5 h-5" />Submit a Support Ticket</DialogTitle>
            <DialogDescription id="submit-ticket-desc">Describe your issue and our team will respond promptly</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Subject</Label><Input value={ticketForm.title} onChange={e => setTicketForm(p => ({ ...p, title: e.target.value }))} placeholder="Brief description of the issue" data-testid="portal-ticket-title" /></div>
            <div><Label>Details</Label><Textarea value={ticketForm.description} onChange={e => setTicketForm(p => ({ ...p, description: e.target.value }))} placeholder="Please provide as much detail as possible..." rows={4} /></div>
            <div><Label>Priority</Label>
              <div className="flex gap-2 mt-1">
                {["low", "medium", "high", "critical"].map(p => (
                  <Button key={p} size="sm" variant={ticketForm.priority === p ? "default" : "outline"} onClick={() => setTicketForm(prev => ({ ...prev, priority: p }))} className="capitalize">{p}</Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitTicket(false)}>Cancel</Button>
            <Button onClick={submitTicket} disabled={submitting} data-testid="portal-ticket-submit">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
              Submit Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
