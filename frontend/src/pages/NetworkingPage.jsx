import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Wifi, Network, Router, Server, Monitor, Globe, Search, Loader2, RefreshCw, ChevronRight,
  Plus, Users, Smartphone, Download, Upload, Shield, AlertTriangle, CheckCircle2,
  Edit, Trash2, Plug, Settings, Link2, Activity, Radio, Zap, BarChart3, Lock,
  MoreHorizontal, ChevronDown, GitBranch, FileSearch
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatUptime(seconds) {
  if (!seconds) return "N/A";
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

const StatusDot = ({ status }) => {
  const c = { online: "bg-emerald-500", warning: "bg-amber-500", offline: "bg-red-500", pending_adoption: "bg-blue-500", pending_sync: "bg-amber-500", pending_configuration: "bg-slate-500", sync_failed: "bg-red-500", recorded: "bg-sky-500" };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${c[status] || "bg-slate-500"}`} />;
};

const emptySiteForm = { name: "", client_id: "", client_name: "", controller_url: "", site_id: "default", location: "", wan_ip: "", isp: "", download_speed_mbps: "", upload_speed_mbps: "", username: "", password: "", verify_ssl: true, notes: "" };
const emptyDeviceForm = { name: "", mac: "", model: "", device_type: "ap", ip_address: "", firmware: "" };

const DPI_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];
const NETWORK_WORKSPACE_TOOLS = [
  { path: "/unifi", label: "UniFi Operations", icon: Wifi },
  { path: "/topology", label: "Topology", icon: GitBranch },
  { path: "/dns-monitor", label: "Nexus DNS", icon: Search },
  { path: "/bandwidth-monitor", label: "Bandwidth", icon: Activity },
  { path: "/dmarc-compliance", label: "Email Security", icon: Shield },
  { path: "/splynx-dashboard", label: "ISP Health", icon: FileSearch },
];

function WlanTab({ siteId, headers }) {
  const [wlans, setWlans] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try { const r = await axios.get(`${API}/networking/sites/${siteId}/wlans`, { headers }); setWlans(r.data); }
      catch {} finally { setLoading(false); }
    };
    fetch();
  }, [siteId]);
  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  return (
    <div className="space-y-3" data-testid="wlan-tab">
      {wlans.map(w => (
        <Card key={w.id} className={`${w.enabled ? "" : "opacity-50"}`} data-testid={`wlan-${w.id}`}>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${w.guest ? "bg-amber-500/10" : "bg-blue-500/10"}`}>
                  <Wifi className={`w-5 h-5 ${w.guest ? "text-amber-400" : "text-blue-400"}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{w.ssid}</p>
                    {w.guest && <Badge className="bg-amber-500/20 text-amber-400 text-[9px] border-amber-500/30">Guest</Badge>}
                    {!w.enabled && <Badge variant="secondary" className="text-[9px]">Disabled</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{w.security} | VLAN {w.vlan_id} | {w.band}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-[10px]"><Lock className="w-2.5 h-2.5 mr-0.5" />{w.security}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      {wlans.length === 0 && <p className="text-center text-muted-foreground py-8">No WLANs configured</p>}
    </div>
  );
}

function DpiTab({ siteId, headers }) {
  const [dpi, setDpi] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try { const r = await axios.get(`${API}/networking/sites/${siteId}/dpi`, { headers }); setDpi(r.data); }
      catch {} finally { setLoading(false); }
    };
    fetch();
  }, [siteId]);
  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!dpi || !dpi.categories) return <p className="text-center text-muted-foreground py-8">No traffic data</p>;
  
  const chartData = dpi.categories.map(c => ({
    name: c.name, Download: Math.round(c.rx_bytes / 1_000_000_000), Upload: Math.round(c.tx_bytes / 1_000_000_000),
  }));
  const pieData = dpi.categories.map((c, i) => ({
    name: c.name, value: c.rx_bytes + c.tx_bytes, color: DPI_COLORS[i % DPI_COLORS.length],
  }));
  const totalBytes = dpi.categories.reduce((a, c) => a + c.rx_bytes + c.tx_bytes, 0);

  return (
    <div className="space-y-4" data-testid="dpi-tab">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Traffic by Category (GB)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `${v}GB`} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
                <Tooltip formatter={v => [`${v} GB`]} />
                <Legend />
                <Bar dataKey="Download" fill="#10b981" radius={[0, 4, 4, 0]} />
                <Bar dataKey="Upload" fill="#f59e0b" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Traffic Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2} dataKey="value">
                  {pieData.map((e, i) => <Cell key={`k-${i}`} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={(v) => [`${(v / 1_000_000_000).toFixed(1)} GB`]} />
                <Legend formatter={(v) => <span className="text-xs">{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Category Breakdown</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead><TableHead>Clients</TableHead><TableHead className="text-right">Download</TableHead>
                <TableHead className="text-right">Upload</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dpi.categories.sort((a, b) => (b.rx_bytes + b.tx_bytes) - (a.rx_bytes + a.tx_bytes)).map((c, i) => {
                const total = c.rx_bytes + c.tx_bytes;
                const pct = totalBytes > 0 ? ((total / totalBytes) * 100).toFixed(1) : 0;
                return (
                  <TableRow key={`k-${i}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: DPI_COLORS[i % DPI_COLORS.length] }} />
                        {c.name}
                      </div>
                    </TableCell>
                    <TableCell>{c.clients}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-400">{(c.rx_bytes / 1_000_000_000).toFixed(1)} GB</TableCell>
                    <TableCell className="text-right font-mono text-amber-400">{(c.tx_bytes / 1_000_000_000).toFixed(1)} GB</TableCell>
                    <TableCell className="text-right font-mono">{(total / 1_000_000_000).toFixed(1)} GB</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: DPI_COLORS[i % DPI_COLORS.length] }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NetworkingPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [sites, setSites] = useState([]);
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedSite, setSelectedSite] = useState(null);
  const [siteOverview, setSiteOverview] = useState(null);
  const [siteDevices, setSiteDevices] = useState([]);
  const [siteClients, setSiteClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("devices");
  const [search, setSearch] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [siteDialog, setSiteDialog] = useState(false);
  const [editingSite, setEditingSite] = useState(null);
  const [siteForm, setSiteForm] = useState({ ...emptySiteForm });
  const [adoptDialog, setAdoptDialog] = useState(false);
  const [adoptForm, setAdoptForm] = useState({ ...emptyDeviceForm });
  const [editDeviceDialog, setEditDeviceDialog] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [testing, setTesting] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sitesRes, statsRes, clientsRes] = await Promise.all([
        axios.get(`${API}/networking/sites`, { headers }),
        axios.get(`${API}/networking/stats`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setSites(sitesRes.data);
      setStats(statsRes.data);
      setClients(clientsRes.data);
    } catch { toast.error("Failed to load networking data"); }
    finally { setLoading(false); }
  };

  const fetchSiteData = async (siteId) => {
    try {
      const [ovRes, devRes, cliRes] = await Promise.all([
        axios.get(`${API}/networking/sites/${siteId}/overview`, { headers }),
        axios.get(`${API}/networking/sites/${siteId}/devices`, { headers }),
        axios.get(`${API}/networking/sites/${siteId}/clients`, { headers }),
      ]);
      setSiteOverview(ovRes.data);
      setSiteDevices(devRes.data);
      setSiteClients(cliRes.data);
    } catch { toast.error("Failed to load site data"); }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedSite) fetchSiteData(selectedSite.id); }, [selectedSite]);

  const openAddSite = () => { setEditingSite(null); setSiteForm({ ...emptySiteForm }); setSiteDialog(true); };
  const openEditSite = (site) => {
    setEditingSite(site);
    setSiteForm({
      name: site.name || "", client_id: site.client_id || "", client_name: site.client_name || "",
      controller_url: site.controller_url || "", site_id: site.site_id || "default",
      location: site.location || "", wan_ip: site.wan_ip || "", isp: site.isp || "",
      download_speed_mbps: String(site.download_speed_mbps || ""),
      upload_speed_mbps: String(site.upload_speed_mbps || ""),
      username: "", password: "", verify_ssl: site.verify_ssl !== false, notes: site.notes || "",
    });
    setSiteDialog(true);
  };

  const handleSaveSite = async () => {
    if (!siteForm.name) { toast.error("Site name is required"); return; }
    const payload = {
      ...siteForm,
      download_speed_mbps: parseInt(siteForm.download_speed_mbps) || 0,
      upload_speed_mbps: parseInt(siteForm.upload_speed_mbps) || 0,
    };
    if (siteForm.client_id) {
      const cl = clients.find(c => c.id === siteForm.client_id);
      if (cl) payload.client_name = cl.name;
    }
    try {
      if (editingSite) {
        await axios.put(`${API}/networking/sites/${editingSite.id}`, payload, { headers });
        toast.success("Site updated");
        if (selectedSite?.id === editingSite.id) {
          setSelectedSite({ ...selectedSite, ...payload });
          fetchSiteData(editingSite.id);
        }
      } else {
        await axios.post(`${API}/networking/sites`, payload, { headers });
        toast.success("Site added");
      }
      setSiteDialog(false); fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save site"); }
  };

  const handleDeleteSite = async (siteId) => {
    try {
      await axios.delete(`${API}/networking/sites/${siteId}`, { headers });
      toast.success("Site deleted");
      if (selectedSite?.id === siteId) { setSelectedSite(null); setSiteOverview(null); }
      fetchData();
    } catch { toast.error("Failed to delete"); }
  };

  const handleTestConnection = async (siteId) => {
    setTesting(true);
    try {
      const res = await axios.post(`${API}/networking/sites/${siteId}/test-connection`, {}, { headers });
      if (res.data.success) toast.success(res.data.message);
      else toast.error(res.data.message);
    } catch { toast.error("Connection test failed"); }
    finally { setTesting(false); }
  };

  const handleAdoptDevice = async () => {
    if (!adoptForm.name || !adoptForm.mac) { toast.error("Name and MAC are required"); return; }
    try {
      await axios.post(`${API}/networking/sites/${selectedSite.id}/adopt-device`, adoptForm, { headers });
      toast.success("Network device record saved. It has not been adopted by the controller.");
      setAdoptDialog(false);
      fetchSiteData(selectedSite.id);
      fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not save network device"); }
  };

  const openEditDevice = (device) => {
    setEditingDevice(device);
    setEditDeviceDialog(true);
  };

  const handleUpdateDevice = async () => {
    try {
      const update = { name: editingDevice.name, ip_address: editingDevice.ip_address, status: editingDevice.status, notes: editingDevice.notes || "" };
      await axios.put(`${API}/networking/devices/${editingDevice.id}`, update, { headers });
      toast.success("Device updated");
      setEditDeviceDialog(false);
      fetchSiteData(selectedSite.id);
    } catch { toast.error("Failed to update device"); }
  };

  const handleDeleteDevice = async (deviceId) => {
    try {
      await axios.delete(`${API}/networking/devices/${deviceId}`, { headers });
      toast.success("Device removed");
      fetchSiteData(selectedSite.id);
      fetchData();
    } catch { toast.error("Failed to delete"); }
  };

  const filteredDevices = siteDevices
    .filter(d => deviceFilter === "all" || d.device_type === deviceFilter)
    .filter(d => !search || d.name?.toLowerCase().includes(search.toLowerCase()) || d.model?.toLowerCase().includes(search.toLowerCase()));

  const filteredClients = siteClients
    .filter(c => !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.ip_address?.includes(search) || c.mac?.toLowerCase().includes(search.toLowerCase()));

  // Dashboard data
  const [dashboard, setDashboard] = useState(null);
  const [dashLoading, setDashLoading] = useState(false);

  const fetchDashboard = async () => {
    setDashLoading(true);
    try {
      const res = await axios.get(`${API}/networking/dashboard`, { headers });
      setDashboard(res.data);
    } catch { toast.error("Failed to load dashboard"); }
    finally { setDashLoading(false); }
  };

  useEffect(() => { if (!selectedSite) fetchDashboard(); }, [selectedSite]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ===== SITE FORM DIALOG =====
  const siteFormDialog = (
    <Dialog open={siteDialog} onOpenChange={v => { setSiteDialog(v); if (!v) setEditingSite(null); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{editingSite ? "Edit Site" : "Add Network Site"}</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Site Name *</Label><Input value={siteForm.name} onChange={e => setSiteForm({ ...siteForm, name: e.target.value })} placeholder="e.g. Acme Corp - Main Office" data-testid="site-name-input" /></div>
            <div><Label>Client</Label>
              <Select value={siteForm.client_id} onValueChange={v => setSiteForm({ ...siteForm, client_id: v })}>
                <SelectTrigger data-testid="site-client-select"><SelectValue placeholder="Link to client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Location</Label><Input value={siteForm.location} onChange={e => setSiteForm({ ...siteForm, location: e.target.value })} placeholder="123 Business Ave, Suite 200" /></div>

          <Separator />
          <div><p className="text-sm font-semibold flex items-center gap-2"><Link2 className="w-4 h-4" />UniFi Controller Connection</p><p className="mt-1 text-xs text-muted-foreground">Add a controller when this site should sync live inventory. Sites can also be retained as audited network records without a controller.</p></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Controller URL</Label><Input value={siteForm.controller_url} onChange={e => setSiteForm({ ...siteForm, controller_url: e.target.value })} placeholder="https://192.168.1.1:8443" data-testid="site-controller-url" /></div>
            <div><Label>UniFi Site ID</Label><Input value={siteForm.site_id} onChange={e => setSiteForm({ ...siteForm, site_id: e.target.value })} placeholder="default" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Controller username</Label><Input value={siteForm.username} onChange={e => setSiteForm({ ...siteForm, username: e.target.value })} placeholder={editingSite ? "Leave blank to retain saved username" : "UniFi controller username"} /></div>
            <div><Label>Controller password</Label><Input type="password" value={siteForm.password} onChange={e => setSiteForm({ ...siteForm, password: e.target.value })} placeholder={editingSite ? "Leave blank to retain saved password" : "UniFi controller password"} /></div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border/70 p-3"><Switch checked={siteForm.verify_ssl} onCheckedChange={v => setSiteForm({ ...siteForm, verify_ssl: v })} /><div><Label>Verify TLS certificate</Label><p className="text-xs text-muted-foreground">Leave enabled unless the controller uses a trusted exception you have documented.</p></div></div>

          <Separator />
          <p className="text-sm font-semibold flex items-center gap-2"><Activity className="w-4 h-4" />WAN Details</p>
          <div className="grid grid-cols-4 gap-3">
            <div><Label>WAN IP</Label><Input value={siteForm.wan_ip} onChange={e => setSiteForm({ ...siteForm, wan_ip: e.target.value })} placeholder="203.45.67.10" /></div>
            <div><Label>ISP</Label><Input value={siteForm.isp} onChange={e => setSiteForm({ ...siteForm, isp: e.target.value })} placeholder="AT&T Fiber" /></div>
            <div><Label>Download (Mbps)</Label><Input type="number" value={siteForm.download_speed_mbps} onChange={e => setSiteForm({ ...siteForm, download_speed_mbps: e.target.value })} /></div>
            <div><Label>Upload (Mbps)</Label><Input type="number" value={siteForm.upload_speed_mbps} onChange={e => setSiteForm({ ...siteForm, upload_speed_mbps: e.target.value })} /></div>
          </div>
          <div><Label>Notes</Label><Textarea value={siteForm.notes} onChange={e => setSiteForm({ ...siteForm, notes: e.target.value })} rows={2} placeholder="Site notes..." /></div>
        </div>
        <DialogFooter>
          {editingSite && <Button variant="outline" onClick={() => handleTestConnection(editingSite.id)} disabled={testing} data-testid="test-connection-btn"><Plug className="w-4 h-4 mr-1" />{testing ? "Testing..." : "Test Connection"}</Button>}
          <Button onClick={handleSaveSite} data-testid="save-site-btn">{editingSite ? "Update" : "Add"} Site</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ===== ADOPT DEVICE DIALOG =====
  const adoptDeviceDialog = (
    <Dialog open={adoptDialog} onOpenChange={setAdoptDialog}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add network device record</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">This saves an audited local inventory record only. Use Sync to discover devices from a connected UniFi controller.</p>
        <div className="space-y-3">
          <div><Label>Device Name *</Label><Input value={adoptForm.name} onChange={e => setAdoptForm({ ...adoptForm, name: e.target.value })} placeholder="e.g. U6-Pro-Lobby" data-testid="adopt-device-name" /></div>
          <div><Label>MAC Address *</Label><Input value={adoptForm.mac} onChange={e => setAdoptForm({ ...adoptForm, mac: e.target.value })} placeholder="F0:9F:C2:AA:BB:CC" data-testid="adopt-device-mac" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Type</Label>
              <Select value={adoptForm.device_type} onValueChange={v => setAdoptForm({ ...adoptForm, device_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ap">Access Point</SelectItem>
                  <SelectItem value="switch">Switch</SelectItem>
                  <SelectItem value="gateway">Gateway</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Model</Label><Input value={adoptForm.model} onChange={e => setAdoptForm({ ...adoptForm, model: e.target.value })} placeholder="e.g. U6-Pro" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>IP Address</Label><Input value={adoptForm.ip_address} onChange={e => setAdoptForm({ ...adoptForm, ip_address: e.target.value })} placeholder="192.168.1.50" /></div>
            <div><Label>Firmware</Label><Input value={adoptForm.firmware} onChange={e => setAdoptForm({ ...adoptForm, firmware: e.target.value })} placeholder="7.0.83" /></div>
          </div>
        </div>
        <DialogFooter><Button onClick={handleAdoptDevice} data-testid="adopt-device-btn"><Radio className="w-4 h-4 mr-1" />Save device record</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ===== EDIT DEVICE DIALOG =====
  const editDeviceDlg = (
    <Dialog open={editDeviceDialog} onOpenChange={v => { setEditDeviceDialog(v); if (!v) setEditingDevice(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Device</DialogTitle></DialogHeader>
        {editingDevice && (
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={editingDevice.name} onChange={e => setEditingDevice({ ...editingDevice, name: e.target.value })} /></div>
            <div><Label>IP Address</Label><Input value={editingDevice.ip_address || ""} onChange={e => setEditingDevice({ ...editingDevice, ip_address: e.target.value })} /></div>
            <div><Label>Status</Label>
              <Select value={editingDevice.status} onValueChange={v => setEditingDevice({ ...editingDevice, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="recorded">Manually recorded</SelectItem>
                  <SelectItem value="pending_adoption">Legacy pending adoption</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea value={editingDevice.notes || ""} onChange={e => setEditingDevice({ ...editingDevice, notes: e.target.value })} rows={2} /></div>
          </div>
        )}
        <DialogFooter><Button onClick={handleUpdateDevice} data-testid="update-device-btn">Update</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ============ SITE DETAIL VIEW ============
  if (selectedSite && siteOverview) {
    return (
      <div className="space-y-6" data-testid="networking-site-detail">
        <OperationalPageHeader
          eyebrow={`Network workspace${selectedSite.client_name ? ` · ${selectedSite.client_name}` : ""}`}
          title={selectedSite.name}
          description={`${selectedSite.status === "online" ? "Online" : selectedSite.status || "Unknown"} site · ${selectedSite.isp || "ISP not recorded"} · ${selectedSite.location || "Location not recorded"}`}
          icon={Wifi}
          tone="sky"
          actions={(
            <>
              <Button variant="outline" size="sm" onClick={() => { setSelectedSite(null); setSiteOverview(null); }} data-testid="back-to-sites"><Globe className="w-4 h-4 mr-1" />All sites</Button>
              <Button variant="outline" size="sm" onClick={() => openEditSite(selectedSite)} data-testid="edit-site-btn"><Edit className="w-3 h-3 mr-1" />Edit Site</Button>
              <Button variant="outline" size="sm" onClick={() => handleTestConnection(selectedSite.id)} disabled={testing || !selectedSite.controller_url} title={selectedSite.controller_url ? "Test controller reachability" : "Configure a controller URL first"}><Plug className="w-3 h-3 mr-1" />{testing ? "Testing..." : "Test"}</Button>
              <Button variant="default" size="sm" disabled={!selectedSite.controller_url} title={selectedSite.controller_url ? "Sync from the configured UniFi controller" : "Configure a controller URL first"} onClick={async () => {
                toast.info("Syncing from controller...");
                try {
                  const res = await axios.post(`${API}/networking/sites/${selectedSite.id}/sync`, {}, { headers });
                  if (res.data.success) { toast.success(res.data.message); fetchSiteData(selectedSite.id); fetchData(); }
                  else toast.error(res.data.message);
                } catch { toast.error("Sync failed"); }
              }} data-testid="sync-site-btn"><RefreshCw className="w-3 h-3 mr-1" />Sync</Button>
            </>
          )}
        />

        {/* Controller Info */}
        <Card className="border-zinc-800">
          <CardContent className="py-3 flex items-center justify-between text-sm">
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground">Controller:</span>
              <span className="font-mono text-xs">{selectedSite.controller_url || "Not configured"}</span>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-muted-foreground">WAN:</span>
              <span className="font-mono text-xs">{selectedSite.wan_ip || "-"}</span>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-muted-foreground">ISP:</span>
              <span>{selectedSite.isp || "-"}</span>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-muted-foreground">Speed:</span>
              <span className="font-mono text-xs">{selectedSite.download_speed_mbps || 0}/{selectedSite.upload_speed_mbps || 0} Mbps</span>
            </div>
          </CardContent>
        </Card>

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
          <HeroTile label="Devices online" value={siteOverview.online_devices ?? 0} icon={Router} glow="emerald" subtitle={`of ${siteOverview.total_devices ?? 0} discovered`} />
          <HeroTile label="Access points" value={siteOverview.access_points ?? 0} icon={Wifi} glow="sky" subtitle={`${siteOverview.wireless_clients ?? 0} wireless clients`} />
          <HeroTile label="Switches" value={siteOverview.switches ?? 0} icon={Server} glow="violet" subtitle={`${siteOverview.wired_clients ?? 0} wired clients`} />
          <HeroTile label="Network clients" value={siteOverview.total_clients ?? 0} icon={Users} glow="indigo" subtitle="Currently discovered" />
          <HeroTile label="Received" value={formatBytes(siteOverview.total_rx_bytes)} icon={Download} glow="emerald" subtitle="Observed traffic" animated={false} />
          <HeroTile label="Sent" value={formatBytes(siteOverview.total_tx_bytes)} icon={Upload} glow="amber" subtitle="Observed traffic" animated={false} />
        </div>

        {/* Health */}
        <div className="grid grid-cols-3 gap-3">
          {["wan", "lan", "wlan"].map(sub => {
            const st = siteOverview.health?.[sub] || "n/a";
            return (
              <Card key={sub} className={st === "healthy" ? "border-emerald-500/30" : st === "warning" ? "border-amber-500/30" : ""}>
                <CardContent className="pt-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {sub === "wan" ? <Globe className="w-5 h-5" /> : sub === "lan" ? <Server className="w-5 h-5" /> : <Wifi className="w-5 h-5" />}
                    <div>
                      <p className="font-medium uppercase text-sm">{sub}</p>
                      <p className="text-xs text-muted-foreground">{sub === "wan" ? `${selectedSite.isp || "-"} - ${selectedSite.wan_ip || "-"}` : sub === "lan" ? `${siteOverview.wired_clients} wired` : `${siteOverview.wireless_clients} wireless`}</p>
                    </div>
                  </div>
                  <Badge variant={st === "healthy" ? "default" : "secondary"} className={st === "healthy" ? "bg-emerald-600" : ""}>{st}</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="devices" data-testid="tab-devices">Devices ({siteDevices.length})</TabsTrigger>
              <TabsTrigger value="clients" data-testid="tab-clients">Clients ({siteClients.length})</TabsTrigger>
              <TabsTrigger value="wlans" data-testid="tab-wlans">WLANs</TabsTrigger>
              <TabsTrigger value="dpi" data-testid="tab-dpi">Traffic</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              {tab === "devices" && (
                <>
                  <Button size="sm" onClick={() => { setAdoptForm({ ...emptyDeviceForm }); setAdoptDialog(true); }} data-testid="adopt-btn"><Plus className="w-3 h-3 mr-1" />Add device record</Button>
                  <Select value={deviceFilter} onValueChange={setDeviceFilter}>
                    <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="gateway">Gateways</SelectItem>
                      <SelectItem value="switch">Switches</SelectItem>
                      <SelectItem value="ap">Access Points</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9 w-[180px]" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
          </div>

          <TabsContent value="devices" className="space-y-3 mt-4">
            {filteredDevices.map(device => (
              <Card key={device.id} className="hover:border-primary/40 transition-colors" data-testid={`net-device-${device.id}`}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${device.device_type === "gateway" ? "bg-blue-500/10" : device.device_type === "switch" ? "bg-purple-500/10" : "bg-cyan-500/10"}`}>
                        {device.device_type === "gateway" ? <Router className="w-5 h-5 text-blue-500" /> : device.device_type === "switch" ? <Server className="w-5 h-5 text-purple-500" /> : <Wifi className="w-5 h-5 text-cyan-500" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2"><p className="font-medium">{device.name}</p><StatusDot status={device.status} /></div>
                        <p className="text-xs text-muted-foreground">{device.model} &middot; {device.ip_address} &middot; FW: {device.firmware}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-center"><p className="text-xs text-muted-foreground">CPU</p><p className="font-mono font-medium">{device.cpu_usage ?? "-"}%</p></div>
                      <div className="text-center"><p className="text-xs text-muted-foreground">MEM</p><p className="font-mono font-medium">{device.mem_usage ?? "-"}%</p></div>
                      {device.device_type === "ap" && <>
                        <div className="text-center"><p className="text-xs text-muted-foreground">Clients</p><p className="font-mono font-medium">{device.num_sta ?? ((device.clients_2g || 0) + (device.clients_5g || 0))}</p></div>
                        <div className="text-center"><p className="text-xs text-muted-foreground">Satisfaction</p><p className="font-mono font-medium">{device.satisfaction ?? "-"}%</p></div>
                      </>}
                      {device.device_type === "switch" && <>
                        <div className="text-center"><p className="text-xs text-muted-foreground">Ports</p><p className="font-mono font-medium">{device.num_ports ?? device.ports ?? device.port_table?.length ?? "-"}</p></div>
                        <div className="text-center"><p className="text-xs text-muted-foreground">PoE</p><p className="font-mono font-medium">{(device.poe_power_w ?? device.poe_power) ? `${device.poe_power_w ?? device.poe_power}W` : "-"}</p></div>
                      </>}
                      {device.device_type === "gateway" && <>
                        <div className="text-center"><p className="text-xs text-muted-foreground">DL</p><p className="font-mono font-medium">{device.throughput_rx_mbps ? `${device.throughput_rx_mbps}Mbps` : "-"}</p></div>
                        <div className="text-center"><p className="text-xs text-muted-foreground">UL</p><p className="font-mono font-medium">{device.throughput_tx_mbps ? `${device.throughput_tx_mbps}Mbps` : "-"}</p></div>
                      </>}
                      <div className="text-center"><p className="text-xs text-muted-foreground">Uptime</p><p className="font-mono font-medium">{formatUptime(device.uptime_seconds)}</p></div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditDevice(device)}><Edit className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteDevice(device.id)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
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
                      <TableHead>Client</TableHead><TableHead>IP</TableHead><TableHead>MAC</TableHead>
                      <TableHead>Type</TableHead><TableHead>OS</TableHead><TableHead>AP / SSID</TableHead>
                      <TableHead>Signal</TableHead><TableHead className="text-right">RX / TX</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredClients.map(c => (
                      <TableRow key={c.id}>
                        <TableCell><div className="flex items-center gap-2">{c.is_wireless ? <Smartphone className="w-4 h-4 text-cyan-500" /> : <Monitor className="w-4 h-4 text-blue-500" />}<span className="font-medium">{c.name || c.hostname || "Unknown"}</span></div></TableCell>
                        <TableCell className="font-mono text-xs">{c.ip_address || c.ip || "-"}</TableCell>
                        <TableCell className="font-mono text-xs">{c.mac}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{c.is_wireless ? "WiFi" : "Wired"}</Badge></TableCell>
                        <TableCell className="text-sm">{c.os_type || "-"}</TableCell>
                        <TableCell className="text-xs">{c.ap_name ? `${c.ap_name} / ${c.ssid}` : "-"}</TableCell>
                        <TableCell>{(c.signal_strength ?? c.signal) ? <span className={`font-mono text-xs ${(c.signal_strength ?? c.signal) > -50 ? "text-green-500" : (c.signal_strength ?? c.signal) > -70 ? "text-yellow-500" : "text-red-500"}`}>{c.signal_strength ?? c.signal} dBm</span> : "-"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatBytes(c.rx_bytes)} / {formatBytes(c.tx_bytes)}</TableCell>
                      </TableRow>
                    ))}
                    {filteredClients.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No clients</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* WLAN Tab */}
          <TabsContent value="wlans" className="space-y-3 mt-4">
            <WlanTab siteId={selectedSite.id} headers={headers} />
          </TabsContent>

          {/* DPI / Traffic Tab */}
          <TabsContent value="dpi" className="space-y-3 mt-4">
            <DpiTab siteId={selectedSite.id} headers={headers} />
          </TabsContent>
        </Tabs>
        {siteFormDialog}{adoptDeviceDialog}{editDeviceDlg}
      </div>
    );
  }

  // ============ SITES LIST ============
  return (
    <div className="space-y-6" data-testid="networking-page">
      <OperationalPageHeader
        eyebrow="Network workspace"
        title="Managed network"
        description="Client network records, controller connectivity, site health and UniFi operations in one workspace."
        icon={Network}
        tone="sky"
        actions={(
          <>
          <Button onClick={fetchData} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={openAddSite} data-testid="add-site-btn"><Plus className="w-4 h-4 mr-1" />Add Site</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="network-workspace-more"><MoreHorizontal className="h-3.5 w-3.5" />More<ChevronDown className="h-3 w-3 opacity-60" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {NETWORK_WORKSPACE_TOOLS.map(tool => {
                const Icon = tool.icon;
                return <DropdownMenuItem key={tool.path} onSelect={() => navigate(tool.path)}><Icon className="mr-2 h-3.5 w-3.5" />{tool.label}</DropdownMenuItem>;
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          </>
        )}
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-7">
          <HeroTile label="Sites online" value={stats.online_sites ?? 0} icon={Globe} glow="sky" subtitle={`of ${stats.total_sites ?? 0} managed`} />
          <HeroTile label="Devices online" value={stats.online_devices ?? 0} icon={Router} glow="emerald" subtitle={`of ${stats.total_devices ?? 0} discovered`} />
          <HeroTile label="Network clients" value={stats.total_clients ?? 0} icon={Users} glow="indigo" subtitle="Currently discovered" />
          <HeroTile label="Access points" value={stats.access_points ?? 0} icon={Wifi} glow="sky" subtitle="Managed wireless" />
          <HeroTile label="Switches" value={stats.switches ?? 0} icon={Server} glow="violet" subtitle="Managed switching" />
          <HeroTile label="Gateways" value={stats.gateways ?? 0} icon={Shield} glow="amber" subtitle="Managed edge" />
          <HeroTile label="Network health" value={stats.online_sites < stats.total_sites ? "Attention" : "Healthy"} icon={stats.online_sites < stats.total_sites ? AlertTriangle : CheckCircle2} glow={stats.online_sites < stats.total_sites ? "amber" : "emerald"} subtitle={stats.online_sites < stats.total_sites ? "One or more sites offline" : "All sites reporting"} animated={false} />
        </div>
      )}

      {/* Dashboard Alerts */}
      {dashboard && dashboard.alerts && dashboard.alerts.length > 0 && (
        <Card className="border-amber-500/30" data-testid="network-alerts-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" />Active Alerts ({dashboard.alerts.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dashboard.alerts.slice(0, 5).map((alert, i) => (
              <div key={`k-${i}`} className={`flex items-center gap-3 text-sm p-2 rounded-lg ${alert.severity === "critical" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{alert.message}</span>
                <Badge variant="outline" className="ml-auto text-[10px] capitalize">{alert.severity}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Site Bandwidth Overview */}
      {dashboard && dashboard.site_bandwidth && dashboard.site_bandwidth.length > 0 && (
        <Card data-testid="site-bandwidth-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-500" />Site Bandwidth Overview</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site</TableHead><TableHead>Client</TableHead><TableHead>Status</TableHead>
                  <TableHead>Devices</TableHead><TableHead>Clients</TableHead><TableHead>ISP</TableHead>
                  <TableHead>Speed</TableHead><TableHead className="text-right">RX / TX</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.site_bandwidth.map(sb => (
                  <TableRow key={sb.site_id} className="cursor-pointer hover:bg-muted/50" onClick={() => { const s = sites.find(x => x.id === sb.site_id); if (s) { setSelectedSite(s); setTab("devices"); } }}>
                    <TableCell className="font-medium">{sb.name}</TableCell>
                    <TableCell className="text-xs">{sb.client_name || "-"}</TableCell>
                    <TableCell><StatusDot status={sb.status} /></TableCell>
                    <TableCell>{sb.device_count}</TableCell>
                    <TableCell>{sb.client_count}</TableCell>
                    <TableCell className="text-xs">{sb.isp || "-"}</TableCell>
                    <TableCell className="text-xs font-mono">{sb.download_mbps}/{sb.upload_mbps} Mbps</TableCell>
                    <TableCell className="text-right text-xs font-mono">{formatBytes(sb.rx_bytes)} / {formatBytes(sb.tx_bytes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Offline Devices */}
      {dashboard && dashboard.offline_devices && dashboard.offline_devices.length > 0 && (
        <Card className="border-red-500/20" data-testid="offline-devices-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-red-500" />Offline Devices ({dashboard.offline_devices.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dashboard.offline_devices.map((d, i) => (
              <div key={`k-${i}`} className="flex items-center justify-between p-2 rounded-lg bg-red-500/5 text-sm">
                <div className="flex items-center gap-3">
                  <StatusDot status="offline" />
                  <span className="font-medium">{d.name}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">{d.type}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">{d.last_seen ? `Last seen: ${new Date(d.last_seen).toLocaleString()}` : "Never"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Firmware Distribution */}
      {dashboard && dashboard.firmware_versions && Object.keys(dashboard.firmware_versions).length > 0 && (
        <Card data-testid="firmware-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-indigo-500" />Firmware Versions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(dashboard.firmware_versions).map(([fw, count]) => (
                <Badge key={fw} variant="secondary" className="text-xs">{fw === "unknown" ? "Unknown" : `v${fw}`}: {count} device{count !== 1 ? "s" : ""}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sites List */}
      <div className="space-y-3">
        {sites.map(site => (
          <Card key={site.id} className="hover:border-primary/50 transition-all" data-testid={`site-card-${site.id}`}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 cursor-pointer flex-1" onClick={() => { setSelectedSite(site); setTab("devices"); setSearch(""); setDeviceFilter("all"); }}>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${site.status === "online" ? "bg-emerald-500/10" : site.status === "warning" ? "bg-amber-500/10" : "bg-red-500/10"}`}>
                    <Globe className={`w-6 h-6 ${site.status === "online" ? "text-emerald-500" : site.status === "warning" ? "text-amber-500" : "text-red-500"}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{site.name}</p><StatusDot status={site.status} />
                      {site.client_name && <Badge variant="outline" className="text-[10px]">{site.client_name}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{site.location} {site.controller_url ? `| ${site.controller_url}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-center"><p className="text-xs text-muted-foreground">ISP</p><p className="font-medium">{site.isp || "-"}</p></div>
                  <div className="text-center"><p className="text-xs text-muted-foreground">WAN</p><p className="font-mono text-xs">{site.wan_ip || "-"}</p></div>
                  <div className="text-center"><p className="text-xs text-muted-foreground">Speed</p><p className="font-mono">{site.download_speed_mbps}/{site.upload_speed_mbps} Mbps</p></div>
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditSite(site)}><Settings className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteSite(site.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground cursor-pointer" onClick={() => { setSelectedSite(site); setTab("devices"); }} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {sites.length === 0 && (
          <Card className="border-dashed"><CardContent className="py-12 text-center">
            <Globe className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-30" />
            <p className="text-muted-foreground mb-3">No network sites configured</p>
            <Button onClick={openAddSite}><Plus className="w-4 h-4 mr-1" />Add Your First Site</Button>
          </CardContent></Card>
        )}
      </div>
      {siteFormDialog}
    </div>
  );
}
