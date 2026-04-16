import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  CreditCard, DollarSign, Users, Send, ExternalLink, Bell,
  CheckCircle, AlertTriangle, Loader2, TrendingUp, Copy, RefreshCw
} from "lucide-react";

export default function StripeBillingPortalPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [cRes, sRes] = await Promise.all([
        axios.get(`${API}/billing-portal/clients`, { headers }),
        axios.get(`${API}/billing-portal/stats`, { headers }),
      ]);
      setClients(cRes.data);
      setStats(sRes.data);
    } catch { toast.error("Failed to load billing data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const createPortalLink = async (clientId, clientName) => {
    try {
      const res = await axios.post(`${API}/billing-portal/clients/${clientId}/create-portal-link`, {}, { headers });
      navigator.clipboard.writeText(res.data.url);
      toast.success(`Portal link for ${clientName} copied to clipboard`);
    } catch { toast.error("Failed to create portal link"); }
  };

  const sendReminder = async (clientId) => {
    try {
      const res = await axios.post(`${API}/billing-portal/send-reminder`, { client_id: clientId }, { headers });
      toast.success(res.data.message);
    } catch { toast.error("Failed to send reminder"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="stripe-billing-portal-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><CreditCard className="w-6 h-6 text-violet-400" />Customer Billing Portal</h1>
          <p className="text-muted-foreground mt-1">Manage client billing, send reminders, and generate self-service portal links</p>
        </div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      {stats && (
        <div className="grid grid-cols-6 gap-3">
          {[
            { label: "Total Clients", value: stats.total_clients, icon: Users, color: "text-blue-400", bg: "bg-blue-500/10" },
            { label: "Total Revenue", value: `$${stats.total_revenue?.toLocaleString()}`, icon: DollarSign, color: "text-emerald-400", bg: "bg-emerald-500/10" },
            { label: "Outstanding", value: `$${stats.outstanding?.toLocaleString()}`, icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10" },
            { label: "Overdue", value: `$${stats.overdue?.toLocaleString()}`, icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10" },
            { label: "Collection Rate", value: `${stats.collection_rate}%`, icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10" },
            { label: "Reminders Sent", value: stats.reminders_sent, icon: Bell, color: "text-violet-400", bg: "bg-violet-500/10" },
          ].map((s, i) => (
            <Card key={`s-${i}`}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon className={`w-4 h-4 ${s.color}`} /></div>
                <div><p className="text-lg font-bold">{s.value}</p><p className="text-[9px] text-muted-foreground uppercase tracking-wider">{s.label}</p></div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Clients Billing Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Client Billing Status</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>MRR</TableHead>
                <TableHead>Invoices</TableHead>
                <TableHead>Outstanding</TableHead>
                <TableHead>Overdue</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map(c => (
                <TableRow key={c.id} data-testid={`billing-client-${c.id}`}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.email}</TableCell>
                  <TableCell className="font-mono text-sm">${(c.mrr || 0).toLocaleString()}</TableCell>
                  <TableCell>{c.total_invoices}</TableCell>
                  <TableCell>
                    {c.outstanding_amount > 0 ? (
                      <span className="text-amber-400 font-mono">${c.outstanding_amount.toLocaleString()}</span>
                    ) : <span className="text-emerald-400 text-xs">All paid</span>}
                  </TableCell>
                  <TableCell>
                    {c.overdue_count > 0 ? (
                      <Badge className="bg-red-500/10 text-red-400 text-[9px]">{c.overdue_count} overdue</Badge>
                    ) : <CheckCircle className="w-4 h-4 text-emerald-400" />}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => createPortalLink(c.id, c.name)} title="Create Portal Link">
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                      {c.outstanding_amount > 0 && (
                        <Button size="sm" variant="ghost" onClick={() => sendReminder(c.id)} title="Send Reminder">
                          <Send className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
