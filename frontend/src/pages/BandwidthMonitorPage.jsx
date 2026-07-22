import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gauge, ArrowDown, ArrowUp, AlertTriangle, Wifi, RefreshCw, Users, Activity, Radio, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid } from "recharts";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

export default function BandwidthMonitorPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [selectedSite, setSelectedSite] = useState("");
  const [siteData, setSiteData] = useState([]);
  const [topTalkers, setTopTalkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [siteLoading, setSiteLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [resolvingAlertId, setResolvingAlertId] = useState("");
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [oRes, aRes] = await Promise.all([
        axios.get(`${API}/bandwidth-monitor/overview`, { headers }),
        axios.get(`${API}/bandwidth-monitor/alerts`, { headers }),
      ]);
      setData(oRes.data);
      setAlerts(aRes.data);
      setSelectedSite(current => current || oRes.data.sites?.[0]?.id || "");
    } catch (e) {
      setData(null);
      setAlerts([]);
      setLoadError(e.response?.data?.detail || "Bandwidth data could not be loaded. Check the provider connection and try again.");
      toast.error("Failed to load bandwidth data");
    }
    finally { setLoading(false); }
  }, [headers]);

  const fetchSite = useCallback(async (siteId) => {
    if (!siteId) { setSiteData([]); setTopTalkers([]); return; }
    setSiteLoading(true);
    setSiteData([]);
    setTopTalkers([]);
    try {
      const [bandwidthRes, talkersRes] = await Promise.all([
        axios.get(`${API}/bandwidth-monitor/site/${siteId}`, { headers }),
        axios.get(`${API}/bandwidth-monitor/top-talkers/${siteId}`, { headers }),
      ]);
      setSiteData((bandwidthRes.data || []).reverse().map(item => ({ ...item, time: new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })));
      setTopTalkers(talkersRes.data || []);
    } catch (e) { toast.error("Failed to load selected site telemetry"); }
    finally { setSiteLoading(false); }
  }, [headers]);

  const resolveAlert = async (alertId) => {
    setResolvingAlertId(alertId);
    try {
      const response = await axios.post(`${API}/bandwidth-monitor/alerts/${alertId}/resolve`, {}, { headers });
      setAlerts(current => current.map(alert => alert.id === alertId ? response.data.alert : alert));
      toast.success("Bandwidth alert resolved and added to the audit trail");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Unable to resolve the bandwidth alert");
    } finally { setResolvingAlertId(""); }
  };

  useEffect(() => { fetchOverview(); }, [fetchOverview]);
  useEffect(() => { fetchSite(selectedSite); }, [selectedSite, fetchSite]);

  if (loading && !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  if (!data) return (
    <div className="space-y-6" data-testid="bandwidth-monitor-error">
      <OperationalPageHeader eyebrow="Network workspace - traffic" title="Bandwidth monitor" description="Live utilisation, connection quality and high-traffic endpoints across managed client sites." icon={Gauge} tone="sky" actions={<Button size="sm" onClick={fetchOverview}><RefreshCw className="mr-1 h-4 w-4" />Try again</Button>} />
      <Card className="border-red-500/30 bg-red-500/5"><CardContent className="flex items-center gap-3 py-5 text-sm text-red-200"><AlertTriangle className="h-5 w-5 text-red-400" />{loadError || "Bandwidth data is unavailable."}</CardContent></Card>
    </div>
  );

  const { sites } = data;
  const currentSite = sites.find(s => s.id === selectedSite);
  const currentSample = siteData[siteData.length - 1];
  const visibleAlerts = alerts.filter(alert => !selectedSite || alert.site_id === selectedSite);
  const unresolvedAlerts = visibleAlerts.filter(alert => !alert.resolved);

  return (
    <div className="space-y-6" data-testid="bandwidth-monitor-page">
      <OperationalPageHeader
        eyebrow="Network workspace - traffic"
        title="Bandwidth monitor"
        description="Live utilisation, connection quality and high-traffic endpoints across managed client sites."
        icon={Gauge}
        tone="sky"
        actions={(
          <>
            <Select value={selectedSite} onValueChange={setSelectedSite}>
              <SelectTrigger className="w-64" data-testid="site-selector"><SelectValue placeholder="Select site" /></SelectTrigger>
              <SelectContent>{sites.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={async () => { await fetchOverview(); await fetchSite(selectedSite); }} disabled={loading} data-testid="bandwidth-refresh-btn"><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
          </>
        )}
      />

      {currentSite && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <HeroTile label="Download now" value={currentSample?.download_mbps ?? 0} suffix=" Mbps" icon={ArrowDown} glow="sky" subtitle={`of ${currentSite.download_speed_mbps || 0} Mbps capacity`} />
          <HeroTile label="Upload now" value={currentSample?.upload_mbps ?? 0} suffix=" Mbps" icon={ArrowUp} glow="emerald" subtitle={`of ${currentSite.upload_speed_mbps || 0} Mbps capacity`} />
          <HeroTile label="Latency" value={currentSample?.latency_ms ?? 0} suffix=" ms" icon={Activity} glow="indigo" subtitle={currentSite.isp || "ISP not recorded"} />
          <HeroTile label="Packet loss" value={currentSample?.packet_loss_pct ?? 0} suffix="%" icon={Radio} glow={(currentSample?.packet_loss_pct ?? 0) > 1 ? "rose" : "zinc"} subtitle={currentSite.wan_ip || "WAN IP not recorded"} />
          <HeroTile label="Open alerts" value={unresolvedAlerts.length} icon={AlertTriangle} glow={unresolvedAlerts.length ? "amber" : "zinc"} subtitle={currentSite.status === "online" ? "Selected site online" : currentSite.status || "Status unknown"} />
        </div>
      )}

      {/* Bandwidth Chart */}
      {siteData.length > 0 && (
        <Card><CardHeader><CardTitle className="text-lg">Bandwidth usage · 24 hours</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64" aria-busy={siteLoading}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={siteData.filter((_, i) => i % 3 === 0)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="download_mbps" name="Download" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                  <Area type="monotone" dataKey="upload_mbps" name="Upload" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Users className="w-4 h-4 text-sky-400" />Top talkers</CardTitle></CardHeader>
        <CardContent>
          {topTalkers.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No client traffic is currently available for this site.</p> : (
            <div className="space-y-2">{topTalkers.map(client => {
              const total = (client.rx_bytes || 0) + (client.tx_bytes || 0);
              return <div key={client.id || client.mac} className="flex items-center gap-3 rounded-lg border border-border/60 p-3 text-sm"><Wifi className="h-4 w-4 text-sky-400" /><div className="min-w-0 flex-1"><p className="truncate font-medium">{client.name || client.hostname || client.manufacturer || client.mac}</p><p className="text-xs text-muted-foreground">{client.ip_address || client.ip || "IP not recorded"} · {client.is_wireless ? "Wireless" : "Wired"}</p></div><div className="text-right text-xs"><p className="font-mono">{(total / 1_000_000).toFixed(1)} MB</p><p className="text-muted-foreground">RX + TX</p></div></div>;
            })}</div>
          )}
        </CardContent>
      </Card>

      {/* Alerts */}
      {visibleAlerts.length > 0 && (
        <Card><CardHeader><CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" />{currentSite ? `${currentSite.name} alerts` : "Bandwidth alerts"}</CardTitle></CardHeader>
          <CardContent><div className="space-y-2">
            {visibleAlerts.map(a => (
              <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border" data-testid={`bw-alert-${a.id}`}>
                <div>
                  <div className="flex items-center gap-2"><Badge variant={a.severity === "warning" ? "warning" : "secondary"}>{a.severity}</Badge><span className="font-medium text-sm">{a.site_name}</span></div>
                  <p className="text-xs text-muted-foreground mt-1">{a.message}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 text-right">
                  <Badge variant={a.resolved ? "outline" : "default"}>{a.resolved ? "Resolved" : "Active"}</Badge>
                  {!a.resolved && <Button size="sm" variant="outline" disabled={resolvingAlertId === a.id} onClick={() => resolveAlert(a.id)} data-testid={`resolve-bw-alert-${a.id}`}>{resolvingAlertId === a.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle className="mr-1 h-3 w-3" />}Resolve</Button>}
                  <p className="text-xs text-muted-foreground">{new Date(a.detected_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div></CardContent>
        </Card>
      )}

      {/* All Sites Overview */}
      <Card><CardHeader><CardTitle className="text-lg">All Sites</CardTitle></CardHeader>
        <CardContent><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-3 font-medium">Site</th><th className="pb-3 font-medium">Client</th><th className="pb-3 font-medium">ISP</th><th className="pb-3 font-medium">Download</th><th className="pb-3 font-medium">Upload</th><th className="pb-3 font-medium">Status</th></tr></thead>
          <tbody>{sites.map(s => (
            <tr key={s.id} className={`cursor-pointer border-b border-border/50 hover:bg-muted/30 ${selectedSite === s.id ? "bg-sky-500/5" : ""}`} onClick={() => setSelectedSite(s.id)}>
              <td className="py-2 font-medium">{s.name}</td>
              <td className="py-2 text-muted-foreground">{s.client_name}</td>
              <td className="py-2">{s.isp}</td>
              <td className="py-2">{s.download_speed_mbps} Mbps</td>
              <td className="py-2">{s.upload_speed_mbps} Mbps</td>
              <td className="py-2"><Badge className={s.status === "online" ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}>{s.status}</Badge></td>
            </tr>
          ))}</tbody>
        </table></div></CardContent>
      </Card>
    </div>
  );
}
