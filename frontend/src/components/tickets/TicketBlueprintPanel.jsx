import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Clipboard, CheckCircle2, Circle, Wand2, ListChecks, AlertTriangle, Loader2 } from "lucide-react";

/**
 * Renders the active blueprint worksheet (fields + checklist) for a ticket.
 * If no blueprint applied, shows apply-blueprint picker (respects the client's assigned blueprints).
 */
export default function TicketBlueprintPanel({ ticket, onTicketUpdated }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [bp, setBp] = useState(null);
  const [loadingBp, setLoadingBp] = useState(false);
  const [clientBps, setClientBps] = useState([]);
  const [allBps, setAllBps] = useState([]);
  const [picked, setPicked] = useState("");
  const [applying, setApplying] = useState(false);
  const [dirty, setDirty] = useState({});
  const [saving, setSaving] = useState(false);

  const loadBp = useCallback(async (id) => {
    if (!id) { setBp(null); return; }
    setLoadingBp(true);
    try {
      const res = await axios.get(`${API}/blueprints/${id}`, { headers });
      setBp(res.data);
    } catch { setBp(null); }
    finally { setLoadingBp(false); }
  }, [headers]);

  useEffect(() => {
    if (ticket?.blueprint_id) loadBp(ticket.blueprint_id);
    else setBp(null);
  }, [ticket?.blueprint_id, loadBp]);

  useEffect(() => {
    // Load all blueprints + the client's eligible list to power the picker
    if (ticket?.blueprint_id) return;
    (async () => {
      try {
        const [all, clientRes] = await Promise.all([
          axios.get(`${API}/blueprints?active_only=true`, { headers }),
          ticket?.client_id ? axios.get(`${API}/clients/${ticket.client_id}/blueprints`, { headers }) : Promise.resolve({ data: { blueprints: [] } }),
        ]);
        setAllBps(all.data || []);
        setClientBps(clientRes.data?.blueprints || []);
      } catch { /* noop */ }
    })();
  }, [ticket?.blueprint_id, ticket?.client_id, headers]);

  const apply = async () => {
    if (!picked) return;
    setApplying(true);
    try {
      const res = await axios.post(`${API}/tickets/${ticket.id}/apply-blueprint`, { blueprint_id: picked }, { headers });
      toast.success("Blueprint applied");
      onTicketUpdated && onTicketUpdated(res.data);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setApplying(false); }
  };

  const updateField = (key, val) => setDirty((d) => ({ ...d, [key]: val }));

  const saveFields = async () => {
    if (Object.keys(dirty).length === 0) return;
    setSaving(true);
    try {
      const res = await axios.put(`${API}/tickets/${ticket.id}/blueprint-fields`, { fields: dirty }, { headers });
      toast.success("Worksheet saved");
      onTicketUpdated && onTicketUpdated({ ...ticket, blueprint_fields: res.data.blueprint_fields });
      setDirty({});
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  const toggleChecklist = async (itemId) => {
    try {
      const res = await axios.post(`${API}/tickets/${ticket.id}/blueprint-checklist/${itemId}/toggle`, {}, { headers });
      onTicketUpdated && onTicketUpdated({ ...ticket, blueprint_checklist: res.data.checklist });
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  // Empty state: no blueprint applied
  if (!ticket?.blueprint_id) {
    const options = clientBps.length > 0 ? clientBps : allBps;
    return (
      <div className="rounded-xl border border-dashed border-sky-500/30 bg-sky-500/5 p-6 text-center" data-testid="blueprint-panel-empty">
        <Clipboard className="w-8 h-8 text-sky-400 mx-auto mb-2" />
        <div className="text-sm font-medium">No blueprint applied</div>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Blueprints add a structured worksheet + checklist to a ticket. Apply one to standardise the workflow.
        </p>
        {options.length === 0 ? (
          <div className="text-xs text-muted-foreground">No blueprints available yet.</div>
        ) : (
          <div className="flex items-center justify-center gap-2 max-w-md mx-auto">
            <Select value={picked} onValueChange={setPicked}>
              <SelectTrigger className="h-8 text-xs" data-testid="blueprint-picker">
                <SelectValue placeholder="Pick a blueprint…" />
              </SelectTrigger>
              <SelectContent>
                {options.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
              disabled={!picked || applying}
              onClick={apply}
              data-testid="blueprint-apply-btn"
            >
              {applying ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Wand2 className="w-3 h-3 mr-1" />}Apply
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (loadingBp || !bp) {
    return <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading worksheet…</div>;
  }

  const fields = bp.fields || [];
  const checklist = ticket.blueprint_checklist || [];
  const totalCl = checklist.length || 1;
  const doneCl = checklist.filter((c) => c.done).length;
  const requiredDone = checklist.filter((c) => c.required && c.done).length;
  const requiredTotal = checklist.filter((c) => c.required).length;
  const pct = Math.round((doneCl / totalCl) * 100);
  const requiredBlocking = bp.require_completion && (requiredDone < requiredTotal);

  const value = (key) => (key in dirty ? dirty[key] : (ticket.blueprint_fields || {})[key] ?? "");

  return (
    <div className="space-y-4" data-testid="blueprint-panel">
      <div className="flex items-center justify-between rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <Clipboard className="w-5 h-5 text-sky-400" />
          <div>
            <div className="text-sm font-medium">{bp.name}</div>
            <div className="text-[10px] text-muted-foreground">
              Applied · {fields.length} fields · {checklist.length} checklist items
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {bp.require_completion && (
            <Badge variant="outline" className="text-amber-400 border-amber-500/30 text-[9px]">
              <AlertTriangle className="w-2.5 h-2.5 mr-1" />Blocks resolve
            </Badge>
          )}
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Progress</div>
            <div className="text-sm font-mono">{pct}%</div>
          </div>
        </div>
      </div>

      {requiredBlocking && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300 flex items-center gap-2">
          <AlertTriangle className="w-3 h-3" /> {requiredTotal - requiredDone} required checklist item(s) remaining before this ticket can be resolved.
        </div>
      )}

      {/* Worksheet fields */}
      {fields.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-background/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              <Wand2 className="w-3 h-3" /> Worksheet
            </div>
            {Object.keys(dirty).length > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-[11px] text-sky-400 border-sky-500/30 hover:bg-sky-500/10" onClick={saveFields} disabled={saving} data-testid="blueprint-save-fields">
                {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                Save {Object.keys(dirty).length} change{Object.keys(dirty).length > 1 ? "s" : ""}
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className={f.type === "textarea" ? "col-span-2" : ""} data-testid={`blueprint-field-${f.key}`}>
                <Label className="text-xs flex items-center gap-1">
                  {f.label}
                  {f.required && <span className="text-rose-400">*</span>}
                </Label>
                {f.type === "textarea" ? (
                  <Textarea rows={3} value={value(f.key)} onChange={(e) => updateField(f.key, e.target.value)} placeholder={f.placeholder} className="text-sm" />
                ) : f.type === "select" ? (
                  <Select value={String(value(f.key) || "")} onValueChange={(v) => updateField(f.key, v)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {(f.options || []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : f.type === "checkbox" ? (
                  <div className="flex items-center gap-2 pt-2">
                    <input type="checkbox" checked={!!value(f.key)} onChange={(e) => updateField(f.key, e.target.checked)} className="accent-sky-500" />
                    <span className="text-xs text-muted-foreground">{f.placeholder || f.label}</span>
                  </div>
                ) : (
                  <Input
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    value={value(f.key)}
                    onChange={(e) => updateField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="h-9 text-sm"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Checklist */}
      {checklist.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-background/40 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              <ListChecks className="w-3 h-3" /> Checklist · {doneCl}/{totalCl}
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">{requiredDone}/{requiredTotal} required</div>
          </div>
          <div className="space-y-1">
            {checklist.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleChecklist(c.id)}
                className="w-full flex items-start gap-2 text-left bg-muted/20 hover:bg-muted/40 rounded px-2 py-1.5 transition-colors"
                data-testid={`blueprint-checklist-item-${c.id}`}
              >
                {c.done ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" /> : <Circle className="w-4 h-4 text-zinc-600 mt-0.5 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${c.done ? "line-through text-muted-foreground" : ""}`}>
                    {c.label}{c.required && <span className="text-rose-400 ml-1">*</span>}
                  </div>
                  {c.done && c.done_by && (
                    <div className="text-[9px] text-muted-foreground">{c.done_by} · {new Date(c.done_at).toLocaleString()}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
