import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Plus, Search, ClipboardCheck, ArrowLeft,
  CheckCircle, AlertTriangle, Scan, RefreshCw,
  TrendingDown, TrendingUp, DollarSign, ChevronRight,
  History, Trash2
} from "lucide-react";
import { format } from "date-fns";
import { MetricStrip, MetricTile } from "@/components/design-system";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { WorkspaceLoadingState } from "@/components/WorkspaceState";

const STATUS_COLORS = {
  in_progress: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
};

export default function StocktakePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("sessions");
  const [newDialog, setNewDialog] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", description: "", location: "All Locations", category_filter: "" });
  const [viewSession, setViewSession] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [countSearch, setCountSearch] = useState("");
  const [scannerInput, setScannerInput] = useState("");
  const [finalizeDialog, setFinalizeDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const scanRef = useRef(null);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchData = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [sesRes, repRes] = await Promise.all([
        axios.get(`${API}/stocktake/sessions`, { headers }),
        axios.get(`${API}/stocktake/reports/summary`, { headers }),
      ]);
      setSessions(sesRes.data);
      setReport(repRes.data);
    } catch { toast.error(quiet ? "Stocktake could not refresh. The current view has been kept." : "Failed to load stocktake data"); }
    finally { if (quiet) setRefreshing(false); else setLoading(false); }
  }, [headers]);

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
    if (!newForm.name.trim()) { toast.error("Give this stocktake a session name"); return; }
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
    const safeQty = Math.max(0, Number.isFinite(Number(qty)) ? Math.floor(Number(qty)) : 0);
    try {
      await axios.put(`${API}/stocktake/sessions/${viewSession.id}/count`, {
        product_id: item.product_id, counted_qty: safeQty, product_name: item.product_name
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
      setFinalizeDialog(false);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to finalize"); }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/stocktake/sessions/${id}`, { headers });
      toast.success("Session deleted");
      if (viewSession?.id === id) setViewSession(null);
      fetchData();
      setDeleteTarget(null);
    } catch { toast.error("Failed to delete"); }
  };

  if (loading) return <WorkspaceLoadingState label="Loading stocktake" />;

  const finalizeConfirmation = (
    <AlertDialog open={finalizeDialog} onOpenChange={setFinalizeDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Finalize this stocktake?</AlertDialogTitle>
          <AlertDialogDescription>
            This will apply the counted quantities as inventory adjustments. Uncounted products keep their existing stock level.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Counting</AlertDialogCancel>
          <AlertDialogAction className="bg-green-600 text-white hover:bg-green-700" onClick={handleFinalize} data-testid="confirm-finalize-stocktake">Finalize & Apply Adjustments</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const deleteConfirmation = (
    <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => !open && setDeleteTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {deleteTarget?.session_number}?</AlertDialogTitle>
          <AlertDialogDescription>This removes the in-progress count and its audit trail. Completed stocktakes remain as inventory history.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Session</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteTarget && handleDelete(deleteTarget.id)} data-testid="confirm-delete-stocktake">Delete Session</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

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
        <OperationalPageHeader
          eyebrow="Inventory assurance · count session"
          title={s.name || s.session_number}
          description={`${s.session_number} · ${s.location || "All locations"}. Count each included product, review variances, then apply a traceable stock adjustment.`}
          icon={ClipboardCheck}
          tone="amber"
          showBack={false}
          actions={<>
            <Badge className={STATUS_COLORS[s.status]}>{s.status === "in_progress" ? "In Progress" : "Completed"}</Badge>
            <Button variant="outline" size="sm" onClick={() => setViewSession(null)} data-testid="back-to-stocktake">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />All stocktakes
            </Button>
            {s.status === "in_progress" && (
              <Button onClick={() => setFinalizeDialog(true)} data-testid="finalize-stocktake">
                <CheckCircle className="mr-1.5 h-4 w-4" />Review & finalize
              </Button>
            )}
          </>}
        />

        <MetricStrip columns={5}>
          <MetricTile label="Count progress" value={`${progressPct}%`} icon={<ClipboardCheck className="h-3.5 w-3.5" />} accent="cyan" />
          <MetricTile label="Counted items" value={`${s.counted_items} / ${s.total_items}`} icon={<CheckCircle className="h-3.5 w-3.5" />} accent="emerald" />
          <MetricTile label="Variances" value={s.variance_count || 0} icon={<AlertTriangle className="h-3.5 w-3.5" />} accent={s.variance_count > 0 ? "amber" : "emerald"} />
          <MetricTile label="Stock loss" value={`$${(s.stock_loss_value || 0).toFixed(2)}`} icon={<TrendingDown className="h-3.5 w-3.5" />} accent="rose" />
          <MetricTile label="Stock gain" value={`$${(s.stock_gain_value || 0).toFixed(2)}`} icon={<TrendingUp className="h-3.5 w-3.5" />} accent="emerald" />
        </MetricStrip>

        {/* Barcode Scanner Strip */}
        {s.status === "in_progress" && (
          <Card className="overflow-hidden rounded-2xl border-cyan-400/25 bg-cyan-400/[0.045] shadow-[0_18px_45px_-36px_rgba(34,211,238,0.45)]">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/[0.10]">
                <Scan className="w-5 h-5 text-cyan-400 animate-pulse" />
              </div>
              <form onSubmit={handleScannerSubmit} className="flex flex-1 gap-2">
                <Input ref={scanRef} value={scannerInput} onChange={e => setScannerInput(e.target.value)}
                  placeholder="Scan barcode or type SKU... (auto-increments count)" className="border-cyan-400/20 bg-background/65 font-mono"
                  data-testid="stocktake-scanner-input" autoFocus />
                <Button type="submit" className="shrink-0 rounded-xl" data-testid="stocktake-scan-btn">Scan</Button>
              </form>
              <p className="text-xs text-muted-foreground flex-shrink-0">Bluetooth / USB scanner ready</p>
            </CardContent>
          </Card>
        )}

        {/* Search + Actions */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card/55 p-3 shadow-[0_16px_36px_-34px_rgba(0,0,0,0.9)]">
          <div className="relative min-w-[min(100%,18rem)] flex-1 max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="border-border/70 bg-background/65 pl-9" placeholder="Search products, SKU, or barcode…" value={countSearch} onChange={e => setCountSearch(e.target.value)} />
          </div>
          <Badge variant="outline" className="rounded-full border-border/70">{pendingItems.length} pending</Badge>
          <Badge variant="outline" className="rounded-full border-emerald-400/25 bg-emerald-400/[0.05] text-emerald-300">{countedItems.length} counted</Badge>
          {varianceItems.length > 0 && <Badge variant="outline" className="rounded-full border-amber-400/25 bg-amber-400/[0.05] text-amber-300">{varianceItems.length} variances</Badge>}
        </div>

        {/* Items Table */}
        <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]">
          <CardContent className="p-0">
            <div className="overflow-x-auto"><Table>
              <TableHeader className="bg-muted/45">
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
                              value={item.counted_qty ?? ""}
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
            </Table></div>
          </CardContent>
        </Card>

        {/* Audit Log */}
        {auditLog.length > 0 && (
          <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]">
            <CardHeader className="border-b border-border/60 bg-gradient-to-r from-muted/50 to-transparent pb-3"><CardTitle className="text-sm flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/[0.08]"><History className="h-4 w-4 text-violet-300" /></span>Audit trail ({auditLog.length})</CardTitle></CardHeader>
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
        {finalizeConfirmation}{deleteConfirmation}
      </div>
    );
  }

  // ========== MAIN VIEW ==========
  return (
    <div className="space-y-6" data-testid="stocktake-page">
      <OperationalPageHeader
        eyebrow="Products & stock · inventory assurance"
        title="Stocktake"
        description="Count stock against the shared product catalogue, review variance before it changes on-hand quantity, and keep the complete count trail with the session."
        icon={ClipboardCheck}
        tone="amber"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => navigate("/products")}>
            <ChevronRight className="mr-1.5 h-3.5 w-3.5" />Product catalogue
          </Button>
          <Button variant="outline" size="sm" onClick={() => fetchData({ quiet: true })} disabled={refreshing}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button onClick={() => setNewDialog(true)} data-testid="new-stocktake-btn"><Plus className="mr-1.5 h-4 w-4" />New stocktake</Button>
        </>}
      />

      {report && (
        <MetricStrip columns={5}>
          <MetricTile label="Sessions" value={report.total_sessions || 0} icon={<ClipboardCheck className="h-3.5 w-3.5" />} accent="cyan" />
          <MetricTile label="Stock at cost" value={`$${(report.stock_in_hand_cost || 0).toLocaleString()}`} icon={<DollarSign className="h-3.5 w-3.5" />} accent="emerald" />
          <MetricTile label="Stock at retail" value={`$${(report.stock_in_hand_retail || 0).toLocaleString()}`} icon={<DollarSign className="h-3.5 w-3.5" />} accent="sky" />
          <MetricTile label="Recorded loss" value={`$${(report.total_stock_loss || 0).toLocaleString()}`} icon={<TrendingDown className="h-3.5 w-3.5" />} accent="rose" />
          <MetricTile label="Recorded gain" value={`$${(report.total_stock_gain || 0).toLocaleString()}`} icon={<TrendingUp className="h-3.5 w-3.5" />} accent="emerald" />
        </MetricStrip>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="sessions" data-testid="tab-stocktake-sessions">Sessions</TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-stocktake-reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          {/* Sessions List */}
          <div className="space-y-3 mt-4">
            {sessions.length === 0 ? (
              <Card className="border-dashed"><CardContent className="py-12 text-center">
                <ClipboardCheck className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-30" />
                <p className="text-muted-foreground mb-3">No stocktake sessions yet</p>
                <Button onClick={() => setNewDialog(true)}><Plus className="w-4 h-4 mr-1" />Start first stocktake</Button>
              </CardContent></Card>
            ) : sessions.map(s => {
              const pct = s.total_items > 0 ? Math.round((s.counted_items / s.total_items) * 100) : 0;
              return (
                <Card key={s.id} role="button" tabIndex={0} className="cursor-pointer overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-[0_16px_36px_-34px_rgba(0,0,0,0.9)] transition-all hover:-translate-y-0.5 hover:border-amber-400/35 hover:shadow-[0_22px_42px_-34px_rgba(245,158,11,0.42)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60" onClick={() => fetchSession(s.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fetchSession(s.id); } }} data-testid={`stocktake-session-${s.id}`}>
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
                        {s.status === "in_progress" && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" title="Delete in-progress stocktake" onClick={() => setDeleteTarget(s)}><Trash2 className="w-3 h-3" /></Button>}
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
        <NexusWorkflowDialog
          eyebrow="Inventory assurance"
          title="Start a stocktake"
          description="Choose the scope before counting. Nexus snapshots the included catalogue items, then preserves every count and variance as reviewable inventory evidence."
          icon={ClipboardCheck}
          tone="amber"
          className="max-w-2xl"
          footer={<>
            <Button variant="outline" onClick={() => setNewDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateSession} data-testid="start-stocktake-btn"><ClipboardCheck className="mr-1.5 h-4 w-4" />Start stocktake</Button>
          </>}
        >
          <div className="space-y-5">
            <section className="rounded-2xl border border-border/65 bg-card/45 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">01 · Count scope</p>
              <p className="mt-1 text-sm font-semibold">Name the evidence set</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">The name and location make the resulting audit trail clear to the technician who reviews it later.</p>
              <div className="mt-4 space-y-4">
                <div><Label>Session name</Label><Input value={newForm.name} onChange={e => setNewForm({ ...newForm, name: e.target.value })} placeholder="e.g. Monthly Warehouse Count" data-testid="stocktake-name-input" /></div>
                <div><Label>Purpose or handover note <span className="text-muted-foreground">(optional)</span></Label><Textarea value={newForm.description} onChange={e => setNewForm({ ...newForm, description: e.target.value })} placeholder="What is being counted, and why?" rows={3} /></div>
              </div>
            </section>
            <section className="rounded-2xl border border-border/65 bg-card/45 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">02 · Inventory boundary</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div><Label>Location</Label><Input value={newForm.location} onChange={e => setNewForm({ ...newForm, location: e.target.value })} placeholder="All Locations" /></div>
                <div><Label>Category <span className="text-muted-foreground">(optional)</span></Label>
                  <Select value={newForm.category_filter || "all"} onValueChange={v => setNewForm({ ...newForm, category_filter: v === "all" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="All categories" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {["Hardware", "Software", "Licensing", "Services", "Accessories", "Networking", "Security", "Cloud"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-amber-400/15 bg-amber-400/[0.05] p-3 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">No stock changes yet.</strong> Starting this session only establishes its count list. Stock changes require an explicit review and finalisation step.</div>
            </section>
          </div>
        </NexusWorkflowDialog>
      </Dialog>
      {deleteConfirmation}
    </div>
  );
}
