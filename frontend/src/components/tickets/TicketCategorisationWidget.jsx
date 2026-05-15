import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderTree, Zap, Layers, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const URGENCY = [
  { v: 1, label: "Low",      tone: "text-blue-300 bg-blue-500/10 border-blue-500/30" },
  { v: 2, label: "Minor",    tone: "text-cyan-300 bg-cyan-500/10 border-cyan-500/30" },
  { v: 3, label: "Moderate", tone: "text-amber-300 bg-amber-500/10 border-amber-500/30" },
  { v: 4, label: "High",     tone: "text-orange-300 bg-orange-500/10 border-orange-500/30" },
  { v: 5, label: "Critical", tone: "text-rose-300 bg-rose-500/10 border-rose-500/30" },
];
const IMPACT = [
  { v: 1, label: "Low" },
  { v: 2, label: "Minor" },
  { v: 3, label: "Moderate" },
  { v: 4, label: "Major" },
  { v: 5, label: "Critical" },
];
const PRIORITY_TONE = {
  critical: "text-rose-300 bg-rose-500/15 border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.25)]",
  high:     "text-orange-300 bg-orange-500/15 border-orange-500/40",
  medium:   "text-amber-300 bg-amber-500/15 border-amber-500/40",
  low:      "text-blue-300 bg-blue-500/15 border-blue-500/40",
};

/**
 * Sidebar widget for ITIL-style ticket categorisation:
 * Category → Issue Type + Urgency × Impact → auto Priority.
 */
