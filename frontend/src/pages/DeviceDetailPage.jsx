import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { format, formatDistanceToNow } from "date-fns";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import { Server, Monitor, Laptop, Wifi, Shield, ShieldCheck, HardDrive, Cpu, MemoryStick, Activity, Clock, RefreshCw, Terminal, Download, AlertTriangle, CheckCircle, XCircle, Info, ChevronRight, Globe, Network, Lock, Eye, Package, Wrench, Tag, MapPin, User, Calendar, ExternalLink, Ticket, Plus, Pencil, Building2, Search, MessageSquare, Archive, GitMerge, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent } from "../components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Separator } from "../components/ui/separator";
import { Progress } from "../components/ui/progress";
import { Dialog } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import RemoteAccessButton from "../components/devices/RemoteAccessButton";
import WatchDeviceButton from "../components/devices/WatchDeviceButton";
import DeviceBackupPlansPanel from "../components/devices/DeviceBackupPlansPanel";
import DeviceDossier from "../components/devices/DeviceDossier";
import DeviceTimeMachine from "../components/devices/DeviceTimeMachine";
import AssetStoryPanel from "../components/devices/AssetStoryPanel";
import MaintenanceWindowDialog from "../components/devices/MaintenanceWindowDialog";
import ChangeGuardianDialog from "../components/devices/ChangeGuardianDialog";
import StatusOrb from "../components/devices/StatusOrb";
import NexusPageSkeleton from "../components/feedback/NexusPageSkeleton";
import HeroTile from "../components/HeroTile";
import { WorkspaceErrorState } from "@/components/WorkspaceState";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { toast } from "sonner";
import { canStartWorkSession, workSessionPath } from "@/lib/workSessionNavigation";

import { API, useAuth } from "../App";

const DEVICE_ICONS = { server: Server, workstation: Monitor, laptop: Laptop, network: Wifi, mobile: Laptop };
const SEVERITY_COLORS = { critical: "bg-red-500/10 text-red-500", high: "bg-orange-500/10 text-orange-500", important: "bg-amber-500/10 text-amber-500", warning: "bg-amber-500/10 text-amber-500", info: "bg-blue-500/10 text-blue-500", error: "bg-red-500/10 text-red-500" };
const PATCH_STATUS = { installed: "bg-emerald-500/10 text-emerald-500", pending: "bg-amber-500/10 text-amber-500", failed: "bg-red-500/10 text-red-500" };
const EVENT_ICONS = { agent_check_in: Activity, login: User, logout: User, software_installed: Package, patch_applied: Download, alert_triggered: AlertTriangle, reboot: RefreshCw, service_restart: Wrench, backup_completed: HardDrive, script_executed: Terminal };
const displayLinkSpeed = (speed) => !speed ? "—" : speed >= 1000 ? `${speed / 1000} Gbps` : `${speed} Mbps`;
const cleanDeviceText = (value) => String(value || "")
  .replace(/[\u00c3\u201a\u00c2]+\u00b7/g, "\u00b7")
  .replace(/[\u00c3\u201a\u00c2]+\u00b0/g, "\u00b0")
  .replace(/\u00e2\u20ac\u201d/g, "\u2014")
  .replace(/\u00e2\u2020\u2019/g, "\u2192")
  .replace(/\u00c2/g, "");

