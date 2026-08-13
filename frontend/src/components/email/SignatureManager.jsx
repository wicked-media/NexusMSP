import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import DOMPurify from "dompurify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { toast } from "sonner";
import {
  Bold, Italic, Underline, Link as LinkIcon, Image as ImageIcon,
  AlignLeft, AlignCenter, AlignRight, List, Palette, Trash2, Plus, Check,
  Sparkles, Eye, Loader2, Star, Mail, Send,
} from "lucide-react";

const TEMPLATE_VARS = [
  { key: "{{user.name}}",     label: "Your name" },
  { key: "{{user.first_name}}", label: "First name" },
  { key: "{{user.title}}",    label: "Job title" },
  { key: "{{user.email}}",    label: "Email" },
  { key: "{{user.phone}}",    label: "Phone" },
  { key: "{{company.name}}",  label: "Company" },
  { key: "{{company.website}}", label: "Website" },
  { key: "{{company.phone}}", label: "Company phone" },
  { key: "{{ticket.number}}", label: "Ticket #" },
  { key: "{{client.name}}",   label: "Client name" },
];

const PRESETS = {
  modern: `<table cellpadding="0" cellspacing="0" style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;color:#1f2937;line-height:1.4">
  <tr><td style="padding-right:14px;border-right:3px solid #6366f1">
    <div style="font-size:16px;font-weight:600;color:#111827">{{user.name}}</div>
    <div style="color:#6b7280;font-size:12px">{{user.title}} · {{company.name}}</div>
  </td><td style="padding-left:14px">
    <div style="font-size:12px;color:#374151">📧 <a href="mailto:{{user.email}}" style="color:#6366f1;text-decoration:none">{{user.email}}</a></div>
    <div style="font-size:12px;color:#374151">📞 {{user.phone}}</div>
    <div style="font-size:12px;color:#374151">🌐 <a href="{{company.website}}" style="color:#6366f1;text-decoration:none">{{company.website}}</a></div>
  </td></tr>
</table>`,
  minimal: `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:13px;color:#374151;line-height:1.5">
  <strong style="color:#111827">{{user.name}}</strong><br/>
  {{user.title}} | {{company.name}}<br/>
  <a href="mailto:{{user.email}}" style="color:#6366f1">{{user.email}}</a> · {{user.phone}}
</div>`,
  bold: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.4">
  <div style="background:linear-gradient(90deg,#6366f1,#8b5cf6);color:white;padding:10px 14px;border-radius:6px 6px 0 0;font-weight:700;font-size:14px">{{user.name}}</div>
  <div style="background:#f3f4f6;padding:10px 14px;border-radius:0 0 6px 6px;color:#374151">
    <div style="font-weight:600;color:#111827">{{user.title}}</div>
    <div style="color:#6b7280;font-size:12px">{{company.name}}</div>
    <div style="margin-top:6px;font-size:12px">📞 {{user.phone}} · 📧 <a href="mailto:{{user.email}}" style="color:#6366f1">{{user.email}}</a></div>
  </div>
</div>`,
};

function ToolbarButton({ onClick, children, title, active }) {
  return (
    <button
      type="button" title={title} onClick={onClick}
      className={`px-2 h-7 rounded text-xs flex items-center gap-1 transition-colors ${active ? "bg-violet-500/20 text-violet-300" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"}`}
    >{children}</button>
  );
}

