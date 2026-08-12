/* QuickScriptDialog.jsx — bulk script picker w/ fan-out & audit log. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

export default function QuickScriptDialog({ open, onClose, deviceIds }) {
  const { token } = useAuth();
  const [scripts, setScripts] = useState([]);
  const [search, setSearch] = useState("");
  const [running, setRunning] = useState(null);

  useEffect(() => {
    if (!open) return;
    axios.get(`${API}/devices/quick-scripts`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setScripts(r.data?.scripts || []))
      .catch(() => setScripts([]));
  }, [open, token]);

  const run = async (s) => {
    if (deviceIds.length === 0) {
      toast.error("Select at least one device first.");
      return;
    }
    setRunning(s.id);
    try {
      const r = await axios.post(`${API}/devices/quick-scripts/run`, { script_id: s.id, device_ids: deviceIds }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(r.data?.message || "Queued");
      onClose && onClose();
    } catch { toast.error("Failed to queue script"); }
    finally { setRunning(null); }
  };

  const filtered = scripts.filter(s =>
    !search.trim() || (s.name + " " + s.description + " " + s.category).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose && onClose(); }}>
      <NexusWorkflowDialog
        eyebrow="Device automation"
        title={`Run a quick script on ${deviceIds.length} device${deviceIds.length === 1 ? "" : "s"}`}
        description="Choose an approved script. Nexus records the queued action against every selected endpoint."
        icon={Search}
        tone="violet"
        className="max-w-2xl"
        footer={<Button variant="outline" onClick={onClose}>Close</Button>}
      >
        <DialogHeader className="sr-only" aria-hidden="true">
          <DialogTitle>Quick Scripts · fan-out to {deviceIds.length} device{deviceIds.length === 1 ? "" : "s"}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-500" />
          <Input className="pl-8 text-xs" placeholder="Search scripts (cleanup, gpupdate, defender…)" value={search} onChange={e => setSearch(e.target.value)} data-testid="quick-script-search" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto pr-1">
          {filtered.map(s => (
            <Card key={s.id} className="p-2.5 bg-zinc-900/40 border-zinc-800/60 hover:border-violet-500/50 transition-colors" data-testid={`quick-script-${s.id}`}>
              <div className="flex items-start gap-2">
                <span className="text-xl leading-none">{s.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-zinc-100">{s.name}</p>
                  <p className="text-[10px] text-zinc-400 line-clamp-2 mt-0.5">{s.description}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[9px] uppercase tracking-wider text-zinc-500">{s.category} · ~{s.est_seconds}s</span>
                    <Button
                      size="sm"
                      className="h-6 text-[10px] px-2 bg-violet-600 hover:bg-violet-500"
                      onClick={() => run(s)}
                      disabled={running === s.id}
                      data-testid={`run-quick-script-${s.id}`}
                    >
                      {running === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Run"}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}
