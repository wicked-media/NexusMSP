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
  Link2, Unlink, Eye, Pencil, Check, History, Globe,
  Rocket, CheckCircle, AlertCircle, SquareCheckBig, XCircle,
  Plug, TestTube, Save, BookOpen, Wrench
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { MetricStrip, MetricTile } from "@/components/design-system";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import SetupGuideCallout from "@/components/SetupGuideCallout";
import RemoteAccessButton from "@/components/devices/RemoteAccessButton";
import { canStartWorkSession, workSessionPath } from "@/lib/workSessionNavigation";

const TYPE_ICONS = { server: Server, workstation: Monitor, laptop: Laptop, network: Wifi };

const NATIVE_REMOTE_STAGES = [
  { id: "trust", label: "Trust core", detail: "Signed grants, consent, view/control separation and revocation", status: "Ready", icon: Shield },
  { id: "companion", label: "Remote Companion", detail: "Attended desktop capture and guarded input inside the signed Nexus Agent", status: "Build next", icon: Laptop },
  { id: "relay", label: "Nexus Relay", detail: "Mutually authenticated, bandwidth-bounded connection and reconnect path", status: "Pending", icon: Globe },
  { id: "viewer", label: "Technician Viewer", detail: "Multi-monitor workspace with visible session state and stop controls", status: "Pending", icon: Monitor },
];

