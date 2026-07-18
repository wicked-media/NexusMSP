import { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Wifi, RefreshCw, Loader2, ExternalLink, Search, Link as LinkIcon,
  Server, Users, AlertTriangle, Radio, Network, Signal,
  Power, Lightbulb, RotateCw, Download, Activity, TrendingUp, Zap, ShieldCheck,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, RadialBarChart, RadialBar } from "recharts";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";

function bytesHuman(n) {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)}${units[i]}`;
}
function uptimeHuman(secs) {
  if (!secs) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function UnifiCommandCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSite, setSelectedSite] = useState(null);
  const [activeTab, setActiveTab] = useState("sites");
  const [query, setQuery] = useState("");

  const [devices, setDevices] = useState([]);
  const [clientsData, setClientsData] = useState({ items: [], summary: null, supported: true, message: "" });
  const [alertsData, setAlertsData] = useState({ items: [], summary: null, supported: true, message: "" });
  const [networksData, setNetworksData] = useState({ items: [], summary: null, supported: true, message: "" });
  const [loadingSite, setLoadingSite] = useState(false);

  const [allClients, setAllClients] = useState([]);
  const [linkedClients, setLinkedClients] = useState([]);
  const [linkDialog, setLinkDialog] = useState(null);
  const [linkClientId, setLinkClientId] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, linkedRes, clientsRes] = await Promise.all([
        axios.get(`${API}/unifi/summary`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/unifi/linked-clients`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/clients`, { headers }).catch(() => ({ data: [] })),
      ]);
      setSummary(sumRes.data);
      setLinkedClients(linkedRes.data || []);
      setAllClients(clientsRes.data || []);
    } finally { setLoading(false); }
  }, [token]); // eslint-disable-line

  useEffect(() => { loadSummary(); }, [loadSummary]);

  useEffect(() => {
    if (!selectedSite) { setDevices([]); setClientsData({ items: [], summary: null, supported: true, message: "" }); setAlertsData({ items: [], summary: null, supported: true, message: "" }); setNetworksData({ items: [], summary: null, supported: true, message: "" }); return; }
    (async () => {
      setLoadingSite(true);
      try {
        const [d, c, a, n] = await Promise.all([
          axios.get(`${API}/unifi/sites/${selectedSite.id}/devices`, { headers }).catch(() => ({ data: [] })),
          axios.get(`${API}/unifi/sites/${selectedSite.id}/clients`, { headers }).catch(() => ({ data: { items: [], summary: null, supported: true, message: "" } })),
          axios.get(`${API}/unifi/sites/${selectedSite.id}/alerts`, { headers }).catch(() => ({ data: { items: [], summary: null, supported: true, message: "" } })),
          axios.get(`${API}/unifi/sites/${selectedSite.id}/networks`, { headers }).catch(() => ({ data: { items: [], summary: null, supported: true, message: "" } })),
        ]);
        setDevices(Array.isArray(d.data) ? d.data : []);
        // Endpoints below return either an array (legacy) or {items, summary, supported, message}
        const wrap = (x) => Array.isArray(x) ? { items: x, summary: null, supported: true, message: "" } : { items: x?.items || [], summary: x?.summary || null, supported: x?.supported !== false, message: x?.message || "" };
        setClientsData(wrap(c.data));
        setAlertsData(wrap(a.data));
        setNetworksData(wrap(n.data));
      } finally { setLoadingSite(false); }
    })();
  }, [selectedSite, token]); // eslint-disable-line

  const handleLink = async () => {
    if (!linkDialog || !linkClientId) { toast.error("Pick a client"); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/clients/${linkClientId}/link-unifi-site`, {
        site_id: linkDialog.id,
        site_name: linkDialog.name,
        host_id: linkDialog.host_id,
      }, { headers });
      toast.success("UniFi site linked to client");
      setLinkDialog(null); setLinkClientId("");
      loadSummary();
    } catch (e) { toast.error(e.response?.data?.detail || "Link failed"); }
    finally { setBusy(false); }
  };

  const notConfigured = summary && !summary.configured;
  const error = summary?.error;
  const s = summary?.stats || {};
  const sites = (summary?.sites || []).filter(x => !query || `${x.name}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <PageShell data-testid="unifi-command-center">
      <MetricStrip columns={5}>
        <MetricTile label="Sites" value={s.sites ?? "—"} accent="sky" icon={<Server className="w-2.5 h-2.5 text-sky-400" />} testid="unifi-metric-sites" />
        <MetricTile label="Devices" value={`${s.devices_online ?? 0}/${s.devices ?? 0}`} accent="emerald" icon={<Radio className="w-2.5 h-2.5 text-emerald-400" />} testid="unifi-metric-devices" />
        <MetricTile label="Clients" value={s.clients ?? "—"} accent="indigo" icon={<Users className="w-2.5 h-2.5 text-indigo-400" />} testid="unifi-metric-clients" />
        <MetricTile label="Alerts" value={s.alerts ?? "—"} accent={s.alerts ? "rose" : "zinc"} icon={<AlertTriangle className="w-2.5 h-2.5 text-rose-400" />} testid="unifi-metric-alerts" />
        <MetricTile label="Linked" value={`${s.linked_clients ?? 0} · ${s.coverage_pct ?? 0}%`} accent="violet" icon={<LinkIcon className="w-2.5 h-2.5 text-violet-400" />} testid="unifi-metric-linked" />
      </MetricStrip>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Wifi className="w-6 h-6 text-sky-400" />UniFi Command Center
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {notConfigured ? (
                <span className="text-orange-400">Not configured — add your UniFi Site Manager API key in Settings</span>
              ) : error ? (
                <span className="text-rose-400">{error}</span>
              ) : summary?.last_synced_at ? (
                <span>Last synced {new Date(summary.last_synced_at).toLocaleString()}</span>
              ) : <span>Ready</span>}
            </p>
          </div>
          <div className="flex gap-2">
            {notConfigured && (
              <Button variant="outline" size="sm" asChild data-testid="unifi-configure-btn">
                <Link to="/settings?tab=integrations&anchor=unifi-settings-card"><ExternalLink className="w-3 h-3 mr-1" />Configure UniFi</Link>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={loadSummary} disabled={loading} data-testid="unifi-refresh-btn">
              {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}Refresh
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="unifi-tabs">
            <TabsTrigger value="sites" data-testid="unifi-tab-sites"><Server className="w-3 h-3 mr-1" />Cloud Sites</TabsTrigger>
            <TabsTrigger value="controllers" data-testid="unifi-tab-controllers"><Wifi className="w-3 h-3 mr-1" />Controllers (live)</TabsTrigger>
            <TabsTrigger value="linked" data-testid="unifi-tab-linked"><LinkIcon className="w-3 h-3 mr-1" />Linked Clients</TabsTrigger>
          </TabsList>

          <TabsContent value="sites" className="space-y-4">
            <Card>
              <CardContent className="p-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input className="pl-8 h-9" placeholder="Search sites…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="unifi-site-search" />
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
              <Card>
                <CardContent className="p-0">
                  {loading ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground">
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />Loading sites…
                    </div>
                  ) : notConfigured ? (
                    <div className="text-center py-12 text-xs text-muted-foreground">Add UniFi credentials in Settings.</div>
                  ) : sites.length === 0 ? (
                    <div className="text-center py-12 text-xs text-muted-foreground">No sites found.</div>
                  ) : (
                    <div className="divide-y divide-border max-h-[calc(100vh-280px)] overflow-y-auto">
                      {sites.map((x) => {
                        const pct = x.devices ? Math.round((x.devices_online / x.devices) * 100) : 0;
                        const color = pct >= 90 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-rose-400";
                        return (
                          <button
                            key={x.id}
                            onClick={() => setSelectedSite(x)}
                            className={`w-full text-left p-3 hover:bg-muted/30 ${selectedSite?.id === x.id ? "bg-muted/40 border-l-2 border-l-sky-500" : ""}`}
                            data-testid={`unifi-site-${x.id}`}
                          >
                            <div className="text-sm font-medium truncate">{x.name || x.id}</div>
                            <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-2 mt-0.5">
                              <span className={color}>{x.devices_online}/{x.devices} dev</span>
                              <span>·</span>
                              <span>{x.clients} clients</span>
                              {x.alerts > 0 && <Badge variant="outline" className="text-[9px] text-rose-400 border-rose-500/30 ml-auto">{x.alerts} alerts</Badge>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  {!selectedSite ? (
                    <div className="text-center py-12 text-xs text-muted-foreground">Select a site to view devices, clients, networks, and alerts.</div>
                  ) : loadingSite ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading site data…</div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="text-lg font-semibold">{selectedSite.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono mt-0.5">site: {selectedSite.id}{selectedSite.host_id ? ` · host: ${selectedSite.host_id}` : ""}</div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setLinkDialog(selectedSite)} data-testid="unifi-link-client-btn">
                          <LinkIcon className="w-3 h-3 mr-1" />Link to client
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div className="rounded border border-border p-2 bg-muted/20">
                          <div className="text-[10px] uppercase text-muted-foreground">Devices</div>
                          <div className="text-lg font-semibold"><span className="text-emerald-400">{devices.filter(d => d.status === "online" || d.status === "connected").length}</span> <span className="text-muted-foreground">/ {devices.length}</span></div>
                        </div>
                        <div className="rounded border border-border p-2 bg-muted/20">
                          <div className="text-[10px] uppercase text-muted-foreground">Clients</div>
                          <div className="text-lg font-semibold">{clientsData.summary?.total ?? clientsData.items.length}</div>
                          {clientsData.summary && (
                            <div className="text-[9px] text-muted-foreground font-mono">wifi {clientsData.summary.wifi} · wired {clientsData.summary.wired}{clientsData.summary.guest ? ` · guest ${clientsData.summary.guest}` : ""}</div>
                          )}
                        </div>
                        <div className="rounded border border-border p-2 bg-muted/20">
                          <div className="text-[10px] uppercase text-muted-foreground">Networks</div>
                          <div className="text-lg font-semibold">{networksData.summary ? (networksData.summary.wlan_configured + networksData.summary.lan_configured) : networksData.items.length}</div>
                          {networksData.summary && (
                            <div className="text-[9px] text-muted-foreground font-mono">wlan {networksData.summary.wlan_configured} · lan {networksData.summary.lan_configured}</div>
                          )}
                        </div>
                        <div className="rounded border border-border p-2 bg-muted/20">
                          <div className="text-[10px] uppercase text-muted-foreground">Critical</div>
                          <div className={`text-lg font-semibold ${(alertsData.summary?.critical_notifications ?? alertsData.items.length) ? "text-rose-400" : "text-emerald-400"}`}>
                            {alertsData.summary?.critical_notifications ?? alertsData.items.length}
                          </div>
                        </div>
                      </div>

                      <Tabs defaultValue="devices">
                        <TabsList>
                          <TabsTrigger value="devices" data-testid="unifi-subtab-devices"><Radio className="w-3 h-3 mr-1" />Devices</TabsTrigger>
                          <TabsTrigger value="clients" data-testid="unifi-subtab-clients"><Users className="w-3 h-3 mr-1" />Clients</TabsTrigger>
                          <TabsTrigger value="networks" data-testid="unifi-subtab-networks"><Network className="w-3 h-3 mr-1" />SSIDs</TabsTrigger>
                          <TabsTrigger value="alerts" data-testid="unifi-subtab-alerts"><AlertTriangle className="w-3 h-3 mr-1" />Alerts</TabsTrigger>
                        </TabsList>

                        <TabsContent value="devices" className="mt-3">
                          {devices.length === 0 ? (
                            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-4 text-xs space-y-2" data-testid="unifi-devices-empty">
                              <div className="font-medium text-amber-300 flex items-center gap-2">
                                <AlertTriangle className="w-3.5 h-3.5" />Site Manager API returned no devices for this host
                              </div>
                              <div className="text-zinc-400 leading-relaxed">
                                This site has <span className="font-mono text-emerald-400">{selectedSite.devices_online ?? 0}/{selectedSite.devices ?? 0}</span> devices reported in stats,
                                but the <code className="bg-muted/30 px-1 rounded">/v1/devices</code> endpoint returned an empty list.
                              </div>
                              <div className="text-zinc-400 leading-relaxed">
                                <span className="text-amber-300 font-medium">This is a known Ubiquiti issue</span> on Site Manager 5.2.x — Ubiquiti's own API returns 200 OK with no data for some hosts.
                                {" "}<a className="text-sky-400 hover:underline" href="https://community.ui.com/questions/Site-Manager-5-2-1-API-List-devices-not-working/970aa5fc-72fc-4553-b76c-0eda9dc3fd16" target="_blank" rel="noreferrer">See community thread</a>.
                              </div>
                              <div className="text-zinc-500">
                                For full device-level access (with restart/locate actions), use the <strong>UniFi Network API</strong> directly per-controller — open <code className="bg-muted/30 px-1 rounded">UniFi Network → Settings → Control Plane → Integrations</code> on each console to generate a Network API key. That's the only API Ubiquiti exposes write actions on today.
                              </div>
                            </div>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-[10px] uppercase">Name</TableHead>
                                  <TableHead className="text-[10px] uppercase">Model</TableHead>
                                  <TableHead className="text-[10px] uppercase">Status</TableHead>
                                  <TableHead className="text-[10px] uppercase">IP</TableHead>
                                  <TableHead className="text-[10px] uppercase">Uptime</TableHead>
                                  <TableHead className="text-[10px] uppercase">Firmware</TableHead>
                                  <TableHead className="text-right text-[10px] uppercase">Actions</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {devices.map((d) => (
                                  <TableRow key={d.id} data-testid={`unifi-device-${d.id}`}>
                                    <TableCell className="font-medium text-sm">{d.name || d.model || d.mac}</TableCell>
                                    <TableCell className="text-xs font-mono">{d.model || d.type}</TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className={d.status === "online" || d.status === "connected" ? "text-emerald-400 border-emerald-500/30" : d.status === "unknown" ? "text-zinc-400 border-zinc-700" : "text-rose-400 border-rose-500/30"}>
                                        {d.status}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-xs font-mono">{d.ip || "—"}</TableCell>
                                    <TableCell className="text-xs font-mono">{uptimeHuman(d.uptime)}</TableCell>
                                    <TableCell className="text-[10px] font-mono">{d.firmware || "—"}{d.firmware_status === "updateAvailable" && <Badge variant="outline" className="ml-1 text-[9px] text-amber-400 border-amber-500/30">update</Badge>}</TableCell>
                                    <TableCell className="text-right">
                                      <div className="flex gap-1 justify-end">
                                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={actionBusy === `${d.id}:locate`} onClick={() => doDeviceAction(d, "locate")} title="Locate (LED blink)" data-testid={`unifi-action-locate-${d.id}`}>
                                          {actionBusy === `${d.id}:locate` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lightbulb className="w-3 h-3" />}
                                        </Button>
                                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={actionBusy === `${d.id}:power-cycle`} onClick={() => doDeviceAction(d, "power-cycle")} title="Power-cycle PoE port" data-testid={`unifi-action-power-${d.id}`}>
                                          {actionBusy === `${d.id}:power-cycle` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                                        </Button>
                                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-amber-400" disabled={actionBusy === `${d.id}:restart`} onClick={() => doDeviceAction(d, "restart")} title="Restart device" data-testid={`unifi-action-restart-${d.id}`}>
                                          {actionBusy === `${d.id}:restart` ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </TabsContent>

                        <TabsContent value="clients" className="mt-3">
                          {clientsData.summary && !clientsData.supported ? (
                            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-4 text-xs">
                              <div className="font-medium text-amber-300 mb-2">Client counts (Site Manager API)</div>
                              <div className="grid grid-cols-3 gap-2">
                                <div className="rounded border border-border p-2 bg-muted/20">
                                  <div className="text-[10px] uppercase text-muted-foreground">Wi-Fi</div>
                                  <div className="text-lg font-semibold text-indigo-400">{clientsData.summary.wifi}</div>
                                </div>
                                <div className="rounded border border-border p-2 bg-muted/20">
                                  <div className="text-[10px] uppercase text-muted-foreground">Wired</div>
                                  <div className="text-lg font-semibold text-sky-400">{clientsData.summary.wired}</div>
                                </div>
                                <div className="rounded border border-border p-2 bg-muted/20">
                                  <div className="text-[10px] uppercase text-muted-foreground">Guest</div>
                                  <div className="text-lg font-semibold text-violet-400">{clientsData.summary.guest}</div>
                                </div>
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-3">{clientsData.message}</div>
                            </div>
                          ) : clientsData.items.length === 0 ? (
                            <div className="text-center py-8 text-xs text-muted-foreground">No clients connected.</div>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-[10px] uppercase">Name</TableHead>
                                  <TableHead className="text-[10px] uppercase">Type</TableHead>
                                  <TableHead className="text-[10px] uppercase">Network</TableHead>
                                  <TableHead className="text-[10px] uppercase">IP</TableHead>
                                  <TableHead className="text-[10px] uppercase">Signal</TableHead>
                                  <TableHead className="text-[10px] uppercase">↓ / ↑</TableHead>
                                  <TableHead className="text-[10px] uppercase">MAC</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {clientsData.items.slice(0, 200).map((c) => (
                                  <TableRow key={c.id} data-testid={`unifi-client-${c.id}`}>
                                    <TableCell className="text-sm">{c.name || c.manufacturer || "—"}</TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className={c.is_wired ? "text-sky-400 border-sky-500/30" : "text-indigo-400 border-indigo-500/30"}>
                                        {c.is_wired ? "wired" : "wifi"}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-xs">{c.network || "—"}</TableCell>
                                    <TableCell className="text-xs font-mono">{c.ip || "—"}</TableCell>
                                    <TableCell className="text-[10px] font-mono">
                                      {c.signal ? (<span className="flex items-center gap-1"><Signal className="w-3 h-3" />{c.signal}</span>) : "—"}
                                    </TableCell>
                                    <TableCell className="text-[10px] font-mono">{bytesHuman(c.rx_bytes)} / {bytesHuman(c.tx_bytes)}</TableCell>
                                    <TableCell className="text-[10px] font-mono text-muted-foreground">{c.mac}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </TabsContent>

                        <TabsContent value="networks" className="mt-3">
                          {networksData.summary && !networksData.supported ? (
                            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-4 text-xs">
                              <div className="font-medium text-amber-300 mb-2">Network counts (Site Manager API)</div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="rounded border border-border p-2 bg-muted/20">
                                  <div className="text-[10px] uppercase text-muted-foreground">Wireless (WLAN) configured</div>
                                  <div className="text-lg font-semibold text-indigo-400">{networksData.summary.wlan_configured}</div>
                                </div>
                                <div className="rounded border border-border p-2 bg-muted/20">
                                  <div className="text-[10px] uppercase text-muted-foreground">Wired (LAN) configured</div>
                                  <div className="text-lg font-semibold text-sky-400">{networksData.summary.lan_configured}</div>
                                </div>
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-3">{networksData.message}</div>
                            </div>
                          ) : networksData.items.length === 0 ? (
                            <div className="text-center py-8 text-xs text-muted-foreground">No networks/SSIDs.</div>
                          ) : (
                            <Table>
                              <TableHeader><TableRow>
                                <TableHead className="text-[10px] uppercase">SSID</TableHead>
                                <TableHead className="text-[10px] uppercase">Security</TableHead>
                                <TableHead className="text-[10px] uppercase">VLAN</TableHead>
                                <TableHead className="text-[10px] uppercase">Clients</TableHead>
                                <TableHead className="text-[10px] uppercase">Status</TableHead>
                              </TableRow></TableHeader>
                              <TableBody>
                                {networksData.items.map((n) => (
                                  <TableRow key={n.id} data-testid={`unifi-network-${n.id}`}>
                                    <TableCell className="font-medium text-sm">{n.ssid || n.name}</TableCell>
                                    <TableCell className="text-xs font-mono">{n.security || "—"}</TableCell>
                                    <TableCell className="text-xs font-mono">{n.vlan || "—"}</TableCell>
                                    <TableCell className="text-xs font-mono">{n.num_clients || 0}</TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className={n.enabled ? "text-emerald-400 border-emerald-500/30" : "text-zinc-500 border-zinc-700"}>
                                        {n.enabled ? "enabled" : "disabled"}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </TabsContent>

                        <TabsContent value="alerts" className="mt-3">
                          {alertsData.summary && !alertsData.supported ? (
                            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-4 text-xs">
                              <div className="font-medium text-amber-300 mb-2">Critical notifications (Site Manager API)</div>
                              <div className="rounded border border-border p-2 bg-muted/20 max-w-xs">
                                <div className="text-[10px] uppercase text-muted-foreground">Critical</div>
                                <div className={`text-2xl font-semibold ${alertsData.summary.critical_notifications ? "text-rose-400" : "text-emerald-400"}`}>
                                  {alertsData.summary.critical_notifications}
                                </div>
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-3">{alertsData.message}</div>
                            </div>
                          ) : alertsData.items.length === 0 ? (
                            <div className="text-center py-8 text-xs text-emerald-400">All clear — no active alerts.</div>
                          ) : (
                            <div className="space-y-1 max-h-96 overflow-y-auto">
                              {alertsData.items.map((a) => (
                                <div key={a.id} className="flex items-start gap-2 p-2 rounded border border-border bg-muted/10" data-testid={`unifi-alert-${a.id}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${a.severity === "critical" ? "bg-rose-400" : a.severity === "warning" ? "bg-amber-400" : "bg-sky-400"}`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs">{a.message || a.type}</div>
                                    <div className="text-[10px] text-muted-foreground font-mono">{a.type}</div>
                                  </div>
                                  <span className="text-[10px] text-muted-foreground font-mono shrink-0">{a.timestamp ? new Date(a.timestamp).toLocaleString() : ""}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </TabsContent>
                      </Tabs>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="controllers" className="space-y-4">
            <ControllersPanel />
          </TabsContent>

          <TabsContent value="linked">
            <Card>
              <CardContent className="p-0">
                {linkedClients.length === 0 ? (
                  <div className="text-center py-12 text-xs text-muted-foreground">No clients linked to a UniFi site yet.</div>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead className="text-[10px] uppercase">Client</TableHead>
                      <TableHead className="text-[10px] uppercase">Site</TableHead>
                      <TableHead className="text-[10px] uppercase">Site ID</TableHead>
                      <TableHead className="text-[10px] uppercase">Linked</TableHead>
                      <TableHead></TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {linkedClients.map((c) => (
                        <TableRow key={c.id} data-testid={`unifi-linked-${c.id}`}>
                          <TableCell className="font-medium text-sm">{c.name}</TableCell>
                          <TableCell className="text-xs">{c.unifi_site_name || "—"}</TableCell>
                          <TableCell className="text-[10px] font-mono text-muted-foreground">{c.unifi_site_id}</TableCell>
                          <TableCell className="text-[10px] font-mono text-muted-foreground">{c.unifi_linked_at ? new Date(c.unifi_linked_at).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" asChild><Link to={`/clients`}>Open<ExternalLink className="w-3 h-3 ml-1" /></Link></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!linkDialog} onOpenChange={() => setLinkDialog(null)}>
        <DialogContent data-testid="unifi-link-dialog">
          <DialogHeader>
            <DialogTitle>Link UniFi site to NexusOps client</DialogTitle>
            <DialogDescription>{linkDialog?.name}</DialogDescription>
          </DialogHeader>
          <Select value={linkClientId} onValueChange={setLinkClientId}>
            <SelectTrigger data-testid="unifi-link-client-select"><SelectValue placeholder="Pick a client" /></SelectTrigger>
            <SelectContent>
              {allClients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkDialog(null)}>Cancel</Button>
            <Button onClick={handleLink} disabled={busy || !linkClientId} data-testid="unifi-submit-link"><LinkIcon className="w-4 h-4 mr-1" />Link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function ControllersPanel() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(null);
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = async () => {
    try {
      const r = await axios.get(`${API}/unifi/controllers`, { headers });
      setList(r.data || []);
      if (r.data?.length && !selected) setSelected(r.data[0]);
    } catch { /* ignore */ }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const fetchSummary = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API}/unifi/controllers/${selected.id}/summary`, { headers });
      setSummary(r.data);
    } catch (e) {
      setSummary({ error: e.response?.data?.detail || e.message, devices: [], clients: [], stats: {} });
    } finally { setLoading(false); }
  }, [selected, headers]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // Auto-refresh every 30s when toggled
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchSummary, 30000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchSummary]);

  const action = async (deviceId, act) => {
    if (!selected) return;
    const labels = { restart: "Restart", "power-cycle": "Power-cycle", locate: "Locate (LED blink)" };
    if (!window.confirm(`${labels[act]} this device?`)) return;
    setActionBusy(`${deviceId}:${act}`);
    try {
      const res = await axios.post(`${API}/unifi/controllers/${selected.id}/devices/${deviceId}/${act}`, {}, { headers });
      if (res.data?.success) toast.success(res.data.message || `${labels[act]} sent`);
      else toast.error(res.data?.message || "Failed");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setActionBusy(null); }
  };

  const restartAllOffline = async () => {
    if (!summary?.devices?.length) return;
    const offline = summary.devices.filter(d => d.status !== "online" && d.status !== "connected");
    if (offline.length === 0) { toast.info("No offline devices."); return; }
    if (!window.confirm(`Restart ${offline.length} offline device(s)?`)) return;
    setBulkBusy(true);
    let ok = 0, fail = 0;
    for (const d of offline) {
      try {
        const r = await axios.post(`${API}/unifi/controllers/${selected.id}/devices/${d.id}/restart`, {}, { headers });
        r.data?.success ? ok++ : fail++;
      } catch { fail++; }
    }
    setBulkBusy(false);
    toast.success(`Restart issued to ${ok} device(s)${fail ? ` · ${fail} failed` : ""}`);
    fetchSummary();
  };

  const exportCsv = () => {
    if (!summary?.devices?.length) return;
    const cols = ["name", "model", "status", "ip", "mac", "uptime", "firmware"];
    const csv = [cols.join(","), ...summary.devices.map(d => cols.map(k => `"${(d[k] ?? "")}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `unifi-${selected.name.replace(/\s+/g, "-")}-devices.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (list.length === 0) {
    return (
      <Card><CardContent className="p-12 text-center text-xs text-muted-foreground">
        <Wifi className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
        <div className="text-sm font-medium text-foreground mb-1">No controllers configured</div>
        <div>Go to <Link to="/settings?tab=integrations&anchor=unifi-settings-card" className="text-sky-400 underline">Settings → UniFi → Direct Site Controllers</Link> to add one.</div>
      </CardContent></Card>
    );
  }

  // Charts data
  const devs = summary?.devices || [];
  const cli = summary?.clients || [];
  const onlineCount = devs.filter(d => d.status === "online" || d.status === "connected").length;
  const offlineCount = devs.length - onlineCount;
  const wifiCount = cli.filter(c => !c.is_wired).length;
  const wiredCount = cli.length - wifiCount;
  const updateAvail = devs.filter(d => d.firmware_status === "updateAvailable").length;

  const deviceStatusData = [
    { name: "Online", value: onlineCount, color: "#34d399" },
    { name: "Offline", value: offlineCount, color: "#fb7185" },
  ];
  const clientTypeData = [
    { name: "Wi-Fi", value: wifiCount, color: "#818cf8" },
    { name: "Wired", value: wiredCount, color: "#38bdf8" },
  ];

  // Group devices by model for the model breakdown
  const byModel = {};
  devs.forEach(d => { byModel[d.model || "Unknown"] = (byModel[d.model || "Unknown"] || 0) + 1; });
  const modelData = Object.entries(byModel).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);

  // Top talkers by RX+TX
  const topTalkers = [...cli].map(c => ({ ...c, total: (c.rx_bytes || 0) + (c.tx_bytes || 0) })).sort((a, b) => b.total - a.total).slice(0, 8);

  const filteredDevs = deviceFilter === "all" ? devs
    : deviceFilter === "online" ? devs.filter(d => d.status === "online" || d.status === "connected")
    : deviceFilter === "offline" ? devs.filter(d => d.status !== "online" && d.status !== "connected")
    : deviceFilter === "update" ? devs.filter(d => d.firmware_status === "updateAvailable")
    : devs;

  const healthPct = devs.length ? Math.round((onlineCount / devs.length) * 100) : 0;
  const healthColor = healthPct >= 90 ? "#34d399" : healthPct >= 60 ? "#fbbf24" : "#fb7185";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
      {/* Controller picker */}
      <Card>
        <CardContent className="p-0">
          <div className="px-3 py-2 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center justify-between">
            <span>Controllers ({list.length})</span>
          </div>
          <div className="divide-y divide-border max-h-[calc(100vh-280px)] overflow-y-auto">
            {list.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className={`w-full text-left p-3 hover:bg-muted/30 transition-colors ${selected?.id === c.id ? "bg-sky-500/5 border-l-2 border-l-sky-500" : "border-l-2 border-l-transparent"}`}
                data-testid={`unifi-ctrl-pick-${c.id}`}
              >
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${c.last_test_status === "ok" ? "bg-emerald-400" : c.last_test_status?.startsWith("fail") ? "bg-rose-400" : "bg-zinc-500"}`} />
                  {c.name}
                </div>
                <div className="text-[10px] font-mono text-muted-foreground truncate mt-0.5">{c.controller_url}</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Detail panel */}
      <div className="space-y-4">
        {!selected ? (
          <Card><CardContent className="p-12 text-center text-xs text-muted-foreground">Pick a controller.</CardContent></Card>
        ) : loading && !summary ? (
          <Card><CardContent className="p-12 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading {selected.name}…</CardContent></Card>
        ) : summary?.error ? (
          <Card><CardContent className="p-6">
            <div className="rounded border border-rose-500/30 bg-rose-500/5 p-4 text-xs text-rose-300">
              <div className="flex items-center gap-2 font-medium mb-2"><AlertTriangle className="w-4 h-4" />Couldn't reach this controller</div>
              <div className="font-mono text-[11px] break-all">{summary.error}</div>
              <div className="text-muted-foreground mt-3 leading-relaxed">
                Check: 1) controller URL is reachable from the NexusOps server, 2) API key is correct, 3) UniFi Network is 9.0+, 4) if local — VPN/Tailscale to reach it.
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={fetchSummary}><RefreshCw className="w-3 h-3 mr-1" />Retry</Button>
                <Button size="sm" variant="ghost" asChild><Link to="/settings?tab=integrations&anchor=unifi-settings-card"><ExternalLink className="w-3 h-3 mr-1" />Edit credentials</Link></Button>
              </div>
            </div>
          </CardContent></Card>
        ) : summary ? (
          <>
            {/* Header */}
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <div className="text-xl font-semibold flex items-center gap-2">
                  <Wifi className="w-5 h-5 text-sky-400" />{summary.controller.name}
                  <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">live</Badge>
                </div>
                <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{summary.controller.controller_url} · site: {summary.controller.network_site_id}</div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => setAutoRefresh(!autoRefresh)} data-testid="unifi-ctrl-auto-refresh">
                  <Activity className={`w-3 h-3 mr-1 ${autoRefresh ? "text-emerald-400 animate-pulse" : ""}`} />
                  {autoRefresh ? "Auto: 30s" : "Auto-refresh"}
                </Button>
                <Button size="sm" variant="outline" onClick={fetchSummary} disabled={loading} data-testid="unifi-ctrl-refresh">
                  {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}Refresh
                </Button>
                <Button size="sm" variant="outline" asChild><a href={summary.controller.controller_url} target="_blank" rel="noreferrer" data-testid="unifi-ctrl-open"><ExternalLink className="w-3 h-3 mr-1" />Open in UniFi</a></Button>
              </div>
            </div>

            {/* Hero metrics + health gauge */}
            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
              <Card>
                <CardContent className="p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold text-center mb-1">Network Health</div>
                  <div style={{ width: "100%", height: 140 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RadialBarChart innerRadius="65%" outerRadius="100%" data={[{ value: healthPct, fill: healthColor }]} startAngle={225} endAngle={-45}>
                        <RadialBar dataKey="value" cornerRadius={8} background={{ fill: "rgba(255,255,255,0.05)" }} />
                      </RadialBarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-center -mt-24 mb-12">
                    <div className="text-4xl font-bold" style={{ color: healthColor }}>{healthPct}%</div>
                    <div className="text-[10px] text-muted-foreground">{onlineCount} of {devs.length} online</div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard icon={<Radio className="w-4 h-4 text-emerald-400" />} label="Devices Online" value={onlineCount} sub={`${offlineCount} offline`} accent="emerald" testid="unifi-ctrl-m-online" />
                <MetricCard icon={<Users className="w-4 h-4 text-indigo-400" />} label="Total Clients" value={cli.length} sub={`${wifiCount} wifi · ${wiredCount} wired`} accent="indigo" testid="unifi-ctrl-m-clients" />
                <MetricCard icon={<Zap className="w-4 h-4 text-amber-400" />} label="Updates Available" value={updateAvail} sub={updateAvail ? "Plan a maintenance window" : "All up to date"} accent={updateAvail ? "amber" : "emerald"} testid="unifi-ctrl-m-updates" />
                <MetricCard icon={<ShieldCheck className="w-4 h-4 text-violet-400" />} label="Models" value={modelData.length} sub={modelData[0]?.name || "—"} accent="violet" testid="unifi-ctrl-m-models" />
              </div>
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Device Status</div>
                  <div style={{ width: "100%", height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                      <PieChart>
                        <Pie data={deviceStatusData} dataKey="value" innerRadius={40} outerRadius={62} paddingAngle={2}>
                          {deviceStatusData.map((d, i) => <Cell key={i} fill={d.color} stroke="none" />)}
                        </Pie>
                        <RTooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-center gap-3 text-[10px] -mt-2">
                    {deviceStatusData.map(d => (<span key={d.name} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: d.color }} />{d.name}: {d.value}</span>))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Client Mix</div>
                  <div style={{ width: "100%", height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                      <PieChart>
                        <Pie data={clientTypeData} dataKey="value" innerRadius={40} outerRadius={62} paddingAngle={2}>
                          {clientTypeData.map((d, i) => <Cell key={i} fill={d.color} stroke="none" />)}
                        </Pie>
                        <RTooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-center gap-3 text-[10px] -mt-2">
                    {clientTypeData.map(d => (<span key={d.name} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: d.color }} />{d.name}: {d.value}</span>))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Devices by Model</div>
                  <div style={{ width: "100%", height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                      <BarChart data={modelData} layout="vertical" margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 10 }} width={70} />
                        <RTooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }} />
                        <Bar dataKey="value" fill="#38bdf8" radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Top talkers + actions */}
            {topTalkers.length > 0 && (
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5"><TrendingUp className="w-3 h-3" />Top Talkers (RX + TX)</div>
                    <Badge variant="outline" className="text-[10px]">{topTalkers.length} clients</Badge>
                  </div>
                  <div className="space-y-1.5">
                    {topTalkers.map((c, i) => {
                      const max = topTalkers[0].total || 1;
                      const pct = (c.total / max) * 100;
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs" data-testid={`unifi-ctrl-talker-${i}`}>
                          <div className="w-32 truncate">{c.name || c.manufacturer || c.mac}</div>
                          <div className="flex-1 h-2 bg-muted/30 rounded overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-indigo-500 to-sky-400" style={{ width: `${pct}%`, transition: "width 600ms" }} />
                          </div>
                          <div className="w-20 text-right font-mono text-[10px] text-muted-foreground">{bytesHuman(c.total)}</div>
                          <Badge variant="outline" className={`text-[9px] ${c.is_wired ? "text-sky-400 border-sky-500/30" : "text-indigo-400 border-indigo-500/30"}`}>{c.is_wired ? "wired" : "wifi"}</Badge>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Devices + Clients tables */}
            <Tabs defaultValue="devices">
              <TabsList>
                <TabsTrigger value="devices"><Radio className="w-3 h-3 mr-1" />Devices ({devs.length})</TabsTrigger>
                <TabsTrigger value="clients"><Users className="w-3 h-3 mr-1" />Clients ({cli.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="devices" className="mt-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex gap-1">
                    {[
                      { k: "all", label: "All", count: devs.length },
                      { k: "online", label: "Online", count: onlineCount, color: "text-emerald-400" },
                      { k: "offline", label: "Offline", count: offlineCount, color: "text-rose-400" },
                      { k: "update", label: "Updates", count: updateAvail, color: "text-amber-400" },
                    ].map(f => (
                      <Button key={f.k} size="sm" variant={deviceFilter === f.k ? "secondary" : "ghost"} className="h-7 text-[10px]" onClick={() => setDeviceFilter(f.k)} data-testid={`unifi-ctrl-filter-${f.k}`}>
                        <span className={f.color}>{f.label}</span> <span className="ml-1 text-muted-foreground">{f.count}</span>
                      </Button>
                    ))}
                  </div>
                  <div className="flex-1" />
                  <Button size="sm" variant="outline" onClick={exportCsv} disabled={!devs.length} data-testid="unifi-ctrl-export"><Download className="w-3 h-3 mr-1" />CSV</Button>
                  <Button size="sm" variant="outline" onClick={restartAllOffline} disabled={bulkBusy || offlineCount === 0} className="text-amber-400" data-testid="unifi-ctrl-restart-offline">
                    {bulkBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RotateCw className="w-3 h-3 mr-1" />}Restart {offlineCount} offline
                  </Button>
                </div>

                <Card>
                  <CardContent className="p-0">
                    {filteredDevs.length === 0 ? (
                      <div className="text-center py-8 text-xs text-muted-foreground">No devices match this filter.</div>
                    ) : (
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead className="text-[10px] uppercase">Device</TableHead>
                          <TableHead className="text-[10px] uppercase">Status</TableHead>
                          <TableHead className="text-[10px] uppercase">IP</TableHead>
                          <TableHead className="text-[10px] uppercase">Uptime</TableHead>
                          <TableHead className="text-[10px] uppercase">Firmware</TableHead>
                          <TableHead className="text-right text-[10px] uppercase">Actions</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {filteredDevs.map((d) => (
                            <TableRow key={d.id} data-testid={`unifi-ctrl-device-${d.id}`}>
                              <TableCell>
                                <div className="font-medium text-sm">{d.name || d.model || d.mac}</div>
                                <div className="text-[10px] text-muted-foreground font-mono">{d.model} · {d.mac}</div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={d.status === "online" || d.status === "connected" ? "text-emerald-400 border-emerald-500/30" : "text-rose-400 border-rose-500/30"}>
                                  <span className={`w-1.5 h-1.5 rounded-full mr-1 ${d.status === "online" || d.status === "connected" ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`} />
                                  {d.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs font-mono">{d.ip || "—"}</TableCell>
                              <TableCell className="text-xs font-mono">{uptimeHuman(d.uptime)}</TableCell>
                              <TableCell className="text-[10px] font-mono">
                                {d.firmware || "—"}
                                {d.firmware_status === "updateAvailable" && <Badge variant="outline" className="ml-1 text-[9px] text-amber-400 border-amber-500/30">update</Badge>}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex gap-1 justify-end">
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={actionBusy === `${d.id}:locate`} onClick={() => action(d.id, "locate")} title="Locate (LED blink)" data-testid={`unifi-ctrl-locate-${d.id}`}>
                                    {actionBusy === `${d.id}:locate` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lightbulb className="w-3 h-3" />}
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={actionBusy === `${d.id}:power-cycle`} onClick={() => action(d.id, "power-cycle")} title="Power-cycle PoE" data-testid={`unifi-ctrl-power-${d.id}`}>
                                    {actionBusy === `${d.id}:power-cycle` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-amber-400" disabled={actionBusy === `${d.id}:restart`} onClick={() => action(d.id, "restart")} title="Restart device" data-testid={`unifi-ctrl-restart-${d.id}`}>
                                    {actionBusy === `${d.id}:restart` ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="clients" className="mt-3">
                <Card>
                  <CardContent className="p-0">
                    {cli.length === 0 ? (
                      <div className="text-center py-8 text-xs text-muted-foreground">No connected clients.</div>
                    ) : (
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead className="text-[10px] uppercase">Name</TableHead>
                          <TableHead className="text-[10px] uppercase">Type</TableHead>
                          <TableHead className="text-[10px] uppercase">Network</TableHead>
                          <TableHead className="text-[10px] uppercase">IP</TableHead>
                          <TableHead className="text-[10px] uppercase">Signal</TableHead>
                          <TableHead className="text-[10px] uppercase">↓ / ↑</TableHead>
                          <TableHead className="text-[10px] uppercase">MAC</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {cli.slice(0, 200).map((c) => (
                            <TableRow key={c.id} data-testid={`unifi-ctrl-client-${c.id}`}>
                              <TableCell className="text-sm">{c.name || c.manufacturer || "—"}</TableCell>
                              <TableCell><Badge variant="outline" className={c.is_wired ? "text-sky-400 border-sky-500/30" : "text-indigo-400 border-indigo-500/30"}>{c.is_wired ? "wired" : "wifi"}</Badge></TableCell>
                              <TableCell className="text-xs">{c.network || "—"}</TableCell>
                              <TableCell className="text-xs font-mono">{c.ip || "—"}</TableCell>
                              <TableCell className="text-[10px] font-mono">{c.signal ? <span className="flex items-center gap-1"><Signal className="w-3 h-3" />{c.signal}</span> : "—"}</TableCell>
                              <TableCell className="text-[10px] font-mono">{bytesHuman(c.rx_bytes)} / {bytesHuman(c.tx_bytes)}</TableCell>
                              <TableCell className="text-[10px] font-mono text-muted-foreground">{c.mac}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, sub, accent = "indigo", testid }) {
  const accentBg = {
    emerald: "from-emerald-500/10 to-emerald-500/0 border-emerald-500/20",
    indigo: "from-indigo-500/10 to-indigo-500/0 border-indigo-500/20",
    amber: "from-amber-500/10 to-amber-500/0 border-amber-500/20",
    violet: "from-violet-500/10 to-violet-500/0 border-violet-500/20",
    rose: "from-rose-500/10 to-rose-500/0 border-rose-500/20",
  };
  return (
    <Card className={`bg-gradient-to-br ${accentBg[accent] || accentBg.indigo}`} data-testid={testid}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1">{icon}<span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</span></div>
        <div className="text-3xl font-bold tabular-nums leading-none">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-1.5 truncate">{sub}</div>}
      </CardContent>
    </Card>
  );
}
