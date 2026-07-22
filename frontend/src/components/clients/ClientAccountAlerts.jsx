import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, BellRing, CalendarClock, CheckCircle2, CircleAlert, FileText, Info, Loader2, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

const EMPTY_FORM = { title: "", body: "", alert_level: "warning", expires_at: "" };
const LEVELS = {
  critical: { icon: ShieldAlert, label: "Critical acknowledgement", short: "Critical", tone: "border-rose-400/35 bg-rose-500/[0.12] text-rose-100", header: "from-rose-500/[0.16] via-rose-500/[0.05] to-background", helper: "This account has a critical instruction. Your acknowledgement is recorded against this client." },
  warning: { icon: AlertTriangle, label: "Attention required", short: "Attention", tone: "border-amber-400/35 bg-amber-500/[0.12] text-amber-100", header: "from-amber-500/[0.16] via-amber-500/[0.05] to-background", helper: "Review this instruction before working on the account." },
  info: { icon: Info, label: "Account information", short: "Information", tone: "border-sky-400/30 bg-sky-500/[0.10] text-sky-100", header: "from-sky-500/[0.14] via-sky-500/[0.05] to-background", helper: "This is a recorded operational note for this account." },
};
const priority = { critical: 0, warning: 1, info: 2 };
const isActive = (note) => !(!note.show_on_open && !note.pinned) && (!note.expires_at || new Date(`${note.expires_at}T23:59:59.999`) >= new Date());
const noteTitle = (note) => note?.title?.trim() || LEVELS[note?.alert_level]?.label || "Account pop-up";