function RichEditor({ value, onChange }) {
  const ref = useRef(null);
  const last = useRef(value);

  useEffect(() => {
    if (ref.current && value !== last.current) {
      ref.current.innerHTML = value || "";
      last.current = value || "";
    }
  }, [value]);

  const exec = (cmd, arg) => {
    document.execCommand(cmd, false, arg);
    ref.current?.focus();
    sync();
  };

  const sync = () => {
    if (!ref.current) return;
    const html = ref.current.innerHTML;
    last.current = html;
    onChange(html);
  };

  const insertVar = (key) => {
    document.execCommand("insertText", false, key);
    sync();
  };

  const insertImage = () => {
    const url = window.prompt("Image URL");
    if (url) exec("insertImage", url);
  };

  const insertLink = () => {
    const url = window.prompt("Link URL", "https://");
    if (url) exec("createLink", url);
  };

  return (
    <div className="border border-zinc-800 rounded-md bg-zinc-950 overflow-hidden">
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-zinc-800 bg-zinc-900/50">
        <ToolbarButton title="Bold" onClick={() => exec("bold")}><Bold className="w-3 h-3" /></ToolbarButton>
        <ToolbarButton title="Italic" onClick={() => exec("italic")}><Italic className="w-3 h-3" /></ToolbarButton>
        <ToolbarButton title="Underline" onClick={() => exec("underline")}><Underline className="w-3 h-3" /></ToolbarButton>
        <span className="w-px h-4 bg-zinc-800 mx-1" />
        <ToolbarButton title="Align left" onClick={() => exec("justifyLeft")}><AlignLeft className="w-3 h-3" /></ToolbarButton>
        <ToolbarButton title="Align center" onClick={() => exec("justifyCenter")}><AlignCenter className="w-3 h-3" /></ToolbarButton>
        <ToolbarButton title="Align right" onClick={() => exec("justifyRight")}><AlignRight className="w-3 h-3" /></ToolbarButton>
        <span className="w-px h-4 bg-zinc-800 mx-1" />
        <ToolbarButton title="Bulleted list" onClick={() => exec("insertUnorderedList")}><List className="w-3 h-3" /></ToolbarButton>
        <ToolbarButton title="Insert link" onClick={insertLink}><LinkIcon className="w-3 h-3" /></ToolbarButton>
        <ToolbarButton title="Insert image" onClick={insertImage}><ImageIcon className="w-3 h-3" /></ToolbarButton>
        <span className="w-px h-4 bg-zinc-800 mx-1" />
        <input type="color" title="Text colour" onChange={(e) => exec("foreColor", e.target.value)} className="w-7 h-7 p-0 bg-transparent border-0 cursor-pointer" />
        <select className="bg-transparent text-xs text-zinc-400 border border-zinc-800 rounded px-1 h-7" defaultValue="" onChange={(e) => { if (e.target.value) { exec("fontName", e.target.value); e.target.value = ""; } }}>
          <option value="">Font…</option>
          <option>Arial</option><option>Helvetica</option><option>Inter</option><option>Segoe UI</option><option>Georgia</option><option>Courier New</option>
        </select>
        <select className="bg-transparent text-xs text-zinc-400 border border-zinc-800 rounded px-1 h-7" defaultValue="" onChange={(e) => { if (e.target.value) { exec("fontSize", e.target.value); e.target.value = ""; } }}>
          <option value="">Size…</option>
          <option value="2">10px</option><option value="3">12px</option><option value="4">14px</option><option value="5">18px</option><option value="6">24px</option>
        </select>
        <span className="w-px h-4 bg-zinc-800 mx-1" />
        <Select value="" onValueChange={insertVar}>
          <SelectTrigger className="h-7 w-[150px] text-xs" data-testid="sig-insert-var">
            <span className="flex items-center gap-1"><Sparkles className="w-3 h-3" />Insert variable</span>
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_VARS.map(v => <SelectItem key={v.key} value={v.key}><span className="font-mono">{v.key}</span> · {v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={sync}
        onBlur={sync}
        className="min-h-[180px] max-h-[400px] overflow-y-auto p-4 text-sm text-zinc-100 focus:outline-none bg-white"
        style={{ color: "#1f2937" }}
        data-testid="sig-rich-editor"
      />
    </div>
  );
}

function PreviewPane({ html, headers }) {
  const [rendered, setRendered] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Use the render endpoint with no signature_id by creating a temp render: just substitute known vars client-side via the user info api
      const u = await axios.get(`${API}/auth/me`, { headers });
      const ctx = {
        "user.name": u.data?.name || "",
        "user.first_name": (u.data?.name || "").split(" ")[0],
        "user.title": u.data?.job_title || "Technician",
        "user.email": u.data?.email || "",
        "user.phone": u.data?.phone || "",
        "company.name": "NexusOps MSP",
        "company.website": "",
        "company.phone": "",
        "ticket.number": "TCK-1234",
        "client.name": "Sample Client Ltd",
      };
      let r = html || "";
      Object.entries(ctx).forEach(([k, v]) => {
        r = r.replaceAll(`{{${k}}}`, v).replaceAll(`{{ ${k} }}`, v);
      });
      setRendered(r);
    } catch { setRendered(html || ""); }
    finally { setLoading(false); }
  }, [html, headers]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="border border-zinc-800 rounded-md bg-white p-4 min-h-[180px]" data-testid="sig-preview">
      {loading ? <Loader2 className="w-4 h-4 animate-spin text-zinc-500" /> :
        <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(rendered, { ADD_ATTR: ["target"] }) }} />}
    </div>
  );
}

