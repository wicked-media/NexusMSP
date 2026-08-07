import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Laptop, Monitor, Server, Wifi, WifiOff, Settings, RefreshCw, Loader2,
  Copy, Search, Play, Shield,
  Link2, Unlink, Eye, EyeOff, Pencil, Check, History, Zap, Globe,
  Rocket, CheckCircle, AlertCircle, SquareCheckBig, XCircle,
  Plug, TestTube, Save, BookOpen
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { MetricStrip, MetricTile } from "@/components/design-system";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import SetupGuideCallout from "@/components/SetupGuideCallout";
import RemoteAccessButton from "@/components/devices/RemoteAccessButton";

const TYPE_ICONS = { server: Server, workstation: Monitor, laptop: Laptop, network: Wifi };

function getRemoteMessage(value, fallback) {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    const messages = value.map((item) => typeof item === "string" ? item : item?.msg || item?.message).filter(Boolean);
    if (messages.length) return messages.join("; ");
  }
  if (value && typeof value === "object") return value.message || value.msg || fallback;
  return fallback;
}

export default function RemoteAccessPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [focusedDevice, setFocusedDevice] = useState(null);
  const [focusedTicketId, setFocusedTicketId] = useState(null);
  const [connectDialog, setConnectDialog] = useState(null);
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
  const [remotePolicy, setRemotePolicy] = useState({ default_provider: "rustdesk", allow_fallback: true, require_consent: true, require_ticket_reference: false });
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [managedLimit, setManagedLimit] = useState(30);
  const [registryLimit, setRegistryLimit] = useState(30);
  const [linkPeer, setLinkPeer] = useState(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkingDevice, setLinkingDevice] = useState(null);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, sRes, cRes, pRes, policyRes] = await Promise.all([
        axios.get(`${API}/rustdesk/all-devices`, { headers }),
        axios.get(`${API}/rustdesk/sessions`, { headers }),
        axios.get(`${API}/rustdesk/config`, { headers }),
        axios.get(`${API}/remote-providers`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/remote-access/policy`, { headers }).catch(() => ({ data: null })),
      ]);
      setDevices(dRes.data);
      setSessions(sRes.data);
      setConfig(cRes.data?.value || cRes.data);
      setProviders(pRes.data || []);
      if (policyRes.data) setRemotePolicy(policyRes.data);
      const cfg = cRes.data?.value || cRes.data;
      if (cfg?.enabled && cfg?.server_url) {
        axios.get(`${API}/rustdesk/live/peers`, { headers }).then(r => setLivePeers(r.data)).catch(() => setLivePeers(null));
      }
    } catch { toast.error("Failed to load remote access data"); }
    finally { setLoading(false); }
  }, [headers]);

  const saveRemotePolicy = async () => {
    setSavingPolicy(true);
    try {
      const res = await axios.put(`${API}/remote-access/policy`, remotePolicy, { headers });
      setRemotePolicy(res.data);
      toast.success("Remote access policy saved");
    } catch (e) { toast.error(getRemoteMessage(e.response?.data?.detail, "Failed to save remote policy")); }
    finally { setSavingPolicy(false); }
  };

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const assignDeviceId = searchParams.get("assignDevice");
    const connectDeviceId = searchParams.get("device");
    const requestedDeviceId = assignDeviceId || connectDeviceId;
    if (!requestedDeviceId || loading || devices.length === 0) return;
    const requestedDevice = devices.find((device) => device.id === requestedDeviceId);
    if (requestedDevice) {
      setTab("devices");
      const remoteId = requestedDevice.rustdesk_id || requestedDevice.rd_id;
      if (assignDeviceId || !remoteId) {
        setShowAssign(requestedDevice);
        setAssignForm({ rustdesk_id: remoteId || "", rustdesk_password: "" });
      } else {
        setFocusedDevice(requestedDevice);
        setFocusedTicketId(searchParams.get("ticket"));
        setSearch(requestedDevice.name || requestedDevice.hostname || requestedDevice.client_name || "");
        setFilterType("all");
        setFilterRegistered("all");
      }
    } else {
      toast.error("The selected device is not available in Remote Access");
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("assignDevice");
    nextParams.delete("device");
    nextParams.delete("ticket");
    setSearchParams(nextParams, { replace: true });
  }, [devices, loading, searchParams, setSearchParams]);
  useEffect(() => {
    setManagedLimit(30);
    setRegistryLimit(30);
  }, [search, filterType, filterRegistered, tab]);

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

  // Launch RustDesk connection via protocol handler (no blank tab)
  const launchRustDesk = (rdId, relayServer) => {
    let uri;
    if (relayServer) {
      const host = relayServer.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
      uri = `rustdesk://${rdId}@${host}`;
    } else {
      uri = `rustdesk://${rdId}`;
    }
    const a = document.createElement("a");
    a.href = uri;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
  };

  // Quick connect
  const quickConnect = async () => {
    if (!quickId.trim()) return;
    setConnecting("quick");
    try {
      const res = await axios.post(`${API}/rustdesk/quick-connect`, { rustdesk_id: quickId }, { headers });
      // Show connection dialog with options
      setConnectDialog({
        rustdesk_id: quickId,
        connection_url: res.data.connection_url,
        web_client_url: res.data.web_client_url,
        relay_server: res.data.relay_server,
        device_name: quickId,
      });
      setQuickId("");
      fetchData();
    } catch (e) { toast.error(getRemoteMessage(e.response?.data?.detail, "Connection failed")); }
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
    } catch (err) { toast.error(getRemoteMessage(err.response?.data?.detail, "Failed to assign")); }
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
      toast.error(getRemoteMessage(e.response?.data?.detail, "Sync failed - check server settings"));
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
      if (res.data.authorized ?? res.data.connected) {
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

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const managedDevices = devices.filter(d => d.managed_asset !== false);
  const providerOnlyDevices = devices.filter(d => d.managed_asset === false);
  const registered = devices.filter(d => d.rd_registered);
  const managedRegistered = managedDevices.filter(d => d.rd_registered);
  const managedUnregistered = managedDevices.filter(d => !d.rd_registered);
  const online = managedDevices.filter(d => d.status === "online");
  const serverConfigured = config?.enabled && config?.server_url;
  const activeProviders = providers.filter(provider => provider.active || (provider.id === "rustdesk" && serverConfigured));

  const matchesSearch = d => {
    if (search) {
      const q = search.toLowerCase();
      if (!(d.name || "").toLowerCase().includes(q) && !(d.hostname || "").toLowerCase().includes(q) &&
          !(d.rd_id || "").toLowerCase().includes(q) && !(d.client_name || "").toLowerCase().includes(q)) return false;
    }
    return true;
  };

  const linkProviderPeer = async (device) => {
    if (!linkPeer?.rd_entry_id || !device?.id) return;
    setLinkingDevice(device.id);
    try {
      const { data } = await axios.put(
        `${API}/rustdesk/devices/${linkPeer.rd_entry_id}/link`,
        { managed_device_id: device.id },
        { headers },
      );
      toast.success(data.message || "RustDesk record linked");
      setLinkPeer(null);
      setLinkSearch("");
      await fetchData();
    } catch (error) {
      toast.error(getRemoteMessage(error.response?.data?.detail, "Unable to link this provider record"));
    } finally {
      setLinkingDevice(null);
    }
  };

  const filtered = managedDevices.filter(d => {
    if (!matchesSearch(d)) return false;
    if (filterType !== "all" && d.device_type !== filterType) return false;
    if (filterRegistered === "registered" && !d.rd_registered) return false;
    if (filterRegistered === "unregistered" && d.rd_registered) return false;
    return true;
  });
  const registryFiltered = registered.filter(matchesSearch);
  const linkCandidates = managedDevices
    .filter(device => !device.rd_registered)
    .filter(device => {
      const query = linkSearch.trim().toLowerCase();
      if (!query) return true;
      return [device.name, device.hostname, device.client_name, device.ip_address]
        .some(value => String(value || "").toLowerCase().includes(query));
    })
    .slice(0, 10);

  return (
    <div className="space-y-5" data-testid="remote-access-page">
      <OperationalPageHeader
        eyebrow="Managed access"
        title="Remote Access"
        description="Connect technicians to managed assets, govern provider access, and keep each remote session traceable."
        icon={Laptop}
        tone="sky"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => { setSettingsForm(config || { server_url: "", api_key: "", relay_server: "", enabled: true }); setShowSettings(true); }} data-testid="settings-btn"><Settings className="w-4 h-4 mr-2" />Server settings</Button>
          <Button variant="outline" size="sm" onClick={fetchData} data-testid="refresh-remote-access"><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
        </>}
      />

      {/* Connection Status Bar */}
      <Card className={`border ${serverConfigured ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${serverConfigured ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
              <div>
                <span className={`text-sm font-semibold ${serverConfigured ? "text-emerald-400" : "text-amber-400"}`}>
                  {serverConfigured ? "RustDesk Server Configured" : "Server Not Configured"}
                </span>
                {config?.server_url && <span className="text-xs text-muted-foreground ml-2">{config.server_url}</span>}
                {livePeers && <span className="text-xs text-blue-400 ml-2">({livePeers.count} live peers)</span>}
                {config?.auto_sync !== false && serverConfigured && <Badge variant="outline" className="ml-2 text-[10px] text-emerald-400 border-emerald-500/30">Auto-Sync ON</Badge>}
                {config?.last_auto_sync && <span className="text-xs text-muted-foreground ml-2">Last auto-sync: {new Date(config.last_auto_sync).toLocaleString()}</span>}
                {config?.last_sync && !config?.last_auto_sync && <span className="text-xs text-muted-foreground ml-2">Last sync: {new Date(config.last_sync).toLocaleString()}</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
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
              {!serverConfigured && <Button size="sm" onClick={() => { setSettingsForm(config || {}); setShowSettings(true); }} data-testid="configure-remote-access">Configure server</Button>}
            </div>
          </div>
          {connectionResult && (
            <div className={`mt-2 p-2 rounded text-xs ${(connectionResult.authorized ?? connectionResult.connected) ? "bg-emerald-500/10 text-emerald-400" : connectionResult.connected ? "bg-amber-500/10 text-amber-300" : "bg-red-500/10 text-red-400"}`}>
              {connectionResult.message}
              {connectionResult.peer_count !== null && connectionResult.peer_count !== undefined && <span className="ml-2 font-medium">&middot; {connectionResult.peer_count} peer(s) found</span>}
              {connectionResult.endpoints_available?.length > 0 && (
                <span className="ml-2 text-muted-foreground">Endpoints: {connectionResult.endpoints_available.map(e => `${e.path} (${e.status})`).join(", ")}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {focusedDevice && (
        <Card className="overflow-hidden border-cyan-400/30 bg-[linear-gradient(110deg,rgba(8,145,178,0.12),rgba(15,23,42,0.88)_48%,rgba(14,116,144,0.08))]" data-testid="remote-device-context">
          <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10"><Monitor className="h-5 w-5 text-cyan-300" /></div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{focusedDevice.name || focusedDevice.hostname}</p><Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/10 text-[10px] text-cyan-200">Remote-ready focus</Badge>{focusedTicketId && <Badge variant="outline" className="text-[10px]">Ticket {focusedTicketId}</Badge>}</div>
                <p className="mt-1 text-xs text-muted-foreground">{focusedDevice.client_name || "Unassigned client"} · {focusedDevice.os || focusedDevice.operating_system || "Operating system not reported"} · Remote ID {focusedDevice.rustdesk_id || focusedDevice.rd_id}</p>
                <p className="mt-1 text-[11px] text-cyan-100/70">Opened from operational context. Technician authorisation, consent, provider handoff and session evidence remain in one governed workflow.</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate(`/devices/${focusedDevice.id}`)}><Eye className="mr-1.5 h-4 w-4" />Device record</Button>
              <RemoteAccessButton device={{ ...focusedDevice, rustdesk_id: focusedDevice.rustdesk_id || focusedDevice.rd_id }} status={focusedDevice.status} ticketId={focusedTicketId} testid="focused-device-remote" />
              <Button variant="ghost" size="icon" aria-label="Clear focused device" onClick={() => { setFocusedDevice(null); setFocusedTicketId(null); setSearch(""); }}><XCircle className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Connect Bar */}
      <Card className="border-sky-500/20 bg-sky-500/[0.03]">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3 sm:min-w-[220px]"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10"><Zap className="w-4 h-4 text-sky-300" /></div><div><p className="text-sm font-semibold">Unlinked quick connect</p><p className="text-xs text-muted-foreground">Break-glass access by RustDesk ID</p></div></div>
            <Input placeholder="Enter RustDesk ID (for example 842931675)" value={quickId} onChange={e => setQuickId(e.target.value)} onKeyDown={e => e.key === "Enter" && quickConnect()} className="flex-1 font-mono" data-testid="quick-connect-input" />
            <Button onClick={quickConnect} disabled={!quickId.trim() || connecting === "quick"} className="sm:min-w-28" data-testid="quick-connect-btn">
              {connecting === "quick" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}Connect
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <MetricStrip columns={5}>
        {[
          { label: "Managed Assets", value: managedDevices.length, icon: Monitor, color: "text-sky-400", accent: "sky" },
          { label: "Remote Ready", value: managedRegistered.length, icon: Link2, color: "text-emerald-400", accent: "emerald" },
          { label: "Needs Setup", value: managedUnregistered.length, icon: Unlink, color: "text-amber-400", accent: "amber" },
          { label: "Provider Only", value: providerOnlyDevices.length, icon: Globe, color: "text-violet-400", accent: "violet" },
          { label: "Live Online", value: livePeers ? livePeers.peers.filter(p => p.online).length : online.length, icon: Wifi, color: "text-cyan-400", accent: "cyan" },
        ].map(st => (
          <MetricTile key={st.label} label={st.label} value={st.value} accent={st.accent} icon={<st.icon className={`w-2.5 h-2.5 ${st.color}`} />} testid={`remote-metric-${st.label.toLowerCase().replace(/\s+/g, "-")}`} />
        ))}
      </MetricStrip>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-border/50 bg-card/70 p-1.5 sm:w-fit">
          <TabsTrigger value="devices">Managed Assets ({managedDevices.length})</TabsTrigger>
          <TabsTrigger value="registered">Provider Registry ({registered.length})</TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-integrations"><Plug className="w-3 h-3 mr-1" />Integrations ({providers.length})</TabsTrigger>
          {livePeers && <TabsTrigger value="live-peers" data-testid="tab-live-peers"><Wifi className="w-3 h-3 mr-1" />Live Peers ({livePeers.count})</TabsTrigger>}
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
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => navigate("/nexus-agent")} data-testid="bulk-deploy-btn"><Rocket className="w-3 h-3" />Open Nexus Agent</Button>
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
                  <TableHead>Status</TableHead><TableHead>RustDesk ID</TableHead><TableHead className="hidden xl:table-cell">Agent</TableHead><TableHead className="hidden xl:table-cell">Last Connected</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">No devices match your filters</TableCell></TableRow>
                  ) : filtered.slice(0, managedLimit).map(d => {
                    const Icon = TYPE_ICONS[d.device_type] || Monitor;
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
                              {d.credential_configured && (
                                <Badge variant="outline" className="h-5 border-emerald-500/25 px-1.5 text-[9px] text-emerald-500">
                                  <Shield className="mr-1 h-2.5 w-2.5" />Credential secured
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">Not assigned</span>
                          )}
                        </TableCell>
                        {/* Agent Status */}
                        <TableCell className="hidden xl:table-cell">
                          {d.nexus_agent_id ? (
                            <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30"><CheckCircle className="w-3 h-3 mr-1" />Nexus Agent</Badge>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] text-blue-400 hover:text-blue-300" onClick={() => navigate("/nexus-agent")} data-testid={`deploy-agent-${d.id}`}>
                              <Rocket className="w-3 h-3 mr-1" />Install agent
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">{d.rd_last_connected ? new Date(d.rd_last_connected).toLocaleString() : "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {d.rd_id ? (
                              <RemoteAccessButton
                                device={{ ...d, rustdesk_id: d.rd_id }}
                                status={getLivePeerStatus(d.rd_id) ? (getLivePeerStatus(d.rd_id)?.online ? "online" : "offline") : d.status}
                                compact
                                providersOverride={activeProviders}
                                testid={`connect-${d.id}`}
                              />
                            ) : (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setShowAssign(d); setAssignForm({ rustdesk_id: d.rustdesk_id || "", rustdesk_password: "" }); }} data-testid={`assign-${d.id}`}>
                                <Link2 className="w-3 h-3 mr-1" />Assign ID
                              </Button>
                            )}
                            {d.rd_id && (
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowAssign(d); setAssignForm({ rustdesk_id: d.rd_id || "", rustdesk_password: "" }); }} data-testid={`edit-rd-${d.id}`}>
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
          {filtered.length > managedLimit && (
            <div className="flex items-center justify-center">
              <Button variant="outline" size="sm" onClick={() => setManagedLimit(limit => limit + 30)}>
                Show 30 more <span className="ml-1 text-muted-foreground">({filtered.length - managedLimit} remaining)</span>
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="registered" className="mt-4 space-y-3">
          <Card className="border-border/40 bg-card/50">
            <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search provider records by device, client, or RustDesk ID..."
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  className="pl-9"
                  data-testid="provider-registry-search"
                />
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="border-emerald-500/25 text-emerald-300">{managedRegistered.length} linked to managed assets</Badge>
                <Badge variant="outline" className="border-violet-500/25 text-violet-300">{providerOnlyDevices.length} provider-only</Badge>
              </div>
            </CardContent>
          </Card>
          {registered.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><Unlink className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" /><p className="text-muted-foreground">No devices registered with RustDesk IDs yet</p><p className="text-xs text-muted-foreground mt-1">Go to All Devices and click "Assign ID" to register</p></CardContent></Card>
          ) : registryFiltered.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><Search className="w-10 h-10 mx-auto text-muted-foreground/20 mb-3" /><p className="text-muted-foreground">No provider records match your search</p></CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {registryFiltered.slice(0, registryLimit).map(d => {
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
                            <Badge variant="outline" className={`text-[10px] ${d.managed_asset === false ? "border-violet-500/25 text-violet-300" : "border-emerald-500/25 text-emerald-300"}`}>{d.managed_asset === false ? "Provider only" : "Managed asset"}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{d.client_name}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{d.rd_id}</code>
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyToClipboard(d.rd_id)}><Copy className="w-3 h-3" /></Button>
                          </div>
                          {d.rd_last_connected && <p className="text-[10px] text-muted-foreground mt-1">Last: {new Date(d.rd_last_connected).toLocaleString()}</p>}
                        </div>
                        {d.managed_asset === false ? (
                          <Button size="sm" variant="outline" onClick={() => { setLinkPeer(d); setLinkSearch(""); }} data-testid={`link-card-${d.id}`}>
                            <Link2 className="w-3 h-3 mr-1" />Link asset
                          </Button>
                        ) : (
                          <RemoteAccessButton
                            device={{ ...d, rustdesk_id: d.rd_id }}
                            status={getLivePeerStatus(d.rd_id) ? (getLivePeerStatus(d.rd_id)?.online ? "online" : "offline") : d.status}
                            compact
                            providersOverride={activeProviders}
                            testid={`connect-card-${d.id}`}
                          />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          {registryFiltered.length > registryLimit && (
            <div className="flex items-center justify-center">
              <Button variant="outline" size="sm" onClick={() => setRegistryLimit(limit => limit + 30)}>
                Show 30 more <span className="ml-1 text-muted-foreground">({registryFiltered.length - registryLimit} remaining)</span>
              </Button>
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

          <Card className="border-cyan-500/20 bg-cyan-500/[0.03]" data-testid="remote-access-policy">
            <CardContent className="py-4">
              <div className="flex flex-col xl:flex-row xl:items-center gap-4 justify-between">
                <div>
                  <p className="font-medium text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-cyan-400" />Remote access policy</p>
                  <p className="text-xs text-muted-foreground mt-1">Sets the default technician path, consent controls, and audit behaviour for every device.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-36">
                    <Label className="text-[10px] uppercase text-muted-foreground">Default tool</Label>
                    <Select value={remotePolicy.default_provider} onValueChange={v => setRemotePolicy(p => ({ ...p, default_provider: v }))}>
                      <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="rustdesk">RustDesk</SelectItem><SelectItem value="splashtop">Splashtop</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 pt-4"><Switch checked={!!remotePolicy.require_consent} onCheckedChange={v => setRemotePolicy(p => ({ ...p, require_consent: v }))} /><Label className="text-xs">Confirm consent</Label></div>
                  <div className="flex items-center gap-2 pt-4"><Switch checked={!!remotePolicy.require_ticket_reference} onCheckedChange={v => setRemotePolicy(p => ({ ...p, require_ticket_reference: v }))} /><Label className="text-xs">Require ticket</Label></div>
                  <Button size="sm" onClick={saveRemotePolicy} disabled={savingPolicy} className="mt-4"><Save className="w-3 h-3 mr-1" />{savingPolicy ? "Saving" : "Save policy"}</Button>
                </div>
              </div>
            </CardContent>
          </Card>

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
              <Button size="sm" variant="outline" onClick={syncFromServer} disabled={syncing}>{syncing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Sync to NexusMSP</Button>
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

        <TabsContent value="sessions" className="mt-4">
          <Card className="border-border/40">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm flex items-center gap-2"><History className="w-4 h-4 text-sky-400" />Remote session evidence</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Technician, endpoint, client, status, and launch time retained for operational review.</p>
              </div>
              <Badge variant="outline" className="shrink-0">{sessions.length} records</Badge>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No remote sessions recorded</p>
              ) : (
                <ScrollArea className="h-80">
                  <div className="space-y-2">
                    {sessions.map(s => (
                      <div key={s.id} className="flex flex-col gap-3 rounded-xl border border-border/40 bg-card/40 p-3 transition-colors hover:border-sky-500/20 hover:bg-sky-500/[0.025] sm:flex-row sm:items-center" data-testid={`session-${s.id}`}>
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.status === "completed" ? "bg-emerald-500/10" : "bg-sky-500/10"}`}><Play className={`w-4 h-4 ${s.status === "completed" ? "text-emerald-400" : "text-sky-400"}`} /></div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            <span className="text-muted-foreground">{s.user_name}</span>{" "}
                            {s.status === "completed" ? "completed a session with" : "prepared remote access to"}{" "}
                            <span className="text-foreground">{s.device_name || "RustDesk endpoint"}</span>
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                            <span>{s.client_name || (s.client_id ? `Client ${s.client_id}` : "Unlinked quick connect")}</span>
                            <span>·</span>
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{s.rustdesk_id}</code>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          <Badge variant="outline" className={`text-[10px] capitalize ${s.status === "completed" ? "border-emerald-500/25 text-emerald-300" : "border-sky-500/25 text-sky-300"}`}>{s.status}</Badge>
                          <span className="whitespace-nowrap text-[10px] text-muted-foreground">{s.started_at ? new Date(s.started_at).toLocaleString() : ""}</span>
                        </div>
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
      <Dialog open={!!linkPeer} onOpenChange={open => { if (!open) { setLinkPeer(null); setLinkSearch(""); } }}>
        <DialogContent className="max-w-xl border-cyan-400/20 bg-[#071019]" aria-describedby="link-provider-record-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-cyan-300" />Link provider record</DialogTitle>
            <DialogDescription id="link-provider-record-desc">Attach this RustDesk identity to one canonical NexusMSP managed asset. The relationship is retained in the audit trail.</DialogDescription>
          </DialogHeader>
          {linkPeer && (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4 sm:grid-cols-2">
                <div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Provider record</p><p className="mt-1 text-sm font-semibold">{linkPeer.name || "Unlinked device"}</p></div>
                <div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">RustDesk ID</p><p className="mt-1 font-mono text-sm text-cyan-200">{linkPeer.rd_id}</p></div>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={linkSearch} onChange={event => setLinkSearch(event.target.value)} placeholder="Search unlinked assets by device, client, or IP..." className="pl-9" data-testid="link-asset-search" />
              </div>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {linkCandidates.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 p-8 text-center">
                    <p className="text-sm font-medium">No available assets match</p>
                    <p className="mt-1 text-xs text-muted-foreground">Only managed assets without an existing RustDesk identity are shown.</p>
                  </div>
                ) : linkCandidates.map(device => (
                  <div key={device.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/40 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{device.name || device.hostname}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{device.client_name || "Unassigned client"}{device.ip_address ? ` · ${device.ip_address}` : ""}</p>
                    </div>
                    <Button size="sm" onClick={() => linkProviderPeer(device)} disabled={!!linkingDevice} data-testid={`link-peer-to-${device.id}`}>
                      {linkingDevice === device.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />}
                      Link
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => { setLinkPeer(null); setLinkSearch(""); }}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>

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
            <SetupGuideCallout title="Prepare your RustDesk server" source="NexusMSP uses the RustDesk Server Pro web-console API for live peer status and synchronisation. Generate an API token in the RustDesk Web Console under Settings → API Tokens." steps={["Enter the web-console API URL, normally including port 21114.", "Generate a least-privileged API token in the RustDesk web console.", "Use Test Connection before saving so the peer endpoint is confirmed."]} securityNote="Keep the API token in NexusMSP only. The open-source RustDesk server does not expose the Server Pro REST API used by this workspace." />
            <div className="space-y-2"><Label>Server URL *</Label><Input value={settingsForm.server_url} onChange={e => setSettingsForm({ ...settingsForm, server_url: e.target.value })} placeholder="https://your-server:21114" required data-testid="settings-server" /><p className="text-[10px] text-muted-foreground">The full URL of your RustDesk API server, including port (default RustDesk Pro API port is 21114)</p></div>
            <div className="space-y-2"><Label>API Key</Label><Input value={settingsForm.api_key} onChange={e => setSettingsForm({ ...settingsForm, api_key: e.target.value })} placeholder="Your RustDesk API key" type="password" data-testid="settings-key" /><p className="text-[10px] text-muted-foreground">Generate from RustDesk Web Console → Settings → API Tokens (required for peer list &amp; sync)</p></div>
            <div className="space-y-2"><Label>Relay Server (optional)</Label><Input value={settingsForm.relay_server} onChange={e => setSettingsForm({ ...settingsForm, relay_server: e.target.value })} placeholder="relay.yourdomain.com" data-testid="settings-relay" /><p className="text-[10px] text-muted-foreground">Only needed if your relay runs on a separate host from the ID server</p></div>
            <div className="flex items-center justify-between py-2">
              <div><Label>Auto-Sync (every 5 min)</Label><p className="text-xs text-muted-foreground">Automatically pull live peer status from server</p></div>
              <Switch checked={settingsForm.auto_sync !== false} onCheckedChange={v => setSettingsForm({ ...settingsForm, auto_sync: v })} data-testid="settings-auto-sync" />
            </div>
            <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-muted-foreground">
              <p className="font-medium text-blue-400 mb-1">RustDesk Server Pro Required</p>
              <p>NexusMSP requires <strong>RustDesk Server Pro</strong> for the live API. The OSS server does not expose a REST API. Enter the Web Console API URL (default port <code>21114</code>) and generate a token from Settings → API.</p>
            </div>
            {connectionResult && (
              <div className={`p-3 rounded-lg text-xs border ${(connectionResult.authorized ?? connectionResult.connected) ? "bg-emerald-500/5 border-emerald-500/20" : connectionResult.connected ? "bg-amber-500/5 border-amber-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                <p className={`font-medium mb-1 ${(connectionResult.authorized ?? connectionResult.connected) ? "text-emerald-400" : connectionResult.connected ? "text-amber-300" : "text-red-400"}`}>
                  {(connectionResult.authorized ?? connectionResult.connected) ? "Connected and Authorised" : connectionResult.connected ? "Server Reachable · Access Required" : "Connection Failed"}
                </p>
                <p className="text-muted-foreground">{connectionResult.message}</p>
                {connectionResult.peer_count != null && <p className="mt-1 text-muted-foreground">Peers found: <strong className="text-white">{connectionResult.peer_count}</strong></p>}
                {connectionResult.endpoints_available?.length > 0 && (
                  <p className="mt-1 text-muted-foreground">API endpoints: {connectionResult.endpoints_available.map(e => `${e.path} (${e.status})`).join(", ")}</p>
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

      {/* Remote Connection Dialog */}
      <Dialog open={!!connectDialog} onOpenChange={v => { if (!v) setConnectDialog(null); }}>
        <DialogContent className="max-w-md" aria-describedby="connect-dialog-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Play className="w-5 h-5 text-emerald-400" />Connect to {connectDialog?.device_name}</DialogTitle>
            <DialogDescription id="connect-dialog-desc">Choose how to connect to this device</DialogDescription>
          </DialogHeader>
          {connectDialog && (
            <div className="space-y-4">
              {/* Device Info */}
              <Card className="bg-zinc-800/50 border-border/30">
                <CardContent className="py-3 px-4 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">RustDesk ID</span>
                    <span className="font-mono font-bold text-emerald-400">{connectDialog.rustdesk_id}</span>
                  </div>
                  {connectDialog.rustdesk_password && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Password</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs">{showPassword["connect"] ? connectDialog.rustdesk_password : "********"}</span>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setShowPassword(p => ({ ...p, connect: !p.connect }))}>
                          {showPassword["connect"] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => { navigator.clipboard.writeText(connectDialog.rustdesk_password); toast.success("Password copied"); }}>
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                  {connectDialog.relay_server && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Relay Server</span>
                      <span className="font-mono text-xs text-muted-foreground">{connectDialog.relay_server}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Connection Methods */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Launch Connection</Label>

                {/* Native RustDesk Client */}
                <Button className="w-full justify-start h-12" variant="default" onClick={() => { launchRustDesk(connectDialog.rustdesk_id, connectDialog.relay_server || connectDialog.web_client_url); toast.success("Launching RustDesk client..."); }} data-testid="launch-native-rustdesk">
                  <Monitor className="w-5 h-5 mr-3" />
                  <div className="text-left">
                    <p className="text-sm font-medium">Open in RustDesk Client</p>
                    <p className="text-[10px] opacity-70">Requires RustDesk installed on this computer</p>
                  </div>
                </Button>

                {/* Web Client (if server configured) */}
                {connectDialog.web_client_url && (
                  <Button className="w-full justify-start h-12" variant="outline" onClick={() => { window.open(connectDialog.web_client_url, "_blank"); toast.success("Opening web client..."); }} data-testid="launch-web-rustdesk">
                    <Globe className="w-5 h-5 mr-3" />
                    <div className="text-left">
                      <p className="text-sm font-medium">Open Web Client</p>
                      <p className="text-[10px] text-muted-foreground">Connect via browser at {connectDialog.web_client_url}</p>
                    </div>
                  </Button>
                )}

                {/* Copy ID for manual connection */}
                <Button className="w-full justify-start h-12" variant="outline" onClick={() => { navigator.clipboard.writeText(connectDialog.rustdesk_id); toast.success(`ID ${connectDialog.rustdesk_id} copied — paste into RustDesk`); }} data-testid="copy-rustdesk-id">
                  <Copy className="w-5 h-5 mr-3" />
                  <div className="text-left">
                    <p className="text-sm font-medium">Copy ID to Clipboard</p>
                    <p className="text-[10px] text-muted-foreground">Manually paste into your RustDesk client</p>
                  </div>
                </Button>
              </div>

              <div className="text-xs text-muted-foreground bg-muted/10 p-3 rounded-lg">
                <p className="font-medium mb-1">Troubleshooting</p>
                <ul className="space-y-0.5 list-disc pl-3">
                  <li>Ensure the RustDesk client is installed and running on your machine</li>
                  <li>The target device must be online with RustDesk running</li>
                  <li>If the native launch doesn't work, copy the ID and connect manually</li>
                  {connectDialog.relay_server && <li>Your relay server is: <code className="font-mono text-emerald-400">{connectDialog.relay_server}</code></li>}
                </ul>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectDialog(null)}>Close</Button>
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
