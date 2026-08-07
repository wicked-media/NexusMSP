import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HoldToConfirmButton } from "@/components/ui/hold-to-confirm-button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router-dom";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import {
  Plus, Search, Loader2, Monitor, HardDrive, Laptop, Server, Wifi,
  AlertTriangle, Shield, DollarSign, Edit, Trash2, ArrowLeft, Calendar,
  Building, Tag, ArrowUpDown, RefreshCw, Boxes, Wrench, MessageSquare, MoreHorizontal, ChevronDown, QrCode, ShoppingCart
} from "lucide-react";
import { format, isPast, parseISO, differenceInDays } from "date-fns";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";

const ASSET_TYPES = ["hardware", "software", "license", "peripheral", "network", "server", "mobile", "other"];
const ASSET_ICONS = { hardware: Laptop, software: HardDrive, license: Tag, peripheral: Wifi, network: Wifi, server: Server, mobile: Monitor, other: Monitor };
const INVENTORY_ASSET_TOOLS = [
  { path: "/qr-assets", label: "QR Asset Tags", icon: QrCode },
  { path: "/asset-lifecycle", label: "Lifecycle & Warranty", icon: Wrench },
  { path: "/asset-depreciation", label: "Depreciation", icon: DollarSign },
  { path: "/procurement-planner", label: "Procurement", icon: ShoppingCart },
];

