import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, HardDrive, Shield, CheckCircle, XCircle, AlertTriangle, Clock, Database, RefreshCw, Link2, Users, Bell } from "lucide-react";

export default function BackupCommandCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("overview");
  const [connected, setConnected] = useState(null);
  const [usageSummary, setUsageSummary] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    try {
      const [configRes, summaryRes, custRes, alertRes] = await Promise.all([
        axios.get(`${API}/acronis/config`, { headers }).catch(() => ({ data: { connected: false } })),
        axios.get(`${API}/acronis/usage-summary`, { headers }).catch(() => ({ data: {} })),
        axios.get(`${API}/acronis/customers`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/acronis/alerts`, { headers }).catch(() => ({ data: { items: [] } })),
      ]);
      setConnected(configRes.data?.connected);
      setUsageSummary(summaryRes.data);
      setCustomers(Array.isArray(custRes.data) ? custRes.data : []);
      setAlerts(alertRes.data?.items || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await axios.post(`${API}/acronis/sync`, {}, { headers });
      toast.success(`Synced: ${res.data.tenants_synced} tenants, ${res.data.resources_synced} resources`);
      fetchAll();
    } catch { toast.error("Sync failed"); }
    finally { setSyncing(false); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const s = usageSummary || {};
  const critAlerts = alerts.filter(a => ["critical", "error"].includes(a.severity));

  return (
    <div className="space-y-5" data-testid="backup-command-center">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Backup Command Center</h1>
          <p className="text-sm text-muted-foreground">
            Acronis Cyber Cloud integration — {connected ?
              <span className="text-emerald-400">Connected ({s.data_source === "live" ? "Live" : "Cached"})</span> :
              <span className="text-red-400">Not Connected</span>}
          </p>
        </div>
        <Button onClick={handleSync} disabled={syncing} data-testid="sync-acronis-btn">
          {syncing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}Sync Acronis
        </Button>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Card><CardContent className="pt-4 pb-3"><Users className="w-5 h-5 text-blue-400 mb-1" /><p className="text-2xl font-bold">{s.total_tenants || customers.length || 0}</p><p className="text-[11px] text-muted-foreground">Customer Tenants</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><HardDrive className="w-5 h-5 text-violet-400 mb-1" /><p className="text-2xl font-bold">{s.total_resources || 0}</p><p className="text-[11px] text-muted-foreground">Protected Resources</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><CheckCircle className="w-5 h-5 text-emerald-400 mb-1" /><p className="text-2xl font-bold text-emerald-400">{s.protection_rate || 0}%</p><p className="text-[11px] text-muted-foreground">Protection Rate</p></CardContent></Card>
        <Card className={s.failed_resources > 0 ? "border-red-500/20" : ""}><CardContent className="pt-4 pb-3"><XCircle className="w-5 h-5 text-red-400 mb-1" /><p className="text-2xl font-bold text-red-400">{s.failed_resources || 0}</p><p className="text-[11px] text-muted-foreground">Failed Backups</p></CardContent></Card>
        <Card className={critAlerts.length > 0 ? "border-amber-500/20" : ""}><CardContent className="pt-4 pb-3"><Bell className="w-5 h-5 text-amber-400 mb-1" /><p className="text-2xl font-bold text-amber-400">{s.total_alerts || alerts.length || 0}</p><p className="text-[11px] text-muted-foreground">Active Alerts</p></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="overview"><HardDrive className="w-3 h-3 mr-1" />Customer Tenants ({customers.length})</TabsTrigger>
          <TabsTrigger value="alerts"><Bell className="w-3 h-3 mr-1" />Alerts ({alerts.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Acronis Tenant</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Linked Client</TableHead>
              <TableHead>Devices</TableHead>
              <TableHead>Storage</TableHead>
              <TableHead>Last Sync</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {customers.map((c, i) => (
                <TableRow key={c.id || i} data-testid={`tenant-${c.acronis_tenant_id || c.id}`}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px] capitalize">{c.kind || "customer"}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={c.enabled !== false ? "default" : "destructive"} className="text-[10px]">
                      {c.enabled !== false ? "Active" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell>{c.linked_client_name ? <span className="text-sm">{c.linked_client_name}</span> : <span className="text-xs text-muted-foreground">Not linked</span>}</TableCell>
                  <TableCell className="text-sm">{c.total_devices || c.protected_devices || "—"}</TableCell>
                  <TableCell className="text-sm">{c.storage_used_gb ? `${c.storage_used_gb} GB` : "—"}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">{c.last_sync ? c.last_sync.slice(0, 16).replace("T", " ") : "Never"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {customers.length === 0 && <p className="text-center text-muted-foreground py-8">No tenants found. Click "Sync Acronis" to pull data.</p>}
        </TabsContent>

        <TabsContent value="alerts">
          {alerts.length > 0 ? (
            <div className="space-y-2">
              {alerts.map((alert, i) => {
                const details = alert.details || {};
                const severity = alert.severity || details.severity || "info";
                const category = details.category || alert.type || "";
                const desc = details.description || "";
                const fields = details.fields || {};
                return (
                  <Card key={alert.id || i} className={severity === "critical" || severity === "error" ? "border-red-500/30" : severity === "warning" ? "border-amber-500/20" : ""}>
                    <CardContent className="py-3">
                      <div className="flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${severity === "critical" || severity === "error" ? "bg-red-500/15" : severity === "warning" ? "bg-amber-500/15" : "bg-blue-500/15"}`}>
                          <AlertTriangle className={`w-4 h-4 ${severity === "critical" || severity === "error" ? "text-red-400" : severity === "warning" ? "text-amber-400" : "text-blue-400"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <Badge variant={severity === "critical" || severity === "error" ? "destructive" : "secondary"} className="text-[9px] capitalize">{severity}</Badge>
                            {category && <span className="text-xs text-muted-foreground">{category}</span>}
                          </div>
                          <p className="text-sm">{desc}</p>
                          {fields.Subject && <p className="text-[11px] text-muted-foreground mt-0.5">Subject: {fields.Subject}</p>}
                          {fields.Recipient && <p className="text-[11px] text-muted-foreground">To: {fields.Recipient}</p>}
                          {fields.Status && <Badge variant="outline" className="text-[9px] mt-1">{fields.Status}</Badge>}
                          {fields.Time && <p className="text-[10px] text-muted-foreground mt-0.5">{fields.Time}</p>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : <p className="text-center text-muted-foreground py-8">No active alerts</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