const NATIVE_REMOTE_TARGETS = [
  "Multi-monitor",
  "Reboot & reconnect",
  "Secure clipboard and files",
  "Session recording",
  "Multi-technician sessions",
  "Background diagnostics",
  "In-session chat",
  "Ticket and billing evidence",
];

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
  const [showAssign, setShowAssign] = useState(null);
  const [assignForm, setAssignForm] = useState({ rustdesk_id: "", rustdesk_password: "" });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ server_url: "", api_key: "", relay_server: "", enabled: true, auto_sync: true });
  const [submitting, setSubmitting] = useState(false);
  const [selectedDevices, setSelectedDevices] = useState(new Set());
  const [focusedDevice, setFocusedDevice] = useState(null);
  const [focusedTicketId, setFocusedTicketId] = useState(null);
  const [focusedWorkSessionId, setFocusedWorkSessionId] = useState(null);
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
        setFocusedWorkSessionId(searchParams.get("workSession"));
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
    nextParams.delete("workSession");
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

  // Link the current RustDesk transport identity to a Nexus-managed asset.
  const assignRustdeskId = async (e) => {
    e.preventDefault();
    if (!assignForm.rustdesk_id.trim()) { toast.error("A transport ID is required"); return; }
    setSubmitting(true);
    try {
      await axios.put(`${API}/rustdesk/assign/${showAssign.id}`, assignForm, { headers });
      toast.success(`Remote transport identity linked to ${showAssign.name || showAssign.hostname}`);
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

  // Live sync from the configured RustDesk transport server.
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

  // Provider tests use the server-owned configuration; save edits before testing.
  const testConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const res = await axios.get(`${API}/rustdesk/live/test-connection`, { headers });
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
      toast.success(data.message || "Remote transport record linked");
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
        title="Nexus Remote"
        description="The first-party session desk for governed support: endpoint context, technician approval, client consent, connection lifecycle and durable work evidence."
        icon={Laptop}
        tone="sky"
        signal="working"
        signalLabel="Native engine in development"
        signalDescription="The safety core is ready; companion, relay and viewer remain gated."
        actions={<>
          <Button variant="outline" size="sm" onClick={() => { setSettingsForm(config || { server_url: "", api_key: "", relay_server: "", enabled: true }); setShowSettings(true); }} data-testid="settings-btn"><Settings className="w-4 h-4 mr-2" />Remote settings</Button>
          <Button variant="outline" size="sm" onClick={fetchData} data-testid="refresh-remote-access"><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
        </>}
      />

      {/* Nexus Remote control-plane status. The transport remains explicit: Nexus owns
          policy, identity, consent and evidence; a configured provider carries pixels. */}
      <Card className={`border ${serverConfigured ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${serverConfigured ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
              <div>
                <span className={`text-sm font-semibold ${serverConfigured ? "text-emerald-400" : "text-amber-400"}`}>
                  {serverConfigured ? "Compatibility bridge online" : "Compatibility bridge not configured"}
                </span>
                {serverConfigured && <Badge variant="outline" className="ml-2 border-cyan-400/25 text-[10px] text-cyan-300">Interim transport</Badge>}
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
                    {testingConnection ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Wifi className="w-3 h-3 mr-1" />}Test bridge
                  </Button>
                  <Button size="sm" variant="default" onClick={syncFromServer} disabled={syncing} data-testid="sync-live-btn">
                    {syncing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Sync devices
                  </Button>
                </>
              )}
              {!serverConfigured && <Button size="sm" onClick={() => { setSettingsForm(config || {}); setShowSettings(true); }} data-testid="configure-remote-access">Configure transport</Button>}
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
                <div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{focusedDevice.name || focusedDevice.hostname}</p><Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/10 text-[10px] text-cyan-200">Remote-ready focus</Badge>{focusedTicketId && <Badge variant="outline" className="text-[10px]">Ticket {focusedTicketId}</Badge>}{focusedWorkSessionId && <Badge variant="outline" className="border-violet-400/30 bg-violet-400/10 text-[10px] text-violet-100">Work Session time owner</Badge>}</div>
                <p className="mt-1 text-xs text-muted-foreground">{focusedDevice.client_name || "Unassigned client"} · {focusedDevice.os || focusedDevice.operating_system || "Operating system not reported"} · Remote ID {focusedDevice.rustdesk_id || focusedDevice.rd_id}</p>
                <p className="mt-1 text-[11px] text-cyan-100/70">{focusedWorkSessionId ? "Opened from Nexus Work Session. Remote evidence remains here; time is reviewed once in the completion pack." : "Opened from operational context. Technician authorisation, consent, provider handoff and session evidence remain in one governed workflow."}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate(`/devices/${focusedDevice.id}`)}><Eye className="mr-1.5 h-4 w-4" />Device record</Button>
              {canStartWorkSession(focusedTicketId) && <Button variant="outline" size="sm" className="border-violet-400/30 bg-violet-500/[0.05] text-violet-700 hover:bg-violet-500/10 dark:text-violet-100" onClick={() => navigate(workSessionPath(focusedTicketId))} data-testid="start-work-from-remote"><Wrench className="mr-1.5 h-4 w-4" />{focusedWorkSessionId ? "Open work" : "Start work"}</Button>}
              <RemoteAccessButton device={{ ...focusedDevice, rustdesk_id: focusedDevice.rustdesk_id || focusedDevice.rd_id }} status={focusedDevice.status} ticketId={focusedTicketId} workSessionId={focusedWorkSessionId} testid="focused-device-remote" />
              <Button variant="ghost" size="icon" aria-label="Clear focused device" onClick={() => { setFocusedDevice(null); setFocusedTicketId(null); setFocusedWorkSessionId(null); setSearch(""); }}><XCircle className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Governed remote-access handoff */}
      <Card className="border-cyan-400/20 bg-cyan-400/[0.035]">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10"><Shield className="w-4 h-4 text-cyan-300" /></div><div><p className="text-sm font-semibold">Governed remote access</p><p className="text-xs text-muted-foreground">Select a managed asset so Nexus can enforce scope, consent, ticket context and session evidence.</p></div></div>
            <Button variant="outline" className="sm:ml-auto sm:min-w-40" onClick={() => navigate("/devices")} data-testid="choose-managed-asset-btn"><Monitor className="mr-1.5 h-4 w-4" />Choose managed asset</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-cyan-400/20 bg-[linear-gradient(112deg,rgba(14,116,144,0.12),rgba(15,23,42,0.88)_48%,rgba(30,64,175,0.08))]" data-testid="nexus-remote-control-plane" data-native-roadmap="true">
        <CardContent className="p-4 md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 xl:max-w-[34rem]">
              <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/10 text-[10px] uppercase tracking-[0.16em] text-cyan-100">Nexus Native</Badge><Badge variant="outline" className="border-emerald-400/25 text-[10px] text-emerald-300">Safety core ready</Badge></div>
              <p className="mt-2 text-base font-semibold tracking-tight">A first-party remote engine, built in safety-gated stages.</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Nexus already owns scope, technician identity, consent, ticket context, time and audit evidence. The native engine now has signed grants and a local attended-session controller; capture, relay and viewer remain unavailable until their acceptance gates pass.</p>
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Nexus Native target capabilities">
                {NATIVE_REMOTE_TARGETS.map(capability => <Badge key={capability} variant="secondary" className="text-[9px] font-normal">{capability}</Badge>)}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate("/nexus-agent")}><Rocket className="mr-1.5 h-3.5 w-3.5" />Open Nexus Agent</Button>
                <Button size="sm" variant="ghost" onClick={() => setTab("sessions")}><History className="mr-1.5 h-3.5 w-3.5" />Session evidence</Button>
              </div>
            </div>
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 xl:max-w-[38rem]">
              {NATIVE_REMOTE_STAGES.map((stage, index) => {
                const StageIcon = stage.icon;
                const ready = stage.status === "Ready";
                return <div key={stage.id} className={`rounded-xl border p-3 ${ready ? "border-emerald-400/25 bg-emerald-400/[0.06]" : "border-cyan-400/15 bg-black/10"}`}><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-100"><StageIcon className={`h-3.5 w-3.5 ${ready ? "text-emerald-300" : "text-cyan-300"}`} />{index + 1}. {stage.label}</span><Badge variant="outline" className={`text-[9px] ${ready ? "border-emerald-400/25 text-emerald-300" : "border-border text-muted-foreground"}`}>{stage.status}</Badge></div><p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{stage.detail}</p></div>;
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <MetricStrip columns={5}>
        {[
          { label: "Nexus Fleet", value: managedDevices.length, icon: Monitor, color: "text-sky-400", accent: "sky" },
          { label: "Session Ready", value: managedRegistered.length, icon: Link2, color: "text-emerald-400", accent: "emerald" },
          { label: "Needs Enrolment", value: managedUnregistered.length, icon: Unlink, color: "text-amber-400", accent: "amber" },
          { label: "Transport-only", value: providerOnlyDevices.length, icon: Globe, color: "text-violet-400", accent: "violet" },
          { label: "Live Peers", value: livePeers ? livePeers.peers.filter(p => p.online).length : online.length, icon: Wifi, color: "text-cyan-400", accent: "cyan" },
        ].map(st => (
          <MetricTile key={st.label} label={st.label} value={st.value} accent={st.accent} icon={<st.icon className={`w-2.5 h-2.5 ${st.color}`} />} testid={`remote-metric-${st.label.toLowerCase().replace(/\s+/g, "-")}`} />
        ))}
      </MetricStrip>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-border/50 bg-card/70 p-1.5 sm:w-fit">
          <TabsTrigger value="devices">Nexus Fleet ({managedDevices.length})</TabsTrigger>
          <TabsTrigger value="registered">Remote Registry ({registered.length})</TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-integrations"><Plug className="w-3 h-3 mr-1" />Compatibility ({providers.length})</TabsTrigger>
          {livePeers && <TabsTrigger value="live-peers" data-testid="tab-live-peers"><Wifi className="w-3 h-3 mr-1" />Bridge Health ({livePeers.count})</TabsTrigger>}
          <TabsTrigger value="sessions">Session Evidence ({sessions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="devices" className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search fleet by device, hostname, transport ID or client..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="device-search" />
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
                  <TableHead>Status</TableHead><TableHead>Transport ID</TableHead><TableHead className="hidden xl:table-cell">Agent</TableHead><TableHead className="hidden xl:table-cell">Last Connected</TableHead><TableHead></TableHead>
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
                  placeholder="Search transport records by device, client, or transport ID..."
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  className="pl-9"
                  data-testid="provider-registry-search"
                />
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="border-emerald-500/25 text-emerald-300">{managedRegistered.length} linked to Nexus assets</Badge>
                <Badge variant="outline" className="border-violet-500/25 text-violet-300">{providerOnlyDevices.length} transport-only</Badge>
              </div>
            </CardContent>
          </Card>
          {registered.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><Unlink className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" /><p className="text-muted-foreground">No remote transport identities are linked yet</p><p className="text-xs text-muted-foreground mt-1">Open Nexus Fleet and link the endpoint’s RustDesk transport ID.</p></CardContent></Card>
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
            <div><p className="text-sm font-medium">Compatibility bridges</p><p className="mt-1 text-xs text-muted-foreground">Temporary provider adapters remain available while Nexus Native completes companion, relay and viewer acceptance.</p></div>
            <Badge variant="outline" className="text-xs">{providers.filter(p => p.active).length} Active / {providers.length} Available</Badge>
          </div>

          <Card className="border-cyan-500/20 bg-cyan-500/[0.03]" data-testid="remote-access-policy">
            <CardContent className="py-4">
              <div className="flex flex-col xl:flex-row xl:items-center gap-4 justify-between">
                <div>
                  <p className="font-medium text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-cyan-400" />Nexus Remote policy</p>
                  <p className="text-xs text-muted-foreground mt-1">Sets the default technician path, consent controls, and audit behaviour for every device.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-36">
                    <Label className="text-[10px] uppercase text-muted-foreground">Fallback bridge</Label>
                    <Select value={remotePolicy.default_provider} onValueChange={v => setRemotePolicy(p => ({ ...p, default_provider: v }))}>
                      <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="rustdesk">RustDesk compatibility</SelectItem><SelectItem value="splashtop">Splashtop compatibility</SelectItem><SelectItem value="nexus" disabled>Nexus Native · build in progress</SelectItem></SelectContent>
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
              <p className="text-sm text-muted-foreground">Real-time transport data from <span className="font-mono text-xs">{livePeers.server_url}</span> {livePeers.source && <Badge variant="outline" className="ml-1 text-[10px]">via {livePeers.source}</Badge>}</p>
              <Button size="sm" variant="outline" onClick={syncFromServer} disabled={syncing}>{syncing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Sync to NexusMSP</Button>
            </div>
            <Card className="border-border/40">
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Transport ID</TableHead><TableHead>Hostname</TableHead><TableHead>OS</TableHead>
                    <TableHead>Status</TableHead><TableHead>Version</TableHead><TableHead>Alias</TableHead><TableHead>Linked</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {livePeers.peers.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No peers found on the configured transport. Check the server API permissions.</TableCell></TableRow>
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
                <CardTitle className="text-sm flex items-center gap-2"><History className="w-4 h-4 text-sky-400" />Nexus session evidence</CardTitle>
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
                            <span className="text-foreground">{s.device_name || "managed endpoint"}</span>
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

      {/* Link a known transport identity to the canonical Nexus asset. */}
      <Dialog open={!!linkPeer} onOpenChange={open => { if (!open) { setLinkPeer(null); setLinkSearch(""); } }}>
        <DialogContent className="flex h-[min(820px,calc(100vh-1.5rem))] max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-xl flex-col gap-0 overflow-hidden border-cyan-400/20 bg-[#071019] p-0 sm:rounded-2xl" aria-describedby="link-provider-record-desc">
          <DialogHeader className="shrink-0 border-b border-cyan-400/15 bg-cyan-400/[0.04] px-5 py-5 pr-12">
            <DialogTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-cyan-300" />Link transport identity</DialogTitle>
            <DialogDescription id="link-provider-record-desc">Attach this RustDesk transport identity to one canonical NexusMSP managed asset. Nexus retains the relationship and session evidence in its audit trail.</DialogDescription>
          </DialogHeader>
          {linkPeer && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
              <div className="grid gap-3 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4 sm:grid-cols-2">
                <div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Transport record</p><p className="mt-1 text-sm font-semibold">{linkPeer.name || "Unlinked device"}</p></div>
                <div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">RustDesk transport ID</p><p className="mt-1 font-mono text-sm text-cyan-200">{linkPeer.rd_id}</p></div>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={linkSearch} onChange={event => setLinkSearch(event.target.value)} placeholder="Search unlinked assets by device, client, or IP..." className="pl-9" data-testid="link-asset-search" />
              </div>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {linkCandidates.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 p-8 text-center">
                    <p className="text-sm font-medium">No available assets match</p>
                    <p className="mt-1 text-xs text-muted-foreground">Only managed assets without an existing transport identity are shown.</p>
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
          <DialogFooter className="shrink-0 border-t border-cyan-400/15 bg-black/10 px-5 py-4"><Button variant="outline" onClick={() => { setLinkPeer(null); setLinkSearch(""); }}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showAssign} onOpenChange={() => setShowAssign(null)}>
        <DialogContent className="max-w-sm" aria-describedby="assign-rd-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 className="w-5 h-5 text-blue-400" />{showAssign?.rd_id ? "Edit" : "Link"} remote transport</DialogTitle>
            <DialogDescription id="assign-rd-desc">{showAssign?.name || showAssign?.hostname} — {showAssign?.client_name}</DialogDescription>
          </DialogHeader>
          <form onSubmit={assignRustdeskId} className="space-y-4">
            <div className="space-y-2">
              <Label>RustDesk transport ID *</Label>
              <Input value={assignForm.rustdesk_id} onChange={e => setAssignForm({ ...assignForm, rustdesk_id: e.target.value })} placeholder="e.g., 842931675" className="font-mono" required data-testid="assign-rd-id" />
              <p className="text-[10px] text-muted-foreground">The identity shown in the RustDesk transport client installed on this endpoint.</p>
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
            <DialogTitle className="flex items-center gap-2"><Settings className="w-5 h-5 text-muted-foreground" />Nexus Remote transport settings</DialogTitle>
            <DialogDescription id="settings-desc">Configure the RustDesk transport behind Nexus Remote. Nexus keeps policy, consent and session evidence separate from this provider connection.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveSettings} className="space-y-4">
            <SetupGuideCallout title="Connect a RustDesk transport" source="Nexus Remote uses the RustDesk Server Pro web-console API only for transport peer status and synchronisation. Nexus itself owns the technician journey, policy and audit trail." steps={["Enter the approved web-console API URL, normally including port 21114.", "Generate a least-privileged API token in the RustDesk web console.", "Save the approved configuration, then run Test Connection before enabling use."]} securityNote="Keep the API token in NexusMSP only. The open-source RustDesk server does not expose the Server Pro REST API used for live transport status." />
            <div className="space-y-2"><Label>RustDesk transport URL *</Label><Input value={settingsForm.server_url} onChange={e => setSettingsForm({ ...settingsForm, server_url: e.target.value })} placeholder="https://your-server:21114" required data-testid="settings-server" /><p className="text-[10px] text-muted-foreground">The approved RustDesk API origin, including port where required. Save first; Nexus only tests the stored, server-owned configuration.</p></div>
            <div className="space-y-2"><Label>Transport API token</Label><Input value={settingsForm.api_key} onChange={e => setSettingsForm({ ...settingsForm, api_key: e.target.value })} placeholder="RustDesk API token" type="password" data-testid="settings-key" /><p className="text-[10px] text-muted-foreground">Generated in RustDesk Web Console → Settings → API Tokens. It is used for peer list and synchronisation only.</p></div>
            <div className="space-y-2"><Label>Relay Server (optional)</Label><Input value={settingsForm.relay_server} onChange={e => setSettingsForm({ ...settingsForm, relay_server: e.target.value })} placeholder="relay.yourdomain.com" data-testid="settings-relay" /><p className="text-[10px] text-muted-foreground">Only needed if your relay runs on a separate host from the ID server</p></div>
            <div className="flex items-center justify-between py-2">
              <div><Label>Auto-Sync (every 5 min)</Label><p className="text-xs text-muted-foreground">Automatically pull live peer status from server</p></div>
              <Switch checked={settingsForm.auto_sync !== false} onCheckedChange={v => setSettingsForm({ ...settingsForm, auto_sync: v })} data-testid="settings-auto-sync" />
            </div>
            <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-muted-foreground">
              <p className="font-medium text-blue-400 mb-1">Transport capability boundary</p>
              <p>Live peer inventory requires <strong>RustDesk Server Pro</strong>. The OSS server does not expose the REST API Nexus uses for transport visibility. This setting does not weaken Nexus policy or create unattended access by itself.</p>
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
              <Button type="button" variant="outline" onClick={testConnection} disabled={testingConnection || !config?.server_url || settingsForm.server_url !== config?.server_url} data-testid="test-settings-btn">{testingConnection ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wifi className="w-4 h-4 mr-1" />}Test saved configuration</Button>
              <Button type="submit" disabled={submitting} data-testid="save-settings-btn">{submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save Settings</Button>
            </DialogFooter>
          </form>
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
