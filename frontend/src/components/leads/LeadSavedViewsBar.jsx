/* LeadSavedViewsBar.jsx — pinned filter combos for the leads page. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Bookmark, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const PRESETS = [
  { name: "🔥 Hot leads", filters: { hotOnly: true } },
  { name: "💀 Stalled > 14d", filters: { staleOnly: true } },
  { name: "👤 Mine", filters: { mineOnly: true } },
  { name: "⏳ Proposal sent", filters: { status: "proposal" } },
  { name: "✅ Won this month", filters: { status: "won", monthWindow: true } },
];

export default function LeadSavedViewsBar({ currentFilters, onApply, onPreset }) {
  const { token } = useAuth();
  const [views, setViews] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [active, setActive] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/lead-studio/saved-views`, { headers })
      .then(r => setViews(r.data || []))
      .catch(() => setViews([]));
    // eslint-disable-next-line
  }, [token]);

  const create = async () => {
    if (!name.trim()) return;
    try {
      const r = await axios.post(`${API}/lead-studio/saved-views`, { name: name.trim(), filters: currentFilters }, { headers });
      setViews(v => [...v, r.data]);
      setShowNew(false);
      setName("");
      toast.success(`Saved view "${r.data.name}"`);
    } catch { toast.error("Failed to save view"); }
  };

  const remove = async (id) => {
    try {
      await axios.delete(`${API}/lead-studio/saved-views/${id}`, { headers });
      setViews(v => v.filter(x => x.id !== id));
      if (active === id) setActive(null);
    } catch { toast.error("Failed to delete view"); }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="lead-saved-views-bar">
      <Bookmark className="w-3.5 h-3.5 text-zinc-500" />
      {PRESETS.map(p => (
        <button
          key={p.name}
          onClick={() => { onPreset && onPreset(p.filters); setActive(`p-${p.name}`); }}
          data-testid={`lead-preset-${p.name.replace(/\s/g, '-')}`}
          className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${active === `p-${p.name}` ? "border-violet-500 bg-violet-500/15 text-violet-200" : "border-zinc-700 text-zinc-300 hover:border-violet-500/60"}`}
        >
          {p.name}
        </button>
      ))}
      <div className="w-px h-4 bg-zinc-800 mx-1" />
      {views.map(v => (
        <span
          key={v.id}
          className={`group inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border transition-colors cursor-pointer ${active === v.id ? "border-violet-500 bg-violet-500/15 text-violet-200" : "border-zinc-700 text-zinc-300 hover:border-violet-500/60"}`}
          onClick={() => { setActive(v.id); onApply && onApply(v.filters || {}); }}
          data-testid={`lead-saved-view-${v.id}`}
        >
          {v.name}
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-300"
            onClick={(e) => { e.stopPropagation(); remove(v.id); }}
          ><X className="w-2.5 h-2.5" /></button>
        </span>
      ))}
      <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2 text-violet-300 hover:text-violet-200" onClick={() => setShowNew(true)} data-testid="lead-saved-view-add">
        <Plus className="w-3 h-3 mr-0.5" />Save current
      </Button>
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Save current view</DialogTitle></DialogHeader>
          <Input placeholder="e.g. Aaron's hot leads, Pipeline this quarter" value={name} onChange={e => setName(e.target.value)} autoFocus data-testid="lead-saved-view-name-input" />
          <DialogFooter>
            <Button onClick={create} data-testid="lead-saved-view-create-btn">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