export default function TicketCategorisationWidget({ ticket, token, onUpdated }) {
  const [categories, setCategories] = useState([]);
  const [matrix, setMatrix] = useState(null);
  const [state, setState] = useState({
    category_id: ticket?.category_id || "",
    issue_type_id: ticket?.issue_type_id || "",
    urgency: ticket?.urgency || 3,
    impact: ticket?.impact || 3,
  });
  const [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (!ticket?.id) return;
    axios.get(`${API}/ticket-categories`, { headers }).then(r => setCategories(r.data)).catch(() => {});
    axios.get(`${API}/ticket-priority-matrix`, { headers }).then(r => setMatrix(r.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id]);

  // Keep local state in sync if parent ticket changes (e.g. after refetch)
  useEffect(() => {
    setState({
      category_id: ticket?.category_id || "",
      issue_type_id: ticket?.issue_type_id || "",
      urgency: ticket?.urgency || 3,
      impact: ticket?.impact || 3,
    });
  }, [ticket?.id, ticket?.category_id, ticket?.issue_type_id, ticket?.urgency, ticket?.impact]);

  const selectedCategory = categories.find(c => c.id === state.category_id);
  const issueTypes = selectedCategory?.issue_types || [];

  const computedPriority = matrix
    ? matrix.matrix[state.urgency - 1]?.[state.impact - 1]?.priority
    : null;

  const persist = async (patch) => {
    setSaving(true);
    try {
      const payload = { ...state, ...patch, auto_priority: true };
      // Resolve names for display so they're stored alongside ids
      const cat = categories.find(c => c.id === payload.category_id);
      if (cat) payload.category_name = cat.name;
      const it = (cat?.issue_types || []).find(i => i.id === payload.issue_type_id);
      if (it) payload.issue_type_name = it.name;
      const res = await axios.patch(`${API}/tickets/${ticket.id}/categorisation`, payload, { headers });
      toast.success("Categorisation updated");
      onUpdated?.(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const updateAndSave = (patch) => {
    setState(s => ({ ...s, ...patch }));
    persist(patch);
  };

  return (
    <Card data-testid="categorisation-widget" className="border-violet-500/15 bg-violet-500/[0.015]">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <FolderTree className="w-3.5 h-3.5 text-violet-400" />Categorisation
        </CardTitle>
        {saving && <Loader2 className="w-3 h-3 animate-spin text-violet-400" />}
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {/* Category + Issue Type */}
        <div className="space-y-1.5">
          <div className="text-[9px] uppercase tracking-widest font-mono text-zinc-500 flex items-center gap-1">
            <Layers className="w-2.5 h-2.5" />Category
          </div>
          <Select
            value={state.category_id || undefined}
            onValueChange={(v) => updateAndSave({ category_id: v, issue_type_id: "" })}
          >
            <SelectTrigger className="h-7 text-[11px]" data-testid="cat-select">
              <SelectValue placeholder="Pick a category…" />
            </SelectTrigger>
            <SelectContent>
              {categories.map(c => (
                <SelectItem key={c.id} value={c.id} className="text-xs" data-testid={`cat-opt-${c.id}`}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                    {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {issueTypes.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[9px] uppercase tracking-widest font-mono text-zinc-500">Issue Type</div>
            <Select
              value={state.issue_type_id || undefined}
              onValueChange={(v) => updateAndSave({ issue_type_id: v })}
            >
              <SelectTrigger className="h-7 text-[11px]" data-testid="issue-select">
                <SelectValue placeholder="Pick an issue type…" />
              </SelectTrigger>
              <SelectContent>
                {issueTypes.map(it => (
                  <SelectItem key={it.id} value={it.id} className="text-xs" data-testid={`issue-opt-${it.id}`}>
                    {it.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Urgency × Impact selectors */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <div className="text-[9px] uppercase tracking-widest font-mono text-zinc-500 flex items-center gap-1">
              <Zap className="w-2.5 h-2.5" />Urgency
            </div>
            <Select
              value={String(state.urgency)}
              onValueChange={(v) => updateAndSave({ urgency: parseInt(v, 10) })}
            >
              <SelectTrigger className="h-7 text-[11px]" data-testid="urgency-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {URGENCY.map(u => (
                  <SelectItem key={u.v} value={String(u.v)} className="text-xs" data-testid={`urgency-${u.v}`}>
                    {u.v} · {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="text-[9px] uppercase tracking-widest font-mono text-zinc-500 flex items-center gap-1">
              <AlertTriangle className="w-2.5 h-2.5" />Impact
            </div>
            <Select
              value={String(state.impact)}
              onValueChange={(v) => updateAndSave({ impact: parseInt(v, 10) })}
            >
              <SelectTrigger className="h-7 text-[11px]" data-testid="impact-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMPACT.map(i => (
                  <SelectItem key={i.v} value={String(i.v)} className="text-xs" data-testid={`impact-${i.v}`}>
                    {i.v} · {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Auto-Computed Priority */}
        {computedPriority && (
          <div className="space-y-1">
            <div className="text-[9px] uppercase tracking-widest font-mono text-zinc-500">
              Auto-Priority <span className="text-violet-400">(ITIL matrix)</span>
            </div>
            <div className={`rounded-md border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-widest text-center ${PRIORITY_TONE[computedPriority] || "text-zinc-300 bg-zinc-500/10 border-zinc-500/30"}`} data-testid="auto-priority">
              {computedPriority}
            </div>
            <p className="text-[9px] text-zinc-500 text-center">
              U{state.urgency} × I{state.impact} = {computedPriority.toUpperCase()}
            </p>
          </div>
        )}

        {/* 5×5 mini heatmap */}
        {matrix && (
          <details className="group">
            <summary className="text-[9px] uppercase tracking-widest font-mono text-zinc-500 cursor-pointer hover:text-zinc-300 select-none">
              Priority matrix
            </summary>
            <div className="mt-1.5 inline-grid gap-0.5" style={{ gridTemplateColumns: "auto repeat(5, 1fr)" }}>
              <div />
              {IMPACT.map(i => <div key={`hi-${i.v}`} className="text-[8px] text-zinc-500 text-center font-mono">I{i.v}</div>)}
              {URGENCY.map(u => (
                <>
                  <div key={`u-${u.v}`} className="text-[8px] text-zinc-500 font-mono pr-1 leading-[14px]">U{u.v}</div>
                  {IMPACT.map(i => {
                    const p = matrix.matrix[u.v - 1][i.v - 1].priority;
                    const isMe = u.v === state.urgency && i.v === state.impact;
                    return (
                      <div
                        key={`m-${u.v}-${i.v}`}
                        className={`text-[8px] font-bold uppercase w-5 h-3.5 leading-[14px] text-center rounded ${PRIORITY_TONE[p]} ${isMe ? "ring-1 ring-white/60" : "opacity-70"}`}
                        title={`U${u.v} × I${i.v} = ${p}`}
                      >
                        {p[0]}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
          </details>
        )}

        {ticket?.priority_auto_computed && (
          <div className="text-[9px] text-emerald-400/80 text-center flex items-center justify-center gap-1">
            <Zap className="w-2.5 h-2.5" />Priority auto-computed from Urgency × Impact
          </div>
        )}
      </CardContent>
    </Card>
  );
}
