import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Layers, DollarSign, AlertTriangle, TrendingUp, Search, Plus, RefreshCw,
  Loader2, BarChart3, Users, ChevronDown, ChevronUp, Lightbulb, Trash2,
  Edit, Calendar, Shield, Package, Check, X, ArrowUpRight, ArrowDownRight
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

const COLORS = ["#3B82F6", "#22C55E", "#EAB308", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316", "#14B8A6", "#6366F1"];
const chartStyle = { backgroundColor: "hsl(217, 33%, 17%)", border: "1px solid hsl(217, 33%, 25%)", borderRadius: "8px", color: "hsl(210, 40%, 98%)" };

export default function LicenseManagementPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("overview");
  const [addDialog, setAddDialog] = useState(false);
  const [editLic, setEditLic] = useState(null);
  const [form, setForm] = useState({ product_name: "", vendor: "", client_name: "", purchased: 10, used: 0, unit_cost: 15, renewal_date: "", auto_renew: true, billing_cycle: "monthly", license_type: "per_user" });
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const r = await axios.get(`${API}/license-management/overview`, { headers }); setData(r.data); }
    catch { toast.error("Failed to load license data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    try {
      if (editLic) {
        await axios.put(`${API}/license-management/licenses/${editLic.id}`, form, { headers });
        toast.success("License updated");
      } else {
        await axios.post(`${API}/license-management/licenses`, form, { headers });
        toast.success("License added");
      }
      setAddDialog(false); setEditLic(null); fetchData();
    } catch { toast.error("Failed to save"); }
  };

  const handleDelete = async (id) => {
    try { await axios.delete(`${API}/license-management/licenses/${id}`, { headers }); toast.success("Deleted"); fetchData(); }
    catch { toast.error("Failed"); }
  };

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const { summary, licenses, vendor_breakdown, client_breakdown, expiring_soon, optimization_suggestions } = data;
  const vendors = [...new Set(licenses.map(l => l.vendor))].sort();
  const clients = [...new Set(licenses.map(l => l.client_name))].sort();

  const filtered = licenses.filter(l => {
    if (vendorFilter !== "all" && l.vendor !== vendorFilter) return false;
    if (clientFilter !== "all" && l.client_name !== clientFilter) return false;
    if (search && !l.product_name.toLowerCase().includes(search.toLowerCase()) && !l.client_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const vendorChartData = vendor_breakdown.slice(0, 8).map(v => ({ name: v.vendor, value: v.total_cost }));

  return (
    <div className="space-y-5" data-testid="license-management-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-500 flex items-center justify-center"><Layers className="w-5 h-5 text-white" /></div>
            License Management
          </h1>
          <p className="text-muted-foreground mt-1">Track, optimize, and manage software licenses across all clients</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={() => { setEditLic(null); setForm({ product_name: "", vendor: "", client_name: "", purchased: 10, used: 0, unit_cost: 15, renewal_date: "", auto_renew: true, billing_cycle: "monthly", license_type: "per_user" }); setAddDialog(true); }} data-testid="add-license-btn"><Plus className="w-4 h-4 mr-1" />Add License</Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-6 gap-3">
        {[
          { label: "Total Licenses", value: summary.total_licenses, icon: Layers, color: "text-blue-400" },
          { label: "Utilization", value: `${summary.utilization_pct}%`, icon: BarChart3, color: summary.utilization_pct >= 80 ? "text-emerald-400" : "text-amber-400", sub: <Progress value={summary.utilization_pct} className="mt-1.5 h-1.5" /> },
          { label: "Monthly Cost", value: `$${summary.total_monthly_cost.toLocaleString()}`, icon: DollarSign, color: "text-emerald-400" },
          { label: "Annual Cost", value: `$${summary.total_annual_cost.toLocaleString()}`, icon: TrendingUp, color: "text-cyan-400" },
          { label: "Unused Seats", value: summary.wasted_licenses, icon: AlertTriangle, color: "text-amber-400" },
          { label: "Wasted/month", value: `$${summary.wasted_cost_monthly.toLocaleString()}`, icon: X, color: "text-red-400" },
        ].map(kpi => (
          <Card key={kpi.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</p><kpi.icon className={`w-4 h-4 ${kpi.color}`} /></div>
              <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
              {kpi.sub}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Optimization Suggestions */}
      {optimization_suggestions?.length > 0 && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-2"><Lightbulb className="w-4 h-4 text-amber-400" /><span className="text-sm font-bold text-amber-400">Cost Optimization Suggestions</span></div>
            <div className="grid grid-cols-3 gap-3">
              {optimization_suggestions.map((s, i) => (
                <div key={i} className="p-3 rounded-lg bg-background/50 border border-border/30">
                  <p className="text-sm font-medium">{s.message}</p>
                  <div className="flex items-center justify-between mt-2">
                    <Badge className={s.priority === "high" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}>{s.priority}</Badge>
                    <span className="text-sm font-bold text-emerald-400">Save ${s.savings.toLocaleString()}/mo</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="overview" data-testid="lic-tab-overview"><BarChart3 className="w-3 h-3 mr-1" />Overview</TabsTrigger>
          <TabsTrigger value="all" data-testid="lic-tab-all"><Layers className="w-3 h-3 mr-1" />All Licenses ({licenses.length})</TabsTrigger>
          <TabsTrigger value="by-vendor" data-testid="lic-tab-vendor"><Package className="w-3 h-3 mr-1" />By Vendor</TabsTrigger>
          <TabsTrigger value="by-client" data-testid="lic-tab-client"><Users className="w-3 h-3 mr-1" />By Client</TabsTrigger>
          <TabsTrigger value="expiring" data-testid="lic-tab-expiring"><Calendar className="w-3 h-3 mr-1" />Expiring ({expiring_soon.length})</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Cost by Vendor</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]"><ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={vendorChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2} dataKey="value">
                    {vendorChartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie><Tooltip contentStyle={chartStyle} formatter={(v) => `$${v.toLocaleString()}/mo`} /></PieChart>
                </ResponsiveContainer></div>
                <div className="flex flex-wrap gap-2 mt-2 justify-center">
                  {vendorChartData.map((v, i) => <span key={v.name} className="flex items-center gap-1 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{v.name}</span>)}
                </div>
              </CardContent>
            </Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Client Utilization</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]"><ResponsiveContainer width="100%" height="100%">
                  <BarChart data={client_breakdown.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={10} />
                    <YAxis dataKey="client" type="category" width={100} stroke="hsl(var(--muted-foreground))" fontSize={10} />
                    <Tooltip contentStyle={chartStyle} formatter={(v) => `${v}%`} />
                    <Bar dataKey="utilization" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer></div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ALL LICENSES */}
        <TabsContent value="all" className="space-y-4">
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-xs"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
            <Select value={vendorFilter} onValueChange={setVendorFilter}><SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Vendors</SelectItem>{vendors.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select>
            <Select value={clientFilter} onValueChange={setClientFilter}><SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Clients</SelectItem>{clients.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
          </div>
          <Card><CardContent className="p-0"><ScrollArea className="h-[500px]"><Table>
            <TableHeader><TableRow>
              <TableHead>Product</TableHead><TableHead>Client</TableHead><TableHead>Vendor</TableHead><TableHead>Type</TableHead>
              <TableHead className="text-center">Used / Purchased</TableHead><TableHead>Utilization</TableHead>
              <TableHead className="text-right">Monthly Cost</TableHead><TableHead>Renewal</TableHead><TableHead>Auto</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map(l => {
                const util = l.purchased > 0 ? Math.round(l.used / l.purchased * 100) : 0;
                const isExpiring = l.renewal_date && l.renewal_date <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
                return (
                  <TableRow key={l.id} data-testid={`license-${l.id}`} className={isExpiring ? "bg-amber-500/5" : ""}>
                    <TableCell className="font-medium text-sm">{l.product_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.client_name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{l.vendor}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] capitalize">{l.license_type?.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-center">
                      <span className="font-mono text-sm">{l.used} / {l.purchased}</span>
                      {l.available > 3 && <span className="text-amber-500 text-[10px] ml-1">({l.available} unused)</span>}
                    </TableCell>
                    <TableCell>
                      <div className="w-20"><Progress value={util} className={`h-1.5 ${util < 50 ? "[&>div]:bg-red-500" : util < 75 ? "[&>div]:bg-amber-500" : ""}`} /><span className="text-[10px] text-muted-foreground">{util}%</span></div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">${l.monthly_cost.toLocaleString()}</TableCell>
                    <TableCell className={`text-xs ${isExpiring ? "text-amber-400 font-bold" : "text-muted-foreground"}`}>{l.renewal_date}{isExpiring && " !"}</TableCell>
                    <TableCell>{l.auto_renew ? <Check className="w-4 h-4 text-emerald-400" /> : <X className="w-4 h-4 text-muted-foreground/30" />}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditLic(l); setForm({ ...l }); setAddDialog(true); }}><Edit className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400" onClick={() => handleDelete(l.id)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table></ScrollArea></CardContent></Card>
        </TabsContent>

        {/* BY VENDOR */}
        <TabsContent value="by-vendor" className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            {vendor_breakdown.map(v => {
              const util = v.total_seats > 0 ? Math.round(v.used_seats / v.total_seats * 100) : 0;
              return (
                <Card key={v.vendor} className="border-border/40">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center"><Package className="w-5 h-5 text-blue-400" /></div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2"><h3 className="font-bold">{v.vendor}</h3><Badge variant="outline" className="text-[10px]">{v.licenses} licenses</Badge></div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          <span>{v.used_seats}/{v.total_seats} seats</span>
                          <span className="font-mono">${v.total_cost.toLocaleString()}/mo</span>
                        </div>
                      </div>
                      <div className="w-24 text-right">
                        <Progress value={util} className="h-2" />
                        <span className={`text-xs font-bold ${util >= 80 ? "text-emerald-400" : util >= 50 ? "text-amber-400" : "text-red-400"}`}>{util}%</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* BY CLIENT */}
        <TabsContent value="by-client" className="space-y-4">
          <Card><CardContent className="p-0"><Table>
            <TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-center">Licenses</TableHead><TableHead className="text-center">Seats Used</TableHead><TableHead>Utilization</TableHead><TableHead className="text-right">Monthly Cost</TableHead><TableHead className="text-right text-amber-400">Waste</TableHead></TableRow></TableHeader>
            <TableBody>
              {client_breakdown.map(c => (
                <TableRow key={c.client}>
                  <TableCell className="font-medium">{c.client}</TableCell>
                  <TableCell className="text-center font-mono">{c.licenses}</TableCell>
                  <TableCell className="text-center font-mono">{c.used_seats}/{c.total_seats}</TableCell>
                  <TableCell><div className="flex items-center gap-2"><Progress value={c.utilization} className="h-2 w-20" /><span className="text-xs font-mono">{c.utilization}%</span></div></TableCell>
                  <TableCell className="text-right font-mono">${c.total_cost.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-amber-400">${c.wasted_cost.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></CardContent></Card>
        </TabsContent>

        {/* EXPIRING */}
        <TabsContent value="expiring" className="space-y-4">
          {expiring_soon.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><Calendar className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" /><p className="font-semibold">No licenses expiring in the next 30 days</p></CardContent></Card>
          ) : (
            <Card><CardContent className="p-0"><Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Client</TableHead><TableHead>Vendor</TableHead><TableHead>Renewal Date</TableHead><TableHead>Auto-Renew</TableHead><TableHead className="text-right">Monthly Cost</TableHead></TableRow></TableHeader>
              <TableBody>
                {expiring_soon.map(l => (
                  <TableRow key={l.id} className="bg-amber-500/5">
                    <TableCell className="font-medium">{l.product_name}</TableCell>
                    <TableCell>{l.client_name}</TableCell>
                    <TableCell><Badge variant="outline">{l.vendor}</Badge></TableCell>
                    <TableCell className="font-bold text-amber-400">{l.renewal_date}</TableCell>
                    <TableCell>{l.auto_renew ? <Badge className="bg-emerald-500/20 text-emerald-400">Yes</Badge> : <Badge className="bg-red-500/20 text-red-400">No</Badge>}</TableCell>
                    <TableCell className="text-right font-mono">${l.monthly_cost.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></CardContent></Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Add/Edit Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="max-w-lg" aria-describedby="lic-dialog-desc">
          <DialogHeader>
            <DialogTitle>{editLic ? "Edit License" : "Add License"}</DialogTitle>
            <DialogDescription id="lic-dialog-desc">{editLic ? "Update license details" : "Add a new software license to track"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Product Name *</Label><Input value={form.product_name} onChange={e => setForm({ ...form, product_name: e.target.value })} placeholder="Microsoft 365 Business" /></div>
              <div><Label className="text-xs">Vendor *</Label><Input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} placeholder="Microsoft" /></div>
            </div>
            <div><Label className="text-xs">Client *</Label><Input value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} placeholder="Acme Corp" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Purchased Seats</Label><Input type="number" value={form.purchased} onChange={e => setForm({ ...form, purchased: parseInt(e.target.value) || 0 })} /></div>
              <div><Label className="text-xs">Used Seats</Label><Input type="number" value={form.used} onChange={e => setForm({ ...form, used: parseInt(e.target.value) || 0 })} /></div>
              <div><Label className="text-xs">Unit Cost ($)</Label><Input type="number" step="0.01" value={form.unit_cost} onChange={e => setForm({ ...form, unit_cost: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Renewal Date</Label><Input type="date" value={form.renewal_date} onChange={e => setForm({ ...form, renewal_date: e.target.value })} /></div>
              <div><Label className="text-xs">Billing Cycle</Label>
                <Select value={form.billing_cycle} onValueChange={v => setForm({ ...form, billing_cycle: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="annual">Annual</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">License Type</Label>
                <Select value={form.license_type} onValueChange={v => setForm({ ...form, license_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="per_user">Per User</SelectItem><SelectItem value="per_device">Per Device</SelectItem><SelectItem value="site">Site</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2"><Switch checked={form.auto_renew} onCheckedChange={v => setForm({ ...form, auto_renew: v })} /><Label className="text-xs">Auto-Renew</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} data-testid="save-license-btn">{editLic ? "Update" : "Add License"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