export default function SignatureManager() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };

  const [signatures, setSignatures] = useState([]);
  const [editing, setEditing] = useState(null);  // null | "new" | sig object
  const [form, setForm] = useState({ name: "", html: "", scope: "all", is_default: false });
  const [presetOpen, setPresetOpen] = useState(false);
  const [tab, setTab] = useState("edit");
  const [testOpen, setTestOpen] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/email-signatures`, { headers });
      setSignatures(r.data.signatures || []);
    } catch { /* ignore */ }
    // eslint-disable-next-line
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const startNew = () => {
    setEditing("new");
    setForm({ name: "My Signature", html: PRESETS.modern, scope: "all", is_default: signatures.length === 0 });
    setTab("edit");
  };

  const startEdit = (sig) => {
    setEditing(sig);
    setForm({ name: sig.name, html: sig.html, scope: sig.scope || "all", is_default: !!sig.is_default });
    setTab("edit");
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    try {
      if (editing === "new") {
        await axios.post(`${API}/email-signatures`, form, { headers });
        toast.success("Signature created");
      } else {
        await axios.put(`${API}/email-signatures/${editing.id}`, form, { headers });
        toast.success("Signature saved");
      }
      setEditing(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  const del = async (id, confirmed = false) => {
    if (!confirmed) { setDeleteTarget(signatures.find((signature) => signature.id === id) || null); return; }
    try {
      await axios.delete(`${API}/email-signatures/${id}`, { headers });
      toast.success("Deleted");
      setDeleteTarget(null);
      load();
    } catch { toast.error("Failed"); }
  };

  const setDefault = async (id) => {
    try {
      await axios.post(`${API}/email-signatures/${id}/set-default`, {}, { headers });
      toast.success("Default updated");
      load();
    } catch { toast.error("Failed"); }
  };

  const sendTest = async () => {
    setTestSending(true);
    try {
      const r = await axios.post(`${API}/email-signatures/send-test`, { to_email: testRecipient }, { headers });
      toast.success(`Test sent to ${r.data.recipient}`);
      setTestOpen(false);
      setTestRecipient("");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not send test"); }
    finally { setTestSending(false); }
  };

  return (
    <div className="space-y-4" data-testid="signature-manager">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Mail className="w-4 h-4" />Email Signatures</CardTitle>
            <p className="text-xs text-zinc-500 mt-1">Rich signatures are rendered server-side for technician-sent tickets, field and workshop updates, invoices, leads, and purchase orders.</p>
          </div>
          <div className="flex items-center gap-2"><Button size="sm" variant="ghost" onClick={() => setTestOpen(true)} disabled={!signatures.some(s => s.is_default)} data-testid="sig-test-btn"><Send className="w-3 h-3 mr-1" />Send test</Button><Button size="sm" variant="outline" className="text-violet-300 border-violet-500/40 hover:bg-violet-500/10" onClick={startNew} data-testid="sig-new-btn"><Plus className="w-3 h-3 mr-1" />New</Button></div>
        </CardHeader>
        <CardContent>
          {signatures.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-6">No signatures yet. Click <strong>New</strong> to create one.</p>
          ) : (
            <div className="space-y-2">
              {signatures.map(s => (
                <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-md border border-zinc-800 hover:border-zinc-700" data-testid={`sig-row-${s.id}`}>
                  <div className="w-8 h-8 rounded-md bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 border border-violet-500/30 flex items-center justify-center">
                    <Mail className="w-4 h-4 text-violet-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{s.name}</span>
                      {s.is_default && <Badge variant="outline" className="text-[9px] uppercase text-amber-300 border-amber-500/40"><Star className="w-2.5 h-2.5 mr-0.5" />default</Badge>}
                      <Badge variant="outline" className="text-[9px] uppercase text-zinc-500">{s.scope || "all"}</Badge>
                    </div>
                  </div>
                  {!s.is_default && (
                    <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setDefault(s.id)} data-testid={`sig-default-${s.id}`}>Set default</Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => startEdit(s)} data-testid={`sig-edit-${s.id}`}>Edit</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-rose-400" onClick={() => del(s.id)} data-testid={`sig-delete-${s.id}`}><Trash2 className="w-3 h-3" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-4xl" data-testid="sig-editor-dialog">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New Signature" : "Edit Signature"}</DialogTitle>
            <DialogDescription>Tip: use template variables — they're substituted on send.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Signature name (e.g. Default external)" data-testid="sig-name-input" />
              <Select value={form.scope} onValueChange={v => setForm({ ...form, scope: v })}>
                <SelectTrigger data-testid="sig-scope-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All emails</SelectItem>
                  <SelectItem value="new">New emails only</SelectItem>
                  <SelectItem value="reply">Replies only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={form.is_default} onChange={e => setForm({ ...form, is_default: e.target.checked })} data-testid="sig-default-cb" />
                Set as default (auto-applied to all ticket emails)
              </label>
              <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setPresetOpen(o => !o)} data-testid="sig-presets-btn">
                <Palette className="w-3 h-3 mr-1" />Presets
              </Button>
            </div>
            {presetOpen && (
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(PRESETS).map(([key, html]) => (
                  <button
                    key={key} type="button"
                    className="border border-zinc-800 rounded p-2 hover:border-violet-500/40 transition-colors text-left bg-white"
                    onClick={() => { setForm(f => ({ ...f, html })); setPresetOpen(false); toast.success(`Applied "${key}" preset`); }}
                    data-testid={`sig-preset-${key}`}
                  >
                    <div className="text-[10px] uppercase tracking-widest text-zinc-700 font-bold mb-1">{key}</div>
                    <div className="scale-75 origin-top-left text-xs" style={{ width: "133%", maxHeight: 100, overflow: "hidden" }}
                         dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html.replaceAll("{{user.name}}", "John Smith").replaceAll("{{user.title}}", "Senior Engineer").replaceAll("{{user.email}}", "john@msp.com").replaceAll("{{user.phone}}", "+64 9 123 4567").replaceAll("{{company.name}}", "Acme MSP").replaceAll("{{company.website}}", "acme.io")) }} />
                  </button>
                ))}
              </div>
            )}

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="edit" data-testid="sig-tab-edit">Edit</TabsTrigger>
                <TabsTrigger value="preview" data-testid="sig-tab-preview"><Eye className="w-3 h-3 mr-1" />Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="edit" className="mt-2">
                <RichEditor value={form.html} onChange={(html) => setForm(f => ({ ...f, html }))} />
                <p className="text-[10px] text-zinc-500 mt-1 font-mono">Variables: {TEMPLATE_VARS.map(v => v.key).join(" · ")}</p>
              </TabsContent>
              <TabsContent value="preview" className="mt-2">
                <PreviewPane html={form.html} headers={headers} />
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} variant="outline" className="text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10" data-testid="sig-save-btn"><Check className="w-3 h-3 mr-1" />Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="max-w-md" data-testid="sig-test-dialog">
          <DialogHeader><DialogTitle>Send signature test</DialogTitle><DialogDescription>This sends a real Microsoft 365 email using your current default signature. No message is sent until you confirm.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>Send test to</Label><Input type="email" value={testRecipient} onChange={e => setTestRecipient(e.target.value)} placeholder="you@example.com" data-testid="sig-test-recipient" /></div>
          <DialogFooter><Button variant="ghost" onClick={() => setTestOpen(false)}>Cancel</Button><Button onClick={sendTest} disabled={testSending || !testRecipient.trim()}><Send className="w-3 h-3 mr-1" />{testSending ? "Sending…" : "Send test"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <NexusWorkflowDialog
          eyebrow="Communication identity"
          title="Delete email signature?"
          description="This removes the signature from technician communication options. Choose another default signature first if this one is still actively assigned."
          icon={Trash2}
          tone="amber"
          footer={<><Button variant="outline" onClick={() => setDeleteTarget(null)}>Keep signature</Button><Button variant="destructive" onClick={() => del(deleteTarget?.id, true)}>Delete signature</Button></>}
        >
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4"><p className="font-medium">{deleteTarget?.name || "Selected signature"}</p><p className="mt-1 text-sm text-muted-foreground">Scope: {deleteTarget?.scope || "all outgoing communications"}{deleteTarget?.is_default ? " · currently the default signature" : ""}.</p></div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}
