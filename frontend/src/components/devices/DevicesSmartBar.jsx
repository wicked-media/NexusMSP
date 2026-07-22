import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Sparkles, BrainCircuit, Activity, RefreshCw, Loader2, ChevronRight, ShieldCheck, AlertTriangle, Wrench, History } from "lucide-react";
import MaintenanceWindowDialog, { MaintenanceWindowHistory } from "./MaintenanceWindowDialog";

const BAND = {
  excellent: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  good: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  fair: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  poor: "bg-rose-500/20 text-rose-300 border-rose-500/30",
};

export default function DevicesSmartBar({ selectedIds = [], deviceNames = {}, onReload }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [healthOpen, setHealthOpen] = useState(false);
  const [insights, setInsights] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkResults, setBulkResults] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [mwOpen, setMwOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadInsights = useCallback(async () => {
    setBusy(true);
    try {
      const r = await axios.get(`${API}/devices/fleet-insights`, { headers });
      setInsights(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Insights failed"); }
    finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (healthOpen && !insights) loadInsights(); }, [healthOpen, insights, loadInsights]);

  const runBulkDiagnose = async () => {
    if (selectedIds.length === 0) { toast.error("Select devices first"); return; }
    if (selectedIds.length > 25) { toast.error("Max 25 devices per batch"); return; }
    setBulkBusy(true);
    setBulkResults(null);
    setBulkOpen(true);
    try {
      const r = await axios.post(`${API}/devices/bulk-diagnose`, { device_ids: selectedIds }, { headers });
      setBulkResults(r.data);
      toast.success(`Diagnosed ${r.data.count} devices`);
      onReload && onReload();
    } catch (e) { toast.error(e.response?.data?.detail || "Bulk diagnose failed"); }
    finally { setBulkBusy(false); }
  };

  return (
    <>
      <Card className="bg-gradient-to-r from-violet-500/5 via-cyan-500/5 to-emerald-500/5 border-violet-500/20" data-testid="devices-smart-bar">
        <CardContent className="p-3 flex items-center flex-wrap gap-2">
          <div className="flex items-center gap-2 mr-3">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium">Fleet Smart Actions</span>
            <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-300">AI</Badge>
          </div>
          <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30" onClick={() => setHealthOpen(true)} data-testid="fleet-health-btn">
            <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Fleet Health
          </Button>
          <Button size="sm" variant="outline" className="text-fuchsia-400 border-fuchsia-500/30" onClick={runBulkDiagnose} disabled={selectedIds.length === 0 || bulkBusy} data-testid="bulk-diagnose-btn">
            <BrainCircuit className="w-3.5 h-3.5 mr-1" /> AI Diagnose ({selectedIds.length})
          </Button>
          <Button size="sm" variant="outline" className="text-amber-400 border-amber-500/30" onClick={() => setMwOpen(true)} disabled={selectedIds.length === 0} data-testid="schedule-window-btn">
            <Wrench className="w-3.5 h-3.5 mr-1" /> Schedule Window ({selectedIds.length})
          </Button>
          <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)} data-testid="window-history-btn">
            <History className="w-3.5 h-3.5 mr-1" /> Windows
          </Button>
          <div className="text-[10px] text-muted-foreground ml-2">Select devices in the table to bulk-diagnose with Nexus AI (maximum 25).</div>
        </CardContent>
      </Card>

      {/* Fleet Health dialog */}
      <Dialog open={healthOpen} onOpenChange={setHealthOpen}>
        <DialogContent className="max-w-3xl" data-testid="fleet-health-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-400" />Fleet Health</DialogTitle>
            <DialogDescription>Real-time health score across all managed devices.</DialogDescription>
          </DialogHeader>
          {busy && !insights ? <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin" /></div> :
            insights && (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 rounded bg-muted/30">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Fleet Score</div>
                    <div className="text-5xl font-light mt-1">{insights.score}<span className="text-base text-muted-foreground"> /100</span></div>
                  </div>
                  <Badge className={`text-base px-3 py-1 ${BAND[insights.band] || BAND.fair}`}>{insights.band.toUpperCase()}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(insights.counts || {}).map(([k, v]) => (
                    <Card key={k}><CardContent className="p-2 text-center">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.replace(/_/g, " ")}</div>
                      <div className="text-lg font-medium">{v}</div>
                    </CardContent></Card>
                  ))}
                </div>
                <Card className="bg-violet-500/5 border-violet-500/30">
                  <CardContent className="p-3">
                    <div className="text-[10px] uppercase tracking-wider text-violet-300 flex items-center gap-1"><Sparkles className="w-3 h-3" />AI Summary</div>
                    <pre className="text-xs mt-2 whitespace-pre-wrap font-sans">{insights.ai_summary}</pre>
                  </CardContent>
                </Card>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Top 5 risky devices</div>
                  <div className="space-y-1">
                    {(insights.top_5_risky || []).map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30">
                        <div className="font-medium">{d.name}<span className="text-muted-foreground ml-1">· {d.client}</span></div>
                        <div className="flex items-center gap-3 font-mono text-[10px]">
                          <span className="text-violet-300">CPU {d.cpu}%</span>
                          <span className="text-cyan-300">MEM {d.mem}%</span>
                          <span className="text-emerald-300">DISK {d.disk}%</span>
                          <Badge variant="outline" className="text-[9px]">{d.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setInsights(null); loadInsights(); }}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
            <Button onClick={() => setHealthOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk diagnose dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-3xl" data-testid="bulk-diagnose-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BrainCircuit className="w-5 h-5 text-fuchsia-400" />Bulk AI Diagnose</DialogTitle>
            <DialogDescription>{bulkBusy ? "Running diagnoses across selected devices in parallel…" : `${bulkResults?.count || 0} devices processed.`}</DialogDescription>
          </DialogHeader>
          {bulkBusy ? <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin" /></div> :
            bulkResults && (
              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-2">
                  {(bulkResults.results || []).map((r, i) => (
                    <Card key={i}>
                      <CardContent className="p-2.5">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-sm">{r.device_name || r.device_id}</div>
                          <Badge className={`text-[10px] ${r.severity === "critical" || r.severity === "high" ? "bg-rose-500/20 text-rose-300 border-rose-500/30" : r.severity === "medium" ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"}`}>{r.severity}</Badge>
                        </div>
                        <pre className="text-[11px] mt-1.5 whitespace-pre-wrap font-sans text-zinc-300">{r.diagnosis}</pre>
                        {(r.actions || []).length > 0 && (
                          <div className="mt-1.5 text-[10px] text-muted-foreground">
                            {r.actions.map((a, j) => <div key={j} className="flex items-center gap-1"><ChevronRight className="w-3 h-3 text-fuchsia-400" />{a}</div>)}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            )}
          <DialogFooter>
            <Button onClick={() => setBulkOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MaintenanceWindowDialog
        open={mwOpen}
        onClose={() => setMwOpen(false)}
        selectedIds={selectedIds}
        deviceNames={deviceNames}
        onScheduled={() => { onReload && onReload(); setHistoryOpen(true); }}
      />
      <MaintenanceWindowHistory open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}
