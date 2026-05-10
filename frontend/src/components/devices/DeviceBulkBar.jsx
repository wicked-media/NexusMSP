/**
 * DeviceBulkBar — multi-select toolbar with parallel fan-out.
 */
import { useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  RefreshCw, Download, Power, Tag, MessageSquareWarning, Loader2, X, Check, Sparkles,
} from "lucide-react";
import { API } from "@/App";

export default function DeviceBulkBar({ selectedIds, onClear, headers, devices = [] }) {
  const [busy, setBusy] = useState(null);
  const [results, setResults] = useState(null);
  const [confirm, setConfirm] = useState(null); // "reboot" | "tag" | "message"
  const [tagValue, setTagValue] = useState("");
  const [msgBody, setMsgBody] = useState("");

  if (selectedIds.length === 0) return null;

  const selectedDevices = devices.filter(d => selectedIds.includes(d.id));
  const agentCount = selectedDevices.filter(d => d.trmm_agent_id).length;

  const run = async (action, label, extra = {}) => {
    setBusy(action);
    setResults({ action: label, results: selectedDevices.map(d => ({ device_id: d.id, device_name: d.name, status: "running" })) });
    try {
      const r = await axios.post(`${API}/devices/bulk-action`, {
        device_ids: selectedIds, action, ...extra,
      }, { headers });
      setResults({ action: label, results: r.data.results, summary: r.data.summary });
      const s = r.data.summary;
      toast.success(`${label} → ${s.ok} OK · ${s.failed} failed · ${s.skipped} skipped`);
    } catch (e) {
      toast.error(e.response?.data?.detail || `${label} failed`);
      setResults(null);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  return (
    <>
      <div
        className="sticky top-2 z-20 flex items-center gap-2 px-3 py-2 rounded-md border border-fuchsia-500/30 bg-gradient-to-r from-fuchsia-500/15 via-violet-500/10 to-cyan-500/10 backdrop-blur-md shadow-lg"
        data-testid="device-bulk-bar"
      >
        <Sparkles className="w-4 h-4 text-fuchsia-400 shrink-0" />
        <span className="text-xs font-medium text-fuchsia-200">{selectedIds.length} selected</span>
        <Badge variant="outline" className="text-[9px] text-zinc-400">{agentCount} with TRMM agent</Badge>
        <div className="ml-auto flex items-center gap-1 flex-wrap">
          <Button size="sm" variant="outline" className="h-7 text-[10px] border-violet-500/40 text-violet-300 hover:bg-violet-500/10" disabled={!!busy} onClick={() => run("run-checks", "Run Checks")} data-testid="bulk-checks">
            {busy === "run-checks" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Checks
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px] border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10" disabled={!!busy} onClick={() => run("install-patches", "Install Patches")} data-testid="bulk-patches">
            {busy === "install-patches" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}Patches
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px] border-amber-500/40 text-amber-300 hover:bg-amber-500/10" disabled={!!busy} onClick={() => setConfirm("reboot")} data-testid="bulk-reboot">
            <Power className="w-3 h-3 mr-1" />Reboot
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px] border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10" disabled={!!busy} onClick={() => setConfirm("tag")} data-testid="bulk-tag">
            <Tag className="w-3 h-3 mr-1" />Tag
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px] border-zinc-500/40 hover:bg-zinc-500/10" disabled={!!busy} onClick={() => setConfirm("message")} data-testid="bulk-message">
            <MessageSquareWarning className="w-3 h-3 mr-1" />Message
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[10px] text-zinc-400" onClick={onClear} data-testid="bulk-clear">
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Progress strip */}
      {results && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 mt-2 space-y-1" data-testid="bulk-progress">
          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
            <span>{results.action}</span>
            {results.summary && (
              <span>
                <span className="text-emerald-400">{results.summary.ok} ok</span>
                {" · "}<span className="text-rose-400">{results.summary.failed} failed</span>
                {" · "}<span className="text-zinc-500">{results.summary.skipped} skipped</span>
              </span>
            )}
            <button className="text-zinc-500 hover:text-zinc-300" onClick={() => setResults(null)} data-testid="bulk-progress-clear">clear</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
            {results.results.map(r => {
              const tone = r.status === "ok" ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/5" :
                           r.status === "failed" ? "text-rose-300 border-rose-500/30 bg-rose-500/5" :
                           r.status === "skipped" ? "text-zinc-500 border-zinc-700 bg-zinc-900/50" :
                           "text-cyan-300 border-cyan-500/30 bg-cyan-500/5";
              const icon = r.status === "ok" ? "✓" : r.status === "failed" ? "✗" : r.status === "skipped" ? "—" : "⟳";
              return (
                <div key={r.device_id} className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] ${tone} ${r.status === "running" ? "animate-pulse" : ""}`} title={r.message || r.status}>
                  <span className="font-mono">{icon}</span>
                  <span className="truncate flex-1">{r.device_name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confirm dialogs */}
      <Dialog open={confirm === "reboot"} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Power className="w-4 h-4 text-amber-400" />Reboot {selectedIds.length} devices?</DialogTitle>
            <DialogDescription className="text-xs">Each device reboots in parallel. Offline devices skipped.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button onClick={() => run("reboot", "Reboot all")} disabled={!!busy} data-testid="bulk-reboot-confirm">Reboot all</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm === "tag"} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Tag className="w-4 h-4 text-cyan-400" />Tag {selectedIds.length} devices</DialogTitle>
          </DialogHeader>
          <Input placeholder="Tag (e.g. priority, branch-1, audit-2026)" value={tagValue} onChange={e => setTagValue(e.target.value)} data-testid="bulk-tag-input" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button onClick={() => run("tag", "Apply tag", { value: tagValue })} disabled={!tagValue.trim() || !!busy} data-testid="bulk-tag-confirm"><Check className="w-3 h-3 mr-1" />Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm === "message"} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><MessageSquareWarning className="w-4 h-4 text-cyan-400" />Message users on {selectedIds.length} devices</DialogTitle>
          </DialogHeader>
          <Textarea rows={4} value={msgBody} onChange={e => setMsgBody(e.target.value)} placeholder="A message to display on each user's screen…" data-testid="bulk-msg-input" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button onClick={() => run("send-message", "Broadcast message", { title: "Message from IT", body: msgBody })} disabled={!msgBody.trim() || !!busy} data-testid="bulk-msg-confirm">Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
