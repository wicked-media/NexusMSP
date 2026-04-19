import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Plus, Search, Loader2, Monitor, HardDrive, Laptop, Server, Wifi,
  AlertTriangle, Shield, DollarSign, Edit, Trash2, ArrowLeft, Calendar,
  Building, Tag, MapPin, ArrowUpDown
} from "lucide-react";
import { format, formatDistanceToNow, isPast, parseISO, differenceInDays } from "date-fns";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";

const ASSET_TYPES = ["hardware", "software", "license", "peripheral", "network", "server", "mobile", "other"];
const ASSET_ICONS = { hardware: Laptop, software: HardDrive, license: Tag, peripheral: Wifi, network: Wifi, server: Server, mobile: Monitor, other: Monitor };

export default function AssetsPage() {
  const { token } = useAuth();
  const [assets, setAssets] = useState([]);
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState({});
  const [expiring, setExpiring] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewAsset, setViewAsset] = useState(null);
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [form, setForm] = useState({
    name: "", client_id: "", asset_type: "hardware", manufacturer: "", model: "",
    serial_number: "", purchase_date: "", warranty_expiry: "", cost: "",
    status: "active", location: "", assigned_to: "", depreciation_rate: "", notes: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [assetsRes, clientsRes, statsRes, expiringRes] = await Promise.all([
        axios.get(`${API}/assets`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/assets/stats`, { headers }),
        axios.get(`${API}/assets/expiring`, { headers }),
      ]);
      setAssets(assetsRes.data);
      setClients(clientsRes.data);
      setStats(statsRes.data);
      setExpiring(expiringRes.data);
    } catch { toast.error("Failed to load assets"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => setForm({
    name: "", client_id: "", asset_type: "hardware", manufacturer: "", model: "",
    serial_number: "", purchase_date: "", warranty_expiry: "", cost: "",
    status: "active", location: "", assigned_to: "", depreciation_rate: "", notes: ""
  });

  const openCreate = () => { setEditing(null); resetForm(); setIsFormOpen(true); };
  const openEdit = (a) => {
    setEditing(a);
    setForm({
      name: a.name, client_id: a.client_id, asset_type: a.asset_type || "hardware",
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
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{editing ? "Edit Asset" : "Add Asset"}</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Dell OptiPlex 7090" data-testid="asset-name" /></div>
            <div><Label>Client *</Label><Select value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}><SelectTrigger data-testid="asset-client"><SelectValue placeholder="Select client" /></SelectTrigger><SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
          </div>
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
        <DialogFooter><Button onClick={handleSave} data-testid="save-asset-btn">{editing ? "Update" : "Create"} Asset</Button></DialogFooter>
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
      <div className="space-y-6" data-testid="asset-detail">
        <Button variant="ghost" size="sm" onClick={() => setViewAsset(null)} data-testid="back-to-assets"><ArrowLeft className="w-4 h-4 mr-1" />Back to Assets</Button>
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-8 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center"><TypeIcon className="w-6 h-6 text-primary" /></div>
                    <div><CardTitle className="text-2xl">{a.name}</CardTitle><p className="text-sm text-muted-foreground">{a.manufacturer} {a.model}</p></div>
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
              <div className="flex justify-between"><span className="text-muted-foreground">Location</span><span className="font-medium">{a.location || "N/A"}</span></div><Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Assigned To</span><span className="font-medium">{a.assigned_to || "Unassigned"}</span></div><Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Depreciation</span><span className="font-medium">{a.depreciation_rate || 0}% /yr</span></div>
            </CardContent></Card>
            <div className="flex flex-col gap-2">
              <Button onClick={() => openEdit(a)} className="w-full" data-testid="edit-asset-btn"><Edit className="w-4 h-4 mr-1" />Edit Asset</Button>
              <Button variant="destructive" onClick={() => handleDelete(a.id)} className="w-full"><Trash2 className="w-4 h-4 mr-1" />Delete</Button>
            </div>
          </div>
        </div>
        {formDialog}
      </div>
    );
  }

  return (
    <PageShell data-testid="assets-page">
      <MetricStrip columns={5}>
        <MetricTile label="Total Assets" value={stats.total || 0} accent="sky" icon={<HardDrive className="w-2.5 h-2.5 text-sky-400" />} testid="assets-metric-total" />
        <MetricTile label="Active" value={stats.active || 0} accent="emerald" icon={<Shield className="w-2.5 h-2.5 text-emerald-400" />} testid="assets-metric-active" />
        <MetricTile label="Total Value" value={`$${(stats.total_value || 0).toLocaleString(undefined, {minimumFractionDigits: 0})}`} accent="cyan" icon={<DollarSign className="w-2.5 h-2.5 text-cyan-400" />} testid="assets-metric-value" />
        <MetricTile label="Warranty Expiring" value={stats.warranty_expiring_soon || 0} accent="amber" icon={<AlertTriangle className="w-2.5 h-2.5 text-amber-400" />} testid="assets-metric-expiring" />
        <MetricTile label="Warranty Expired" value={stats.warranty_expired || 0} accent="rose" icon={<Calendar className="w-2.5 h-2.5 text-rose-400" />} testid="assets-metric-expired" />
      </MetricStrip>
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Assets</h1><p className="text-xs text-zinc-500 mt-0.5">{assets.length} tracked assets</p></div>
        <Button onClick={openCreate} data-testid="add-asset-btn"><Plus className="w-4 h-4 mr-1" />Add Asset</Button>
      </div>

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
                    <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setViewAsset(a)} data-testid={`asset-row-${a.id}`}>
                      <TableCell><div className="flex items-center gap-2"><TypeIcon className="w-4 h-4 text-muted-foreground" /><span className="font-medium">{a.name}</span></div></TableCell>
                      <TableCell><Badge variant="outline" className="capitalize text-xs">{a.asset_type}</Badge></TableCell>
                      <TableCell className="text-sm">{a.client_name}</TableCell>
                      <TableCell className="font-mono text-xs">{a.serial_number || "-"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">${(a.cost || 0).toFixed(2)}</TableCell>
                      <TableCell>{getWarrantyBadge(a)}</TableCell>
                      <TableCell><Badge variant={a.status === "active" ? "default" : "secondary"} className="capitalize text-[10px]">{a.status}</Badge></TableCell>
                      <TableCell><div className="flex gap-1" onClick={e => e.stopPropagation()}><Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(a)}><Edit className="w-3 h-3" /></Button><Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(a.id)}><Trash2 className="w-3 h-3" /></Button></div></TableCell>
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
      </div>
    </PageShell>
  );
}
