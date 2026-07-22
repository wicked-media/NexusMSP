import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Snowflake, Plus, Loader2, Trash2, Pencil, Calendar, Shield, RefreshCw, GitBranch, Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";

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
  const navigate = useNavigate();
  const api = useApi(token);
  const [freezes, setFreezes] = useState([]);
  const [activeOnly, setActiveOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const reload = () => {
    setLoading(true);
    api.get("/change-freezes")
      .then((d) => setFreezes(d.freezes || []))
      .catch((e) => toast.error(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    api.get("/clients").then((d) => {
      setClients(Array.isArray(d) ? d : (d?.clients || []));
    }).catch(() => {});
    // eslint-disable-next-line
  }, []);

  const remove = async (id) => {
    try {
      await api.del(`/change-freezes/${id}`);
      toast.success("Freeze removed");
      setDeleteTarget(null);
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
  const visibleFreezes = activeOnly
    ? freezes.filter(f => f.active && new Date(f.starts_at) <= now && new Date(f.ends_at) >= now)
    : freezes;

  return (
    <PageShell>
      <div className="space-y-5" data-testid="change-freeze-page">
        <OperationalPageHeader
          eyebrow="Change control"
          title="Change freeze calendar"
          description="Protect sensitive client and MSP-wide windows by blocking automation until the approved change window reopens."
          icon={Snowflake}
          tone="sky"
          actions={<>
            <Button variant="outline" size="sm" onClick={() => navigate("/change-management")} data-testid="freeze-change-management"><GitBranch className="mr-1.5 h-3.5 w-3.5" />Change management</Button>
            <Button variant="outline" size="sm" onClick={reload} disabled={loading} data-testid="freeze-refresh"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
            <Button size="sm" onClick={() => { setEditing(blankDraft()); setEditorOpen(true); }} data-testid="freeze-new-btn"><Plus className="mr-1.5 h-3.5 w-3.5" />New freeze</Button>
          </>}
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <HeroTile label="Active now" value={activeCount} icon={Shield} glow="rose" active={activeOnly} onClick={() => setActiveOnly(true)} testId="freeze-stat-active" />
          <HeroTile label="Upcoming" value={upcomingCount} icon={Calendar} glow="amber" testId="freeze-stat-upcoming" />
          <HeroTile label="All windows" value={freezes.length} icon={Snowflake} glow="sky" active={!activeOnly} onClick={() => setActiveOnly(false)} testId="freeze-stat-total" />
        </div>

        <div className="flex items-center gap-2">
          <Switch checked={activeOnly} onCheckedChange={setActiveOnly} data-testid="freeze-active-only" />
          <span className="text-xs text-muted-foreground">Show only currently active</span>
        </div>

        {loading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
        ) : visibleFreezes.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            <Snowflake className="w-10 h-10 mx-auto mb-2 opacity-50" />
            {activeOnly ? "No freeze windows are active right now." : "No freeze windows. Create one to protect a sensitive window."}
          </CardContent></Card>
        ) : (
          <div className="space-y-2" data-testid="freeze-list">
            {visibleFreezes.map((f) => <FreezeRow key={f.id} f={f} onEdit={() => { setEditing(f); setEditorOpen(true); }} onDelete={() => setDeleteTarget(f)} />)}
          </div>
        )}

        {editorOpen && (
          <FreezeEditor open={editorOpen} initial={editing} clients={clients} onClose={() => setEditorOpen(false)} onSave={save} />
        )}
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this freeze window?</AlertDialogTitle>
              <AlertDialogDescription>This removes the automation safeguard for {deleteTarget?.client_name || "all clients"}. This action is recorded in the change-control history.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep freeze</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteTarget && remove(deleteTarget.id)}>Remove freeze</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PageShell>
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
  const tone = {
    rose: { border: "border-l-rose-500/60", icon: "text-rose-400", badge: "border-rose-500/40 text-rose-400" },
    amber: { border: "border-l-amber-500/60", icon: "text-amber-400", badge: "border-amber-500/40 text-amber-400" },
    zinc: { border: "border-l-zinc-500/60", icon: "text-zinc-400", badge: "border-zinc-500/40 text-zinc-400" },
    sky: { border: "border-l-sky-500/60", icon: "text-sky-400", badge: "border-sky-500/40 text-sky-400" },
  }[stateColor];

  return (
    <Card data-testid={`freeze-row-${f.id}`} className={`border-l-2 ${tone.border}`}>
      <CardContent className="p-3 flex items-center gap-3 flex-wrap">
        <Snowflake className={`w-4 h-4 ${tone.icon}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{f.title}</span>
            <Badge variant="outline" className={`text-[10px] ${tone.badge}`}>{stateLabel}</Badge>
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

function ClientScopePicker({ clients, value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = clients.find((client) => client.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="h-10 w-full justify-between font-normal" data-testid="freeze-client">
          <span className="truncate">{selected?.name || "All clients (MSP-wide)"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search clients..." />
          <CommandList className="max-h-72">
            <CommandEmpty>No client found.</CommandEmpty>
            <CommandGroup heading="Scope">
              <CommandItem value="All clients MSP-wide" onSelect={() => { onChange(""); setOpen(false); }}>
                <Check className={`mr-2 h-4 w-4 ${!value ? "opacity-100" : "opacity-0"}`} />All clients (MSP-wide)
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Clients">
              {clients.map((client) => (
                <CommandItem key={client.id} value={`${client.name} ${client.email || ""}`} onSelect={() => { onChange(client.id); setOpen(false); }}>
                  <Check className={`mr-2 h-4 w-4 ${value === client.id ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{client.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
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
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto border-sky-400/20 bg-background p-0" data-testid="freeze-editor">
        <DialogHeader className="border-b border-sky-400/15 bg-[linear-gradient(135deg,rgba(14,165,233,0.12),rgba(15,23,42,0.92))] px-6 py-5 pr-14">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Change control</p>
          <DialogTitle className="mt-1 flex items-center gap-2 text-xl"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-400/25 bg-sky-400/10"><Snowflake className="h-4 w-4 text-sky-300" /></span>{d.id ? "Edit freeze window" : "Create freeze window"}</DialogTitle>
          <DialogDescription className="mt-2">Automation matching this scope and change type will pause for the approved window, leaving the exception auditable.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Title</label>
            <Input value={d.title || ""} onChange={(e) => set("title", e.target.value)} placeholder="EOFY blackout · Acme Corp" data-testid="freeze-title" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Client (leave blank = all clients)</label>
            <div className="mt-1"><ClientScopePicker clients={clients} value={d.client_id || ""} onChange={(value) => set("client_id", value)} /></div>
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
        <DialogFooter className="border-t border-border/70 bg-muted/10 px-6 py-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit} data-testid="freeze-save">{d.id ? "Save audited changes" : "Create freeze window"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
