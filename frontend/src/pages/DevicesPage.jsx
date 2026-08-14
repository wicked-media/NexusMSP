import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";
import { Server, Monitor, Laptop, Wifi, Plus, Search, RefreshCw, CheckCircle, ChevronRight, LayoutGrid, List, Shield, Download, Loader2, Trash2, Edit, Radar, Eye, Users, Terminal, Cloud, Sparkles, BarChart3, Zap, Flame, Rows3, AlignJustify, Maximize2, MessageSquare, MoreHorizontal, ChevronDown, CalendarClock } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Dialog } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RemoteAccessButton from "../components/devices/RemoteAccessButton";
import DeviceCommandStrip from "../components/devices/DeviceCommandStrip";
import DeviceBulkBar from "../components/devices/DeviceBulkBar";
import DeviceMapView from "../components/devices/DeviceMapView";
import DevicesSmartBar from "../components/devices/DevicesSmartBar";
import FleetPulseWall from "../components/devices/FleetPulseWall";
import TopRisksStrip from "../components/devices/TopRisksStrip";
import ActivityTicker from "../components/devices/ActivityTicker";
import TopTalkersPanel from "../components/devices/TopTalkersPanel";
import OfflineWatch from "../components/devices/OfflineWatch";
import SavedViewsBar from "../components/devices/SavedViewsBar";
import QuickScriptDialog from "../components/devices/QuickScriptDialog";
import RiskHeatmapCanvas from "../components/devices/RiskHeatmapCanvas";
import LifecycleTimeline from "../components/devices/LifecycleTimeline";
import AnomalyInbox from "../components/devices/AnomalyInbox";
import Sparkline from "../components/devices/Sparkline";
import StatusOrb from "../components/devices/StatusOrb";
import DeviceThumbnail from "../components/devices/DeviceThumbnail";
import { toast } from "sonner";

import { API, useAuth } from "../App";
import { PageShell } from "@/components/design-system";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import WorkspaceControlBar from "@/components/WorkspaceControlBar";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";

