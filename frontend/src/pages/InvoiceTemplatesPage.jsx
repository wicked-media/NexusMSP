import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FileEdit, Plus, Save, Loader2, Trash2, Star, Eye, GripVertical } from "lucide-react";

const BLOCK_LABELS = {
  logo: "Logo",
  company_info: "Company Info",
  bill_to: "Bill To",
  invoice_meta: "Invoice Meta",
  line_items: "Line Items",
  totals: "Totals",
  payment_terms: "Payment Terms",
  notes: "Notes",
  bank_details: "Bank Details",
  qr_pay: "Pay-online URL",
  thank_you: "Thank-you Message",
  footer: "Footer",
};
const EDITABLE_BLOCKS = new Set(["payment_terms", "notes", "bank_details", "thank_you", "footer"]);
const MERGE_TAGS = ["{{invoice_number}}", "{{client_name}}", "{{due_date}}", "{{issue_date}}", "{{total}}", "{{currency}}", "{{terms_days}}", "{{company_name}}", "{{bank_name}}", "{{bsb}}", "{{account_number}}"];

export default function InvoiceTemplatesPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/invoice-templates`, { headers });
      setList(r.data || []);
    } catch { toast.error("Load failed"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      const r = await axios.post(`${API}/invoice-templates`, { name: "New Template", doc_type: "invoice", layout: "classic" }, { headers });
      setList((l) => [r.data, ...l]);
      setSelected(r.data);
      toast.success("Template created");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const open = async (tpl) => {
    try {
      const r = await axios.get(`${API}/invoice-templates/${tpl.id}`, { headers });
      setSelected(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const r = await axios.put(`${API}/invoice-templates/${selected.id}`, selected, { headers });
      setSelected(r.data);
      load();
      toast.success("Saved");
      refreshPreview();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  const remove = async (tpl) => {
    if (!window.confirm(`Delete "${tpl.name}"?`)) return;
    try {
      await axios.delete(`${API}/invoice-templates/${tpl.id}`, { headers });
      setList((l) => l.filter((x) => x.id !== tpl.id));
      if (selected?.id === tpl.id) setSelected(null);
      toast.success("Deleted");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const setDefault = async (tpl) => {
    try {
      await axios.post(`${API}/invoice-templates/${tpl.id}/set-default`, {}, { headers });
      toast.success(`"${tpl.name}" is now the default for ${tpl.doc_type}`);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const refreshPreview = useCallback(() => {
    if (!selected) return;
    const url = `${API}/invoice-templates/${selected.id}/preview-pdf?token=${encodeURIComponent(token)}&v=${Date.now()}`;
    setPreviewUrl(url);
  }, [selected, token]);

  useEffect(() => { refreshPreview(); }, [refreshPreview]);

  const toggleBlock = (key) => {
    setSelected((s) => ({
      ...s,
      blocks: s.blocks.map((b) => b.key === key ? { ...b, enabled: !b.enabled } : b),
    }));
  };

  const updateBlock = (key, patch) => {
    setSelected((s) => ({
      ...s,
      blocks: s.blocks.map((b) => b.key === key ? { ...b, ...patch } : b),
    }));
  };

  const moveBlock = (key, dir) => {
    setSelected((s) => {
      const blocks = [...s.blocks].sort((a, b) => (a.order || 0) - (b.order || 0));
      const idx = blocks.findIndex((b) => b.key === key);
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= blocks.length) return s;
      [blocks[idx], blocks[newIdx]] = [blocks[newIdx], blocks[idx]];
      return { ...s, blocks: blocks.map((b, i) => ({ ...b, order: i })) };
    });
  };

  return (
    <div className="p-6 space-y-5" data-testid="invoice-templates-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-light tracking-tight flex items-center gap-3">
            <FileEdit className="w-7 h-7 text-emerald-500" />
            Invoice / Estimate Templates
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visual template builder. Toggle blocks, edit copy with merge tags, live PDF preview.
          </p>
        </div>
        <Button onClick={create} variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" data-testid="invoice-tpl-new-btn">
          <Plus className="w-4 h-4 mr-1" /> New Template
        </Button>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Templates list */}
        <Card className="col-span-3">
          <CardContent className="p-2">
            {loading ? <div className="p-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
              : list.length === 0 ? <div className="p-6 text-xs text-muted-foreground text-center">No templates yet</div>
              : (
                <div className="space-y-1">
                  {list.map((tpl) => (
                    <div
                      key={tpl.id}
                      onClick={() => open(tpl)}
                      className={`flex items-center gap-2 rounded p-2 cursor-pointer ${selected?.id === tpl.id ? "bg-emerald-500/10 border border-emerald-500/30" : "hover:bg-muted/40"}`}
                      data-testid={`invoice-tpl-row-${tpl.id}`}
                    >
                      <FileEdit className="w-3.5 h-3.5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate flex items-center gap-1">
                          {tpl.name}
                          {tpl.is_default && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">{tpl.doc_type} · {tpl.layout}</div>
                      </div>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-rose-400" onClick={(e) => { e.stopPropagation(); remove(tpl); }}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  ))}
                </div>
              )}
          </CardContent>
        </Card>

        {/* Editor */}
        <Card className="col-span-5">
          <CardContent className="p-4 space-y-3">
            {!selected ? (
              <div className="text-sm text-muted-foreground text-center py-12">
                Pick a template or create a new one.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Name</Label>
                    <Input value={selected.name} onChange={(e) => setSelected({ ...selected, name: e.target.value })} data-testid="invoice-tpl-name" />
                  </div>
                  <div>
                    <Label className="text-xs">Document type</Label>
                    <Select value={selected.doc_type} onValueChange={(v) => setSelected({ ...selected, doc_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="invoice">Invoice</SelectItem>
                        <SelectItem value="estimate">Estimate</SelectItem>
                        <SelectItem value="qbr">QBR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Layout</Label>
                    <Select value={selected.layout} onValueChange={(v) => setSelected({ ...selected, layout: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["classic", "minimal", "bold", "executive"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Density</Label>
                    <Select value={selected.density || "standard"} onValueChange={(v) => setSelected({ ...selected, density: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["compact", "standard", "spacious"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Primary color</Label>
                    <Input value={selected.primary_color || ""} onChange={(e) => setSelected({ ...selected, primary_color: e.target.value })} placeholder="#10B981" />
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Blocks (toggle + reorder)</div>
                  <div className="space-y-1.5">
                    {[...(selected.blocks || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).map((b) => (
                      <div key={b.key} className={`rounded border ${b.enabled ? "border-emerald-500/30 bg-emerald-500/5" : "border-zinc-800 bg-muted/20"} p-2`} data-testid={`tpl-block-${b.key}`}>
                        <div className="flex items-center gap-2">
                          <button className="text-zinc-500 hover:text-zinc-300" onClick={() => moveBlock(b.key, -1)}>↑</button>
                          <button className="text-zinc-500 hover:text-zinc-300" onClick={() => moveBlock(b.key, 1)}>↓</button>
                          <GripVertical className="w-3 h-3 text-zinc-600" />
                          <span className="text-sm font-medium flex-1">{BLOCK_LABELS[b.key] || b.key}</span>
                          <Switch checked={b.enabled} onCheckedChange={() => toggleBlock(b.key)} data-testid={`tpl-block-toggle-${b.key}`} />
                        </div>
                        {b.enabled && EDITABLE_BLOCKS.has(b.key) && (
                          <Textarea
                            rows={2}
                            value={b.content || ""}
                            onChange={(e) => updateBlock(b.key, { content: e.target.value })}
                            placeholder="Content (use {{merge_tags}})"
                            className="text-xs mt-2"
                            data-testid={`tpl-block-content-${b.key}`}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-muted/30 rounded p-2 text-[10px]">
                  <div className="font-medium mb-1">Available merge tags:</div>
                  <div className="flex flex-wrap gap-1">
                    {MERGE_TAGS.map((t) => <code key={t} className="bg-background rounded px-1 py-0.5 text-[10px] cursor-pointer" onClick={() => navigator.clipboard.writeText(t).then(() => toast.success("Copied"))}>{t}</code>)}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  {!selected.is_default && (
                    <Button size="sm" variant="outline" className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10" onClick={() => setDefault(selected)}>
                      <Star className="w-3 h-3 mr-1" />Make default
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={save} disabled={saving} data-testid="invoice-tpl-save">
                    {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}Save
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Live preview */}
        <Card className="col-span-4">
          <CardContent className="p-2 h-[80vh]">
            <div className="flex items-center justify-between mb-1">
              <Badge variant="outline" className="text-[10px]"><Eye className="w-3 h-3 mr-1" />Live Preview</Badge>
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={refreshPreview}>Refresh</Button>
            </div>
            {previewUrl ? (
              <iframe src={previewUrl} className="w-full h-full border border-zinc-800 rounded bg-white" title="preview" data-testid="invoice-tpl-preview-iframe" />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">Save to see preview</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
