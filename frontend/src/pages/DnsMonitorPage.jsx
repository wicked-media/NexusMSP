import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, AlertTriangle, CheckCircle, RefreshCw, Shield, Clock, Plus, Activity } from "lucide-react";
import { toast } from "sonner";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

export default function DnsMonitorPage() {
  const { token } = useAuth();
  const [domains, setDomains] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [domainForm, setDomainForm] = useState({ domain: "", client_id: "", check_interval_minutes: "60" });
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, aRes, clientRes] = await Promise.all([
        axios.get(`${API}/dns-monitor/domains`, { headers }),
        axios.get(`${API}/dns-monitor/alerts`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setDomains(dRes.data);
      setAlerts(aRes.data);
      setClients(clientRes.data || []);
    } catch (e) { toast.error("Failed to load DNS data"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
    if (!domainForm.domain.trim()) { toast.error("Enter a domain name"); return; }
    const client = clients.find(item => item.id === domainForm.client_id);
    try {
      await axios.post(`${API}/dns-monitor/domains`, {
        domain: domainForm.domain.trim().toLowerCase(),
        client_id: client?.id || "",
        client_name: client?.name || "",
        check_interval_minutes: Number(domainForm.check_interval_minutes) || 60,
      }, { headers });
      toast.success("Domain added");
      setDomainForm({ domain: "", client_id: "", check_interval_minutes: "60" });
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
      <OperationalPageHeader
        eyebrow="Network workspace · DNS"
        title="DNS monitor"
        description="Monitor client DNS records, investigate unexpected changes and retain an acknowledgement trail."
        icon={Globe}
        tone="sky"
        actions={(
          <>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} data-testid="dns-refresh-btn"><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
            <Button onClick={() => setShowAdd(value => !value)} data-testid="add-domain-btn"><Plus className="w-4 h-4 mr-2" />Add Domain</Button>
          </>
        )}
      />

      {showAdd && (
        <Card className="border-sky-500/20 bg-sky-500/[0.03]" data-testid="add-domain-form"><CardContent className="space-y-4 p-5">
          <div><p className="text-sm font-semibold">Add a monitored domain</p><p className="mt-1 text-xs text-muted-foreground">Link it to a client now so DNS changes are visible in the correct service context and audit trail.</p></div>
          <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_180px_auto] md:items-end">
            <div className="space-y-1.5"><Label htmlFor="new-domain-input">Domain</Label><Input id="new-domain-input" value={domainForm.domain} onChange={event => setDomainForm(form => ({ ...form, domain: event.target.value }))} placeholder="example.com" data-testid="new-domain-input" /></div>
            <div className="space-y-1.5"><Label>Client</Label><Select value={domainForm.client_id || "unlinked"} onValueChange={value => setDomainForm(form => ({ ...form, client_id: value === "unlinked" ? "" : value }))}><SelectTrigger data-testid="dns-client-select"><SelectValue placeholder="Unlinked domain" /></SelectTrigger><SelectContent><SelectItem value="unlinked">Unlinked domain</SelectItem>{clients.map(client => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Check interval</Label><Select value={domainForm.check_interval_minutes} onValueChange={value => setDomainForm(form => ({ ...form, check_interval_minutes: value }))}><SelectTrigger data-testid="dns-interval-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="15">Every 15 minutes</SelectItem><SelectItem value="30">Every 30 minutes</SelectItem><SelectItem value="60">Hourly</SelectItem><SelectItem value="360">Every 6 hours</SelectItem><SelectItem value="1440">Daily</SelectItem></SelectContent></Select></div>
            <Button onClick={handleAddDomain} data-testid="save-domain-btn"><Plus className="w-4 h-4 mr-1" />Add</Button>
          </div>
        </CardContent></Card>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroTile label="Monitored domains" value={domains.length} icon={Globe} glow="sky" subtitle="DNS baselines in scope" />
        <HeroTile label="Healthy domains" value={domains.filter(domain => domain.status === "healthy").length} icon={CheckCircle} glow="emerald" subtitle="No current record concern" />
        <HeroTile label="Needs review" value={unackAlerts.length} icon={AlertTriangle} glow={unackAlerts.length ? "rose" : "zinc"} subtitle={unackAlerts.length ? "Awaiting acknowledgement" : "No open alerts"} />
        <HeroTile label="Critical changes" value={alerts.filter(alert => alert.severity === "critical" && !alert.acknowledged).length} icon={Shield} glow="amber" subtitle="Investigate immediately" />
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
                    <td className="py-3"><Button variant="outline" size="sm" onClick={() => handleCheck(d.id)} data-testid={`check-dns-${d.id}`}><Activity className="w-3 h-3 mr-1" />Check</Button></td>
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