const DEVICE_ICONS = { server: Server, workstation: Monitor, laptop: Laptop, network: Wifi, mobile: Laptop };
const STATUS_COLORS = { online: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", offline: "bg-red-500/10 text-red-500 border-red-500/20", warning: "bg-amber-500/10 text-amber-500 border-amber-500/20" };
const ELEVATE_STATE_META = {
  active: { label: "Elevate active", className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
  deploying: { label: "Elevate deploying", className: "border-sky-500/30 bg-sky-500/15 text-sky-300" },
  requires_agent_update: { label: "Elevate needs update", className: "border-amber-500/30 bg-amber-500/15 text-amber-200" },
  deployment_failed: { label: "Elevate needs repair", className: "border-rose-500/30 bg-rose-500/15 text-rose-200" },
  awaiting_companion_build: { label: "Elevate awaiting build", className: "border-zinc-500/30 bg-zinc-500/15 text-zinc-300" },
  unsupported_platform: { label: "Elevate unsupported", className: "border-zinc-500/30 bg-zinc-500/15 text-zinc-400" },
  paused: { label: "Elevate paused", className: "border-zinc-500/30 bg-zinc-500/15 text-zinc-400" },
};
const MANAGED_ASSET_TOOLS = [
  { path: "/nexus-agent", label: "NexusOps Agent", icon: Terminal },
  { path: "/maintenance-scheduler", label: "Maintenance", icon: CalendarClock },
  { path: "/patch-tuesday", label: "Patch Tuesday", icon: Shield },
];

function UsagePill({ value, thresholds = [70, 90] }) {
  const color = value >= thresholds[1] ? "text-red-500" : value >= thresholds[0] ? "text-amber-500" : "text-emerald-500";
  return <span className={`font-mono text-xs font-medium ${color}`}>{Math.round(value)}%</span>;
}

const emptyForm = { name: "", client_id: "", device_type: "workstation", os: "Windows 11", ip_address: "", serial_number: "", mac_address: "", manufacturer: "", model: "", processor: "", ram_gb: "", storage_total_gb: "", location: "", assigned_user: "", tags: "", notes: "" };

export default function DevicesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { token } = useAuth();
  const [devices, setDevices] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterClient, setFilterClient] = useState("all");
  const [viewMode, setViewMode] = useState("table");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [selectedDevices, setSelectedDevices] = useState([]);
  const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(false);
  const [discoveryClientId, setDiscoveryClientId] = useState("");
  const [discoverySubnet, setDiscoverySubnet] = useState("192.168.1.0/24");
  const [discoveryResults, setDiscoveryResults] = useState(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [selectedDiscovered, setSelectedDiscovered] = useState([]);
  const [importLoading, setImportLoading] = useState(false);
  const [deviceViewers, setDeviceViewers] = useState({});
  const [rdStatusMap, setRdStatusMap] = useState({});
  const [activeProviders, setActiveProviders] = useState([]);
  const [liveChatBusy, setLiveChatBusy] = useState({});
  const [siteMap, setSiteMap] = useState([]);
  const [tab, setTab] = useState("pulse");
  const [density, setDensity] = useState("comfortable"); // comfortable | compact | dense
  const [quickScriptOpen, setQuickScriptOpen] = useState(false);
  const [pulseCount, setPulseCount] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [isLinkingAcronis, setIsLinkingAcronis] = useState(false);
  const [maintenanceWindow, setMaintenanceWindow] = useState(null);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const filterSource = searchParams.get("source");
  const maintenanceWindowId = searchParams.get("maintenanceWindow");

  useEffect(() => {
    const clientId = searchParams.get("clientId");
    if (clientId) setFilterClient(clientId);
    const requestedSearch = searchParams.get("search");
    if (requestedSearch) {
      setSearch(requestedSearch);
      setTab("directory");
    }
  }, [searchParams]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (["pulse", "directory", "insights", "map"].includes(requestedTab)) setTab(requestedTab);
    if (searchParams.get("maintenance") === "1") {
      setTab("directory");
      toast.info("Select enrolled assets, then choose Schedule Window.");
      const next = new URLSearchParams(searchParams);
      next.delete("maintenance");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!maintenanceWindowId) {
      setMaintenanceWindow(null);
      return undefined;
    }
    let current = true;
    axios.get(`${API}/maintenance-windows/${maintenanceWindowId}`, { headers })
      .then((response) => {
        if (!current) return;
        const window = response.data;
        const deviceIds = [...new Set((window.device_ids || []).filter(Boolean))];
        setMaintenanceWindow(window);
        setSelectedDevices(deviceIds);
        setTab("directory");
      })
      .catch((error) => {
        if (current) toast.error(error.response?.data?.detail || "Maintenance window could not be loaded");
      });
    return () => { current = false; };
  }, [headers, maintenanceWindowId]);

  const fetchData = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const [devRes, clientRes] = await Promise.all([
        axios.get(`${API}/devices`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setDevices(devRes.data);
      setClients(clientRes.data);
      // Fetch active remote viewers
      try {
        const vRes = await axios.get(`${API}/devices/active-remote-viewers`, { headers });
        setDeviceViewers(vRes.data);
      } catch { setDeviceViewers({}); }
      // Fetch RustDesk live status
      try {
        const rdRes = await axios.get(`${API}/rustdesk/live/status-map`, { headers });
        if (rdRes.data?.status_map) setRdStatusMap(rdRes.data.status_map);
      } catch {}
      // Fetch active remote providers (TRMM/RustDesk/etc.) once per page load
      try {
        const pRes = await axios.get(`${API}/remote-providers/active`, { headers });
        setActiveProviders(pRes.data || []);
      } catch { setActiveProviders([]); }
      // Site map data
      try {
        const sRes = await axios.get(`${API}/devices/sites-map`, { headers });
        setSiteMap(sRes.data?.sites || []);
      } catch { setSiteMap([]); }
    } catch (e) {
      console.error(e);
      setLoadError("Nexus could not load managed assets. No device records have been changed.");
    } finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const startLiveChatForDevice = async (dev) => {
    if (!dev.nexus_agent_id) {
      toast.info("Install or link Nexus Agent before starting client chat");
      return;
    }
    setLiveChatBusy(current => ({ ...current, [dev.id]: true }));
    try {
      const response = await axios.post(`${API}/live-chat/devices/${dev.id}/open`, {}, { headers });
      const sessionId = response.data?.session?.id;
      if (!sessionId) throw new Error("No chat session returned");
      toast.success(`Live chat opened for ${dev.name}`);
      navigate(`/live-chat?session=${encodeURIComponent(sessionId)}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to start client chat");
    } finally {
      setLiveChatBusy(current => ({ ...current, [dev.id]: false }));
    }
  };


  // Poll for active remote viewers and RustDesk status every 15 seconds
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const [vRes, rdRes] = await Promise.all([
          axios.get(`${API}/devices/active-remote-viewers`, { headers }).catch(() => ({ data: {} })),
          axios.get(`${API}/rustdesk/live/status-map`, { headers }).catch(() => ({ data: {} })),
        ]);
        setDeviceViewers(vRes.data);
        if (rdRes.data?.status_map) setRdStatusMap(rdRes.data.status_map);
      } catch {}
    }, 15000);
    return () => clearInterval(poll);
  }, [headers]);

  const filtered = devices.filter(d => {
    if (filterSource && d.source !== filterSource) return false;
    if (filterStatus !== "all" && d.status !== filterStatus) return false;
    if (filterType !== "all" && d.device_type !== filterType) return false;
    if (filterClient !== "all" && d.client_id !== filterClient) return false;
    if (search) {
      const s = search.toLowerCase();
      return d.name.toLowerCase().includes(s) || (d.client_name || "").toLowerCase().includes(s) || (d.ip_address || "").includes(s) || (d.os || "").toLowerCase().includes(s) || (d.serial_number || "").toLowerCase().includes(s) || (d.manufacturer || "").toLowerCase().includes(s);
    }
    return true;
  });
  const fleetSignal = devices.some(device => device.status === "offline")
    ? "critical"
    : devices.some(device => device.status === "warning" || device.elevate_state === "deployment_failed" || device.elevate_state === "requires_agent_update")
      ? "attention"
      : devices.some(device => device.status === "online")
        ? "healthy"
        : "recommendation";

  const openCreate = () => { setEditing(null); setForm(emptyForm); setIsFormOpen(true); };
  const handleAutoLinkAcronis = async () => {
    setIsLinkingAcronis(true);
    try {
      const response = await axios.post(`${API}/devices/auto-link-acronis`, {}, { headers });
      toast.success(`Acronis reconciliation complete: ${response.data.matched} linked, ${response.data.no_match} need review`);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Acronis reconciliation failed");
    } finally {
      setIsLinkingAcronis(false);
    }
  };

  const openEdit = (d) => {
    setEditing(d);
    setForm({ name: d.name, client_id: d.client_id, device_type: d.device_type, os: d.os || "", ip_address: d.ip_address || "", serial_number: d.serial_number || "", mac_address: d.mac_address || "", manufacturer: d.manufacturer || "", model: d.model || "", processor: d.processor || "", ram_gb: d.ram_gb || "", storage_total_gb: d.storage_total_gb || "", location: d.location || "", assigned_user: d.assigned_user || "", tags: (d.tags || []).join(", "), notes: d.notes || "" });
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.client_id) { toast.error("Name and client required"); return; }
    try {
      const payload = { ...form, ram_gb: form.ram_gb ? parseFloat(form.ram_gb) : null, storage_total_gb: form.storage_total_gb ? parseFloat(form.storage_total_gb) : null, tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [] };
      if (editing) {
        await axios.put(`${API}/devices/${editing.id}`, payload, { headers });
        toast.success("Device updated");
      } else {
        await axios.post(`${API}/devices`, payload, { headers });
        toast.success("Device created");
      }
      setIsFormOpen(false);
      fetchData();
    } catch (e) { toast.error("Save failed"); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await axios.delete(`${API}/devices/${deleteTarget.id}`, { headers });
      toast.success("Device deleted");
      setDeleteTarget(null);
      fetchData();
    } catch (e) { toast.error("Delete failed"); }
    finally { setDeleteBusy(false); }
  };

  const toggleSelectDevice = (id) => {
    setSelectedDevices(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  };

  const selectAll = () => {
    if (selectedDevices.length === filtered.length) setSelectedDevices([]);
    else setSelectedDevices(filtered.map(d => d.id));
  };

  const handleDiscoverDevices = async () => {
    if (!discoveryClientId) { toast.error("Select a client first"); return; }
    setDiscoveryLoading(true);
    setDiscoveryResults(null);
    setSelectedDiscovered([]);
    try {
      const res = await axios.post(`${API}/devices/discover`, { client_id: discoveryClientId, subnet: discoverySubnet }, { headers });
      setDiscoveryResults(res.data);
    } catch { toast.error("Discovery failed"); }
    finally { setDiscoveryLoading(false); }
  };

  const handleImportDiscovered = async () => {
    if (!selectedDiscovered.length) { toast.error("Select devices to import"); return; }
    setImportLoading(true);
    try {
      const devicesToImport = discoveryResults.devices.filter(d => selectedDiscovered.includes(d.id));
      const res = await axios.post(`${API}/devices/import-discovered`, { client_id: discoveryClientId, devices: devicesToImport }, { headers });
      toast.success(res.data.message);
      setSelectedDiscovered([]);
      fetchData();
      // Re-run discovery to update already_imported flags
      handleDiscoverDevices();
    } catch { toast.error("Import failed"); }
    finally { setImportLoading(false); }
  };

  const toggleDiscoveredSelect = (id) => {
    setSelectedDiscovered(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  if (loading) return <WorkspaceLoadingState label="Loading managed assets" />;
  if (loadError) return <WorkspaceErrorState title="Managed assets are unavailable" description={loadError} onRetry={fetchData} retryLabel="Retry assets" />;

  const formDialog = (
    <Dialog open={isFormOpen} onOpenChange={v => { setIsFormOpen(v); if (!v) setEditing(null); }}>
      <NexusWorkflowDialog eyebrow="Asset register" title={editing ? `Refine ${editing.name}` : "Add managed asset"} description="Capture ownership, endpoint identity and operational context in one auditable asset record." icon={Monitor} tone="cyan" className="max-w-3xl" contentClassName="max-h-[68vh] space-y-5 overflow-y-auto" data-testid="device-asset-workflow" footer={<><Button variant="ghost" onClick={() => setIsFormOpen(false)}>Cancel</Button><Button variant="success" onClick={handleSave} data-testid="save-device-btn">{editing ? "Save asset" : "Create asset"}</Button></>}>
          <section className="space-y-3"><div><p className="text-xs font-semibold text-zinc-200">Identity & ownership</p><p className="mt-0.5 text-[11px] text-zinc-500">Required fields establish the client relationship and asset identity.</p></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Asset name *</Label><Input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="ACME-WS-001" data-testid="device-name-input" /></div>
            <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Client *</Label>
              <Select value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}>
                <SelectTrigger data-testid="device-client-select"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          </section>
          <section className="space-y-3 border-y border-white/[0.07] py-5"><div><p className="text-xs font-semibold text-zinc-200">Endpoint profile</p><p className="mt-0.5 text-[11px] text-zinc-500">Core technical details help technicians identify the right endpoint immediately.</p></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Type</Label>
              <Select value={form.device_type} onValueChange={v => setForm({ ...form, device_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="workstation">Workstation</SelectItem>
                  <SelectItem value="laptop">Laptop</SelectItem>
                  <SelectItem value="server">Server</SelectItem>
                  <SelectItem value="network">Network Device</SelectItem>
                  <SelectItem value="mobile">Mobile</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Operating system</Label><Input value={form.os} onChange={e => setForm({ ...form, os: e.target.value })} placeholder="Windows 11" /></div>
            <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">IP address</Label><Input value={form.ip_address} onChange={e => setForm({ ...form, ip_address: e.target.value })} placeholder="192.168.1.100" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Manufacturer</Label><Input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} placeholder="Dell" /></div>
            <div><Label>Model</Label><Input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="OptiPlex 7090" /></div>
            <div><Label>Serial Number</Label><Input value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} placeholder="SN-123456" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Processor</Label><Input value={form.processor} onChange={e => setForm({ ...form, processor: e.target.value })} placeholder="Intel Core i7-11700" /></div>
            <div><Label>RAM (GB)</Label><Input type="number" value={form.ram_gb} onChange={e => setForm({ ...form, ram_gb: e.target.value })} /></div>
            <div><Label>Storage (GB)</Label><Input type="number" value={form.storage_total_gb} onChange={e => setForm({ ...form, storage_total_gb: e.target.value })} /></div>
          </div>
          </section>
          <section className="space-y-3"><div><p className="text-xs font-semibold text-zinc-200">Operations context</p><p className="mt-0.5 text-[11px] text-zinc-500">Optional information used in search, dispatch and lifecycle work.</p></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Location</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Office Floor 2" /></div>
            <div><Label>Assigned User</Label><Input value={form.assigned_user} onChange={e => setForm({ ...form, assigned_user: e.target.value })} placeholder="john@acme.com" /></div>
          </div>
          <div><Label>MAC Address</Label><Input value={form.mac_address} onChange={e => setForm({ ...form, mac_address: e.target.value })} placeholder="00:1A:2B:3C:4D:5E" /></div>
          <div><Label>Tags (comma separated)</Label><Input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="production, vpn-user, critical" /></div>
          <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Additional notes..." /></div>
          </section>
      </NexusWorkflowDialog>
    </Dialog>
  );

  return (
    <PageShell className="nx-page-stage" data-testid="devices-page">
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

      {/* Header — matches Team Command Center pattern */}
      <div className="nx-ambient-surface flex items-center justify-between gap-4 overflow-hidden rounded-2xl border border-sky-500/20 bg-gradient-to-r from-sky-500/[0.10] via-card to-cyan-500/[0.05] p-5 flex-wrap" data-nx-signal={fleetSignal}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-cyan-300" />Managed Assets
          </h1>
          <p className="text-sm text-zinc-500">{devices.length} managed endpoints · live telemetry · fan-out actions · site map</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5" data-testid="device-asset-actions">
                <MoreHorizontal className="h-3.5 w-3.5" />Asset actions<ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => { setDiscoveryResults(null); setSelectedDiscovered([]); setIsDiscoveryOpen(true); }}>
                <Radar className="mr-2 h-3.5 w-3.5" />Discover network assets
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleAutoLinkAcronis} disabled={isLinkingAcronis} data-testid="auto-link-acronis-btn">
                {isLinkingAcronis ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Cloud className="mr-2 h-3.5 w-3.5" />}
                {isLinkingAcronis ? "Reconciling Acronis..." : "Reconcile Acronis backups"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/devices/compare")} data-testid="compare-devices-btn">
                <BarChart3 className="mr-2 h-3.5 w-3.5" />Compare healthy devices
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="success" onClick={openCreate} data-testid="add-device-btn">
            <Plus className="w-4 h-4 mr-1" />Add managed asset
          </Button>
          <Button size="icon" variant="outline" className="h-9 w-9" onClick={fetchData} data-testid="devices-refresh-btn" title="Refresh fleet data" aria-label="Refresh fleet data">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* HeroTile metric strip + Smart Inbox (shared across tabs) */}
      <DeviceCommandStrip headers={headers} API={API} />

      {/* Live activity ticker */}
      <ActivityTicker />

      {/* AI Top Risks strip */}
      <TopRisksStrip onApplyFilter={(f) => {
        if (f.key === "status") setFilterStatus(f.value);
        setTab("directory");
      }} />

      {/* Bulk Actions Bar — appears whenever rows are selected */}
      <DeviceBulkBar selectedIds={selectedDevices} onClear={() => setSelectedDevices([])} headers={headers} devices={devices} />

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center border-b border-zinc-800">
          <TabsList className="h-auto flex-1 justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0">
            {[
              { v: "pulse",     l: "Fleet Pulse", Icon: Flame },
              { v: "directory", l: "Directory",   Icon: List },
              { v: "insights",  l: "Insights",    Icon: BarChart3 },
              { v: "map",       l: "Site Map",    Icon: Cloud },
            ].map(t => (
              <TabsTrigger key={t.v} value={t.v}
                className="data-[state=active]:bg-cyan-500/[0.08] data-[state=active]:border-b-2 data-[state=active]:border-cyan-400 data-[state=active]:text-cyan-100 text-muted-foreground rounded-none py-2 px-3 text-xs uppercase tracking-wider whitespace-nowrap"
                data-testid={`devices-tab-${t.v}`}>
                <t.Icon className="w-3 h-3 mr-1" />{t.l}
              </TabsTrigger>
            ))}
          </TabsList>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1.5 px-3 text-xs text-zinc-400 hover:bg-cyan-500/[0.08] hover:text-cyan-100" data-testid="managed-assets-more">
                <MoreHorizontal className="h-3.5 w-3.5" />More<ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {MANAGED_ASSET_TOOLS.map(tool => {
                const Icon = tool.icon;
                return <DropdownMenuItem key={tool.path} onSelect={() => navigate(tool.path)}><Icon className="mr-2 h-3.5 w-3.5" />{tool.label}</DropdownMenuItem>;
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Fleet Pulse */}
        <TabsContent value="pulse" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Filter pulse wall…" value={search} onChange={e => setSearch(e.target.value)} data-testid="pulse-search" />
                </div>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="offline">Offline</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-zinc-500" data-testid="pulse-count">{pulseCount} tiles</span>
              </div>
              <FleetPulseWall filterStatus={filterStatus} search={search} onCount={setPulseCount} />
            </div>
            <div className="space-y-3">
              <OfflineWatch />
              <AnomalyInbox />
            </div>
          </div>
        </TabsContent>

        {/* Insights */}
        <TabsContent value="insights" className="mt-4 space-y-6">
          <TopTalkersPanel />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300 mb-2">Risk Heatmap (Client × Type)</p>
            <RiskHeatmapCanvas onCellClick={(c) => {
              const client = clients.find(x => x.name === c.client);
              if (client) setFilterClient(client.id);
              setFilterType(c.type);
              setTab("directory");
            }} />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300 mb-2">Lifecycle Timeline</p>
            <LifecycleTimeline />
          </div>
        </TabsContent>

        <TabsContent value="map" className="mt-4">
          <DeviceMapView sites={siteMap} />
        </TabsContent>

        <TabsContent value="directory" className="mt-4 space-y-4">

      {/* Filters */}
      <SavedViewsBar
        currentFilters={{ status: filterStatus, type: filterType, client: filterClient, search }}
        onApply={(f) => {
          if (f.status !== undefined) setFilterStatus(f.status);
          if (f.type !== undefined) setFilterType(f.type);
          if (f.client !== undefined) setFilterClient(f.client);
          if (f.search !== undefined) setSearch(f.search);
        }}
      />
      {maintenanceWindow && (
        <Card className="border-amber-500/25 bg-amber-500/[0.055]" data-testid="maintenance-window-scope">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-400/20 bg-amber-400/[0.08]">
                <CalendarClock className="h-4 w-4 text-amber-200" />
              </div>
              <div>
                <p className="text-sm font-medium">Maintenance scope: {maintenanceWindow.name || "Scheduled window"}</p>
                <p className="text-xs text-muted-foreground">{selectedDevices.length} asset{selectedDevices.length === 1 ? "" : "s"} selected · {(maintenanceWindow.actions || []).join(", ") || "No actions recorded"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => navigate("/maintenance-scheduler")}>Open schedule</Button>
              <Button size="sm" variant="ghost" className="text-zinc-400" onClick={() => {
                setSelectedDevices([]);
                const next = new URLSearchParams(searchParams);
                next.delete("maintenanceWindow");
                setSearchParams(next, { replace: true });
              }}>Clear scope</Button>
            </div>
          </CardContent>
        </Card>
      )}
      <WorkspaceControlBar data-testid="devices-directory-controls">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name/IP/OS/serial · /ticket <device> to open ticket · Cmd+K palette"
            value={search}
            onChange={e => {
              const v = e.target.value;
              setSearch(v);
              if (v.startsWith("/ticket ")) {
                const q = v.slice("/ticket ".length).trim().toLowerCase();
                const match = (devices || []).find(d => (d.name || "").toLowerCase().includes(q));
                if (match) {
                  navigate(`/tickets?device_id=${match.id}&new=1`);
                  setSearch("");
                }
              }
            }}
            data-testid="device-search"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[130px]" data-testid="status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="offline">Offline</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="server">Servers</SelectItem>
            <SelectItem value="workstation">Workstations</SelectItem>
            <SelectItem value="laptop">Laptops</SelectItem>
            <SelectItem value="network">Network</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterClient} onValueChange={setFilterClient}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {filterSource === "nexus-agent" && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs text-cyan-300 border-cyan-500/30"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("source");
              setSearchParams(next);
            }}
            data-testid="clear-device-source-filter"
          >
            <Sparkles className="w-3 h-3 mr-1" />Nexus agents only ×
          </Button>
        )}
        <div className="ml-auto flex gap-1 items-center">
          {selectedDevices.length > 0 && (
            <Button size="sm" variant="info" className="h-9 text-xs" onClick={() => setQuickScriptOpen(true)} data-testid="bulk-quick-script-btn">
              <Zap className="w-3 h-3 mr-1" />Quick Script ({selectedDevices.length})
            </Button>
          )}
          <div className="flex items-center gap-0.5 border border-zinc-800 rounded">
            <button
              title="Comfortable"
              onClick={() => setDensity("comfortable")}
              className={`px-1.5 py-1.5 ${density === "comfortable" ? "bg-cyan-500/15 text-cyan-200" : "text-zinc-500 hover:text-zinc-300"}`}
              data-testid="density-comfortable"
            ><Rows3 className="w-3.5 h-3.5" /></button>
            <button
              title="Compact"
              onClick={() => setDensity("compact")}
              className={`px-1.5 py-1.5 ${density === "compact" ? "bg-cyan-500/15 text-cyan-200" : "text-zinc-500 hover:text-zinc-300"}`}
              data-testid="density-compact"
            ><AlignJustify className="w-3.5 h-3.5" /></button>
            <button
              title="Ultra-dense"
              onClick={() => setDensity("dense")}
              className={`px-1.5 py-1.5 ${density === "dense" ? "bg-cyan-500/15 text-cyan-200" : "text-zinc-500 hover:text-zinc-300"}`}
              data-testid="density-dense"
            ><Maximize2 className="w-3.5 h-3.5" /></button>
          </div>
          <Button variant={viewMode === "table" ? "default" : "outline"} size="icon" className="h-9 w-9" onClick={() => setViewMode("table")} data-testid="view-table"><List className="w-4 h-4" /></Button>
          <Button variant={viewMode === "grid" ? "default" : "outline"} size="icon" className="h-9 w-9" onClick={() => setViewMode("grid")} data-testid="view-grid"><LayoutGrid className="w-4 h-4" /></Button>
        </div>
      </WorkspaceControlBar>

      <DevicesSmartBar
        selectedIds={selectedDevices}
        deviceNames={Object.fromEntries((devices || []).map(d => [d.id, d.name]))}
        onReload={fetchData}
      />

      {/* TABLE VIEW */}
      {viewMode === "table" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><input type="checkbox" checked={selectedDevices.length === filtered.length && filtered.length > 0} onChange={selectAll} className="rounded" /></TableHead>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>OS</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead className="text-center">CPU</TableHead>
                  <TableHead className="text-center">RAM</TableHead>
                  <TableHead className="text-center">Disk</TableHead>
                  <TableHead>Compliance</TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-12 text-muted-foreground">No devices found</TableCell></TableRow>
                ) : filtered.map(d => {
                  const viewers = deviceViewers[d.id] || [];
                  const isRemoted = viewers.length > 0;
                  const rowDensity = density === "dense" ? "h-8 text-[11px]" : density === "compact" ? "h-10 text-xs" : "";
                  return (
                    <TableRow
                      key={d.id}
                      className={`cursor-pointer transition-all hover:bg-cyan-500/[0.06] hover:shadow-[inset_2px_0_0_rgb(34,211,238)] ${rowDensity} ${isRemoted ? "bg-cyan-500/[0.03]" : ""}`}
                      onClick={() => navigate(`/devices/${d.id}`)}
                      data-testid={`device-row-${d.id}`}
                    >
                      <TableCell onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectedDevices.includes(d.id)} onChange={() => toggleSelectDevice(d.id)} className="rounded" /></TableCell>
                      <TableCell>
                        <div className="relative">
                          <DeviceThumbnail type={d.device_type} os={d.os} size={28} />
                          <div className="absolute -bottom-0.5 -right-0.5">
                            <StatusOrb status={d.status} size={9} />
                          </div>
                          {isRemoted && (
                            <div className="absolute -top-2 -right-2" title={`${viewers.length} tech${viewers.length > 1 ? "s" : ""} remoted: ${viewers.map(v => v.user_name).join(", ")}`}>
                              <div className="relative">
                                <div className="w-4 h-4 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/50 ring-2 ring-background">
                                  {viewers.length > 1 ? (
                                    <span className="text-[7px] font-black text-white">{viewers.length}</span>
                                  ) : (
                                    <Eye className="w-2 h-2 text-white" />
                                  )}
                                </div>
                                <div className="absolute inset-0 rounded-full bg-cyan-400/40 animate-ping" />
                              </div>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {d.name}
                            {d.nexus_agent_id && (
                              <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30 text-[9px] uppercase tracking-wider gap-1 px-1.5" title="NexusOps Agent installed">
                                <Sparkles className="w-2.5 h-2.5" />Agent
                              </Badge>
                            )}
                            <ElevatePill device={d} />
                            {(() => {
                              const rdLive = d.rustdesk_id ? rdStatusMap[d.rustdesk_id] : null;
                              const effectiveStatus = rdLive || d.status;
                              return (
                                <>
                                  <Badge className={STATUS_COLORS[effectiveStatus] + " border text-[9px] capitalize px-1.5"}>{effectiveStatus}</Badge>
                                  {rdLive && rdLive !== d.status && (
                                    <span className="text-[9px] px-1 rounded bg-blue-500/10 text-blue-400">RD</span>
                                  )}
                                </>
                              );
                            })()}
                            {isRemoted && (
                              <Badge className="bg-gradient-to-r from-cyan-500/15 to-blue-500/15 text-cyan-400 text-[9px] border-cyan-500/30 gap-1 shadow-[0_0_8px_rgba(34,211,238,0.2)]"
                                style={{ background: "linear-gradient(135deg, rgba(34,211,238,0.12), rgba(139,92,246,0.12), rgba(59,130,246,0.12))", backgroundSize: "200% 200%", animation: "viewerShimmer 2s ease-in-out infinite" }}
                                data-testid={`remote-viewer-badge-${d.id}`}>
                                <Eye className="w-2.5 h-2.5" />
                                <Users className="w-2.5 h-2.5" />
                                {viewers.length} {viewers.length === 1 ? "tech" : "techs"}: {viewers.map(v => v.user_name).join(", ")}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{d.manufacturer} {d.model}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{d.client_name}</TableCell>
                      <TableCell className="text-sm">{d.os} <span className="text-xs text-muted-foreground">{d.os_version || ""}</span></TableCell>
                      <TableCell className="font-mono text-xs">{d.ip_address || "-"}</TableCell>
                      <TableCell className="text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <Sparkline data={Array.from({ length: 12 }, (_, i) => Math.max(5, Math.min(98, (d.cpu_usage || 30) + ((d.id?.charCodeAt(i % (d.id?.length || 1)) || 0) % 25) - 12))) } width={32} height={14} color={(d.cpu_usage || 0) > 80 ? "#ef4444" : (d.cpu_usage || 0) > 60 ? "#fbbf24" : "#a78bfa"} />
                          <UsagePill value={d.cpu_usage || 0} />
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <Sparkline data={Array.from({ length: 12 }, (_, i) => Math.max(10, Math.min(95, (d.memory_usage || 40) + ((d.id?.charCodeAt(i % (d.id?.length || 1)) || 0) % 20) - 10))) } width={32} height={14} color={(d.memory_usage || 0) > 80 ? "#ef4444" : (d.memory_usage || 0) > 60 ? "#fbbf24" : "#34d399"} />
                          <UsagePill value={d.memory_usage || 0} />
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <Sparkline data={Array.from({ length: 12 }, (_, i) => Math.max(20, Math.min(99, (d.disk_usage || 50) + ((d.id?.charCodeAt(i % (d.id?.length || 1)) || 0) % 12) - 6))) } width={32} height={14} color={(d.disk_usage || 0) > 85 ? "#ef4444" : (d.disk_usage || 0) > 70 ? "#fbbf24" : "#22d3ee"} />
                          <UsagePill value={d.disk_usage || 0} />
                        </div>
                      </TableCell>
                      <TableCell>
                        {d.compliance_score != null ? (
                          <Badge className={`${d.compliance_score >= 90 ? "bg-emerald-500/10 text-emerald-500" : d.compliance_score >= 70 ? "bg-amber-500/10 text-amber-500" : "bg-red-500/10 text-red-500"} text-[10px]`}>
                            {d.compliance_score}%
                          </Badge>
                        ) : "-"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{d.last_seen ? formatDistanceToNow(new Date(d.last_seen), { addSuffix: true }) : "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 items-center" onClick={e => e.stopPropagation()}>
                          {d.nexus_agent_id && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200" title="Start live chat" onClick={() => startLiveChatForDevice(d)} disabled={!!liveChatBusy[d.id]} data-testid={`row-live-chat-${d.id}`}>
                            {liveChatBusy[d.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3 w-3" />}
                          </Button>}
                          <RemoteAccessButton
                            device={d}
                            status={d.rustdesk_id ? (rdStatusMap[d.rustdesk_id] || d.status) : d.status}
                            compact
                            providersOverride={activeProviders}
                            testid={`row-remote-${d.id}`}
                          />
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 hover:bg-fuchsia-500/15" title="AI Diagnose"
                            onClick={async () => {
                              try {
                                const r = await axios.post(`${API}/devices/${d.id}/ai-diagnose`, {}, { headers });
                                toast.success(`${d.name}: ${String(r.data?.severity || "").toUpperCase()} — ${(r.data?.diagnosis || "").slice(0, 90)}…`);
                              } catch (e) { toast.error(e.response?.data?.detail || "Diagnose failed"); }
                            }}
                            data-testid={`row-diagnose-${d.id}`}>
                            <Sparkles className="w-3 h-3 text-fuchsia-400" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(d)}><Edit className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => setDeleteTarget(d)} aria-label={`Delete ${d.name}`}><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* GRID VIEW */}
      {viewMode === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.length === 0 ? (
            <div className="col-span-3 text-center py-12 text-muted-foreground">No devices found</div>
          ) : filtered.map(d => {
            const DevIcon = DEVICE_ICONS[d.device_type] || Monitor;
            const viewers = deviceViewers[d.id] || [];
            const isRemoted = viewers.length > 0;
            return (
              <Card key={d.id} className={`cursor-pointer hover:border-primary/30 transition-colors group ${isRemoted ? "border-cyan-500/30 bg-cyan-500/[0.02]" : ""}`} onClick={() => navigate(`/devices/${d.id}`)} data-testid={`device-card-${d.id}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`relative w-10 h-10 rounded-lg flex items-center justify-center ${STATUS_COLORS[d.rustdesk_id && rdStatusMap[d.rustdesk_id] ? rdStatusMap[d.rustdesk_id] : d.status]}`}>
                        <DevIcon className="w-5 h-5" />
                        {isRemoted && (
                          <div className="absolute -top-2 -right-2">
                            <div className="relative">
                              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/50 ring-2 ring-background">
                                {viewers.length > 1 ? <span className="text-[8px] font-black text-white">{viewers.length}</span> : <Eye className="w-2.5 h-2.5 text-white" />}
                              </div>
                              <div className="absolute inset-0 rounded-full bg-cyan-400/40 animate-ping" />
                            </div>
                          </div>
                        )}
                      </div>
                      <div>
                        <h3 className="font-semibold group-hover:text-primary transition-colors">{d.name}</h3>
                        <p className="text-xs text-muted-foreground">{d.client_name}</p>
                      </div>
                    </div>
                    <Badge className={STATUS_COLORS[d.rustdesk_id && rdStatusMap[d.rustdesk_id] ? rdStatusMap[d.rustdesk_id] : d.status] + " border text-[9px] capitalize"}>
                      {d.rustdesk_id && rdStatusMap[d.rustdesk_id] ? rdStatusMap[d.rustdesk_id] : d.status}
                    </Badge>
                  </div>
                  {isRemoted && (
                    <div className="mb-3 px-2 py-1.5 rounded-md border border-cyan-500/20"
                      style={{ background: "linear-gradient(135deg, rgba(34,211,238,0.08), rgba(139,92,246,0.08))", backgroundSize: "200% 200%", animation: "viewerShimmer 2s ease-in-out infinite" }}>
                      <div className="flex items-center gap-1.5 text-[10px] text-cyan-400">
                        <Eye className="w-3 h-3" />
                        <span className="font-medium">{viewers.length} tech{viewers.length > 1 ? "s" : ""} remoted in: {viewers.map(v => v.user_name).join(", ")}</span>
                      </div>
                    </div>
                  )}
                  {d.nexus_elevate_state && <div className="mb-3 flex flex-wrap gap-1.5"><ElevatePill device={d} /></div>}
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground mb-3">
                    <div><span className="block text-[10px]">OS</span><span className="text-foreground">{d.os}</span></div>
                    <div><span className="block text-[10px]">IP</span><span className="font-mono text-foreground">{d.ip_address || "-"}</span></div>
                    <div><span className="block text-[10px]">Model</span><span className="text-foreground truncate">{d.model || d.manufacturer || "-"}</span></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between"><span className="text-[10px] text-muted-foreground">CPU</span><UsagePill value={d.cpu_usage || 0} /></div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${d.cpu_usage >= 90 ? "bg-red-500" : d.cpu_usage >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${d.cpu_usage || 0}%` }} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between"><span className="text-[10px] text-muted-foreground">RAM</span><UsagePill value={d.memory_usage || 0} /></div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${d.memory_usage >= 90 ? "bg-red-500" : d.memory_usage >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${d.memory_usage || 0}%` }} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between"><span className="text-[10px] text-muted-foreground">Disk</span><UsagePill value={d.disk_usage || 0} /></div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${d.disk_usage >= 90 ? "bg-red-500" : d.disk_usage >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${d.disk_usage || 0}%` }} />
                      </div>
                    </div>
                  </div>
                  {(d.tags || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {d.tags.slice(0, 3).map((t, i) => <Badge key={`k-${i}`} variant="secondary" className="text-[9px] px-1.5 py-0">{t}</Badge>)}
                      {d.tags.length > 3 && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">+{d.tags.length - 3}</Badge>}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-3 pt-2 border-t text-[10px] text-muted-foreground">
                    <span>Last seen: {d.last_seen ? formatDistanceToNow(new Date(d.last_seen), { addSuffix: true }) : "N/A"}</span>
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      {d.nexus_agent_id && <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200" onClick={() => startLiveChatForDevice(d)} disabled={!!liveChatBusy[d.id]} data-testid={`card-live-chat-${d.id}`}>
                        {liveChatBusy[d.id] ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <MessageSquare className="mr-1 h-3 w-3" />} Chat
                      </Button>}
                      <RemoteAccessButton
                        device={d}
                        status={d.rustdesk_id ? (rdStatusMap[d.rustdesk_id] || d.status) : d.status}
                        compact
                        providersOverride={activeProviders}
                        testid={`card-remote-${d.id}`}
                      />
                      <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

        </TabsContent>
      </Tabs>

      {formDialog}

      {/* DEVICE DISCOVERY DIALOG */}
      <Dialog open={isDiscoveryOpen} onOpenChange={setIsDiscoveryOpen}>
        <NexusWorkflowDialog eyebrow="Asset onboarding" title="Network discovery" description="Scan an approved private client subnet through an active Nexus Edge Discovery probe, review findings, and import only the endpoints you intend to manage. Nexus will not invent production discovery results." icon={Radar} tone="cyan" className="max-w-3xl" contentClassName="space-y-4" data-testid="network-discovery-workflow" footer={<Button variant="outline" onClick={() => setIsDiscoveryOpen(false)}>Close discovery</Button>}>
          <div className="grid gap-3 md:grid-cols-[1fr_190px_auto] md:items-end">
            <div className="flex-1">
              <Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Client</Label>
              <Select value={discoveryClientId} onValueChange={setDiscoveryClientId}>
                <SelectTrigger data-testid="discovery-client-select"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Approved subnet</Label>
              <Input value={discoverySubnet} onChange={e => setDiscoverySubnet(e.target.value)} placeholder="192.168.1.0/24" data-testid="discovery-subnet" />
            </div>
            <Button variant="success" className="h-10" onClick={handleDiscoverDevices} disabled={discoveryLoading || !discoveryClientId} data-testid="run-discovery-btn">
              {discoveryLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Radar className="w-4 h-4 mr-1" />}
              Scan Network
            </Button>
          </div>

          {discoveryResults && (
            <div className="space-y-3 border-t border-white/[0.07] pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-cyan-400/25 bg-cyan-400/[0.07] text-cyan-200">{discoveryResults.discovered_count} devices found</Badge>
                  <span className="text-xs text-muted-foreground">on {discoveryResults.subnet}</span>
                </div>
                {selectedDiscovered.length > 0 && (
                  <Button size="sm" variant="success" onClick={handleImportDiscovered} disabled={importLoading} data-testid="import-discovered-btn">
                    {importLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
                    Import {selectedDiscovered.length} Device{selectedDiscovered.length > 1 ? "s" : ""}
                  </Button>
                )}
              </div>
              <div className="max-h-[400px] overflow-y-auto space-y-1.5">
                {discoveryResults.devices.map(dev => (
                  <div key={dev.id} className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                    dev.already_imported ? "bg-muted/20 opacity-60" : selectedDiscovered.includes(dev.id) ? "border-cyan-400/35 bg-cyan-400/[0.07]" : "border-white/[0.07] bg-black/10 hover:border-cyan-400/20 hover:bg-cyan-400/[0.035]"
                  }`} data-testid={`discovered-device-${dev.id}`}>
                    {!dev.already_imported ? (
                      <input type="checkbox" checked={selectedDiscovered.includes(dev.id)} onChange={() => toggleDiscoveredSelect(dev.id)} className="rounded" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    )}
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${dev.status === "online" ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                      <Monitor className={`w-4 h-4 ${dev.status === "online" ? "text-emerald-500" : "text-red-500"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{dev.hostname}</span>
                        <Badge variant="outline" className="text-[9px] capitalize">{dev.device_type}</Badge>
                        {dev.already_imported && <Badge className="bg-emerald-500/20 text-emerald-400 text-[9px]">Already imported</Badge>}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="font-mono">{dev.ip_address}</span>
                        <span>{dev.manufacturer}</span>
                        <span>{dev.os}</span>
                        <span className="font-mono">{dev.mac_address}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <Badge className={`text-[9px] ${dev.status === "online" ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>{dev.status}</Badge>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{dev.response_time_ms}ms</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <NexusWorkflowDialog
          eyebrow="Managed asset lifecycle"
          title="Delete managed asset?"
          description={`Remove ${deleteTarget?.name || "this asset"} from the Nexus asset register. This cannot be undone.`}
          icon={Trash2}
          tone="amber"
          className="max-w-lg"
          data-testid="delete-device-workflow"
          footer={<><Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>Keep asset</Button><Button variant="destructive" onClick={handleDelete} disabled={deleteBusy}>{deleteBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}Delete asset</Button></>}
        >
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-sm text-muted-foreground">Delete only when this record is erroneous or no longer belongs in the managed estate. Archive or update the asset when historic operational context should remain visible.</div>
        </NexusWorkflowDialog>
      </Dialog>

      {/* Quick Script bulk dialog */}
      <QuickScriptDialog open={quickScriptOpen} onClose={() => setQuickScriptOpen(false)} deviceIds={selectedDevices} />

      {/* Cmd+K command palette */}
      </div>
    </PageShell>
  );
}

function ElevatePill({ device }) {
  const meta = ELEVATE_STATE_META[device.nexus_elevate_state];
  if (!meta) return null;
  return <Badge className={`${meta.className} border text-[9px] uppercase tracking-wider gap-1 px-1.5`} title={device.nexus_elevate_last_error || "Nexus Elevate status is verified by the enrolled Nexus Agent"}>
    <Shield className="h-2.5 w-2.5" />{meta.label}
  </Badge>;
}

