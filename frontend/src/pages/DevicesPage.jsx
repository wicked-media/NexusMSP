import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";
import { Server, Monitor, Laptop, Wifi, Plus, Search, RefreshCw, Cpu, MemoryStick, HardDrive, AlertTriangle, CheckCircle, XCircle, ChevronRight, LayoutGrid, List, Shield, Download, Loader2, Trash2, Edit } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";

import { API, useAuth } from "../App";

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
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
    <div className="space-y-6" data-testid="devices-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Devices</h1>
          <p className="text-muted-foreground">{devices.length} managed endpoints</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchData} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={openCreate} data-testid="add-device-btn"><Plus className="w-4 h-4 mr-1" />Add Device</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Monitor className="w-5 h-5 text-blue-500" /></div><div><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-bold">{stats.total || 0}</p></div></div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-emerald-500" /></div><div><p className="text-xs text-muted-foreground">Online</p><p className="text-xl font-bold text-emerald-500">{stats.online || 0}</p></div></div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center"><XCircle className="w-5 h-5 text-red-500" /></div><div><p className="text-xs text-muted-foreground">Offline</p><p className="text-xl font-bold text-red-500">{stats.offline || 0}</p></div></div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-amber-500" /></div><div><p className="text-xs text-muted-foreground">Warning</p><p className="text-xl font-bold text-amber-500">{stats.warning || 0}</p></div></div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center"><Shield className="w-5 h-5 text-purple-500" /></div><div><p className="text-xs text-muted-foreground">Avg CPU</p><p className="text-xl font-bold">{stats.avg_cpu || 0}%</p></div></div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center"><Download className="w-5 h-5 text-orange-500" /></div><div><p className="text-xs text-muted-foreground">Need Patching</p><p className="text-xl font-bold text-orange-500">{stats.needs_patching || 0}</p></div></div>
        </CardContent></Card>
      </div>

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
                  return (
                    <TableRow key={d.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => navigate(`/devices/${d.id}`)} data-testid={`device-row-${d.id}`}>
                      <TableCell>
                        <div className="relative">
                          <DevIcon className="w-5 h-5 text-muted-foreground" />
                          <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${STATUS_DOT[d.status]}`} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {d.name}
                            <Badge className={STATUS_COLORS[d.status] + " border text-[9px] capitalize px-1.5"}>{d.status}</Badge>
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
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
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
            return (
              <Card key={d.id} className="cursor-pointer hover:border-primary/30 transition-colors group" onClick={() => navigate(`/devices/${d.id}`)} data-testid={`device-card-${d.id}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${STATUS_COLORS[d.status]}`}>
                        <DevIcon className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold group-hover:text-primary transition-colors">{d.name}</h3>
                        <p className="text-xs text-muted-foreground">{d.client_name}</p>
                      </div>
                    </div>
                    <Badge className={STATUS_COLORS[d.status] + " border text-[9px] capitalize"}>{d.status}</Badge>
                  </div>
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
                      {d.tags.slice(0, 3).map((t, i) => <Badge key={i} variant="secondary" className="text-[9px] px-1.5 py-0">{t}</Badge>)}
                      {d.tags.length > 3 && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">+{d.tags.length - 3}</Badge>}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-3 pt-2 border-t text-[10px] text-muted-foreground">
                    <span>Last seen: {d.last_seen ? formatDistanceToNow(new Date(d.last_seen), { addSuffix: true }) : "N/A"}</span>
                    <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {formDialog}
    </div>
  );
}
