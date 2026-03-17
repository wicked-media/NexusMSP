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
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Plus, Search, Package, ArrowRight, Loader2, RefreshCw, Trash2,
  ShoppingCart, Truck, CheckCircle, Wrench, Archive, AlertTriangle,
  DollarSign, Calendar, History, ChevronRight
} from "lucide-react";

const stageConfig = {
  procurement: { label: "Procurement", icon: ShoppingCart, color: "bg-blue-500", text: "text-blue-400", bg: "bg-blue-500/10" },
  deployment: { label: "Deployment", icon: Truck, color: "bg-purple-500", text: "text-purple-400", bg: "bg-purple-500/10" },
  active: { label: "Active", icon: CheckCircle, color: "bg-emerald-500", text: "text-emerald-400", bg: "bg-emerald-500/10" },
  maintenance: { label: "Maintenance", icon: Wrench, color: "bg-amber-500", text: "text-amber-400", bg: "bg-amber-500/10" },
  decommission: { label: "Decommission", icon: AlertTriangle, color: "bg-orange-500", text: "text-orange-400", bg: "bg-orange-500/10" },
  disposed: { label: "Disposed", icon: Archive, color: "bg-slate-500", text: "text-slate-400", bg: "bg-slate-500/10" },
};

export default function AssetLifecyclePage() {
  const { token } = useAuth();
  const [assets, setAssets] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [isTransitionOpen, setIsTransitionOpen] = useState(false);
  const [transitionForm, setTransitionForm] = useState({ new_stage: "", notes: "" });
  const [form, setForm] = useState({
    name: "", asset_type: "hardware", category: "computer", manufacturer: "",
    model: "", serial_number: "", client_id: "", location: "",
    purchase_cost: 0, purchase_date: "", vendor: "", warranty_start: "",
    warranty_end: "", expected_lifespan_months: 36, notes: "",
  });
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [aRes, dRes, cRes] = await Promise.all([
        axios.get(`${API}/asset-lifecycle`, { headers }),
        axios.get(`${API}/asset-lifecycle/dashboard`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setAssets(aRes.data);
      setDashboard(dRes.data);
      setClients(cRes.data);
    } catch { toast.error("Failed to fetch data"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    if (!form.name) { toast.error("Name is required"); return; }
    try {
      await axios.post(`${API}/asset-lifecycle`, { ...form, purchase_cost: parseFloat(form.purchase_cost) || 0 }, { headers });
      toast.success("Asset created");
      setIsCreateOpen(false);
      setForm({ name: "", asset_type: "hardware", category: "computer", manufacturer: "", model: "", serial_number: "", client_id: "", location: "", purchase_cost: 0, purchase_date: "", vendor: "", warranty_start: "", warranty_end: "", expected_lifespan_months: 36, notes: "" });
      fetchData();
    } catch { toast.error("Failed to create asset"); }
  };

  const handleTransition = async () => {
    if (!selectedAsset || !transitionForm.new_stage) return;
    try {
      await axios.post(`${API}/asset-lifecycle/${selectedAsset.id}/transition`, transitionForm, { headers });
      toast.success(`Asset moved to ${transitionForm.new_stage}`);
      setIsTransitionOpen(false);
      setSelectedAsset(null);
      fetchData();
    } catch { toast.error("Failed to transition"); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this asset?")) return;
    try {
      await axios.delete(`${API}/asset-lifecycle/${id}`, { headers });
      toast.success("Asset deleted");
      if (selectedAsset?.id === id) setSelectedAsset(null);
      fetchData();
    } catch { toast.error("Failed to delete"); }
  };

  const filteredAssets = assets.filter(a => {
    const matchSearch = a.name?.toLowerCase().includes(searchQuery.toLowerCase()) || a.serial_number?.toLowerCase().includes(searchQuery.toLowerCase()) || a.asset_tag?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchStage = stageFilter === "all" || a.lifecycle_stage === stageFilter;
    return matchSearch && matchStage;
  });

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  if (selectedAsset) {
    const sc = stageConfig[selectedAsset.lifecycle_stage] || stageConfig.active;
    const StageIcon = sc.icon;
    return (
      <div className="space-y-6" data-testid="asset-detail-view">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => setSelectedAsset(null)}>Back</Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{selectedAsset.name}</h1>
            <p className="text-muted-foreground font-mono text-sm">{selectedAsset.asset_tag}</p>
          </div>
          <Badge className={`${sc.bg} ${sc.text} border ${sc.color.replace("bg-", "border-")}/30`}><StageIcon className="w-3 h-3 mr-1" />{sc.label}</Badge>
          <Button size="sm" onClick={() => { setTransitionForm({ new_stage: "", notes: "" }); setIsTransitionOpen(true); }} data-testid="transition-btn">
            <ArrowRight className="w-4 h-4 mr-1" />Transition Stage
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Asset Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="capitalize">{selectedAsset.asset_type}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span className="capitalize">{selectedAsset.category}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Manufacturer</span><span>{selectedAsset.manufacturer || "-"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Model</span><span>{selectedAsset.model || "-"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Serial</span><span className="font-mono">{selectedAsset.serial_number || "-"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Client</span><span>{selectedAsset.client_name || "-"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Location</span><span>{selectedAsset.location || "-"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Purchase Cost</span><span className="font-mono">${selectedAsset.purchase_cost?.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Purchase Date</span><span>{selectedAsset.purchase_date || "-"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Vendor</span><span>{selectedAsset.vendor || "-"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Warranty End</span><span>{selectedAsset.warranty_end || "-"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Lifespan</span><span>{selectedAsset.expected_lifespan_months}mo</span></div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><History className="w-4 h-4" />Lifecycle History</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-[350px]">
                {(selectedAsset.history || []).map((h, i) => {
                  const hsc = stageConfig[h.stage] || stageConfig.active;
                  return (
                    <div key={h.id || i} className="flex gap-3 items-start border-l-2 border-muted pl-3 pb-4">
                      <div className={`w-8 h-8 rounded-lg ${hsc.bg} flex items-center justify-center flex-shrink-0`}>
                        <hsc.icon className={`w-4 h-4 ${hsc.text}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium capitalize">{h.action?.replace("_", " ")}</span>
                          <Badge variant="outline" className="text-[10px]">{hsc.label}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{h.notes}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{h.user_name} &middot; {h.timestamp ? new Date(h.timestamp).toLocaleString() : ""}</p>
                      </div>
                    </div>
                  );
                })}
                {(!selectedAsset.history || selectedAsset.history.length === 0) && (
                  <p className="text-center py-8 text-muted-foreground text-sm">No history</p>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Lifecycle Stage Visual */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2">
              {Object.entries(stageConfig).map(([key, cfg], i) => {
                const isActive = selectedAsset.lifecycle_stage === key;
                const isPast = Object.keys(stageConfig).indexOf(selectedAsset.lifecycle_stage) > i;
                const Icon = cfg.icon;
                return (
                  <div key={key} className="flex items-center flex-1">
                    <div className={`flex flex-col items-center gap-1 flex-shrink-0 cursor-pointer transition-all ${isActive ? "scale-110" : ""}`}
                      onClick={() => { setTransitionForm({ new_stage: key, notes: "" }); setIsTransitionOpen(true); }}>
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isActive ? `${cfg.bg} ring-2 ring-offset-2 ring-offset-background ${cfg.color.replace("bg-", "ring-")}` : isPast ? "bg-emerald-500/10" : "bg-muted/30"}`}>
                        <Icon className={`w-5 h-5 ${isActive ? cfg.text : isPast ? "text-emerald-400" : "text-muted-foreground/40"}`} />
                      </div>
                      <span className={`text-[9px] font-medium ${isActive ? cfg.text : isPast ? "text-emerald-400" : "text-muted-foreground/40"}`}>{cfg.label}</span>
                    </div>
                    {i < Object.keys(stageConfig).length - 1 && <div className={`h-0.5 flex-1 mx-1 rounded-full ${isPast || isActive ? "bg-emerald-500/50" : "bg-muted/30"}`} />}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Transition Dialog */}
        <Dialog open={isTransitionOpen} onOpenChange={setIsTransitionOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Transition Asset Stage</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>New Stage</Label>
                <Select value={transitionForm.new_stage} onValueChange={v => setTransitionForm({ ...transitionForm, new_stage: v })}>
                  <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(stageConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={transitionForm.notes} onChange={e => setTransitionForm({ ...transitionForm, notes: e.target.value })} placeholder="Reason for transition..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsTransitionOpen(false)}>Cancel</Button>
              <Button onClick={handleTransition} disabled={!transitionForm.new_stage} data-testid="confirm-transition-btn">Confirm Transition</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="asset-lifecycle-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Asset Lifecycle</h1>
          <p className="text-muted-foreground">Track IT assets from procurement to disposal</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
          <Button onClick={() => setIsCreateOpen(true)} data-testid="create-asset-btn"><Plus className="w-4 h-4 mr-2" />Add Asset</Button>
        </div>
      </div>

      {/* Dashboard Stats */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {Object.entries(stageConfig).map(([key, cfg]) => {
            const Icon = cfg.icon;
            return (
              <Card key={key} className={`cursor-pointer hover:${cfg.color.replace("bg-", "border-")}/40 transition-colors`} onClick={() => setStageFilter(key)}>
                <CardContent className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center`}><Icon className={`w-4 h-4 ${cfg.text}`} /></div>
                    <div>
                      <p className={`text-xl font-bold ${cfg.text}`}>{dashboard.by_stage[key] || 0}</p>
                      <p className="text-[10px] text-muted-foreground">{cfg.label}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          <Card>
            <CardContent className="py-3 px-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><DollarSign className="w-4 h-4 text-primary" /></div>
                <div>
                  <p className="text-lg font-bold">${(dashboard.total_investment || 0).toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">Total Value</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search assets..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {Object.entries(stageConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Assets Table */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset Tag</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead>
                  <TableHead>Client</TableHead><TableHead>Stage</TableHead><TableHead>Cost</TableHead>
                  <TableHead>Warranty</TableHead><TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssets.map(asset => {
                  const sc = stageConfig[asset.lifecycle_stage] || stageConfig.active;
                  return (
                    <TableRow key={asset.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedAsset(asset)}>
                      <TableCell className="font-mono text-xs">{asset.asset_tag}</TableCell>
                      <TableCell><div><p className="font-medium text-sm">{asset.name}</p><p className="text-xs text-muted-foreground">{asset.manufacturer} {asset.model}</p></div></TableCell>
                      <TableCell className="capitalize text-sm">{asset.asset_type}</TableCell>
                      <TableCell className="text-sm">{asset.client_name || "-"}</TableCell>
                      <TableCell><Badge className={`${sc.bg} ${sc.text} text-[10px]`}>{sc.label}</Badge></TableCell>
                      <TableCell className="font-mono text-sm">${(asset.purchase_cost || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{asset.warranty_end || "-"}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); handleDelete(asset.id); }}><Trash2 className="w-3 h-3" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
          {filteredAssets.length === 0 && (
            <div className="py-12 text-center"><Package className="w-12 h-12 mx-auto text-muted-foreground opacity-30 mb-3" /><p className="text-muted-foreground">No assets found</p></div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Add Asset to Lifecycle</DialogTitle></DialogHeader>
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Dell OptiPlex 7090" data-testid="asset-name" /></div>
              <div className="space-y-2"><Label>Asset Type</Label>
                <Select value={form.asset_type} onValueChange={v => setForm({ ...form, asset_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="hardware">Hardware</SelectItem><SelectItem value="software">Software</SelectItem><SelectItem value="peripheral">Peripheral</SelectItem><SelectItem value="network">Network</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Manufacturer</Label><Input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} placeholder="Dell" /></div>
              <div className="space-y-2"><Label>Model</Label><Input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="OptiPlex 7090" /></div>
              <div className="space-y-2"><Label>Serial Number</Label><Input value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} placeholder="SN-XXXXX" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Client</Label>
                <Select value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Location</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Main Office" /></div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Purchase Cost ($)</Label><Input type="number" value={form.purchase_cost} onChange={e => setForm({ ...form, purchase_cost: e.target.value })} /></div>
              <div className="space-y-2"><Label>Purchase Date</Label><Input type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} /></div>
              <div className="space-y-2"><Label>Vendor</Label><Input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} placeholder="Dell Direct" /></div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Warranty Start</Label><Input type="date" value={form.warranty_start} onChange={e => setForm({ ...form, warranty_start: e.target.value })} /></div>
              <div className="space-y-2"><Label>Warranty End</Label><Input type="date" value={form.warranty_end} onChange={e => setForm({ ...form, warranty_end: e.target.value })} /></div>
              <div className="space-y-2"><Label>Expected Lifespan (mo)</Label><Input type="number" value={form.expected_lifespan_months} onChange={e => setForm({ ...form, expected_lifespan_months: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Additional notes..." /></div>
          </div>
          <DialogFooter><Button onClick={handleCreate} data-testid="create-asset-submit"><Plus className="w-4 h-4 mr-1" />Create Asset</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
