import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Snowflake, Plus, Loader2, Trash2, Pencil, Calendar, Shield } from "lucide-react";
import { toast } from "sonner";

const KIND_OPTIONS = [
  { v: "patch", label: "Patches" },
  { v: "reboot", label: "Reboots" },
  { v: "script", label: "Scripts" },
  { v: "broadcast", label: "Broadcasts" },
  { v: "deploy", label: "Deployments" },
];

function useApi(token) {
  return useMemo(() => ({
    get: (p) => axios.get(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    post: (p, b) => axios.post(`${API}${p}`, b || {}, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    put: (p, b) => axios.put(`${API}${p}`, b || {}, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    del: (p) => axios.delete(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  }), [token]);
}

export default function ChangeFreezePage() {
  const { token } = useAuth();
  const api = useApi(token);
  const [freezes, setFreezes] = useState([]);
  const [activeOnly, setActiveOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const reload = () => {
    setLoading(true);
    api.get(`/change-freezes${activeOnly ? "?active_only=true" : ""}`)
      .then((d) => setFreezes(d.freezes || []))
      .catch((e) => toast.error(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [activeOnly]);

  useEffect(() => {
    api.get("/clients").then((d) => {
      setClients(Array.isArray(d) ? d : (d?.clients || []));
    }).catch(() => {});
    // eslint-disable-next-line
  }, []);

  const remove = async (id) => {
    if (!window.confirm("Delete this freeze window?")) return;
    try {
      await api.del(`/change-freezes/${id}`);
      toast.success("Freeze removed");
      reload();
    } catch (e) { toast.error(e.message); }
  };

  const save = async (draft) => {
    try {
      if (draft.id) {
        await api.put(`/change-freezes/${draft.id}`, draft);
      } else {
        await api.post(`/change-freezes`, draft);
      }
      toast.success("Saved");
      setEditorOpen(false);
      reload();
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    }
  };

  const now = new Date();
  const activeCount = freezes.filter(f => {
    const s = new Date(f.starts_at), e = new Date(f.ends_at);
    return f.active && s <= now && e >= now;
  }).length;
  const upcomingCount = freezes.filter(f => {
    const s = new Date(f.starts_at);
    return f.active && s > now;
  }).length;

  return (
    <PageShell>
      <div className="space-y-4" data-testid="change-freeze-page">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-sky-400 mb-1 flex items-center gap-2">
              <Snowflake className="w-3 h-3" />Change Freeze Calendar
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Blackout windows</h1>
            <p className="text-sm text-muted-foreground">Block automated patches, reboots, scripts and broadcasts during sensitive windows.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
            onClick={() => { setEditing(blankDraft()); setEditorOpen(true); }}
            data-testid="freeze-new-btn"
          >
            <Plus className="w-3 h-3 mr-1" />New freeze
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Stat label="Active now" value={activeCount} color="rose" icon={Shield} />
          <Stat label="Upcoming" value={upcomingCount} color="amber" icon={Calendar} />
          <Stat label="Total" value={freezes.length} color="sky" icon={Snowflake} />
        </div>

        <div className="flex items-center gap-2">
          <Switch checked={activeOnly} onCheckedChange={setActiveOnly} data-testid="freeze-active-only" />
          <span className="text-xs text-muted-foreground">Show only currently active</span>
        </div>

        {loading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
        ) : freezes.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            <Snowflake className="w-10 h-10 mx-auto mb-2 opacity-50" />
            No freeze windows. Create one to protect a sensitive window.
          </CardContent></Card>
        ) : (
          <div className="space-y-2" data-testid="freeze-list">
            {freezes.map((f) => <FreezeRow key={f.id} f={f} onEdit={() => { setEditing(f); setEditorOpen(true); }} onDelete={() => remove(f.id)} />)}
          </div>
        )}

        {editorOpen && (
          <FreezeEditor open={editorOpen} initial={editing} clients={clients} onClose={() => setEditorOpen(false)} onSave={save} />
        )}
      </div>
    </PageShell>
  );
}

function Stat({ label, value, color = "sky", icon: Icon }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        {Icon && <Icon className={`w-5 h-5 text-${color}-400`} />}
        <div>
          <div className={`text-[10px] uppercase tracking-widest text-${color}-400`}>{label}</div>
          <div className="text-xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function FreezeRow({ f, onEdit, onDelete }) {
  const now = new Date();
  const s = new Date(f.starts_at), e = new Date(f.ends_at);
  const isActiveNow = f.active && s <= now && e >= now;
  const isUpcoming = f.active && s > now;
  const isPast = e < now;
  const stateColor = isActiveNow ? "rose" : isUpcoming ? "amber" : isPast ? "zinc" : "sky";
  const stateLabel = isActiveNow ? "ACTIVE NOW" : isUpcoming ? "UPCOMING" : isPast ? "ENDED" : "INACTIVE";

  return (
    <Card data-testid={`freeze-row-${f.id}`} className={`border-l-2 border-l-${stateColor}-500/60`}>
      <CardContent className="p-3 flex items-center gap-3 flex-wrap">
        <Snowflake className={`w-4 h-4 text-${stateColor}-400`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{f.title}</span>
            <Badge variant="outline" className={`text-[10px] text-${stateColor}-400 border-${stateColor}-500/40`}>{stateLabel}</Badge>
            {!f.active && <Badge variant="outline" className="text-[10px]">Disabled</Badge>}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {f.client_name} · {s.toLocaleString()} → {e.toLocaleString()}
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {(f.kinds || []).map(k => <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>)}
          </div>
          {f.reason && <div className="text-[11px] text-muted-foreground italic mt-1">"{f.reason}"</div>}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} data-testid={`freeze-edit-${f.id}`}><Pencil className="w-3 h-3" /></Button>
          <Button size="sm" variant="ghost" onClick={onDelete} data-testid={`freeze-delete-${f.id}`}><Trash2 className="w-3 h-3 text-rose-400" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

function blankDraft() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 4 * 3600 * 1000);
  return {
    title: "",
    client_id: "",
    starts_at: toLocalIsoInput(start),
    ends_at: toLocalIsoInput(end),
    kinds: ["patch", "reboot", "script", "broadcast"],
    reason: "",
    active: true,
  };
}

function toLocalIsoInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function FreezeEditor({ open, initial, clients, onClose, onSave }) {
  const [d, setD] = useState(() => ({
    ...initial,
    starts_at: initial?.starts_at ? toLocalIsoInput(new Date(initial.starts_at)) : "",
    ends_at: initial?.ends_at ? toLocalIsoInput(new Date(initial.ends_at)) : "",
  }));
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const toggleKind = (k) => set("kinds", d.kinds?.includes(k) ? d.kinds.filter(x => x !== k) : [...(d.kinds || []), k]);

  const submit = () => {
    if (!d.title?.trim()) return toast.error("Title required");
    if (!d.starts_at || !d.ends_at) return toast.error("Start and end required");
    if (new Date(d.ends_at) <= new Date(d.starts_at)) return toast.error("End must be after start");
    onSave({
      ...d,
      client_id: d.client_id || null,
      starts_at: new Date(d.starts_at).toISOString(),
      ends_at: new Date(d.ends_at).toISOString(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl" data-testid="freeze-editor">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2"><Snowflake className="w-4 h-4 text-sky-400" />{d.id ? "Edit freeze window" : "New freeze window"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Title</label>
            <Input value={d.title || ""} onChange={(e) => set("title", e.target.value)} placeholder="EOFY blackout · Acme Corp" data-testid="freeze-title" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Client (leave blank = all clients)</label>
            <Select value={d.client_id || "__all__"} onValueChange={(v) => set("client_id", v === "__all__" ? "" : v)}>
              <SelectTrigger data-testid="freeze-client"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="__all__">All clients (MSP-wide)</SelectItem>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Starts</label>
              <Input type="datetime-local" value={d.starts_at || ""} onChange={(e) => set("starts_at", e.target.value)} data-testid="freeze-starts" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Ends</label>
              <Input type="datetime-local" value={d.ends_at || ""} onChange={(e) => set("ends_at", e.target.value)} data-testid="freeze-ends" />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Block kinds</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {KIND_OPTIONS.map((k) => {
                const on = d.kinds?.includes(k.v);
                return (
                  <button
                    key={k.v}
                    type="button"
                    onClick={() => toggleKind(k.v)}
                    className={`text-[11px] px-2 py-1 rounded border transition-colors ${on ? "bg-sky-500/15 text-sky-300 border-sky-500/40" : "border-border/40 text-muted-foreground hover:bg-muted/50"}`}
                    data-testid={`freeze-kind-${k.v}`}
                  >
                    {k.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Reason</label>
            <Textarea rows={3} value={d.reason || ""} onChange={(e) => set("reason", e.target.value)} placeholder="Stocktake weekend, no IT changes" data-testid="freeze-reason" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={d.active !== false} onCheckedChange={(v) => set("active", v)} data-testid="freeze-active" />
            <span className="text-xs text-muted-foreground">Active</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="outline" className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10" onClick={submit} data-testid="freeze-save">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
