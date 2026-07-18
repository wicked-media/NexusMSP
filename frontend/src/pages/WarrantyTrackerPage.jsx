import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Shield, Plus, Trash2, AlertTriangle, CheckCircle, Clock, Loader2, RefreshCw, Calendar, DollarSign, Search } from "lucide-react";

export default function WarrantyTrackerPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [warranties, setWarranties] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ device_name: "", client_name: "", vendor: "", product_name: "", serial_number: "", warranty_type: "manufacturer", warranty_start: "", warranty_end: "", coverage_value: "", coverage_details: "" });

  const fetchData = useCallback(async () => {
    try {
      const [wRes, sRes] = await Promise.all([
        axios.get(`${API}/warranties`, { headers }),
        axios.get(`${API}/warranties/stats`, { headers }),
      ]);
      setWarranties(wRes.data);
      setStats(sRes.data);
    } catch { toast.error("Failed to load warranties"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const createWarranty = async () => {
    if (!form.device_name || !form.warranty_end) { toast.error("Device and expiry date required"); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/warranties`, { ...form, coverage_value: parseFloat(form.coverage_value) || 0, product_name: form.product_name || form.device_name }, { headers });
      toast.success("Warranty added");
      setShowCreate(false);
      fetchData();
    } catch { toast.error("Failed"); }
    finally { setSaving(false); }
  };

  const deleteWarranty = async (id) => {
    if (!window.confirm("Delete?")) return;
    try { await axios.delete(`${API}/warranties/${id}`, { headers }); toast.success("Deleted"); fetchData(); } catch { toast.error("Failed"); }
  };

  const now = new Date().toISOString().split("T")[0];
  const getExpiryStatus = (d) => { const exp = d || ""; if (!exp) return "unknown"; if (exp < now) return "expired"; const diff = Math.ceil((new Date(exp) - new Date()) / 86400000); if (diff <= 30) return "expiring_soon"; if (diff <= 90) return "expiring"; return "active"; };
  const statusStyle = (s) => s === "expired" ? "bg-red-500/10 text-red-400 border-red-500/20" : s === "expiring_soon" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : s === "expiring" ? "bg-orange-500/10 text-orange-400 border-orange-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  const daysUntil = (d) => { const exp = d || ""; if (!exp) return ""; const diff = Math.ceil((new Date(exp) - new Date()) / 86400000); return diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? "Today" : `${diff}d`; };
  const getExpiry = (w) => w.expiry_date || w.warranty_end || "";

  const filtered = warranties.filter(w => {
    const exp = getExpiry(w);
    const es = getExpiryStatus(exp);
    if (filterStatus === "active" && es === "expired") return false;
    if (filterStatus === "expired" && es !== "expired") return false;
    if (filterStatus === "expiring" && !["expiring_soon", "expiring"].includes(es)) return false;
    if (search && !w.device_name?.toLowerCase().includes(search.toLowerCase()) && !w.client_name?.toLowerCase().includes(search.toLowerCase()) && !w.serial_number?.toLowerCase().includes(search.toLowerCase()) && !(w.product_name || "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="warranty-tracker-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Shield className="w-6 h-6 text-blue-400" />Warranty Tracker</h1><p className="text-muted-foreground mt-1">Track device warranties, expiry dates, and coverage</p></div>
        <Button onClick={() => setShowCreate(true)} data-testid="add-warranty-btn"><Plus className="w-4 h-4 mr-1" />Add Warranty</Button>
      </div>

      {stats && (
        <div className="grid grid-cols-6 gap-3">
          {[
            { label: "Total", value: stats.total, icon: Shield, color: "text-blue-400", bg: "bg-blue-500/10" },
            { label: "Active", value: stats.active, icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10" },
            { label: "Expired", value: stats.expired, icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10" },
            { label: "Expiring 30d", value: stats.expiring_30_days, icon: Clock, color: stats.expiring_30_days > 0 ? "text-amber-400" : "text-zinc-400", bg: stats.expiring_30_days > 0 ? "bg-amber-500/10" : "bg-zinc-500/10" },
            { label: "Expiring 90d", value: stats.expiring_90_days, icon: Calendar, color: "text-orange-400", bg: "bg-orange-500/10" },
            { label: "Coverage Value", value: `$${stats.total_coverage_value?.toLocaleString()}`, icon: DollarSign, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          ].map((s, i) => (
            <Card key={`s-${i}`}><CardContent className="p-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon className={`w-4 h-4 ${s.color}`} /></div>
              <div><p className="text-lg font-bold">{s.value}</p><p className="text-[9px] text-muted-foreground uppercase tracking-wider">{s.label}</p></div>
            </CardContent></Card>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search device, client, serial..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="expiring">Expiring</SelectItem><SelectItem value="expired">Expired</SelectItem></SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead>Vendor</TableHead><TableHead>Serial</TableHead><TableHead>Type</TableHead><TableHead>Expiry</TableHead><TableHead>Remaining</TableHead><TableHead>Coverage</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 && <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">No warranties found</TableCell></TableRow>}
              {filtered.map(w => {
                const exp = getExpiry(w);
                const es = getExpiryStatus(exp);
                return (
                  <TableRow key={w.id} className={es === "expired" ? "opacity-60" : es === "expiring_soon" ? "bg-amber-500/5" : ""}>
                    <TableCell className="font-medium">{w.device_name || w.product_name}</TableCell>
                    <TableCell className="text-xs">{w.client_name}</TableCell>
                    <TableCell className="text-xs">{w.vendor}</TableCell>
                    <TableCell className="font-mono text-xs">{w.serial_number}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px] capitalize">{w.warranty_type}</Badge></TableCell>
                    <TableCell className="text-xs">{exp}</TableCell>
                    <TableCell className={`text-xs font-bold ${es === "expired" ? "text-red-400" : es === "expiring_soon" ? "text-amber-400" : "text-emerald-400"}`}>{daysUntil(exp)}</TableCell>
                    <TableCell className="font-mono text-xs">${(w.coverage_value || 0)?.toLocaleString()}</TableCell>
                    <TableCell><Badge className={`${statusStyle(es)} text-[9px] border capitalize`}>{es.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell><Button size="sm" variant="ghost" className="text-red-400" onClick={() => deleteWarranty(w.id)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md" aria-describedby="add-warranty-desc">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-blue-400" />Add Warranty</DialogTitle><DialogDescription id="add-warranty-desc">Track a new device warranty</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Device Name</Label><Input value={form.device_name} onChange={e => setForm(p => ({ ...p, device_name: e.target.value }))} placeholder="ACME-DC-01" data-testid="warr-device" /></div>
              <div><Label>Product Name</Label><Input value={form.product_name} onChange={e => setForm(p => ({ ...p, product_name: e.target.value }))} placeholder="Dell PowerEdge R750" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Client</Label><Input value={form.client_name} onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))} placeholder="Acme Corp" /></div>
              <div><Label>Vendor</Label><Input value={form.vendor} onChange={e => setForm(p => ({ ...p, vendor: e.target.value }))} placeholder="Dell, HP, etc." /></div>
            </div>
            <div><Label>Serial Number</Label><Input value={form.serial_number} onChange={e => setForm(p => ({ ...p, serial_number: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start Date</Label><Input type="date" value={form.warranty_start} onChange={e => setForm(p => ({ ...p, warranty_start: e.target.value }))} /></div>
              <div><Label>Expiry Date</Label><Input type="date" value={form.warranty_end} onChange={e => setForm(p => ({ ...p, warranty_end: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Type</Label>
                <Select value={form.warranty_type} onValueChange={v => setForm(p => ({ ...p, warranty_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="manufacturer">Manufacturer</SelectItem><SelectItem value="extended">Extended</SelectItem><SelectItem value="applecare">AppleCare</SelectItem><SelectItem value="third_party">Third Party</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Coverage Value ($)</Label><Input type="number" value={form.coverage_value} onChange={e => setForm(p => ({ ...p, coverage_value: e.target.value }))} /></div>
            </div>
            <div><Label>Coverage Details</Label><Input value={form.coverage_details} onChange={e => setForm(p => ({ ...p, coverage_details: e.target.value }))} placeholder="ProSupport Plus 4-hour onsite" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createWarranty} disabled={saving} data-testid="warr-submit">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Warranty"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
