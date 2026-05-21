import { useEffect, useMemo, useState, useCallback, useRef } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import {
  FileEdit, Plus, Save, Loader2, Trash2, Star, Eye, GripVertical, Copy,
  LayoutGrid, Wrench, Sparkles, PaintBucket, FileText, Receipt, ScanLine, FileSignature,
  Minus, MoveVertical, Type, Image as ImageIcon, Tag,
} from "lucide-react";

const MERGE_TAGS = [
  "{{invoice_number}}", "{{client_name}}", "{{due_date}}", "{{issue_date}}",
  "{{total}}", "{{subtotal}}", "{{tax_total}}", "{{amount_paid}}", "{{balance_due}}",
  "{{currency}}", "{{terms_days}}", "{{company_name}}", "{{company_email}}", "{{company_phone}}",
  "{{abn}}", "{{bank_name}}", "{{bsb}}", "{{account_number}}", "{{payment_link}}", "{{tier_name}}",
];

const PRESET_ICONS = {
  tactical_dark: { icon: ScanLine, gradient: "from-emerald-500/30 to-slate-900" },
  modern_executive: { icon: FileSignature, gradient: "from-blue-500/30 to-cyan-500/20" },
  minimalist_white: { icon: FileText, gradient: "from-zinc-200/20 to-zinc-400/10" },
  corporate_blue: { icon: Receipt, gradient: "from-blue-700/30 to-blue-400/20" },
  bold_branded: { icon: Sparkles, gradient: "from-red-500/30 to-amber-500/20" },
  compact_tax_compliant: { icon: Tag, gradient: "from-emerald-600/30 to-emerald-400/20" },
  service_detailed: { icon: LayoutGrid, gradient: "from-purple-600/30 to-violet-400/20" },
  tier_themed: { icon: PaintBucket, gradient: "from-amber-600/30 to-amber-400/20" },
  pro_forma: { icon: FileEdit, gradient: "from-cyan-600/30 to-cyan-400/20" },
  customer_statement: { icon: FileText, gradient: "from-slate-700/30 to-slate-500/20" },
};

