import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Plus, Search, Loader2, ClipboardCheck, BarChart3, ArrowLeft,
  CheckCircle, XCircle, AlertTriangle, Package, Scan, RefreshCw,
  TrendingDown, TrendingUp, DollarSign, Hash, ChevronRight,
  History, Trash2, Eye
} from "lucide-react";
import { format } from "date-fns";

const STATUS_COLORS = {
  in_progress: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
};

export default function StocktakePage() {
  const { token } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("sessions");
  const [newDialog, setNewDialog] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", description: "", location: "All Locations", category_filter: "" });
  const [viewSession, setViewSession] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [countSearch, setCountSearch] = useState("");
  const [scannerInput, setScannerInput] = useState("");
  const scanRef = useRef(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sesRes, repRes] = await Promise.all([
        axios.get(`${API}/stocktake/sessions`, { headers }),
        axios.get(`${API}/stocktake/reports/summary`, { headers }),
      ]);
      setSessions(sesRes.data);
      setReport(repRes.data);
    } catch { toast.error("Failed to load stocktake data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchSession = async (id) => {
    try {
      const [sRes, aRes] = await Promise.all([
        axios.get(`${API}/stocktake/sessions/${id}`, { headers }),
        axios.get(`${API}/stocktake/sessions/${id}/audit-log`, { headers }),
      ]);
      setViewSession(sRes.data);
      setAuditLog(aRes.data);
    } catch { toast.error("Failed to load session"); }
  };

  const handleCreateSession = async () => {
    try {
      const res = await axios.post(`${API}/stocktake/sessions`, newForm, { headers });
      toast.success(`Stocktake ${res.data.session_number} created with ${res.data.total_items} items`);
      setNewDialog(false);
      setNewForm({ name: "", description: "", location: "All Locations", category_filter: "" });
      fetchData();
      fetchSession(res.data.id);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to create session"); }
  };

  const handleCount = async (item, qty) => {
    if (!viewSession) return;
    try {
      await axios.put(`${API}/stocktake/sessions/${viewSession.id}/count`, {
        product_id: item.product_id, counted_qty: qty, product_name: item.product_name
      }, { headers });
      fetchSession(viewSession.id);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to update count"); }
  };

  const handleScannerSubmit = (e) => {
    e.preventDefault();
    if (!scannerInput.trim() || !viewSession) return;
    const item = viewSession.items.find(i =>
      i.barcode === scannerInput.trim() || i.sku === scannerInput.trim()
    );
    if (item) {
      const current = item.counted_qty ?? 0;
      handleCount(item, current + 1);
      toast.success(`Scanned: ${item.product_name} (now ${current + 1})`);
    } else {
      toast.error(`No product found for barcode: ${scannerInput}`);
    }
    setScannerInput("");
    scanRef.current?.focus();
  };

  const handleFinalize = async () => {
    if (!viewSession) return;
    try {
      const res = await axios.put(`${API}/stocktake/sessions/${viewSession.id}/finalize`, { apply_adjustments: true }, { headers });
      toast.success(`Stocktake finalized. ${res.data.adjustments_made} adjustments applied.`);
      fetchSession(viewSession.id);
      fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to finalize"); }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/stocktake/sessions/${id}`, { headers });
      toast.success("Session deleted");
      if (viewSession?.id === id) setViewSession(null);
      fetchData();
    } catch { toast.error("Failed to delete"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ========== SESSION DETAIL VIEW ==========
  if (viewSession) {
    const s = viewSession;
    const progressPct = s.total_items > 0 ? Math.round((s.counted_items / s.total_items) * 100) : 0;
    const filteredItems = s.items?.filter(i =>
      !countSearch || i.product_name?.toLowerCase().includes(countSearch.toLowerCase()) ||
      i.sku?.toLowerCase().includes(countSearch.toLowerCase()) ||
      i.barcode?.toLowerCase().includes(countSearch.toLowerCase())
    ) || [];
    const pendingItems = filteredItems.filter(i => i.status === "pending");
    const countedItems = filteredItems.filter(i => i.status === "counted");
    const varianceItems = filteredItems.filter(i => i.variance && i.variance !== 0);

    return (
      <div className="space-y-6" data-testid="stocktake-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setViewSession(null)} data-testid="back-to-stocktake">
            <ArrowLeft className="w-4 h-4 mr-1" />Back to Stocktakes
          </Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold">{s.session_number}</span>
          <Badge className={STATUS_COLORS[s.status]}>{s.status === "in_progress" ? "In Progress" : "Completed"}</Badge>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Progress</p>
            <p className="text-2xl font-bold">{progressPct}%</p>
            <Progress value={progressPct} className="mt-2 h-1.5" />
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Counted / Total</p>
            <p className="text-2xl font-bold">{s.counted_items} / {s.total_items}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Variances</p>
            <p className="text-2xl font-bold text-amber-400">{s.variance_count}</p>
          </CardContent></Card>
          <Card className="border-red-500/20"><CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Stock Loss</p>
            <p className="text-2xl font-bold text-red-400">${s.stock_loss_value?.toFixed(2)}</p>
          </CardContent></Card>
          <Card className="border-green-500/20"><CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Stock Gain</p>
            <p className="text-2xl font-bold text-green-400">${s.stock_gain_value?.toFixed(2)}</p>
          </CardContent></Card>
        </div>

        {/* Barcode Scanner Strip */}
        {s.status === "in_progress" && (
          <Card className="border-cyan-500/30 bg-cyan-500/5">
            <CardContent className="py-3 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                <Scan className="w-5 h-5 text-cyan-400 animate-pulse" />
              </div>
              <form onSubmit={handleScannerSubmit} className="flex-1 flex gap-2">
                <Input ref={scanRef} value={scannerInput} onChange={e => setScannerInput(e.target.value)}
                  placeholder="Scan barcode or type SKU... (auto-increments count)" className="font-mono"
                  data-testid="stocktake-scanner-input" autoFocus />
                <Button type="submit" data-testid="stocktake-scan-btn">Scan</Button>
              </form>
              <p className="text-xs text-muted-foreground flex-shrink-0">Bluetooth / USB scanner ready</p>
            </CardContent>
          </Card>
        )}

        {/* Search + Actions */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search items..." value={countSearch} onChange={e => setCountSearch(e.target.value)} />
          </div>
          <Badge variant="outline">{pendingItems.length} pending</Badge>
          <Badge variant="outline" className="text-green-400">{countedItems.length} counted</Badge>
          {varianceItems.length > 0 && <Badge variant="outline" className="text-amber-400">{varianceItems.length} variances</Badge>}
          <div className="flex-1" />
          {s.status === "in_progress" && (
            <Button onClick={handleFinalize} className="bg-green-600 hover:bg-green-700" data-testid="finalize-stocktake">
              <CheckCircle className="w-4 h-4 mr-1" />Finalize & Adjust Stock
            </Button>
          )}
        </div>

        {/* Items Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Loss/Gain ($)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Counted By</TableHead>
                  {s.status === "in_progress" && <TableHead className="text-right">Count</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map(item => {
                  const variance = item.variance ?? null;
                  const isLoss = variance !== null && variance < 0;
                  const isGain = variance !== null && variance > 0;
                  const varValue = variance !== null ? Math.abs(variance) * item.cost_price : 0;
                  return (
                    <TableRow key={item.product_id} className={isLoss ? "bg-red-500/5" : isGain ? "bg-green-500/5" : ""} data-testid={`stocktake-item-${item.product_id}`}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{item.product_name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{item.sku || item.barcode || "-"}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">{item.expected_qty}</TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        {item.counted_qty !== null ? item.counted_qty : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {variance !== null ? (
                          <span className={`font-mono font-bold ${isLoss ? "text-red-400" : isGain ? "text-green-400" : "text-muted-foreground"}`}>
                            {isGain ? "+" : ""}{variance}
                          </span>
                        ) : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {variance !== null && variance !== 0 ? (
                          <span className={`font-mono text-sm ${isLoss ? "text-red-400" : "text-green-400"}`}>
                            {isLoss ? "-" : "+"}${varValue.toFixed(2)}
                          </span>
                        ) : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${item.status === "counted" ? "text-green-400 border-green-500/30" : "text-muted-foreground"}`}>
                          {item.status === "counted" ? <CheckCircle className="w-3 h-3 mr-1" /> : null}
                          {item.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.counted_by || "-"}</TableCell>
                      {s.status === "in_progress" && (
                        <TableCell className="text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <Input type="number" min="0" className="w-20 h-8 text-sm font-mono text-right"
                              defaultValue={item.counted_qty ?? ""}
                              onBlur={e => { const v = parseInt(e.target.value); if (!isNaN(v)) handleCount(item, v); }}
                              onKeyDown={e => { if (e.key === "Enter") { const v = parseInt(e.target.value); if (!isNaN(v)) handleCount(item, v); } }}
                              data-testid={`count-input-${item.product_id}`} />
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {filteredItems.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No items match your search</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Audit Log */}
        {auditLog.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><History className="w-4 h-4" />Audit Trail ({auditLog.length})</CardTitle></CardHeader>
            <CardContent className="p-0 max-h-48 overflow-y-auto">
              <Table>
                <TableBody>
                  {auditLog.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs py-2">
                        <span className="font-medium">{l.user_name}</span> - <span className="text-muted-foreground">{l.action}</span>
                      </TableCell>
                      <TableCell className="text-xs py-2 text-muted-foreground">{l.details}</TableCell>
                      <TableCell className="text-xs py-2 text-muted-foreground whitespace-nowrap">{l.created_at ? format(new Date(l.created_at), "MMM d, HH:mm") : ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ========== MAIN VIEW ==========
  return (
    <div className="space-y-6" data-testid="stocktake-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stocktake</h1>
          <p className="text-muted-foreground">Inventory counting, variance tracking & reporting</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={() => setNewDialog(true)} data-testid="new-stocktake-btn"><Plus className="w-4 h-4 mr-1" />New Stocktake</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="sessions" data-testid="tab-stocktake-sessions">Sessions</TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-stocktake-reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          {/* Stats */}
          {report && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
              <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><ClipboardCheck className="w-5 h-5 text-blue-400" /></div><div><p className="text-xs text-muted-foreground">Total Sessions</p><p className="text-xl font-bold">{report.total_sessions}</p></div></div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-green-400" /></div><div><p className="text-xs text-muted-foreground">Stock in Hand (Cost)</p><p className="text-xl font-bold">${report.stock_in_hand_cost?.toLocaleString()}</p></div></div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-cyan-400" /></div><div><p className="text-xs text-muted-foreground">Stock in Hand (Retail)</p><p className="text-xl font-bold">${report.stock_in_hand_retail?.toLocaleString()}</p></div></div></CardContent></Card>
              <Card className="border-red-500/20"><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center"><TrendingDown className="w-5 h-5 text-red-400" /></div><div><p className="text-xs text-muted-foreground">Total Stock Loss</p><p className="text-xl font-bold text-red-400">${report.total_stock_loss?.toLocaleString()}</p></div></div></CardContent></Card>
              <Card className="border-green-500/20"><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-green-400" /></div><div><p className="text-xs text-muted-foreground">Total Stock Gain</p><p className="text-xl font-bold text-green-400">${report.total_stock_gain?.toLocaleString()}</p></div></div></CardContent></Card>
            </div>
          )}

          {/* Sessions List */}
          <div className="space-y-3 mt-4">
            {sessions.length === 0 ? (
              <Card className="border-dashed"><CardContent className="py-12 text-center">
                <ClipboardCheck className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-30" />
                <p className="text-muted-foreground mb-3">No stocktake sessions yet</p>
                <Button onClick={() => setNewDialog(true)}><Plus className="w-4 h-4 mr-1" />Start First Stocktake</Button>
              </CardContent></Card>
            ) : sessions.map(s => {
              const pct = s.total_items > 0 ? Math.round((s.counted_items / s.total_items) * 100) : 0;
              return (
                <Card key={s.id} className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => fetchSession(s.id)} data-testid={`stocktake-session-${s.id}`}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${s.status === "completed" ? "bg-green-500/10" : "bg-yellow-500/10"}`}>
                          <ClipboardCheck className={`w-5 h-5 ${s.status === "completed" ? "text-green-400" : "text-yellow-400"}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold font-mono">{s.session_number}</p>
                            <Badge className={STATUS_COLORS[s.status] + " text-xs"}>{s.status === "in_progress" ? "In Progress" : "Completed"}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{s.name} - {s.location}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 text-sm" onClick={e => e.stopPropagation()}>
                        <div className="text-center"><p className="text-xs text-muted-foreground">Items</p><p className="font-medium">{s.counted_items}/{s.total_items}</p></div>
                        <div className="w-24"><Progress value={pct} className="h-2" /><p className="text-[10px] text-muted-foreground text-center mt-1">{pct}%</p></div>
                        {s.stock_loss_value > 0 && <div className="text-center"><p className="text-xs text-muted-foreground">Loss</p><p className="font-medium text-red-400">${s.stock_loss_value?.toFixed(2)}</p></div>}
                        <p className="text-xs text-muted-foreground">{s.created_at ? format(new Date(s.created_at), "MMM d, yyyy") : ""}</p>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(s.id)}><Trash2 className="w-3 h-3" /></Button>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="reports">
          {report && (
            <div className="space-y-6 mt-4">
              {/* Inventory Overview */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Products</p><p className="text-2xl font-bold">{report.total_products}</p></CardContent></Card>
                <Card className="border-amber-500/20"><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Low Stock</p><p className="text-2xl font-bold text-amber-400">{report.low_stock_count}</p></CardContent></Card>
                <Card className="border-red-500/20"><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Out of Stock</p><p className="text-2xl font-bold text-red-400">{report.out_of_stock_count}</p></CardContent></Card>
                <Card className="border-cyan-500/20"><CardContent className="pt-4"><p className="text-xs text-muted-foreground">On Order Value</p><p className="text-2xl font-bold text-cyan-400">${report.on_order_value?.toLocaleString()}</p></CardContent></Card>
              </div>

              {/* Stock Value Summary */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Stock Value Summary</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-6">
                    <div className="p-4 rounded-lg bg-muted/30 border text-center">
                      <p className="text-xs text-muted-foreground mb-1">Stock in Hand (Cost)</p>
                      <p className="text-3xl font-bold text-green-400">${report.stock_in_hand_cost?.toLocaleString()}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/30 border text-center">
                      <p className="text-xs text-muted-foreground mb-1">Stock in Hand (Retail)</p>
                      <p className="text-3xl font-bold text-cyan-400">${report.stock_in_hand_retail?.toLocaleString()}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/30 border text-center">
                      <p className="text-xs text-muted-foreground mb-1">Net Variance (All Stocktakes)</p>
                      <p className={`text-3xl font-bold ${report.net_variance >= 0 ? "text-green-400" : "text-red-400"}`}>${report.net_variance?.toLocaleString()}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Low Stock Alerts */}
              {report.low_stock_products?.length > 0 && (
                <Card className="border-amber-500/20">
                  <CardHeader><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400" />Low Stock Products</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">In Stock</TableHead><TableHead className="text-right">Reorder Level</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {report.low_stock_products.map(p => (
                          <TableRow key={p.id}>
                            <TableCell className="font-medium">{p.name}</TableCell>
                            <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                            <TableCell className="text-right font-bold text-red-400">{p.qty}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{p.reorder}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New Session Dialog */}
      <Dialog open={newDialog} onOpenChange={setNewDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Start New Stocktake</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Session Name</Label><Input value={newForm.name} onChange={e => setNewForm({ ...newForm, name: e.target.value })} placeholder="e.g. Monthly Warehouse Count" data-testid="stocktake-name-input" /></div>
            <div><Label>Description</Label><Textarea value={newForm.description} onChange={e => setNewForm({ ...newForm, description: e.target.value })} placeholder="Notes about this stocktake..." rows={2} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Location</Label><Input value={newForm.location} onChange={e => setNewForm({ ...newForm, location: e.target.value })} placeholder="All Locations" /></div>
              <div><Label>Category Filter (optional)</Label>
                <Select value={newForm.category_filter || "all"} onValueChange={v => setNewForm({ ...newForm, category_filter: v === "all" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="All categories" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {["Hardware", "Software", "Licensing", "Services", "Accessories", "Networking", "Security", "Cloud"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreateSession} data-testid="start-stocktake-btn"><ClipboardCheck className="w-4 h-4 mr-1" />Start Stocktake</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
