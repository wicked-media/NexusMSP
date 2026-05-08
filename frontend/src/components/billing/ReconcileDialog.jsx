import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle, Link2, Unlink, DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/App";

/**
 * Reconciliation dialog: compares billed quantities to actual device counts
 * under each linked Acronis policy. Highlights bill-shock drift.
 */
export default function ReconcileDialog({ open, onOpenChange, recurringInvoice, token, onUpdated }) {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [policies, setPolicies] = useState([]);
  const [linkingIdx, setLinkingIdx] = useState(null);

  const fetchReconcile = async () => {
    if (!recurringInvoice?.id) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API}/billing/reconcile-recurring/${recurringInvoice.id}`, { headers });
      setData(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Reconcile failed"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (open && recurringInvoice?.id) {
      fetchReconcile();
      axios.get(`${API}/acronis/policies`, { headers })
        .then(r => setPolicies(r.data?.items || []))
        .catch(() => setPolicies([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recurringInvoice?.id]);

  const handleLink = async (idx, policyId) => {
    setLinkingIdx(idx);
    try {
      await axios.put(
        `${API}/billing/recurring/${recurringInvoice.id}/line-items/${idx}/link-policy`,
        { acronis_policy_id: policyId || null },
        { headers },
      );
      toast.success(policyId ? "Linked to plan" : "Unlinked");
      await fetchReconcile();
      onUpdated?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Link failed"); }
    finally { setLinkingIdx(null); }
  };

  const summary = data?.summary || {};
  const driftRows = useMemo(() => (data?.line_items || []).filter(r => r.policy_linked), [data]);
  const unlinkedRows = useMemo(() => (data?.line_items || []).filter(r => !r.policy_linked), [data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-400" />
            Bill-Shock Reconciliation
          </DialogTitle>
          <DialogDescription>
            Compares billed line item quantities to actual Acronis-protected device counts for{" "}
            <strong>{recurringInvoice?.client_name || recurringInvoice?.description || "this invoice"}</strong>.
            Link a line item to an Acronis plan to enable automatic drift detection.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : !data ? (
          <p className="text-center text-muted-foreground py-12">No data</p>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-4 gap-3">
              <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Line Items</p>
                <p className="text-2xl font-bold mt-0.5">{summary.total_line_items || 0}</p>
              </div>
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                <p className="text-[10px] uppercase tracking-widest text-cyan-300">Plan-Linked</p>
                <p className="text-2xl font-bold text-cyan-300 mt-0.5">{summary.policy_linked || 0}</p>
              </div>
              <div className={`rounded-lg border p-3 ${summary.drift_count > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/20 bg-emerald-500/5"}`}>
                <p className={`text-[10px] uppercase tracking-widest ${summary.drift_count > 0 ? "text-amber-300" : "text-emerald-300"}`}>Drift Detected</p>
                <p className={`text-2xl font-bold mt-0.5 ${summary.drift_count > 0 ? "text-amber-300" : "text-emerald-300"}`}>{summary.drift_count || 0}</p>
              </div>
              <div className={`rounded-lg border p-3 ${Math.abs(summary.bill_shock_amount || 0) > 100 ? "border-rose-500/30 bg-rose-500/5" : "border-border/50 bg-muted/20"}`}>
                <p className={`text-[10px] uppercase tracking-widest ${Math.abs(summary.bill_shock_amount || 0) > 100 ? "text-rose-300" : "text-muted-foreground"}`}>Bill Shock</p>
                <p className={`text-2xl font-bold mt-0.5 font-mono ${Math.abs(summary.bill_shock_amount || 0) > 100 ? "text-rose-300" : ""}`}>
                  {summary.bill_shock_amount > 0 ? "+" : ""}{summary.bill_shock_amount || 0}
                </p>
                <p className="text-[10px] text-muted-foreground">{summary.currency || "AUD"}/period</p>
              </div>
            </div>

            <ScrollArea className="max-h-[420px] mt-3 border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line Item</TableHead>
                    <TableHead className="w-[200px]">Acronis Plan</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Drift</TableHead>
                    <TableHead className="text-right">Bill Shock</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.line_items || []).map((row, i) => {
                    const driftPositive = row.drift > 0;
                    const driftZero = row.drift === 0;
                    const sevColor =
                      row.drift_severity === "critical" ? "text-rose-300 bg-rose-500/15" :
                      row.drift_severity === "warning" ? "text-amber-300 bg-amber-500/15" :
                      row.drift_severity === "minor" ? "text-yellow-300 bg-yellow-500/10" :
                      driftZero ? "text-emerald-300 bg-emerald-500/10" :
                      "text-muted-foreground bg-muted/10";
                    return (
                      <TableRow key={`k-${i}`} data-testid={`reconcile-row-${i}`}>
                        <TableCell className="text-sm font-medium">{row.description}</TableCell>
                        <TableCell>
                          <Select
                            value={row.policy_id || "__none"}
                            onValueChange={v => handleLink(i, v === "__none" ? null : v)}
                            disabled={linkingIdx === i}
                          >
                            <SelectTrigger className="h-7 text-xs" data-testid={`reconcile-policy-${i}`}>
                              <SelectValue placeholder="Link to plan..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none">— Not linked —</SelectItem>
                              {policies.map(p => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{row.quantity_billed}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {row.actual_count === null
                            ? <span className="text-muted-foreground">-</span>
                            : <span className={row.actual_count !== row.quantity_billed ? "text-amber-300 font-bold" : "text-emerald-300"}>{row.actual_count}</span>
                          }
                        </TableCell>
                        <TableCell className="text-right">
                          {row.drift === null ? (
                            <span className="text-muted-foreground text-xs">-</span>
                          ) : (
                            <Badge variant="outline" className={`text-[10px] font-mono ${sevColor}`}>
                              {driftZero ? <CheckCircle className="w-2.5 h-2.5 mr-1 inline" /> :
                                driftPositive ? <TrendingUp className="w-2.5 h-2.5 mr-1 inline" /> :
                                <TrendingDown className="w-2.5 h-2.5 mr-1 inline" />}
                              {driftPositive ? "+" : ""}{row.drift}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {row.bill_shock_amount !== 0 ? (
                            <span className={row.bill_shock_amount > 0 ? "text-rose-300" : "text-emerald-300"}>
                              {row.bill_shock_amount > 0 ? "+" : ""}{row.bill_shock_amount}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.policy_linked && (
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleLink(i, null)} title="Unlink">
                              <Unlink className="w-3 h-3 text-muted-foreground" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>

            {summary.drift_count > 0 && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span><strong>{summary.drift_count}</strong> line item(s) drift from actual device count.
                  {summary.bill_shock_amount > 0 && <> You're <strong>under-billing</strong> by {summary.currency} {summary.bill_shock_amount}/period.</>}
                  {summary.bill_shock_amount < 0 && <> You're <strong>over-billing</strong> by {summary.currency} {Math.abs(summary.bill_shock_amount)}/period.</>}
                </span>
              </div>
            )}

            {summary.policy_linked === 0 && (
              <div className="rounded-md bg-muted/30 border border-border/50 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                <Link2 className="w-3.5 h-3.5" />
                Link line items to Acronis plans (dropdown above) to enable automatic drift detection.
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={fetchReconcile} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />Re-scan
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