export default function InvoiceTemplatesPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [view, setView] = useState("gallery"); // 'gallery' | 'builder'
  const [gallery, setGallery] = useState([]);
  const [list, setList] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [editorTab, setEditorTab] = useState("blocks");
  const dragKey = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, l, c] = await Promise.all([
        axios.get(`${API}/invoice-templates/gallery`, { headers }),
        axios.get(`${API}/invoice-templates?include_presets=false`, { headers }),
        axios.get(`${API}/invoice-templates/blocks/catalog`, { headers }),
      ]);
      setGallery(g.data || []);
      setList(l.data || []);
      setCatalog(c.data || []);
    } catch { toast.error("Load failed"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const clonePreset = async (preset_key) => {
    try {
      const r = await axios.post(`${API}/invoice-templates/clone/${preset_key}`, {}, { headers });
      setList((l) => [r.data, ...l]);
      setSelected(r.data);
      setView("builder");
      toast.success(`Cloned ${r.data.name}`);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const createBlank = async () => {
    try {
      const r = await axios.post(`${API}/invoice-templates`, { name: "Untitled Template", doc_type: "invoice", layout: "classic" }, { headers });
      setList((l) => [r.data, ...l]);
      setSelected(r.data);
      setView("builder");
      toast.success("Template created");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const open = async (tpl) => {
    try {
      const r = await axios.get(`${API}/invoice-templates/${tpl.id}`, { headers });
      setSelected(r.data);
      setView("builder");
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
      if (selected?.id === tpl.id) { setSelected(null); setView("gallery"); }
      toast.success("Deleted");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const duplicate = async (tpl) => {
    try {
      const r = await axios.post(`${API}/invoice-templates/${tpl.id}/duplicate`, {}, { headers });
      setList((l) => [r.data, ...l]);
      setSelected(r.data);
      toast.success("Duplicated");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const setDefault = async (tpl) => {
    try {
      await axios.post(`${API}/invoice-templates/${tpl.id}/set-default`, {}, { headers });
      toast.success(`"${tpl.name}" is now default for ${tpl.doc_type}`);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const refreshPreview = useCallback(() => {
    if (!selected) return;
    const url = `${API}/invoice-templates/${selected.id}/preview-pdf?token=${encodeURIComponent(token)}&v=${Date.now()}`;
    setPreviewUrl(url);
  }, [selected, token]);

  useEffect(() => { refreshPreview(); }, [refreshPreview]);

  // ───────── Block helpers ─────────
  const toggleBlock = (key) => {
    setSelected((s) => ({
      ...s,
      blocks: (s.blocks || []).map((b) => b.key === key ? { ...b, enabled: !b.enabled } : b),
    }));
  };

  const updateBlock = (key, patch) => {
    setSelected((s) => ({
      ...s,
      blocks: (s.blocks || []).map((b) => b.key === key ? { ...b, ...patch } : b),
    }));
  };

  const updateBlockStyle = (key, stylePatch) => {
    setSelected((s) => ({
      ...s,
      blocks: (s.blocks || []).map((b) => b.key === key ? { ...b, style: { ...(b.style || {}), ...stylePatch } } : b),
    }));
  };

  const reorderBlock = (fromKey, toKey) => {
    setSelected((s) => {
      const blocks = [...(s.blocks || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
      const fromIdx = blocks.findIndex((b) => b.key === fromKey);
      const toIdx = blocks.findIndex((b) => b.key === toKey);
      if (fromIdx === -1 || toIdx === -1) return s;
      const [moved] = blocks.splice(fromIdx, 1);
      blocks.splice(toIdx, 0, moved);
      return { ...s, blocks: blocks.map((b, i) => ({ ...b, order: i })) };
    });
  };

  const updatePage = (patch) => setSelected((s) => ({ ...s, page: { ...(s.page || {}), ...patch } }));

  // ─────────────────────────── Render ───────────────────────────
  return (
    <div className="p-6 space-y-5" data-testid="invoice-templates-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-light tracking-tight flex items-center gap-3">
            <FileEdit className="w-7 h-7 text-emerald-500" />
            Invoice Studio
            <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">Block-by-Block Builder</Badge>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Designer gallery, drag-and-drop blocks, per-block styling, page settings, live PDF preview.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setView(view === "gallery" ? "builder" : "gallery")} data-testid="invoice-studio-toggle-view">
            {view === "gallery" ? <Wrench className="w-4 h-4 mr-1" /> : <LayoutGrid className="w-4 h-4 mr-1" />}
            {view === "gallery" ? "My Templates" : "Gallery"}
          </Button>
          <Button onClick={createBlank} variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" data-testid="invoice-tpl-new-btn">
            <Plus className="w-4 h-4 mr-1" /> Blank Template
          </Button>
        </div>
      </div>

      {view === "gallery" ? (
        <GalleryView gallery={gallery} list={list} loading={loading} clonePreset={clonePreset} open={open} remove={remove} duplicate={duplicate} setDefault={setDefault} />
      ) : (
        <BuilderView
          selected={selected} setSelected={setSelected} list={list} catalog={catalog}
          loading={loading} saving={saving} open={open} save={save} remove={remove} duplicate={duplicate}
          setDefault={setDefault} previewUrl={previewUrl} refreshPreview={refreshPreview}
          editorTab={editorTab} setEditorTab={setEditorTab}
          toggleBlock={toggleBlock} updateBlock={updateBlock} updateBlockStyle={updateBlockStyle}
          reorderBlock={reorderBlock} updatePage={updatePage} dragKey={dragKey}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════ Gallery View ════════════════════════════════════════
function GalleryView({ gallery, list, loading, clonePreset, open, remove, duplicate, setDefault }) {
  if (loading) return <div className="p-12 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <h2 className="text-base font-medium">Designer Gallery</h2>
          <Badge variant="outline" className="text-[10px]">{gallery.length} presets</Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {gallery.map((p) => {
            const meta = PRESET_ICONS[p.preset_key] || { icon: FileEdit, gradient: "from-emerald-500/20 to-slate-800" };
            const Icon = meta.icon;
            return (
              <Card key={p.id} className={`relative overflow-hidden cursor-pointer hover:ring-2 hover:ring-emerald-500/40 transition-all bg-gradient-to-br ${meta.gradient}`} onClick={() => clonePreset(p.preset_key)} data-testid={`preset-${p.preset_key}`}>
                <CardContent className="p-4 h-44 flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <Icon className="w-7 h-7 text-white/80" />
                    <Badge variant="outline" className="text-[9px] bg-black/30 border-white/10 text-white">{p.doc_type}</Badge>
                  </div>
                  <div>
                    <div className="font-semibold text-white text-sm">{p.name}</div>
                    <div className="text-[11px] text-white/70 mt-1 line-clamp-2">{p.description}</div>
                    <Button size="sm" className="mt-3 h-7 text-[11px] bg-emerald-500/80 hover:bg-emerald-500 text-white border-0" data-testid={`clone-${p.preset_key}`}>
                      <Copy className="w-3 h-3 mr-1" /> Use this design
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <FileEdit className="w-4 h-4 text-zinc-400" />
          <h2 className="text-base font-medium">My Templates</h2>
          <Badge variant="outline" className="text-[10px]">{list.length}</Badge>
        </div>
        {list.length === 0 ? (
          <div className="text-xs text-muted-foreground p-6 border border-dashed border-zinc-800 rounded">No templates yet — clone a preset above, or create a Blank Template.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((tpl) => (
              <Card key={tpl.id} className="cursor-pointer hover:ring-1 hover:ring-emerald-500/30" data-testid={`tpl-card-${tpl.id}`}>
                <CardContent className="p-3 flex items-center gap-2">
                  <FileEdit className="w-5 h-5 text-zinc-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-1">
                      {tpl.name}
                      {tpl.is_default && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">{tpl.doc_type} · {tpl.layout} · {tpl.density || "standard"}</div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => open(tpl)} data-testid={`tpl-edit-${tpl.id}`}>Edit</Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => duplicate(tpl)}><Copy className="w-3 h-3" /></Button>
                  {!tpl.is_default && <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-amber-400" onClick={() => setDefault(tpl)}><Star className="w-3 h-3" /></Button>}
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-400" onClick={() => remove(tpl)}><Trash2 className="w-3 h-3" /></Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════ Builder View ════════════════════════════════════════
function BuilderView({ selected, setSelected, list, catalog, loading, saving, open, save, remove, duplicate, setDefault, previewUrl, refreshPreview, editorTab, setEditorTab, toggleBlock, updateBlock, updateBlockStyle, reorderBlock, updatePage, dragKey }) {
  if (loading) return <div className="p-12 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Left: Template list */}
      <Card className="col-span-3 h-[82vh] overflow-y-auto">
        <CardContent className="p-2">
          {list.length === 0 ? <div className="p-6 text-xs text-muted-foreground text-center">No saved templates yet</div>
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

      {/* Middle: Builder editor */}
      <Card className="col-span-5 h-[82vh] overflow-y-auto">
        <CardContent className="p-4 space-y-3">
          {!selected ? (
            <div className="text-sm text-muted-foreground text-center py-12">
              Pick a template on the left or clone a designer preset from the Gallery.
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
                      <SelectItem value="statement">Statement</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Tabs value={editorTab} onValueChange={setEditorTab}>
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="blocks" data-testid="tab-blocks">Blocks</TabsTrigger>
                  <TabsTrigger value="design" data-testid="tab-design">Design</TabsTrigger>
                  <TabsTrigger value="page" data-testid="tab-page">Page</TabsTrigger>
                </TabsList>

                <TabsContent value="blocks" className="space-y-2 pt-2">
                  <BlocksTab selected={selected} catalog={catalog} toggleBlock={toggleBlock} updateBlock={updateBlock} updateBlockStyle={updateBlockStyle} reorderBlock={reorderBlock} dragKey={dragKey} />
                </TabsContent>

                <TabsContent value="design" className="space-y-2 pt-2">
                  <DesignTab selected={selected} setSelected={setSelected} />
                </TabsContent>

                <TabsContent value="page" className="space-y-2 pt-2">
                  <PageTab selected={selected} updatePage={updatePage} />
                </TabsContent>
              </Tabs>

              <div className="bg-muted/30 rounded p-2 text-[10px]">
                <div className="font-medium mb-1">Available merge tags (click to copy):</div>
                <div className="flex flex-wrap gap-1">
                  {MERGE_TAGS.map((t) => <code key={t} className="bg-background rounded px-1 py-0.5 text-[10px] cursor-pointer hover:bg-emerald-500/20" onClick={() => navigator.clipboard.writeText(t).then(() => toast.success("Copied " + t))}>{t}</code>)}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 sticky bottom-0 bg-background pt-2 border-t border-zinc-800/40">
                {!selected.is_default && (
                  <Button size="sm" variant="outline" className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10" onClick={() => setDefault(selected)}>
                    <Star className="w-3 h-3 mr-1" />Make default
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => duplicate(selected)}>
                  <Copy className="w-3 h-3 mr-1" /> Duplicate
                </Button>
                <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={save} disabled={saving} data-testid="invoice-tpl-save">
                  {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}Save & Refresh Preview
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Right: Live preview */}
      <Card className="col-span-4 h-[82vh]">
        <CardContent className="p-2 h-full">
          <div className="flex items-center justify-between mb-1">
            <Badge variant="outline" className="text-[10px]"><Eye className="w-3 h-3 mr-1" />Live Preview</Badge>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={refreshPreview} data-testid="invoice-tpl-refresh-preview">Refresh</Button>
          </div>
          {previewUrl ? (
            <iframe src={previewUrl} className="w-full h-[calc(100%-1.5rem)] border border-zinc-800 rounded bg-white" title="preview" data-testid="invoice-tpl-preview-iframe" />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">Save to see preview</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Blocks Tab ──
function BlocksTab({ selected, catalog, toggleBlock, updateBlock, updateBlockStyle, reorderBlock, dragKey }) {
  const meta = useMemo(() => Object.fromEntries((catalog || []).map((c) => [c.key, c])), [catalog]);
  const blocks = [...(selected.blocks || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Blocks — drag to reorder, click to expand styling</div>
      {blocks.map((b) => {
        const cat = meta[b.key] || {};
        const canEditContent = cat.editable_content;
        return (
          <div
            key={b.key}
            draggable
            onDragStart={() => { dragKey.current = b.key; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragKey.current && dragKey.current !== b.key) reorderBlock(dragKey.current, b.key); dragKey.current = null; }}
            className={`rounded border ${b.enabled ? "border-emerald-500/30 bg-emerald-500/5" : "border-zinc-800 bg-muted/20"} p-2`}
            data-testid={`tpl-block-${b.key}`}
          >
            <div className="flex items-center gap-2">
              <GripVertical className="w-3 h-3 text-zinc-600 cursor-move" />
              <span className="text-sm font-medium flex-1 flex items-center gap-2">
                {cat.label || b.key}
                {cat.new && <Badge variant="outline" className="text-[8px] border-emerald-500/30 text-emerald-400 px-1 py-0">NEW</Badge>}
                <span className="text-[10px] text-muted-foreground">· {cat.category}</span>
              </span>
              <Switch checked={b.enabled} onCheckedChange={() => toggleBlock(b.key)} data-testid={`tpl-block-toggle-${b.key}`} />
            </div>
            {b.enabled && (
              <div className="mt-2 space-y-2">
                {canEditContent && (
                  <Textarea
                    rows={2}
                    value={b.content || ""}
                    onChange={(e) => updateBlock(b.key, { content: e.target.value })}
                    placeholder="Content (use {{merge_tags}})"
                    className="text-xs"
                    data-testid={`tpl-block-content-${b.key}`}
                  />
                )}
                {/* Per-block style */}
                <div className="grid grid-cols-4 gap-2 items-center">
                  <Select value={b.style?.align || "L"} onValueChange={(v) => updateBlockStyle(b.key, { align: v })}>
                    <SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Align" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="L">Align Left</SelectItem>
                      <SelectItem value="C">Align Center</SelectItem>
                      <SelectItem value="R">Align Right</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="number" placeholder="Size" value={b.style?.font_size || ""} onChange={(e) => updateBlockStyle(b.key, { font_size: parseInt(e.target.value || "0") || null })} className="h-7 text-[10px]" />
                  <Input type="color" value={b.style?.text_color || "#000000"} onChange={(e) => updateBlockStyle(b.key, { text_color: e.target.value })} className="h-7 p-0" title="Text color" />
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant={b.style?.bold ? "default" : "outline"} className="h-6 w-6 p-0 text-[10px]" onClick={() => updateBlockStyle(b.key, { bold: !b.style?.bold })}><b>B</b></Button>
                    <Button size="sm" variant={b.style?.italic ? "default" : "outline"} className="h-6 w-6 p-0 text-[10px]" onClick={() => updateBlockStyle(b.key, { italic: !b.style?.italic })}><i>I</i></Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Design Tab (colors + layout + density) ──
function DesignTab({ selected, setSelected }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Layout</Label>
          <Select value={selected.layout} onValueChange={(v) => setSelected({ ...selected, layout: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["classic", "minimal", "bold", "executive", "tactical", "modern"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
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
          <Label className="text-xs">Font</Label>
          <Select value={selected.page?.font_family || "Helvetica"} onValueChange={(v) => setSelected({ ...selected, page: { ...(selected.page || {}), font_family: v } })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Helvetica">Helvetica (sans)</SelectItem>
              <SelectItem value="Times">Times (serif)</SelectItem>
              <SelectItem value="Courier">Courier (mono)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Primary color</Label>
          <Input type="color" value={selected.primary_color || "#10B981"} onChange={(e) => setSelected({ ...selected, primary_color: e.target.value })} className="h-9 p-1" />
        </div>
        <div>
          <Label className="text-xs">Accent color</Label>
          <Input type="color" value={selected.accent_color || "#06B6D4"} onChange={(e) => setSelected({ ...selected, accent_color: e.target.value })} className="h-9 p-1" />
        </div>
        <div>
          <Label className="text-xs">Secondary</Label>
          <Input type="color" value={selected.secondary_color || "#0F172A"} onChange={(e) => setSelected({ ...selected, secondary_color: e.target.value })} className="h-9 p-1" />
        </div>
      </div>
    </div>
  );
}

// ── Page Tab (paper size, orientation, margins, watermark) ──
function PageTab({ selected, updatePage }) {
  const page = selected.page || {};
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Paper size</Label>
          <Select value={page.paper_size || "A4"} onValueChange={(v) => updatePage({ paper_size: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="A4">A4</SelectItem>
              <SelectItem value="Letter">Letter</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Orientation</Label>
          <Select value={page.orientation || "P"} onValueChange={(v) => updatePage({ orientation: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="P">Portrait</SelectItem>
              <SelectItem value="L">Landscape</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {["margin_top", "margin_bottom", "margin_left", "margin_right"].map((k) => (
          <div key={k}>
            <Label className="text-[10px]">{k.replace("margin_", "")}</Label>
            <Input type="number" value={page[k] || ""} onChange={(e) => updatePage({ [k]: parseFloat(e.target.value || "0") })} className="h-8" placeholder="mm" />
          </div>
        ))}
      </div>
      <div>
        <Label className="text-xs">Watermark text</Label>
        <Input value={page.watermark_text || ""} onChange={(e) => updatePage({ watermark_text: e.target.value })} placeholder="DRAFT / PAID / PRO FORMA" />
        <div className="mt-2">
          <Label className="text-[10px] text-muted-foreground">Watermark opacity ({((page.watermark_opacity ?? 0.08) * 100).toFixed(0)}%)</Label>
          <Slider value={[Math.round((page.watermark_opacity ?? 0.08) * 100)]} min={0} max={30} step={1} onValueChange={(v) => updatePage({ watermark_opacity: (v[0] || 0) / 100 })} />
        </div>
      </div>
    </div>
  );
}
