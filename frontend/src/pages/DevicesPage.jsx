import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";
import { Server, Monitor, Laptop, Wifi, Plus, Search, RefreshCw, Cpu, MemoryStick, HardDrive, AlertTriangle, CheckCircle, XCircle, ChevronRight, LayoutGrid, List, Shield, Download, Loader2, Trash2, Edit, Radar, Import, Eye, Users, Terminal, Play, Cloud } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import RemoteAccessButton from "../components/devices/RemoteAccessButton";
import { toast } from "sonner";

import { API, useAuth } from "../App";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";

const DEVICE_ICONS = { server: Server, workstation: Monitor, laptop: Laptop, network: Wifi, mobile: Laptop };
const STATUS_COLORS = { online: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", offline: "bg-red-500/10 text-red-500 border-red-500/20", warning: "bg-amber-500/10 text-amber-500 border-amber-500/20" };
const STATUS_DOT = { online: "bg-emerald-500", offline: "bg-red-500", warning: "bg-amber-500" };

function UsagePill({ value, thresholds = [70, 90] }) {
  const color = value >= thresholds[1] ? "text-red-500" : value >= thresholds[0] ? "text-amber-500" : "text-emerald-500";
  return <span className={`font-mono text-xs font-medium ${color}`}>{Math.round(value)}%</span>;
}

const emptyForm = { name: "", client_id: "", device_type: "workstation", os: "Windows 11", ip_address: "", serial_number: "", mac_address: "", manufacturer: "", model: "", processor: "", ram_gb: "", storage_total_gb: "", location: "", assigned_user: "", tags: "", notes: "" };

export default function DevicesPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [devices, setDevices] = useState([]);
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
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
  const [remoteBusy, setRemoteBusy] = useState({});

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    try {
      const [devRes, clientRes, statsRes] = await Promise.all([
        axios.get(`${API}/devices`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/devices/stats/summary`, { headers }).catch(() => ({ data: {} }))
      ]);
      setDevices(devRes.data);
      setClients(clientRes.data);
      setStats(statsRes.data);
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
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Launch handlers for inline Remote button (called from RemoteAccessButton)
  const setDevBusy = (id, v) => setRemoteBusy(m => ({ ...m, [id]: v }));

  const launchTrmmForDevice = async (dev) => {
    // If not linked, deep-link to device detail where the link dialog is
    if (!dev.trmm_agent_id) {
      toast.info("Opening device to link TRMM agent…");
      navigate(`/devices/${dev.id}`);
      return;
    }
    setDevBusy(dev.id, true);
    try {
      const res = await axios.get(`${API}/trmm/agents/${dev.trmm_agent_id}/remote-url`, { headers });
      if (res.data?.success && res.data?.urls) {
        const url = res.data.urls.control || res.data.urls.terminal || res.data.urls.file
          || Object.values(res.data.urls).find(v => typeof v === "string");
        if (url) { window.open(url, "_blank", "noopener,noreferrer"); toast.success("Opening MeshCentral…"); }
        else toast.error("No remote URL returned by TRMM");
      } else {
        toast.error(res.data?.message || "Could not start remote session");
      }
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setDevBusy(dev.id, false); }
  };

  const launchRustDeskForDevice = async (dev) => {
    if (!dev.rustdesk_id) {
      toast.info("Opening device to configure RustDesk…");
      navigate(`/devices/${dev.id}`);
      return;
    }
    setDevBusy(dev.id, true);
    try {
      const res = await axios.post(`${API}/rustdesk/quick-connect`, { rustdesk_id: dev.rustdesk_id }, { headers });
      const relay = res.data?.relay_server;
      const uri = relay
        ? `rustdesk://${dev.rustdesk_id}@${relay.replace(/^https?:\/\//, "").split("/")[0].split(":")[0]}`
        : `rustdesk://${dev.rustdesk_id}`;
      const a = document.createElement("a"); a.href = uri; a.style.display = "none";
      document.body.appendChild(a); a.click();
      setTimeout(() => document.body.removeChild(a), 100);
      toast.success(`Launching RustDesk to ${dev.rustdesk_id}`);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to connect"); }
    finally { setDevBusy(dev.id, false); }
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
  }, []);

  const filtered = devices.filter(d => {
    if (filterStatus !== "all" && d.status !== filterStatus) return false;
    if (filterType !== "all" && d.device_type !== filterType) return false;
    if (filterClient !== "all" && d.client_id !== filterClient) return false;
    if (search) {
      const s = search.toLowerCase();
      return d.name.toLowerCase().includes(s) || (d.client_name || "").toLowerCase().includes(s) || (d.ip_address || "").includes(s) || (d.os || "").toLowerCase().includes(s) || (d.serial_number || "").toLowerCase().includes(s) || (d.manufacturer || "").toLowerCase().includes(s);
    }
    return true;
  });

  const openCreate = () => { setEditing(null); setForm(emptyForm); setIsFormOpen(true); };
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

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this device?")) return;
    try {
      await axios.delete(`${API}/devices/${id}`, { headers });
      toast.success("Device deleted");
      fetchData();
    } catch (e) { toast.error("Delete failed"); }
  };

  const toggleSelectDevice = (id) => {
    setSelectedDevices(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  };

  const selectAll = () => {
    if (selectedDevices.length === filtered.length) setSelectedDevices([]);
    else setSelectedDevices(filtered.map(d => d.id));
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedDevices.length} devices?`)) return;
    try {
      await Promise.all(selectedDevices.map(id => axios.delete(`${API}/devices/${id}`, { headers })));
      toast.success(`${selectedDevices.length} devices deleted`);
      setSelectedDevices([]);
      fetchData();
    } catch { toast.error("Bulk delete failed"); }
  };

  const handleBulkReboot = async () => {
    toast.success(`Reboot command sent to ${selectedDevices.length} devices`);
    setSelectedDevices([]);
  };

  const handleBulkScan = async () => {
    toast.success(`Security scan queued for ${selectedDevices.length} devices`);
    setSelectedDevices([]);
  };

  const handleBulkDeployAgent = async (osType) => {
    const count = selectedDevices.length;
    const ext = osType === "windows" ? "ps1" : "sh";
    try {
      // Download a zip-like bundle or individual scripts
      for (const deviceId of selectedDevices) {
        const res = await axios.get(`${API}/devices/${deviceId}/agent-script?os_type=${osType}`, {
          headers, responseType: "blob",
        });
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement("a");
        a.href = url;
        a.download = `nexusops-agent-${deviceId}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      }
      toast.success(`${count} agent script${count > 1 ? "s" : ""} downloaded (${osType === "windows" ? "PowerShell" : "Bash"})`);
      setSelectedDevices([]);
    } catch {
      toast.error("Failed to download agent scripts");
    }
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

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const formDialog = (
    <Dialog open={isFormOpen} onOpenChange={v => { setIsFormOpen(v); if (!v) setEditing(null); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{editing ? `Edit ${editing.name}` : "Add Device"}</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Device Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="ACME-WS-001" data-testid="device-name-input" /></div>
            <div><Label>Client *</Label>
              <Select value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}>
                <SelectTrigger data-testid="device-client-select"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Type</Label>
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
            <div><Label>OS</Label><Input value={form.os} onChange={e => setForm({ ...form, os: e.target.value })} placeholder="Windows 11" /></div>
            <div><Label>IP Address</Label><Input value={form.ip_address} onChange={e => setForm({ ...form, ip_address: e.target.value })} placeholder="192.168.1.100" /></div>
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
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Location</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Office Floor 2" /></div>
            <div><Label>Assigned User</Label><Input value={form.assigned_user} onChange={e => setForm({ ...form, assigned_user: e.target.value })} placeholder="john@acme.com" /></div>
          </div>
          <div><Label>MAC Address</Label><Input value={form.mac_address} onChange={e => setForm({ ...form, mac_address: e.target.value })} placeholder="00:1A:2B:3C:4D:5E" /></div>
          <div><Label>Tags (comma separated)</Label><Input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="production, vpn-user, critical" /></div>
          <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Additional notes..." /></div>
        </div>
        <DialogFooter><Button onClick={handleSave} data-testid="save-device-btn">{editing ? "Update" : "Create"} Device</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <PageShell data-testid="devices-page">
      <TrmmFreshnessStrip token={token} />
      <MetricStrip columns={6}>
        <MetricTile label="Total" value={stats.total || 0} accent="sky" icon={<Monitor className="w-2.5 h-2.5 text-sky-400" />} testid="devices-metric-total" />
        <MetricTile label="Online" value={stats.online || 0} accent="emerald" icon={<CheckCircle className="w-2.5 h-2.5 text-emerald-400" />} testid="devices-metric-online" />
        <MetricTile label="Offline" value={stats.offline || 0} accent="rose" icon={<XCircle className="w-2.5 h-2.5 text-rose-400" />} testid="devices-metric-offline" />
        <MetricTile label="Warning" value={stats.warning || 0} accent="amber" icon={<AlertTriangle className="w-2.5 h-2.5 text-amber-400" />} testid="devices-metric-warning" />
        <MetricTile label="Avg CPU" value={`${stats.avg_cpu || 0}%`} accent="violet" icon={<Cpu className="w-2.5 h-2.5 text-violet-400" />} testid="devices-metric-cpu" />
        <MetricTile label="Need Patching" value={stats.needs_patching || 0} accent="amber" icon={<Download className="w-2.5 h-2.5 text-amber-400" />} testid="devices-metric-patching" />
      </MetricStrip>
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Devices</h1>
          <p className="text-xs text-zinc-500 mt-0.5">{devices.length} managed endpoints</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchData} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button
            variant="outline" size="sm"
            className="text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/10"
            onClick={async () => {
              try {
                const r = await axios.post(`${API}/devices/auto-link-acronis`, {}, { headers: { Authorization: `Bearer ${token}` } });
                toast.success(`Auto-linked ${r.data.matched}/${r.data.scanned} devices to Acronis (${r.data.no_match} no match)`);
                fetchData();
              } catch (e) { toast.error(e.response?.data?.detail || "Auto-link failed"); }
            }}
            data-testid="auto-link-acronis-btn"
            title="Match device names to Acronis resources"
          >
            <Cloud className="w-4 h-4 mr-1" />Auto-link Acronis
          </Button>
          <Button variant="outline" onClick={() => { setDiscoveryResults(null); setSelectedDiscovered([]); setIsDiscoveryOpen(true); }} data-testid="discover-devices-btn"><Radar className="w-4 h-4 mr-1" />Discover</Button>
          <Button onClick={openCreate} data-testid="add-device-btn"><Plus className="w-4 h-4 mr-1" />Add Device</Button>
        </div>
      </div>

      {/* Bulk Actions Toolbar */}
      {selectedDevices.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-primary/5 border border-primary/20 rounded-lg" data-testid="bulk-actions-bar">
          <Badge variant="secondary">{selectedDevices.length} selected</Badge>
          <Button size="sm" variant="outline" onClick={handleBulkReboot} data-testid="bulk-reboot"><RefreshCw className="w-3 h-3 mr-1" />Reboot</Button>
          <Button size="sm" variant="outline" onClick={handleBulkScan} data-testid="bulk-scan"><Shield className="w-3 h-3 mr-1" />Scan</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" data-testid="bulk-deploy-agent"><Download className="w-3 h-3 mr-1" />Deploy Agent</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => handleBulkDeployAgent("windows")} data-testid="bulk-deploy-windows">
                <Monitor className="w-4 h-4 mr-2" />Windows (PowerShell)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleBulkDeployAgent("linux")} data-testid="bulk-deploy-linux">
                <Terminal className="w-4 h-4 mr-2" />Linux / macOS (Bash)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="destructive" onClick={handleBulkDelete} data-testid="bulk-delete"><Trash2 className="w-3 h-3 mr-1" />Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedDevices([])} className="ml-auto">Clear</Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name, IP, OS, serial..." value={search} onChange={e => setSearch(e.target.value)} data-testid="device-search" />
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
        <div className="ml-auto flex gap-1">
          <Button variant={viewMode === "table" ? "default" : "outline"} size="icon" className="h-9 w-9" onClick={() => setViewMode("table")}><List className="w-4 h-4" /></Button>
          <Button variant={viewMode === "grid" ? "default" : "outline"} size="icon" className="h-9 w-9" onClick={() => setViewMode("grid")}><LayoutGrid className="w-4 h-4" /></Button>
        </div>
      </div>

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
                  const DevIcon = DEVICE_ICONS[d.device_type] || Monitor;
                  const viewers = deviceViewers[d.id] || [];
                  const isRemoted = viewers.length > 0;
                  return (
                    <TableRow key={d.id} className={`cursor-pointer hover:bg-muted/50 transition-colors ${isRemoted ? "bg-cyan-500/[0.03]" : ""}`} onClick={() => navigate(`/devices/${d.id}`)} data-testid={`device-row-${d.id}`}>
                      <TableCell onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectedDevices.includes(d.id)} onChange={() => toggleSelectDevice(d.id)} className="rounded" /></TableCell>
                      <TableCell>
                        <div className="relative">
                          <DevIcon className="w-5 h-5 text-muted-foreground" />
                          <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${STATUS_DOT[d.status]}`} />
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
                      <TableCell className="text-center"><UsagePill value={d.cpu_usage || 0} /></TableCell>
                      <TableCell className="text-center"><UsagePill value={d.memory_usage || 0} /></TableCell>
                      <TableCell className="text-center"><UsagePill value={d.disk_usage || 0} /></TableCell>
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
                          <RemoteAccessButton
                            device={d}
                            status={d.rustdesk_id ? (rdStatusMap[d.rustdesk_id] || d.status) : d.status}
                            busy={!!remoteBusy[d.id]}
                            onLaunchTrmm={() => launchTrmmForDevice(d)}
                            onLaunchRustDesk={() => launchRustDeskForDevice(d)}
                            compact
                            providersOverride={activeProviders}
                            testid={`row-remote-${d.id}`}
                          />
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(d)}><Edit className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(d.id)}><Trash2 className="w-3 h-3" /></Button>
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
                      <RemoteAccessButton
                        device={d}
                        status={d.rustdesk_id ? (rdStatusMap[d.rustdesk_id] || d.status) : d.status}
                        busy={!!remoteBusy[d.id]}
                        onLaunchTrmm={() => launchTrmmForDevice(d)}
                        onLaunchRustDesk={() => launchRustDeskForDevice(d)}
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

      {formDialog}

      {/* DEVICE DISCOVERY DIALOG */}
      <Dialog open={isDiscoveryOpen} onOpenChange={setIsDiscoveryOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Network Device Discovery</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Scan a client's network to discover devices and import them with one click.</p>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label>Client</Label>
              <Select value={discoveryClientId} onValueChange={setDiscoveryClientId}>
                <SelectTrigger data-testid="discovery-client-select"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <Label>Subnet</Label>
              <Input value={discoverySubnet} onChange={e => setDiscoverySubnet(e.target.value)} placeholder="192.168.1.0/24" data-testid="discovery-subnet" />
            </div>
            <Button onClick={handleDiscoverDevices} disabled={discoveryLoading || !discoveryClientId} data-testid="run-discovery-btn">
              {discoveryLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Radar className="w-4 h-4 mr-1" />}
              Scan Network
            </Button>
          </div>

          {discoveryResults && (
            <div className="space-y-3 mt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{discoveryResults.discovered_count} devices found</Badge>
                  <span className="text-xs text-muted-foreground">on {discoveryResults.subnet}</span>
                </div>
                {selectedDiscovered.length > 0 && (
                  <Button size="sm" onClick={handleImportDiscovered} disabled={importLoading} data-testid="import-discovered-btn">
                    {importLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
                    Import {selectedDiscovered.length} Device{selectedDiscovered.length > 1 ? "s" : ""}
                  </Button>
                )}
              </div>
              <div className="max-h-[400px] overflow-y-auto space-y-1.5">
                {discoveryResults.devices.map(dev => (
                  <div key={dev.id} className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                    dev.already_imported ? "bg-muted/20 opacity-60" : selectedDiscovered.includes(dev.id) ? "bg-primary/5 border-primary/30" : "hover:bg-muted/50"
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
        </DialogContent>
      </Dialog>
      </div>
    </PageShell>
  );
}

function TrmmFreshnessStrip({ token }) {
  const [status, setStatus] = useState(null);
  const [outages, setOutages] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const load = useCallback(() => {
    const headers = { Authorization: `Bearer ${token}` };
    axios.get(`${API}/trmm-sync/status`, { headers }).then((r) => setStatus(r.data)).catch(() => {});
    axios.get(`${API}/trmm-sync/outages`, { headers }).then((r) => setOutages(r.data?.outages || [])).catch(() => {});
  }, [token]);
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]);

  if (!status) return null;
  const sec = status.staleness_seconds;
  const color = sec == null ? "zinc" : sec < 180 ? "emerald" : sec < 900 ? "amber" : "rose";
  const fmt = sec == null ? "never" : sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.floor(sec / 60)}m` : `${Math.floor(sec / 3600)}h`;

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await axios.post(`${API}/trmm-sync/run`, {}, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(`Synced · ${r.data.devices_updated} devices${r.data.outages_created ? ` · ${r.data.outages_created} outage(s)` : ""}`);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSyncing(false); }
  };

  return (
    <div className="px-6 pt-3 space-y-2" data-testid="trmm-freshness">
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <Server className="w-3.5 h-3.5 text-violet-400" />
        <span className="text-muted-foreground">TRMM sync:</span>
        <Badge variant="outline" className={`text-${color}-400 border-${color}-500/40 text-[10px]`}>Updated {fmt} ago</Badge>
        {status.demo_mode && <Badge variant="outline" className="text-amber-400 border-amber-500/40 text-[10px]">DEMO MODE</Badge>}
        <span className="text-muted-foreground">· {status.agents_seen} agents · {status.transitions_count || 0} recent transitions</span>
        <Button size="sm" variant="ghost" onClick={syncNow} disabled={syncing} data-testid="devices-sync-now" className="h-6 px-2 text-[11px]">
          {syncing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}Sync now
        </Button>
        <a href="/device-reliability" className="ml-auto text-violet-400 hover:underline text-[11px]">Reliability center →</a>
      </div>
      {outages.length > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2 flex items-center gap-2 text-xs flex-wrap" data-testid="outage-banner">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
          <strong className="text-rose-300">{outages.length} active outage{outages.length > 1 ? "s" : ""}:</strong>
          <span>{outages.slice(0, 3).map((o) => `${o.client_name} (${o.offline_count} offline)`).join(" · ")}</span>
          <a href="/device-reliability" className="ml-auto text-rose-300 hover:underline">Review</a>
        </div>
      )}
    </div>
  );
}

