import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, Cloud, Sparkles, AlertTriangle, Play } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/App";

/**
 * Pick an Acronis backup policy and apply it to one or more resources.
 * Supports immediate run-now after applying.
 */
export default function ChangePlanDialog({
  open, onOpenChange, token, resources = [], onApplied,
}) {
  const headers = { Authorization: `Bearer ${token}` };
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(null);
  const [runNow, setRunNow] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    axios.get(`${API}/acronis/policies`, { headers })
      .then(r => setPolicies(r.data?.items || []))
      .catch(() => toast.error("Failed to load Acronis policies"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim();
    if (!q) return policies;
    return policies.filter(p => (p.name || "").toLowerCase().includes(q) || (p.type || "").toLowerCase().includes(q));
  }, [policies, filter]);

  const handleApply = async () => {
    if (!selected || !resources.length) return;
    setApplying(true);
    try {
      const r = await axios.post(
        `${API}/acronis/policies/apply`,
        {
          policy_id: selected.id,
          resource_ids: resources.map(x => x.resource_id || x.id),
          run_now: runNow,
        },
        { headers },
      );
      const status = r.data?.status;
      if (status === "applied") {
        toast.success(`Plan applied to ${r.data.applied_count} resource(s)${runNow ? " · running now" : ""}`);
      } else if (status === "partial") {
        toast.warning(`Partial: applied ${r.data.applied_count}/${r.data.total}`);
      } else {
        toast.error("Apply returned unexpected status");
      }
      onApplied?.(r.data);
      onOpenChange(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-cyan-400" />
            Apply Acronis Backup Plan
          </DialogTitle>
          <DialogDescription>
            Pick a backup plan to apply to {resources.length} selected resource{resources.length === 1 ? "" : "s"}.
            Optional: run immediately after applying.
          </DialogDescription>
        </DialogHeader>

        {/* Targets */}
        <div className="rounded-lg border border-border/50 bg-muted/20 p-2 max-h-[80px] overflow-y-auto" data-testid="apply-plan-targets">
          <div className="flex flex-wrap gap-1.5">
            {resources.slice(0, 30).map((r, i) => (
              <Badge key={(r.resource_id || r.id || `k-${i}`)} variant="outline" className="text-[10px]">
                {r.resource_name || r.name || r.resource_id || r.id}
              </Badge>
            ))}
            {resources.length > 30 && <Badge variant="secondary" className="text-[10px]">+{resources.length - 30} more</Badge>}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={loading ? "Loading plans..." : `Search ${policies.length} backup plans...`}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            disabled={loading}
            data-testid="apply-plan-search"
          />
        </div>

        {/* Plan list */}
        <ScrollArea className="h-[320px] border rounded-lg">
          <div className="p-1.5 space-y-1">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No matching plans</div>
            ) : (
              filtered.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className={`w-full text-left rounded-md px-3 py-2 transition-all border ${
                    selected?.id === p.id
                      ? "border-cyan-500/50 bg-cyan-500/10"
                      : "border-transparent hover:bg-muted/40 hover:border-border"
                  }`}
                  data-testid={`apply-plan-option-${p.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {selected?.id === p.id && <Sparkles className="w-3 h-3 text-cyan-400 flex-shrink-0" />}
                        <span className="text-sm font-medium truncate">{p.name}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">{p.type}</p>
                    </div>
                    {p.enabled === false && <Badge variant="outline" className="text-[9px]">Disabled</Badge>}
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Run now option */}
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={runNow} onCheckedChange={setRunNow} data-testid="apply-plan-runnow" />
          <span className="text-sm flex items-center gap-1.5">
            <Play className="w-3 h-3 text-emerald-400" />
            Run backup immediately after applying
          </span>
        </label>

        {selected?.enabled === false && (
          <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-300 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            This plan is currently disabled in Acronis — applying it won't run scheduled backups until enabled.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>Cancel</Button>
          <Button
            onClick={handleApply}
            disabled={!selected || applying || resources.length === 0}
            className="bg-cyan-600 hover:bg-cyan-700"
            data-testid="apply-plan-confirm"
          >
            {applying
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Applying...</>
              : <><Cloud className="w-4 h-4 mr-2" />Apply{runNow ? " & Run Now" : ""}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