export default function ClientAccountAlerts({ client }) {
  const { token, user } = useAuth();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const seenNotice = useRef("");
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    if (!client?.id) return;
    setLoading(true);
    try {
      const response = await axios.get(`${API}/clients/${client.id}/notes`, { headers });
      setNotes(response.data || []);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [client?.id, headers]);

  useEffect(() => { load(); }, [load]);

  const alerts = useMemo(() => notes.filter(isActive).sort((left, right) => (priority[left.alert_level] ?? 9) - (priority[right.alert_level] ?? 9) || new Date(right.updated_at || right.created_at || 0) - new Date(left.updated_at || left.created_at || 0)), [notes]);
  const primary = alerts[0];
  const meta = LEVELS[primary?.alert_level] || LEVELS.info;
  const NoticeIcon = meta.icon;
  const acknowledged = primary?.acknowledgements?.some((entry) => entry.user_id === user?.id);

  useEffect(() => {
    if (!primary?.id || !client?.id) { setNoticeOpen(false); return; }
    const key = `${client.id}:${primary.id}:${primary.updated_at || primary.created_at || ""}`;
    if (seenNotice.current !== key) {
      seenNotice.current = key;
      setNoticeOpen(true);
    }
  }, [client?.id, primary?.id, primary?.updated_at, primary?.created_at]);

  const closeEditor = () => { setEditorOpen(false); setEditing(null); setForm(EMPTY_FORM); };
  const openEditor = (note = null) => {
    setNoticeOpen(false);
    setEditing(note);
    setForm(note ? { title: note.title || "", body: note.body || "", alert_level: note.alert_level || "warning", expires_at: note.expires_at ? String(note.expires_at).slice(0, 10) : "" } : EMPTY_FORM);
    setEditorOpen(true);
  };
  const requestCloseNotice = (nextOpen) => {
    if (!nextOpen && primary?.alert_level === "critical" && !acknowledged) {
      toast.error("Acknowledge the critical account instruction before continuing.");
      return;
    }
    setNoticeOpen(nextOpen);
  };

  const saveAlert = async () => {
    if (form.body.trim().length < 4) { toast.error("Add a clear account instruction before saving."); return; }
    setSaving(true);
    const payload = { title: form.title.trim(), body: form.body.trim(), alert_level: form.alert_level, expires_at: form.expires_at || null, pinned: true, show_on_open: true };
    try {
      if (editing?.id) {
        await axios.put(`${API}/clients/${client.id}/notes/${editing.id}`, payload, { headers });
        toast.success("Account pop-up updated and audited");
      } else {
        await axios.post(`${API}/clients/${client.id}/notes`, payload, { headers });
        toast.success("Account pop-up saved and audited");
      }
      closeEditor();
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not save the account pop-up");
    } finally { setSaving(false); }
  };

  const deleteAlert = async () => {
    if (!editing?.id) return;
    setDeleting(true);
    try {
      await axios.delete(`${API}/clients/${client.id}/notes/${editing.id}`, { headers });
      toast.success("Account pop-up removed and audited");
      closeEditor();
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not remove the account pop-up");
    } finally { setDeleting(false); }
  };

  const acknowledge = async () => {
    if (!primary?.id) return;
    setAcknowledging(true);
    try {
      await axios.post(`${API}/clients/${client.id}/notes/${primary.id}/acknowledge`, { context: "client_workspace" }, { headers });
      toast.success("Critical account instruction acknowledged and recorded");
      setNoticeOpen(false);
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record acknowledgement");
    } finally { setAcknowledging(false); }
  };

  const selectedMeta = LEVELS[form.alert_level] || LEVELS.warning;
  const SelectedIcon = selectedMeta.icon;

  return <>
    {!loading && <Button size="sm" variant="outline" className="h-8 border-white/20 bg-black/15 text-xs text-white hover:bg-white/10" onClick={() => primary ? setNoticeOpen(true) : openEditor()} data-testid={primary ? "open-account-alert" : "add-account-alert"}><BellRing className="mr-1.5 h-3.5 w-3.5" />{primary ? "Account notices" : "Add account pop-up"}{alerts.length > 1 && <Badge className="ml-1 h-4 min-w-4 rounded-full border-white/15 bg-white/10 px-1 text-[9px] text-white">{alerts.length}</Badge>}</Button>}

    <Dialog open={noticeOpen} onOpenChange={requestCloseNotice}>
      <DialogContent className="max-w-2xl overflow-hidden p-0" data-testid="client-account-notice-overlay">
        <div className={`border-b border-border bg-gradient-to-br px-6 py-5 ${meta.header}`}>
          <DialogHeader><div className="flex items-start gap-3"><span className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${meta.tone}`}><NoticeIcon className="h-5 w-5" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={`text-[9px] uppercase tracking-[0.14em] ${meta.tone}`}>{meta.short}</Badge><span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Account pop-up</span></div><DialogTitle className="mt-2 text-xl leading-tight">{noteTitle(primary)}</DialogTitle><DialogDescription className="mt-1">{client?.name} / operational instruction shown when this profile opens</DialogDescription></div></div></DialogHeader>
        </div>
        {primary && <div className="space-y-5 px-6 py-5"><div className="rounded-xl border border-border bg-muted/20 p-4"><p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{primary.body}</p></div><div className="grid gap-3 sm:grid-cols-2"><div className="flex gap-2 rounded-xl border border-border bg-card/50 p-3"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div><p className="text-xs font-semibold">Visibility</p><p className="mt-0.5 text-[11px] text-muted-foreground">{primary.expires_at ? `Visible through ${new Date(`${primary.expires_at}T00:00:00`).toLocaleDateString()}` : "Persistent until edited or removed"}</p></div></div><div className="flex gap-2 rounded-xl border border-border bg-card/50 p-3"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div><p className="text-xs font-semibold">Recorded by</p><p className="mt-0.5 text-[11px] text-muted-foreground">{primary.author_name || "NexusMSP"}{primary.created_at ? ` / ${new Date(primary.created_at).toLocaleDateString()}` : ""}</p></div></div></div>{primary.alert_level === "critical" && <div className="rounded-xl border border-rose-400/25 bg-rose-500/[0.07] p-3 text-xs text-rose-100"><div className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><p>{acknowledged ? "You have already acknowledged this instruction. Your acknowledgement remains in the client audit history." : "Acknowledgement is required. Select the acknowledgement action below to record that you have read this instruction."}</p></div></div>}</div>}
        <DialogFooter className="border-t border-border bg-muted/10 px-6 py-4 sm:justify-between"><Button variant="ghost" onClick={() => openEditor(primary)}><Pencil className="mr-1.5 h-4 w-4" />Manage notices</Button>{primary?.alert_level === "critical" && !acknowledged ? <Button onClick={acknowledge} disabled={acknowledging} className="bg-rose-500 text-white hover:bg-rose-400" data-testid="acknowledge-account-alert">{acknowledging ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}I have read and acknowledge</Button> : <Button onClick={() => setNoticeOpen(false)}>Continue to account</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={editorOpen} onOpenChange={(next) => { if (!next) closeEditor(); else setEditorOpen(true); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-0" data-testid="account-alert-dialog">
        <div className="border-b border-border bg-gradient-to-br from-amber-500/[0.10] via-background to-background px-6 py-5"><DialogHeader><div className="flex items-start gap-3"><span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-400/[0.12]"><BellRing className="h-5 w-5 text-amber-200" /></span><div><DialogTitle className="text-lg">{editing ? "Edit account pop-up" : "Create account pop-up"}</DialogTitle><DialogDescription className="mt-1 max-w-xl">This becomes the polished profile overlay technicians see when they open {client?.name}.</DialogDescription></div></div></DialogHeader></div>
        <div className="space-y-5 px-6 py-5"><div className="grid gap-4 md:grid-cols-[1fr_210px]"><div className="space-y-1.5"><Label htmlFor="account-alert-title">Headline <span className="text-muted-foreground">(optional)</span></Label><Input id="account-alert-title" value={form.title} maxLength={120} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Site access approval required" /></div><div className="space-y-1.5"><Label>Visibility level</Label><Select value={form.alert_level} onValueChange={(alert_level) => setForm((current) => ({ ...current, alert_level }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="critical">Critical acknowledgement</SelectItem><SelectItem value="warning">Attention required</SelectItem><SelectItem value="info">Account information</SelectItem></SelectContent></Select></div></div><div className="space-y-1.5"><Label htmlFor="account-alert-body">Technician instruction</Label><Textarea id="account-alert-body" rows={6} value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} placeholder="State the instruction, why it matters, who to contact, and what needs approval before work begins." data-testid="account-alert-body" /><p className="text-[11px] text-muted-foreground">The instruction is shown as an account overlay, not buried in notes.</p></div><div className="grid gap-4 md:grid-cols-[1fr_1.35fr]"><div className="space-y-1.5"><Label htmlFor="account-alert-expires">Expires after</Label><Input id="account-alert-expires" type="date" min={new Date().toISOString().slice(0, 10)} value={form.expires_at} onChange={(event) => setForm((current) => ({ ...current, expires_at: event.target.value }))} /><p className="text-[11px] text-muted-foreground">Leave blank for a persistent notice.</p></div><div className="rounded-xl border border-border bg-muted/20 p-3"><div className="flex gap-2"><SelectedIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" /><div><p className="text-xs font-semibold">{selectedMeta.label}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{selectedMeta.helper}</p></div></div></div></div>{alerts.length > 1 && <div className="rounded-xl border border-border bg-muted/10 p-3"><div className="mb-2 flex items-center gap-2"><CircleAlert className="h-4 w-4 text-muted-foreground" /><p className="text-xs font-semibold">Other active account pop-ups</p></div><div className="space-y-1">{alerts.filter((note) => note.id !== editing?.id).map((note) => <button key={note.id} type="button" onClick={() => openEditor(note)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-xs hover:bg-muted/50"><span className="truncate">{noteTitle(note)}</span><Badge variant="outline" className="text-[9px]">{LEVELS[note.alert_level]?.short || "Info"}</Badge></button>)}</div></div>}</div>
        <DialogFooter className="border-t border-border bg-muted/10 px-6 py-4 sm:justify-between"><div>{editing && <Button variant="ghost" className="text-rose-300 hover:bg-rose-500/10 hover:text-rose-200" onClick={deleteAlert} disabled={saving || deleting}>{deleting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}Remove pop-up</Button>}</div><div className="flex gap-2"><Button variant="outline" onClick={closeEditor} disabled={saving || deleting}>Cancel</Button><Button onClick={saveAlert} disabled={saving || deleting || form.body.trim().length < 4}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : editing ? <Pencil className="mr-1.5 h-4 w-4" /> : <Plus className="mr-1.5 h-4 w-4" />}{editing ? "Save changes" : "Save account pop-up"}</Button></div></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
