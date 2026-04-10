import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Monitor, Shield, Ticket, FileText, DollarSign, Loader2,
  CheckCircle, Clock, AlertTriangle, Wifi, WifiOff, ChevronRight
} from "lucide-react";

export default function MagicPortalPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios.get(`${API}/magic-portal/access/${token}`).then(r => {
      if (r.data.found) setData(r.data);
      else setError("This link is invalid or has been revoked.");
    }).catch(() => setError("Unable to access portal.")).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="flex items-center justify-center h-screen bg-zinc-950"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;
  if (error) return (
    <div className="flex items-center justify-center h-screen bg-zinc-950">
      <Card className="max-w-md"><CardContent className="py-12 text-center">
        <Shield className="w-12 h-12 mx-auto text-red-400 mb-4" />
        <h2 className="text-xl font-bold mb-2">Access Denied</h2>
        <p className="text-muted-foreground">{error}</p>
      </CardContent></Card>
    </div>
  );

  const { client, tickets, devices, estimates, invoices, contracts, stats } = data;
  const approveEst = async (estId) => {
    try {
      await axios.post(`${API}/magic-portal/access/${token}/approve-estimate/${estId}`);
      toast.success("Estimate approved!");
      window.location.reload();
    } catch { toast.error("Failed to approve"); }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white" data-testid="magic-portal-page">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="text-center py-6">
          <h1 className="text-3xl font-black">Welcome, {client?.name}</h1>
          <p className="text-zinc-400">Your IT Service Portal</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { icon: Ticket, label: "Open Tickets", value: stats.open_tickets, color: "text-blue-400", bg: "bg-blue-500/10" },
            { icon: Monitor, label: "Devices", value: `${stats.online_devices}/${stats.total_devices}`, color: "text-cyan-400", bg: "bg-cyan-500/10" },
            { icon: FileText, label: "Pending Estimates", value: stats.pending_estimates, color: "text-amber-400", bg: "bg-amber-500/10" },
            { icon: DollarSign, label: "Outstanding Invoices", value: stats.outstanding_invoices, color: "text-red-400", bg: "bg-red-500/10" },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <Card key={`k-${i}`}>
                <CardContent className="pt-4 flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center`}><Icon className={`w-6 h-6 ${s.color}`} /></div>
                  <div>
                    <p className="text-xs text-zinc-400">{s.label}</p>
                    <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Tickets */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Ticket className="w-4 h-4 text-blue-400" />Support Tickets</CardTitle></CardHeader>
            <CardContent className="p-0 max-h-80 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Issue</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {tickets.slice(0, 15).map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="text-xs font-mono">{t.ticket_number}</TableCell>
                      <TableCell className="text-sm">{t.title}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${t.status === "resolved" || t.status === "closed" ? "bg-emerald-500/20 text-emerald-400" : t.status === "in_progress" ? "bg-blue-500/20 text-blue-400" : "bg-amber-500/20 text-amber-400"}`}>
                          {t.status?.replace("_", " ")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Devices */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Monitor className="w-4 h-4 text-cyan-400" />Your Devices</CardTitle></CardHeader>
            <CardContent className="p-0 max-h-80 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {devices.map(d => (
                    <TableRow key={d.id}>
                      <TableCell className="text-sm font-medium">{d.hostname}</TableCell>
                      <TableCell className="text-xs">{d.device_type}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {d.status === "online" ? <Wifi className="w-3 h-3 text-emerald-400" /> : <WifiOff className="w-3 h-3 text-red-400" />}
                          <span className={`text-xs ${d.status === "online" ? "text-emerald-400" : "text-red-400"}`}>{d.status}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Estimates for approval */}
        {estimates.length > 0 && (
          <Card className="border-amber-500/20">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-400">Estimates Pending Your Approval</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {estimates.map(e => (
                <div key={e.id} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg border border-border/30">
                  <div>
                    <p className="text-sm font-medium">{e.estimate_number} - {e.title}</p>
                    <p className="text-xs text-muted-foreground">${e.total?.toLocaleString()}</p>
                  </div>
                  <Button size="sm" onClick={() => approveEst(e.id)} data-testid={`approve-est-${e.id}`}>
                    <CheckCircle className="w-3 h-3 mr-1" />Approve
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Contracts */}
        {contracts.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Active Contracts</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {contracts.map((c, i) => (
                <div key={`k-${i}`} className="flex items-center justify-between p-2 bg-muted/10 rounded">
                  <span className="text-sm">{c.name} ({c.type})</span>
                  <span className="text-sm font-bold">${c.value}/{c.billing_cycle}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
