import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Wifi, Router, Server, Monitor, Globe, Activity, Signal, Search,
  Loader2, RefreshCw, ChevronRight, ArrowUpDown, Plus, Cpu, HardDrive,
  Users, Laptop, Smartphone, Download, Upload, Shield, AlertTriangle, CheckCircle2
} from "lucide-react";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatUptime(seconds) {
  if (!seconds) return "N/A";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

const StatusDot = ({ status }) => {
  const colors = { online: "bg-emerald-500", warning: "bg-amber-500", offline: "bg-red-500" };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status] || "bg-slate-500"}`} />;
};

export default function NetworkingPage() {
  const { token } = useAuth();
  const [sites, setSites] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedSite, setSelectedSite] = useState(null);
  const [siteOverview, setSiteOverview] = useState(null);
  const [siteDevices, setSiteDevices] = useState([]);
  const [siteClients, setSiteClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("all");

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sitesRes, statsRes] = await Promise.all([
        axios.get(`${API}/networking/sites`, { headers }),
        axios.get(`${API}/networking/stats`, { headers }),
      ]);
      setSites(sitesRes.data);
      setStats(statsRes.data);
    } catch { toast.error("Failed to load networking data"); }
    finally { setLoading(false); }
  };

  const fetchSiteData = async (siteId) => {
    try {
      const [overviewRes, devicesRes, clientsRes] = await Promise.all([
        axios.get(`${API}/networking/sites/${siteId}/overview`, { headers }),
        axios.get(`${API}/networking/sites/${siteId}/devices`, { headers }),
        axios.get(`${API}/networking/sites/${siteId}/clients`, { headers }),
      ]);
      setSiteOverview(overviewRes.data);
      setSiteDevices(devicesRes.data);
      setSiteClients(clientsRes.data);
    } catch { toast.error("Failed to load site data"); }
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (selectedSite) fetchSiteData(selectedSite.id);
  }, [selectedSite]);

  const filteredDevices = siteDevices
    .filter(d => deviceFilter === "all" || d.device_type === deviceFilter)
    .filter(d => !search || d.name?.toLowerCase().includes(search.toLowerCase()) || d.model?.toLowerCase().includes(search.toLowerCase()));

  const filteredClients = siteClients
    .filter(c => !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.ip_address?.includes(search) || c.mac?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ============ SITE DETAIL VIEW ============
  if (selectedSite && siteOverview) {
    return (
      <div className="space-y-6" data-testid="networking-site-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedSite(null); setSiteOverview(null); }} data-testid="back-to-sites">
            <Globe className="w-4 h-4 mr-1" />Back to Sites
          </Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium">{selectedSite.name}</span>
          <StatusDot status={selectedSite.status} />
        </div>

        {/* Site Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Router className="w-5 h-5 text-blue-500" /><div><p className="text-xs text-muted-foreground">Devices</p><p className="text-lg font-bold">{siteOverview.online_devices}/{siteOverview.total_devices}</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Wifi className="w-5 h-5 text-cyan-500" /><div><p className="text-xs text-muted-foreground">APs</p><p className="text-lg font-bold">{siteOverview.access_points}</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Server className="w-5 h-5 text-purple-500" /><div><p className="text-xs text-muted-foreground">Switches</p><p className="text-lg font-bold">{siteOverview.switches}</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Users className="w-5 h-5 text-green-500" /><div><p className="text-xs text-muted-foreground">Clients</p><p className="text-lg font-bold">{siteOverview.total_clients}</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Download className="w-5 h-5 text-emerald-500" /><div><p className="text-xs text-muted-foreground">RX Total</p><p className="text-lg font-bold">{formatBytes(siteOverview.total_rx_bytes)}</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Upload className="w-5 h-5 text-orange-500" /><div><p className="text-xs text-muted-foreground">TX Total</p><p className="text-lg font-bold">{formatBytes(siteOverview.total_tx_bytes)}</p></div></div></CardContent></Card>
        </div>

        {/* Health Status */}
        <div className="grid grid-cols-3 gap-3">
          {["wan", "lan", "wlan"].map(subsystem => {
            const status = siteOverview.health?.[subsystem] || "n/a";
            return (
              <Card key={subsystem} className={status === "healthy" ? "border-emerald-500/30" : status === "warning" ? "border-amber-500/30" : "border-slate-500/30"}>
                <CardContent className="pt-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {subsystem === "wan" ? <Globe className="w-5 h-5" /> : subsystem === "lan" ? <Server className="w-5 h-5" /> : <Wifi className="w-5 h-5" />}
                    <div>
                      <p className="font-medium uppercase text-sm">{subsystem}</p>
                      <p className="text-xs text-muted-foreground">{subsystem === "wan" ? `${selectedSite.isp} - ${selectedSite.wan_ip}` : subsystem === "lan" ? `${siteOverview.wired_clients} wired clients` : `${siteOverview.wireless_clients} wireless`}</p>
                    </div>
                  </div>
                  <Badge variant={status === "healthy" ? "default" : status === "warning" ? "destructive" : "secondary"} className={status === "healthy" ? "bg-emerald-600" : ""}>{status}</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Tabs: Devices / Clients */}
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="overview" data-testid="tab-overview">Devices</TabsTrigger>
              <TabsTrigger value="clients" data-testid="tab-clients">Clients ({siteClients.length})</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              {tab === "overview" && (
                <Select value={deviceFilter} onValueChange={setDeviceFilter}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="gateway">Gateways</SelectItem>
                    <SelectItem value="switch">Switches</SelectItem>
                    <SelectItem value="ap">Access Points</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9 w-[200px]" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
          </div>

          <TabsContent value="overview" className="space-y-3 mt-4">
            {filteredDevices.map(device => (
              <Card key={device.id} className="hover:border-primary/40 transition-colors" data-testid={`net-device-${device.id}`}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${device.device_type === "gateway" ? "bg-blue-500/10" : device.device_type === "switch" ? "bg-purple-500/10" : "bg-cyan-500/10"}`}>
                        {device.device_type === "gateway" ? <Router className="w-5 h-5 text-blue-500" /> : device.device_type === "switch" ? <Server className="w-5 h-5 text-purple-500" /> : <Wifi className="w-5 h-5 text-cyan-500" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{device.name}</p>
                          <StatusDot status={device.status} />
                        </div>
                        <p className="text-xs text-muted-foreground">{device.model} &middot; {device.ip_address} &middot; FW: {device.firmware}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-center"><p className="text-xs text-muted-foreground">CPU</p><p className="font-mono font-medium">{device.cpu_usage ?? "-"}%</p></div>
                      <div className="text-center"><p className="text-xs text-muted-foreground">MEM</p><p className="font-mono font-medium">{device.mem_usage ?? "-"}%</p></div>
                      {device.device_type === "ap" && (
                        <>
                          <div className="text-center"><p className="text-xs text-muted-foreground">Clients</p><p className="font-mono font-medium">{(device.clients_2g || 0) + (device.clients_5g || 0)}</p></div>
                          <div className="text-center"><p className="text-xs text-muted-foreground">Satisfaction</p><p className="font-mono font-medium">{device.satisfaction ?? "-"}%</p></div>
                        </>
                      )}
                      {device.device_type === "switch" && (
                        <>
                          <div className="text-center"><p className="text-xs text-muted-foreground">Ports</p><p className="font-mono font-medium">{device.num_ports}</p></div>
                          <div className="text-center"><p className="text-xs text-muted-foreground">PoE</p><p className="font-mono font-medium">{device.poe_power_w ? `${device.poe_power_w}W` : "-"}</p></div>
                        </>
                      )}
                      {device.device_type === "gateway" && (
                        <>
                          <div className="text-center"><p className="text-xs text-muted-foreground">DL</p><p className="font-mono font-medium">{device.throughput_rx_mbps ? `${device.throughput_rx_mbps}Mbps` : "-"}</p></div>
                          <div className="text-center"><p className="text-xs text-muted-foreground">UL</p><p className="font-mono font-medium">{device.throughput_tx_mbps ? `${device.throughput_tx_mbps}Mbps` : "-"}</p></div>
                        </>
                      )}
                      <div className="text-center"><p className="text-xs text-muted-foreground">Uptime</p><p className="font-mono font-medium">{formatUptime(device.uptime_seconds)}</p></div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {filteredDevices.length === 0 && <p className="text-center text-muted-foreground py-12">No devices found</p>}
          </TabsContent>

          <TabsContent value="clients" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>MAC</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>OS</TableHead>
                      <TableHead>AP / SSID</TableHead>
                      <TableHead>Signal</TableHead>
                      <TableHead className="text-right">RX / TX</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredClients.map(c => (
                      <TableRow key={c.id} data-testid={`net-client-${c.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {c.is_wireless ? <Smartphone className="w-4 h-4 text-cyan-500" /> : <Monitor className="w-4 h-4 text-blue-500" />}
                            <span className="font-medium">{c.name || c.hostname || "Unknown"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{c.ip_address}</TableCell>
                        <TableCell className="font-mono text-xs">{c.mac}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{c.is_wireless ? "WiFi" : "Wired"}</Badge></TableCell>
                        <TableCell className="text-sm">{c.os_type || "-"}</TableCell>
                        <TableCell className="text-xs">{c.ap_name ? `${c.ap_name} / ${c.ssid}` : "-"}</TableCell>
                        <TableCell>{c.signal_strength ? <span className={`font-mono text-xs ${c.signal_strength > -50 ? "text-green-500" : c.signal_strength > -70 ? "text-yellow-500" : "text-red-500"}`}>{c.signal_strength} dBm</span> : "-"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatBytes(c.rx_bytes)} / {formatBytes(c.tx_bytes)}</TableCell>
                      </TableRow>
                    ))}
                    {filteredClients.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No clients found</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // ============ SITES LIST VIEW ============
  return (
    <div className="space-y-6" data-testid="networking-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Networking</h1>
          <p className="text-muted-foreground">UniFi network management across all client sites</p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      {/* Global Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Globe className="w-5 h-5 text-blue-500" /><div><p className="text-xs text-muted-foreground">Sites</p><p className="text-xl font-bold">{stats.online_sites}/{stats.total_sites}</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Router className="w-5 h-5 text-emerald-500" /><div><p className="text-xs text-muted-foreground">Devices</p><p className="text-xl font-bold">{stats.online_devices}/{stats.total_devices}</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Users className="w-5 h-5 text-green-500" /><div><p className="text-xs text-muted-foreground">Clients</p><p className="text-xl font-bold">{stats.total_clients}</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Wifi className="w-5 h-5 text-cyan-500" /><div><p className="text-xs text-muted-foreground">APs</p><p className="text-xl font-bold">{stats.access_points}</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Server className="w-5 h-5 text-purple-500" /><div><p className="text-xs text-muted-foreground">Switches</p><p className="text-xl font-bold">{stats.switches}</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Shield className="w-5 h-5 text-indigo-500" /><div><p className="text-xs text-muted-foreground">Gateways</p><p className="text-xl font-bold">{stats.gateways}</p></div></div></CardContent></Card>
          <Card className={stats.online_sites < stats.total_sites ? "border-amber-500/40" : "border-emerald-500/40"}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                {stats.online_sites < stats.total_sites ? <AlertTriangle className="w-5 h-5 text-amber-500" /> : <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                <div>
                  <p className="text-xs text-muted-foreground">Health</p>
                  <p className="text-xl font-bold">{stats.online_sites < stats.total_sites ? "Warning" : "Healthy"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sites List */}
      <div className="space-y-3">
        {sites.map(site => (
          <Card key={site.id} className="cursor-pointer hover:border-primary/50 transition-all" onClick={() => { setSelectedSite(site); setTab("overview"); setSearch(""); setDeviceFilter("all"); }} data-testid={`site-card-${site.id}`}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${site.status === "online" ? "bg-emerald-500/10" : site.status === "warning" ? "bg-amber-500/10" : "bg-red-500/10"}`}>
                    <Globe className={`w-6 h-6 ${site.status === "online" ? "text-emerald-500" : site.status === "warning" ? "text-amber-500" : "text-red-500"}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{site.name}</p>
                      <StatusDot status={site.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">{site.client_name} &middot; {site.location}</p>
                  </div>
                </div>
                <div className="flex items-center gap-8 text-sm">
                  <div className="text-center"><p className="text-xs text-muted-foreground">ISP</p><p className="font-medium">{site.isp}</p></div>
                  <div className="text-center"><p className="text-xs text-muted-foreground">WAN IP</p><p className="font-mono text-xs">{site.wan_ip}</p></div>
                  <div className="text-center"><p className="text-xs text-muted-foreground">Speed</p><p className="font-mono">{site.download_speed_mbps}/{site.upload_speed_mbps} Mbps</p></div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {sites.length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No network sites configured. Add a UniFi controller in Settings.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
