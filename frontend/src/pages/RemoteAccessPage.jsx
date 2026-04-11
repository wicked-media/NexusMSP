import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Laptop, Monitor, Server, Wifi, WifiOff, Settings, Plus, RefreshCw, Loader2,
  ExternalLink, Copy, Search, Play, Clock, Shield, Download, ChevronRight,
  Link2, Unlink, Eye, EyeOff, Pencil, Check, X, History, Zap, Globe,
  Terminal, Rocket, CheckCircle, AlertCircle, SquareCheckBig, XCircle,
  Plug, Power, TestTube, Save, BookOpen
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

const TYPE_ICONS = { server: Server, workstation: Monitor, laptop: Laptop, network: Wifi };

export default function RemoteAccessPage() {
  const { token } = useAuth();
  const [devices, setDevices] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterRegistered, setFilterRegistered] = useState("all");
  const [tab, setTab] = useState("devices");
  const [quickId, setQuickId] = useState("");
  const [showAssign, setShowAssign] = useState(null);
  const [assignForm, setAssignForm] = useState({ rustdesk_id: "", rustdesk_password: "" });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ server_url: "", api_key: "", relay_server: "", enabled: true, auto_sync: true });
  const [showPassword, setShowPassword] = useState({});
  const [connecting, setConnecting] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDevices, setSelectedDevices] = useState(new Set());
  const [deployments, setDeployments] = useState(null);
  const [deployingDevice, setDeployingDevice] = useState(null);
  const [deployCmd, setDeployCmd] = useState("");
  const [showDeployDialog, setShowDeployDialog] = useState(false);
  const [showBulkDeploy, setShowBulkDeploy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState(null);
  const [livePeers, setLivePeers] = useState(null);
  // Providers / Integrations
  const [providers, setProviders] = useState([]);
  const [providerConfig, setProviderConfig] = useState(null);
  const [providerForm, setProviderForm] = useState({});
  const [savingProvider, setSavingProvider] = useState(false);
  const [testingProvider, setTestingProvider] = useState(null);
  const [providerTestResult, setProviderTestResult] = useState({});
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, sRes, cRes, pRes] = await Promise.all([
        axios.get(`${API}/rustdesk/all-devices`, { headers }),
        axios.get(`${API}/rustdesk/sessions`, { headers }),
        axios.get(`${API}/rustdesk/config`, { headers }),
        axios.get(`${API}/remote-providers`, { headers }).catch(() => ({ data: [] })),
      ]);
      setDevices(dRes.data);
      setSessions(sRes.data);
      setConfig(cRes.data?.value || cRes.data);
      setProviders(pRes.data || []);
      axios.get(`${API}/rustdesk/agent-deployments`, { headers }).then(r => setDeployments(r.data)).catch(() => {});
      const cfg = cRes.data?.value || cRes.data;
      if (cfg?.enabled && cfg?.server_url) {
        axios.get(`${API}/rustdesk/live/peers`, { headers }).then(r => setLivePeers(r.data)).catch(() => setLivePeers(null));
      }
    } catch { toast.error("Failed to load remote access data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Provider functions
  const openProviderConfig = async (provider) => {
    setProviderConfig(provider);
    setProviderTestResult({});
    try {
      const res = await axios.get(`${API}/remote-providers/${provider.id}/settings`, { headers });
      const form = {};
      provider.config_fields.forEach(f => { form[f.key] = res.data[f.key] || ""; });
      form.active = res.data.active || false;
      setProviderForm(form);
    } catch { setProviderForm({ active: false }); }
  };

  const saveProviderSettings = async () => {
    if (!providerConfig) return;
    setSavingProvider(true);
    try {
      await axios.put(`${API}/remote-providers/${providerConfig.id}/settings`, providerForm, { headers });
      toast.success(`${providerConfig.name} settings saved`);
      fetchData();
    } catch { toast.error("Failed to save settings"); }
    finally { setSavingProvider(false); }
  };

  const toggleProvider = async (provider) => {
    try {
      const res = await axios.put(`${API}/remote-providers/${provider.id}/toggle`, {}, { headers });
      toast.success(res.data.message);
      fetchData();
    } catch { toast.error("Failed to toggle provider"); }
  };

  const testProviderConnection = async (provider) => {
    setTestingProvider(provider.id);
    try {
      const res = await axios.post(`${API}/remote-providers/${provider.id}/test`, {}, { headers });
      setProviderTestResult(prev => ({ ...prev, [provider.id]: res.data }));
      if (res.data.success) toast.success(res.data.message);
      else toast.error(res.data.message);
    } catch { toast.error("Connection test failed"); }
    finally { setTestingProvider(null); }
  };

  // Quick connect
  const quickConnect = async () => {
    if (!quickId.trim()) return;
    setConnecting("quick");
    try {
      await axios.post(`${API}/rustdesk/quick-connect`, { rustdesk_id: quickId }, { headers });
      window.open(`rustdesk://${quickId}`, "_blank");
      toast.success(`Connecting to ${quickId}...`);
      setQuickId("");
      fetchData();
    } catch { toast.error("Connection failed"); }
    finally { setConnecting(null); }
  };

  // Connect to registered device
  const connectDevice = async (device) => {
    const rdId = device.rd_id;
    if (!rdId) { toast.error("No RustDesk ID assigned to this device"); return; }
    setConnecting(device.id);
    try {
      if (device.rd_entry_id) {
        await axios.post(`${API}/rustdesk/devices/${device.rd_entry_id}/connect`, {}, { headers });
      } else {
        await axios.post(`${API}/rustdesk/quick-connect`, { rustdesk_id: rdId }, { headers });
      }
      window.open(`rustdesk://${rdId}`, "_blank");
      toast.success(`Connecting to ${device.name || device.hostname}...`);
      fetchData();
    } catch { toast.error("Connection failed"); }
    finally { setConnecting(null); }
  };

  // Assign RustDesk ID
  const assignRustdeskId = async (e) => {
    e.preventDefault();
    if (!assignForm.rustdesk_id.trim()) { toast.error("RustDesk ID is required"); return; }
    setSubmitting(true);
    try {
      await axios.put(`${API}/rustdesk/assign/${showAssign.id}`, assignForm, { headers });
      toast.success(`RustDesk ID assigned to ${showAssign.name || showAssign.hostname}`);
      setShowAssign(null);
      setAssignForm({ rustdesk_id: "", rustdesk_password: "" });
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to assign"); }
    finally { setSubmitting(false); }
  };

  // Save settings
  const saveSettings = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await axios.post(`${API}/rustdesk/config`, settingsForm, { headers });
      toast.success("Settings saved");
      setShowSettings(false);
      fetchData();
    } catch { toast.error("Failed to save settings"); }
    finally { setSubmitting(false); }
  };

  const copyToClipboard = (text) => { navigator.clipboard.writeText(text); toast.success("Copied to clipboard"); };

  // Deploy agent to single device
  const deployAgent = async (device) => {
    setDeployingDevice(device.id);
    try {
      const res = await axios.post(`${API}/rustdesk/devices/${device.id}/deploy-agent`, {}, { headers });
      setDeployCmd(res.data.deployment.deploy_command);
      setShowDeployDialog(true);
      toast.success(`Agent deployment queued for ${device.name || device.hostname}`);
      fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to queue deployment"); }
    finally { setDeployingDevice(null); }
  };

  // Mark agent as deployed (tech confirms)
  const markDeployed = async (deviceId) => {
    try {
      await axios.post(`${API}/rustdesk/devices/${deviceId}/deploy-agent/complete`, {}, { headers });
      toast.success("Agent marked as deployed");
      fetchData();
    } catch { toast.error("Failed to mark as deployed"); }
  };

  // Bulk deploy agent
  const bulkDeployAgent = async () => {
    const ids = [...selectedDevices];
    if (!ids.length) { toast.error("Select devices first"); return; }
    try {
      const res = await axios.post(`${API}/rustdesk/deploy-agent/bulk`, { device_ids: ids }, { headers });
      toast.success(res.data.message);
      setSelectedDevices(new Set());
      setShowBulkDeploy(false);
      fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Bulk deploy failed"); }
  };

  const toggleDeviceSelect = (id) => {
    setSelectedDevices(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // Live sync from RustDesk server
  const syncFromServer = async () => {
    setSyncing(true);
    try {
      const res = await axios.post(`${API}/rustdesk/live/sync`, {}, { headers });
      toast.success(res.data.message);
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Sync failed - check server settings");
    }
    finally { setSyncing(false); }
  };

  // Test RustDesk server connection (tests what's in the form, not saved config)
  const testConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const params = new URLSearchParams();
      if (settingsForm.server_url) params.set("server_url", settingsForm.server_url);
      if (settingsForm.api_key) params.set("api_key", settingsForm.api_key);
      const res = await axios.get(`${API}/rustdesk/live/test-connection?${params.toString()}`, { headers });
      setConnectionResult(res.data);
      if (res.data.connected) {
        toast.success(res.data.message);
      } else {
        toast.error(res.data.message || "Connection failed");
      }
    } catch { toast.error("Connection test failed"); }
    finally { setTestingConnection(false); }
  };

  // Get live status for a device
  const getLivePeerStatus = (rdId) => {
    if (!livePeers?.peers || !rdId) return null;
    return livePeers.peers.find(p => String(p.id) === String(rdId));
  };

  const getDeployStatus = (deviceId) => {
    if (!deployments?.deployments) return null;
    return deployments.deployments.find(d => d.device_id === deviceId);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const registered = devices.filter(d => d.rd_registered);
  const unregistered = devices.filter(d => !d.rd_registered);
  const online = devices.filter(d => d.status === "online");
  const serverConfigured = config?.enabled && config?.server_url;

  const filtered = devices.filter(d => {
    if (search) {
      const q = search.toLowerCase();
      if (!(d.name || "").toLowerCase().includes(q) && !(d.hostname || "").toLowerCase().includes(q) &&
          !(d.rd_id || "").toLowerCase().includes(q) && !(d.client_name || "").toLowerCase().includes(q)) return false;
    }
    if (filterType !== "all" && d.device_type !== filterType) return false;
    if (filterRegistered === "registered" && !d.rd_registered) return false;
    if (filterRegistered === "unregistered" && d.rd_registered) return false;
    return true;
  });

  return (
    <div className="space-y-5" data-testid="remote-access-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center"><Laptop className="w-5 h-5 text-white" /></div>
            Remote Access Hub
          </h1>
          <p className="text-muted-foreground mt-1">Manage remote access providers and device connections</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setSettingsForm(config || { server_url: "", api_key: "", relay_server: "", enabled: true }); setShowSettings(true); }} data-testid="settings-btn"><Settings className="w-4 h-4 mr-2" />Server Settings</Button>
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
        </div>
      </div>

      {/* Connection Status Bar */}
      <Card className={`border ${serverConfigured ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${serverConfigured ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
              <div>
                <span className={`text-sm font-semibold ${serverConfigured ? "text-emerald-400" : "text-amber-400"}`}>
                  {serverConfigured ? "RustDesk Server Connected" : "Server Not Configured"}
                </span>
                {config?.server_url && <span className="text-xs text-muted-foreground ml-2">{config.server_url}</span>}
                {livePeers && <span className="text-xs text-blue-400 ml-2">({livePeers.count} live peers)</span>}
                {config?.auto_sync !== false && serverConfigured && <Badge variant="outline" className="ml-2 text-[10px] text-emerald-400 border-emerald-500/30">Auto-Sync ON</Badge>}
                {config?.last_auto_sync && <span className="text-xs text-muted-foreground ml-2">Last auto-sync: {new Date(config.last_auto_sync).toLocaleString()}</span>}
                {config?.last_sync && !config?.last_auto_sync && <span className="text-xs text-muted-foreground ml-2">Last sync: {new Date(config.last_sync).toLocaleString()}</span>}
              </div>
            </div>
            <div className="flex gap-2">
              {serverConfigured && (
                <>
                  <Button size="sm" variant="outline" onClick={testConnection} disabled={testingConnection} data-testid="test-connection-btn">
                    {testingConnection ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Wifi className="w-3 h-3 mr-1" />}Test
                  </Button>
                  <Button size="sm" variant="default" onClick={syncFromServer} disabled={syncing} data-testid="sync-live-btn">
                    {syncing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Sync Live
                  </Button>
                </>
              )}
              {!serverConfigured && <Button size="sm" variant="outline" onClick={() => { setSettingsForm(config || {}); setShowSettings(true); }}>Configure Now</Button>}
            </div>
          </div>
          {connectionResult && (
            <div className={`mt-2 p-2 rounded text-xs ${connectionResult.connected ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
              {connectionResult.message}
              {connectionResult.peer_count !== null && connectionResult.peer_count !== undefined && <span className="ml-2 font-medium">&middot; {connectionResult.peer_count} peer(s) found</span>}
              {connectionResult.endpoints_available?.length > 0 && (
                <span className="ml-2 text-muted-foreground">Endpoints: {connectionResult.endpoints_available.map(e => e.path).join(", ")}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Connect Bar */}
      <Card className="border-border/40">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <span className="text-sm font-semibold whitespace-nowrap">Quick Connect</span>
            <Input placeholder="Enter RustDesk ID (e.g., 842931675)" value={quickId} onChange={e => setQuickId(e.target.value)} onKeyDown={e => e.key === "Enter" && quickConnect()} className="flex-1 max-w-xs font-mono" data-testid="quick-connect-input" />
            <Button onClick={quickConnect} disabled={!quickId.trim() || connecting === "quick"} data-testid="quick-connect-btn">
              {connecting === "quick" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}Connect
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total Devices", value: devices.length, icon: Monitor, color: "text-blue-400" },
          { label: "RustDesk Registered", value: registered.length, icon: Link2, color: "text-emerald-400" },
          { label: "Unregistered", value: unregistered.length, icon: Unlink, color: "text-amber-400" },
          { label: "Live Online", value: livePeers ? livePeers.peers.filter(p => p.online).length : online.length, icon: Wifi, color: "text-cyan-400" },
          { label: "Sessions Today", value: sessions.filter(s => { const d = new Date(s.started_at); const t = new Date(); return d.toDateString() === t.toDateString(); }).length, icon: History, color: "text-purple-400" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="devices">All Devices ({devices.length})</TabsTrigger>
          <TabsTrigger value="registered">Registered ({registered.length})</TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-integrations"><Plug className="w-3 h-3 mr-1" />Integrations ({providers.length})</TabsTrigger>
          {livePeers && <TabsTrigger value="live-peers" data-testid="tab-live-peers"><Wifi className="w-3 h-3 mr-1" />Live Peers ({livePeers.count})</TabsTrigger>}
          <TabsTrigger value="deployments" data-testid="tab-deployments"><Rocket className="w-3 h-3 mr-1" />Deployments ({deployments?.total || 0})</TabsTrigger>
          <TabsTrigger value="sessions">Sessions ({sessions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="devices" className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search by name, hostname, ID, or client..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="device-search" />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="server">Servers</SelectItem>
                <SelectItem value="workstation">Workstations</SelectItem>
                <SelectItem value="laptop">Laptops</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterRegistered} onValueChange={setFilterRegistered}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="registered">Registered</SelectItem>
                <SelectItem value="unregistered">Unregistered</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Bulk Actions */}
          {selectedDevices.size > 0 && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="py-2.5 px-4 flex items-center justify-between">
                <span className="text-sm font-medium"><SquareCheckBig className="w-4 h-4 inline mr-1.5 text-primary" />{selectedDevices.size} selected</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={bulkDeployAgent} data-testid="bulk-deploy-btn"><Rocket className="w-3 h-3" />Deploy Agent to Selected</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedDevices(new Set())}><XCircle className="w-3 h-3 mr-1" />Clear</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-border/40">
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead>Type / OS</TableHead>
                  <TableHead>Status</TableHead><TableHead>RustDesk ID</TableHead><TableHead>Agent</TableHead><TableHead>Last Connected</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No devices match your filters</TableCell></TableRow>
                  ) : filtered.map(d => {
                    const Icon = TYPE_ICONS[d.device_type] || Monitor;
                    const dep = getDeployStatus(d.id);
                    return (
                      <TableRow key={d.id} data-testid={`device-row-${d.id}`}>
                        <TableCell onClick={e => e.stopPropagation()}><Checkbox checked={selectedDevices.has(d.id)} onCheckedChange={() => toggleDeviceSelect(d.id)} /></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <p className="font-semibold text-sm">{d.name || d.hostname || "Unnamed"}</p>
                              {d.ip_address && <p className="text-[10px] text-muted-foreground font-mono">{d.ip_address}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{d.client_name || "—"}</Badge></TableCell>
                        <TableCell>
                          <div><span className="text-xs capitalize">{d.device_type}</span>{d.os && <p className="text-[10px] text-muted-foreground">{d.os}</p>}</div>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const livePeer = getLivePeerStatus(d.rd_id);
                            const isLive = livePeer?.online;
                            const statusLabel = livePeer ? (isLive ? "online" : "offline") : d.status;
                            const isOnline = statusLabel === "online";
                            return (
                              <div className="flex items-center gap-1.5">
                                {isOnline ? <Wifi className="w-3 h-3 text-emerald-400" /> : <WifiOff className="w-3 h-3 text-red-400" />}
                                <span className={`text-xs capitalize ${isOnline ? "text-emerald-400" : "text-muted-foreground"}`}>{statusLabel}</span>
                                {livePeer && <span className="text-[9px] px-1 rounded bg-blue-500/10 text-blue-400 ml-1">LIVE</span>}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          {d.rd_id ? (
                            <div className="flex items-center gap-1.5">
                              <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{d.rd_id}</code>
                              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyToClipboard(d.rd_id)}><Copy className="w-3 h-3" /></Button>
                              {d.rd_password && (
                                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowPassword(p => ({ ...p, [d.id]: !p[d.id] }))}>
                                  {showPassword[d.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                </Button>
                              )}
                              {showPassword[d.id] && d.rd_password && (
                                <code className="text-[10px] font-mono text-amber-400">{d.rd_password}</code>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">Not assigned</span>
                          )}
                        </TableCell>
                        {/* Agent Status */}
                        <TableCell>
                          {dep?.status === "deployed" ? (
                            <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30"><CheckCircle className="w-3 h-3 mr-1" />Deployed</Badge>
                          ) : dep?.status === "pending" ? (
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30"><Clock className="w-3 h-3 mr-1" />Pending</Badge>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] text-emerald-400" onClick={() => markDeployed(d.id)} title="Mark as deployed"><Check className="w-3 h-3" /></Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] text-blue-400 hover:text-blue-300" onClick={() => deployAgent(d)} disabled={deployingDevice === d.id} data-testid={`deploy-agent-${d.id}`}>
                              {deployingDevice === d.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Rocket className="w-3 h-3 mr-1" />}Deploy
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{d.rd_last_connected ? new Date(d.rd_last_connected).toLocaleString() : "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {d.rd_id ? (
                              <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => connectDevice(d)} disabled={connecting === d.id} data-testid={`connect-${d.id}`}>
                                {connecting === d.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}Connect
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setShowAssign(d); setAssignForm({ rustdesk_id: d.rustdesk_id || "", rustdesk_password: "" }); }} data-testid={`assign-${d.id}`}>
                                <Link2 className="w-3 h-3 mr-1" />Assign ID
                              </Button>
                            )}
                            {d.rd_id && (
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowAssign(d); setAssignForm({ rustdesk_id: d.rd_id || "", rustdesk_password: d.rd_password || "" }); }} data-testid={`edit-rd-${d.id}`}>
                                <Pencil className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="registered" className="mt-4 space-y-3">
          {registered.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><Unlink className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" /><p className="text-muted-foreground">No devices registered with RustDesk IDs yet</p><p className="text-xs text-muted-foreground mt-1">Go to All Devices and click "Assign ID" to register</p></CardContent></Card>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {registered.map(d => {
                const Icon = TYPE_ICONS[d.device_type] || Monitor;
                return (
                  <Card key={d.id} className="border-border/40 hover:border-primary/30 transition-colors" data-testid={`rd-card-${d.id}`}>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${d.status === "online" ? "bg-emerald-500/10" : "bg-muted/50"}`}>
                          <Icon className={`w-5 h-5 ${d.status === "online" ? "text-emerald-400" : "text-muted-foreground"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm truncate">{d.name || d.hostname}</span>
                            <Badge variant={d.status === "online" ? "default" : "secondary"} className="text-[10px] capitalize">{d.status}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{d.client_name}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{d.rd_id}</code>
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyToClipboard(d.rd_id)}><Copy className="w-3 h-3" /></Button>
                          </div>
                          {d.rd_last_connected && <p className="text-[10px] text-muted-foreground mt-1">Last: {new Date(d.rd_last_connected).toLocaleString()}</p>}
                        </div>
                        <Button size="sm" onClick={() => connectDevice(d)} disabled={connecting === d.id} data-testid={`connect-card-${d.id}`}>
                          {connecting === d.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}Connect
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ============ INTEGRATIONS TAB ============ */}
        <TabsContent value="integrations" className="mt-4 space-y-4" data-testid="integrations-tab">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Configure remote access providers. Enable the tools your team uses and enter API credentials.</p>
            </div>
            <Badge variant="outline" className="text-xs">{providers.filter(p => p.active).length} Active / {providers.length} Available</Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {providers.map(p => {
              const isActive = p.active;
              const isConfigured = p.configured;
              const testRes = providerTestResult[p.id];
              return (
                <Card key={p.id} className={`border transition-all hover:shadow-md ${isActive ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/40"}`} data-testid={`provider-card-${p.id}`}>
                  <CardContent className="pt-5 pb-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isActive ? "bg-emerald-500/15" : "bg-muted/50"}`}>
                          {p.type === "self-hosted" ? <Server className={`w-5 h-5 ${isActive ? "text-emerald-400" : "text-muted-foreground"}`} /> : <Globe className={`w-5 h-5 ${isActive ? "text-emerald-400" : "text-muted-foreground"}`} />}
                        </div>
                        <div>
                          <h3 className="font-semibold text-sm">{p.name}</h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="outline" className="text-[10px]">{p.type === "self-hosted" ? "Self-Hosted" : "Cloud"}</Badge>
                            <span className="text-[10px] text-muted-foreground">{p.license}</span>
                          </div>
                        </div>
                      </div>
                      <Switch checked={isActive} onCheckedChange={() => toggleProvider(p)} data-testid={`toggle-${p.id}`} />
                    </div>

                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{p.description}</p>

                    <div className="flex flex-wrap gap-1 mb-3">
                      {p.features.slice(0, 4).map(f => (
                        <Badge key={f} variant="secondary" className="text-[9px] px-1.5 py-0 font-normal">{f}</Badge>
                      ))}
                      {p.features.length > 4 && <Badge variant="secondary" className="text-[9px] px-1.5 py-0 font-normal">+{p.features.length - 4}</Badge>}
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {isConfigured ? (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-400"><CheckCircle className="w-3 h-3" />Configured</span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] text-amber-400"><AlertCircle className="w-3 h-3" />Not configured</span>
                        )}
                        {testRes && (
                          <span className={`flex items-center gap-1 text-[10px] ml-2 ${testRes.success ? "text-emerald-400" : "text-red-400"}`}>
                            {testRes.success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            {testRes.success ? "Connected" : "Failed"}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {p.docs_url && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => window.open(p.docs_url, "_blank")} data-testid={`docs-${p.id}`}>
                            <BookOpen className="w-3 h-3 mr-1" />Docs
                          </Button>
                        )}
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openProviderConfig(p)} data-testid={`configure-${p.id}`}>
                          <Settings className="w-3 h-3 mr-1" />Configure
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Agent Deployments Tab */}
        {livePeers && (
          <TabsContent value="live-peers" className="mt-4 space-y-3" data-testid="live-peers-tab">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Real-time peer data from <span className="font-mono text-xs">{livePeers.server_url}</span> {livePeers.source && <Badge variant="outline" className="ml-1 text-[10px]">via {livePeers.source}</Badge>}</p>
              <Button size="sm" variant="outline" onClick={syncFromServer} disabled={syncing}>{syncing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Sync to NexusOps</Button>
            </div>
            <Card className="border-border/40">
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>RustDesk ID</TableHead><TableHead>Hostname</TableHead><TableHead>OS</TableHead>
                    <TableHead>Status</TableHead><TableHead>Version</TableHead><TableHead>Alias</TableHead><TableHead>Linked</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {livePeers.peers.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No peers found on RustDesk server. Check API key permissions.</TableCell></TableRow>
                    ) : livePeers.peers.map(p => {
                      const matchedDevice = devices.find(d => d.rd_id === String(p.id));
                      return (
                        <TableRow key={p.id} data-testid={`live-peer-${p.id}`}>
                          <TableCell><code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{p.id}</code></TableCell>
                          <TableCell className="text-sm">{p.hostname || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{p.os || "—"}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {p.online ? <Wifi className="w-3 h-3 text-emerald-400" /> : <WifiOff className="w-3 h-3 text-red-400" />}
                              <span className={`text-xs ${p.online ? "text-emerald-400 font-medium" : "text-muted-foreground"}`}>{p.online ? "Online" : "Offline"}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{p.version || "—"}</TableCell>
                          <TableCell className="text-xs">{p.alias || "—"}</TableCell>
                          <TableCell>
                            {matchedDevice ? (
                              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px]"><Link2 className="w-2.5 h-2.5 mr-0.5" />{matchedDevice.name || matchedDevice.hostname}</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">Not linked</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="deployments" className="mt-4 space-y-4" data-testid="deployments-tab">
          {/* Deployment Stats */}
          <div className="grid grid-cols-4 gap-3">
            <Card className="border-blue-500/20"><CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground">Total</p><Rocket className="w-4 h-4 text-blue-400" /></div>
              <p className="text-2xl font-bold text-blue-400">{deployments?.total || 0}</p>
            </CardContent></Card>
            <Card className="border-amber-500/20"><CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground">Pending</p><Clock className="w-4 h-4 text-amber-400" /></div>
              <p className="text-2xl font-bold text-amber-400">{deployments?.pending || 0}</p>
            </CardContent></Card>
            <Card className="border-emerald-500/20"><CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground">Deployed</p><CheckCircle className="w-4 h-4 text-emerald-400" /></div>
              <p className="text-2xl font-bold text-emerald-400">{deployments?.deployed || 0}</p>
            </CardContent></Card>
            <Card className="border-red-500/20"><CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground">Failed</p><XCircle className="w-4 h-4 text-red-400" /></div>
              <p className="text-2xl font-bold text-red-400">{deployments?.failed || 0}</p>
            </CardContent></Card>
          </div>

          {/* How it works */}
          <Card className="border-blue-500/10 bg-blue-500/5">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <Terminal className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold mb-1">Deploy Patch Agent via RustDesk</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Click "Deploy" on any device in the All Devices tab, or select multiple devices and click "Deploy Agent to Selected".
                    Connect to the device via RustDesk, then paste and run the deployment command. The agent runs as a background service,
                    reporting Windows Update status, installed software, and Defender status back to NexusOps every hour.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Deployment List */}
          {(deployments?.deployments || []).length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead>Status</TableHead>
                    <TableHead>Queued By</TableHead><TableHead>Queued</TableHead><TableHead>Deployed</TableHead><TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {deployments.deployments.map(dep => (
                      <TableRow key={dep.id} data-testid={`deployment-${dep.id}`}>
                        <TableCell className="font-medium text-sm">{dep.device_name}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{dep.client_name || "—"}</Badge></TableCell>
                        <TableCell>
                          {dep.status === "deployed" ? (
                            <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30"><CheckCircle className="w-3 h-3 mr-1" />Deployed</Badge>
                          ) : dep.status === "pending" ? (
                            <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/30 animate-pulse"><Clock className="w-3 h-3 mr-1" />Pending</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{dep.queued_by}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{dep.queued_at ? new Date(dep.queued_at).toLocaleString() : "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{dep.deployed_at ? new Date(dep.deployed_at).toLocaleString() : "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {dep.status === "pending" && (
                              <>
                                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setDeployCmd(dep.deploy_command); setShowDeployDialog(true); }} data-testid={`view-cmd-${dep.id}`}>
                                  <Terminal className="w-3 h-3 mr-1" />View CMD
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 text-[10px] text-emerald-400" onClick={() => markDeployed(dep.device_id)} data-testid={`mark-deployed-${dep.id}`}>
                                  <Check className="w-3 h-3 mr-1" />Done
                                </Button>
                              </>
                            )}
                            {dep.status === "deployed" && dep.deploy_command && (
                              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { navigator.clipboard.writeText(dep.deploy_command); toast.success("Command copied"); }}>
                                <Copy className="w-3 h-3 mr-1" />CMD
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
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Rocket className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" />
                <p className="text-muted-foreground">No deployments queued yet</p>
                <p className="text-xs text-muted-foreground mt-1">Select devices and click "Deploy" to start rolling out the Patch Agent</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <Card className="border-border/40">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><History className="w-4 h-4 text-purple-400" />Remote Sessions</CardTitle></CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No remote sessions recorded</p>
              ) : (
                <ScrollArea className="h-80">
                  <div className="space-y-2">
                    {sessions.map(s => (
                      <div key={s.id} className="flex items-center gap-3 p-2 rounded-lg border border-border/20 hover:bg-muted/20" data-testid={`session-${s.id}`}>
                        <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center"><Play className="w-4 h-4 text-purple-400" /></div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            <span className="text-muted-foreground">{s.user_name}</span> connected to <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{s.rustdesk_id}</code>
                          </p>
                          <p className="text-[10px] text-muted-foreground">{s.client_id ? `Client: ${s.client_id}` : "Quick connect"}</p>
                        </div>
                        <Badge variant={s.status === "initiated" ? "default" : "secondary"} className="text-[10px] capitalize">{s.status}</Badge>
                        <span className="text-[10px] text-muted-foreground">{s.started_at ? new Date(s.started_at).toLocaleString() : ""}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Assign RustDesk ID Dialog */}
      <Dialog open={!!showAssign} onOpenChange={() => setShowAssign(null)}>
        <DialogContent className="max-w-sm" aria-describedby="assign-rd-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 className="w-5 h-5 text-blue-400" />{showAssign?.rd_id ? "Edit" : "Assign"} RustDesk ID</DialogTitle>
            <DialogDescription id="assign-rd-desc">{showAssign?.name || showAssign?.hostname} — {showAssign?.client_name}</DialogDescription>
          </DialogHeader>
          <form onSubmit={assignRustdeskId} className="space-y-4">
            <div className="space-y-2">
              <Label>RustDesk ID *</Label>
              <Input value={assignForm.rustdesk_id} onChange={e => setAssignForm({ ...assignForm, rustdesk_id: e.target.value })} placeholder="e.g., 842931675" className="font-mono" required data-testid="assign-rd-id" />
              <p className="text-[10px] text-muted-foreground">The 9-digit ID shown in the RustDesk client on this device</p>
            </div>
            <div className="space-y-2">
              <Label>Password (optional)</Label>
              <Input value={assignForm.rustdesk_password} onChange={e => setAssignForm({ ...assignForm, rustdesk_password: e.target.value })} placeholder="Device password for unattended access" data-testid="assign-rd-pw" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={submitting} data-testid="save-assign-btn">
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                {showAssign?.rd_id ? "Update" : "Assign"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Server Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-md" aria-describedby="settings-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Settings className="w-5 h-5 text-muted-foreground" />RustDesk Server Settings</DialogTitle>
            <DialogDescription id="settings-desc">Configure your RustDesk server connection</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveSettings} className="space-y-4">
            <div className="space-y-2"><Label>Server URL *</Label><Input value={settingsForm.server_url} onChange={e => setSettingsForm({ ...settingsForm, server_url: e.target.value })} placeholder="https://your-server:21114" required data-testid="settings-server" /><p className="text-[10px] text-muted-foreground">The full URL of your RustDesk API server, including port (default RustDesk Pro API port is 21114)</p></div>
            <div className="space-y-2"><Label>API Key</Label><Input value={settingsForm.api_key} onChange={e => setSettingsForm({ ...settingsForm, api_key: e.target.value })} placeholder="Your RustDesk API key" type="password" data-testid="settings-key" /><p className="text-[10px] text-muted-foreground">Generate from RustDesk Web Console → Settings → API Tokens (required for peer list &amp; sync)</p></div>
            <div className="space-y-2"><Label>Relay Server (optional)</Label><Input value={settingsForm.relay_server} onChange={e => setSettingsForm({ ...settingsForm, relay_server: e.target.value })} placeholder="relay.yourdomain.com" data-testid="settings-relay" /><p className="text-[10px] text-muted-foreground">Only needed if your relay runs on a separate host from the ID server</p></div>
            <div className="flex items-center justify-between py-2">
              <div><Label>Auto-Sync (every 5 min)</Label><p className="text-xs text-muted-foreground">Automatically pull live peer status from server</p></div>
              <Switch checked={settingsForm.auto_sync !== false} onCheckedChange={v => setSettingsForm({ ...settingsForm, auto_sync: v })} data-testid="settings-auto-sync" />
            </div>
            <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-muted-foreground">
              <p className="font-medium text-blue-400 mb-1">RustDesk Server Pro Required</p>
              <p>NexusOps requires <strong>RustDesk Server Pro</strong> for the live API. The OSS server does not expose a REST API. Enter the Web Console API URL (default port <code>21114</code>) and generate a token from Settings → API.</p>
            </div>
            {connectionResult && (
              <div className={`p-3 rounded-lg text-xs border ${connectionResult.connected ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                <p className={`font-medium mb-1 ${connectionResult.connected ? "text-emerald-400" : "text-red-400"}`}>
                  {connectionResult.connected ? "Connected Successfully" : "Connection Failed"}
                </p>
                <p className="text-muted-foreground">{connectionResult.message}</p>
                {connectionResult.peer_count != null && <p className="mt-1 text-muted-foreground">Peers found: <strong className="text-white">{connectionResult.peer_count}</strong></p>}
                {connectionResult.endpoints_available?.length > 0 && (
                  <p className="mt-1 text-muted-foreground">API endpoints: {connectionResult.endpoints_available.map(e => e.path).join(", ")}</p>
                )}
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={testConnection} disabled={testingConnection || !settingsForm.server_url} data-testid="test-settings-btn">{testingConnection ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wifi className="w-4 h-4 mr-1" />}Test Connection</Button>
              <Button type="submit" disabled={submitting} data-testid="save-settings-btn">{submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save Settings</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deploy Agent Command Dialog */}
      <Dialog open={showDeployDialog} onOpenChange={setShowDeployDialog}>
        <DialogContent className="max-w-lg" aria-describedby="deploy-cmd-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Rocket className="w-5 h-5 text-blue-400" />Deploy Patch Agent</DialogTitle>
            <DialogDescription id="deploy-cmd-desc">Connect to the device via RustDesk, open PowerShell as Administrator, and run this command:</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <pre className="bg-zinc-900 text-emerald-400 text-xs p-4 rounded-lg overflow-x-auto font-mono leading-relaxed">{deployCmd}</pre>
              <Button variant="outline" size="sm" className="absolute top-2 right-2 h-7 text-xs" onClick={() => { navigator.clipboard.writeText(deployCmd); toast.success("Command copied!"); }} data-testid="copy-deploy-dialog-cmd"><Copy className="w-3 h-3 mr-1" />Copy</Button>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-start gap-2"><div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center flex-shrink-0 text-[10px] font-bold">1</div><span>Connect to the device via RustDesk</span></div>
              <div className="flex items-start gap-2"><div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center flex-shrink-0 text-[10px] font-bold">2</div><span>Open PowerShell as Administrator</span></div>
              <div className="flex items-start gap-2"><div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center flex-shrink-0 text-[10px] font-bold">3</div><span>Paste and run the command above</span></div>
              <div className="flex items-start gap-2"><div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0 text-[10px] font-bold">4</div><span>Come back here and click "Done" to mark as deployed</span></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeployDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Provider Configuration Dialog */}
      <Dialog open={!!providerConfig} onOpenChange={v => { if (!v) setProviderConfig(null); }}>
        <DialogContent className="max-w-md" aria-describedby="provider-config-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Settings className="w-5 h-5" />{providerConfig?.name} Configuration</DialogTitle>
            <DialogDescription id="provider-config-desc">Configure connection settings for {providerConfig?.name}</DialogDescription>
          </DialogHeader>
          {providerConfig && (
            <div className="space-y-4">
              {providerConfig.config_fields.map(field => (
                <div key={field.key} className="space-y-1.5">
                  <Label className="text-xs">{field.label}</Label>
                  <Input
                    type={field.type === "password" ? "password" : "text"}
                    value={providerForm[field.key] || ""}
                    onChange={e => setProviderForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    data-testid={`provider-field-${field.key}`}
                  />
                </div>
              ))}

              <div className="flex items-center justify-between py-2 border-t">
                <div>
                  <Label className="text-sm">Enable Provider</Label>
                  <p className="text-[10px] text-muted-foreground">Show in remote access options</p>
                </div>
                <Switch
                  checked={providerForm.active || false}
                  onCheckedChange={v => setProviderForm(prev => ({ ...prev, active: v }))}
                  data-testid="provider-active-toggle"
                />
              </div>

              {providerTestResult[providerConfig.id] && (
                <div className={`p-3 rounded-lg text-xs border ${providerTestResult[providerConfig.id].success ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                  <p className={`font-medium ${providerTestResult[providerConfig.id].success ? "text-emerald-400" : "text-red-400"}`}>
                    {providerTestResult[providerConfig.id].message}
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => testProviderConnection(providerConfig)} disabled={testingProvider === providerConfig?.id} data-testid="test-provider-btn">
              {testingProvider === providerConfig?.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <TestTube className="w-3 h-3 mr-1" />}Test Connection
            </Button>
            <Button onClick={saveProviderSettings} disabled={savingProvider} data-testid="save-provider-btn">
              {savingProvider ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
