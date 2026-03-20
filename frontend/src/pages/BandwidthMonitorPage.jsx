import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gauge, ArrowDown, ArrowUp, AlertTriangle, Wifi } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid } from "recharts";

export default function BandwidthMonitorPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [selectedSite, setSelectedSite] = useState("");
  const [siteData, setSiteData] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [oRes, aRes] = await Promise.all([
          axios.get(`${API}/bandwidth-monitor/overview`, { headers }),
          axios.get(`${API}/bandwidth-monitor/alerts`, { headers }),
        ]);
        setData(oRes.data);
        setAlerts(aRes.data);
        if (oRes.data.sites?.length > 0) {
          setSelectedSite(oRes.data.sites[0].id);
        }
      } catch (e) { toast.error("Failed to load bandwidth data"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (!selectedSite) return;
    const fetchSite = async () => {
      try {
        const res = await axios.get(`${API}/bandwidth-monitor/site/${selectedSite}`, { headers });
        setSiteData(res.data.reverse().map(d => ({ ...d, time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })));
      } catch (e) {}
    };
    fetchSite();
  }, [selectedSite]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const { sites } = data;
  const currentSite = sites.find(s => s.id === selectedSite);

  return (
    <div className="space-y-6" data-testid="bandwidth-monitor-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Bandwidth Monitor</h1><p className="text-muted-foreground text-sm mt-1">Real-time network bandwidth across client sites</p></div>
        <Select value={selectedSite} onValueChange={setSelectedSite}>
          <SelectTrigger className="w-64" data-testid="site-selector"><SelectValue placeholder="Select site" /></SelectTrigger>
          <SelectContent>{sites.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {currentSite && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-5 flex items-center gap-3"><ArrowDown className="w-6 h-6 text-blue-500" /><div><p className="text-2xl font-bold">{currentSite.download_speed_mbps}</p><p className="text-xs text-muted-foreground">Download (Mbps)</p></div></CardContent></Card>
          <Card><CardContent className="pt-5 flex items-center gap-3"><ArrowUp className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{currentSite.upload_speed_mbps}</p><p className="text-xs text-muted-foreground">Upload (Mbps)</p></div></CardContent></Card>
          <Card><CardContent className="pt-5 flex items-center gap-3"><Wifi className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{currentSite.isp}</p><p className="text-xs text-muted-foreground">ISP</p></div></CardContent></Card>
          <Card><CardContent className="pt-5 flex items-center gap-3"><Badge className={currentSite.status === "online" ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}>{currentSite.status}</Badge><p className="text-xs text-muted-foreground">{currentSite.wan_ip}</p></CardContent></Card>
        </div>
      )}

      {/* Bandwidth Chart */}
      {siteData.length > 0 && (
        <Card><CardHeader><CardTitle className="text-lg">Bandwidth Usage (24h)</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
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

      {/* Alerts */}
      {alerts.length > 0 && (
        <Card><CardHeader><CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" />Bandwidth Alerts</CardTitle></CardHeader>
          <CardContent><div className="space-y-2">
            {alerts.map(a => (
              <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border" data-testid={`bw-alert-${a.id}`}>
                <div>
                  <div className="flex items-center gap-2"><Badge variant={a.severity === "warning" ? "warning" : "secondary"}>{a.severity}</Badge><span className="font-medium text-sm">{a.site_name}</span></div>
                  <p className="text-xs text-muted-foreground mt-1">{a.message}</p>
                </div>
                <div className="text-right">
                  <Badge variant={a.resolved ? "outline" : "default"}>{a.resolved ? "Resolved" : "Active"}</Badge>
                  <p className="text-xs text-muted-foreground mt-1">{new Date(a.detected_at).toLocaleString()}</p>
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
            <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedSite(s.id)}>
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