export default function AssetsPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const { assetId } = useParams();
  const [assets, setAssets] = useState([]);
  const [clients, setClients] = useState([]);
  const [devices, setDevices] = useState([]);
  const [stats, setStats] = useState({});
  const [expiring, setExpiring] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewAsset, setViewAsset] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [form, setForm] = useState({
    name: "", client_id: "", device_id: "", asset_type: "hardware", manufacturer: "", model: "",
    serial_number: "", purchase_date: "", warranty_expiry: "", cost: "",
    status: "active", location: "", assigned_to: "", depreciation_rate: "", notes: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [assetsRes, clientsRes, devicesRes, statsRes, expiringRes] = await Promise.all([
        axios.get(`${API}/assets`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/devices`, { headers }),
        axios.get(`${API}/assets/stats`, { headers }),
        axios.get(`${API}/assets/expiring`, { headers }),
      ]);
      setAssets(assetsRes.data);
      if (assetId) {
        const directAsset = assetsRes.data.find(asset => asset.id === assetId);
        if (directAsset) setViewAsset(directAsset);
      }
      setClients(clientsRes.data);
      setDevices(devicesRes.data);
      setStats(statsRes.data);
      setExpiring(expiringRes.data);
    } catch { toast.error("Failed to load assets"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => setForm({
    name: "", client_id: "", device_id: "", asset_type: "hardware", manufacturer: "", model: "",
    serial_number: "", purchase_date: "", warranty_expiry: "", cost: "",
    status: "active", location: "", assigned_to: "", depreciation_rate: "", notes: ""
  });

  const openCreate = () => { setEditing(null); resetForm(); setIsFormOpen(true); };
  const openEdit = (a) => {
    setEditing(a);
    setForm({
      name: a.name, client_id: a.client_id, device_id: a.device_id || "", asset_type: a.asset_type || "hardware",
      manufacturer: a.manufacturer || "", model: a.model || "", serial_number: a.serial_number || "",
      purchase_date: a.purchase_date || "", warranty_expiry: a.warranty_expiry || "",
      cost: String(a.cost || ""), status: a.status || "active",
      location: a.location || "", assigned_to: a.assigned_to || "",
      depreciation_rate: String(a.depreciation_rate || ""), notes: a.notes || ""
    });
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.client_id) { toast.error("Name and client required"); return; }
    const payload = { ...form, cost: parseFloat(form.cost) || 0, depreciation_rate: parseFloat(form.depreciation_rate) || 0 };
    try {
      if (editing) {
        await axios.put(`${API}/assets/${editing.id}`, payload, { headers });
        toast.success("Asset updated");
      } else {
        await axios.post(`${API}/assets`, payload, { headers });
        toast.success("Asset created");
      }
      setIsFormOpen(false); fetchAll();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleDelete = async (id) => {
    try { await axios.delete(`${API}/assets/${id}`, { headers }); toast.success("Deleted"); fetchAll(); if (viewAsset?.id === id) setViewAsset(null); }
    catch { toast.error("Failed"); }
    finally { setPendingDelete(null); }
  };

  const startLiveChat = async (asset) => {
    if (!asset.device_id) {
      toast.error("Link this inventory record to a managed asset before starting client chat");
      return;
    }
    try {
      const response = await axios.post(`${API}/live-chat/devices/${asset.device_id}/open`, {}, { headers });
      const sessionId = response.data?.session?.id;
      if (!sessionId) throw new Error("No chat session returned");
      toast.success("Live support session opened");
      navigate(`/live-chat?session=${encodeURIComponent(sessionId)}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to start client chat for this asset");
    }
  };

  const getWarrantyBadge = (a) => {
    if (!a.warranty_expiry) return null;
    try {
      const exp = parseISO(a.warranty_expiry);
      const days = differenceInDays(exp, new Date());
      if (days < 0) return <Badge variant="destructive" className="text-[10px]">Expired</Badge>;
      if (days < 90) return <Badge className="bg-yellow-500/20 text-yellow-400 text-[10px]">{days}d left</Badge>;
      return <Badge className="bg-green-500/20 text-green-400 text-[10px]">Valid</Badge>;
    } catch { return null; }
  };

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const filtered = assets
    .filter(a => filterType === "all" || a.asset_type === filterType)
    .filter(a => filterStatus === "all" || a.status === filterStatus)
    .filter(a => !search || a.name?.toLowerCase().includes(search.toLowerCase()) || a.serial_number?.toLowerCase().includes(search.toLowerCase()) || a.manufacturer?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      if (typeof av === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc" ? String(av || "").localeCompare(String(bv || "")) : String(bv || "").localeCompare(String(av || ""));
    });

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const formDialog = (
    <Dialog open={isFormOpen} onOpenChange={v => { setIsFormOpen(v); if (!v) setEditing(null); }}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden border-cyan-500/25 bg-[linear-gradient(145deg,rgba(9,22,30,0.98),rgba(13,15,21,0.98))] p-0">
        <DialogHeader className="border-b border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.17),transparent_45%),linear-gradient(135deg,rgba(16,185,129,0.08),transparent)] px-6 py-5 pr-14"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Inventory register</p><DialogTitle className="mt-1 flex items-center gap-2 text-xl text-zinc-100"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10"><Boxes className="h-4 w-4 text-cyan-200" /></span>{editing ? "Refine inventory asset" : "Add inventory asset"}</DialogTitle><p className="mt-2 text-sm text-zinc-400">Record commercial and lifecycle evidence, then optionally link it to a live managed endpoint.</p></DialogHeader>
        <div className="max-h-[68vh] space-y-3 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Dell OptiPlex 7090" data-testid="asset-name" /></div>
            <div><Label>Client *</Label><Select value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}><SelectTrigger data-testid="asset-client"><SelectValue placeholder="Select client" /></SelectTrigger><SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div><Label>Managed asset link</Label><Select value={form.device_id || "unlinked"} onValueChange={v => setForm({ ...form, device_id: v === "unlinked" ? "" : v })}><SelectTrigger data-testid="asset-managed-device"><SelectValue placeholder="Not linked to a managed asset" /></SelectTrigger><SelectContent><SelectItem value="unlinked">Not linked — inventory record only</SelectItem>{devices.filter(d => !form.client_id || d.client_id === form.client_id).map(d => <SelectItem key={d.id} value={d.id}>{d.name}{d.status ? ` · ${d.status}` : ""}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-xs text-muted-foreground">Link a managed asset to enable live support and keep inventory, ownership, and client communication together.</p></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Type</Label><Select value={form.asset_type} onValueChange={v => setForm({ ...form, asset_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ASSET_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Manufacturer</Label><Input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} placeholder="Dell" /></div>
            <div><Label>Model</Label><Input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="OptiPlex 7090" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Serial Number</Label><Input value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} placeholder="SN-123456" /></div>
            <div><Label>Purchase Date</Label><Input type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} /></div>
            <div><Label>Warranty Expiry</Label><Input type="date" value={form.warranty_expiry} onChange={e => setForm({ ...form, warranty_expiry: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Cost ($)</Label><Input type="number" step="0.01" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} data-testid="asset-cost" /></div>
            <div><Label>Depreciation (%/yr)</Label><Input type="number" step="0.1" value={form.depreciation_rate} onChange={e => setForm({ ...form, depreciation_rate: e.target.value })} /></div>
            <div><Label>Status</Label><Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="retired">Retired</SelectItem><SelectItem value="in_repair">In Repair</SelectItem><SelectItem value="lost">Lost</SelectItem></SelectContent></Select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Location</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Office A, Rack 3" /></div>
            <div><Label>Assigned To</Label><Input value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })} placeholder="User name" /></div>
          </div>
          <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Additional notes..." rows={2} /></div>
        </div>
        <DialogFooter className="border-t border-white/[0.07] bg-black/10 px-6 py-4"><Button variant="ghost" onClick={() => setIsFormOpen(false)}>Cancel</Button><Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={handleSave} data-testid="save-asset-btn">{editing ? "Save asset" : "Create asset"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const deleteDialog = (
    <Dialog open={Boolean(pendingDelete)} onOpenChange={open => !open && setPendingDelete(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Remove inventory asset?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">This removes <span className="font-medium text-foreground">{pendingDelete?.name}</span> from the inventory register. Use this only for an accidental record; retiring an asset preserves its history.</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
          <HoldToConfirmButton onComplete={() => handleDelete(pendingDelete.id)} data-testid="confirm-delete-asset">Hold to remove</HoldToConfirmButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (viewAsset) {
    const a = viewAsset;
    const depreciatedValue = a.cost && a.depreciation_rate && a.purchase_date
      ? Math.max(0, a.cost - (a.cost * (a.depreciation_rate / 100) * (differenceInDays(new Date(), parseISO(a.purchase_date)) / 365)))
      : a.cost || 0;
    const TypeIcon = ASSET_ICONS[a.asset_type] || Monitor;
    return (
      <PageShell data-testid="asset-detail">
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <OperationalPageHeader
          eyebrow="Inventory record"
          title={a.name}
          description={`${a.client_name || "Unassigned client"} · ${a.manufacturer || "Unknown manufacturer"} ${a.model || ""} · ${a.serial_number || "No serial recorded"}`}
          icon={TypeIcon}
          tone="sky"
          actions={<>
            <Button variant="outline" size="sm" onClick={() => { setViewAsset(null); navigate("/assets"); }} data-testid="back-to-assets"><ArrowLeft className="w-4 h-4 mr-1" />All assets</Button>
            {a.device_id && <Button size="sm" onClick={() => startLiveChat(a)} className="bg-emerald-600 hover:bg-emerald-500" data-testid="start-asset-live-chat"><MessageSquare className="w-4 h-4 mr-1" />Start live chat</Button>}
            <Button size="sm" onClick={() => openEdit(a)} data-testid="edit-asset-btn"><Edit className="w-4 h-4 mr-1" />Edit asset</Button>
          </>}
        />
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-8 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center"><TypeIcon className="w-6 h-6 text-primary" /></div>
                    <div><CardTitle className="text-base">Value & warranty</CardTitle><p className="text-sm text-muted-foreground">Lifecycle information for this inventory record</p></div>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={a.status === "active" ? "default" : "secondary"} className="capitalize">{a.status}</Badge>
                    {getWarrantyBadge(a)}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Purchase Cost</p><p className="text-lg font-bold">${(a.cost || 0).toFixed(2)}</p></div>
                  <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Current Value</p><p className="text-lg font-bold text-cyan-500">${depreciatedValue.toFixed(2)}</p></div>
                  <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Purchase Date</p><p className="text-lg font-bold">{a.purchase_date ? format(parseISO(a.purchase_date), "MMM d, yyyy") : "N/A"}</p></div>
                  <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Warranty Expiry</p><p className={`text-lg font-bold ${a.warranty_expiry && isPast(parseISO(a.warranty_expiry)) ? "text-red-500" : ""}`}>{a.warranty_expiry ? format(parseISO(a.warranty_expiry), "MMM d, yyyy") : "N/A"}</p></div>
                </div>
              </CardContent>
            </Card>
            {a.notes && <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Notes</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{a.notes}</p></CardContent></Card>}
          </div>
          <div className="col-span-4 space-y-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Details</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="font-medium capitalize">{a.asset_type}</span></div><Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Serial #</span><span className="font-mono">{a.serial_number || "N/A"}</span></div><Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Client</span><span className="font-medium">{a.client_name}</span></div><Separator />
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Managed asset</span><span className="truncate font-medium">{a.device_id ? (devices.find(d => d.id === a.device_id)?.name || "Linked") : "Not linked"}</span></div><Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Location</span><span className="font-medium">{a.location || "N/A"}</span></div><Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Assigned To</span><span className="font-medium">{a.assigned_to || "Unassigned"}</span></div><Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Depreciation</span><span className="font-medium">{a.depreciation_rate || 0}% /yr</span></div>
            </CardContent></Card>
            <div className="flex flex-col gap-2">
              {a.device_id && <Button onClick={() => startLiveChat(a)} className="w-full bg-emerald-600 hover:bg-emerald-500" data-testid="start-asset-live-chat-panel"><MessageSquare className="w-4 h-4 mr-1" />Start live chat</Button>}
              <Button variant="outline" onClick={() => navigate(`/clients?client=${a.client_id}`)} className="w-full"><Building className="w-4 h-4 mr-1" />Open client</Button>
              <Button variant="destructive" onClick={() => setPendingDelete(a)} className="w-full" data-testid="delete-asset-btn"><Trash2 className="w-4 h-4 mr-1" />Remove asset</Button>
            </div>
          </div>
        </div>
        {formDialog}
        {deleteDialog}
      </div>
      </PageShell>
    );
  }

  return (
    <PageShell data-testid="assets-page">
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <OperationalPageHeader
        eyebrow="Asset inventory"
        title="Inventory Assets"
        description={`${assets.length} tracked records across clients, with serial, ownership, warranty, and lifecycle detail in one place.`}
        icon={Boxes}
        tone="sky"
        actions={<>
          <Button variant="outline" size="sm" onClick={fetchAll} data-testid="assets-refresh-btn"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button size="sm" onClick={openCreate} data-testid="add-asset-btn"><Plus className="w-4 h-4 mr-1" />Add Asset</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="inventory-assets-more"><MoreHorizontal className="h-3.5 w-3.5" />More<ChevronDown className="h-3 w-3 opacity-60" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {INVENTORY_ASSET_TOOLS.map(tool => {
                const Icon = tool.icon;
                return <DropdownMenuItem key={tool.path} onSelect={() => navigate(tool.path)}><Icon className="mr-2 h-3.5 w-3.5" />{tool.label}</DropdownMenuItem>;
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </>}
      />

      <MetricStrip columns={5}>
        <MetricTile label="Total Assets" value={stats.total || 0} accent="sky" icon={<HardDrive className="w-2.5 h-2.5 text-sky-400" />} testid="assets-metric-total" />
        <MetricTile label="Active" value={stats.active || 0} accent="emerald" icon={<Shield className="w-2.5 h-2.5 text-emerald-400" />} testid="assets-metric-active" />
        <MetricTile label="Total Value" value={`$${(stats.total_value || 0).toLocaleString(undefined, {minimumFractionDigits: 0})}`} accent="cyan" icon={<DollarSign className="w-2.5 h-2.5 text-cyan-400" />} testid="assets-metric-value" />
        <MetricTile label="Warranty Expiring" value={stats.warranty_expiring_soon || 0} accent="amber" icon={<AlertTriangle className="w-2.5 h-2.5 text-amber-400" />} testid="assets-metric-expiring" />
        <MetricTile label="Warranty Expired" value={stats.warranty_expired || 0} accent="rose" icon={<Calendar className="w-2.5 h-2.5 text-rose-400" />} testid="assets-metric-expired" />
      </MetricStrip>

      <Tabs defaultValue="all">
        <TabsList><TabsTrigger value="all">All Assets</TabsTrigger><TabsTrigger value="expiring">Warranty Expiring</TabsTrigger></TabsList>
        <TabsContent value="all" className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search assets..." value={search} onChange={e => setSearch(e.target.value)} data-testid="asset-search" /></div>
            <Select value={filterType} onValueChange={setFilterType}><SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Types</SelectItem>{ASSET_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent></Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}><SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="retired">Retired</SelectItem><SelectItem value="in_repair">In Repair</SelectItem></SelectContent></Select>
          </div>
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="cursor-pointer" onClick={() => toggleSort("name")}><div className="flex items-center gap-1">Asset <ArrowUpDown className="w-3 h-3" /></div></TableHead>
                <TableHead>Type</TableHead><TableHead>Client</TableHead><TableHead>Serial #</TableHead>
                <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("cost")}><div className="flex items-center gap-1 justify-end">Cost <ArrowUpDown className="w-3 h-3" /></div></TableHead>
                <TableHead>Warranty</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No assets found</TableCell></TableRow>
                : filtered.map(a => {
                  const TypeIcon = ASSET_ICONS[a.asset_type] || Monitor;
                  return (
                    <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => { setViewAsset(a); navigate(`/assets/${a.id}`); }} data-testid={`asset-row-${a.id}`}>
                      <TableCell><div className="flex items-center gap-2"><TypeIcon className="w-4 h-4 text-muted-foreground" /><span className="font-medium">{a.name}</span></div></TableCell>
                      <TableCell><Badge variant="outline" className="capitalize text-xs">{a.asset_type}</Badge></TableCell>
                      <TableCell className="text-sm">{a.client_name}</TableCell>
                      <TableCell className="font-mono text-xs">{a.serial_number || "-"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">${(a.cost || 0).toFixed(2)}</TableCell>
                      <TableCell>{getWarrantyBadge(a)}</TableCell>
                      <TableCell><Badge variant={a.status === "active" ? "default" : "secondary"} className="capitalize text-[10px]">{a.status}</Badge></TableCell>
                      <TableCell><div className="flex gap-1" onClick={e => e.stopPropagation()}><Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(a)} aria-label={`Edit ${a.name}`} title={`Edit ${a.name}`} data-testid={`edit-asset-${a.id}`}><Edit className="w-3 h-3" /></Button><Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => setPendingDelete(a)} aria-label={`Delete ${a.name}`} title={`Delete ${a.name}`} data-testid={`delete-asset-${a.id}`}><Trash2 className="w-3 h-3" /></Button></div></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="expiring">
          {expiring.length === 0 ? <Card><CardContent className="py-12 text-center text-muted-foreground"><Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />No assets with upcoming warranty expiration</CardContent></Card> : (
            <div className="space-y-2">
              {expiring.map(a => (
                <Card key={a.id} className={`cursor-pointer hover:border-primary/50 transition-colors ${a.is_expired ? "border-red-500/30" : "border-yellow-500/30"}`} onClick={() => setViewAsset(a)}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${a.is_expired ? "bg-red-500" : "bg-yellow-500"}`} />
                      <div><p className="font-medium">{a.name}</p><p className="text-xs text-muted-foreground">{a.client_name} - {a.serial_number || "No S/N"}</p></div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${a.is_expired ? "text-red-500" : "text-yellow-500"}`}>{a.is_expired ? `Expired ${Math.abs(a.days_remaining)}d ago` : `${a.days_remaining}d remaining`}</p>
                      <p className="text-xs text-muted-foreground">{a.warranty_expiry}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {formDialog}
      {deleteDialog}
      </div>
    </PageShell>
  );
}
