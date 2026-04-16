import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  DollarSign, AlertTriangle, CheckCircle, Calculator, RefreshCw,
  Loader2, Clock, Shield, TrendingDown, FileText, CreditCard,
  BarChart3, XCircle, ChevronRight, Zap
} from "lucide-react";

export default function SlaPenaltiesPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [calculating, setCalculating] = useState(null);
  const [selectedPenalty, setSelectedPenalty] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [d, c] = await Promise.all([
        axios.get(`${API}/sla-penalties/dashboard`, { headers }),
        axios.get(`${API}/contracts`, { headers }),
      ]);
      setData(d.data);
      setContracts(c.data.filter(ct => ct.status === "active"));
    } catch { toast.error("Failed to load SLA data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const calculatePenalty = async (contractId) => {
    setCalculating(contractId);
    try {
      const { data: result } = await axios.post(`${API}/sla-penalties/calculate/${contractId}`, {}, { headers });
      toast.success(result.breaches > 0 ? `Penalty calculated: $${result.amount}` : "No breaches detected for this contract");
      fetchData();
    } catch { toast.error("Calculation failed"); }
    finally { setCalculating(null); }
  };

  const issueCredit = async (penaltyId) => {
    try {
      await axios.post(`${API}/sla-penalties/${penaltyId}/issue-credit`, {}, { headers });
      toast.success("Credit note issued successfully");
      fetchData();
    } catch { toast.error("Failed to issue credit"); }
  };

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const s = data.stats;
  const pendingPenalties = data.penalties.filter(p => p.status === "pending");
  const issuedPenalties = data.penalties.filter(p => p.status === "issued");

  return (
    <div className="space-y-5" data-testid="sla-penalties-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center"><Calculator className="w-5 h-5 text-white" /></div>
            SLA Penalty Calculator
          </h1>
          <p className="text-muted-foreground mt-1">Auto-calculate penalties when SLAs are breached, issue client credits</p>
        </div>
        <Button variant="outline" onClick={fetchData} data-testid="refresh-penalties"><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total Breaches", value: s.total_breaches, icon: AlertTriangle, color: "text-red-400" },
          { label: "Total Penalties", value: `$${s.total_penalties.toLocaleString()}`, icon: DollarSign, color: "text-red-400" },
          { label: "Pending Credits", value: `$${s.pending_credits.toLocaleString()}`, icon: Clock, color: "text-amber-400" },
          { label: "Issued Credits", value: `$${s.issued_credits.toLocaleString()}`, icon: CheckCircle, color: "text-emerald-400" },
          { label: "Contracts Affected", value: s.contracts_affected || 0, icon: FileText, color: "text-blue-400" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Penalty Health Bar */}
      {s.total_penalties > 0 && (
        <Card className="border-border/40">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">Credit Resolution Progress</span>
              <span className="text-sm font-bold text-emerald-400">{s.total_penalties > 0 ? Math.round((s.issued_credits / s.total_penalties) * 100) : 0}% resolved</span>
            </div>
            <Progress value={s.total_penalties > 0 ? (s.issued_credits / s.total_penalties) * 100 : 0} className="h-3" />
            <div className="flex justify-between mt-2 text-xs text-muted-foreground">
              <span>Issued: ${s.issued_credits.toLocaleString()}</span>
              <span>Pending: ${s.pending_credits.toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dashboard">Calculate</TabsTrigger>
          <TabsTrigger value="pending">Pending ({pendingPenalties.length})</TabsTrigger>
          <TabsTrigger value="history">Credit History ({issuedPenalties.length})</TabsTrigger>
          <TabsTrigger value="breaches">Recent Breaches</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <Card className="border-border/40">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Calculator className="w-4 h-4 text-blue-400" />Active Contracts — Calculate Penalties</CardTitle></CardHeader>
            <CardContent>
              {contracts.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No active contracts found</p>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Contract</TableHead><TableHead>Client</TableHead><TableHead className="text-right">Value</TableHead><TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {contracts.map(c => (
                      <TableRow key={c.id} data-testid={`contract-calc-${c.id}`}>
                        <TableCell className="font-semibold">{c.name}</TableCell>
                        <TableCell>{c.client_name}</TableCell>
                        <TableCell className="text-right font-mono">${c.value?.toLocaleString()}/mo</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => calculatePenalty(c.id)} disabled={calculating === c.id} data-testid={`calc-btn-${c.id}`}>
                            {calculating === c.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Calculator className="w-3 h-3 mr-1" />}
                            Calculate
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pending" className="mt-4 space-y-3">
          {pendingPenalties.length === 0 ? (
            <Card className="border-emerald-500/30"><CardContent className="py-12 text-center"><CheckCircle className="w-12 h-12 mx-auto text-emerald-400/30 mb-3" /><p className="text-emerald-400 font-semibold">No pending credits</p></CardContent></Card>
          ) : pendingPenalties.map(p => (
            <Card key={p.id} className="border-amber-500/30 bg-amber-500/5 hover:shadow-md transition-all cursor-pointer" onClick={() => setSelectedPenalty(p)} data-testid={`penalty-${p.id}`}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center"><DollarSign className="w-5 h-5 text-amber-400" /></div>
                  <div className="flex-1">
                    <p className="font-semibold">{p.contract_name}</p>
                    <p className="text-xs text-muted-foreground">{p.client_name} — {p.breaches} breach{p.breaches !== 1 ? "es" : ""} detected</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-black text-red-400">${p.amount.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">penalty</p>
                  </div>
                  <Button size="sm" onClick={e => { e.stopPropagation(); issueCredit(p.id); }} data-testid={`issue-credit-${p.id}`}>
                    <CreditCard className="w-3 h-3 mr-1" />Issue Credit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card className="border-border/40">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-400" />Issued Credits</CardTitle></CardHeader>
            <CardContent>
              {issuedPenalties.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No credits issued yet</p>
              ) : (
                <div className="space-y-2">
                  {issuedPenalties.map(p => (
                    <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border border-emerald-500/10 bg-emerald-500/5">
                      <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{p.contract_name}</p>
                        <p className="text-xs text-muted-foreground">{p.client_name} — {p.breaches} breaches — Issued by {p.issued_by || "System"}</p>
                      </div>
                      <span className="font-mono font-bold text-emerald-400">${p.amount.toLocaleString()}</span>
                      {p.issued_at && <span className="text-[10px] text-muted-foreground">{new Date(p.issued_at).toLocaleDateString()}</span>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="breaches" className="mt-4">
          <Card className="border-border/40">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-400" />Recent SLA Breaches ({data.recent_breaches?.length || 0})</CardTitle></CardHeader>
            <CardContent>
              {(!data.recent_breaches || data.recent_breaches.length === 0) ? (
                <p className="text-center py-8 text-muted-foreground">No breaches recorded</p>
              ) : (
                <ScrollArea className="h-80">
                  <div className="space-y-2">
                    {data.recent_breaches.map((b, i) => (
                      <div key={b.id || i} className="flex items-center gap-3 p-3 rounded-lg border border-red-500/10 bg-red-500/5">
                        <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{b.ticket_title || `Breach #${i + 1}`}</p>
                          <p className="text-xs text-muted-foreground">{b.client_name || "Unknown"} — {b.breach_type || "SLA exceeded"}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] capitalize">{b.severity || "medium"}</Badge>
                        {b.breached_at && <span className="text-[10px] text-muted-foreground">{new Date(b.breached_at).toLocaleString()}</span>}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Penalty Detail Dialog */}
      <Dialog open={!!selectedPenalty} onOpenChange={() => setSelectedPenalty(null)}>
        <DialogContent className="max-w-md" aria-describedby="penalty-detail-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Calculator className="w-5 h-5 text-red-400" />Penalty Detail</DialogTitle>
            <DialogDescription id="penalty-detail-desc">SLA penalty breakdown</DialogDescription>
          </DialogHeader>
          {selectedPenalty && (
            <div className="space-y-4">
              <div className="text-center p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-3xl font-black text-red-400">${selectedPenalty.amount.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">calculated penalty</p>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground text-xs">Contract</span><p className="font-medium">{selectedPenalty.contract_name}</p></div>
                <div><span className="text-muted-foreground text-xs">Client</span><p className="font-medium">{selectedPenalty.client_name}</p></div>
                <div><span className="text-muted-foreground text-xs">Breaches</span><p className="font-medium">{selectedPenalty.breaches}</p></div>
                <div><span className="text-muted-foreground text-xs">Status</span><Badge variant={selectedPenalty.status === "issued" ? "default" : "secondary"} className="capitalize">{selectedPenalty.status}</Badge></div>
                <div><span className="text-muted-foreground text-xs">Contract Value</span><p className="font-medium">${selectedPenalty.contract_value?.toLocaleString()}/mo</p></div>
                <div><span className="text-muted-foreground text-xs">Calculated By</span><p className="font-medium">{selectedPenalty.calculated_by || "System"}</p></div>
              </div>
              {selectedPenalty.status === "pending" && (
                <>
                  <Separator />
                  <Button className="w-full" onClick={() => { issueCredit(selectedPenalty.id); setSelectedPenalty(null); }}>
                    <CreditCard className="w-4 h-4 mr-2" />Issue Credit Note
                  </Button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
