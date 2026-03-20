import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe, AlertTriangle, CheckCircle, XCircle, RefreshCw, Shield, Clock, Plus } from "lucide-react";
import { toast } from "sonner";

export default function DnsMonitorPage() {
  const { token } = useAuth();
  const [domains, setDomains] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [dRes, aRes] = await Promise.all([
        axios.get(`${API}/dns-monitor/domains`, { headers }),
        axios.get(`${API}/dns-monitor/alerts`, { headers }),
      ]);
      setDomains(dRes.data);
      setAlerts(aRes.data);
    } catch (e) { toast.error("Failed to load DNS data"); }
    setLoading(false);
  };

  const handleCheck = async (id) => {
    try {
      await axios.post(`${API}/dns-monitor/check/${id}`, {}, { headers });
      toast.success("DNS check initiated");
      fetchData();
    } catch (e) { toast.error("Check failed"); }
  };

  const handleAcknowledge = async (id) => {
    try {
      await axios.post(`${API}/dns-monitor/alerts/${id}/acknowledge`, {}, { headers });
      toast.success("Alert acknowledged");
      fetchData();
    } catch (e) { toast.error("Failed to acknowledge"); }
  };

  const handleAddDomain = async () => {
    if (!newDomain) return;
    try {
      await axios.post(`${API}/dns-monitor/domains`, { domain: newDomain }, { headers });
      toast.success("Domain added");
      setNewDomain("");
      setShowAdd(false);
      fetchData();
    } catch (e) { toast.error("Failed to add domain"); }
  };

  const statusColor = { healthy: "bg-emerald-500/10 text-emerald-500", warning: "bg-amber-500/10 text-amber-500", critical: "bg-red-500/10 text-red-500" };
  const severityColor = { critical: "destructive", warning: "warning", info: "secondary" };
  const unackAlerts = alerts.filter(a => !a.acknowledged);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="dns-monitor-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">DNS Monitor</h1>
          <p className="text-muted-foreground text-sm mt-1">Track DNS record changes across client domains</p>
        </div>
        <Button onClick={() => setShowAdd(!showAdd)} data-testid="add-domain-btn"><Plus className="w-4 h-4 mr-2" />Add Domain</Button>
      </div>

      {showAdd && (
        <Card><CardContent className="pt-4 flex gap-3">
          <Input value={newDomain} onChange={e => setNewDomain(e.target.value)} placeholder="e.g. example.com" data-testid="new-domain-input" />
          <Button onClick={handleAddDomain} data-testid="save-domain-btn">Add</Button>
        </CardContent></Card>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5 flex items-center gap-3"><div className="p-2 rounded-lg bg-primary/10"><Globe className="w-5 h-5 text-primary" /></div><div><p className="text-2xl font-bold">{domains.length}</p><p className="text-xs text-muted-foreground">Monitored Domains</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><div className="p-2 rounded-lg bg-emerald-500/10"><CheckCircle className="w-5 h-5 text-emerald-500" /></div><div><p className="text-2xl font-bold">{domains.filter(d => d.status === "healthy").length}</p><p className="text-xs text-muted-foreground">Healthy</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><div className="p-2 rounded-lg bg-red-500/10"><AlertTriangle className="w-5 h-5 text-red-500" /></div><div><p className="text-2xl font-bold">{unackAlerts.length}</p><p className="text-xs text-muted-foreground">Unacknowledged Alerts</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><div className="p-2 rounded-lg bg-amber-500/10"><Shield className="w-5 h-5 text-amber-500" /></div><div><p className="text-2xl font-bold">{alerts.filter(a => a.severity === "critical" && !a.acknowledged).length}</p><p className="text-xs text-muted-foreground">Critical Alerts</p></div></CardContent></Card>
      </div>

      {/* Alerts */}
      {unackAlerts.length > 0 && (
        <Card><CardHeader><CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-500" />Active DNS Alerts</CardTitle></CardHeader>
          <CardContent><div className="space-y-3">
            {unackAlerts.map(a => (
              <div key={a.id} className="flex items-start justify-between p-3 rounded-lg border bg-muted/30" data-testid={`dns-alert-${a.id}`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={severityColor[a.severity] || "secondary"}>{a.severity}</Badge>
                    <span className="font-mono text-sm">{a.domain}</span>
                    <span className="text-xs text-muted-foreground">{a.record_type}</span>
                  </div>
                  <p className="text-sm">{a.message}</p>
                  {a.old_value && <p className="text-xs text-muted-foreground mt-1">Old: {a.old_value} &rarr; New: {a.new_value}</p>}
                </div>
                <Button variant="outline" size="sm" onClick={() => handleAcknowledge(a.id)} data-testid={`ack-alert-${a.id}`}>Acknowledge</Button>
              </div>
            ))}
          </div></CardContent>
        </Card>
      )}

      {/* Domains Table */}
      <Card><CardHeader><CardTitle className="text-lg">Monitored Domains</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-muted-foreground">
                <th className="pb-3 font-medium">Domain</th><th className="pb-3 font-medium">Client</th><th className="pb-3 font-medium">Status</th><th className="pb-3 font-medium">Records</th><th className="pb-3 font-medium">Check Interval</th><th className="pb-3 font-medium">Last Checked</th><th className="pb-3 font-medium">Actions</th>
              </tr></thead>
              <tbody>
                {domains.map(d => (
                  <tr key={d.id} className="border-b border-border/50 hover:bg-muted/30" data-testid={`domain-row-${d.id}`}>
                    <td className="py-3 font-mono font-medium">{d.domain}</td>
                    <td className="py-3 text-muted-foreground">{d.client_name}</td>
                    <td className="py-3"><Badge className={statusColor[d.status] || ""}>{d.status}</Badge></td>
                    <td className="py-3"><div className="flex gap-1 flex-wrap">{Object.keys(d.records || {}).map(r => <Badge key={r} variant="outline" className="text-[10px]">{r}</Badge>)}</div></td>
                    <td className="py-3 text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />{d.check_interval_minutes}m</td>
                    <td className="py-3 text-xs text-muted-foreground">{d.last_checked ? new Date(d.last_checked).toLocaleString() : "Never"}</td>
                    <td className="py-3"><Button variant="ghost" size="sm" onClick={() => handleCheck(d.id)} data-testid={`check-dns-${d.id}`}><RefreshCw className="w-4 h-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* All Alerts History */}
      <Card><CardHeader><CardTitle className="text-lg">Alert History</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {alerts.map(a => (
              <div key={a.id} className={`flex items-center gap-3 p-2 rounded text-sm ${a.acknowledged ? "opacity-50" : ""}`}>
                <Badge variant={severityColor[a.severity] || "secondary"} className="text-[10px]">{a.severity}</Badge>
                <span className="font-mono text-xs">{a.domain}</span>
                <span className="flex-1 text-muted-foreground truncate">{a.message}</span>
                <span className="text-xs text-muted-foreground">{new Date(a.detected_at).toLocaleDateString()}</span>
                {a.acknowledged && <Badge variant="outline" className="text-[10px]">ACK</Badge>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
