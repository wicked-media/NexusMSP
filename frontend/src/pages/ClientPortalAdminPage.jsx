import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Users, Settings, Eye, FileText, Shield, Plus } from "lucide-react";
import { toast } from "sonner";

export default function ClientPortalAdminPage() {
  const { token } = useAuth();
  const [config, setConfig] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [cRes, lRes] = await Promise.all([
          axios.get(`${API}/client-portal/config`, { headers }),
          axios.get(`${API}/client-portal/access-logs`, { headers }),
        ]);
        setConfig(cRes.data);
        setLogs(lRes.data);
      } catch (e) { toast.error("Failed to load portal config"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  const toggleFeature = async (key, value) => {
    const updated = { ...config, [key]: value };
    setConfig(updated);
    try {
      await axios.put(`${API}/client-portal/config`, { [key]: value }, { headers });
      toast.success("Setting updated");
    } catch (e) { toast.error("Failed to update"); }
  };

  if (loading || !config) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const actionLabels = { viewed_tickets: "Viewed Tickets", created_ticket: "Created Ticket", approved_estimate: "Approved Estimate", viewed_invoices: "Viewed Invoices", downloaded_report: "Downloaded Report" };

  return (
    <div className="space-y-6" data-testid="client-portal-admin-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Client Portal</h1><p className="text-muted-foreground text-sm mt-1">Configure and manage your branded client-facing portal</p></div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-5 flex items-center gap-3"><div className="p-2 rounded-lg bg-primary/10"><Users className="w-5 h-5 text-primary" /></div><div><p className="text-2xl font-bold">{logs.length}</p><p className="text-xs text-muted-foreground">Recent Activities</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><div className="p-2 rounded-lg bg-emerald-500/10"><Shield className="w-5 h-5 text-emerald-500" /></div><div><p className="text-2xl font-bold">{config.enabled ? "Active" : "Disabled"}</p><p className="text-xs text-muted-foreground">Portal Status</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><div className="p-2 rounded-lg bg-blue-500/10"><Eye className="w-5 h-5 text-blue-500" /></div><div><p className="text-2xl font-bold">{Object.values(config.features || {}).filter(Boolean).length}</p><p className="text-xs text-muted-foreground">Features Enabled</p></div></CardContent></Card>
      </div>

      {/* Portal Settings */}
      <Card><CardHeader><CardTitle className="text-lg flex items-center gap-2"><Settings className="w-5 h-5" />Portal Features</CardTitle></CardHeader>
        <CardContent><div className="space-y-4">
          {[
            { key: "allow_ticket_creation", label: "Allow clients to create tickets", desc: "Clients can submit support requests directly" },
            { key: "allow_ticket_viewing", label: "Allow clients to view tickets", desc: "Clients can track their ticket status" },
            { key: "allow_estimate_approval", label: "Allow estimate approval", desc: "Clients can approve/reject estimates online" },
            { key: "allow_invoice_viewing", label: "Allow invoice viewing", desc: "Clients can view and download invoices" },
            { key: "allow_asset_viewing", label: "Allow asset viewing", desc: "Clients can see their managed assets" },
          ].map(item => (
            <div key={item.key} className="flex items-center justify-between p-3 rounded-lg border" data-testid={`toggle-${item.key}`}>
              <div><p className="font-medium text-sm">{item.label}</p><p className="text-xs text-muted-foreground">{item.desc}</p></div>
              <Switch checked={config[item.key]} onCheckedChange={(v) => toggleFeature(item.key, v)} />
            </div>
          ))}
        </div></CardContent>
      </Card>

      {/* Recent Activity */}
      <Card><CardHeader><CardTitle className="text-lg">Recent Portal Activity</CardTitle></CardHeader>
        <CardContent><div className="space-y-2">
          {logs.map(l => (
            <div key={l.id} className="flex items-center justify-between p-2 rounded border-b border-border/30" data-testid={`log-${l.id}`}>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-[10px]">{l.client_name}</Badge>
                <span className="text-sm">{l.user_email}</span>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="text-[10px]">{actionLabels[l.action] || l.action}</Badge>
                <span className="text-xs text-muted-foreground">{new Date(l.timestamp).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div></CardContent>
      </Card>
    </div>
  );
}
