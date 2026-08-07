import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Star, MoreHorizontal, Trash2, Edit3, Plus, Users, Pin, BookmarkCheck } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/App";

const COLOR_TONES = {
  violet:  { chip: "bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/25",  active: "bg-violet-500/30 text-violet-100 border-violet-500/60 shadow-[0_0_12px_rgba(139,92,246,0.3)]" },
  rose:    { chip: "bg-rose-500/15 text-rose-300 border-rose-500/30 hover:bg-rose-500/25",          active: "bg-rose-500/30 text-rose-100 border-rose-500/60 shadow-[0_0_12px_rgba(244,63,94,0.3)]" },
  amber:   { chip: "bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25",      active: "bg-amber-500/30 text-amber-100 border-amber-500/60 shadow-[0_0_12px_rgba(245,158,11,0.3)]" },
  cyan:    { chip: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/25",          active: "bg-cyan-500/30 text-cyan-100 border-cyan-500/60 shadow-[0_0_12px_rgba(6,182,212,0.3)]" },
  emerald: { chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25", active: "bg-emerald-500/30 text-emerald-100 border-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.3)]" },
};

/**
 * SavedViewsBar — pinned chips at the top of any list page.
 * @param scope - "tickets" | "workspace" | "devices" | "clients"
 * @param currentSnapshot - { filters, group_by, density, sort } of current state to save
 * @param onApply - (view) => void when a chip is clicked
 * @param activeViewId - currently active view id (for visual highlight)
 */
export default function SavedViewsBar({ scope, headers, currentSnapshot, onApply, activeViewId, onClearActive }) {
  const authorization = headers?.Authorization;
  const [views, setViews] = useState([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("violet");
  const [pinned, setPinned] = useState(true);
  const [shared, setShared] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/saved-views`, { headers: { Authorization: authorization }, params: { scope } });
      setViews(r.data || []);
    } catch { /* ignore */ }
  }, [authorization, scope]);
  useEffect(() => { if (authorization) reload(); }, [authorization, reload]);

  const openSaveDialog = (existing = null) => {
    if (existing) {
      setEditing(existing);
      setName(existing.name);
      setColor(existing.color || "violet");
      setPinned(existing.pinned);
      setShared(existing.shared);
    } else {
      setEditing(null);
      setName("");
      setColor("violet");
      setPinned(true);
      setShared(false);
    }
    setSaveOpen(true);
  };

  const submitSave = async () => {
    const payload = { name: name.trim(), scope, color, pinned, shared, ...(currentSnapshot || {}) };
    if (!payload.name) { toast.error("Name required"); return; }
    try {
      if (editing) {
        await axios.put(`${API}/saved-views/${editing.id}`, payload, { headers });
        toast.success("View updated");
      } else {
        await axios.post(`${API}/saved-views`, payload, { headers });
        toast.success("View saved");
      }
      setSaveOpen(false);
      reload();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  const deleteView = async (v) => {
    if (!window.confirm(`Delete saved view "${v.name}"?`)) return;
    try {
      await axios.delete(`${API}/saved-views/${v.id}`, { headers });
      toast.success("Deleted");
      reload();
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); }
  };

  const pinned_views = views.filter(v => v.pinned);
  const more_views = views.filter(v => !v.pinned);

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap" data-testid="saved-views-bar">
        {/* All / clear */}
        <button
          onClick={() => onClearActive?.()}
          className={`px-2.5 py-1 rounded-md border text-[11px] font-medium transition-all ${!activeViewId ? "bg-white/10 text-zinc-100 border-white/20" : "bg-transparent text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-white/[0.03]"}`}
          data-testid="view-chip-all"
        >
          All
        </button>

        {/* Pinned chips */}
        {pinned_views.map(v => {
          const tone = COLOR_TONES[v.color] || COLOR_TONES.violet;
          const isActive = activeViewId === v.id;
          return (
            <div key={v.id} className="relative group/chip">
              <button
                onClick={() => onApply?.(v)}
                className={`inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-md border text-[11px] font-medium transition-all ${isActive ? tone.active : tone.chip}`}
                data-testid={`view-chip-${v.id}`}
              >
                <Star className={`w-3 h-3 ${isActive ? "fill-current" : ""}`} />
                <span className="truncate max-w-[140px]">{v.name}</span>
                {v.shared && <Users className="w-2.5 h-2.5 opacity-60" />}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="absolute -right-1 -top-1 h-4 w-4 p-0 opacity-0 group-hover/chip:opacity-100 bg-card/80 border border-white/10" data-testid={`view-menu-${v.id}`}>
                    <MoreHorizontal className="w-2.5 h-2.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem onSelect={() => openSaveDialog(v)}><Edit3 className="w-3 h-3 mr-2" />Edit</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onApply?.(v)}><Pin className="w-3 h-3 mr-2" />Apply</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => deleteView(v)} className="text-rose-400"><Trash2 className="w-3 h-3 mr-2" />Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}

        {/* More views (not pinned) */}
        {more_views.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] font-mono uppercase tracking-wider text-zinc-400 hover:text-zinc-100 hover:bg-white/5" data-testid="more-views">
                <BookmarkCheck className="w-3 h-3 mr-1" />+{more_views.length}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {more_views.map(v => (
                <DropdownMenuItem key={v.id} onSelect={() => onApply?.(v)} data-testid={`view-more-${v.id}`}>
                  <Star className="w-3 h-3 mr-2 text-zinc-500" />{v.name}
                  {v.shared && <Users className="w-2.5 h-2.5 ml-auto opacity-60" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Save current */}
        {currentSnapshot && (
          <Button variant="ghost" size="sm" onClick={() => openSaveDialog(null)} className="h-7 px-2 text-[10px] font-mono uppercase tracking-wider text-zinc-400 hover:text-violet-300 hover:bg-violet-500/10" data-testid="save-view-btn">
            <Plus className="w-3 h-3 mr-1" />Save view
          </Button>
        )}
      </div>

      {/* Save dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm" data-testid="save-view-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit view" : "Save current view"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My SLA Breached" data-testid="save-view-name" autoFocus />
            </div>
            <div>
              <Label className="text-xs">Color</Label>
              <div className="flex gap-1.5 mt-1">
                {Object.keys(COLOR_TONES).map(c => (
                  <button key={c} onClick={() => setColor(c)} className={`w-6 h-6 rounded-md border ${COLOR_TONES[c].chip} ${color === c ? "ring-2 ring-white/40" : ""}`} data-testid={`color-${c}`} />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-1.5"><Pin className="w-3 h-3" />Pin to top bar</Label>
              <Switch checked={pinned} onCheckedChange={setPinned} data-testid="pinned-toggle" />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-1.5"><Users className="w-3 h-3" />Share with team</Label>
              <Switch checked={shared} onCheckedChange={setShared} data-testid="shared-toggle" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button onClick={submitSave} disabled={!name.trim()} data-testid="save-view-confirm">{editing ? "Update" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
