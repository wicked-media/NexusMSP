import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import HeroTile from "@/components/HeroTile";
import {
  CreditCard, DollarSign, Users, Send, ExternalLink, Bell,
  CheckCircle, AlertTriangle, Loader2, TrendingUp, RefreshCw
} from "lucide-react";

export default function StripeBillingPortalPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState(null);
  const [portalConfig, setPortalConfig] = useState(null);
  const [reminderClientId, setReminderClientId] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const portalReady = Boolean(portalConfig?.stripe_configured && portalConfig?.enabled);

  const fetchData = useCallback(async () => {
    try {
      const [cRes, sRes, configRes] = await Promise.all([
        axios.get(`${API}/billing-portal/clients`, { headers }),
        axios.get(`${API}/billing-portal/stats`, { headers }),
        axios.get(`${API}/billing-portal/config`, { headers }),
      ]);
      setClients(cRes.data);
      setStats(sRes.data);
      setPortalConfig(configRes.data);
    } catch { toast.error("Failed to load billing data"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const createPortalLink = async (clientId, clientName) => {
    try {
      const res = await axios.post(`${API}/billing-portal/clients/${clientId}/create-portal-link`, {}, { headers });
      navigator.clipboard.writeText(res.data.url);
      toast.success(`Portal link for ${clientName} copied to clipboard`);
    } catch (error) { toast.error(error.response?.data?.detail || "Failed to create portal link"); }
  };

  const sendReminder = async (clientId) => {
    if (reminderClientId) return;
    setReminderClientId(clientId);
    try {
      const res = await axios.post(`${API}/billing-portal/send-reminder`, { client_id: clientId }, { headers });
      if (res.data.sent) toast.success(res.data.message);
      else toast.warning(res.data.message || `Reminder ${res.data.delivery_status || "was not delivered"}`);
      fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || "Failed to send reminder"); }
    finally { setReminderClientId(null); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="stripe-billing-portal-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center"><CreditCard className="w-4 h-4 text-violet-300" /></span>
          <div><div className="flex items-center gap-2"><h1 className="text-2xl font-bold tracking-tight">Customer Billing Portal</h1><Badge variant="outline" className={portalReady ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-400"}>{portalReady ? "Portal live" : portalConfig?.stripe_configured ? "Portal disabled" : "Stripe setup required"}</Badge></div><p className="text-sm text-muted-foreground">Self-service payments, client reminders, and billing access.</p></div>
        </div>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => navigate("/invoices")} data-testid="portal-go-invoices"><DollarSign className="w-4 h-4 mr-1" />Invoices</Button><Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button></div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <HeroTile label="Portal clients" value={stats.total_clients || 0} icon={Users} glow="cyan" testId="portal-metric-clients" />
          <HeroTile label="Total revenue" value={`$${(stats.total_revenue || 0).toLocaleString()}`} icon={DollarSign} glow="emerald" animated={false} onClick={() => navigate("/invoices")} testId="portal-metric-revenue" />
          <HeroTile label="Outstanding" value={`$${(stats.outstanding || 0).toLocaleString()}`} icon={AlertTriangle} glow={(stats.outstanding || 0) > 0 ? "amber" : "emerald"} animated={false} onClick={() => navigate("/invoices")} testId="portal-metric-outstanding" />
          <HeroTile label="Overdue" value={`$${(stats.overdue || 0).toLocaleString()}`} icon={AlertTriangle} glow={(stats.overdue || 0) > 0 ? "rose" : "emerald"} animated={false} onClick={() => navigate("/invoices")} testId="portal-metric-overdue" />
          <HeroTile label="Collection rate" value={stats.collection_rate || 0} suffix="%" icon={TrendingUp} glow="emerald" testId="portal-metric-rate" />
          <HeroTile label="Reminders delivered" value={stats.reminders_sent || 0} icon={Bell} glow={(stats.reminder_delivery_issues || 0) > 0 ? "amber" : "violet"} subtitle={(stats.reminder_delivery_issues || 0) > 0 ? `${stats.reminder_delivery_issues} need attention` : `${stats.reminder_attempts || 0} attempt(s)`} testId="portal-metric-reminders" />
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
                      <Button size="sm" variant="ghost" onClick={() => createPortalLink(c.id, c.name)} disabled={!portalReady} title={!portalConfig?.stripe_configured ? "Connect Stripe to create customer portal links" : !portalConfig?.enabled ? "Enable the customer billing portal before creating links" : "Create Portal Link"}>
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                      {c.outstanding_amount > 0 && (
                        <Button size="sm" variant="ghost" disabled={Boolean(reminderClientId)} onClick={() => sendReminder(c.id)} title="Send Reminder">
                          {reminderClientId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
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