export default function DeviceDetailPage() {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [diskHealth, setDiskHealth] = useState([]);
  const [patchWindowOpen, setPatchWindowOpen] = useState(false);
  const [safetyCheckOpen, setSafetyCheckOpen] = useState(false);
  const [deviceEditorOpen, setDeviceEditorOpen] = useState(false);
  const [deviceEditorBusy, setDeviceEditorBusy] = useState(false);
  const [clientOptions, setClientOptions] = useState([]);
  const [deviceEditor, setDeviceEditor] = useState({ name: "", client_id: "", assigned_user: "", location: "" });
  const [softwareSearch, setSoftwareSearch] = useState("");
  const [cockpitSearch, setCockpitSearch] = useState("");
  const [lifecycleDialog, setLifecycleDialog] = useState(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [mergeCandidates, setMergeCandidates] = useState([]);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergePreview, setMergePreview] = useState(null);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeConfirmation, setMergeConfirmation] = useState("");

  const openLiveSupport = async () => {
    try {
      const response = await axios.post(`${API}/live-chat/devices/${deviceId}/open`, {}, { headers: { Authorization: `Bearer ${token}` } });
      const sessionId = response.data?.session?.id;
      if (!sessionId) throw new Error("No support session returned");
      toast.success("Live support session opened");
      navigate(`/live-chat?session=${encodeURIComponent(sessionId)}`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Live support could not be opened for this asset");
    }
  };

  const fetchDetail = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await axios.get(`${API}/devices/${deviceId}/detail`, { headers: { Authorization: `Bearer ${token}` } });
      setData(res.data);
      // Fetch disk health
      try {
        const disksRes = await axios.get(`${API}/devices/${deviceId}/disks`, { headers: { Authorization: `Bearer ${token}` } });
        setDiskHealth(disksRes.data);
      } catch {}
    } catch (e) {
      console.error(e);
      setLoadError(e.response?.status === 404
        ? "This asset is no longer available in your permitted managed estate. It may have been retired, removed, or moved outside your current scope."
        : "Nexus could not retrieve this managed asset. No device records have been changed.");
    } finally {
      setLoading(false);
    }
  }, [deviceId, token]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const openDeviceEditor = async () => {
    if (!data?.device) return;
    setDeviceEditor({
      name: data.device.name || "",
      client_id: data.device.client_id || "",
      assigned_user: data.device.assigned_user || "",
      location: data.device.location || "",
    });
    setDeviceEditorOpen(true);
    try {
      const res = await axios.get(`${API}/clients`, { headers: { Authorization: `Bearer ${token}` } });
      setClientOptions(Array.isArray(res.data) ? res.data : []);
    } catch { setClientOptions([]); }
  };

  const saveDeviceIdentity = async () => {
    if (!deviceEditor.name.trim()) { toast.error("Device name is required"); return; }
    setDeviceEditorBusy(true);
    try {
      await axios.put(`${API}/devices/${deviceId}`, {
        name: deviceEditor.name.trim(),
        client_id: deviceEditor.client_id || null,
        assigned_user: deviceEditor.assigned_user.trim() || null,
        location: deviceEditor.location.trim() || null,
      }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success("Device identity updated");
      setDeviceEditorOpen(false);
      fetchDetail();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not update device"); }
    finally { setDeviceEditorBusy(false); }
  };

  const closeLifecycleDialog = (force = false) => {
    if (lifecycleBusy && !force) return;
    setLifecycleDialog(null);
    setLifecycleReason("");
    setMergeTargetId("");
    setMergePreview(null);
    setMergeConfirmation("");
  };

  const openLifecycleDialog = async (mode) => {
    setLifecycleDialog(mode);
    setLifecycleReason("");
    setMergeTargetId("");
    setMergePreview(null);
    setMergeConfirmation("");
    if (mode !== "merge") return;
    setMergeLoading(true);
    try {
      const response = await axios.get(`${API}/devices/${deviceId}/merge-candidates`, { headers: { Authorization: `Bearer ${token}` } });
      setMergeCandidates(Array.isArray(response.data?.candidates) ? response.data.candidates : []);
    } catch (error) {
      setMergeCandidates([]);
      toast.error(error.response?.data?.detail || "Nexus could not load merge candidates");
    } finally {
      setMergeLoading(false);
    }
  };

  const selectMergeTarget = async (survivorId) => {
    setMergeTargetId(survivorId);
    setMergePreview(null);
    if (!survivorId) return;
    setMergeLoading(true);
    try {
      const response = await axios.get(`${API}/devices/${deviceId}/merge-preview`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { survivor_id: survivorId },
      });
      setMergePreview(response.data || null);
    } catch (error) {
      setMergeTargetId("");
      toast.error(error.response?.data?.detail || "Nexus could not prepare a safe merge preview");
    } finally {
      setMergeLoading(false);
    }
  };

  const archiveManagedAsset = async () => {
    if (lifecycleReason.trim().length < 3) {
      toast.error("Add a short archive reason for the next technician");
      return;
    }
    setLifecycleBusy(true);
    try {
      await axios.post(`${API}/devices/${deviceId}/archive`, { reason: lifecycleReason.trim() }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success("Managed asset archived with its evidence retained");
      closeLifecycleDialog(true);
      fetchDetail();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus could not archive this managed asset");
    } finally {
      setLifecycleBusy(false);
    }
  };

  const restoreManagedAsset = async () => {
    setLifecycleBusy(true);
    try {
      await axios.post(`${API}/devices/${deviceId}/restore`, {}, { headers: { Authorization: `Bearer ${token}` } });
      toast.success("Managed asset restored. Nexus will wait for a trusted check-in before marking it online.");
      fetchDetail();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus could not restore this managed asset");
    } finally {
      setLifecycleBusy(false);
    }
  };

  const mergeManagedAsset = async () => {
    const sourceName = data?.device?.name || "";
    if (!mergeTargetId || !mergePreview) {
      toast.error("Select a surviving asset and review its merge impact first");
      return;
    }
    if (lifecycleReason.trim().length < 3) {
      toast.error("Record why these assets are duplicates");
      return;
    }
    if (mergeConfirmation.trim() !== sourceName) {
      toast.error(`Type ${sourceName} to confirm the duplicate record`);
      return;
    }
    setLifecycleBusy(true);
    try {
      const response = await axios.post(`${API}/devices/${deviceId}/merge`, {
        survivor_id: mergeTargetId,
        reason: lifecycleReason.trim(),
      }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(response.data?.already_merged ? "This duplicate was already consolidated" : "Duplicate asset merged with history retained");
      closeLifecycleDialog(true);
      navigate(`/devices/${encodeURIComponent(response.data?.survivor_id || mergeTargetId)}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus could not merge these managed assets");
    } finally {
      setLifecycleBusy(false);
    }
  };

  const purgeManagedAsset = async () => {
    setLifecycleBusy(true);
    try {
      await axios.delete(`${API}/devices/${deviceId}`, { headers: { Authorization: `Bearer ${token}` }, data: { reason: lifecycleReason.trim() } });
      toast.success("Empty manual asset record permanently deleted");
      closeLifecycleDialog(true);
      navigate("/devices");
    } catch (error) {
      toast.error(error.response?.data?.detail || "This asset cannot be permanently deleted");
    } finally {
      setLifecycleBusy(false);
    }
  };

  if (loading) return <NexusPageSkeleton label="Loading managed asset" />;
  if (!data && loadError) return <WorkspaceErrorState title="Managed asset is unavailable" description={loadError} onSecondaryAction={() => navigate("/devices")} secondaryLabel="Back to managed assets" onRetry={fetchDetail} retryLabel="Retry asset load" />;
  if (!data) return <div className="text-center py-20 text-muted-foreground">Device not found</div>;

  const dev = data.device;
  const isArchived = Boolean(dev.archived) || dev.status === "archived";
  const effectiveStatus = isArchived ? "archived" : dev.status;
  const observedAt = dev.last_heartbeat || dev.last_seen || dev.telemetry_at || dev.observed_at;
  const observedDate = observedAt ? new Date(observedAt) : null;
  const telemetryState = !observedDate || Number.isNaN(observedDate.getTime())
    ? "not_collected"
    : Date.now() - observedDate.getTime() <= 15 * 60 * 1000 ? "observed" : "stale";
  const displayStatus = isArchived ? "archived" : telemetryState === "stale" ? "stale" : effectiveStatus;
  const statusOrb = displayStatus === "stale" ? "warning" : displayStatus;
  const DevIcon = DEVICE_ICONS[dev.device_type] || Monitor;
  const perfData = (data.performance || []).slice().reverse().filter((_, i) => i % 6 === 0).map(p => ({
    time: p.timestamp ? format(new Date(p.timestamp), "HH:mm") : "",
    cpu: p.cpu, memory: p.memory, disk: p.disk,
    net_in: p.network_in, net_out: p.network_out
  }));
  const performanceSamples = data.performance || [];
  const performanceValues = (...keys) => performanceSamples.map(sample => keys.map(key => sample[key]).find(value => typeof value === "number")).filter(value => typeof value === "number");
  const peakValue = (...keys) => Math.round(Math.max(0, ...performanceValues(...keys)));
  const latestValue = (...keys) => {
    const latest = performanceSamples[0] || {};
    return Math.round(keys.map(key => latest[key]).find(value => typeof value === "number") || 0);
  };

  const complianceAssessed = Boolean(dev.security_assessed_at);
  const complianceColor = !complianceAssessed ? "text-muted-foreground" : (dev.compliance_score || 0) >= 90 ? "text-emerald-500" : (dev.compliance_score || 0) >= 70 ? "text-amber-500" : "text-red-500";
  const cpuUsage = Math.round(dev.cpu_usage || 0);
  const memoryUsage = Math.round(dev.memory_usage || 0);
  const diskUsage = Math.round(dev.disk_usage || 0);
  const deviceSignal = isArchived
    ? "calm"
    : effectiveStatus === "offline"
    ? "critical"
    : telemetryState !== "observed"
      ? "attention"
    : (dev.alerts_count || 0) > 0 || cpuUsage >= 90 || memoryUsage >= 90 || diskUsage >= 90
      ? "attention"
      : effectiveStatus === "online"
        ? "healthy"
        : "recommendation";
  const usageGlow = (value) => value >= 90 ? "rose" : value >= 70 ? "amber" : "emerald";
  const adapters = data.network_adapters || [];
  const activeAdapter = adapters.find(adapter => adapter.status === "up") || adapters.find(adapter => adapter.ip_address) || null;
  const software = data.software || [];
  const activeWorkTickets = (data.tickets || []).filter(canStartWorkSession);
  const softwareQuery = softwareSearch.trim().toLowerCase();
  const filteredSoftware = software.filter(item => !softwareQuery || [item.name, item.publisher, item.version, item.category].some(value => String(value || "").toLowerCase().includes(softwareQuery)));
  const softwareInventoryAt = software.reduce((latest, item) => item.last_inventory_at && (!latest || item.last_inventory_at > latest) ? item.last_inventory_at : latest, null);
  const pendingPatchRecords = (data.patches || []).filter((patchItem) => {
    const status = String(patchItem.status || "").trim().toLowerCase();
    return !["installed", "applied", "complete", "completed", "superseded"].includes(status);
  });
  const cockpitQuery = cockpitSearch.trim().toLowerCase();
  const cockpitMatches = (values) => !cockpitQuery || values.some(value => String(value || "").toLowerCase().includes(cockpitQuery));
  const cockpitAlerts = (data.alerts || []).filter(item => cockpitMatches([item.severity, item.alert_type, item.message, item.source]));
  const cockpitPatches = pendingPatchRecords.filter(item => cockpitMatches([item.kb_number, item.kb_id, item.kb_article, item.title, item.description, item.category, item.status]));
  const cockpitTickets = (data.tickets || []).filter(item => cockpitMatches([item.ticket_number, item.title, item.status, item.priority, item.assigned_to]));
  const deviceSections = [
    {
      id: "overview",
      label: "Overview",
      description: "Health and next steps",
      icon: Monitor,
      defaultTab: "overview",
      tabs: [
        { value: "overview", label: "Current work" },
        { value: "events", label: "Service history" },
        { value: "device-details", label: "Device details" },
        { value: "asset-story", label: "Related items" },
      ],
    },
    {
      id: "operations",
      label: "Operations",
      description: "Tickets and sessions",
      icon: Activity,
      defaultTab: "tickets",
      tabs: [
        { value: "tickets", label: `Tickets (${data.tickets?.length || 0})` },
        { value: "remote-sessions", label: `Sessions (${data.remote_sessions?.length || 0})` },
        { value: "performance", label: "Performance" },
        { value: "backups", label: "Backups" },
      ],
    },
    {
      id: "inventory",
      label: "Inventory",
      description: "Software and patches",
      icon: Package,
      defaultTab: "software",
      tabs: [
        { value: "software", label: `Software (${data.software?.length || 0})` },
        { value: "patches", label: `Patches (${data.patches?.length || 0})` },
        { value: "network", label: "Network" },
      ],
    },
    {
      id: "security",
      label: "Security",
      description: "Protection posture",
      icon: Shield,
      defaultTab: "security",
      tabs: [{ value: "security", label: "Security posture" }],
    },
    {
      id: "history",
      label: "History",
      description: "Audit evidence",
      icon: Clock,
      defaultTab: "events",
      tabs: [
        { value: "audit-log", label: "Audit log" },
        { value: "time-machine", label: "Time machine" },
      ],
    },
  ];
  const activeDeviceSection = deviceSections.find(section => section.tabs.some(tab => tab.value === activeTab)) || deviceSections[0];
  const lastObservedLabel = observedDate && !Number.isNaN(observedDate.getTime())
    ? formatDistanceToNow(observedDate, { addSuffix: true })
    : "No endpoint evidence";
  const telemetryItems = [
    { label: "CPU", value: `${cpuUsage}%`, icon: Cpu, percent: cpuUsage, tone: usageGlow(cpuUsage), chartKey: "cpu", chartColor: "#16d78b" },
    { label: "Memory", value: `${memoryUsage}%`, icon: MemoryStick, percent: memoryUsage, tone: memoryUsage >= 90 ? "rose" : "yellow", chartKey: "memory", chartColor: "#f4d13d" },
    { label: "Disk", value: `${diskUsage}%`, icon: HardDrive, percent: diskUsage, tone: usageGlow(diskUsage), chartKey: "disk", chartColor: "#f0a33a" },
    { label: "Uptime", value: dev.uptime_hours != null ? `${Math.floor(dev.uptime_hours / 24)}d ${Math.round(dev.uptime_hours % 24)}h` : "—", icon: Clock, tone: "cyan" },
    { label: "Alert", value: dev.alerts_count || data.alerts?.length || 0, icon: AlertTriangle, tone: (dev.alerts_count || data.alerts?.length || 0) > 0 ? "rose" : "emerald", tab: "events" },
    { label: "Patches", value: dev.pending_patches || pendingPatchRecords.length, icon: Download, tone: "cyan", tab: "patches", testId: "patches" },
    { label: "Tickets", value: data.tickets?.length || 0, icon: Ticket, tone: "cyan", tab: "tickets" },
    { label: "Session", value: data.remote_sessions?.length || 0, icon: Monitor, tone: "cyan", tab: "remote-sessions" },
    { label: "Software", value: software.length, icon: Package, tone: "cyan", tab: "software" },
    { label: "Patches available", value: data.patches?.length || 0, icon: ShieldCheck, tone: "emerald", tab: "patches", testId: "patches-available" },
  ];

  return (
    <div className="nx-page-stage nx-device-cockpit space-y-4" data-testid="device-detail-page">
      <nav className="nx-device-breadcrumb" aria-label="Device breadcrumb">
        <button type="button" onClick={() => navigate("/clients")}>Clients</button><ChevronRight />
        <button type="button" onClick={() => navigate(dev.client_id ? `/clients?client=${encodeURIComponent(dev.client_id)}` : "/clients")}>{dev.client_name || "Unassigned client"}</button><ChevronRight />
        <button type="button" onClick={() => navigate("/devices")}>Devices</button><ChevronRight />
        <strong>{dev.name}</strong>
        <div className="nx-device-breadcrumb__tools">
          <label className="nx-device-record-search"><Search /><span className="sr-only">Search this device</span><input value={cockpitSearch} onChange={(event) => setCockpitSearch(event.target.value)} placeholder="Search this device…" data-testid="device-record-search" /></label>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Device options"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={openDeviceEditor}><Pencil className="mr-2 h-4 w-4" />Edit identity</DropdownMenuItem><DropdownMenuItem onSelect={() => setActiveTab("audit-log")}><Clock className="mr-2 h-4 w-4" />View audit log</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </div>
      </nav>

      <section className="nx-device-cockpit-header" data-nx-signal={deviceSignal}>
        <div className="nx-device-cockpit-header__layout">
          <div className="nx-device-cockpit-header__identity">
            <div className="nx-device-cockpit-header__mark">
              <DevIcon className="h-10 w-10" strokeWidth={1.45} aria-hidden="true" />
              <span title={`Device ${displayStatus}`}><StatusOrb status={statusOrb} size={9} /></span>
            </div>
            <div className="min-w-0">
              <div className="nx-device-cockpit-header__eyebrow">Device cockpit</div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-3xl font-bold tracking-[-0.045em]" data-testid="device-name">{dev.name}</h1>
                <Badge variant="outline" className={`capitalize ${displayStatus === "online" ? "border-emerald-500/30 text-emerald-400" : displayStatus === "stale" ? "border-amber-500/30 text-amber-400" : "border-zinc-500/30 text-zinc-400"}`} data-testid="device-status"><StatusOrb status={statusOrb} size={7} /><span className="ml-1.5">{displayStatus}</span></Badge>
                {isArchived && <Badge variant="outline" className="border-zinc-500/25 bg-zinc-500/[0.08] text-zinc-400">Retained history</Badge>}
              </div>
              <div className="nx-device-cockpit-header__facts">
                <span><Monitor />{dev.os} {dev.os_version || ""}</span>
                <span data-sensitive="ip-address"><Globe />{dev.ip_address || "No IP reported"}</span>
                <span><MapPin />{dev.location || "No location"}</span>
                <span><Building2 />{dev.client_name || "Unassigned client"}</span>
                <span><User />{dev.assigned_user || "Unassigned user"}</span>
              </div>
            </div>
          </div>
          <div className={`nx-device-action-bar ${isArchived ? "is-archived" : ""}`}>
            <span className="nx-device-action-summary__icon">{isArchived ? <Archive /> : telemetryState === "observed" ? <ShieldCheck /> : <AlertTriangle />}</span>
            <div className="nx-device-action-summary">
              <p>{isArchived ? "This device is archived" : telemetryState === "observed" ? "Endpoint evidence is current" : "Snapshot requires verification"}</p>
              <span>{isArchived ? "Archived records are removed from active fleet views; their evidence remains intact." : telemetryState === "observed" ? `Last trusted observation ${lastObservedLabel}.` : `The latest endpoint snapshot is ${telemetryState === "stale" ? "stale" : "not available"}. Verify before high-impact work.`}</span>
            </div>
            {isArchived ? (dev.merged_into_id ? <Button className="nx-device-primary-action" onClick={() => navigate(`/devices/${encodeURIComponent(dev.merged_into_id)}`)} data-testid="open-device-merge-survivor"><GitMerge />Open surviving asset</Button> : <Button className="nx-device-primary-action" onClick={restoreManagedAsset} disabled={lifecycleBusy} data-testid="restore-device"><RotateCcw />Restore device</Button>) : <Button className="nx-device-primary-action" onClick={fetchDetail} data-testid="verify-device-evidence"><RefreshCw />Refresh evidence</Button>}
            <button type="button" className="nx-device-action-bar__link" onClick={() => setActiveTab(isArchived ? "audit-log" : "device-details")}>{isArchived ? "View archive details" : "View evidence details"}<ChevronRight /></button>
          </div>
        </div>
      </section>

      <section className="nx-device-telemetry" data-testid="device-hero-tiles">
        <div className="nx-device-telemetry__head">
          <div className="nx-device-telemetry__title"><Activity /><strong>{telemetryState === "observed" ? "Live device telemetry" : "Last reported telemetry"}</strong><span>Last reported snapshot ({telemetryState === "observed" ? "current" : telemetryState === "stale" ? "stale" : "not collected"})</span></div>
          <div className="nx-device-telemetry__status"><span className={`is-${telemetryState}`}><AlertTriangle />{telemetryState === "observed" ? "Snapshot is current" : telemetryState === "stale" ? "Snapshot is stale" : "No snapshot collected"}</span><small>Last seen: {lastObservedLabel}</small><Info /><Button variant="outline" size="sm" onClick={fetchDetail} data-testid="refresh-device-detail"><RefreshCw />Refresh</Button></div>
        </div>
        <div className="nx-device-telemetry__grid">
          {telemetryItems.map(item => {
            const MetricIcon = item.icon;
            const MetricElement = item.tab ? "button" : "div";
            return <MetricElement key={item.label} type={item.tab ? "button" : undefined} className={`nx-device-telemetry__metric ${item.tab ? "is-link" : ""}`} data-tone={item.tone} onClick={item.tab ? () => setActiveTab(item.tab) : undefined} data-testid={`device-stat-${item.testId || item.label.toLowerCase().replace(/\s/g, "-")}`}>
              <div className="nx-device-telemetry__metric-label"><span><MetricIcon /></span>{item.label}</div>
              <p>{item.value}</p>
              {typeof item.percent === "number" && <><div className="nx-device-telemetry__track"><span style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }} /></div>{perfData.length > 1 && <div className="nx-device-telemetry__spark"><ResponsiveContainer width="100%" height="100%"><AreaChart data={perfData}><Area type="monotone" dataKey={item.chartKey} stroke={item.chartColor} fill={item.chartColor} fillOpacity={0.04} strokeWidth={1.2} dot={false} isAnimationActive /></AreaChart></ResponsiveContainer></div>}</>}
            </MetricElement>;
          })}
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="nx-device-record-body">
        <div className="nx-device-workspace-layout">
          <aside className="nx-device-quick-actions" aria-label="Device quick actions">
            <div className="nx-device-quick-actions__heading">
              <Activity className="h-5 w-5 text-cyan-400" />
              <div><p>Quick actions</p><span>Common tasks for this device</span></div>
            </div>
            {isArchived ? <Button className="nx-device-quick-actions__primary justify-start" onClick={restoreManagedAsset} disabled={lifecycleBusy}><RotateCcw className="mr-2 h-4 w-4" />Restore device</Button> : activeWorkTickets.length === 1 ? <Button className="nx-device-quick-actions__primary justify-start" onClick={() => navigate(workSessionPath(activeWorkTickets[0]))}><Wrench className="mr-2 h-4 w-4" />Start work</Button> : <Button className="nx-device-quick-actions__primary justify-start" onClick={() => navigate(`/tickets?clientId=${encodeURIComponent(dev.client_id || "")}&device_id=${encodeURIComponent(dev.id)}&new=1`)}><Plus className="mr-2 h-4 w-4" />Create ticket</Button>}
            <div className="nx-device-quick-actions__remote"><RemoteAccessButton device={dev} status={effectiveStatus} testid="remote-access-btn" /></div>
            {!isArchived && dev.nexus_agent_id && <Button variant="outline" className="justify-start" onClick={() => navigate(`/device-terminal?deviceId=${encodeURIComponent(dev.id)}`)}><Terminal className="mr-2 h-4 w-4" />Terminal & files</Button>}
            {activeTab !== "tickets" && <Button variant="outline" className="justify-start" onClick={() => navigate(`/tickets?clientId=${encodeURIComponent(dev.client_id || "")}&device_id=${encodeURIComponent(dev.id)}&new=1`)}><Ticket className="mr-2 h-4 w-4" />Create linked ticket</Button>}
            <Button variant="outline" className="justify-start" onClick={() => setSafetyCheckOpen(true)}><ShieldCheck className="mr-2 h-4 w-4" />Safe-to-touch check</Button>
            <Button variant="outline" className="justify-start" onClick={() => setActiveTab("patches")}><Download className="mr-2 h-4 w-4" />Check patches</Button>
            <Button variant="outline" className="justify-start" onClick={() => setActiveTab("backups")}><HardDrive className="mr-2 h-4 w-4" />View backups</Button>
            <Button variant="outline" className="justify-start" onClick={openDeviceEditor}><Pencil className="mr-2 h-4 w-4" />Edit identity</Button>
            <WatchDeviceButton deviceId={dev.id} token={token} deviceName={dev.name} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" className="justify-between" data-testid="device-lifecycle-menu"><span className="flex items-center"><MoreHorizontal className="mr-2 h-4 w-4" />More actions</span><ChevronRight className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-64">
                <DropdownMenuItem onSelect={openLiveSupport}><MessageSquare className="mr-2 h-4 w-4" />Start live support</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate(`/nexus-agent?deviceId=${encodeURIComponent(dev.id)}${dev.client_id ? `&clientId=${encodeURIComponent(dev.client_id)}` : ""}`)}><Terminal className="mr-2 h-4 w-4" />Nexus Agent control plane</DropdownMenuItem>
                {!isArchived && <DropdownMenuItem onSelect={() => openLifecycleDialog("archive")} data-testid="archive-device-menu"><Archive className="mr-2 h-4 w-4" />Archive asset</DropdownMenuItem>}
                {!isArchived && <DropdownMenuItem onSelect={() => openLifecycleDialog("merge")} data-testid="merge-device-menu"><GitMerge className="mr-2 h-4 w-4" />Merge duplicate</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => openLifecycleDialog("purge")} data-testid="purge-device-menu"><Trash2 className="mr-2 h-4 w-4" />Permanently delete…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </aside>

          <div className="min-w-0">
            <div className="nx-device-subnav" aria-label={`${activeDeviceSection.label} views`}>
              {activeDeviceSection.tabs.map(tab => <button key={tab.value} type="button" className="nx-device-subnav__item" data-active={activeTab === tab.value ? "true" : "false"} aria-pressed={activeTab === tab.value} onClick={() => setActiveTab(tab.value)} data-testid={`device-view-${tab.value}`}>{tab.label}</button>)}
            </div>

        {/* CURRENT WORK TAB */}
        <TabsContent value="overview" className="mt-3 space-y-3">
          <Card className="nx-device-current-work overflow-hidden">
            <CardContent className="divide-y divide-border/50 p-0">
              <section className="nx-device-current-work__section">
                <div className="nx-device-current-work__title"><AlertTriangle className="h-5 w-5 text-rose-500" /><div><p>Alerts ({data.alerts?.length || 0})</p><span>Active alerts from the last reported snapshot.</span></div><button type="button" onClick={() => setActiveTab("events")}>View all<ChevronRight /></button></div>
                <div className="nx-device-current-work__body">
                  <div className="nx-device-current-work__columns is-alert"><span>Severity</span><span>Alert</span><span>Source</span><span>Last seen</span></div>
                  {cockpitAlerts.length === 0 ? <p className="nx-device-current-work__empty">{cockpitQuery ? "No alerts match this device search." : "No active alerts are recorded."}</p> : cockpitAlerts.slice(0, 2).map((alert, index) => <button key={alert.id || index} type="button" className="nx-device-current-work__row is-alert" onClick={() => setActiveTab("events")}><Badge className={`${SEVERITY_COLORS[alert.severity] || "bg-muted text-muted-foreground"} capitalize`}><AlertTriangle />{alert.severity || "alert"}</Badge><span>{cleanDeviceText(alert.message || alert.alert_type || "Endpoint alert")}</span><span>{alert.source || alert.alert_type || "Monitoring"}</span><span>{alert.last_seen || alert.updated_at ? formatDistanceToNow(new Date(alert.last_seen || alert.updated_at), { addSuffix: true }) : lastObservedLabel}</span></button>)}
                </div>
              </section>
              <section className="nx-device-current-work__section">
                <div className="nx-device-current-work__title"><Download className="h-5 w-5 text-cyan-400" /><div><p>Patches ({dev.pending_patches || pendingPatchRecords.length})</p><span>Available patches from the last scan.</span></div><button type="button" onClick={() => setActiveTab("patches")}>View all<ChevronRight /></button></div>
                <div className="nx-device-current-work__body">
                  <div className="nx-device-current-work__columns is-patch"><span>KB / Update</span><span>Description</span><span>Classification</span><span>Status</span></div>
                  {cockpitPatches.length === 0 ? <p className="nx-device-current-work__empty">{cockpitQuery ? "No patches match this device search." : "No pending patches are recorded."}</p> : cockpitPatches.slice(0, 2).map((patchItem, index) => <button key={patchItem.id || index} type="button" className="nx-device-current-work__row is-patch" onClick={() => setActiveTab("patches")}><span className="font-mono">{patchItem.kb_number || patchItem.kb_id || patchItem.kb_article || patchItem.name || `Update ${index + 1}`}</span><span>{cleanDeviceText(patchItem.title || patchItem.description || "Patch record")}</span><span>{patchItem.category || patchItem.classification || "Security"}</span><Badge className="border border-amber-500/30 bg-amber-500/10 text-amber-300">{patchItem.status || "Available"}</Badge></button>)}
                </div>
              </section>
              <section className="nx-device-current-work__section">
                <div className="nx-device-current-work__title"><Ticket className="h-5 w-5 text-cyan-400" /><div><p>Tickets ({data.tickets?.length || 0})</p><span>Recent and open tickets for this device.</span></div><button type="button" onClick={() => setActiveTab("tickets")}>View all<ChevronRight /></button></div>
                <div className="nx-device-current-work__body">
                  <div className="nx-device-current-work__columns is-ticket"><span>ID</span><span>Title</span><span>Status</span><span>Priority</span><span>Updated</span></div>
                  {cockpitTickets.length === 0 ? <p className="nx-device-current-work__empty">{cockpitQuery ? "No tickets match this device search." : "No tickets are linked to this asset."}</p> : cockpitTickets.slice(0, 3).map((ticketItem, index) => <button key={ticketItem.id || index} type="button" className="nx-device-current-work__row is-ticket" onClick={() => navigate(`/tickets?ticket=${encodeURIComponent(ticketItem.ticket_number || ticketItem.id)}`)}><span className="font-mono">{ticketItem.ticket_number || `Ticket ${index + 1}`}</span><span>{ticketItem.title || "Untitled ticket"}</span><Badge variant="outline" className="capitalize">{(ticketItem.status || "unknown").replace(/_/g, " ")}</Badge><span className="capitalize"><i className={`is-${ticketItem.priority || "low"}`} />{ticketItem.priority || "Low"}</span><span>{ticketItem.updated_at || ticketItem.created_at ? formatDistanceToNow(new Date(ticketItem.updated_at || ticketItem.created_at), { addSuffix: true }) : "Not recorded"}</span></button>)}
                </div>
              </section>
            </CardContent>
          </Card>
        </TabsContent>

        {/* DEVICE DETAILS TAB */}
        <TabsContent value="device-details" className="space-y-4 mt-4">
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 space-y-4 xl:col-span-8">
              {/* Hardware Info */}
              <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
                <CardHeader className="border-b border-border/50 bg-muted/20 pb-4"><CardTitle className="text-sm flex items-center gap-2"><Cpu className="w-4 h-4 text-cyan-500" />Hardware Specifications</CardTitle><p className="text-xs text-muted-foreground">The physical identity and reported capacity of this endpoint.</p></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 pt-4 text-sm sm:grid-cols-2 [&>div]:min-w-0 [&>div]:rounded-xl [&>div]:border [&>div]:border-border/40 [&>div]:bg-muted/15 [&>div]:p-3 [&>div]:break-words [&>div]:transition-colors [&>div:hover]:bg-muted/30 [&>div>span:first-child]:mb-1.5">
                    <div><span className="text-muted-foreground block text-xs">Manufacturer</span><span className="font-medium">{dev.manufacturer || "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Model</span><span className="font-medium">{dev.model || "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Serial Number</span><span className="font-mono text-xs" data-sensitive="serial-number">{dev.serial_number || "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Processor</span><span className="font-medium">{dev.processor || "N/A"} {dev.processor_cores ? `(${dev.processor_cores} cores)` : ""}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Memory (RAM)</span><span className="font-medium">{dev.ram_gb ? `${dev.ram_gb} GB` : "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Storage</span><span className="font-medium">{dev.storage_total_gb ? `${dev.storage_used_gb || 0} / ${dev.storage_total_gb} GB` : "N/A"}</span></div>
                    {dev.gpu && <div><span className="text-muted-foreground block text-xs">GPU</span><span className="font-medium">{dev.gpu}</span></div>}
                    <div><span className="text-muted-foreground block text-xs">Device Type</span><Badge variant="outline" className="capitalize mt-0.5">{dev.device_type}</Badge></div>
                  </div>
                </CardContent>
              </Card>

              {/* OS Info */}
              <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
                <CardHeader className="border-b border-border/50 bg-muted/20 pb-4"><CardTitle className="text-sm flex items-center gap-2"><Monitor className="w-4 h-4 text-violet-400" />Operating System</CardTitle><p className="text-xs text-muted-foreground">Reported platform, domain membership and agent version.</p></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-3 [&>div]:min-w-0 [&>div]:rounded-xl [&>div]:border [&>div]:border-border/40 [&>div]:bg-muted/15 [&>div]:p-3 [&>div]:break-words [&>div]:transition-colors [&>div:hover]:bg-muted/30 [&>div>span:first-child]:mb-1.5">
                    <div><span className="text-muted-foreground block text-xs">OS</span><span className="font-medium">{dev.os}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Version</span><span className="font-medium">{dev.os_version || "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Build</span><span className="font-mono text-xs">{dev.os_build || "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Domain</span><span className="font-medium">{dev.domain || "Workgroup"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Last Reboot</span><span className="font-medium">{dev.last_reboot ? formatDistanceToNow(new Date(dev.last_reboot), { addSuffix: true }) : "N/A"}</span></div>
                    <div><span className="text-muted-foreground block text-xs">Agent Version</span><Badge variant="outline" className="font-mono mt-0.5">{dev.agent_version || "N/A"}</Badge></div>
                  </div>
                </CardContent>
              </Card>

              {/* Disk Health / Drive Status */}
              {diskHealth.length > 0 && (
                <Card data-testid="disk-health-card">
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><HardDrive className="w-4 h-4" />Drive Health ({diskHealth.length} drives)</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {diskHealth.map((disk, i) => {
                        const smartColor = disk.smart_status === "OK" ? "text-emerald-500" : disk.smart_status === "Warning" ? "text-amber-500" : disk.smart_status === "Critical" ? "text-red-500" : "text-muted-foreground";
                        const smartBg = disk.smart_status === "OK" ? "bg-emerald-500/10" : disk.smart_status === "Warning" ? "bg-amber-500/10" : disk.smart_status === "Critical" ? "bg-red-500/10" : "bg-muted/30";
                        const usageColor = disk.usage_percent >= 90 ? "bg-red-500" : disk.usage_percent >= 75 ? "bg-amber-500" : "bg-emerald-500";
                        return (
                          <div key={disk.id || `disk-${i}`} className={`p-3 rounded-lg border ${disk.smart_status === "Warning" ? "border-amber-500/20 bg-amber-500/5" : disk.smart_status === "Critical" ? "border-red-500/20 bg-red-500/5" : "border-border/40"}`} data-testid={`disk-${i}`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <HardDrive className={`w-4 h-4 ${smartColor}`} />
                                <span className="font-mono text-sm font-semibold">{disk.drive_letter || disk.mount_point}</span>
                                {disk.label && <span className="text-xs text-muted-foreground">({disk.label})</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge className={`${smartBg} ${smartColor} text-[9px]`}>{disk.smart_status || "Unknown"}</Badge>
                                <Badge variant="outline" className="text-[9px]">{disk.disk_type}</Badge>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 mb-2">
                              <div className="flex-1">
                                <div className="h-2 rounded-full bg-muted overflow-hidden">
                                  <div className={`h-full rounded-full transition-all ${usageColor}`} style={{ width: `${disk.usage_percent}%` }} />
                                </div>
                              </div>
                              <span className="text-xs font-mono font-bold w-12 text-right">{disk.usage_percent}%</span>
                            </div>
                            <div className="grid grid-cols-4 gap-2 text-[10px]">
                              <div><span className="text-muted-foreground block">Total</span><span className="font-mono font-medium">{disk.total_gb} GB</span></div>
                              <div><span className="text-muted-foreground block">Used</span><span className="font-mono font-medium">{disk.used_gb} GB</span></div>
                              <div><span className="text-muted-foreground block">Free</span><span className="font-mono font-medium">{disk.free_gb} GB</span></div>
                              <div><span className="text-muted-foreground block">FS</span><span className="font-mono font-medium">{disk.file_system}</span></div>
                            </div>
                            {(disk.model || disk.smart_temperature || disk.smart_hours) && (
                                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/20 pt-2 text-[10px] sm:grid-cols-4">
                                {disk.model && <div className="col-span-2"><span className="text-muted-foreground block">Model</span><span className="font-medium truncate block">{disk.model}</span></div>}
                                {disk.smart_temperature != null && (
                                  <div><span className="text-muted-foreground block">Temp</span><span className={`font-mono font-medium ${disk.smart_temperature > 50 ? "text-red-600 dark:text-red-400" : disk.smart_temperature > 40 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{disk.smart_temperature}°C</span></div>
                                )}
                                {disk.smart_hours != null && (
                                  <div><span className="text-muted-foreground block">Power Hours</span><span className="font-mono font-medium">{disk.smart_hours.toLocaleString()}h</span></div>
                                )}
                              </div>
                            )}
                            {(disk.smart_reallocated_sectors > 0 || disk.smart_pending_sectors > 0) && (
                              <div className="flex items-center gap-4 mt-2 pt-2 border-t border-border/20 text-[10px]">
                                {disk.smart_reallocated_sectors > 0 && <span className="text-amber-400 font-semibold">Reallocated Sectors: {disk.smart_reallocated_sectors}</span>}
                                {disk.smart_pending_sectors > 0 && <span className="text-red-400 font-semibold">Pending Sectors: {disk.smart_pending_sectors}</span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Recent Events Preview */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" />Recent Activity</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => setActiveTab("events")} className="text-xs">View All <ChevronRight className="w-3 h-3 ml-1" /></Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {(data.events || []).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/60 bg-muted/15 px-4 py-6 text-center">
                      <Activity className="mx-auto h-5 w-5 text-muted-foreground/70" />
                      <p className="mt-2 text-sm font-medium">No recent endpoint activity</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Agent check-ins, commands, patches and device changes will appear here with their recorded time.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(data.events || []).slice(0, 5).map((evt, i) => {
                      const EvtIcon = EVENT_ICONS[evt.event_type] || Info;
                      return (
                        <div key={`k-${i}`} className="flex items-center gap-3 py-1.5 text-sm">
                          <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${SEVERITY_COLORS[evt.severity] || "bg-muted"}`}>
                            <EvtIcon className="w-3.5 h-3.5" />
                          </div>
                          <span className="flex-1 truncate">{cleanDeviceText(evt.message)}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{evt.timestamp ? formatDistanceToNow(new Date(evt.timestamp), { addSuffix: true }) : ""}</span>
                        </div>
                      );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Context rail */}
            <div className="col-span-12 space-y-4 xl:col-span-4">
              <DeviceDossier deviceId={dev.id} headers={{ Authorization: `Bearer ${token}` }} API={API} />
              {/* Assignment & Identity */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Assignment</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div><span className="text-muted-foreground block text-xs">Assigned User</span><span className="font-medium">{dev.assigned_user || "Unassigned"}</span></div>
                  <Separator />
                  <div><span className="text-muted-foreground block text-xs">Last Logged In</span><span className="font-medium">{dev.last_logged_in_user || "N/A"}</span></div>
                  <Separator />
                  <div><span className="text-muted-foreground block text-xs">Location</span><span className="font-medium">{dev.location || "N/A"}</span></div>
                  <Separator />
                  <div><span className="text-muted-foreground block text-xs">Client</span><span className="font-medium">{dev.client_name}</span></div>
                  <Separator />
                  <div><span className="text-muted-foreground block text-xs">Last Seen</span><span className="font-medium">{dev.last_seen ? formatDistanceToNow(new Date(dev.last_seen), { addSuffix: true }) : "N/A"}</span></div>
                </CardContent>
              </Card>

              {/* Tags */}
              {(dev.tags || []).length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Tag className="w-4 h-4" />Tags</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1.5">
                      {dev.tags.map((tag, i) => <Badge key={`k-${i}`} variant="secondary" className="text-xs">{tag}</Badge>)}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Security Quick View */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4" />Security Status</CardTitle></CardHeader>
                <CardContent className="space-y-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Antivirus</span>
                    <Badge className={dev.antivirus_status === "active" ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}>
                      {dev.antivirus_status === "active" ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                      {dev.antivirus || "None"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">EDR</span>
                    <Badge className={dev.edr_status === "active" ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}>
                      {dev.edr_status === "active" ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Firewall</span>
                    <Badge className={dev.firewall_enabled ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}>
                      {dev.firewall_enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Encryption</span>
                    <span className="text-xs font-medium">{dev.encryption_status || "Unknown"}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Alerts */}
              {(data.alerts || []).length > 0 && (
                <Card className="border-red-500/20">
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-red-500"><AlertTriangle className="w-4 h-4" />Active Alerts ({data.alerts.length})</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {data.alerts.map((a, i) => (
                      <div key={`k-${i}`} className="p-2 rounded-lg bg-red-500/5 border border-red-500/10 text-sm">
                        <div className="flex items-center gap-2">
                          <Badge className={SEVERITY_COLORS[a.severity] + " text-[10px]"}>{a.severity}</Badge>
                          <span className="text-xs text-muted-foreground">{a.alert_type}</span>
                        </div>
                        <p className="mt-1 text-xs">{cleanDeviceText(a.message)}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* TICKETS TAB */}
        <TabsContent value="tickets" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Ticket className="w-4 h-4" />Linked Tickets</CardTitle>
                <Link to={`/tickets?device_id=${deviceId}`}><Button variant="outline" size="sm"><Plus className="w-3 h-3 mr-1" />Create Ticket for Device</Button></Link>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket #</TableHead><TableHead>Title</TableHead><TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead><TableHead>Assigned</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Work</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.tickets || []).length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No tickets linked to this device</TableCell></TableRow>
                  ) : (data.tickets || []).map((t, i) => {
                    const priorityColor = { critical: "bg-red-500/10 text-red-500", high: "bg-orange-500/10 text-orange-500", medium: "bg-amber-500/10 text-amber-500", low: "bg-blue-500/10 text-blue-500" };
                    const statusColor = { open: "border-blue-500/30 text-blue-500", in_progress: "border-amber-500/30 text-amber-500", resolved: "border-emerald-500/30 text-emerald-500", closed: "border-gray-500/30 text-gray-400", on_hold: "border-orange-500/30 text-orange-500" };
                    return (
                      <TableRow key={`k-${i}`} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/tickets?ticket=${encodeURIComponent(t.ticket_number || t.id)}`)} data-testid={`device-ticket-${t.id || i}`}>
                        <TableCell className="font-mono text-xs font-medium">{t.ticket_number || `TKT-${String(i+1).padStart(3,"0")}`}</TableCell>
                        <TableCell className="max-w-xs truncate font-medium">{t.title}</TableCell>
                        <TableCell><Badge className={`${priorityColor[t.priority] || ""} text-[10px] capitalize`}>{t.priority}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className={`${statusColor[t.status] || ""} text-[10px] capitalize`}>{(t.status || "").replace("_", " ")}</Badge></TableCell>
                        <TableCell className="text-sm">{t.assigned_name || "Unassigned"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.created_at ? formatDistanceToNow(new Date(t.created_at), { addSuffix: true }) : "-"}</TableCell>
                        <TableCell className="text-right">
                          {canStartWorkSession(t) ? <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-violet-700 hover:bg-violet-500/10 hover:text-violet-800 dark:text-violet-200 dark:hover:text-violet-100" onClick={(event) => { event.stopPropagation(); navigate(workSessionPath(t)); }} data-testid={`start-device-ticket-work-${t.id || i}`}><Wrench className="mr-1.5 h-3.5 w-3.5" />Start work</Button> : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {/* Ticket Statistics for this device */}
          {(data.tickets || []).length > 0 && (
            <div className="grid grid-cols-4 gap-3 mt-4">
              <Card><CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold">{data.tickets.length}</p>
                <p className="text-xs text-muted-foreground">Total Tickets</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold text-blue-500">{data.tickets.filter(t => t.status === "open").length}</p>
                <p className="text-xs text-muted-foreground">Open</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold text-amber-500">{data.tickets.filter(t => t.status === "in_progress").length}</p>
                <p className="text-xs text-muted-foreground">In Progress</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold text-emerald-500">{data.tickets.filter(t => ["resolved", "closed"].includes(t.status)).length}</p>
                <p className="text-xs text-muted-foreground">Resolved</p>
              </CardContent></Card>
            </div>
          )}
        </TabsContent>

        {/* PERFORMANCE TAB */}
        <TabsContent value="performance" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <HeroTile label="CPU now" value={latestValue("cpu_usage", "cpu")} suffix="%" icon={Cpu} glow={usageGlow(latestValue("cpu_usage", "cpu"))} subtitle={`Peak ${peakValue("cpu_usage", "cpu")}% in this view`} testId="device-perf-cpu" />
            <HeroTile label="Memory now" value={latestValue("memory_usage", "memory")} suffix="%" icon={MemoryStick} glow={usageGlow(latestValue("memory_usage", "memory"))} subtitle={`Peak ${peakValue("memory_usage", "memory")}% in this view`} testId="device-perf-memory" />
            <HeroTile label="Disk now" value={latestValue("disk_usage", "disk")} suffix="%" icon={HardDrive} glow={usageGlow(latestValue("disk_usage", "disk"))} subtitle={`Peak ${peakValue("disk_usage", "disk")}% in this view`} testId="device-perf-disk" />
            <HeroTile label="Samples" value={performanceSamples.length} icon={Activity} glow="violet" subtitle={performanceSamples[0]?.timestamp ? `Last sample ${formatDistanceToNow(new Date(performanceSamples[0].timestamp), { addSuffix: true })}` : "Awaiting agent telemetry"} testId="device-perf-samples" />
          </div>
          {perfData.length === 0 ? <Card><CardContent className="flex flex-col items-center justify-center py-14 text-center"><Activity className="mb-3 h-8 w-8 text-muted-foreground" /><p className="text-sm font-medium">No performance history yet</p><p className="mt-1 text-xs text-muted-foreground">NexusOps Agent samples will appear here after the next telemetry collection.</p></CardContent></Card> : <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">CPU Usage (24h)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={perfData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Memory Usage (24h)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={perfData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Area type="monotone" dataKey="memory" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Disk Usage (24h)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={perfData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Area type="monotone" dataKey="disk" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Network I/O (24h)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={perfData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Area type="monotone" dataKey="net_in" name="In (Mbps)" stroke="#10b981" fill="#10b981" fillOpacity={0.05} strokeWidth={1.5} dot={false} />
                    <Area type="monotone" dataKey="net_out" name="Out (Mbps)" stroke="#ef4444" fill="#ef4444" fillOpacity={0.05} strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>}
        </TabsContent>

        {/* ASSET STORY TAB */}
        <TabsContent value="asset-story" className="mt-4">
          <AssetStoryPanel device={dev} token={token} API={API} />
        </TabsContent>

        {/* SOFTWARE TAB */}
        <TabsContent value="software" className="mt-4 space-y-4">
          <Card className="border-violet-500/20 bg-violet-500/[0.03]">
            <CardContent className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10"><Package className="h-4 w-4 text-violet-400" /></div>
                <div><p className="text-sm font-medium">{software.length} discovered applications</p><p className="text-xs text-muted-foreground">{softwareInventoryAt ? `Inventory collected ${formatDistanceToNow(new Date(softwareInventoryAt), { addSuffix: true })}` : software.length > 0 ? "Inventory snapshot available · collection time not reported" : "Awaiting the first software inventory"}</p></div>
              </div>
              <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={softwareSearch} onChange={e => setSoftwareSearch(e.target.value)} placeholder="Search name, publisher, version…" className="h-9 pl-8 text-xs" data-testid="device-software-search" /></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm">Installed software</CardTitle><span className="text-xs text-muted-foreground">Showing {filteredSoftware.length} of {software.length}</span></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Version</TableHead><TableHead>Publisher</TableHead>
                    <TableHead>Category</TableHead><TableHead>Installed</TableHead><TableHead className="text-right">Size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {software.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No software inventory data</TableCell></TableRow>
                  ) : filteredSoftware.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No applications match “{softwareSearch}”</TableCell></TableRow>
                  ) : filteredSoftware.map((sw, i) => (
                    <TableRow key={`k-${i}`}>
                      <TableCell className="font-medium">{sw.name}</TableCell>
                      <TableCell className="font-mono text-xs">{sw.version}</TableCell>
                      <TableCell className="text-muted-foreground">{sw.publisher}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] capitalize">{(sw.category || "").replace("_", " ")}</Badge></TableCell>
                      <TableCell className="text-sm">{sw.install_date || "N/A"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{sw.size_mb ? `${sw.size_mb} MB` : "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PATCHES TAB */}
        <TabsContent value="patches" className="mt-4 space-y-4">
          <Card className="border-cyan-500/20 bg-cyan-500/[0.03]">
            <CardContent className="py-3 flex items-center justify-between gap-4">
              <div><p className="font-medium text-sm">Patch deployment is maintenance-window controlled</p><p className="text-xs text-muted-foreground">{dev.pending_patches || 0} Windows updates currently pending. Review the list, then schedule an approved window.</p></div>
              <Button size="sm" onClick={() => setPatchWindowOpen(true)} data-testid="device-schedule-patches"><Calendar className="w-4 h-4 mr-1" />Schedule patches</Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>KB / ID</TableHead><TableHead>Title</TableHead>
                    <TableHead>Severity</TableHead><TableHead>Category</TableHead><TableHead>Status</TableHead><TableHead>Installed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.patches || []).length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No patch data</TableCell></TableRow>
                  ) : (data.patches || []).map((p, i) => (
                    <TableRow key={`k-${i}`}>
                      <TableCell className="font-mono text-xs font-medium">{p.kb_id || p.kb_article || "-"}</TableCell>
                      <TableCell className="max-w-xs truncate">{p.title}</TableCell>
                      <TableCell><Badge className={SEVERITY_COLORS[p.severity || "important"] + " text-[10px] capitalize"}>{p.severity || "important"}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.category || "Windows Update"}</TableCell>
                      <TableCell><Badge className={PATCH_STATUS[p.status] + " text-[10px] capitalize"}>{p.status}</Badge></TableCell>
                      <TableCell className="text-sm">{p.installed_date || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SECURITY TAB */}
        <TabsContent value="security" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="xl:col-span-4">
              <Card className="h-full">
                <CardHeader className="pb-3"><CardTitle className="text-sm">Compliance Score</CardTitle></CardHeader>
                <CardContent className="flex flex-col items-center justify-center">
                  {complianceAssessed ? <>
                    <div className={`text-6xl font-bold font-mono ${complianceColor}`}>{dev.compliance_score}</div>
                    <p className="text-sm text-muted-foreground mt-2">out of 100 · assessed live</p>
                    <Progress value={dev.compliance_score} className="mt-4 h-3" />
                  </> : <>
                    <div className="text-xl font-semibold text-muted-foreground">Not assessed</div>
                    <p className="text-sm text-muted-foreground mt-2 text-center">Waiting for the next agent security inventory.</p>
                  </>}
                </CardContent>
              </Card>
            </div>
            <div className="space-y-4 xl:col-span-8">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Endpoint Protection</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: "Antivirus", value: dev.antivirus || "Not assessed", status: complianceAssessed ? dev.antivirus_status : "unknown", icon: Shield },
                      { label: "Real-time protection", value: dev.defender_real_time_enabled ? "Enabled" : complianceAssessed ? "Disabled" : "Not assessed", status: complianceAssessed ? (dev.defender_real_time_enabled ? "active" : "inactive") : "unknown", icon: ShieldCheck },
                      { label: "Firewall", value: dev.firewall_enabled ? "Enabled" : complianceAssessed ? "Disabled" : "Not assessed", status: complianceAssessed ? (dev.firewall_enabled ? "active" : "inactive") : "unknown", icon: Lock },
                      { label: "Disk Encryption", value: dev.encryption_status || "Not assessed", status: complianceAssessed ? (/encrypted|bitlocker on|protection on/i.test(dev.encryption_status || "") ? "active" : "inactive") : "unknown", icon: Lock },
                    ].map((item, i) => (
                      <div key={`k-${i}`} className="flex items-center gap-3 p-3 rounded-lg border">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${item.status === "active" ? "bg-emerald-500/10" : item.status === "inactive" ? "bg-red-500/10" : "bg-muted"}`}>
                          <item.icon className={`w-5 h-5 ${item.status === "active" ? "text-emerald-500" : item.status === "inactive" ? "text-red-500" : "text-muted-foreground"}`} />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{item.label}</p>
                          <p className="font-medium text-sm">{item.value}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Patch Compliance</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-emerald-500">{(data.patches || []).filter(p => p.status === "installed").length}</p>
                      <p className="text-xs text-muted-foreground">Installed</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-amber-500">{(data.patches || []).filter(p => p.status === "pending").length}</p>
                      <p className="text-xs text-muted-foreground">Pending</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-red-500">{(data.patches || []).filter(p => p.status === "failed").length}</p>
                      <p className="text-xs text-muted-foreground">Failed</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <div className="grid grid-cols-2 gap-4">
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Defender signature age</p><p className="font-mono font-semibold mt-1">{complianceAssessed ? `${dev.defender_signature_age_days ?? "?"} days` : "Not assessed"}</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Pending Windows updates</p><p className={`font-mono font-semibold mt-1 ${(dev.pending_patches || 0) > 0 ? "text-amber-500" : "text-emerald-500"}`}>{complianceAssessed ? (dev.pending_patches || 0) : "Not assessed"}</p></CardContent></Card>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* NETWORK TAB */}
        <TabsContent value="network" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="border-emerald-500/20 bg-emerald-500/[0.03]"><CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-400" />Active connection</div>
              <p className="mt-1 truncate font-medium">{activeAdapter?.adapter_name || "No active adapter"}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{activeAdapter?.ip_address || dev.ip_address || "No address reported"}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Gateway</div>
              <p className="mt-1 font-mono font-medium">{activeAdapter?.gateway || "Not reported"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Default route</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">DNS servers</div>
              <p className="mt-1 truncate font-mono font-medium text-xs">{(activeAdapter?.dns || []).join(", ") || "Not reported"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Resolver path</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Link speed</div>
              <p className="mt-1 font-mono font-medium">{displayLinkSpeed(activeAdapter?.speed_mbps)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{adapters.filter(adapter => adapter.status === "up").length} active of {adapters.length} adapters</p>
            </CardContent></Card>
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm flex items-center gap-2"><Network className="w-4 h-4" />Network adapters</CardTitle><span className="text-xs text-muted-foreground">Last collected: {activeAdapter?.last_updated ? formatDistanceToNow(new Date(activeAdapter.last_updated), { addSuffix: true }) : "—"}</span></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Adapter</TableHead><TableHead>Type</TableHead><TableHead>IP Address</TableHead>
                    <TableHead>Subnet</TableHead><TableHead>Gateway</TableHead><TableHead>DNS</TableHead><TableHead>Speed</TableHead><TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.network_adapters || []).length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No network adapter data</TableCell></TableRow>
                  ) : (data.network_adapters || []).map((n, i) => (
                    <TableRow key={`k-${i}`}>
                      <TableCell className="font-medium">{n.adapter_name}{n.ssid ? <span className="text-xs text-muted-foreground ml-1">({n.ssid})</span> : ""}{n.status === "up" && <span className="ml-2 text-[10px] text-emerald-400">PRIMARY</span>}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] capitalize">{n.type || "network"}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{n.ip_address || n.ip_addresses?.find(ip => ip.includes(".")) || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{n.subnet ? `/${n.subnet}` : "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{n.gateway || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{(n.dns || []).join(", ") || "-"}</TableCell>
                      <TableCell className="text-sm">{displayLinkSpeed(n.speed_mbps)}</TableCell>
                      <TableCell><Badge className={n.status === "up" ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"}>{n.status || "unknown"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* EVENTS TAB */}
        <TabsContent value="events" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead><TableHead>Event</TableHead><TableHead>Message</TableHead>
                    <TableHead>Severity</TableHead><TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.events || []).length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No events recorded</TableCell></TableRow>
                  ) : (data.events || []).map((evt, i) => {
                    const EvtIcon = EVENT_ICONS[evt.event_type] || Info;
                    return (
                      <TableRow key={`k-${i}`}>
                        <TableCell><div className={`w-7 h-7 rounded-md flex items-center justify-center ${SEVERITY_COLORS[evt.severity] || "bg-muted"}`}><EvtIcon className="w-3.5 h-3.5" /></div></TableCell>
                        <TableCell className="font-medium capitalize text-sm">{(evt.event_type || "").replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-sm">{cleanDeviceText(evt.message)}</TableCell>
                        <TableCell><Badge className={SEVERITY_COLORS[evt.severity] + " text-[10px] capitalize"}>{evt.severity}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{evt.timestamp ? format(new Date(evt.timestamp), "MMM d, HH:mm") : "-"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* REMOTE SESSIONS TAB */}
        <TabsContent value="remote-sessions" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><ExternalLink className="w-4 h-4" />Remote Session History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Technician</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead><TableHead>Lock Status</TableHead><TableHead>Started</TableHead><TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.remote_sessions || []).length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No remote sessions recorded</TableCell></TableRow>
                  ) : (data.remote_sessions || []).map((s, i) => (
                    <TableRow key={s.id || i} data-testid={`device-session-${i}`}>
                      <TableCell className="font-medium">{s.user_name || "Unknown"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs capitalize">{(s.session_type || "remote").replace("_", " ")}</Badge></TableCell>
                      <TableCell>
                        {s.status === "active" ? (
                          <Badge className="bg-emerald-600 text-white text-xs">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-zinc-400">Ended</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{s.status === "active" ? <span className="text-emerald-500">Live</span> : `${s.duration_minutes || 0}m`}</TableCell>
                      <TableCell>
                        <div className="text-xs">
                          {s.lock_action_on_disconnect ? (
                            <span className={s.lock_action_on_disconnect === "locked" ? "text-amber-500" : s.lock_action_on_disconnect === "unlocked" ? "text-green-500" : "text-zinc-500"}>
                              {s.lock_action_on_disconnect === "locked" && <Lock className="w-3 h-3 inline mr-1" />}
                              {s.lock_action_on_disconnect === "unlocked" && <Eye className="w-3 h-3 inline mr-1" />}
                              {s.lock_action_on_disconnect}
                            </span>
                          ) : "n/a"}
                          {s.was_locked_before_disconnect != null && (
                            <div className="text-[10px] text-muted-foreground">Before: {s.was_locked_before_disconnect ? "Locked" : "Unlocked"}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.started_at ? formatDistanceToNow(new Date(s.started_at), { addSuffix: true }) : "-"}</TableCell>
                      <TableCell className="text-xs max-w-[150px] truncate">{s.notes || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* BACKUPS TAB */}
        <TabsContent value="backups" className="mt-4">
          <DeviceBackupPlansPanel deviceId={dev.id} token={token} />
        </TabsContent>

        {/* TIME MACHINE TAB */}
        <TabsContent value="time-machine" className="mt-4">
          <DeviceTimeMachine
            deviceId={dev.id}
            headers={{ Authorization: `Bearer ${token}` }}
            API={API}
          />
        </TabsContent>

        {/* AUDIT LOG TAB */}
        <TabsContent value="audit-log" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b pb-3">
              <div>
                <CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-violet-400" />Device audit log</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Administrative changes, agent activity, and remote-access events for this endpoint.</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{(data.activity_logs || []).length} entries</Badge>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchDetail} aria-label="Refresh device audit log" data-testid="refresh-device-audit"><RefreshCw className="w-3.5 h-3.5" /></Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {(data.activity_logs || []).length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted"><Shield className="h-5 w-5 text-muted-foreground" /></div>
                  <p className="text-sm font-medium">No audit activity recorded</p>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">New agent check-ins, remote sessions, commands, and device changes will appear here.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {(data.activity_logs || []).map((log, i) => (
                    <div key={log.id || i} className="grid grid-cols-[auto_1fr] gap-x-3 px-4 py-3 transition-colors hover:bg-muted/30 sm:grid-cols-[auto_minmax(0,1fr)_auto]" data-testid={`device-audit-${i}`}>
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                        {log.action === "created" && <Plus className="w-4 h-4 text-green-500" />}
                        {log.action === "updated" && <Wrench className="w-4 h-4 text-sky-500" />}
                        {log.action === "deleted" && <XCircle className="w-4 h-4 text-red-500" />}
                        {log.action === "remote_connect" && <ExternalLink className="w-4 h-4 text-emerald-500" />}
                        {log.action === "remote_disconnect" && <Lock className="w-4 h-4 text-muted-foreground" />}
                        {!["created","updated","deleted","remote_connect","remote_disconnect"].includes(log.action) && <Info className="w-4 h-4 text-violet-400" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium">{log.user_name || "NexusMSP"}</span>
                          <Badge variant="outline" className="h-5 text-[10px] capitalize">{(log.action || "activity").replace(/_/g, " ")}</Badge>
                        </div>
                        <p className="mt-1 break-words text-xs text-muted-foreground">{log.details || "No additional details recorded."}</p>
                        {log.changes && Object.keys(log.changes).length > 0 && (
                          <div className="mt-2 rounded-md bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
                            {Object.entries(log.changes).slice(0, 5).map(([k, v]) => (
                              <div key={k} className="flex flex-wrap gap-x-1.5"><span className="font-medium text-foreground/70">{k}</span><span className="text-red-600 line-through dark:text-red-400">{v.old ?? "—"}</span><span className="text-muted-foreground">→</span><span className="text-emerald-600 dark:text-emerald-400">{v.new ?? "—"}</span></div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="col-start-2 mt-1 text-[10px] text-muted-foreground sm:col-start-auto sm:mt-0 sm:text-right">
                        <div>{log.created_at ? formatDistanceToNow(new Date(log.created_at), { addSuffix: true }) : "Unknown time"}</div>
                        {log.created_at && <div className="mt-0.5 hidden sm:block">{format(new Date(log.created_at), "d MMM yyyy, HH:mm")}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
          </div>
        </div>
        <div className="nx-device-workspace-nav" data-testid="device-tabs" aria-label="Device workspace sections">
          {deviceSections.map(section => {
            const SectionIcon = section.icon;
            const selected = activeDeviceSection.id === section.id;
            return <button key={section.id} type="button" className="nx-device-workspace-nav__item" data-active={selected ? "true" : "false"} aria-pressed={selected} onClick={() => setActiveTab(section.defaultTab)}>
              <SectionIcon className="h-7 w-7" />
              <span><strong>{section.label}</strong><small>{section.description}</small></span>
            </button>;
          })}
        </div>
      </Tabs>

      <Dialog open={deviceEditorOpen} onOpenChange={setDeviceEditorOpen}>
        <NexusWorkflowDialog
          eyebrow="Managed asset · record identity"
          title="Edit device identity"
          description="Update the details technicians use to identify and route work for this endpoint. Live health, network and agent signals remain protected."
          icon={Pencil}
          tone="cyan"
          data-testid="edit-device-identity-workflow"
          footer={<><Button variant="outline" onClick={() => setDeviceEditorOpen(false)} disabled={deviceEditorBusy}>Cancel</Button><Button onClick={saveDeviceIdentity} disabled={deviceEditorBusy} data-testid="save-device-identity">{deviceEditorBusy ? <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> : <Pencil className="mr-1.5 h-4 w-4" />}Save identity</Button></>}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.04] p-3 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Safe to edit here:</span> name, owning client, assigned user and location. Agent-reported hardware, health and connection details are intentionally kept separate so the record stays trustworthy.
            </div>
            <div>
              <Label htmlFor="edit-device-name">Device name</Label>
              <Input id="edit-device-name" value={deviceEditor.name} onChange={e => setDeviceEditor(prev => ({ ...prev, name: e.target.value }))} className="mt-1.5" data-testid="edit-device-name" />
            </div>
            <div>
              <Label>Owning client</Label>
              <Select value={deviceEditor.client_id || "__none__"} onValueChange={value => setDeviceEditor(prev => ({ ...prev, client_id: value === "__none__" ? "" : value }))}>
                <SelectTrigger className="mt-1.5" data-testid="edit-device-client"><SelectValue placeholder="Select a client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No client assigned</SelectItem>
                  {clientOptions.map(client => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="edit-device-assigned-user">Assigned user</Label>
                <Input id="edit-device-assigned-user" value={deviceEditor.assigned_user} onChange={e => setDeviceEditor(prev => ({ ...prev, assigned_user: e.target.value }))} placeholder="e.g. Aaron Steele" className="mt-1.5" data-testid="edit-device-assigned-user" />
              </div>
              <div>
                <Label htmlFor="edit-device-location">Location</Label>
                <Input id="edit-device-location" value={deviceEditor.location} onChange={e => setDeviceEditor(prev => ({ ...prev, location: e.target.value }))} placeholder="e.g. Home office" className="mt-1.5" data-testid="edit-device-location" />
              </div>
            </div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={lifecycleDialog === "archive"} onOpenChange={(open) => !open && closeLifecycleDialog()}>
        <NexusWorkflowDialog
          eyebrow="Managed asset lifecycle"
          title="Archive managed asset"
          description={`Retire ${dev.name} from active fleet views while retaining its device identity, operational history and audit trail.`}
          icon={Archive}
          tone="amber"
          data-testid="archive-device-workflow"
          footer={<><Button variant="outline" onClick={closeLifecycleDialog} disabled={lifecycleBusy}>Keep active</Button><Button onClick={archiveManagedAsset} disabled={lifecycleBusy || lifecycleReason.trim().length < 3} className="bg-amber-600 text-white hover:bg-amber-500">{lifecycleBusy ? <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> : <Archive className="mr-1.5 h-4 w-4" />}Archive asset</Button></>}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">What Nexus will retain</p>
              <p className="mt-1.5 leading-relaxed">Tickets, alerts, remote sessions, telemetry and the original asset identity remain auditable. If a Nexus Agent is installed, archiving does not uninstall or alter it; it simply prevents the archived record from being treated as an active managed asset.</p>
            </div>
            <div>
              <Label htmlFor="device-archive-reason">Why is this asset being archived?</Label>
              <Textarea id="device-archive-reason" className="mt-2 min-h-24" value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} placeholder="e.g. Device replaced and handed to approved e-waste provider" data-testid="archive-device-reason" />
            </div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={lifecycleDialog === "merge"} onOpenChange={(open) => !open && closeLifecycleDialog()}>
        <NexusWorkflowDialog
          eyebrow="Data quality · managed assets"
          title="Merge duplicate managed asset"
          description="Choose the record that should remain active. Nexus archives the duplicate and retains every original history link instead of rewriting evidence."
          icon={GitMerge}
          tone="violet"
          className="max-w-2xl"
          data-testid="merge-device-workflow"
          footer={<><Button variant="outline" onClick={closeLifecycleDialog} disabled={lifecycleBusy}>Cancel</Button><Button onClick={mergeManagedAsset} disabled={lifecycleBusy || !mergeTargetId || !mergePreview || lifecycleReason.trim().length < 3 || mergeConfirmation.trim() !== dev.name}>{lifecycleBusy ? <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> : <GitMerge className="mr-1.5 h-4 w-4" />}Merge into selected asset</Button></>}
        >
          <div className="space-y-5">
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05] p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Source: {dev.name}</p>
              <p className="mt-1.5 leading-relaxed">Only an asset under the same client can survive the merge. Agent-linked records can only remain as the surviving identity, so live endpoint provenance is never severed.</p>
            </div>
            <div>
              <Label htmlFor="device-merge-survivor">Keep this managed asset active</Label>
              <Select value={mergeTargetId} onValueChange={selectMergeTarget} disabled={mergeLoading || lifecycleBusy}>
                <SelectTrigger id="device-merge-survivor" className="mt-2" data-testid="merge-device-survivor"><SelectValue placeholder={mergeLoading ? "Finding safe candidates…" : "Select the surviving asset"} /></SelectTrigger>
                <SelectContent>
                  {mergeCandidates.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.serial_number || candidate.manufacturer || "No serial"} · {candidate.status}</SelectItem>)}
                </SelectContent>
              </Select>
              {!mergeLoading && mergeCandidates.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No compatible candidate is available. Nexus does not merge assets across clients or break an Agent-linked device identity.</p>}
            </div>
            {mergeLoading && <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" />Preparing retained-evidence preview…</div>}
            {mergePreview && <div className="space-y-3 rounded-xl border border-border/80 bg-muted/[0.13] p-4" data-testid="merge-device-preview">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">Merge impact preview</p><p className="mt-0.5 text-xs text-muted-foreground">{mergePreview.history_policy}</p></div><Badge variant="outline" className="border-violet-500/25 text-violet-700 dark:text-violet-200">Evidence retained</Badge></div>
              <div className="grid gap-2 sm:grid-cols-3">
                {Object.entries(mergePreview.evidence_counts || {}).filter(([, count]) => count > 0).length ? Object.entries(mergePreview.evidence_counts || {}).filter(([, count]) => count > 0).map(([label, count]) => <div key={label} className="rounded-lg border border-border/70 bg-background/60 px-3 py-2"><p className="text-lg font-semibold">{count}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label.replaceAll("_", " ")}</p></div>) : <p className="text-sm text-muted-foreground sm:col-span-3">No linked operational evidence was found on the duplicate.</p>}
              </div>
              <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">Inventory links stay with their original record. Source inventory records: {mergePreview.source_inventory_assets?.length || 0} · surviving inventory records: {mergePreview.survivor_inventory_assets?.length || 0}. This preserves commercial provenance for later review.</div>
            </div>}
            <div>
              <Label htmlFor="device-merge-reason">Why are these duplicate records?</Label>
              <Textarea id="device-merge-reason" className="mt-2 min-h-20" value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} placeholder="e.g. Manual inventory record was duplicated after Agent enrolment" data-testid="merge-device-reason" />
            </div>
            <div>
              <Label htmlFor="device-merge-confirmation">Type <span className="font-mono">{dev.name}</span> to archive this duplicate</Label>
              <Input id="device-merge-confirmation" className="mt-2" value={mergeConfirmation} onChange={(event) => setMergeConfirmation(event.target.value)} placeholder={dev.name} data-testid="merge-device-confirmation" />
            </div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={lifecycleDialog === "purge"} onOpenChange={(open) => !open && closeLifecycleDialog()}>
        <NexusWorkflowDialog
          eyebrow="Managed asset lifecycle"
          title="Permanently delete asset?"
          description="This is only for an empty, manually created record. Nexus blocks deletion if an Agent identity, ticket, alert, session, telemetry or inventory link exists."
          icon={Trash2}
          tone="rose"
          data-testid="purge-device-workflow"
          footer={<><Button variant="outline" onClick={closeLifecycleDialog} disabled={lifecycleBusy}>Keep record</Button><Button variant="destructive" onClick={purgeManagedAsset} disabled={lifecycleBusy || mergeConfirmation.trim() !== dev.name}>{lifecycleBusy ? <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}Delete permanently</Button></>}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.05] p-4 text-sm text-muted-foreground">For a retired endpoint, use <span className="font-medium text-foreground">Archive</span>. It keeps the evidence a technician, client, auditor or future incident investigation may need.</div>
            <div>
              <Label htmlFor="device-purge-confirmation">Type <span className="font-mono">{dev.name}</span> to confirm permanent deletion</Label>
              <Input id="device-purge-confirmation" className="mt-2" value={mergeConfirmation} onChange={(event) => setMergeConfirmation(event.target.value)} placeholder={dev.name} data-testid="purge-device-confirmation" />
              <Label htmlFor="device-purge-reason" className="mt-4 block">Why is this record being deleted?</Label>
              <Textarea id="device-purge-reason" className="mt-2" maxLength={1000} value={lifecycleReason} onChange={event => setLifecycleReason(event.target.value)} placeholder="Explain why this empty manual record is incorrect. This reason is retained in the client activity trail." />
            </div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      <MaintenanceWindowDialog
        open={patchWindowOpen}
        onClose={() => setPatchWindowOpen(false)}
        selectedIds={[dev.id]}
        deviceNames={{ [dev.id]: dev.name }}
        onScheduled={() => { setPatchWindowOpen(false); fetchDetail(); }}
      />
      <ChangeGuardianDialog
        open={safetyCheckOpen}
        onOpenChange={setSafetyCheckOpen}
        action="reboot"
        deviceIds={[dev.id]}
        headers={{ Authorization: `Bearer ${token}` }}
        previewOnly
      />
    </div>
  );
}
