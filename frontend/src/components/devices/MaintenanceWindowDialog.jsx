import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Calendar, Clock, Wrench, Power, RefreshCw, Download, Loader2, Sparkles, History, Trash2, Play, X, ChevronRight, CheckCircle2, XCircle } from "lucide-react";

const ACTION_OPTIONS = [
  { key: "install-patches", label: "Windows Update", icon: Download, color: "emerald" },
  { key: "install-winget", label: "Approved Apps", icon: Download, color: "cyan" },
  { key: "run-checks", label: "Run Checks", icon: RefreshCw, color: "violet" },
  { key: "reboot", label: "Reboot", icon: Power, color: "amber" },
];

const STATUS_STYLES = {
  scheduled: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  running: "bg-amber-500/20 text-amber-300 border-amber-500/30 animate-pulse",
  completed: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  cancelled: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  failed: "bg-rose-500/20 text-rose-300 border-rose-500/30",
};

function presetDate(hoursFromNow) {
  const d = new Date(Date.now() + hoursFromNow * 3600000);
  // round to next 5-min mark
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM for <input type="datetime-local">
}

export default function MaintenanceWindowDialog({ open, onClose, selectedIds = [], deviceNames = {}, onScheduled }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState(presetDate(8)); // default: 8h from now
  const [actions, setActions] = useState(["install-patches"]);
  const [parentTicketId, setParentTicketId] = useState("");
  const [notifyClients, setNotifyClients] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      const d = new Date(scheduledAt + ":00");
      const dateStr = d.toLocaleDateString();
      setName((prev) => prev || `Maintenance — ${selectedIds.length} devices · ${dateStr}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleAction = (k) => {
    setActions((a) => a.includes(k) ? a.filter(x => x !== k) : [...a, k]);
  };

  const schedule = async () => {
    if (selectedIds.length === 0) { toast.error("Select at least 1 device"); return; }
    if (actions.length === 0) { toast.error("Pick at least 1 action"); return; }
    if (!scheduledAt) { toast.error("Pick a schedule time"); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API}/maintenance-windows`, {
        name: name.trim(),
        description: description.trim(),
        scheduled_at: new Date(scheduledAt + ":00").toISOString(),
        device_ids: selectedIds,
        actions,
        parent_ticket_id: parentTicketId.trim() || null,
        notify_clients: notifyClients,
      }, { headers });
      toast.success(`Window scheduled · ${r.data.id.slice(0, 8)}`);
      onScheduled && onScheduled(r.data);
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="maintenance-window-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wrench className="w-5 h-5 text-amber-400" />Schedule Maintenance Window</DialogTitle>
          <DialogDescription>Autonomous overnight maintenance — bundle N devices + N actions + a time. AI summary auto-posts to the parent ticket on completion.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Window name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Patch cycle — Sep 2026" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs flex items-center gap-1"><Calendar className="w-3 h-3" />Scheduled at</Label>
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} data-testid="mw-scheduled-at" />
              <div className="flex items-center gap-1 mt-1">
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setScheduledAt(presetDate(2))}>+2h</Button>
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setScheduledAt(presetDate(8))}>Tonight</Button>
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setScheduledAt(presetDate(24))}>+1d</Button>
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setScheduledAt(presetDate(168))}>+1wk</Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Parent ticket (optional)</Label>
              <Input value={parentTicketId} onChange={(e) => setParentTicketId(e.target.value)} placeholder="ticket id or TKT-NNN" data-testid="mw-parent-ticket" />
              <p className="text-[10px] text-muted-foreground mt-1">AI summary will be posted as a comment.</p>
            </div>
          </div>

          <div>
            <Label className="text-xs">Actions to run on each device</Label>
            <div className="grid grid-cols-4 gap-2 mt-1">
              {ACTION_OPTIONS.map(({ key, label, icon: Icon, color }) => (
                <Button key={key} variant={actions.includes(key) ? "default" : "outline"}
                  className={actions.includes(key) ? `bg-${color}-500/30 text-${color}-200 border-${color}-500/50 hover:bg-${color}-500/40` : ""}
                  onClick={() => toggleAction(key)} data-testid={`mw-action-${key}`}>
                  <Icon className="w-3.5 h-3.5 mr-1" />{label}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">Description / runbook notes</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this window covers…" />
          </div>

          <div className="flex items-center justify-between p-2 rounded bg-muted/30">
            <div className="flex items-center gap-2 text-sm">
              <input type="checkbox" id="notify-clients" checked={notifyClients} onChange={(e) => setNotifyClients(e.target.checked)} />
              <label htmlFor="notify-clients">Email clients 24h before the window</label>
            </div>
            <Badge variant="outline" className="text-[10px]">{selectedIds.length} devices</Badge>
          </div>

          {selectedIds.length > 0 && (
            <ScrollArea className="max-h-32 border border-zinc-800 rounded p-2">
              <div className="space-y-0.5">
                {selectedIds.map(id => (
                  <div key={id} className="text-[11px] text-zinc-400 flex items-center gap-1">
                    <ChevronRight className="w-3 h-3 text-zinc-600" />{deviceNames[id] || id}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={schedule} disabled={busy} data-testid="mw-schedule-btn">{busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Calendar className="w-3 h-3 mr-1" />}Schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── History Dialog ───────────────────────────
export function MaintenanceWindowHistory({ open, onClose }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/maintenance-windows`, { headers });
      setItems(r.data || []);
    } catch (e) { toast.error("Load failed"); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open]);

  const cancel = async (w) => {
    if (!window.confirm(`Cancel "${w.name}"?`)) return;
    try { await axios.delete(`${API}/maintenance-windows/${w.id}`, { headers }); toast.success("Cancelled"); load(); }
    catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const runNow = async (w) => {
    if (!window.confirm(`Run "${w.name}" right now?`)) return;
    try { await axios.post(`${API}/maintenance-windows/${w.id}/run-now`, {}, { headers }); toast.success("Triggered"); setTimeout(load, 800); }
    catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const openDetail = async (w) => {
    try { const r = await axios.get(`${API}/maintenance-windows/${w.id}`, { headers }); setDetail(r.data); }
    catch (e) { toast.error("Failed to load detail"); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-4xl" data-testid="maintenance-history-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><History className="w-5 h-5 text-amber-400" />Maintenance Windows</DialogTitle>
            <DialogDescription>Scheduled, running and completed windows. AI summary appears once each window completes.</DialogDescription>
          </DialogHeader>
          {loading ? <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin" /></div> :
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-2">
                {items.length === 0 ? <p className="text-xs text-muted-foreground text-center py-6">No maintenance windows yet.</p> :
                  items.map(w => (
                    <Card key={w.id} className="hover:bg-muted/20 transition-colors">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">{w.name}</span>
                              <Badge className={`text-[10px] ${STATUS_STYLES[w.status] || ""}`}>{w.status}</Badge>
                              {w.parent_ticket_id && <Badge variant="outline" className="text-[9px]">→ {w.parent_ticket_id.slice(0, 12)}</Badge>}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                              {new Date(w.scheduled_at).toLocaleString()} · {(w.device_ids || []).length} devices · {(w.actions || []).join(", ")}
                            </div>
                            {w.summary_counts && (
                              <div className="text-[10px] mt-1 flex items-center gap-3 font-mono">
                                <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{w.summary_counts.ok || 0}</span>
                                <span className="text-rose-400 flex items-center gap-1"><XCircle className="w-3 h-3" />{w.summary_counts.failed || 0}</span>
                                <span className="text-zinc-500">— {w.summary_counts.skipped || 0}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 ml-2">
                            <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => openDetail(w)} data-testid={`mw-detail-${w.id}`}>View</Button>
                            {w.status === "scheduled" && (
                              <>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-emerald-400" title="Run now" onClick={() => runNow(w)} data-testid={`mw-runnow-${w.id}`}><Play className="w-3 h-3" /></Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-400" title="Cancel" onClick={() => cancel(w)} data-testid={`mw-cancel-${w.id}`}><Trash2 className="w-3 h-3" /></Button>
                              </>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </ScrollArea>
          }
          <DialogFooter>
            <Button variant="outline" onClick={load}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-3xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Wrench className="w-5 h-5 text-amber-400" />{detail.name}</DialogTitle>
                <DialogDescription className="font-mono text-[10px]">{new Date(detail.scheduled_at).toLocaleString()} · {detail.status}</DialogDescription>
              </DialogHeader>
              {detail.ai_summary && (
                <Card className="bg-fuchsia-500/5 border-fuchsia-500/30">
                  <CardContent className="p-3">
                    <div className="text-[10px] uppercase tracking-wider text-fuchsia-300 flex items-center gap-1"><Sparkles className="w-3 h-3" />AI Summary</div>
                    <pre className="text-xs mt-1.5 whitespace-pre-wrap font-sans">{detail.ai_summary}</pre>
                  </CardContent>
                </Card>
              )}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Per-device results</div>
                <ScrollArea className="max-h-[40vh] border border-zinc-800 rounded">
                  {(detail.runs || []).length === 0 ? <p className="text-xs text-muted-foreground p-3 text-center">No runs yet</p> : (detail.runs || []).map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-[11px] px-2 py-1 border-b border-zinc-900/60">
                      <span className="truncate flex-1">{r.device_name} · <code className="text-[10px] text-muted-foreground">{r.action}</code></span>
                      <Badge variant="outline" className={`text-[9px] ${r.status === "ok" ? "text-emerald-400 border-emerald-500/30" : r.status === "failed" ? "text-rose-400 border-rose-500/30" : "text-zinc-500"}`}>{r.status}</Badge>
                    </div>
                  ))}
                </ScrollArea>
              </div>
              <DialogFooter><Button onClick={() => setDetail(null)}>Close</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
