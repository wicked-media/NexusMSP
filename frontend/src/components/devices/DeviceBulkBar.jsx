/**
 * DeviceBulkBar — multi-select toolbar with parallel fan-out.
 */
import { useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  RefreshCw, Download, Power, Tag, MessageSquareWarning, Loader2, X, Check, Sparkles,
} from "lucide-react";
import { API } from "@/App";
import ChangeGuardianDialog from "./ChangeGuardianDialog";

export default function DeviceBulkBar({ selectedIds, onClear, headers, devices = [] }) {
  const [busy, setBusy] = useState(null);
  const [results, setResults] = useState(null);
  const [confirm, setConfirm] = useState(null); // "reboot" | "tag" | "message"
  const [tagValue, setTagValue] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [guardian, setGuardian] = useState(null);

  if (selectedIds.length === 0) return null;

  const selectedDevices = devices.filter(d => selectedIds.includes(d.id));
  const agentCount = selectedDevices.filter(d => d.nexus_agent_id).length;

  const run = async (action, label, extra = {}) => {
    setBusy(action);
    setResults({ action: label, results: selectedDevices.map(d => ({ device_id: d.id, device_name: d.name, status: "running" })) });
    try {
      const r = await axios.post(`${API}/devices/bulk-action`, {
        device_ids: selectedIds, action, ...extra,
      }, { headers });
      setResults({ action: label, results: r.data.results, summary: r.data.summary });
      const s = r.data.summary;
      toast.success(`${label}: ${s.queued || 0} queued, ${s.completed || 0} completed, ${s.failed} failed, ${s.skipped} skipped`);
    } catch (e) {
      toast.error(e.response?.data?.detail || `${label} failed`);
      setResults(null);
    } finally {
      setBusy(null);
      setConfirm(null);
      setGuardian(null);
    }
  };

  const reviewChange = (action, label, extra = {}, confirmLabel = label) => {
    setConfirm(null);
    setGuardian({ action, label, extra, confirmLabel });
  };

  return (
    <>
      <div
        className="sticky top-2 z-20 flex items-center gap-2 rounded-xl border border-primary/20 bg-card px-3 py-2 shadow-sm"
        data-testid="device-bulk-bar"
      >
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-medium">{selectedIds.length} selected</span>
        <Badge variant="outline" className="text-[9px]">{agentCount} with Nexus Agent</Badge>
        <div className="ml-auto flex items-center gap-1 flex-wrap">
          <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={!!busy} onClick={() => run("run-checks", "Check agent connection")} data-testid="bulk-checks">
            {busy === "run-checks" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Agent check
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={!!busy} onClick={() => reviewChange("install-patches", "Queue Windows updates", {}, "Queue updates")} data-testid="bulk-patches">
            {busy === "install-patches" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}Patches
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={!!busy} onClick={() => reviewChange("reboot", "Reboot endpoints", {}, "Approve reboot")} data-testid="bulk-reboot">
            <Power className="w-3 h-3 mr-1" />Reboot
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={!!busy} onClick={() => setConfirm("tag")} data-testid="bulk-tag">
            <Tag className="w-3 h-3 mr-1" />Tag
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={!!busy} onClick={() => setConfirm("message")} data-testid="bulk-message">
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
                <span className="text-cyan-400">{results.summary.queued || 0} queued</span>
                {" - "}<span className="text-emerald-400">{results.summary.completed || 0} completed</span>
                {" - "}<span className="text-rose-400">{results.summary.failed} failed</span>
                {" - "}<span className="text-zinc-500">{results.summary.skipped} skipped</span>
              </span>
            )}
            <button className="text-zinc-500 hover:text-zinc-300" onClick={() => setResults(null)} data-testid="bulk-progress-clear">clear</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
            {results.results.map(r => {
              const tone = r.status === "completed" ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/5" :
                           r.status === "failed" ? "text-rose-300 border-rose-500/30 bg-rose-500/5" :
                           r.status === "skipped" ? "text-zinc-500 border-zinc-700 bg-zinc-900/50" :
                           "text-cyan-300 border-cyan-500/30 bg-cyan-500/5";
              const icon = r.status === "completed" ? "OK" : r.status === "failed" ? "!" : r.status === "skipped" ? "-" : "...";
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
      <Dialog open={confirm === "tag"} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Tag className="w-4 h-4 text-cyan-400" />Tag {selectedIds.length} devices</DialogTitle>
          </DialogHeader>
          <Input placeholder="Tag (e.g. priority, branch-1, audit-2026)" value={tagValue} onChange={e => setTagValue(e.target.value)} data-testid="bulk-tag-input" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button onClick={() => reviewChange("tag", "Apply asset tag", { value: tagValue }, "Apply tag")} disabled={!tagValue.trim() || !!busy} data-testid="bulk-tag-confirm"><Check className="w-3 h-3 mr-1" />Review impact</Button>
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
            <Button onClick={() => reviewChange("send-message", "Broadcast message", { title: "Message from IT", body: msgBody }, "Send message")} disabled={!msgBody.trim() || !!busy} data-testid="bulk-msg-confirm">Review impact</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChangeGuardianDialog
        open={!!guardian}
        onOpenChange={(next) => !next && setGuardian(null)}
        action={guardian?.action}
        deviceIds={selectedIds}
        headers={headers}
        busy={!!busy}
        confirmLabel={guardian?.confirmLabel}
        onApprove={(previewId) => run(
          guardian.action,
          guardian.label,
          { ...guardian.extra, guardian_preview_id: previewId },
        )}
      />
    </>
  );
}
